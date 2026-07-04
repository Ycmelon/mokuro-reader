"""FastAPI application exposing the card-creation + sync API.

Auth model: the AnkiWeb login IS the gate. `/login` exchanges AnkiWeb
credentials for an opaque bearer token (backed by the account's sync token); all
other routes require that bearer. This secures the public endpoint and makes the
service naturally multi-account.

Run with a SINGLE worker (an Anki collection may be opened by one process only):

    uvicorn anki_server.app:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import threading
import time
from contextlib import asynccontextmanager

from anki.errors import SyncError, SyncErrorKind
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from .cards import CardError, NewCard
from .collection_manager import manager, user_id_for
from .store import Session, store

config.setup_logging()
# Explicit name (not __name__): running via `python -m anki_server.app` makes
# __name__ == "__main__", which would fall outside the configured logger tree.
log = logging.getLogger("anki_server.app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Flush pending pushes and close every open collection cleanly on shutdown.
    manager.shutdown()


app = FastAPI(title="Anki Card Server", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,  # auth is a Bearer header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str
    endpoint: str | None = None  # custom sync server; omit for AnkiWeb


class ImageItem(BaseModel):
    field: str
    filename: str
    data: str  # raw base64 or a data: URL


class CardRequest(BaseModel):
    deck: str
    model: str
    fields: dict[str, str]
    images: list[ImageItem] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class SyncRequest(BaseModel):
    direction: str = "auto"  # "auto" | "download" | "upload"


# --------------------------------------------------------------------------
# Login rate limiting (per client IP)
# --------------------------------------------------------------------------

_login_hits: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def _rate_limit_login(ip: str) -> None:
    now = time.time()
    with _login_lock:
        hits = [t for t in _login_hits.get(ip, []) if now - t < config.LOGIN_WINDOW_SECS]
        if len(hits) >= config.LOGIN_MAX_ATTEMPTS:
            raise HTTPException(429, "too many login attempts; try again later")
        hits.append(now)
        _login_hits[ip] = hits


# --------------------------------------------------------------------------
# Auth dependency
# --------------------------------------------------------------------------


def get_session(authorization: str | None = Header(default=None)) -> Session:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization[len("Bearer ") :]
    session = store.get(token)
    if session is None:
        raise HTTPException(401, "invalid or expired token")
    store.touch(token)
    return session


def _uc_for(session: Session):
    return manager.open_for_session(session.user_id, session.hkey, session.endpoint, session.token)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.post("/login")
async def login(body: LoginRequest, request: Request):
    _rate_limit_login(request.client.host if request.client else "unknown")

    user_id = user_id_for(body.username)
    log.info("POST /login: user=%s — starting (this can take a while on first login)", body.username)
    uc = manager.open_for_login(user_id)
    try:
        auth = await asyncio.wrap_future(
            uc.submit_login(body.username, body.password, body.endpoint or "")
        )
    except SyncError as e:
        if getattr(e, "kind", None) == SyncErrorKind.AUTH:
            log.warning("POST /login: user=%s — invalid AnkiWeb credentials", body.username)
            raise HTTPException(401, "invalid AnkiWeb credentials")
        log.warning("POST /login: user=%s — AnkiWeb sync failed: %s", body.username, e)
        raise HTTPException(502, f"AnkiWeb sync failed: {e}")
    except Exception as e:  # network, disk, etc.
        log.exception("POST /login: user=%s — failed", body.username)
        raise HTTPException(502, f"login failed: {e}")

    token = secrets.token_urlsafe(32)
    now = time.time()
    store.put(
        Session(
            token=token,
            user_id=user_id,
            username=body.username,
            hkey=auth.hkey,
            endpoint=auth.endpoint,
            created_at=now,
            last_used=now,
        )
    )
    uc.token = token
    log.info("POST /login: user=%s — token issued", body.username)
    return {"token": token}


@app.get("/status")
async def get_status(session: Session = Depends(get_session)):
    uc = _uc_for(session)
    try:
        data = await asyncio.wrap_future(uc.submit_status())
    except SyncError as e:
        if getattr(e, "kind", None) == SyncErrorKind.AUTH:
            raise HTTPException(401, "relogin required")
        raise HTTPException(502, str(e))
    return {"username": session.username, **data}


@app.post("/cards")
async def create_card(body: CardRequest, session: Session = Depends(get_session)):
    uc = _uc_for(session)
    card = NewCard(
        deck=body.deck,
        model=body.model,
        fields=body.fields,
        images=[i.model_dump() for i in body.images],
        tags=body.tags,
    )
    try:
        result = await asyncio.wrap_future(uc.submit_add(card))
    except CardError as e:
        raise HTTPException(400, str(e))
    except SyncError as e:
        if getattr(e, "kind", None) == SyncErrorKind.AUTH:
            raise HTTPException(401, "relogin required")
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, str(e))
    # Card is committed locally; upload is debounced so bursts coalesce.
    uc.schedule_push()
    return result


@app.post("/sync")
async def do_sync(body: SyncRequest, session: Session = Depends(get_session)):
    if body.direction not in ("auto", "download", "upload"):
        raise HTTPException(400, "direction must be auto, download, or upload")
    uc = _uc_for(session)
    try:
        return await asyncio.wrap_future(uc.submit_manual_sync(body.direction))
    except SyncError as e:
        if getattr(e, "kind", None) == SyncErrorKind.AUTH:
            raise HTTPException(401, "relogin required")
        raise HTTPException(502, str(e))
    except Exception as e:
        raise HTTPException(502, str(e))


@app.post("/logout")
async def logout(session: Session = Depends(get_session)):
    store.remove(session.token)
    manager.remove(session.user_id)  # flushes any pending push, then closes
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
