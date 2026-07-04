"""Environment-driven configuration for the Anki card server.

Every value has a safe default so the server boots with zero config for local
testing; override via environment variables in production.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Directory holding sessions.json and per-user collections/.
DATA_DIR = Path(_env("ANKI_SERVER_DATA_DIR", str(Path(__file__).parent / "data")))

# Allowed CORS origins (comma-separated). The site sends AnkiWeb passwords to
# /login, so this MUST be locked to the real website origin(s) in production.
# "*" is permitted only for local testing and disables credentialed CORS.
CORS_ORIGINS = [o.strip() for o in _env("ANKI_SERVER_CORS_ORIGINS", "*").split(",") if o.strip()]

# A card capture burst re-pulls from AnkiWeb only if the last pull is older than
# this, so rapid captures don't each trigger a network round-trip.
PULL_STALE_SECS = _env_int("ANKI_SERVER_PULL_STALE_SECS", 60)

# After the last card is added, wait this long before pushing so a burst of
# captures coalesces into a single upload.
PUSH_DEBOUNCE_SECS = _env_int("ANKI_SERVER_PUSH_DEBOUNCE_SECS", 5)

# Close + evict a collection that has been idle this long (bounds memory /
# open file handles when many accounts are used).
COLLECTION_IDLE_SECS = _env_int("ANKI_SERVER_COLLECTION_IDLE_SECS", 15 * 60)

# A session token expires after this much inactivity.
SESSION_IDLE_SECS = _env_int("ANKI_SERVER_SESSION_IDLE_SECS", 30 * 24 * 60 * 60)

# Simple per-IP rate limit on /login (attempts per window) so the server can't
# be used as an AnkiWeb credential-stuffing proxy.
LOGIN_MAX_ATTEMPTS = _env_int("ANKI_SERVER_LOGIN_MAX_ATTEMPTS", 10)
LOGIN_WINDOW_SECS = _env_int("ANKI_SERVER_LOGIN_WINDOW_SECS", 300)

HOST = _env("ANKI_SERVER_HOST", "127.0.0.1")
PORT = _env_int("ANKI_SERVER_PORT", 8000)

LOG_LEVEL = _env("ANKI_SERVER_LOG_LEVEL", "INFO").upper()


def setup_logging() -> None:
    """Attach a stdout handler to the `anki_server` logger tree.

    Uvicorn only configures its own loggers, so without this our module logs
    would be swallowed. Idempotent — safe to call more than once.
    """
    logger = logging.getLogger("anki_server")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s", "%H:%M:%S")
        )
        logger.addHandler(handler)
        logger.propagate = False
    logger.setLevel(LOG_LEVEL)


def collections_dir() -> Path:
    return DATA_DIR / "collections"


def sessions_path() -> Path:
    return DATA_DIR / "sessions.json"
