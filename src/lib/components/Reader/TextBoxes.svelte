<script lang="ts">
  import { clamp } from '$lib/util';
  import { selection, selectMode, toggleSelection } from '$lib/reader/text-selection';
  import type { Page } from '$lib/types';
  import { settings, volumes, imageFilter } from '$lib/settings';
  import { expandTextBoxBounds } from '$lib/anki-connect';

  interface ContextMenuData {
    x: number;
    y: number;
    lines: string[];
    imgElement: HTMLElement | null;
    textBox?: [number, number, number, number]; // [xmin, ymin, xmax, ymax] for initial crop
    pageIndex?: number;
    boxId?: string; // Identity of the box, for seeding multi-select
  }

  interface Props {
    page: Page;
    src?: File;
    volumeUuid: string;
    /** 0-based page index within the volume */
    pageIndex?: number;
    /** Force text visibility (for placeholder/missing pages) */
    forceVisible?: boolean;
    /** Callback when context menu should be shown */
    onContextMenu?: (data: ContextMenuData) => void;
  }

  let { page, src, volumeUuid, pageIndex, forceVisible = false, onContextMenu }: Props = $props();

  interface TextBoxData {
    left: string;
    top: string;
    width: string;
    height: string;
    fontSize: string;
    writingMode: string;
    lines: string[];
    area: number;
    useMinDimensions: boolean;
    isOriginalMode: boolean;
    blockIndex: number; // Original index in page.blocks
    /** True for vertical (top-to-bottom) text — columns get spread to fill the
     *  box width after font sizing. */
    vertical: boolean;
  }

  let textBoxes = $derived(
    page.blocks
      .map((block, blockIndex) => {
        const { img_height, img_width } = page;
        const { box, font_size, lines, vertical } = block;

        let [_xmin, _ymin, _xmax, _ymax] = box;

        // Only expand bounding boxes when using auto font sizing
        // Manual font sizes should use exact OCR bounding boxes
        let xmin, ymin, xmax, ymax;

        if ($settings.fontSize === 'auto') {
          // Expand bounding box by 10% (5% on each side) to give text more room
          const originalWidth = _xmax - _xmin;
          const originalHeight = _ymax - _ymin;
          const expansionX = originalWidth * 0.05;
          const expansionY = originalHeight * 0.05;

          xmin = clamp(_xmin - expansionX, 0, img_width);
          ymin = clamp(_ymin - expansionY, 0, img_height);
          xmax = clamp(_xmax + expansionX, 0, img_width);
          ymax = clamp(_ymax + expansionY, 0, img_height);
        } else {
          // Use exact OCR bounding boxes for manual font sizes
          xmin = _xmin;
          ymin = _ymin;
          xmax = _xmax;
          ymax = _ymax;
        }

        const width = xmax - xmin;
        const height = ymax - ymin;
        const area = width * height;

        // Replace manual ellipsis with proper ellipsis character (…)
        // Handle both ASCII periods (...) and full-width periods (．．．)
        const processedLines = lines.map((line) =>
          line.replace(/\.\.\./g, '…').replace(/．．．/g, '…')
        );

        // Determine font size based on setting
        let fontSize: string;
        if ($settings.fontSize === 'auto' || $settings.fontSize === 'original') {
          fontSize = `${font_size}px`;
        } else {
          fontSize = `${$settings.fontSize}pt`;
        }

        const isOriginalMode = $settings.fontSize === 'original';

        const textBox: TextBoxData = {
          left: `${xmin}px`,
          top: `${ymin}px`,
          width: `${width}px`,
          height: `${height}px`,
          fontSize,
          writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
          lines: processedLines,
          area,
          useMinDimensions: $settings.fontSize !== 'auto' && !isOriginalMode,
          isOriginalMode,
          blockIndex,
          vertical
        };

        return textBox;
      })
      .sort(({ area: a }, { area: b }) => {
        return b - a;
      })
  );

  let fontWeight = $derived($settings.boldFont ? 'bold' : '400');
  // Japanese OCR text uses the bundled textbook font unless the user opts out,
  // in which case it falls back to the pre-bundle 'Noto Sans JP' stack. Applied
  // inline on each .textBox so the inner <p> inherits it (see `.textBox p`).
  let ocrFontFamily = $derived(
    $settings.textbookFont
      ? "'UD Digi Kyokasho', 'Noto Sans JP', sans-serif"
      : "'Noto Sans JP', sans-serif"
  );
  // Hide OCR boxes entirely while the crop tool is up: they'd sit uselessly under
  // the overlay, and dropping those layers cuts compositing work during dragging.
  let display = $derived(
    $miningStage.kind === 'crop' ? 'none' : $settings.displayOCR ? 'block' : 'none'
  );
  let alwaysShowOCR = $derived($settings.alwaysShowOCR);
  let border = $derived($settings.textBoxBorders ? '1px solid red' : 'none');
  let contenteditable = $derived($settings.textEditable);

  // Every sizing input the measurement pipeline bakes into a box's final
  // geometry. When any of these change, the {#each} key below recreates the
  // DOM (wiping the imperatively-set font-size/white-space/line-height) and
  // `measured` hands out fresh containers, so each box re-measures against the
  // new metrics on its next hover/touch instead of keeping stale results.
  let sizingEpoch = $derived(
    `${$settings.fontSize}|${$settings.textbookFont}|${$settings.boldFont}|${$settings.spreadVerticalText}`
  );
  // Per-box measurement results. The containers are mutated (not reassigned)
  // by the measurement code — mutation isn't reactive, but the final styles
  // are also applied imperatively, and the reactive `style:font-size` read in
  // the template picks the stored value up on any later re-render (e.g. a
  // selection change) instead of clobbering a measured box back to its
  // original size.
  let measured = $derived.by(() => {
    sizingEpoch;
    return {
      fontSizes: new Map<number, string>(),
      processed: new Set<number>()
    };
  });

  // Calculate optimal font size for a textbox using binary search
  // Two-phase approach: scale up until overflow, then find the goldilocks size
  function calculateOptimalFontSize(element: HTMLDivElement, initialFontSize: string) {
    // Parse the initial font size to get numeric value
    const match = initialFontSize.match(/(\d+(?:\.\d+)?)(px|pt)/);
    if (!match) return null;

    // Overflow is judged from the text paragraph alone, never the box's own
    // scroll metrics: the box also hosts absolutely-positioned chrome (the
    // multi-select order badge at top/left −10px), and in vertical-rl writing
    // mode negative-offset children count as scrollable overflow — measuring
    // the box would see permanent overflow and binary-search every selected
    // vertical box down to the minimum font size.
    const p = element.querySelector<HTMLParagraphElement>('p');
    if (!p) return null;

    const originalSize = parseFloat(match[1]);
    const unit = match[2];
    const minFontSize = 8; // Minimum font size in px
    const maxFontSize = 200; // Maximum font size to try when scaling up

    // Convert to px for consistent handling, rounding to integer
    // Integer font sizes ensure the binary search always makes progress
    let originalInPx = Math.round(unit === 'pt' ? originalSize * 1.333 : originalSize);

    // Guard against invalid font sizes that would cause infinite loops
    // (0, negative, NaN, or Infinity would break the binary search)
    if (!Number.isFinite(originalInPx) || originalInPx < minFontSize) {
      originalInPx = minFontSize;
    }

    // Check if the text overflows the box at a given font size. offsetWidth/
    // offsetHeight catch the paragraph's auto (content-sized) axis growing past
    // the box — its block axis: width in vertical-rl, height in horizontal —
    // while scrollWidth/scrollHeight catch inline overflow (nowrap text running
    // past the paragraph's own bounds).
    const isOverflowingAt = (size: number) => {
      element.style.fontSize = `${size}px`;
      return (
        Math.max(p.offsetWidth, p.scrollWidth) > element.clientWidth ||
        Math.max(p.offsetHeight, p.scrollHeight) > element.clientHeight
      );
    };

    // Binary search to find the largest font size that fits
    // Searches between low (fits) and high (overflows or max)
    const findOptimalSize = () => {
      // Phase 1: Find upper bound by scaling up until overflow
      let low = minFontSize;
      let high = originalInPx;

      // If original fits, try scaling up to find the true max
      if (!isOverflowingAt(originalInPx)) {
        // Double until we overflow or hit max
        high = originalInPx;
        while (!isOverflowingAt(high) && high < maxFontSize) {
          low = high;
          high = Math.min(high * 2, maxFontSize);
        }
        // If we're at max and still not overflowing, use max
        if (!isOverflowingAt(high)) {
          return high;
        }
      } else {
        // Original overflows, check if min fits
        if (isOverflowingAt(minFontSize)) {
          return minFontSize;
        }
        low = minFontSize;
        high = originalInPx;
      }

      // Phase 2: Binary search between low (fits) and high (overflows)
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (isOverflowingAt(mid)) {
          high = mid;
        } else {
          low = mid;
        }
      }

      return low;
    };

    // Step 1: Find optimal size without wrapping
    element.style.whiteSpace = 'nowrap';
    element.style.wordWrap = 'normal';
    element.style.overflowWrap = 'normal';
    const noWrapSize = findOptimalSize();

    // Step 2: Only try wrapping if it could give us 1.3x the font size
    // Quick check: would 1.3x the noWrapSize overflow with wrapping?
    element.style.whiteSpace = 'normal';
    element.style.wordWrap = 'break-word';
    element.style.overflowWrap = 'break-word';

    const thresholdSize = noWrapSize * 1.3;
    if (!isOverflowingAt(thresholdSize)) {
      // Wrapping allows at least 1.3x - search for the actual optimal wrap size
      const wrapSize = findOptimalSize();
      return {
        finalSize: wrapSize,
        useWrapping: true,
        originalInPx
      };
    }

    // Wrapping doesn't help enough, use nowrap
    return {
      finalSize: noWrapSize,
      useWrapping: false,
      originalInPx
    };
  }

  // Spread vertical text columns across the box's full width.
  //
  // Runs AFTER the font has been sized against natural (1.1em) spacing, so the
  // chosen size is unchanged — this only redistributes the horizontal slack
  // that otherwise leaves the columns hugging the right edge. line-height is
  // the column advance in vertical writing modes, but glyphs sit centered in
  // their advance band (half-leading), so plainly widening it shifts the first
  // column away from the right edge by half the added leading. Instead the
  // columns are justified: the advance L solves
  //     (N-1)·L + natural = boxWidth
  // and a negative block-start margin of (L - natural)/2 cancels the first
  // band's half-leading — the first column hugs the right edge, the last hugs
  // the left, and the gaps in between are equal. Only ever widens, never
  // compresses.
  function fillVerticalColumns(element: HTMLDivElement) {
    const p = element.querySelector<HTMLParagraphElement>('p');
    if (!p) return;

    // Reset any previous spread so the natural geometry is measured.
    p.style.lineHeight = '';
    p.style.marginRight = '';
    const contentWidth = p.offsetWidth; // block axis (horizontal) = columns' span
    const boxWidth = element.clientWidth;
    if (contentWidth <= 0 || boxWidth <= contentWidth) return;

    // Read the natural column advance straight off the (just-reset) element
    // instead of recomputing it, so this stays in sync with the CSS
    // line-height rather than duplicating its `1.1em` as a magic number.
    const natural = parseFloat(getComputedStyle(p).lineHeight);
    if (!Number.isFinite(natural) || natural <= 0) return;

    // Column count from the measured extent (so wrapped columns are handled),
    // not the line count. A single column has no gaps to distribute — leave
    // it at its natural position rather than centering it in the box.
    const columns = Math.round(contentWidth / natural);
    if (columns <= 1) return;

    // Cap the advance so a badly over-sized OCR box can't scatter the columns
    // into unreadable sparseness; with the cap active the columns simply stop
    // short of the left edge.
    const advance = Math.min((boxWidth - natural) / (columns - 1), natural * 2.5);
    if (advance <= natural) return;

    p.style.lineHeight = `${advance}px`;
    p.style.marginRight = `${-(advance - natural) / 2}px`;
  }

  // Handle hover event to calculate resize on demand (only for auto font sizing)
  function handleTextBoxHover(element: HTMLDivElement, params: [number, string, boolean]) {
    const [index, initialFontSize, vertical] = params;

    const calculate = async () => {
      // Skip if already processed, OCR is hidden, or using manual font size
      if (measured.processed.has(index) || display !== 'block' || $settings.fontSize !== 'auto')
        return;

      // Mark as processed immediately to prevent duplicate calculations
      measured.processed.add(index);

      // The OCR font (`app.css` @font-face) uses `font-display: swap`, so text
      // is laid out with a FALLBACK font until the self-hosted woff2 finishes
      // downloading. If we measure a box during that window, the binary search
      // fits text using fallback metrics and locks in a wrong (often too small)
      // size — and which boxes are affected is random per session, depending on
      // what you touch before the font loads. Wait for the real font to be
      // ready for this box's glyphs before measuring so geometry is stable.
      try {
        const text = element.querySelector('p')?.textContent ?? '';
        const family = $settings.textbookFont ? 'UD Digi Kyokasho' : 'Noto Sans JP';
        if (text && document.fonts?.load) {
          await document.fonts.load(`16px "${family}"`, text);
        }
      } catch {
        // Fall through and measure with whatever font is currently available.
      }

      // Use requestAnimationFrame to ensure the DOM is fully rendered
      requestAnimationFrame(() => {
        // The box can be unmounted while the font-load above was awaited (page
        // turn, or a sizing-setting change recreating the DOM). Measuring a
        // detached element reads 0×0 and would lock in a garbage size.
        if (!element.isConnected) return;
        const result = calculateOptimalFontSize(element, initialFontSize);
        if (!result) return;

        const { finalSize, useWrapping } = result;

        // Apply final settings
        if (useWrapping) {
          element.style.whiteSpace = 'normal';
          element.style.wordWrap = 'break-word';
          element.style.overflowWrap = 'break-word';
        } else {
          element.style.whiteSpace = 'nowrap';
          element.style.wordWrap = 'normal';
          element.style.overflowWrap = 'normal';
        }

        element.style.fontSize = `${finalSize}px`;

        // Persist the computed size — even when the box scaled UP (finalSize
        // >= originalInPx). The imperative write above sets it now, but
        // `style:font-size={measured.fontSizes.get(index) || fontSize}` is
        // re-applied on every `{#each}` re-render (e.g. any selection change),
        // which would otherwise clobber a scaled-up box back to the original,
        // smaller `fontSize`. Storing it here keeps the reactive value in sync.
        measured.fontSizes.set(index, `${finalSize}px`);

        // Spread the columns to fill the width (font size already finalized).
        if (vertical && $settings.spreadVerticalText) fillVerticalColumns(element);
      });
    };

    element.addEventListener('mouseenter', calculate);
    // touchstart fires before long-press reveals the text box
    element.addEventListener('touchstart', calculate, { passive: true });

    return {
      destroy() {
        element.removeEventListener('mouseenter', calculate);
        element.removeEventListener('touchstart', calculate);
      }
    };
  }

  function handleContextMenu(
    event: MouseEvent,
    lines: string[],
    blockIndex: number,
    boxId: string
  ) {
    // Only show custom context menu if enabled in settings
    if (!$settings.textBoxContextMenu) return;

    event.preventDefault();

    // Get text box bounds with padding
    const block = page.blocks[blockIndex];
    const textBox = block ? expandTextBoxBounds(block, page) : undefined;

    onContextMenu?.({
      x: event.clientX,
      y: event.clientY,
      lines,
      imgElement: event.target as HTMLElement,
      textBox,
      pageIndex,
      boxId
    });
  }

  function onDoubleTap(event: Event) {
    // Text boxes are for reading/selection, never zoom targets: swallow the
    // double-tap so it doesn't bubble up to the surface's zoom gesture.
    event.stopPropagation();
  }

  import {
    findBestMatch,
    showLookup,
    closePopup,
    activeTextBox,
    setActiveTextBox,
    highlightWord
  } from '$lib/dictionary/lookup';
  import { setMiningContext, miningStage } from '$lib/anki-server/mining';

  // Devices with a real pointer (mouse) reveal text via :hover, so a single
  // click should look up immediately. Touch devices use tap-to-reveal first.
  const canHover =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // caretRangeFromPoint snaps to the nearest insertion point, so tapping the
  // trailing half of a glyph returns the offset *after* it (the next char). If
  // the click actually lands inside the previous character's box, step back so
  // we look up the glyph the user tapped, not its neighbour. Works for both
  // horizontal and vertical (manga) writing modes since it tests the real rect.
  function correctCaretOffset(textNode: Text, offset: number, x: number, y: number): number {
    const len = textNode.textContent?.length ?? 0;
    if (offset <= 0 || offset > len) return offset;

    const range = document.createRange();
    range.setStart(textNode, offset - 1);
    range.setEnd(textNode, offset);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return offset - 1;
      }
    }
    return offset;
  }

  // Monotonic tap counter: a lookup that resolves after a newer tap started
  // must not clobber the newer tap's popup/highlight/mining context.
  let lookupSeq = 0;

  async function handleTextBoxClick(event: MouseEvent, boxId: string, lines: string[]) {
    // Double-click is handled separately by ondblclick (swallowed, no lookup)
    if (event.detail > 1) return;
    // User drag-selected text — don't override their selection
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    // Any new tap invalidates a prior lookup's mining context; only a successful
    // lookup below re-establishes it (so the popup's mine button has fresh data).
    setMiningContext(null);

    // Select mode: a tap toggles this box in/out of the ordered selection
    // instead of doing a dictionary lookup. Reveal the box so it stays readable.
    if ($selectMode) {
      setActiveTextBox(boxId);
      closePopup();
      toggleSelection(boxId, lines.join(''));
      return;
    }

    // Editable-text mode: clicks place the editing caret; a lookup popup (and
    // its character highlight) fighting the caret would make editing unusable.
    if (contenteditable) return;

    // Tap-to-reveal (step 1): if this box isn't revealed yet, the first tap
    // only shows its text — no lookup. Hover-capable devices skip this step,
    // as do boxes whose text is already permanently visible (always-show OCR,
    // placeholder pages).
    const revealed = canHover || alwaysShowOCR || forceVisible || $activeTextBox === boxId;
    if (!revealed) {
      setActiveTextBox(boxId);
      closePopup();
      return;
    }

    // Keep this box marked active so it stays revealed after the tap.
    setActiveTextBox(boxId);

    const caretRange = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!caretRange || caretRange.startContainer.nodeType !== Node.TEXT_NODE) {
      closePopup();
      return;
    }

    const textNode = caretRange.startContainer as Text;
    const offset = correctCaretOffset(
      textNode,
      caretRange.startOffset,
      event.clientX,
      event.clientY
    );

    // Each OCR line is a separate text node. To recognise words that wrap
    // across a line break (e.g. 泣いて / しまう → 泣いてしまう), scan the whole
    // text box as one continuous string and remember which node each character
    // came from, so the match can be highlighted across nodes.
    const boxEl = textNode.parentElement?.closest('.textBox');
    const segments = boxEl
      ? collectTextSegments(boxEl)
      : [{ node: textNode, start: 0, len: textNode.data.length }];
    const combined = segments.map((s) => s.node.data).join('');
    const seg = segments.find((s) => s.node === textNode);
    const combinedOffset = (seg?.start ?? 0) + offset;

    // Immediate feedback: highlight the tapped character before the (async)
    // lookup, so a tap always shows something landed — even if no word matches.
    // Extend past a surrogate pair so we never split an astral code point.
    const tappedCp = combined.codePointAt(combinedOffset);
    const tappedLen = tappedCp !== undefined && tappedCp > 0xffff ? 2 : 1;
    const tappedCharRanges = rangesForSpan(segments, combinedOffset, combinedOffset + tappedLen);
    highlightWord(tappedCharRanges);

    const seq = ++lookupSeq;
    const match = await findBestMatch(combined, combinedOffset);
    // Superseded while in flight — by a newer tap in this box (seq), a tap in
    // another box, or a dismissal that cleared the active box. Its outcome
    // owns the popup/highlight now; drop this one.
    if (seq !== lookupSeq || $activeTextBox !== boxId) return;
    if (!match) {
      // Close any open popup but keep the tapped character highlighted as
      // feedback (closePopup clears the highlight, so re-apply it after).
      closePopup();
      highlightWord(tappedCharRanges);
      return;
    }

    // Highlight the matched word (custom highlight, not browser selection —
    // avoids native mobile selection handles / copy bubble). A word that spans
    // a line break produces one range per text node it touches.
    highlightWord(rangesForSpan(segments, combinedOffset, combinedOffset + match.utf16Length));

    showLookup(match.state);

    // Give the popup's mine button everything it needs to capture a card: the
    // full sentence (this box), the focus word as it's actually written in the
    // sentence (the matched span, not the dictionary headword), and the live
    // page container to crop against.
    setMiningContext({
      sentence: combined.trim(),
      focus: combined.slice(combinedOffset, combinedOffset + match.utf16Length),
      page,
      pageIndex: pageIndex ?? 0,
      volumeUuid,
      seriesTitle: $volumes[volumeUuid]?.series_title ?? '',
      volumeTitle: $volumes[volumeUuid]?.volume_title ?? '',
      getPageEl: () => boxEl?.closest<HTMLElement>('[data-page-index]') ?? null
    });
  }

  /** Collects the text-node segments of a text box in reading order, tracking
   *  each node's start index within the concatenated string. */
  function collectTextSegments(root: Element): { node: Text; start: number; len: number }[] {
    const segments: { node: Text; start: number; len: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      if (t.data.length === 0) continue;
      segments.push({ node: t, start: pos, len: t.data.length });
      pos += t.data.length;
    }
    return segments;
  }

  /** Maps a [from, to) range in the concatenated string to one Range per
   *  text-node segment it overlaps. */
  function rangesForSpan(
    segments: { node: Text; start: number; len: number }[],
    from: number,
    to: number
  ): Range[] {
    const ranges: Range[] = [];
    for (const seg of segments) {
      const s = Math.max(from, seg.start);
      const e = Math.min(to, seg.start + seg.len);
      if (e > s) {
        const r = document.createRange();
        r.setStart(seg.node, s - seg.start);
        r.setEnd(seg.node, e - seg.start);
        ranges.push(r);
      }
    }
    return ranges;
  }

  function onCopy(event: ClipboardEvent) {
    // Strip line breaks from copied text (Ctrl+C default behavior)
    const selection = window.getSelection()?.toString() || '';
    const stripped = selection.replace(/[\n\r\t]/g, '');
    event.clipboardData?.setData('text/plain', stripped);
    event.preventDefault();
  }
