<script lang="ts">
  import type { TagKind } from '$lib/dictionary/jmdict-tags';

  let { kind, text, title }: { kind: TagKind; text: string; title?: string } = $props();
</script>

<span class="dict-tag {kind}" {title}>{text}</span>

<style>
  /* Small pills matching 10ten's tag styling. Theme-semantic accents tint the
     label, border, and background; mixing the label toward the popup foreground
     keeps the coloured text readable across both light and dark themes. */
  .dict-tag {
    --dict-tag-accent: var(--color-gray-600);

    display: inline-block;
    font-size: 10px;
    line-height: 1.4;
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--dict-tag-accent) 70%, currentColor);
    background: color-mix(in srgb, var(--dict-tag-accent) 12%, transparent);
    color: color-mix(in srgb, var(--dict-tag-accent) 35%, var(--color-gray-50));
    white-space: nowrap;
    vertical-align: middle;
  }

  .pos {
    border-color: color-mix(in srgb, currentColor 60%, transparent);
    background: transparent;
    color: var(--color-gray-300);
  }

  .field {
    --dict-tag-accent: var(--color-green-500);
  }

  .misc {
    --dict-tag-accent: var(--color-blue-500);
  }

  .dial {
    --dict-tag-accent: var(--color-red-500);
  }
</style>
