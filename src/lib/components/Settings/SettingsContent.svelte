<script lang="ts">
  import { Accordion, Button } from 'flowbite-svelte';
  import { resetSettings } from '$lib/settings';
  import { isReader, promptConfirmation } from '$lib/util';
  import AnkiSettings from './AnkiSettings.svelte';
  import ReaderSettings from './Reader/ReaderSettings.svelte';
  import Profiles from './Profiles/Profiles.svelte';
  import CatalogSettings from './CatalogSettings.svelte';
  import Stats from './Stats.svelte';
  import VolumeDefaults from './Volume/VolumeDefaults.svelte';
  import About from './About.svelte';
  import DictionarySettings from './DictionarySettings.svelte';
  import QuickAccess from './QuickAccess.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import AiChatSettings from './AiChatSettings.svelte';

  interface Props {
    /** Dismiss the settings surface (close the drawer, or leave the settings screen). */
    close: () => void;
    /** Whether to render the trailing Close button (drawers want it, the full screen doesn't). */
    showCloseButton?: boolean;
  }

  let { close, showCloseButton = true }: Props = $props();

  function onReset() {
    close();
    promptConfirmation('Restore default settings?', resetSettings);
  }
</script>

<div class="flex flex-col gap-5">
  <Accordion flush>
    <QuickAccess {close} />
    <ReaderSettings />
    {#if !isReader()}
      <VolumeDefaults />
    {/if}
    <Profiles onClose={close} />
    <DictionarySettings />
    <AiChatSettings />
    <AnkiSettings />
    <CatalogSettings />
    <AppearanceSettings />
    <Stats />
    <About />
  </Accordion>
  <div class="flex flex-col gap-2">
    <Button outline onclick={onReset}>Reset</Button>
    {#if showCloseButton}
      <Button outline onclick={close} color="light">Close</Button>
    {/if}
  </div>
</div>
