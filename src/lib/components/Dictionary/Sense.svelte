<script lang="ts">
  import type { Sense } from '$lib/dictionary/types';
  import { posLabel, fieldLabel, miscLabel, dialLabel } from '$lib/dictionary/jmdict-tags';
  import { lookupReference } from '$lib/dictionary/lookup';
  import Tag from './Tag.svelte';

  let {
    sense,
    posDisplay = 'expl'
  }: {
    sense: Sense;
    /** 'expl' = spelled-out POS labels, 'code' = raw JMdict codes. */
    posDisplay?: 'expl' | 'code';
  } = $props();

  const GLOSS_TYPE_PREFIX: Record<string, string> = {
    literal: 'lit.',
    figurative: 'fig.',
    explanation: 'expl.'
  };

  const LANG_NAMES: Record<string, string> = {
    eng: 'English',
    fre: 'French',
    ger: 'German',
    dut: 'Dutch',
    ita: 'Italian',
    spa: 'Spanish',
    por: 'Portuguese',
    rus: 'Russian',
    chi: 'Chinese',
    kor: 'Korean',
    lat: 'Latin',
    gre: 'Greek'
  };
  const langName = (code?: string) => (code ? (LANG_NAMES[code] ?? code) : 'English');

  let posText = (code: string) => (posDisplay === 'code' ? code : posLabel(code));

  // Whether any tag pill will actually render — used to omit the tag container
  // entirely when empty, so it never contributes a stray leading gap.
  let showTags = $derived(
    sense.pos.length > 0 ||
      sense.misc.length > 0 ||
      sense.field.length > 0 ||
      sense.dialect.length > 0
  );
</script>

{#if showTags}
  <span class="sense-tags">
    {#each sense.pos as p}<Tag kind="pos" text={posText(p)} title={posLabel(p)} />{/each}
    {#each sense.field as f}<Tag kind="field" text={fieldLabel(f)} />{/each}
    {#each sense.misc as m}<Tag kind="misc" text={miscLabel(m)} />{/each}
    {#each sense.dialect as d}<Tag kind="dial" text={dialLabel(d)} />{/each}
  </span>
{/if}

<span class="sense-glosses"
  >{#each sense.glosses as g, i}{#if i > 0}<span class="sense-sep">{'; '}</span
      >{/if}{#if g.type && GLOSS_TYPE_PREFIX[g.type]}<span class="sense-gtype"
        >{`(${GLOSS_TYPE_PREFIX[g.type]}) `}</span
      >{/if}{g.text}{#if g.type === 'trademark'}™{/if}{/each}</span
>

{#each sense.info as note}<span class="sense-inf" lang="ja"> ({note})</span>{/each}

{#each sense.langSource as ls}
  <span class="sense-lsrc">
    ({ls.wasei ? 'wasei' : 'from'}
    {langName(ls.lang)}{#if ls.text}: <span lang={ls.lang || 'ja'}>{ls.text}</span>{/if})
  </span>
{/each}

{#if sense.xref.length > 0}
  <span class="sense-xref">
    {#each sense.xref as x, i}{#if i > 0},
      {/if}<button class="xref-link" lang="ja" onclick={() => lookupReference(x)}>{x}</button
      >{/each}
  </span>
{/if}

<style>
  /* Flex + gap so every pill is spaced identically, regardless of whether
     adjacent pills come from the same {#each} (no whitespace between them) or
     different tag groups (a collapsed whitespace node between them). A trailing
     margin separates the pills from the gloss that follows. */
  .sense-tags {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-right: 4px;
    vertical-align: middle;
  }

  .sense-gtype {
    font-size: 12px;
    color: var(--color-gray-400);
  }

  .sense-inf {
    font-size: 12px;
    color: var(--color-gray-400);
  }

  .sense-lsrc {
    font-size: 12px;
    color: var(--color-gray-400);
  }

  .sense-xref {
    font-size: 12px;
    color: var(--color-gray-400);
  }

  .sense-xref::before {
    content: '→ ';
  }

  .xref-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-primary-400);
    cursor: pointer;
    font: inherit;
  }

  .xref-link:hover {
    text-decoration: underline;
  }
</style>
