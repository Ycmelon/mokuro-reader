<script lang="ts">
  import { get } from 'svelte/store';
  import { copyTextToClipboard, showSnackbar } from '$lib/util';
  import {
    selectMode,
    selectionCount,
    copyText,
    clearSelection,
    exitSelectMode
  } from '$lib/reader/text-selection';

  async function copyAll() {
    const text = get(copyText);
    if (!text) return;
    await copyTextToClipboard(text);
    showSnackbar(`Copied ${get(selectionCount)} text boxes`);
    // Copying ends the session: clear the selection and leave select mode.
    exitSelectMode();
  }
</script>

{#if $selectMode}
  <div
    class="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gray-800/95 px-3 py-2 shadow-lg"
  >
    <span class="px-1 text-sm whitespace-nowrap text-white">{$selectionCount} selected</span>
    <button
      onclick={copyAll}
      disabled={$selectionCount === 0}
      class="rounded-full bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
    >
      Copy
    </button>
    <button
      onclick={clearSelection}
      disabled={$selectionCount === 0}
      class="rounded-full bg-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-500 disabled:opacity-50"
    >
      Clear
    </button>
    <button
      onclick={exitSelectMode}
      aria-label="Exit select mode"
      class="rounded-full bg-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-500"
    >
      Done
    </button>
  </div>
{/if}
