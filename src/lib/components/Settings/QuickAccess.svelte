<script lang="ts">
  import { toggleFullScreen } from '$lib/util/fullscreen';
  import { isReader } from '$lib/util';
  import { navigateBack } from '$lib/util/hash-router';

  import { Button } from 'flowbite-svelte';

  interface Props {
    /** Dismiss the settings surface this control lives in. */
    close: () => void;
  }

  let { close }: Props = $props();

  function onFullscreen() {
    close();
    toggleFullScreen();
  }

  function onClose() {
    close();
    navigateBack();
  }
</script>

{#if isReader()}
  <div class="flex flex-col gap-2">
    <Button color="alternative" onclick={onFullscreen}
      >Toggle fullscreen <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">(F)</span
      ></Button
    >
    <Button color="alternative" onclick={onClose}
      >Close reader <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">(Esc)</span></Button
    >
  </div>
{/if}