</script>

<!-- sizingEpoch in the key forces DOM recreation when a sizing setting changes,
     discarding the imperative font-size/white-space/line-height a previous
     measurement left inline (there's no other hook to unwind them). -->
{#each textBoxes as { fontSize, height, left, lines, top, width, writingMode, useMinDimensions, isOriginalMode, blockIndex, vertical }, index (`${volumeUuid}-textBox-${index}-${sizingEpoch}`)}
  {@const boxId = `${volumeUuid}-${pageIndex ?? 0}-${index}`}
  {@const selOrder = $selection.findIndex((e) => e.id === boxId) + 1}
  {@const isSelected = selOrder > 0}
  <div
    use:handleTextBoxHover={[index, fontSize, vertical]}
    class="textBox"
    class:originalMode={isOriginalMode}
    class:forceVisible
    class:alwaysVisible={alwaysShowOCR}
    class:active={$activeTextBox === boxId}
    class:selected={isSelected}
    style:width={isOriginalMode ? undefined : useMinDimensions ? undefined : width}
    style:height={isOriginalMode ? undefined : useMinDimensions ? undefined : height}
    style:min-width={isOriginalMode ? undefined : useMinDimensions ? width : undefined}
    style:min-height={isOriginalMode ? undefined : useMinDimensions ? height : undefined}
    style:left
    style:top
    style:font-size={measured.fontSizes.get(index) || fontSize}
    style:font-weight={fontWeight}
    style:font-family={ocrFontFamily}
    style:display
    style:border
    style:writing-mode={writingMode}
    style:filter={$imageFilter}
    role="none"
    onclick={(e) => handleTextBoxClick(e, boxId, lines)}
    oncontextmenu={(e) => handleContextMenu(e, lines, blockIndex, boxId)}
    ondblclick={onDoubleTap}
    oncopy={onCopy}
    {contenteditable}
  >
    {#if isSelected}
      <!-- contenteditable="false" keeps the badge out of the editing flow when
           the "editable text" setting places a caret inside the box. -->
      <span class="selectBadge" contenteditable="false" aria-hidden="true">{selOrder}</span>
    {/if}
    <p>
      {#each lines as line}<span class="ocr-line">{line}</span>{/each}
    </p>
  </div>
{/each}

<style>
  .textBox {
    color: black;
    padding: 0;
    position: absolute;
    line-height: 1.1em;
    font-size: 16pt;
    font-family: 'UD Digi Kyokasho', 'Noto Sans JP', sans-serif;
    /* Word wrapping controlled dynamically by JavaScript */
    border: 1px solid rgba(0, 0, 0, 0);
    z-index: 11;
    user-select: text;
    -webkit-user-select: text;
    -moz-user-select: text;
    -ms-user-select: text;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    box-sizing: border-box;
  }

  .textBox:focus,
  .textBox:hover,
  .textBox.active {
    background: rgb(255, 255, 255);
    border: 1px solid rgba(0, 0, 0, 0);
  }

  .textBox p {
    visibility: hidden;
    /* Word wrapping controlled dynamically by JavaScript */
    letter-spacing: 0.1em;
    /* Base column advance for vertical text. After font sizing, vertical boxes
       get a wider line-height set inline (see handleTextBoxHover) so the columns
       fill the box width instead of hugging the right edge. */
    line-height: 1.1em;
    background-color: rgb(255, 255, 255);
    font-weight: var(--bold);
    /* Inherit the font set inline on .textBox (driven by the textbookFont setting). */
    font-family: inherit;
    z-index: 11;
    user-select: text;
    -webkit-user-select: text;
    -moz-user-select: text;
    -ms-user-select: text;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }

  @media (hover: none) and (pointer: coarse) {
    .textBox:not([contenteditable='true']),
    .textBox:not([contenteditable='true']) p {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }
  }

  .textBox:focus p,
  .textBox:hover p,
  .textBox.active p {
    visibility: visible;
  }

  /* Force visibility for placeholder/missing pages, or when always-show OCR is enabled */
  .textBox.forceVisible,
  .textBox.alwaysVisible {
    background: rgb(255, 255, 255);
  }

  .textBox.forceVisible p,
  .textBox.alwaysVisible p {
    visibility: visible;
  }

  /* Original mode: no size constraints, allow overflow */
  .textBox.originalMode {
    overflow: visible;
    white-space: nowrap;
  }

  .textBox.originalMode p {
    white-space: nowrap;
  }

  /* Use CSS-generated newline instead of <br/> so DOM walkers
     (Migaku/Yomitan) see one continuous text node per textbox
     and don't treat line breaks as sentence boundaries. */
  .textBox .ocr-line:not(:last-child)::after {
    content: '\A';
    white-space: pre;
  }

  /* Multi-select: a selected box reads like a revealed box (opaque background
     covering the whole box so the manga panel behind it is hidden, text shown),
     with a blue outline + order badge marking it as selected. The tint is baked
     into an OPAQUE colour (≈12% blue over white) rather than a translucent layer
     so nothing shows through the box's empty (non-text) area. */
  .textBox.selected {
    outline: 2px solid #2563eb;
    outline-offset: 1px;
    background: #e5ecfd;
  }

  .textBox.selected p {
    visibility: visible;
    background-color: #e5ecfd;
  }

  .selectBadge {
    position: absolute;
    top: -10px;
    left: -10px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: #2563eb;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    /* Keep the badge upright inside vertical (vertical-rl) text boxes. */
    writing-mode: horizontal-tb;
    z-index: 13;
    pointer-events: none;
  }
</style>
