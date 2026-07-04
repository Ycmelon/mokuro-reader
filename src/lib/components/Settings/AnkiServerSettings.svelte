<script lang="ts">
  import { page } from '$app/stores';
  import { AccordionItem, Button, Helper, Input, Label, Select } from 'flowbite-svelte';
  import { onMount } from 'svelte';
  import { miscSettings, updateAnkiServerSetting, type AnkiCardFieldMap } from '$lib/settings/misc';
  import {
    getStatus,
    login as apiLogin,
    logout as apiLogout,
    sync as apiSync,
    UnauthorizedError,
    type AnkiServerStatus
  } from '$lib/anki-server/client';
  import { showSnackbar } from '$lib/util';

  let settings = $derived($miscSettings.ankiServerSettings);
  let isLoggedIn = $derived(settings.token !== '');

  // Form state (server URL persists as the user types; password never leaves the field).
  let serverUrl = $state($miscSettings.ankiServerSettings.serverUrl);
  let username = $state($miscSettings.ankiServerSettings.username);
  let password = $state('');
  let showPassword = $state(false);

  let busy = $state(false); // login/logout in flight
  let syncing = $state(false); // manual sync in flight (kept separate so only the pressed button shows a loading label)
  let error = $state('');
  let status = $state<AnkiServerStatus | null>(null);

  // Fields of the currently-selected note type, for the mapping dropdowns.
  let modelFields = $derived(
    status?.models.find((m) => m.name === settings.noteType)?.fields ?? []
  );

  // The logical card fields, paired with the label shown in the mapping table.
  const logicalRows: { key: keyof AnkiCardFieldMap; label: string }[] = [
    { key: 'word', label: 'Word' },
    { key: 'reading', label: 'Reading' },
    { key: 'meaning', label: 'Meaning' },
    { key: 'sentence', label: 'Sentence' },
    { key: 'extra', label: 'Extra' }
  ];

  function updateFieldMap(key: keyof AnkiCardFieldMap, value: string) {
    updateAnkiServerSetting('fieldMap', { ...settings.fieldMap, [key]: value });
  }

  function onNoteTypeChange(name: string) {
    // Field names differ per note type, so a stale mapping would be meaningless.
    updateAnkiServerSetting('noteType', name);
    updateAnkiServerSetting('fieldMap', {
      word: '',
      reading: '',
      meaning: '',
      sentence: '',
      extra: ''
    });
    updateAnkiServerSetting('imageField', '');
  }

  async function refreshStatus() {
    if (!settings.token || !settings.serverUrl) return;
    try {
      status = await getStatus(settings.serverUrl, settings.token);
      error = status.last_error ?? '';
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        // Token no longer valid — drop it and return to the login form.
        clearSession();
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  function clearSession() {
    updateAnkiServerSetting('token', '');
    updateAnkiServerSetting('username', '');
    status = null;
  }

  async function handleLogin() {
    error = '';
    busy = true;
    try {
      const token = await apiLogin(serverUrl, username, password);
      updateAnkiServerSetting('serverUrl', serverUrl.replace(/\/+$/, ''));
      updateAnkiServerSetting('username', username);
      updateAnkiServerSetting('token', token);
      password = '';
      await refreshStatus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function handleSync() {
    error = '';
    syncing = true;
    try {
      await apiSync(settings.serverUrl, settings.token);
      await refreshStatus();
      showSnackbar('Synced with AnkiWeb');
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearSession();
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      syncing = false;
    }
  }

  async function handleLogout() {
    busy = true;
    try {
      await apiLogout(settings.serverUrl, settings.token);
    } finally {
      clearSession();
      error = '';
      busy = false;
    }
  }

  onMount(() => {
    // Verify a persisted session on load (parallels AnkiConnect's auto-connect).
    if (settings.token && settings.serverUrl) {
      refreshStatus();
    }
  });
</script>

<AccordionItem>
  {#snippet header()}Anki Server{/snippet}
  <div class="flex flex-col gap-5">
    <Helper>
      Create Anki cards on a self-hosted server that syncs to AnkiWeb — no AnkiConnect or desktop
      Anki required. Make sure the server's <b class="text-primary-500">ANKI_SERVER_CORS_ORIGINS</b>
      includes this reader (<code class="text-primary-500">{$page.url.origin}</code>).
    </Helper>

    <!-- Server URL -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Server URL:</Label>
      <Input
        type="url"
        placeholder="https://anki.example.com"
        bind:value={serverUrl}
        disabled={isLoggedIn || busy}
        onchange={() => updateAnkiServerSetting('serverUrl', serverUrl.replace(/\/+$/, ''))}
        class="flex-1"
      />
    </div>

    {#if isLoggedIn}
      <!-- Logged-in state -->
      <div
        class="rounded bg-green-100 p-2 text-sm text-green-800 dark:bg-green-900 dark:text-green-200"
      >
        Logged in as <b>{settings.username}</b>
        {#if status}
          <br />{status.decks.length} decks · {status.models.length} note types
        {/if}
      </div>

      {#if status?.full_sync_needed}
        <Helper class="text-amber-600 dark:text-amber-400">
          AnkiWeb needs a full sync ({status.full_sync_needed}). Resolve it before mining more
          cards.
        </Helper>
      {/if}

      <div class="flex gap-2">
        <Button size="sm" color="primary" outline onclick={handleSync} disabled={busy || syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button size="sm" color="red" outline onclick={handleLogout} disabled={busy || syncing}>
          {busy ? 'Logging out…' : 'Logout'}
        </Button>
      </div>

      {#if status}
        <!-- Card destination: where mined cards are filed and how our logical
             fields map onto the chosen note type. -->
        <hr class="border-gray-200 dark:border-gray-700" />
        <div class="flex flex-col gap-4">
          <Label class="text-base font-semibold text-gray-900 dark:text-white">
            Card destination
          </Label>

          <div>
            <Label class="mb-1 text-gray-900 dark:text-white">Deck:</Label>
            <Select
              placeholder="Choose a deck…"
              value={settings.deck}
              onchange={(e) => updateAnkiServerSetting('deck', e.currentTarget.value)}
            >
              {#each status.decks as deck}
                <option value={deck}>{deck}</option>
              {/each}
            </Select>
          </div>

          <div>
            <Label class="mb-1 text-gray-900 dark:text-white">Note type:</Label>
            <Select
              placeholder="Choose a note type…"
              value={settings.noteType}
              onchange={(e) => onNoteTypeChange(e.currentTarget.value)}
            >
              {#each status.models as model}
                <option value={model.name}>{model.name}</option>
              {/each}
            </Select>
          </div>

          {#if settings.noteType && modelFields.length > 0}
            <div class="flex flex-col gap-2">
              <Label class="mb-1 text-gray-900 dark:text-white">Field mapping:</Label>
              <Helper
                >Each card field goes into the note field you pick. Leave as “—” to skip.</Helper
              >
              {#each logicalRows as row}
                <div class="flex items-center gap-2">
                  <span class="w-20 shrink-0 text-sm text-gray-700 dark:text-gray-300">
                    {row.label}
                  </span>
                  <Select
                    class="flex-1"
                    placeholder=""
                    value={settings.fieldMap[row.key]}
                    onchange={(e) => updateFieldMap(row.key, e.currentTarget.value)}
                  >
                    <option value="">—</option>
                    {#each modelFields as field}
                      <option value={field}>{field}</option>
                    {/each}
                  </Select>
                </div>
              {/each}
              <div class="flex items-center gap-2">
                <span class="w-20 shrink-0 text-sm text-gray-700 dark:text-gray-300">Image</span>
                <Select
                  class="flex-1"
                  placeholder=""
                  value={settings.imageField}
                  onchange={(e) => updateAnkiServerSetting('imageField', e.currentTarget.value)}
                >
                  <option value="">—</option>
                  {#each modelFields as field}
                    <option value={field}>{field}</option>
                  {/each}
                </Select>
              </div>
            </div>
          {/if}

          <div>
            <Label class="mb-1 text-gray-900 dark:text-white">Tag:</Label>
            <Input
              placeholder="mokuro"
              value={settings.markerTag}
              onchange={(e) => updateAnkiServerSetting('markerTag', e.currentTarget.value.trim())}
            />
            <Helper class="mt-1">
              Added to every mined card, alongside the series and volume titles.
            </Helper>
          </div>
        </div>
      {/if}
    {:else}
      <!-- Login form -->
      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">AnkiWeb email:</Label>
        <Input
          type="email"
          placeholder="you@example.com"
          bind:value={username}
          disabled={busy}
          autocomplete="username"
        />
      </div>
      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">AnkiWeb password:</Label>
        <div class="flex gap-2">
          <Input
            type={showPassword ? 'text' : 'password'}
            bind:value={password}
            disabled={busy}
            autocomplete="current-password"
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') handleLogin();
            }}
            class="flex-1"
          />
          <button
            type="button"
            onclick={() => (showPassword = !showPassword)}
            class="relative z-10 rounded border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <Helper class="mt-1">Your password is sent to your server only and is never stored.</Helper>
      </div>

      <Button
        size="sm"
        color="primary"
        onclick={handleLogin}
        disabled={busy || !serverUrl || !username || !password}
      >
        {busy ? 'Logging in…' : 'Login'}
      </Button>
    {/if}

    <!-- Crop tool style (used when mining a card from a dictionary entry) -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Crop tool:</Label>
      <Select
        placeholder=""
        value={settings.cropMode}
        onchange={(e) =>
          updateAnkiServerSetting('cropMode', e.currentTarget.value as 'draw' | 'frame')}
      >
        <option value="frame">Frame — pan/zoom the page, move a window</option>
        <option value="draw">Draw — freeze the page, draw a box</option>
      </Select>
    </div>

    <!-- Language for AI-generated card meaning/extra (reading is always kana) -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Card language:</Label>
      <Select
        placeholder=""
        value={settings.cardLanguage}
        onchange={(e) =>
          updateAnkiServerSetting('cardLanguage', e.currentTarget.value as 'english' | 'japanese')}
      >
        <option value="english">English — meaning &amp; notes in English</option>
        <option value="japanese">Japanese — meaning &amp; notes in Japanese</option>
      </Select>
    </div>

    {#if error}
      <div class="rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-900 dark:text-red-200">
        {error}
      </div>
    {/if}
  </div>
</AccordionItem>
