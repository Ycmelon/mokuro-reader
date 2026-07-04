"""Durable queue of un-pushed mined cards.

The mining client only ever *adds* notes, so the sole local-only data in a
collection is cards that haven't reached AnkiWeb yet. We mirror each added card
here (per account) so that resolving a full sync by taking AnkiWeb's copy is
lossless: after a full download we replay the queue onto the fresh collection,
and a successful push clears it.

Touched only from a collection's single executor thread, so no in-memory lock is
needed; the file is written atomically so a crash mid-write can't corrupt it.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .cards import NewCard


class Outbox:
    """A persisted list of `NewCard`s that have been added locally but not yet
    confirmed on AnkiWeb."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._cards: list[NewCard] = self._load()

    def _load(self) -> list[NewCard]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text())
        except (json.JSONDecodeError, OSError):
            return []
        loaded: list[NewCard] = []
        for item in raw:
            try:
                loaded.append(
                    NewCard(
                        deck=item["deck"],
                        model=item["model"],
                        fields=item["fields"],
                        images=item.get("images", []),
                        tags=item.get("tags", []),
                    )
                )
            except (KeyError, TypeError):
                continue  # skip malformed entries rather than fail to load
        return loaded

    def _flush(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = [
            {
                "deck": c.deck,
                "model": c.model,
                "fields": c.fields,
                "images": c.images,
                "tags": c.tags,
            }
            for c in self._cards
        ]
        # Atomic replace so a crash mid-write can't corrupt the queue.
        fd, tmp = tempfile.mkstemp(dir=str(self._path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            os.replace(tmp, self._path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def add(self, card: NewCard) -> None:
        self._cards.append(card)
        self._flush()

    def all(self) -> list[NewCard]:
        return list(self._cards)

    def clear(self) -> None:
        if not self._cards and not self._path.exists():
            return
        self._cards = []
        self._flush()

    def __len__(self) -> int:
        return len(self._cards)
