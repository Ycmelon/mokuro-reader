<script lang="ts">
  import type { Sense } from '$lib/dictionary/types';
  import { groupSenses } from '$lib/dictionary/sense-grouping';
  import { posLabel, miscLabel } from '$lib/dictionary/jmdict-tags';
  import Tag from './Tag.svelte';
  import SenseView from './Sense.svelte';

  let { senses, posDisplay = 'expl' }: { senses: Sense[]; posDisplay?: 'expl' | 'code' } = $props();

  // Group senses by a shared primary part-of-speech, hoisting any further
  // pos/misc tags common to a group into its heading. The grouping (ported from
  // 10ten / @birchill/jpdict-idb) already strips the hoisted tags from each
  // sense, so the numbered senses render only what distinguishes them.
  let groups = $derived(groupSenses(senses));

  // Mirror 10ten: only use the grouped layout when the extra heading lines don't
  // inflate the total line count by more than 50%. Where there are no shared
  // parts-of-speech that produces one group per sense, so we fall back to a flat
  // numbered list of the original senses instead.
  let useGroups = $derived(
    senses.length > 1 && groups.length > 0 && (groups.length + senses.length) / senses.length <= 1.5
  );

  // Continuous 1-based numbering across group boundaries.
  let groupStarts = $derived.by(() => {
    const starts: number[] = [];
    let idx = 1;
    for (const g of groups) {
      starts.push(idx);
      idx += g.senses.length;
    }
    return starts;
  });

  let posText = (code: string) => (posDisplay === 'code' ? code : posLabel(code));
</script>

{#if senses.length === 1}
  <div class="def-single"><SenseView sense={senses[0]} {posDisplay} /></div>
{:else if useGroups}
  {#each groups as group, gi}
    <p class="def-group-heading">
      {#each group.pos as p}<Tag kind="pos" text={posText(p)} title={posLabel(p)} />{/each}
      {#each group.misc as m}<Tag kind="misc" text={miscLabel(m)} />{/each}
      <!-- If there is no group heading, show a '-' placeholder (10ten's behaviour). -->
      {#if group.pos.length === 0 && group.misc.length === 0}<Tag kind="pos" text="-" />{/if}
    </p>
    <ol class="def-list" start={groupStarts[gi]}>
      {#each group.senses as s}
        <li><SenseView sense={s} {posDisplay} /></li>
      {/each}
    </ol>
  {/each}
{:else}
  <ol class="def-list">
    {#each senses as s}
      <li><SenseView sense={s} {posDisplay} /></li>
    {/each}
  </ol>
{/if}

<style>
  .def-single {
    line-height: 1.5;
  }

  .def-group-heading {
    margin: 6px 0 2px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .def-list {
    margin: 0;
    padding-left: 1.4em;
    list-style: decimal;
  }

  .def-list li {
    line-height: 1.5;
    margin-bottom: 1px;
  }
</style>
