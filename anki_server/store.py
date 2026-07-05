"""Persistent session store.

Sessions map an opaque bearer token to an AnkiWeb account and its sync token
(hkey). We persist only the hkey + endpoint returned by AnkiWeb — never the
password — so a server restart keeps users logged in without re-prompting.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from . import config


@dataclass
class Session:
    token: str
    user_id: str  # sha256 of the AnkiWeb username; also the collection dir name
    username: str
    hkey: str
    endpoint: str
    created_at: float
    last_used: float


class SessionStore:
    """Thread-safe token -> Session map backed by an atomically-written JSON file."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text())
        except (json.JSONDecodeError, OSError):
            return
        for token, data in raw.items():
            try:
                self._sessions[token] = Session(**data)
            except TypeError:
                continue  # skip malformed/old-schema entries

    def _flush_locked(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {t: asdict(s) for t, s in self._sessions.items()}
        # Atomic replace so a crash mid-write can't corrupt the file.
        fd, tmp = tempfile.mkstemp(dir=str(self._path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            os.replace(tmp, self._path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def put(self, session: Session) -> None:
        with self._lock:
            self._sessions[session.token] = session
            self._flush_locked()

    def get(self, token: str) -> Session | None:
        with self._lock:
            session = self._sessions.get(token)
            if session is None:
                return None
            if time.time() - session.last_used > config.SESSION_IDLE_SECS:
                del self._sessions[token]
                self._flush_locked()
                return None
            return session

    # Persist a touch at most this often per session. last_used only feeds the
    # (30-day) idle expiry, so losing under a minute of it on a crash is fine —
    # not worth rewriting the whole file on every authenticated request.
    TOUCH_FLUSH_SECS = 60

    def touch(self, token: str) -> None:
        with self._lock:
            session = self._sessions.get(token)
            if session is not None:
                now = time.time()
                flush = now - session.last_used >= self.TOUCH_FLUSH_SECS
                session.last_used = now
                if flush:
                    self._flush_locked()

    def update_endpoint(self, token: str, endpoint: str) -> None:
        """AnkiWeb can hand back a new shard endpoint during sync; persist it."""
        with self._lock:
            session = self._sessions.get(token)
            if session is not None and session.endpoint != endpoint:
                session.endpoint = endpoint
                self._flush_locked()

    def remove(self, token: str) -> None:
        with self._lock:
            if token in self._sessions:
                del self._sessions[token]
                self._flush_locked()


store = SessionStore(config.sessions_path())
