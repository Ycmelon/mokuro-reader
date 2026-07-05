/**
 * Maps our logical mined card (word / reading / meaning / sentence / extra /
 * image) onto the user-configured note type via per-field *templates*, producing
 * a neutral `CardRequest` that either transport (the self-hosted server or a local
 * AnkiConnect) can send.
 *
 * Pure logic — no store or network dependency — so it's unit-testable and shared
 * by the review dialog and the protocol dispatcher (`send.ts`). The destination
 * (deck, note type, per-field templates, tags) comes from `AnkiServerSettings`;
 * the series/volume/page come from the mining context.
 */

import type { AnkiServerSettings } from '$lib/settings/misc';
import type { FieldMapping } from '$lib/settings/settings';
import type { CardRequest } from './client';

/** The logical card fields, ready to be routed onto note-type fields. */
export interface LogicalCard {
  word: string; // the focus expression
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

/** The logical variables a field/tag template can reference. `image` is handled
 *  specially (routed to the image field), not substituted as text. */
const LOGICAL_KEYS = ['word', 'reading', 'meaning', 'sentence', 'extra', 'image'] as const;

/** Anki tags are space-delimited, so collapse whitespace to underscores and drop
 *  anything that would break the tag. Empty in → empty out (filtered by caller). */
function sanitizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, '_').replace(/"/g, '');
}

/**
 * Sensible defaults for a note type's fields: fill a field's template only when
 * its name is an exact (case-insensitive) match for a logical variable — e.g. a
 * field literally named "Word" → `{word}`, "Image" → `{image}`. Everything else
 * is left blank for the user to configure.
 */
export function defaultFieldTemplates(fields: string[]): FieldMapping[] {
  return fields.map((fieldName) => {
    const key = LOGICAL_KEYS.find((k) => k === fieldName.trim().toLowerCase());
    return { fieldName, template: key ? `{${key}}` : '' };
  });
}

/** Escape HTML-special characters in a substituted value. Anki fields are HTML,
 *  so a literal `<` in OCR/AI text would otherwise be parsed as markup. Only the
 *  values are escaped — markup the user writes in the template stays intact. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Resolve a field template against the mined card. Text variables are
 * substituted (HTML-escaped); `{image}` is stripped (the image is attached
 * separately). Newlines become `<br>` for Anki. Returns the resolved text
 * (may be '').
 */
export function resolveMinedTemplate(template: string, card: LogicalCard, meta: CardMeta): string {
  const resolved = template
    .replace(/\{word\}/g, escapeHtml(card.word ?? ''))
    .replace(/\{reading\}/g, escapeHtml(card.reading ?? ''))
    .replace(/\{meaning\}/g, escapeHtml(card.meaning ?? ''))
    .replace(/\{sentence\}/g, escapeHtml(card.sentence ?? ''))
    .replace(/\{extra\}/g, escapeHtml(card.extra ?? ''))
    .replace(/\{series\}/g, escapeHtml(meta.seriesTitle ?? ''))
    .replace(/\{volume\}/g, escapeHtml(meta.volumeTitle ?? ''))
    .replace(/\{page\}/g, String(meta.pageIndex + 1))
    .replace(/\{image\}/g, ''); // image is attached separately, not text
  return resolved
    .replace(/[ \t]+/g, ' ')
    .trim()
    .replace(/\n/g, '<br>');
}

/** Resolve the tag template (series/volume sanitized as single tags) into a
 *  deduped, non-empty tag list. Any literal tags (e.g. "mokuro") pass through. */
function buildTags(cfg: AnkiServerSettings, meta: CardMeta): string[] {
  const resolved = (cfg.tagsTemplate ?? '')
    .replace(/\{series\}/g, sanitizeTag(meta.seriesTitle))
    .replace(/\{volume\}/g, sanitizeTag(meta.volumeTitle))
    .replace(/\{page\}/g, String(meta.pageIndex + 1));
  const tags = resolved
    .split(/\s+/)
    .map(sanitizeTag)
    .filter((t) => t !== '');
  return [...new Set(tags)];
}

/**
 * Validate that the destination is configured enough to build a card. Returns a
 * human-readable reason to show the user, or null when good to send.
 */
export function validateCardConfig(cfg: AnkiServerSettings): string | null {
  if (!cfg.deck) return 'Choose a deck in Settings → Anki.';
  if (!cfg.noteType) return 'Choose a note type in Settings → Anki.';
  const templates = cfg.fieldTemplates[cfg.noteType] ?? [];
  if (!templates.some((m) => m.template.trim() !== '')) {
    return 'Configure at least one field in Settings → Anki.';
  }
  return null;
}

/**
 * Build the neutral `CardRequest` from a logical card + destination config.
 *
 * - Text fields: each note field's template is resolved from the mined card;
 *   blanks are skipped so an empty field doesn't overwrite.
 * - Image: fields whose template contains `{image}` receive the cropped image
 *   (collision-safe filename; the server also dedupes). The AnkiConnect adapter
 *   turns `images` into `addNote`'s `picture` param.
 * - Tags: resolved tag template, empties/dupes dropped.
 */
export function buildCardRequest(
  card: LogicalCard,
  cfg: AnkiServerSettings,
  meta: CardMeta
): CardRequest {
  const templates = cfg.fieldTemplates[cfg.noteType] ?? [];
  const fields: Record<string, string> = {};
  const images: CardRequest['images'] = [];

  for (const { fieldName, template } of templates) {
    if (!template) continue;
    const text = resolveMinedTemplate(template, card, meta);
    if (text) fields[fieldName] = text;
    if (template.includes('{image}') && card.image) {
      const filename = `mokuro_${meta.volumeUuid.slice(0, 8)}_p${meta.pageIndex + 1}_${Date.now()}.jpg`;
      images.push({ field: fieldName, filename, data: card.image });
    }
  }

  return { deck: cfg.deck, model: cfg.noteType, fields, images, tags: buildTags(cfg, meta) };
}
