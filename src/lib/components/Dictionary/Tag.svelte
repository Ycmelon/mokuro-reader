<script lang="ts">
  import type { TagKind } from '$lib/dictionary/jmdict-tags';

  let { kind, text, title }: { kind: TagKind; text: string; title?: string } = $props();
</script>

<span class="dict-tag {kind}" {title}>{text}</span>

<style>
  /* Small pills matching 10ten's tag styling. Colours follow 10ten's theme-black
     palette: field=green, misc=blue, dial=pink; pos is a plain bordered chip. */
  .dict-tag {
    display: inline-block;
    font-size: 10px;
    line-height: 1.4;
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid;
    white-space: nowrap;
    vertical-align: middle;
  }

  .pos {
    border-color: rgba(255, 255, 255, 0.35);
    color: var(--color-gray-300);
  }

  .field {
    border-color: #43a047;
    color: #86d68b;
    background: rgba(67, 160, 71, 0.16);
  }

  .misc {
    border-color: #2698fb;
    color: #7cc2fc;
    background: rgba(38, 152, 251, 0.16);
  }

  .dial {
    border-color: #f24b59;
    color: #f6939a;
    background: rgba(242, 75, 89, 0.16);
  }
</style>
