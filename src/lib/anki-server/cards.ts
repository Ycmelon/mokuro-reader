/**
 * Maps our logical mined card (word / reading / meaning / sentence / extra /
 * image) onto the user-configured note type, producing the `POST /cards` body.
 *
 * Pure logic — no store or network dependency — so it's unit-testable and shared
 * by the review dialog. The destination (deck, note type, per-field mapping,
 * marker tag) comes from `AnkiServerSettings`; the series/volume come from the
 * mining context.
 */

import type { AnkiServerSettings } from '$lib/settings/misc';
import type { CardRequest } from './client';

/** The logical card fields, ready to be routed onto note-type fields. */
export interface LogicalCard {
  word: string;
  reading: string;
  meaning: string;
  sentence: string;
  extra: string;
  image: string; // base64 data URL, or '' for none
}

/** Series/volume identity for tagging and the image filename. */
export interface CardMeta {
  seriesTitle: string;
  volumeTitle: string;
  volumeUuid: string;
  pageIndex: number; // 0-based
}

/** Anki tags are space-delimited, so collapse whitespace to underscores and drop
 *  anything that would break the tag. Empty in → empty out (filtered by caller). */
function sanitizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, '_').replace(/"/g, '');
}

/**
 * Validate that the destination is configured enough to build a card. Returns a
 * human-readable reason to show the user, or null when good to send.
 */
export function validateCardConfig(cfg: AnkiServerSettings): string | null {
  if (!cfg.deck) return 'Choose a deck in Settings → Anki Server.';
  if (!cfg.noteType) return 'Choose a note type in Settings → Anki Server.';
  const anyMapped = Object.values(cfg.fieldMap).some((f) => f !== '') || cfg.imageField !== '';
  if (!anyMapped) {
    return 'Map at least one field to your note type in Settings → Anki Server.';
  }
  return null;
}

/**
 * Build the `POST /cards` request body from a logical card + destination config.
 *
 * - Text fields: each logical field with a mapped note field *and* a non-empty
 *   value is written; blanks are skipped so an empty `extra` doesn't overwrite.
 * - Image: appended as an `<img>` into `cfg.imageField` (the server does the tag
 *   wrapping), with a collision-safe filename (the server also dedupes).
 * - Tags: marker tag + sanitized series + volume, empties dropped.
 */
export function buildCardRequest(
  card: LogicalCard,
  cfg: AnkiServerSettings,
  meta: CardMeta
): CardRequest {
  const fields: Record<string, string> = {};
  const textPairs: [keyof typeof cfg.fieldMap, string][] = [
    ['word', card.word],
    ['reading', card.reading],
    ['meaning', card.meaning],
    ['sentence', card.sentence],
    ['extra', card.extra]
  ];
  for (const [key, value] of textPairs) {
    const target = cfg.fieldMap[key];
    if (target && value) fields[target] = value;
  }

  const images: CardRequest['images'] = [];
  if (cfg.imageField && card.image) {
    const filename = `mokuro_${meta.volumeUuid.slice(0, 8)}_p${meta.pageIndex + 1}_${Date.now()}.jpg`;
    images.push({ field: cfg.imageField, filename, data: card.image });
  }

  const tags = [cfg.markerTag, meta.seriesTitle, meta.volumeTitle]
    .map(sanitizeTag)
    .filter((t) => t !== '');

  return { deck: cfg.deck, model: cfg.noteType, fields, images, tags };
}
