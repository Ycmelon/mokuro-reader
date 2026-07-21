<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    dictPopup,
    popupStack,
    closePopup,
    activeTextBox,
    clearActiveTextBox,
    clearWordHighlight,
    popupGoBack
  } from '$lib/dictionary/lookup';
  import Definitions from './Definitions.svelte';
  import PitchAccent from './PitchAccent.svelte';
  import Star from './Star.svelte';
  import { miscSettings, settings, updateMiscSetting } from '$lib/settings';
  import { miningContext, startMining } from '$lib/anki-server/mining';
  import { openChatWithExplain } from '$lib/ai-chat/store';
  import { copyTextToClipboard, showSnackbar } from '$lib/util';
  import { Copy, MessageSquareShare, StickyNotePlus } from '@lucide/svelte';
  import type { LookupResult } from '$lib/dictionary/types';

  const MIN_POPUP_HEIGHT = 15;
  const MAX_POPUP_HEIGHT = 80;
  const MIN_POPUP_WIDTH = 360;
  const MAX_POPUP_WIDTH = 960;
  const POPUP_EDGE_MARGIN = 16;
  const KEYBOARD_RESIZE_STEP = 5;
  const KEYBOARD_WIDTH_RESIZE_STEP = 40;

  let pitchMode = $derived($miscSettings.pitchAccentDisplay ?? 'downstep');

  function pitchFor(result: LookupResult, reading: string) {
    return result.pitches.find((p) => p.reading === reading);
  }

  // The mine button only makes sense when the active protocol has a live
  // connection: a server session for 'server', a connected AnkiConnect for
  // 'ankiconnect'.
  let canMine = $derived(
    $miscSettings.ankiServerSettings.protocol === 'server'
      ? $miscSettings.ankiServerSettings.token !== ''
      : ($settings.ankiConnectSettings.connectionData?.connected ?? false)
  );

  let popupEl: HTMLElement | undefined = $state();
  let heightResizeHandleEl: HTMLElement | undefined = $state();
  let widthResizeHandleEl: HTMLElement | undefined = $state();
  let activeResize: 'height' | 'width' | null = $state(null);
  let resizePointerId: number | null = null;
  // Distance between the grab point and the popup edge being dragged, captured
  // on pointer-down so the edge tracks the finger instead of jumping to it.
  let resizeGrabOffset = 0;
  let previousBodyCursor = '';
  let previousBodyUserSelect = '';
  let popup = $derived($dictPopup);
  let canGoBack = $derived($popupStack.length > 0);
  let popupHeight = $derived($miscSettings.dictionaryPopupHeight ?? 30);
  let popupWidth = $derived($miscSettings.dictionaryPopupWidth ?? 720);
  let livePopupHeight: number | null = $state(null);
  let livePopupWidth: number | null = $state(null);
  let visiblePopupHeight = $derived(livePopupHeight ?? popupHeight);
  let visiblePopupWidth = $derived(livePopupWidth ?? popupWidth);
  let lookupContext = $derived($miningContext);

  // Japanese text uses the bundled textbook font unless the user opts out, in
  // which case it falls back to the pre-bundle stacks. Driven as CSS variables
  // on the popup so the scoped rules below stay declarative.
  let headwordFont = $derived(
    $settings.textbookFont
      ? "'UD Digi Kyokasho', 'Noto Sans JP', sans-serif"
      : "'Noto Sans JP', sans-serif"
  );
  let definitionFont = $derived(
    $settings.textbookFont
      ? "'UD Digi Kyokasho', var(--font-sans, sans-serif)"
      : 'var(--font-sans, sans-serif)'
  );

  /**
   * Staged dismiss (mobile flow):
   *  - tap inside the definition panel        → ignore
   *  - tap inside any text box                → ignore (the box handles it)
   *  - tap elsewhere while a definition is up  → close the definition only
   *  - tap elsewhere with no definition up     → hide the active text box
   */
  function handleDocumentMousedown(e: MouseEvent) {
    const target = e.target;
    if (popupEl && target instanceof Node && popupEl.contains(target)) return;
    if (target instanceof Element && target.closest('.textBox')) return;

    if (popup) {
      closePopup();
    } else if ($activeTextBox) {
      clearActiveTextBox();
      // The tapped-character highlight survives a no-match lookup as feedback
      // (closePopup never ran) — dismissing the box must take it along.
      clearWordHighlight();
    }
  }

  async function copyLookupFocus(): Promise<void> {
    if (!lookupContext?.focus) return;
    await copyTextToClipboard(lookupContext.focus);
    showSnackbar('Copied to clipboard');
  }

  function explainLookupFocus(): void {
    if (!lookupContext) return;
    const text = `${lookupContext.sentence}\n「${lookupContext.focus}」`;
    openChatWithExplain(text);
    closePopup();
  }

  function createFlashcard(): void {
    startMining();
    closePopup();
  }

  function clampPopupHeight(height: number): number {
    return Math.min(MAX_POPUP_HEIGHT, Math.max(MIN_POPUP_HEIGHT, height));
  }

  function maxPopupWidth(): number {
    if (typeof window === 'undefined') return MAX_POPUP_WIDTH;
    return Math.min(MAX_POPUP_WIDTH, Math.max(0, window.innerWidth - POPUP_EDGE_MARGIN * 2));
  }

  function clampPopupWidth(width: number): number {
    const maxWidth = maxPopupWidth();
    const minWidth = Math.min(MIN_POPUP_WIDTH, maxWidth);
    return Math.min(maxWidth, Math.max(minWidth, width));
  }

  function heightFromClientY(clientY: number): number | null {
    if (window.innerHeight <= 0) return null;
    return clampPopupHeight(((window.innerHeight - clientY) / window.innerHeight) * 100);
  }

  function widthFromClientX(clientX: number): number | null {
    if (window.innerWidth <= 0) return null;
    return clampPopupWidth((clientX - window.innerWidth / 2) * 2);
  }

  function persistPopupHeight(height: number): void {
    const nextHeight = Number(clampPopupHeight(height).toFixed(1));
    if (nextHeight !== popupHeight) updateMiscSetting('dictionaryPopupHeight', nextHeight);
  }

  function persistPopupWidth(width: number): void {
    const nextWidth = Math.round(clampPopupWidth(width));
    if (nextWidth !== popupWidth) updateMiscSetting('dictionaryPopupWidth', nextWidth);
  }

  function setPopupHeight(height: number): void {
    persistPopupHeight(height);
  }

  function setPopupWidth(width: number): void {
    persistPopupWidth(width);
  }

  function resizeFromClientY(clientY: number): void {
    const nextHeight = heightFromClientY(clientY - resizeGrabOffset);
    if (nextHeight === null) return;
    livePopupHeight = nextHeight;
  }

  function resizeFromClientX(clientX: number): void {
    const nextWidth = widthFromClientX(clientX - resizeGrabOffset);
    if (nextWidth === null) return;
    livePopupWidth = nextWidth;
  }

  function lockResizeCursor(cursor: string): void {
    previousBodyCursor = document.body.style.cursor;
    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
  }

  function unlockResizeCursor(): void {
    document.body.style.cursor = previousBodyCursor;
    document.body.style.userSelect = previousBodyUserSelect;
  }

  function startHeightResize(event: PointerEvent): void {
    if (resizePointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    activeResize = 'height';
    resizePointerId = event.pointerId;
    livePopupHeight = popupHeight;
    // The popup grows from the bottom, so its top edge is the one being dragged.
    const topEdge = popupEl?.getBoundingClientRect().top;
    resizeGrabOffset = topEdge === undefined ? 0 : event.clientY - topEdge;
    lockResizeCursor('ns-resize');
    heightResizeHandleEl?.setPointerCapture(event.pointerId);
    resizeFromClientY(event.clientY);
  }

  function startWidthResize(event: PointerEvent): void {
    if (resizePointerId !== null) return;
    event.preventDefault();
    event.stopPropagation();
    activeResize = 'width';
    resizePointerId = event.pointerId;
    livePopupWidth = popupWidth;
    // The popup is centered, so the right edge is the one being dragged.
    const rightEdge = popupEl?.getBoundingClientRect().right;
    resizeGrabOffset = rightEdge === undefined ? 0 : event.clientX - rightEdge;
    lockResizeCursor('ew-resize');
    widthResizeHandleEl?.setPointerCapture(event.pointerId);
    resizeFromClientX(event.clientX);
  }

  function handleResizeMove(event: PointerEvent): void {
    if (!activeResize || event.pointerId !== resizePointerId) return;
    event.preventDefault();
    if (activeResize === 'height') {
      resizeFromClientY(event.clientY);
    } else {
      resizeFromClientX(event.clientX);
    }
  }

  function stopResize(event?: PointerEvent): void {
    if (!activeResize || (event && event.pointerId !== resizePointerId)) return;
    const finalHeight = livePopupHeight;
    const finalWidth = livePopupWidth;
    const resizeKind = activeResize;
    activeResize = null;
    resizePointerId = null;
    livePopupHeight = null;
    livePopupWidth = null;
    const handleEl = resizeKind === 'height' ? heightResizeHandleEl : widthResizeHandleEl;
    if (event && handleEl?.hasPointerCapture(event.pointerId)) {
      handleEl.releasePointerCapture(event.pointerId);
    }
    unlockResizeCursor();
    if (resizeKind === 'height' && finalHeight !== null) persistPopupHeight(finalHeight);
    if (resizeKind === 'width' && finalWidth !== null) persistPopupWidth(finalWidth);
  }

  function handleHeightResizeKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPopupHeight(popupHeight + KEYBOARD_RESIZE_STEP);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPopupHeight(popupHeight - KEYBOARD_RESIZE_STEP);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      setPopupHeight(popupHeight + KEYBOARD_RESIZE_STEP * 2);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      setPopupHeight(popupHeight - KEYBOARD_RESIZE_STEP * 2);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPopupHeight(MIN_POPUP_HEIGHT);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPopupHeight(MAX_POPUP_HEIGHT);
    }
  }

  function handleWidthResizeKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPopupWidth(popupWidth + KEYBOARD_WIDTH_RESIZE_STEP);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPopupWidth(popupWidth - KEYBOARD_WIDTH_RESIZE_STEP);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      setPopupWidth(popupWidth + KEYBOARD_WIDTH_RESIZE_STEP * 2);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      setPopupWidth(popupWidth - KEYBOARD_WIDTH_RESIZE_STEP * 2);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPopupWidth(MIN_POPUP_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPopupWidth(MAX_POPUP_WIDTH);
    }
  }

  onDestroy(() => {
    stopResize();
  });

  // Escape is handled by the reader's capture-phase coordinator
  // (Reader.svelte handleEscapeCapture), which layers this popup against the
  // other reader overlays and the layout's global back-navigation.
