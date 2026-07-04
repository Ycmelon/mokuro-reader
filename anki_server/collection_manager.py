"""Per-user Anki collection management.

Each AnkiWeb account gets its own on-disk collection and a dedicated
single-thread executor. Anki requires a collection be used from one thread and
one process, so *all* work for a user — login, sync, add-note, close — is funnelled
through that one executor. This both enforces thread affinity and serializes
access without ad-hoc locking.

A background reaper closes collections that have gone idle to bound memory and
open file handles.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from anki.collection import Collection
from anki.sync_pb2 import SyncAuth

from . import cards, config, sync
from .outbox import Outbox
from .store import store

log = logging.getLogger(__name__)


def user_id_for(username: str) -> str:
    """Stable, path-safe id for an AnkiWeb account (never expose the raw email)."""
    return hashlib.sha256(username.strip().lower().encode()).hexdigest()[:32]


class UserCollection:
    def __init__(self, user_id: str, auth: SyncAuth | None, token: str | None) -> None:
        self.user_id = user_id
        self.auth = auth
        self.token = token
        self.path = config.collections_dir() / user_id / "collection.anki2"
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"col-{user_id[:8]}")
        self.col: Collection | None = None

        # Durable queue of cards added locally but not yet confirmed on AnkiWeb.
        # Lets us take AnkiWeb's copy on a full sync without losing mined cards
        # (download → replay the queue → push). Only touched on the executor thread.
        self.outbox = Outbox(self.path.parent / "outbox.json")

        self._state_lock = threading.Lock()
        self._push_timer: threading.Timer | None = None
        self._closing = False

        # Observable sync state (read by /status).
        self.last_pull_at = 0.0
        self.last_used = time.time()
        # None when healthy; else "download" | "upload" | "ambiguous" indicating a
        # full sync AnkiWeb demanded that we refuse to auto-resolve.
        self.full_sync: str | None = None
        self.last_error: str | None = None

    # -- executor-thread operations (self.col is only touched here) --

    def _ensure_open(self) -> None:
        if self.col is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.col = Collection(str(self.path))

    def _apply_endpoint(self, res: sync.SyncResult) -> None:
        if res.new_endpoint and self.auth is not None:
            self.auth = SyncAuth(hkey=self.auth.hkey, endpoint=res.new_endpoint)
            if self.token:
                store.update_endpoint(self.token, res.new_endpoint)

    def _sync_media_and_settle(self) -> None:
        res = sync.normal_sync(self.col, self.auth, sync_media=True)
        self._apply_endpoint(res)
        sync.wait_for_media(self.col)

    def _do_login(self, username: str, password: str, endpoint: str) -> SyncAuth:
        t0 = time.time()
        log.info("login[%s]: opening collection at %s", username, self.path)
        self._ensure_open()

        log.info("login[%s]: authenticating with AnkiWeb (%s)", username, endpoint or "default")
        self.auth = self.col.sync_login(username, password, endpoint or None)
        log.info("login[%s]: sync_login ok in %.1fs; pulling collection", username, time.time() - t0)

        # Fresh login: the local collection is empty/stale and has no un-pushed
        # changes, so it's always safe to take the server copy on a full sync.
        res = sync.normal_sync(self.col, self.auth, sync_media=False)
        self._apply_endpoint(res)
        log.info("login[%s]: initial sync status=%s direction=%s", username, res.status, res.direction)
        if res.status == "full_required":
            upload = res.direction == "upload"
            log.info("login[%s]: performing full %s from AnkiWeb…", username, res.direction)
            sync.full_sync(self.col, self.auth, server_usn=res.server_media_usn, upload=upload)
            # A prior session may have left un-pushed cards on disk + in the outbox
            # that a full download would wipe; replay them onto the server copy.
            if not upload:
                self._replay_outbox()
            log.info("login[%s]: full %s done (%.1fs)", username, res.direction, time.time() - t0)

        log.info("login[%s]: syncing media…", username)
        self._sync_media_and_settle()  # pushes any replayed/local cards + media
        self.last_pull_at = time.time()
        self.full_sync = None
        self.last_error = None
        self.outbox.clear()  # everything local is now on AnkiWeb
        log.info("login[%s]: complete in %.1fs", username, time.time() - t0)
        return self.auth

    def _maybe_pull(self) -> None:
        if time.time() - self.last_pull_at <= config.PULL_STALE_SECS:
            return
        res = sync.normal_sync(self.col, self.auth, sync_media=False)
        self._apply_endpoint(res)
        if res.status == "ok":
            self.last_pull_at = time.time()
        # If a full sync is required we don't resolve it here — the debounced push
        # (via _sync_now) resolves it losslessly using the outbox. Adding the note
        # locally first is safe because it's queued in the outbox.

    def _replay_outbox(self) -> None:
        """Re-add every queued card onto the current (freshly downloaded) collection."""
        queued = self.outbox.all()
        if not queued:
            return
        log.info("replaying %d queued card(s) after full download", len(queued))
        for card in queued:
            try:
                cards.add_card(self.col, card)
            except cards.CardError as e:
                # A queued card whose note type/field no longer exists on the server
                # copy — drop it rather than wedge every future sync.
                log.warning("outbox replay skipped a card: %s", e)

    def _sync_now(self, *, prefer: str = "auto") -> None:
        """Normal sync; if AnkiWeb demands a full sync, resolve it losslessly and
        push again, then clear the outbox once everything local is on AnkiWeb.

        `prefer` forces a direction ('download'/'upload') for the full-sync case;
        'auto' follows AnkiWeb's suggestion, treating the ambiguous case as a
        download (safe, since the outbox replays our mined cards on top).
        """
        res = sync.normal_sync(self.col, self.auth, sync_media=True)
        self._apply_endpoint(res)
        log.info("sync: normal_sync -> %s%s", res.status, f" ({res.direction})" if res.direction else "")
        if res.status == "full_required":
            direction = prefer if prefer in ("download", "upload") else res.direction
            log.info("sync: resolving full sync as %s (queued=%d)", direction, len(self.outbox))
            if direction == "upload":
                sync.full_sync(self.col, self.auth, server_usn=res.server_media_usn, upload=True)
            else:  # "download" or "ambiguous" → take AnkiWeb's copy, replay our cards
                sync.full_sync(self.col, self.auth, server_usn=res.server_media_usn, upload=False)
                self._replay_outbox()
            # Push the replayed/local cards up and settle media.
            res = sync.normal_sync(self.col, self.auth, sync_media=True)
            self._apply_endpoint(res)
            log.info("sync: post-resolve normal_sync -> %s", res.status)
            if res.status == "full_required":
                raise RuntimeError(f"full sync still required after auto-resolve ({res.direction})")
        sync.wait_for_media(self.col)
        self.last_pull_at = time.time()
        self.full_sync = None
        self.last_error = None
        log.info("sync: complete; clearing %d queued card(s)", len(self.outbox))
        self.outbox.clear()

    def _do_add(self, card: cards.NewCard) -> dict:
        self._ensure_open()
        self._maybe_pull()
        result = cards.add_card(self.col, card)
        # Queue the payload so a later full download can replay it (see _sync_now).
        self.outbox.add(card)
        return result

    def _do_push(self) -> None:
        if self.col is None:
            log.info("debounced push: skipped (collection closed)")
            return
        log.info("debounced push: starting")
        try:
            self._sync_now()
        except Exception as e:  # keep the queued cards; report the failure via /status
            log.warning("debounced push failed: %s", e)
            self.last_error = str(e)

    def _do_manual_sync(self, direction: str) -> dict:
        self._ensure_open()
        try:
            self._sync_now(prefer=direction)
        except Exception as e:
            self.last_error = str(e)
            raise
        return {"status": "ok"}

    def _do_status(self) -> dict:
        self._ensure_open()
        decks = sorted(d.name for d in self.col.decks.all_names_and_ids())
        models = []
        for m in self.col.models.all_names_and_ids():
            nt = self.col.models.get(m.id)
            models.append({"name": m.name, "fields": [f["name"] for f in nt["flds"]]})
        return {
            "decks": decks,
            "models": models,
            "last_pull_at": self.last_pull_at,
            "pending_push": self.has_pending_push(),
            "full_sync_needed": self.full_sync,
            "last_error": self.last_error,
        }

    # -- request/timer-thread helpers (never touch self.col directly) --

    def _submit(self, fn, *args) -> Future:
        self.last_used = time.time()
        return self.executor.submit(fn, *args)

    def submit_login(self, username: str, password: str, endpoint: str) -> Future:
        return self._submit(self._do_login, username, password, endpoint)

    def submit_add(self, card: cards.NewCard) -> Future:
        return self._submit(self._do_add, card)

    def submit_status(self) -> Future:
        return self._submit(self._do_status)

    def submit_manual_sync(self, direction: str) -> Future:
        return self._submit(self._do_manual_sync, direction)

    def has_pending_push(self) -> bool:
        with self._state_lock:
            return self._push_timer is not None

    def schedule_push(self) -> None:
        """(Re)arm the debounce timer so a capture burst coalesces into one push."""
        with self._state_lock:
            if self._closing:
                return
            if self._push_timer is not None:
                self._push_timer.cancel()
            timer = threading.Timer(config.PUSH_DEBOUNCE_SECS, self._fire_push)
            timer.daemon = True
            self._push_timer = timer
            timer.start()

    def _fire_push(self) -> None:
        with self._state_lock:
            self._push_timer = None
        log.info("debounced push: timer fired")
        try:
            self._submit(self._do_push)
        except RuntimeError:
            pass  # executor already shut down (eviction raced the timer)

    def close(self, flush: bool = True) -> None:
        with self._state_lock:
            self._closing = True
            if self._push_timer is not None:
                self._push_timer.cancel()
                self._push_timer = None

        def _shutdown() -> None:
            try:
                if flush and self.col is not None:
                    self._do_push()
            finally:
                if self.col is not None:
                    self.col.close()
                    self.col = None

        try:
            self.executor.submit(_shutdown).result(timeout=_MEDIA_CLOSE_TIMEOUT)
        except Exception:
            pass
        self.executor.shutdown(wait=True)


# Give a flushing close (which may push + sync media) time to finish.
_MEDIA_CLOSE_TIMEOUT = 320


class CollectionManager:
    def __init__(self) -> None:
        self._collections: dict[str, UserCollection] = {}
        self._lock = threading.Lock()
        self._reaper = threading.Thread(target=self._reap_loop, name="col-reaper", daemon=True)
        self._reaper.start()

    def get(self, user_id: str) -> UserCollection | None:
        with self._lock:
            uc = self._collections.get(user_id)
            if uc is not None:
                uc.last_used = time.time()
            return uc

    def open_for_session(self, user_id: str, hkey: str, endpoint: str, token: str) -> UserCollection:
        """Lazily (re)create a UserCollection for an already-authenticated session."""
        with self._lock:
            uc = self._collections.get(user_id)
            if uc is None:
                uc = UserCollection(user_id, SyncAuth(hkey=hkey, endpoint=endpoint), token)
                self._collections[user_id] = uc
            else:
                uc.token = token
                uc.auth = SyncAuth(hkey=hkey, endpoint=endpoint)
            uc.last_used = time.time()
            return uc

    def open_for_login(self, user_id: str) -> UserCollection:
        with self._lock:
            uc = self._collections.get(user_id)
            if uc is None:
                uc = UserCollection(user_id, None, None)
                self._collections[user_id] = uc
            uc.last_used = time.time()
            return uc

    def remove(self, user_id: str) -> None:
        with self._lock:
            uc = self._collections.pop(user_id, None)
        if uc is not None:
            uc.close()

    def _reap_loop(self) -> None:
        while True:
            time.sleep(30)
            now = time.time()
            stale: list[UserCollection] = []
            with self._lock:
                for user_id, uc in list(self._collections.items()):
                    if uc.has_pending_push():
                        continue
                    if now - uc.last_used > config.COLLECTION_IDLE_SECS:
                        stale.append(uc)
                        del self._collections[user_id]
            for uc in stale:
                uc.close()

    def shutdown(self) -> None:
        with self._lock:
            collections = list(self._collections.values())
            self._collections.clear()
        for uc in collections:
            uc.close()


manager = CollectionManager()
