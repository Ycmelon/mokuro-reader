<script lang="ts">
  import Settings from '$lib/components/Settings/Settings.svelte';
  import { Settings as SettingsIcon } from '@lucide/svelte';

  interface Props {
    visible?: boolean;
  }

  let { visible = true }: Props = $props();

  let settingsOpen = $state(false);

  function openSettings() {
    settingsOpen = true;
  }
</script>

{#if visible}
  <button
    onclick={openSettings}
    class="reader-hud fixed top-3 right-3 z-10 p-2 opacity-80 hover:text-primary-600 hover:opacity-100"
  >
    <SettingsIcon class="h-8 w-8" />
  </button>
{/if}

<Settings bind:open={settingsOpen} />
