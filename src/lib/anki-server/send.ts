/**
 * Transport dispatcher for mined cards. Builds the neutral `CardRequest` once
 * (via `cards.ts`) and delivers it through the configured protocol:
 *  - 'server'      → the self-hosted Python server (`POST /cards` → AnkiWeb)
 *  - 'ankiconnect' → a local AnkiConnect instance (`addNote`)
 *
 * Throws on failure so the review dialog can surface an inline error. The server
 * path throws `UnauthorizedError` on an expired token (the dialog special-cases it).
 */

import type { AnkiServerSettings } from '$lib/settings/misc';
import { buildCardRequest, type CardMeta, type LogicalCard } from './cards';
import { createCard, type CardRequest } from './client';
import { ankiConnect } from '$lib/anki-connect';

export async function sendMinedCard(
  card: LogicalCard,
  cfg: AnkiServerSettings,
  meta: CardMeta
): Promise<void> {
  const request = buildCardRequest(card, cfg, meta);
  if (cfg.protocol === 'ankiconnect') {
    await sendViaAnkiConnect(request);
  } else {
    await createCard(cfg.serverUrl, cfg.token, request);
  }
}

/** Adapt a `CardRequest` to AnkiConnect's `addNote`. Ensures the deck exists,
 *  converts our image data URLs to AnkiConnect's `picture` param (raw base64). */
async function sendViaAnkiConnect(request: CardRequest): Promise<void> {
  // Create the deck if missing (no-op when it already exists; ignored on Android).
  await ankiConnect('createDeck', { deck: request.deck }, { silent: true });

  const picture = request.images.map((img) => ({
    filename: img.filename,
    data: img.data.includes(';base64,') ? img.data.split(';base64,')[1] : img.data,
    fields: [img.field]
  }));

  const note: Record<string, unknown> = {
    deckName: request.deck,
    modelName: request.model,
    fields: request.fields,
    options: { allowDuplicate: true },
    tags: request.tags
  };
  if (picture.length > 0) note.picture = picture;

  const result = await ankiConnect('addNote', { note });
  // `ankiConnect` shows its own snackbar and returns undefined on failure; throw
  // so the review dialog keeps the card open for a fix/retry.
  if (!result) {
    throw new Error(
      'AnkiConnect could not add the card. Check the note type, fields, and that Anki is running.'
    );
  }
}
