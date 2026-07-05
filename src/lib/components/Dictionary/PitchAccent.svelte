<script lang="ts">
  import { countMora, moraSubstring } from '$lib/dictionary/japanese';

  // Renders one pitch pattern for a reading. `position` is the mora index of the
  // downstep (0 = heiban, no downstep). Two visual modes, matching 10ten:
  //  - downstep: the reading with a ꜜ marker after the accented mora (heiban
  //    shown with an overline so it's distinguishable from "no accent data").
  //  - binary:  a high/low step graph drawn with cell borders.
  let {
    reading,
    position,
    mode
  }: { reading: string; position: number; mode: 'downstep' | 'binary' } = $props();

  const moraCount = $derived(countMora(reading));
</script>

{#if mode === 'downstep'}
  {#if position === 0}
    <span class="pitch-heiban">{reading}</span>
  {:else}
    <span class="pitch-downstep"
      >{moraSubstring(reading, 0, position)}<span class="pitch-mark">ꜜ</span>{moraSubstring(
        reading,
        position
      )}</span
    >
  {/if}
{:else}
  <span class="pitch-graph">
    {#if position === 0 || position === 1}
      <!-- heiban (LHHH…) and atamadaka (HLLL…) share a shape. -->
      <span class={position ? 'hl' : moraCount > 1 ? 'lh' : 'h'}
        >{moraSubstring(reading, 0, 1)}</span
      >
      {#if moraCount > 1}
        <span class={position ? 'l' : 'h'}>{moraSubstring(reading, 1)}</span>
      {/if}
    {:else}
      <!-- nakadaka (LHHL) / odaka (LHHH↓). -->
      <span class="lh">{moraSubstring(reading, 0, 1)}</span>
      <span class="hl">{moraSubstring(reading, 1, position)}</span>
      {#if position < moraCount}
        <span class="l">{moraSubstring(reading, position)}</span>
      {/if}
    {/if}
  </span>
{/if}

<style>
  .pitch-heiban {
    border-top: 1.5px dotted currentColor;
  }
  .pitch-mark {
    color: var(--color-primary-400);
  }
  .pitch-graph {
    display: inline-block;
    line-height: 1.9;
  }
  /* Each mora cell draws part of the H/L contour with borders. */
  .pitch-graph :global(span) {
    display: inline-block;
    border-color: var(--color-primary-400);
  }
  .pitch-graph :global(.h) {
    border-top: 1.5px solid;
  }
  .pitch-graph :global(.l) {
    border-bottom: 1.5px solid;
  }
  .pitch-graph :global(.hl) {
    border-top: 1.5px solid;
    border-right: 1.5px solid;
  }
  .pitch-graph :global(.lh) {
    border-bottom: 1.5px solid;
    border-right: 1.5px solid;
  }
</style>
