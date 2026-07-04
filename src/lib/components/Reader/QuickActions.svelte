<script lang="ts">
  import { toggleFullScreen } from '$lib/util/fullscreen';
  import { pagedZoom } from '$lib/reader/paged-zoom';
  import { settings, updateSetting } from '$lib/settings';
  import {
    ArrowLeftOutline,
    ArrowRightOutline,
    CompressOutline,
    ZoomOutOutline,
    PlusOutline
  } from 'flowbite-svelte-icons';

  interface Props {
    left: (_e: any, ingoreTimeOut?: boolean) => void;
    right: (_e: any, ingoreTimeOut?: boolean) => void;
    visible?: boolean;
  }

  let { left, right, visible = true }: Props = $props();

  let open = $state(false);

  function handleZoom() {
    if ($pagedZoom) {
      // Paged mode: transient whole-page view (the mode setting is untouched).
      $pagedZoom.zoomFitToScreen();
    } else {
      // Continuous mode has no transient equivalent — pages lay out from the
      // mode setting, so "fit" means switching it (the Z-key path).
      updateSetting('continuousZoomDefault', 'zoomFitToScreen');
    }
    open = false;
  }

  function handleLeft(_e: Event) {
    left(_e, true);
    open = false;
  }

  function handleRight(_e: Event) {
    right(_e, true);
    open = false;
  }

  function toggleMenu() {
    open = !open;
  }
</script>

{#if $settings.quickActions && visible}
  <div class="fixed end-3 bottom-3 z-50 flex flex-col items-center">
    <!-- Action buttons (shown when open) -->
    {#if open}
      <div class="mb-2 flex flex-col items-center gap-2">
        <button
          onclick={() => {
            toggleFullScreen();
            open = false;
          }}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Toggle fullscreen"
        >
          <CompressOutline size="xl" />
        </button>
        <button
          onclick={handleZoom}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Zoom to fit"
        >
          <ZoomOutOutline size="xl" />
        </button>
        <button
          onclick={handleRight}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Next page"
        >
          <ArrowRightOutline size="xl" />
        </button>
        <button
          onclick={handleLeft}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Previous page"
        >
          <ArrowLeftOutline size="xl" />
        </button>
      </div>
    {/if}

    <!-- Main toggle button -->
    <button
      onclick={toggleMenu}
      class="flex h-12 w-12 items-center justify-center rounded-full text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
      aria-label="Quick actions menu"
      style="transition: transform 0.3s ease; transform: rotate({open ? 45 : 0}deg);"
    >
      <PlusOutline size="xl" />
    </button>
  </div>
{/if}
