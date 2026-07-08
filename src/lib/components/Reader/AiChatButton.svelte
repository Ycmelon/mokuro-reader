<script lang="ts">
  import { MessagesSquare } from '@lucide/svelte';
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
    <MessagesSquare class="h-8 w-8" />
  </button>
{/if}
