/**
 * Client-side "mine a card" capture flow.
 *
 * A dictionary entry's mine button starts a small state machine:
 *   idle → crop (draw a box on the page) → review (edit fields) → idle
 *
 * This module owns only the flow state and the screen→image-pixel crop math;
 * the actual HTTP send lives in `client.ts` (not wired yet — the review dialog
 * stubs it). Kept separate from `client.ts` so that stays a pure API wrapper.
 */

import { get, writable } from 'svelte/store';
import type { Page } from '$lib/types';
import { clamp, showSnackbar } from '$lib/util';
import { getCroppedImg } from '$lib/anki-connect';
import { extractPageImageUrl } from '$lib/reader/page-image';

/** Context captured at lookup time so a later mine action knows the sentence and
 *  which on-screen page to crop. Set by TextBoxes on every successful lookup. */
export interface MiningContext {
  /** The whole tapped text box as one string (all OCR lines joined). */
  sentence: string;
  /** The focus word as written in the sentence (the matched span), not the
   *  dictionary headword — so e.g. 大外れ stays 大外れ, not 大ハズレ. */
  focus: string;
  page: Page;
  /** 0-based page index within the volume. */
  pageIndex: number;
  volumeUuid: string;
  /** Series/volume titles, used to tag the mined card. */
  seriesTitle: string;
  volumeTitle: string;
  /** Resolves the live `[data-page-index]` container so crop coords are read
   *  against its current on-screen rect (zoom/pan independent). */
  getPageEl: () => HTMLElement | null;
}

/** A crop rectangle in viewport (screen) coordinates. */
export interface CropRect {
  l: number;
  t: number;
  w: number;
  h: number;
}

/** The in-progress card. Text is editable in the review dialog; `image` is the
 *  base64 data URL produced by cropping (null until the crop stage completes);
 *  `cropRect` remembers the last crop box so "Redo crop" restores it. */
export interface MiningDraft {
  sentence: string;
  focus: string;
  image: string | null;
  cropRect?: CropRect | null;
}

export type MiningStage =
  | { kind: 'idle' }
  | { kind: 'crop'; draft: MiningDraft; ctx: MiningContext }
  | { kind: 'review'; draft: MiningDraft; ctx: MiningContext };

export const miningContext = writable<MiningContext | null>(null);
export const miningStage = writable<MiningStage>({ kind: 'idle' });

export function setMiningContext(ctx: MiningContext | null): void {
  miningContext.set(ctx);
}

/**
 * Begin mining the tapped word. The focus is the surface form as written in the
 * sentence (from the lookup context), which the review dialog leaves editable.
 * No-op if there's no context (nothing to mine).
 */
export function startMining(): void {
  const ctx = get(miningContext);
  if (!ctx) return;
  miningStage.set({
    kind: 'crop',
    draft: { sentence: ctx.sentence, focus: ctx.focus, image: null },
    ctx
  });
}

/** Return to the crop stage from review, keeping the current text edits and
 *  carrying the previous crop box back so the overlay restores it for tweaking. */
export function reopenCrop(draft: MiningDraft): void {
  const stage = get(miningStage);
  if (stage.kind !== 'review') return;
  miningStage.set({
    kind: 'crop',
    draft: { ...draft, cropRect: stage.draft.cropRect },
    ctx: stage.ctx
  });
}

/** Abort the flow entirely. */
export function cancelMining(): void {
  miningStage.set({ kind: 'idle' });
}

/**
 * Convert an on-screen crop rectangle to image-pixel coordinates, produce the
 * cropped JPEG (base64), and advance to the review stage.
 *
 * The page container is sized to the image's natural pixel dimensions and painted
 * with `background-size: contain`, so its on-screen rect maps to image pixels by a
 * single uniform scale — no zoom/pan knowledge needed here.
 */
export async function finishCrop(screenRect: DOMRect): Promise<void> {
  const stage = get(miningStage);
  if (stage.kind !== 'crop') return;

  const { ctx, draft } = stage;
  const pageEl = ctx.getPageEl();
  if (!pageEl) {
    showSnackbar('Error: could not locate the page to crop');
    return;
  }

  const box = pageEl.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) {
    showSnackbar('Error: page not visible');
    return;
  }

  const { img_width, img_height } = ctx.page;
  const scale = img_width / box.width;

  const x = clamp((screenRect.left - box.left) * scale, 0, img_width);
  const y = clamp((screenRect.top - box.top) * scale, 0, img_height);
  const width = clamp(screenRect.width * scale, 1, img_width - x);
  const height = clamp(screenRect.height * scale, 1, img_height - y);

  const url = extractPageImageUrl(pageEl);
  if (!url) {
    showSnackbar('Error: could not read page image');
    return;
  }

  const image = await getCroppedImg(url, { x, y, width, height });
  if (!image) {
    // getCroppedImg already surfaces its own failure snackbar.
    return;
  }

  const cropRect: CropRect = {
    l: screenRect.left,
    t: screenRect.top,
    w: screenRect.width,
    h: screenRect.height
  };
  miningStage.set({ kind: 'review', draft: { ...draft, image, cropRect }, ctx });
}
