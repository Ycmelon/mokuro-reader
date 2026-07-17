<script lang="ts">
  import { Library, CloudUpload, Upload, Settings as SettingsIcon } from '@lucide/svelte';
  import { Spinner } from 'flowbite-svelte';
  import { nav, currentView } from '$lib/util/hash-router';
  import { unifiedProviderState } from '$lib/util/sync/unified-provider-state';

  interface Props {
    onSettings: () => void;
    settingsOpen?: boolean;
  }

  let { onSettings, settingsOpen = false }: Props = $props();

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
  class="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-gray-700 dark:bg-gray-800"
>
  <div class="grid grid-cols-4">
    <button
      onclick={() => nav.toCatalog()}
      class="flex flex-col items-center gap-1 py-2 text-xs {libraryActive
        ? 'text-primary-700 dark:text-primary-500'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-current={libraryActive ? 'page' : undefined}
    >
      <Library class="h-6 w-6" />
      Library
    </button>
    <button
      onclick={() => nav.toCloud()}
      class="flex flex-col items-center gap-1 py-2 text-xs {cloudActive
        ? 'text-primary-700 dark:text-primary-500'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-current={cloudActive ? 'page' : undefined}
    >
      {#if providerState?.isCacheLoading && !providerState?.isCacheLoaded}
        <span class="flex h-6 w-6 items-center justify-center"><Spinner size="4" /></span>
      {:else}
        <CloudUpload class="h-6 w-6 {cloudActive ? '' : cloudTint}" />
      {/if}
      Cloud
    </button>
    <button
      onclick={() => nav.toUpload()}
      class="flex flex-col items-center gap-1 py-2 text-xs {uploadActive
        ? 'text-primary-700 dark:text-primary-500'
        : 'text-gray-500 dark:text-gray-400'}"
      aria-current={uploadActive ? 'page' : undefined}
    >
      <Upload class="h-6 w-6" />
      Upload
    </button>
    <button
      onclick={onSettings}
      class="flex flex-col items-center gap-1 py-2 text-xs {settingsOpen
        ? 'text-primary-700 dark:text-primary-500'
        : 'text-gray-500 dark:text-gray-400'}"
    >
      <SettingsIcon class="h-6 w-6" />
      Settings
    </button>
  </div>
</nav>
