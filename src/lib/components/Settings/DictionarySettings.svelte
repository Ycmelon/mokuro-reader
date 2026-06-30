<script lang="ts">
  import { AccordionItem, Button, Helper, Label, Progressbar, Range } from 'flowbite-svelte';
  import {
    bundledDictStatuses,
    ensureBundledDictionaries,
    redownloadBundledDictionary
  } from '$lib/dictionary/bundled';
  import { miscSettings, updateMiscSetting } from '$lib/settings';

  let statuses = $derived($bundledDictStatuses);
  let popupHeight = $derived($miscSettings.dictionaryPopupHeight ?? 30);

  function retry() {
    ensureBundledDictionaries().catch(() => {
      /* surfaced via store */
    });
  }

  function redownload(label: string) {
    if (!confirm(`Delete the stored ${label} dictionary and download it again?`)) return;
    redownloadBundledDictionary(label).catch(() => {
      /* surfaced via store */
    });
  }
</script>

<AccordionItem>
  {#snippet header()}Dictionaries{/snippet}

  <div class="flex flex-col gap-3">
    {#each statuses as status (status.label)}
      <div class="rounded border border-gray-200 px-3 py-2 dark:border-gray-600">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-gray-900 dark:text-white">{status.label}</span>
          {#if status.state === 'ready'}
            <Button size="xs" color="alternative" onclick={() => redownload(status.label)}>
              Redownload
            </Button>
          {:else if status.state === 'error'}
            <Button size="xs" onclick={retry}>Retry</Button>
          {/if}
        </div>

        {#if status.state === 'ready'}
          <Helper class="text-xs">{status.entryCount.toLocaleString()} entries · ready</Helper>
        {:else if status.state === 'downloading' || status.state === 'importing'}
          <div class="mt-1 flex flex-col gap-1">
            <Progressbar progress={status.progress} size="sm" />
            <Helper class="text-xs">{status.message}</Helper>
          </div>
        {:else if status.state === 'error'}
          <Helper color="red" class="text-xs">{status.message || 'Download failed.'}</Helper>
        {:else}
          <Helper class="text-xs">Waiting…</Helper>
        {/if}
      </div>
    {/each}

    <div class="mt-1">
      <Label class="mb-1 text-gray-900 dark:text-white">
        Definition popup height: {popupHeight}%
      </Label>
      <Range
        min={15}
        max={80}
        step={5}
        value={popupHeight}
        oninput={(e) =>
          updateMiscSetting('dictionaryPopupHeight', Number((e.target as HTMLInputElement).value))}
      />
      <Helper class="text-xs"
        >Portion of the screen the definition popup covers (default 30%).</Helper
      >
    </div>
  </div>
</AccordionItem>
