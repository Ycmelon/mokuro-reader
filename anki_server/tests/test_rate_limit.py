import pytest

pytest.importorskip("anki")  # app imports the collection manager

from fastapi import HTTPException

from anki_server import app as app_module


@pytest.fixture(autouse=True)
def clean_hits():
    app_module._login_hits.clear()
    yield
    app_module._login_hits.clear()


def test_blocks_after_max_attempts(monkeypatch):
    monkeypatch.setattr(app_module.config, "LOGIN_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(app_module.config, "LOGIN_WINDOW_SECS", 300)

    for _ in range(3):
        app_module._rate_limit_login("1.2.3.4")
    with pytest.raises(HTTPException) as exc:
        app_module._rate_limit_login("1.2.3.4")
    assert exc.value.status_code == 429

    # Other IPs are unaffected.
    app_module._rate_limit_login("5.6.7.8")


def test_prunes_stale_entries_for_all_ips(monkeypatch):
    monkeypatch.setattr(app_module.config, "LOGIN_WINDOW_SECS", 300)
    app_module._login_hits["9.9.9.9"] = [0.0]  # long expired

    app_module._rate_limit_login("1.2.3.4")
    assert "9.9.9.9" not in app_module._login_hits


class FakeRequest:
    def __init__(self, host, headers=None):
        self.headers = headers or {}

        class _Client:
            pass

        self.client = _Client()
        self.client.host = host


def test_client_ip_ignores_forwarded_header_by_default(monkeypatch):
    monkeypatch.setattr(app_module.config, "TRUST_PROXY", False)
    req = FakeRequest("10.0.0.1", {"x-forwarded-for": "203.0.113.9, 10.0.0.1"})
    assert app_module._client_ip(req) == "10.0.0.1"


def test_client_ip_uses_forwarded_header_when_trusted(monkeypatch):
    monkeypatch.setattr(app_module.config, "TRUST_PROXY", True)
    req = FakeRequest("10.0.0.1", {"x-forwarded-for": "203.0.113.9, 10.0.0.1"})
    assert app_module._client_ip(req) == "203.0.113.9"
