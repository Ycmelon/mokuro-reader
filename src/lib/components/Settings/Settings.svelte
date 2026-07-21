<script lang="ts">
  import { Drawer } from 'flowbite-svelte';
  import { Settings as SettingsIcon } from '@lucide/svelte';
  import { sineIn } from 'svelte/easing';
  import { currentView } from '$lib/util/hash-router';
  import SettingsContent from './SettingsContent.svelte';

  let transitionParams = {
    x: 320,
    duration: 200,
    easing: sineIn
  };

  interface Props {
    open?: boolean;
  }

  // In Svelte 5, we need to make sure the open prop is properly bindable
  let { open = $bindable(false) }: Props = $props();

  function onClose() {
    open = false;
  }

  // Handle backdrop mousedown - dismiss on mousedown outside content, not mouseup
  function handleBackdropMousedown(ev: MouseEvent & { currentTarget: HTMLDialogElement }) {
    const dlg = ev.currentTarget;
    if (ev.target === dlg) {
      // Click is on the backdrop (dialog element itself, not content)
      const rect = dlg.getBoundingClientRect();
      const clickedInContent =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;

      if (!clickedInContent) {
        open = false;
      }
    }
  }

  // Close drawer on navigation (hash route change)
  let previousViewType = $state($currentView.type);
  $effect(() => {
    const viewType = $currentView.type;
    if (viewType !== previousViewType) {
      previousViewType = viewType;
      if (open) {
        open = false;
      }
    }
  });
</script>

<Drawer
  placement="right"
  class="w-full md:w-1/2 lg:w-1/4"
  {transitionParams}
  bind:open
  id="settings"
  outsideclose={false}
  onmousedown={handleBackdropMousedown}
>
  <h5
    id="drawer-label"
    class="mb-4 inline-flex items-center text-base font-semibold text-gray-900 dark:text-white"
  >
    <SettingsIcon class="mr-2.5 h-4 w-4" />Settings
  </h5>
  <SettingsContent close={onClose} />
</Drawer>
