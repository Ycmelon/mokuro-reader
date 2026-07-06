<script lang="ts">
  import { countMora, moraSubstring } from '$lib/dictionary/japanese';

  // Renders one pitch pattern for a reading. `position` is the mora index of the
  // downstep (0 = heiban, no downstep). Two visual modes, matching 10ten:
  //  - downstep: the reading with a ꜜ marker after the accented mora (heiban
  //    shown with a dotted overline so it's distinguishable from "no accent data").
  //  - binary:  a high/low contour drawn with dotted cell borders in the current
  //    text colour, so it reads as one continuous line and doesn't recolour or
  //    space out the kana.
  let {
    reading,
    position,
    mode
  }: { reading: string; position: number; mode: 'downstep' | 'binary' } = $props();

  const moraCount = $derived(countMora(reading));

  interface Segment {
    text: string;
    cls: string;
  }

  // Contour cells for binary mode, precomputed so the markup carries no
  // whitespace between the inline-block cells (whitespace would open visible
  // gaps between the kana).
  let segments = $derived.by((): Segment[] => {
    if (position === 0 || position === 1) {
      // heiban (LHHH…) and atamadaka (HLLL…) share a shape.
      const segs: Segment[] = [
        { text: moraSubstring(reading, 0, 1), cls: position ? 'hl' : moraCount > 1 ? 'lh' : 'h' }
      ];
      if (moraCount > 1) segs.push({ text: moraSubstring(reading, 1), cls: position ? 'l' : 'h' });
      return segs;
    }
    // nakadaka (LHHL) / odaka (LHHH↓).
    const segs: Segment[] = [
      { text: moraSubstring(reading, 0, 1), cls: 'lh' },
      { text: moraSubstring(reading, 1, position), cls: 'hl' }
    ];
    if (position < moraCount) segs.push({ text: moraSubstring(reading, position), cls: 'l' });
    return segs;
  });
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
  <span class="pitch-graph"
    >{#each segments as s}<span class={s.cls}>{s.text}</span>{/each}</span
  >
{/if}

<style>
  .pitch-heiban {
    border-top: 1px dotted currentColor;
  }

  /* Downstep marker: same colour as the reading, sized down so it doesn't shove
     the kana apart. */
  .pitch-mark {
    font-size: 0.7em;
    vertical-align: top;
  }

  /* Binary contour: dotted lines in the current text colour. Tight line-height
     and no inter-cell whitespace keep it from disturbing the kana layout. */
  .pitch-graph {
    display: inline-block;
    line-height: 1.2;
  }

  .pitch-graph :global(span) {
    display: inline-block;
    border-color: currentColor;
  }

  .pitch-graph :global(.h) {
    border-top: 1px dotted;
  }

  .pitch-graph :global(.l) {
    border-bottom: 1px dotted;
  }

  .pitch-graph :global(.hl) {
    border-top: 1px dotted;
    border-right: 1px dotted;
  }

  .pitch-graph :global(.lh) {
    border-bottom: 1px dotted;
    border-right: 1px dotted;
  }
</style>
