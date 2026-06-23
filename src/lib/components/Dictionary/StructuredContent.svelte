<script lang="ts">
  import type {
    StructuredContent,
    StructuredContentNode,
    StructuredContentStyle
  } from '$lib/dictionary/types';
  import Self from './StructuredContent.svelte';

  interface Props {
    content: StructuredContent | undefined;
  }

  let { content } = $props();

  // Mirrors Yomitan's _setStructuredContentElementStyle exactly.
  // Only margin{Top,Left,Right,Bottom} accept numbers (→ em); everything else is string.
  function toStyle(s: StructuredContentStyle | undefined): string {
    if (!s) return '';
    const p: string[] = [];

    const str = (prop: string, v: string | undefined) => {
      if (typeof v === 'string') p.push(`${prop}:${v}`);
    };
    const numOrStr = (prop: string, v: number | string | undefined) => {
      if (typeof v === 'number') p.push(`${prop}:${v}em`);
      else if (typeof v === 'string') p.push(`${prop}:${v}`);
    };

    str('font-style', s.fontStyle);
    str('font-weight', s.fontWeight);
    str('font-size', s.fontSize);
    str('color', s.color);
    str('background', s.background);
    str('background-color', s.backgroundColor);
    str('vertical-align', s.verticalAlign);
    str('text-align', s.textAlign);
    str('text-emphasis', s.textEmphasis);
    str('text-shadow', s.textShadow);
    str('border-color', s.borderColor);
    str('border-style', s.borderStyle);
    str('border-radius', s.borderRadius);
    str('border-width', s.borderWidth);
    str('clip-path', s.clipPath);
    str('word-break', s.wordBreak);
    str('white-space', s.whiteSpace);
    str('cursor', s.cursor);
    str('list-style-type', s.listStyleType);
    str('margin', s.margin);
    str('padding', s.padding);
    str('padding-top', s.paddingTop);
    str('padding-left', s.paddingLeft);
    str('padding-right', s.paddingRight);
    str('padding-bottom', s.paddingBottom);
    numOrStr('margin-top', s.marginTop);
    numOrStr('margin-left', s.marginLeft);
    numOrStr('margin-right', s.marginRight);
    numOrStr('margin-bottom', s.marginBottom);

    if (s.textDecorationLine) {
      const v = Array.isArray(s.textDecorationLine)
        ? s.textDecorationLine.join(' ')
        : s.textDecorationLine;
      p.push(`text-decoration-line:${v}`);
    }
    str('text-decoration-style', s.textDecorationStyle);
    str('text-decoration-color', s.textDecorationColor);

    return p.join(';');
  }

  // Build the attribute set for a node, including Yomitan's data-sc-* attributes.
  // Yomitan maps each `data` key `k` to the DOM attribute `data-sc-<kebab(k)>`
  // (e.g. {content:'glossary'} → data-sc-content, {class:'tag'} → data-sc-class).
  // This is what the dictionary's bundled styles.css targets.
  function buildAttrs(node: StructuredContentNode): Record<string, string> {
    const attrs: Record<string, string> = {};
    const style = toStyle(node.style);
    if (style) attrs.style = style;
    if (node.title) attrs.title = node.title;
    if (node.lang) attrs.lang = node.lang;
    if (node.data) {
      for (const [k, v] of Object.entries(node.data)) {
        const name = 'data-sc-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        attrs[name] = String(v);
      }
    }
    return attrs;
  }
</script>

{#if typeof content === 'string'}
  {content}
{:else if Array.isArray(content)}
  {#each content as child}
    <Self content={child} />
  {/each}
{:else if content !== null && content !== undefined && typeof content === 'object'}
  {#if 'type' in content && content.type === 'structured-content'}
    <Self content={content.content} />
  {:else if 'tag' in content}
    {@const node = content}
    {@const attrs = buildAttrs(node)}
    {#if node.tag === 'br'}
      <br />
    {:else if node.tag === 'ruby'}
      <ruby {...attrs}><Self content={node.content} /></ruby>
    {:else if node.tag === 'rt'}
      <rt {...attrs}><Self content={node.content} /></rt>
    {:else if node.tag === 'rp'}
      <rp {...attrs}><Self content={node.content} /></rp>
    {:else if node.tag === 'span'}
      <span {...attrs}><Self content={node.content} /></span>
    {:else if node.tag === 'div'}
      <div {...attrs}><Self content={node.content} /></div>
    {:else if node.tag === 'ul'}
      <ul {...attrs}><Self content={node.content} /></ul>
    {:else if node.tag === 'ol'}
      <ol {...attrs}><Self content={node.content} /></ol>
    {:else if node.tag === 'li'}
      <li {...attrs}><Self content={node.content} /></li>
    {:else if node.tag === 'table'}
      <table {...attrs}><Self content={node.content} /></table>
    {:else if node.tag === 'thead'}
      <thead {...attrs}><Self content={node.content} /></thead>
    {:else if node.tag === 'tbody'}
      <tbody {...attrs}><Self content={node.content} /></tbody>
    {:else if node.tag === 'tfoot'}
      <tfoot {...attrs}><Self content={node.content} /></tfoot>
    {:else if node.tag === 'tr'}
      <tr {...attrs}><Self content={node.content} /></tr>
    {:else if node.tag === 'td'}
      <td {...attrs} colspan={node.colSpan} rowspan={node.rowSpan}>
        <Self content={node.content} />
      </td>
    {:else if node.tag === 'th'}
      <th {...attrs} colspan={node.colSpan} rowspan={node.rowSpan}>
        <Self content={node.content} />
      </th>
    {:else if node.tag === 'details'}
      <details {...attrs} open={node.open}><Self content={node.content} /></details>
    {:else if node.tag === 'summary'}
      <summary {...attrs}><Self content={node.content} /></summary>
    {:else if node.tag === 'a'}
      <a {...attrs} href={node.href} target="_blank" rel="noopener noreferrer">
        <Self content={node.content} />
      </a>
    {:else if node.tag === 'img'}
      <img {...attrs} alt="" />
    {/if}
  {/if}
{/if}
