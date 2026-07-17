<script lang="ts">
  import { Progressbar } from 'flowbite-svelte';
  import { bundledDictStatuses, ensureBundledDictionaries } from '$lib/dictionary/bundled';

  let statuses = $derived($bundledDictStatuses);
  let active = $derived(statuses.find((s) => s.state === 'downloading' || s.state === 'importing'));
  let errored = $derived(statuses.filter((s) => s.state === 'error'));
  // Dictionaries queued behind the active one (sequential loading).
  let queued = $derived(active ? statuses.filter((s) => s.state === 'idle') : []);
  let allReady = $derived(statuses.length > 0 && statuses.every((s) => s.state === 'ready'));
  let total = $derived(statuses.length);
  let stepIndex = $derived(statuses.filter((s) => s.state === 'ready').length + 1);
  let activePresent = $derived(Boolean(active));

  let dismissed = $state(false);
  let showProgress = $state(false);
  let showSuccess = $state(false);
  let showedProgress = $state(false);

  const PROGRESS_DISPLAY_DELAY_MS = 3000;

  $effect(() => {
    if (activePresent || errored.length > 0) {
      dismissed = false; // re-show the toast whenever work (re)starts
    }
  });

  // Keep normal cached launches quiet: only show progress if dictionary work is
  // still ongoing after a short delay. Errors bypass this delay below.
  $effect(() => {
    if (!activePresent) {
      showProgress = false;
      return;
    }

    const t = setTimeout(() => {
      showProgress = true;
      showedProgress = true;
    }, PROGRESS_DISPLAY_DELAY_MS);

    return () => clearTimeout(t);
  });

  // Briefly flash success only after progress was visible; fast cached launches
  // finish silently.
  $effect(() => {
    if (!allReady || !showedProgress) return;
    showSuccess = true;
    const t = setTimeout(() => (showSuccess = false), 4000);
    return () => clearTimeout(t);
  });

  let visible = $derived(
    !dismissed && ((!!active && showProgress) || errored.length > 0 || showSuccess)
  );

  function retry() {
    ensureBundledDictionaries().catch(() => {
      /* status surfaced via store */
    });
  }
</script>

{#if visible}
  <div
    class="fixed bottom-[calc(1rem+var(--bottom-nav-offset))] left-1/2 z-[1100] w-[min(92vw,22rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    role="status"
    aria-live="polite"
  >
    <button
      class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      aria-label="Dismiss"
      onclick={() => (dismissed = true)}
    >
      ×
    </button>

    {#if active}
      <div class="font-medium">
        {active.state === 'downloading'
          ? 'Downloading dictionary'
          : 'Setting up dictionary'}{total > 1 ? ` (${stepIndex} of ${total})` : ''}
      </div>
      <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {active.label} · {active.message}
      </div>
      <div class="mt-2">
        <Progressbar progress={active.progress} size="sm" />
      </div>
      {#if queued.length > 0}
        <div class="mt-1 text-[11px] text-gray-400">
          Next: {queued.map((s) => s.label).join(', ')}
        </div>
      {/if}
      <div class="mt-1.5 text-[11px] text-gray-400">
        {active.state === 'downloading'
          ? 'Downloading the dictionary file…'
          : 'Saving the dictionary to this device (this can take a moment)…'}
        You can keep using the app while this finishes.
      </div>
    {:else if errored.length > 0}
      <div class="font-medium text-red-600 dark:text-red-400">Dictionary download failed</div>
      <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        {errored.map((s) => s.label).join(', ')} couldn’t be downloaded.
      </div>
      <button
        class="mt-2 rounded bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700"
        onclick={retry}
      >
        Retry
      </button>
    {:else if showSuccess}
      <div class="font-medium text-green-600 dark:text-green-400">Dictionaries ready ✓</div>
    {/if}
  </div>
{/if}
