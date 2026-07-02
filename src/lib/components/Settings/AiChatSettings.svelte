<script lang="ts">
  import { AccordionItem, Helper, Input, Label, Range, Select } from 'flowbite-svelte';
  import { miscSettings, updateAiChatSetting } from '$lib/settings/misc';

  let settings = $derived($miscSettings.aiChatSettings);

  let showKey = $state(false);

  // Same sizes as the reader's OCR font-size selector, minus 'auto'/'original'
  // (those are reader-specific concepts with no meaning for chat text).
  let chatFontSizes = [
    { value: '9', name: '9' },
    { value: '10', name: '10' },
    { value: '11', name: '11' },
    { value: '12', name: '12' },
    { value: '14', name: '14' },
    { value: '16', name: '16' },
    { value: '18', name: '18' },
    { value: '20', name: '20' },
    { value: '24', name: '24' },
    { value: '32', name: '32' },
    { value: '40', name: '40' },
    { value: '48', name: '48' },
    { value: '60', name: '60' }
  ];
</script>

<AccordionItem>
  {#snippet header()}Chat{/snippet}

  <div class="flex flex-col gap-4">
    <!-- API Key -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">OpenRouter API Key</Label>
      <div class="flex gap-2">
        <Input
          type={showKey ? 'text' : 'password'}
          value={settings.openrouterApiKey}
          placeholder="sk-or-..."
          oninput={(e) =>
            updateAiChatSetting('openrouterApiKey', (e.target as HTMLInputElement).value)}
          class="flex-1 font-mono text-sm"
        />
        <button
          type="button"
          onclick={() => (showKey = !showKey)}
          class="relative z-10 rounded border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {showKey ? 'Hide' : 'Show'}
        </button>
      </div>
      <Helper class="mt-1 text-xs">Get a key at openrouter.ai</Helper>
    </div>

    <!-- Chat font size -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Font size</Label>
      <Select
        items={chatFontSizes}
        value={String(settings.chatFontSize)}
        onchange={(e) =>
          updateAiChatSetting('chatFontSize', Number((e.target as HTMLInputElement).value))}
      />
    </div>

    <!-- Model -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Model</Label>
      <Input
        type="text"
        value={settings.model}
        placeholder="anthropic/claude-sonnet-4-6"
        oninput={(e) => updateAiChatSetting('model', (e.target as HTMLInputElement).value)}
        class="font-mono text-sm"
      />
      <Helper class="mt-1 text-xs">Any model ID from openrouter.ai/models</Helper>
    </div>

    <!-- Max history messages -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">
        Max history messages: {settings.maxHistoryMessages}
      </Label>
      <Range
        min={1}
        max={100}
        step={1}
        value={settings.maxHistoryMessages}
        oninput={(e) =>
          updateAiChatSetting('maxHistoryMessages', Number((e.target as HTMLInputElement).value))}
      />
      <Helper class="mt-1 text-xs">
        How many past messages to include with each request (default 20).
      </Helper>
    </div>
  </div>
</AccordionItem>
