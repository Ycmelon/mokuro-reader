import json
import time

from anki_server.store import Session, SessionStore


def make_session(token="tok", last_used=None):
    now = time.time()
    return Session(
        token=token,
        user_id="uid",
        username="user@example.com",
        hkey="hkey",
        endpoint="https://sync.example.com",
        created_at=now,
        last_used=last_used if last_used is not None else now,
    )


def test_put_get_roundtrip_and_persistence(tmp_path):
    path = tmp_path / "sessions.json"
    store = SessionStore(path)
    store.put(make_session())

    assert store.get("tok") is not None
    assert store.get("missing") is None

    # A fresh store instance reloads the persisted session.
    reloaded = SessionStore(path)
    session = reloaded.get("tok")
    assert session is not None
    assert session.username == "user@example.com"


def test_idle_expired_session_is_evicted(tmp_path, monkeypatch):
    monkeypatch.setattr("anki_server.config.SESSION_IDLE_SECS", 100)
    store = SessionStore(tmp_path / "sessions.json")
    store.put(make_session(last_used=time.time() - 101))

    assert store.get("tok") is None
    # And it was removed from disk, not just the in-memory map.
    assert SessionStore(tmp_path / "sessions.json").get("tok") is None


def test_touch_throttles_disk_flushes(tmp_path):
    path = tmp_path / "sessions.json"
    store = SessionStore(path)
    store.put(make_session())
    persisted_before = json.loads(path.read_text())["tok"]["last_used"]

    # A touch right after the put updates memory but skips the disk write.
    store.touch("tok")
    assert json.loads(path.read_text())["tok"]["last_used"] == persisted_before

    # Once the persisted value is stale enough, the touch flushes.
    with store._lock:
        store._sessions["tok"].last_used = time.time() - SessionStore.TOUCH_FLUSH_SECS - 1
        store._flush_locked()
    store.touch("tok")
    assert json.loads(path.read_text())["tok"]["last_used"] > persisted_before


def test_remove_deletes_from_disk(tmp_path):
    path = tmp_path / "sessions.json"
    store = SessionStore(path)
    store.put(make_session())
    store.remove("tok")
    assert store.get("tok") is None
    assert SessionStore(path).get("tok") is None


def test_load_skips_malformed_entries(tmp_path):
    path = tmp_path / "sessions.json"
    good = {
        "token": "tok",
        "user_id": "uid",
        "username": "u",
        "hkey": "h",
        "endpoint": "e",
        "created_at": time.time(),
        "last_used": time.time(),
    }
    path.write_text(json.dumps({"tok": good, "bad": {"token": "bad"}}))

    store = SessionStore(path)
    assert store.get("tok") is not None
    assert store.get("bad") is None


def test_load_survives_corrupt_file(tmp_path):
    path = tmp_path / "sessions.json"
    path.write_text("{not json")
    store = SessionStore(path)
    assert store.get("anything") is None
