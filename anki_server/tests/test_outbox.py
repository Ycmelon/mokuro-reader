import json

import pytest

pytest.importorskip("anki")  # outbox imports cards, which needs the anki package

from anki_server.cards import NewCard
from anki_server.outbox import Outbox


def make_card(deck="Mining"):
    return NewCard(deck=deck, model="Lapis", fields={"Expression": "語"}, images=[], tags=["mokuro"])


def test_add_persists_and_reloads(tmp_path):
    path = tmp_path / "outbox.json"
    outbox = Outbox(path)
    outbox.add(make_card())
    assert len(outbox) == 1

    reloaded = Outbox(path)
    assert len(reloaded) == 1
    assert reloaded.all()[0].deck == "Mining"


def test_pop_removes_last_and_persists(tmp_path):
    path = tmp_path / "outbox.json"
    outbox = Outbox(path)
    outbox.add(make_card("A"))
    outbox.add(make_card("B"))
    outbox.pop()

    assert [c.deck for c in outbox.all()] == ["A"]
    assert [c.deck for c in Outbox(path).all()] == ["A"]


def test_pop_on_empty_is_a_noop(tmp_path):
    outbox = Outbox(tmp_path / "outbox.json")
    outbox.pop()  # must not raise
    assert len(outbox) == 0


def test_clear_empties_queue(tmp_path):
    path = tmp_path / "outbox.json"
    outbox = Outbox(path)
    outbox.add(make_card())
    outbox.clear()
    assert len(outbox) == 0
    assert len(Outbox(path)) == 0


def test_load_skips_malformed_entries(tmp_path):
    path = tmp_path / "outbox.json"
    good = {"deck": "D", "model": "M", "fields": {"F": "v"}, "images": [], "tags": []}
    path.write_text(json.dumps([good, {"deck": "missing the rest"}]))
    outbox = Outbox(path)
    assert len(outbox) == 1
    assert outbox.all()[0].deck == "D"


def test_load_survives_corrupt_file(tmp_path):
    path = tmp_path / "outbox.json"
    path.write_text("[not json")
    assert len(Outbox(path)) == 0