</script>

<svelte:document onmousedown={handleDocumentMousedown} />

{#if popup}
  <div
    bind:this={popupEl}
    class="dict-popup"
    class:resizing={activeResize !== null}
    style:height="{visiblePopupHeight}vh"
    style:--dict-popup-width={`${visiblePopupWidth}px`}
    style:--dict-headword-font={headwordFont}
    style:--dict-definition-font={definitionFont}
    role="dialog"
    aria-label="Dictionary lookup"
    tabindex="-1"
  >
    <div
      bind:this={heightResizeHandleEl}
      class="dict-resize-handle dict-height-resize-handle"
      role="slider"
      tabindex="0"
      aria-label="Resize dictionary popup height"
      aria-orientation="vertical"
      aria-valuemin={MIN_POPUP_HEIGHT}
      aria-valuemax={MAX_POPUP_HEIGHT}
      aria-valuenow={visiblePopupHeight}
      aria-valuetext={`${visiblePopupHeight.toFixed(1)}% of screen`}
      onpointerdown={startHeightResize}
      onpointermove={handleResizeMove}
      onpointerup={stopResize}
      onpointercancel={stopResize}
      onlostpointercapture={() => stopResize()}
      onkeydown={handleHeightResizeKeydown}
    ></div>

    <div
      bind:this={widthResizeHandleEl}
      class="dict-resize-handle dict-width-resize-handle"
      role="slider"
      tabindex="0"
      aria-label="Resize dictionary popup width"
      aria-orientation="horizontal"
      aria-valuemin={MIN_POPUP_WIDTH}
      aria-valuemax={maxPopupWidth()}
      aria-valuenow={visiblePopupWidth}
      aria-valuetext={`${Math.round(visiblePopupWidth)} pixels wide`}
      onpointerdown={startWidthResize}
      onpointermove={handleResizeMove}
      onpointerup={stopResize}
      onpointercancel={stopResize}
      onlostpointercapture={() => stopResize()}
      onkeydown={handleWidthResizeKeydown}
    ></div>

    <div class="dict-popup-content">
      {#if canGoBack}
        <button class="dict-back" aria-label="Back" onclick={popupGoBack}>‹ Back</button>
      {/if}
      {#each popup.results as result}
        <!-- Search-only forms (JMdict sK/sk) are lookup aliases only; they stay in
             the term's keys index but are never displayed. -->
        {@const writings = result.writings.filter((w) => !w.hidden)}
        {@const readings = result.readings.filter((r) => !r.hidden)}
        <!-- A word marked 'uk' (usually written in kana) has a kana form that is a
             real spelling, not just a reading gloss — render it at the kanji size.
             Without 'uk', the kana only supplies the reading and stays small. -->
        {@const usuallyKana =
          writings.length > 0 && result.senses.some((s) => s.misc.includes('uk'))}
        <div class="dict-entry">
          <div class="dict-headword">
            {#if writings.length > 0}
              <span class="dict-kanji"
                >{#each writings as w, i}<span class="dict-headword-item"
                    ><span class="dict-writing" class:obscure={w.obscure}
                      >{w.text}{#if w.priority}<Star />{/if}</span
                    >{#if i < writings.length - 1}<span class="dict-sep">、</span>{/if}</span
                  >{/each}</span
              >
            {/if}

            <span
              class="dict-reading"
              class:kana-headword={writings.length === 0}
              class:usually-kana={usuallyKana}
              >{#each readings as r, i}{@const pitch =
                  pitchMode !== 'none' ? pitchFor(result, r.text) : undefined}<span
                  class="dict-headword-item"
                  ><span class="dict-reading-item" class:obscure={r.obscure}
                    >{#if pitch}<PitchAccent
                        reading={r.text}
                        position={pitch.positions[0]}
                        mode={pitchMode === 'binary' ? 'binary' : 'downstep'}
                      />{:else}{r.text}{/if}{#if r.priority}<Star />{/if}</span
                  >{#if i < readings.length - 1}<span class="dict-sep">、</span>{/if}</span
                >{/each}</span
            >

            {#if result.inflectionPath.length > 0}
              <span class="dict-inflection">({result.inflectionPath.join(' › ')})</span>
            {/if}
          </div>

          <div class="dict-senses">
            <Definitions senses={result.senses} />
          </div>
        </div>
      {/each}

      {#if popup.results.length === 0}
        <p class="dict-no-results">No results</p>
      {/if}
    </div>

    {#if lookupContext}
      <div class="dict-actions" style:bottom="calc({visiblePopupHeight}vh + 8px)">
        <button
          class="dict-action"
          onclick={copyLookupFocus}
          disabled={!lookupContext.focus}
          aria-label="Copy selection"
          title="Copy"
        >
          <Copy class="h-5 w-5" />
        </button>
        <button
          class="dict-action"
          onclick={explainLookupFocus}
          disabled={!lookupContext.sentence || !lookupContext.focus}
          aria-label="Explain selection"
          title="Explain"
        >
          <MessageSquareShare class="h-5 w-5" />
        </button>
        <button
          class="dict-action"
          onclick={createFlashcard}
          disabled={!canMine}
          aria-label="Create flashcard"
          title="Create flashcard"
        >
          <StickyNotePlus class="h-5 w-5" />
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .dict-popup {
    position: fixed;
    --dict-popup-visible-width: min(var(--dict-popup-width, 720px), calc(100vw - 32px));

    left: max(16px, calc(50vw - var(--dict-popup-visible-width) / 2));
    right: auto;
    bottom: 0;
    width: var(--dict-popup-visible-width);
    height: 30vh;
    z-index: 1000;
    background: var(--color-gray-800);
    color: var(--color-gray-50);
    border: 1px solid var(--color-gray-700);
    border-bottom: none;
    border-radius: 1rem 1rem 0 0;
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    font-size: 14px;
    line-height: 1.5;
  }

  .dict-popup.resizing {
    user-select: none;
  }

  .dict-popup-content {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .dict-resize-handle {
    position: absolute;
    z-index: 2;
    touch-action: none;
  }

  .dict-height-resize-handle {
    top: 0;
    left: 50%;
    width: 76px;
    height: 14px;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .dict-width-resize-handle {
    top: 50%;
    right: 0;
    width: 14px;
    height: 76px;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .dict-height-resize-handle::before {
    content: '';
    position: absolute;
    top: 4px;
    left: 50%;
    width: 44px;
    height: 4px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: var(--color-gray-500);
    opacity: 0.85;
  }

  .dict-width-resize-handle::before {
    content: '';
    position: absolute;
    top: 50%;
    right: 4px;
    width: 4px;
    height: 44px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--color-gray-500);
    opacity: 0.85;
  }

  .dict-resize-handle:hover::before,
  .dict-resize-handle:focus-visible::before,
  .dict-popup.resizing .dict-resize-handle::before {
    background: var(--color-gray-300);
    opacity: 1;
  }

  .dict-resize-handle:focus-visible {
    outline: 2px solid var(--color-gray-300);
    outline-offset: -2px;
  }

  .dict-back {
    position: sticky;
    top: 0;
    float: left;
    margin: 6px 0 0 8px;
    padding: 0 10px;
    height: 28px;
    border: none;
    border-radius: 14px;
    background: var(--color-gray-700);
    color: var(--color-gray-300);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    z-index: 1;
  }

  .dict-back:hover {
    background: var(--color-gray-600);
  }

  .dict-actions {
    position: fixed;
    left: max(12px, calc(50vw - var(--dict-popup-visible-width) / 2 + 12px));
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 1001;
  }

  .dict-action {
    display: flex;
    width: 40px;
    height: 40px;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 999px;
    background: var(--color-gray-600);
    color: var(--color-gray-50);
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
  }

  .dict-action:hover {
    background: var(--color-gray-500);
  }

  .dict-action:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .dict-action:disabled:hover {
    background: var(--color-gray-600);
  }

  .dict-entry {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-gray-700);
  }

  .dict-entry:last-child {
    border-bottom: none;
  }

  /* Each reading is its own flex item: rows may break between readings, but not
     inside one. The kanji owns the visual gap so wrapped readings start flush. */
  .dict-headword {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    row-gap: 0;
    margin-bottom: 4px;
    font-family: var(--dict-headword-font, 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif);
    overflow-wrap: normal;
    word-break: keep-all;
  }

  .dict-headword-item,
  .dict-inflection {
    display: inline-block;
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
  }

  .dict-kanji,
  .dict-inflection {
    min-width: 0;
    max-width: 100%;
  }

  /* Kanji headwords: the primary word, in the popup's default (near-white) text
     colour so the first line stays uncluttered. */
  .dict-kanji {
    font-size: 20px;
    line-height: 30px;
    margin-right: 16px;
    color: var(--color-gray-50);
  }

  /* Readings sit quietly in grey beside the word — this is the "reading only"
     case, where the kana just tells you how to pronounce the kanji. */
  .dict-reading {
    display: contents;
    font-size: 18px;
    line-height: 30px;
    color: var(--color-gray-400);
  }

  .dict-reading .dict-headword-item:last-child {
    margin-right: 16px;
  }

  /* A kana-only headword is the primary word; a 'uk' (usually-kana) word has a
     kanji form but is genuinely written in kana. Both are real spellings, so
     they take the near-white colour and the same size as the kanji headword. */
  .dict-reading.kana-headword,
  .dict-reading.usually-kana {
    font-size: 20px;
    color: var(--color-gray-50);
  }

  /* Rare/old/irregular forms are de-emphasized so the standard form reads first. */
  .dict-writing.obscure,
  .dict-reading-item.obscure {
    opacity: 0.55;
  }

  .dict-sep {
    opacity: 0.6;
  }

  /* Deinflection trace — quiet grey, no italics. */
  .dict-inflection {
    font-size: 12px;
    line-height: 16px;
    padding-bottom: 4px;
    color: var(--color-gray-400);
    font-family: var(--dict-definition-font, 'UD Digi Kyokasho', var(--font-sans, sans-serif));
  }

  .dict-senses {
    font-size: 13px;
    /* Japanese text in glosses and notes uses the textbook font (restricted to
       Japanese codepoints via unicode-range in app.css); English glosses fall
       through to the app's default font. */
    font-family: var(--dict-definition-font, 'UD Digi Kyokasho', var(--font-sans, sans-serif));
  }

  .dict-no-results {
    padding: 12px 14px;
    color: var(--color-gray-400);
    font-style: italic;
    margin: 0;
  }

  @media (max-width: 640px) {
    .dict-popup {
      left: 0;
      right: 0;
      width: 100vw;
      max-width: none;
      border-right: none;
      border-left: none;
    }

    .dict-width-resize-handle {
      display: none;
    }

    .dict-actions {
      left: 12px;
    }
  }
</style>
