"""Note creation against a user's real Anki collection.

Called on the collection's dedicated thread. The note type and (after the
initial sync) the user's decks already exist in the downloaded collection, so we
operate on their genuine models rather than inventing our own.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

from anki.collection import Collection


class CardError(Exception):
    """Raised for client-fixable problems (unknown model/field, bad image)."""


@dataclass
class NewCard:
    deck: str
    model: str
    fields: dict[str, str]
    images: list[dict]  # each: {"field": str, "filename": str, "data": <base64>}
    tags: list[str]


def _decode_image(data: str) -> bytes:
    # Accept raw base64 or a full data URL ("data:image/jpeg;base64,....").
    if data.startswith("data:"):
        _, _, data = data.partition(",")
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as e:
        raise CardError(f"invalid base64 image data: {e}") from e


def add_card(col: Collection, card: NewCard) -> dict:
    model = col.models.by_name(card.model)
    if model is None:
        raise CardError(f"note type '{card.model}' not found in collection")

    note = col.new_note(model)
    field_names = set(note.keys())

    for name, value in card.fields.items():
        if name not in field_names:
            raise CardError(f"field '{name}' not in note type '{card.model}'")
        note[name] = value

    written: list[str] = []
    for img in card.images:
        field = img.get("field")
        filename = img.get("filename")
        data = img.get("data")
        if field not in field_names:
            raise CardError(f"image target field '{field}' not in note type '{card.model}'")
        if not filename or data is None:
            raise CardError("image entries require 'filename' and 'data'")
        # write_data may rename to avoid collisions; use the returned name.
        actual = col.media.write_data(filename, _decode_image(data))
        note[field] += f'<img src="{actual}">'
        written.append(actual)

    if card.tags:
        note.tags = list(card.tags)

    deck_id = col.decks.id(card.deck)  # creates the deck (and parents) if missing
    col.add_note(note, deck_id)

    return {"note_id": note.id, "image_filenames": written}
