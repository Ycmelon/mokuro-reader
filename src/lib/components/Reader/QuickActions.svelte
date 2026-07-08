<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsPanel from '$lib/components/Settings/Settings.svelte';
  import { chatOpen } from '$lib/ai-chat/store';
  import { toggleFullScreen } from '$lib/util/fullscreen';
  import { navigateBack } from '$lib/util/hash-router';
  import { settings } from '$lib/settings';
  import {
    LogOut,
    Maximize2,
    MessageSquare,
    Minimize2,
    Plus,
    Settings as SettingsIcon
  } from '@lucide/svelte';

  interface Props {
    visible?: boolean;
  }

  let { visible = true }: Props = $props();

  let open = $state(false);
  let settingsOpen = $state(false);
  let fullscreen = $state(false);

  function syncFullscreenState() {
    fullscreen = Boolean(document.fullscreenElement);
  }

  onMount(() => {
    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  });

  function handleExit() {
    navigateBack();
    open = false;
  }

  function openSettings() {
    settingsOpen = true;
    open = false;
  }

  function handleFullscreen() {
    toggleFullScreen();
    open = false;
  }

  function openChat() {
    chatOpen.set(true);
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
          onclick={handleExit}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Exit reader"
        >
          <LogOut class="h-6 w-6" />
        </button>
        <button
          onclick={openSettings}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Open settings"
        >
          <SettingsIcon class="h-6 w-6" />
        </button>
        <button
          onclick={handleFullscreen}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {#if fullscreen}
            <Minimize2 class="h-6 w-6" />
          {:else}
            <Maximize2 class="h-6 w-6" />
          {/if}
        </button>
        <button
          onclick={openChat}
          class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-gray-300 shadow-lg hover:bg-gray-600 focus:outline-none dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Open chat"
        >
          <MessageSquare class="h-6 w-6" />
        </button>
      </div>
    {/if}

    <!-- Main toggle button -->
    <button
      onclick={toggleMenu}
      class="reader-hud flex h-12 w-12 items-center justify-center rounded-full text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
      aria-label="Quick actions menu"
      style="transition: transform 0.3s ease; transform: rotate({open ? 45 : 0}deg);"
    >
      <Plus class="h-6 w-6" />
    </button>
  </div>
{/if}

<SettingsPanel bind:open={settingsOpen} />
