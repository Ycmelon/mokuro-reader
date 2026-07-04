<script lang="ts">
  // Switcher between the two crop interaction models, chosen by the user's
  // `cropMode` setting so both can be A/B tested on-device:
  //   'draw'  — freeze the page, draw a box on it (MineCropOverlayDraw)
  //   'frame' — keep panning/zooming, move a fixed window (MineCropOverlayFrame)
  import { miscSettings } from '$lib/settings';
  import MineCropOverlayDraw from './MineCropOverlayDraw.svelte';
  import MineCropOverlayFrame from './MineCropOverlayFrame.svelte';

  let mode = $derived($miscSettings.ankiServerSettings.cropMode);
</script>

{#if mode === 'draw'}
  <MineCropOverlayDraw />
{:else}
  <MineCropOverlayFrame />
{/if}
