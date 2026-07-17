<script lang="ts">
  import { snackbarStore } from '$lib/util/snackbar';
  import { Toast } from 'flowbite-svelte';
</script>

{#if $snackbarStore?.message && $snackbarStore?.visible}
  <Toast position="bottom-right" class="bottom-[calc(1rem+var(--bottom-nav-offset))] z-50"
    >{$snackbarStore?.message}</Toast
  >
{/if}
