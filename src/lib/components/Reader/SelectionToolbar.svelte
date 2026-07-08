<script lang="ts">
  import { get } from 'svelte/store';
  import { copyTextToClipboard, showSnackbar } from '$lib/util';
  import {
    selectMode,
    selection,
    selectionCount,
    copyText,
    clearSelection,
    exitSelectMode,
    type TextSelectionEntry
  } from '$lib/reader/text-selection';
  import { openChatWithExplain } from '$lib/ai-chat/store';
  import {
    cancelSentenceReselect,
    finishSentenceReselect,
    sentenceReselecting
  } from '$lib/anki-server/mining';
  import { CreditCardPlusOutline, FileCopyOutline, MessagesOutline } from 'flowbite-svelte-icons';

  interface Props {
    onCreateFlashcard?: (text: string, entries: TextSelectionEntry[]) => void;
  }

  let { onCreateFlashcard }: Props = $props();

  async function copyAll() {
    const text = get(copyText);
    if (!text) return;
    await copyTextToClipboard(text);
    showSnackbar(`Copied ${get(selectionCount)} text boxes`);
    // Copying ends the session: clear the selection and leave select mode.
    exitSelectMode();
  }

  function explainAll() {
    const text = get(copyText);
    if (!text) return;
    exitSelectMode();
    openChatWithExplain(text);
  }

  function createFlashcard() {
    const text = get(copyText);
    if (!text) return;
    const entries = get(selection);
    if (get(sentenceReselecting)) {
      finishSentenceReselect(text, entries);
    } else {
      onCreateFlashcard?.(text, entries);
    }
    exitSelectMode();
  }

  function confirmSentenceSelection() {
    const text = get(copyText);
    if (!text) return;
    finishSentenceReselect(text, get(selection));
    exitSelectMode();
  }

  function done() {
    if (get(sentenceReselecting)) cancelSentenceReselect();
    exitSelectMode();
  }
</script>

{#if $selectMode}
  <div
    class="fixed bottom-3 left-1/2 z-50 flex w-48 -translate-x-1/2 flex-col items-stretch gap-2 rounded-2xl bg-gray-800/95 px-3 py-2.5 shadow-lg"
  >
    <span class="text-center text-sm font-medium whitespace-nowrap text-white">
      {$selectionCount} selected
    </span>

    {#if $sentenceReselecting}
      <div class="grid grid-cols-2 overflow-hidden rounded-full bg-gray-700/80">
        <button class="px-3 py-1.5 text-sm text-white hover:bg-gray-600" onclick={done}>
          Cancel
        </button>
        <button
          onclick={confirmSentenceSelection}
          disabled={$selectionCount === 0}
          class="border-l border-gray-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50"
        >
          Confirm
        </button>
      </div>
    {:else}
      <div class="grid grid-cols-3 gap-2">
        <button
          onclick={copyAll}
          disabled={$selectionCount === 0}
          class="flex h-10 items-center justify-center rounded-full bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50"
          aria-label="Copy selection"
          title="Copy"
        >
          <FileCopyOutline size="md" />
        </button>
        <button
          onclick={explainAll}
          disabled={$selectionCount === 0}
          class="flex h-10 items-center justify-center rounded-full bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50"
          aria-label="Explain selection"
          title="Explain"
        >
          <MessagesOutline size="md" />
        </button>
        <button
          onclick={createFlashcard}
          disabled={$selectionCount === 0}
          class="flex h-10 items-center justify-center rounded-full bg-gray-600 text-white hover:bg-gray-500 disabled:opacity-50"
          aria-label="Create flashcard"
          title="Create flashcard"
        >
          <CreditCardPlusOutline size="md" />
        </button>
      </div>

      <div class="grid grid-cols-2 overflow-hidden rounded-full bg-gray-700/80">
        <button
          onclick={clearSelection}
          disabled={$selectionCount === 0}
          class="px-3 py-1.5 text-sm text-white hover:bg-gray-600 disabled:opacity-50"
        >
          Clear
        </button>
        <button
          onclick={done}
          aria-label="Exit select mode"
          class="border-l border-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-600"
        >
          Done
        </button>
      </div>
    {/if}
  </div>
{/if}
