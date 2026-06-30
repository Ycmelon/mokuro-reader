<script lang="ts">
  import { clamp, promptConfirmation } from '$lib/util';
  import { selection, selectMode, toggleSelection } from '$lib/reader/text-selection';
  import type { Page } from '$lib/types';
  import { settings, volumes, imageFilter } from '$lib/settings';
  import { extractPageImageUrl } from '$lib/reader/page-image';
  import {
    showCropper,
    openCreateModal,
    openUpdateModal,
    expandTextBoxBounds,
    sendQuickCapture,
    getLastCardInfo,
    getCardAgeInMin,
    extractFieldValues,
    getModelConfig,
    blobToBase64,
    type VolumeMetadata
  } from '$lib/anki-connect';
  import { db } from '$lib/catalog/db';

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
  let display = $derived($settings.displayOCR ? 'block' : 'none');
  let alwaysShowOCR = $derived($settings.alwaysShowOCR);
  let border = $derived($settings.textBoxBorders ? '1px solid red' : 'none');
  let contenteditable = $derived($settings.textEditable);

  // Double-tap trigger: enabled if triggerMethod is 'doubleTap' or 'both' (legacy)
  let doubleTapEnabled = $derived(
    $settings.ankiConnectSettings.triggerMethod === 'doubleTap' ||
      $settings.ankiConnectSettings.triggerMethod === 'both'
  );
  let ankiTags = $derived($settings.ankiConnectSettings.tags);
  let cardMode = $derived($settings.ankiConnectSettings.cardMode);
  let volumeMetadata = $derived<VolumeMetadata>({
    seriesTitle: $volumes[volumeUuid]?.series_title,
    volumeTitle: $volumes[volumeUuid]?.volume_title
  });

  // Load volume cover image from DB and add to metadata
  async function getMetadataWithCover(): Promise<VolumeMetadata> {
    try {
      const dbVolume = await db.volumes.get(volumeUuid);
      if (dbVolume?.thumbnail) {
        const coverImage = await blobToBase64(dbVolume.thumbnail);
        if (coverImage) {
          return { ...volumeMetadata, coverImage };
        }
      }
    } catch {
      // Fall through to return metadata without cover
    }
    return volumeMetadata;
  }

  // Track adjusted font sizes for each textbox
  let adjustedFontSizes = $state<Map<number, string>>(new Map());
  // Track which textboxes need word wrapping enabled
  let needsWrapping = $state<Set<number>>(new Set());
  // Track which textboxes have been processed
  let processedTextBoxes = $state<Set<number>>(new Set());

  // Calculate optimal font size for a textbox using binary search
  // Two-phase approach: scale up until overflow, then find the goldilocks size
  function calculateOptimalFontSize(element: HTMLDivElement, initialFontSize: string) {
    // Parse the initial font size to get numeric value
    const match = initialFontSize.match(/(\d+(?:\.\d+)?)(px|pt)/);
    if (!match) return null;

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

    // Check if content overflows at a given font size
    const isOverflowingAt = (size: number) => {
      element.style.fontSize = `${size}px`;
      return (
        element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth
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

  // Spread vertical text columns to fill the box's full width.
  //
  // Runs AFTER the font has been sized against natural (1.1em) spacing, so the
  // chosen font size is unchanged — we only widen the gaps between the already
  // laid-out columns to consume the horizontal slack that made the text hug the
  // right edge. line-height is the column advance in vertical writing modes, so
  // scaling it by (boxWidth / contentWidth) makes the columns tile the full
  // width exactly. Measured (not computed from line count) so wrapped columns
  // are handled correctly. Only ever widens — never compresses.
  function fillVerticalColumns(element: HTMLDivElement) {
    const p = element.querySelector<HTMLParagraphElement>('p');
    if (!p) return;

    // Reset any previous override so we measure the natural column extent.
    p.style.lineHeight = '';
    const contentWidth = p.offsetWidth; // block axis (horizontal) = columns' span
    const boxWidth = element.clientWidth;
    if (contentWidth <= 0 || boxWidth <= contentWidth) return;

    // Read the natural column advance straight off the (just-reset) element
    // instead of recomputing it, so this stays in sync with the CSS
    // line-height rather than duplicating its `1.1em` as a magic number.
    const naturalLineHeight = parseFloat(getComputedStyle(p).lineHeight);
    if (!Number.isFinite(naturalLineHeight) || naturalLineHeight <= 0) return;

    const fillLineHeight = naturalLineHeight * (boxWidth / contentWidth);
    p.style.lineHeight = `${fillLineHeight}px`;
  }

  // Handle hover event to calculate resize on demand (only for auto font sizing)
  function handleTextBoxHover(element: HTMLDivElement, params: [number, string, boolean]) {
    const [index, initialFontSize, vertical] = params;

    const calculate = () => {
      // Skip if already processed, OCR is hidden, or using manual font size
      if (processedTextBoxes.has(index) || display !== 'block' || $settings.fontSize !== 'auto')
        return;

      // Mark as processed immediately to prevent duplicate calculations
      processedTextBoxes.add(index);

      // Use requestAnimationFrame to ensure the DOM is fully rendered
      requestAnimationFrame(() => {
        const result = calculateOptimalFontSize(element, initialFontSize);
        if (!result) return;

        const { finalSize, useWrapping, originalInPx } = result;

        // Apply final settings
        if (useWrapping) {
          needsWrapping.add(index);
          element.style.whiteSpace = 'normal';
          element.style.wordWrap = 'break-word';
          element.style.overflowWrap = 'break-word';
        } else {
          element.style.whiteSpace = 'nowrap';
          element.style.wordWrap = 'normal';
          element.style.overflowWrap = 'normal';
        }

        element.style.fontSize = `${finalSize}px`;

        // Store adjusted size if it changed
        if (finalSize < originalInPx) {
          adjustedFontSizes.set(index, `${finalSize}px`);
        }

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

  function getSelectedText(): string {
    // Get actual selected text from the DOM
    const selection = window.getSelection();
    return selection?.toString().trim() || '';
  }

  async function onUpdateCard(event: Event, lines: string[], blockIndex: number) {
    if (!$settings.ankiConnectSettings.enabled) return;

    const selectedText = getSelectedText();
    const fullSentence = lines.join(' ');

    // Get the original block's bounding box for initial crop
    const block = page.blocks[blockIndex];
    const textBox = block ? expandTextBoxBounds(block, page) : undefined;

    // Get image URL
    const url =
      extractPageImageUrl(event.target as HTMLElement) || (src ? URL.createObjectURL(src) : null);

    if (!url) return;

    // Get current page number for {page} template
    // Use the explicit pageIndex prop (0-based) when available, otherwise fall back to progress
    const pageNumber = pageIndex != null ? pageIndex + 1 : $volumes[volumeUuid]?.progress || 1;

    // Load cover image for {cover} template support
    const metadataWithCover = await getMetadataWithCover();

    if (cardMode === 'update') {
      // Update mode: fetch previous card values with retry
      const maxRetries = 3;
      let lastCard = null;
      let lastError = '';

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        lastCard = await getLastCardInfo();

        if (!lastCard || !lastCard.noteId) {
          lastError = 'No recent card found to update';
          // Wait before retry (except on last attempt)
          if (attempt < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 500));
          }
          continue;
        }

        if (!lastCard.modelName) {
          lastError = 'Could not detect card note type';
          // Wait before retry
          if (attempt < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 500));
          }
          continue;
        }

        // Success - break out of retry loop
        lastError = '';
        break;
      }

      if (lastError || !lastCard?.noteId || !lastCard?.modelName) {
        const { showSnackbar } = await import('$lib/util');
        showSnackbar(`Error: ${lastError || 'Failed to fetch card info'}`);
        return;
      }

      const cardAge = getCardAgeInMin(lastCard.noteId);
      if (cardAge >= 5) {
        // Card too old
        const { showSnackbar } = await import('$lib/util');
        showSnackbar(`Last card is ${cardAge} minutes old (max 5 min)`);
        return;
      }

      const previousValues = extractFieldValues(lastCard);

      // Get the model config to check for quickCapture setting
      const modelConfig = getModelConfig(lastCard.modelName, 'update');
      const hasConfig = !!modelConfig;
      const quickCapture = modelConfig?.quickCapture ?? false;

      if (quickCapture) {
        // Quick capture: send directly without modal
        await sendQuickCapture(
          'update',
          url,
          selectedText || fullSentence,
          fullSentence,
          metadataWithCover,
          textBox,
          previousValues,
          lastCard.noteId,
          lastCard.tags,
          lastCard.modelName,
          page.img_path
        );
      } else {
        // Show modal in update mode - use the card's model name
        // (also shown if quickCapture but no config exists)
        openUpdateModal(
          url,
          previousValues,
          lastCard.noteId,
          lastCard.modelName,
          lastCard.tags, // existing tags from the card
          selectedText || fullSentence,
          fullSentence,
          ankiTags,
          metadataWithCover,
          undefined,
          textBox,
          pageNumber,
          page.img_path
        );
      }
    } else {
      // Create mode
      const { selectedModel } = $settings.ankiConnectSettings;
      const modelConfig = getModelConfig(selectedModel, 'create');
      const quickCapture = modelConfig?.quickCapture ?? false;

      if (quickCapture) {
        await sendQuickCapture(
          'create',
          url,
          selectedText || fullSentence,
          fullSentence,
          metadataWithCover,
          textBox,
          undefined, // previousValues
          undefined, // previousCardId
          undefined, // previousTags
          undefined, // modelName
          page.img_path
        );
      } else {
        // Show modal (also shown if quickCapture but no config exists)
        openCreateModal(
          url,
          selectedText || fullSentence,
          fullSentence,
          ankiTags,
          metadataWithCover,
          undefined,
          textBox,
          pageNumber,
          page.img_path
        );
      }
    }
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

  function onDoubleTap(event: Event, lines: string[], blockIndex: number) {
    // Always stop propagation to prevent zoom from triggering
    event.stopPropagation();
    if (doubleTapEnabled) {
      event.preventDefault();
      onUpdateCard(event, lines, blockIndex);
    }
  }

  import {
    findBestMatch,
    showLookup,
    closePopup,
    activeTextBox,
    setActiveTextBox,
    highlightWord
  } from '$lib/dictionary/lookup';

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

  async function handleTextBoxClick(event: MouseEvent, boxId: string, lines: string[]) {
    // Double-click is handled by ondblclick (Anki capture)
    if (event.detail > 1) return;
    // User drag-selected text — don't override their selection
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    // Select mode: a tap toggles this box in/out of the ordered selection
    // instead of doing a dictionary lookup. Reveal the box so it stays readable.
    if ($selectMode) {
      setActiveTextBox(boxId);
      closePopup();
      toggleSelection(boxId, lines.join(''));
      return;
    }

    // Tap-to-reveal (step 1): if this box isn't revealed yet, the first tap
    // only shows its text — no lookup. Hover-capable devices skip this step.
    const revealed = canHover || alwaysShowOCR || $activeTextBox === boxId;
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

    const match = await findBestMatch(combined, combinedOffset);
    if (!match) {
      closePopup();
      return;
    }

    // Highlight the matched word (custom highlight, not browser selection —
    // avoids native mobile selection handles / copy bubble). A word that spans
    // a line break produces one range per text node it touches.
    highlightWord(rangesForSpan(segments, combinedOffset, combinedOffset + match.utf16Length));

    showLookup(match.state);
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

{#each textBoxes as { fontSize, height, left, lines, top, width, writingMode, useMinDimensions, isOriginalMode, blockIndex, vertical }, index (`${volumeUuid}-textBox-${index}`)}
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
    style:font-size={adjustedFontSizes.get(index) || fontSize}
    style:font-weight={fontWeight}
    style:font-family={ocrFontFamily}
    style:display
    style:border
    style:writing-mode={writingMode}
    style:filter={$imageFilter}
    role="none"
    onclick={(e) => handleTextBoxClick(e, boxId, lines)}
    oncontextmenu={(e) => handleContextMenu(e, lines, blockIndex, boxId)}
    ondblclick={(e) => onDoubleTap(e, lines, blockIndex)}
    oncopy={onCopy}
    {contenteditable}
  >
    {#if isSelected}
      <span class="selectBadge" aria-hidden="true">{selOrder}</span>
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
