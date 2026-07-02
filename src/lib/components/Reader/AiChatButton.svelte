<script lang="ts">
  import { MessagesOutline } from 'flowbite-svelte-icons';
  import { chatOpen } from '$lib/ai-chat/store';

  interface Props {
    visible?: boolean;
  }

  let { visible = true }: Props = $props();

  function openChat() {
    chatOpen.set(true);
  }
</script>

{#if visible}
  <button
    onclick={openChat}
    class="reader-hud fixed top-3 right-16 z-10 p-2 opacity-80 hover:text-primary-600 hover:opacity-100"
  >
    <MessagesOutline size="xl" />
  </button>
{/if}
