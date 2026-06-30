<script lang="ts">
  import type { Page } from '$lib/types';
  import TextBoxes from './TextBoxes.svelte';
  import { imageFilter } from '$lib/settings';

  interface ContextMenuData {
    x: number;
    y: number;
    lines: string[];
    imgElement: HTMLElement | null;
    textBox?: [number, number, number, number]; // [xmin, ymin, xmax, ymax] for initial crop
  }

  interface Props {
    page: Page;
    src?: File | null;
    cachedUrl?: string | null;
    volumeUuid: string;
    /** 0-based page index within the volume */
    pageIndex?: number;
    /** Force text visibility (for placeholder/missing pages) */
    forceVisible?: boolean;
    /** Callback when context menu should be shown */
    onContextMenu?: (data: ContextMenuData) => void;
  }

  let {
    page,
    src,
    cachedUrl,
    volumeUuid,
    pageIndex,
    forceVisible = false,
    onContextMenu
  }: Props = $props();

  let url = $state('');

  // Use cached URL if available, otherwise create blob URL
  $effect(() => {
    let currentBlobUrl: string | null = null;

    if (cachedUrl) {
      // Use pre-decoded cached URL (no cleanup needed, managed by cache)
      url = `url(${cachedUrl})`;
    } else if (src) {
      // Fallback: create new blob URL
      currentBlobUrl = URL.createObjectURL(src);
      url = `url(${currentBlobUrl})`;
    } else {
      url = '';
    }

    // Cleanup function runs on effect re-run or component unmount
    return () => {
      // Only revoke if we created it (not from cache)
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  });
</script>

<div
  draggable="false"
  data-page-index={pageIndex}
  style:width={`${page.img_width}px`}
  style:height={`${page.img_height}px`}
  class="relative"
>
  <!--
    The page image lives in its own filtered layer (not on the page div, and
    not on a shared ancestor) so invert/grayscale don't pull the text boxes
    into a stacking context with it. That keeps the OCR boxes (z-11) above the
    paged edge-flip buttons (z-10) while the image stays below them — see
    Reader.svelte's edge buttons.
  -->
  <div
    class="manga-page-image absolute inset-0"
    style:background-image={url}
    style:background-size="contain"
    style:background-repeat="no-repeat"
    style:background-position="center"
    style:filter={$imageFilter}
  ></div>
  <TextBoxes
    {page}
    src={src ?? undefined}
    {volumeUuid}
    {pageIndex}
    {forceVisible}
    {onContextMenu}
  />
</div>
