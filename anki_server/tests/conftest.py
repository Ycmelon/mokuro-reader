"""Shared test setup: point the server at a throwaway data dir BEFORE any
anki_server module is imported (config reads the env at import time)."""

import os
import tempfile

os.environ.setdefault("ANKI_SERVER_DATA_DIR", tempfile.mkdtemp(prefix="anki-server-tests-"))
