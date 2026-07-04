"""Stateless AnkiWeb sync helpers.

Every function here touches the Anki `Collection` and therefore MUST be invoked
on that collection's dedicated single thread (see collection_manager.py). They never
mutate server-side session state directly; they return a `SyncResult` the caller
acts on.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from anki.collection import Collection
from anki.sync_pb2 import SyncAuth

log = logging.getLogger(__name__)

# Poll interval / cap while waiting for a background media sync to drain.
_MEDIA_POLL_SECS = 0.5
_MEDIA_MAX_WAIT_SECS = 300


@dataclass
class SyncResult:
    # "ok"            -> normal sync (or no-op) completed
    # "full_required" -> AnkiWeb needs a full sync; `direction` says which way
    status: str
    direction: str | None = None  # "download" | "upload" | "ambiguous"
    new_endpoint: str | None = None
    server_media_usn: int | None = None
    message: str = ""


def _classify(out) -> SyncResult:
    req = out.required
    new_endpoint = out.new_endpoint or None
    if req in (out.NO_CHANGES, out.NORMAL_SYNC):
        return SyncResult("ok", new_endpoint=new_endpoint, server_media_usn=out.server_media_usn)
    if req == out.FULL_DOWNLOAD:
        direction = "download"
    elif req == out.FULL_UPLOAD:
        direction = "upload"
    else:  # FULL_SYNC — server can't decide the safe direction
        direction = "ambiguous"
    return SyncResult(
        "full_required",
        direction=direction,
        new_endpoint=new_endpoint,
        server_media_usn=out.server_media_usn,
        message=out.server_message or "",
    )


def normal_sync(col: Collection, auth: SyncAuth, *, sync_media: bool) -> SyncResult:
    """Perform a normal collection sync. Reports if a full sync is needed instead."""
    out = col.sync_collection(auth, sync_media)
    return _classify(out)


def wait_for_media(col: Collection) -> None:
    """Block until the background media sync started by `sync_media=True` drains.

    `media_sync_status()` raises if the media sync failed with an error, which
    propagates to the caller.
    """
    deadline = time.time() + _MEDIA_MAX_WAIT_SECS
    next_log = 0.0
    while time.time() < deadline:
        status = col.media_sync_status()
        if not status.active:
            return
        # Log progress every few seconds so a long media sync isn't a silent wait.
        now = time.time()
        if now >= next_log:
            p = status.progress
            # Anki reports these as pre-formatted strings (e.g. "Checked: 42"),
            # not numbers — and they're empty until files are actually moving, so
            # only surface them when populated, else emit a plain heartbeat.
            detail = ", ".join(s for s in (p.checked, p.added, p.removed) if s)
            log.info("media sync in progress%s", f": {detail}" if detail else " …")
            next_log = now + 3
        time.sleep(_MEDIA_POLL_SECS)


def full_sync(col: Collection, auth: SyncAuth, *, server_usn: int | None, upload: bool) -> None:
    """Run a full upload or download, reopening the collection afterwards.

    Destructive by nature (one side overwrites the other), so callers must only
    invoke this in safe situations (fresh login) or on explicit user request.
    """
    col.close_for_full_sync()
    try:
        col.full_upload_or_download(auth=auth, server_usn=server_usn, upload=upload)
    finally:
        # Always re-establish the DB handle, even if the transfer failed, so the
        # collection object isn't left permanently closed.
        col.reopen(after_full_sync=True)
