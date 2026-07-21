<script lang="ts">
  import { Library, Cloudy, Upload, Settings as SettingsIcon } from '@lucide/svelte';
  import { Spinner } from 'flowbite-svelte';
  import { nav, currentView } from '$lib/util/hash-router';
  import { unifiedProviderState } from '$lib/util/sync/unified-provider-state';

  let providerState = $derived($unifiedProviderState);

  // Views that live under the library section of the app
  const LIBRARY_VIEWS = [
    'catalog',
    'series',
    'volume-text',
    'series-text',
    'merge-series',
    'libraries',
    'add-library'
  ];

  let libraryActive = $derived(LIBRARY_VIEWS.includes($currentView.type));
  let cloudActive = $derived($currentView.type === 'cloud');
  let uploadActive = $derived($currentView.type === 'upload');
  let settingsActive = $derived($currentView.type === 'settings');

  // Cloud connection state drives the icon colour, matching the top bar
  let cloudTint = $derived.by(() => {
    if (providerState?.needsAttention) return 'text-red-600';
    if (providerState?.isFullyConnected) return 'text-green-600';
    if (providerState?.isAuthenticated || providerState?.hasActiveProvider)
      return 'text-yellow-600';
    return '';
  });
</script>

<nav
  class="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden"
>
  <div
    class="flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 p-1.5 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/90"
  >
    <button
      onclick={() => nav.toCatalog()}
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors {libraryActive
        ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-label="Library"
      aria-current={libraryActive ? 'page' : undefined}
    >
      <Library class="h-6 w-6" />
    </button>
    <button
      onclick={() => nav.toCloud()}
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors {cloudActive
        ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-label="Cloud"
      aria-current={cloudActive ? 'page' : undefined}
    >
      {#if providerState?.isCacheLoading && !providerState?.isCacheLoaded}
        <span class="flex h-6 w-6 items-center justify-center"><Spinner size="4" /></span>
      {:else}
        <Cloudy class="h-6 w-6 {cloudActive ? '' : cloudTint}" />
      {/if}
    </button>
    <button
      onclick={() => nav.toUpload()}
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors {uploadActive
        ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-label="Upload"
      aria-current={uploadActive ? 'page' : undefined}
    >
      <Upload class="h-6 w-6" />
    </button>
    <button
      onclick={() => nav.toSettings()}
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors {settingsActive
        ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-400'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-label="Settings"
      aria-current={settingsActive ? 'page' : undefined}
    >
      <SettingsIcon class="h-6 w-6" />
    </button>
  </div>
</nav>
