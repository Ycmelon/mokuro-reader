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
import type { TextSelectionEntry } from '$lib/reader/text-selection';

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
  /** Text boxes that supplied the sentence, used to preselect them when the
   *  sentence is reselected from the review dialog. */
  sentenceSelection?: TextSelectionEntry[];
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
  sentenceSelection?: TextSelectionEntry[];
}

export type MiningStage =
  | { kind: 'idle' }
  | { kind: 'crop'; draft: MiningDraft; ctx: MiningContext }
  | { kind: 'review'; draft: MiningDraft; ctx: MiningContext };

export const miningContext = writable<MiningContext | null>(null);
export const miningStage = writable<MiningStage>({ kind: 'idle' });
export const sentenceReselecting = writable(false);
export const sentenceReselected = writable<{
  sentence: string;
  selection: TextSelectionEntry[];
  nonce: number;
} | null>(null);

let sentenceReselectNonce = 0;

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
    draft: {
      sentence: ctx.sentence,
      focus: ctx.focus,
      image: null,
      sentenceSelection: ctx.sentenceSelection
    },
    ctx
  });
}

export function startMiningSentenceOnly(): void {
  const ctx = get(miningContext);
  if (!ctx) return;
  miningStage.set({
    kind: 'crop',
    draft: {
      sentence: ctx.sentence,
      focus: '',
      image: null,
      sentenceSelection: ctx.sentenceSelection
    },
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

export function beginSentenceReselect(): void {
  sentenceReselecting.set(true);
}

export function finishSentenceReselect(sentence: string, selection: TextSelectionEntry[]): void {
  sentenceReselected.set({ sentence, selection, nonce: ++sentenceReselectNonce });
  sentenceReselecting.set(false);
}

export function cancelSentenceReselect(): void {
  sentenceReselecting.set(false);
}

/** Abort the flow entirely. */
export function cancelMining(): void {
  sentenceReselecting.set(false);
  miningStage.set({ kind: 'idle' });
}

/**
 * Pure screen→image crop math: intersect an on-screen crop rectangle with the
 * page's on-screen box and scale into image pixels. The page container is sized
 * to the image's natural dimensions and painted with `background-size: contain`,
 * so one uniform scale maps its rect to image pixels — no zoom/pan knowledge
 * needed. Returns null when the crop misses the page entirely.
 */
export function screenRectToImageCrop(
  screenRect: { left: number; top: number; width: number; height: number },
  pageBox: { left: number; top: number; width: number },
  img_width: number,
  img_height: number
): { x: number; y: number; width: number; height: number } | null {
  const scale = img_width / pageBox.width;
  const x = clamp((screenRect.left - pageBox.left) * scale, 0, img_width);
  const y = clamp((screenRect.top - pageBox.top) * scale, 0, img_height);
  const right = clamp((screenRect.left + screenRect.width - pageBox.left) * scale, 0, img_width);
  const bottom = clamp((screenRect.top + screenRect.height - pageBox.top) * scale, 0, img_height);
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

/**
 * Convert an on-screen crop rectangle to image-pixel coordinates, produce the
 * cropped JPEG (base64), and advance to the review stage.
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
  const crop = screenRectToImageCrop(screenRect, box, img_width, img_height);
  if (!crop) {
    showSnackbar('Error: the crop box is outside the page');
    return;
  }

  const url = extractPageImageUrl(pageEl);
  if (!url) {
    showSnackbar('Error: could not read page image');
    return;
  }

  let image: string | null | undefined;
  try {
    image = await getCroppedImg(url, crop);
  } catch {
    showSnackbar('Error: could not crop the page image');
    return;
  }
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
