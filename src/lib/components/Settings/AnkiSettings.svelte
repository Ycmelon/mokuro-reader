<script lang="ts">
  import { page } from '$app/stores';
  import { AccordionItem, Button, Helper, Input, Label, Select } from 'flowbite-svelte';
  import { onMount } from 'svelte';
  import { miscSettings, updateAnkiServerSetting, type AnkiProtocol } from '$lib/settings/misc';
  import { settings, updateAnkiSetting } from '$lib/settings';
  import {
    getStatus,
    login as apiLogin,
    logout as apiLogout,
    sync as apiSync,
    UnauthorizedError,
    type AnkiServerStatus
  } from '$lib/anki-server/client';
  import { fetchConnectionData } from '$lib/anki-connect';
  import { defaultFieldTemplates } from '$lib/anki-server/cards';
  import { openConfigureFields } from '$lib/anki-server/configure-fields';
  import { showSnackbar } from '$lib/util';

  let cfg = $derived($miscSettings.ankiServerSettings);
  let protocol = $derived(cfg.protocol);

  // ── Anki Server (self-hosted) connection state ──────────────────────────────
  let serverUrl = $state($miscSettings.ankiServerSettings.serverUrl);
  let username = $state($miscSettings.ankiServerSettings.username);
  let password = $state('');
  let showPassword = $state(false);
  let serverStatus = $state<AnkiServerStatus | null>(null);
  let isLoggedIn = $derived(cfg.token !== '');
  let busy = $state(false); // login/logout in flight
  let syncing = $state(false); // manual sync in flight

  // ── AnkiConnect (local) connection state ────────────────────────────────────
  let ankiUrl = $state($settings.ankiConnectSettings.url);
  let isConnecting = $state(false);
  let connectionData = $derived($settings.ankiConnectSettings.connectionData);
  let isConnected = $derived(connectionData?.connected ?? false);

  let error = $state('');

  // ── Shared destination data, sourced from whichever protocol is active ───────
  let decks = $derived(
    protocol === 'server' ? (serverStatus?.decks ?? []) : (connectionData?.decks ?? [])
  );
  let models = $derived(
    protocol === 'server'
      ? (serverStatus?.models.map((m) => m.name) ?? [])
      : (connectionData?.models ?? [])
  );
  function fieldsFor(noteType: string): string[] {
    if (!noteType) return [];
    if (protocol === 'server') {
      return serverStatus?.models.find((m) => m.name === noteType)?.fields ?? [];
    }
    return connectionData?.modelFields[noteType] ?? [];
  }
  let noteFields = $derived(fieldsFor(cfg.noteType));
  // Destination controls appear once we've discovered note types for the protocol.
  let ready = $derived(models.length > 0);

  function setProtocol(value: AnkiProtocol) {
    updateAnkiServerSetting('protocol', value);
    error = '';
  }

  // ── Card destination handlers (shared) ──────────────────────────────────────
  function onNoteTypeChange(name: string) {
    updateAnkiServerSetting('noteType', name);
    // Seed sensible default templates the first time a note type is chosen, so
    // fields named e.g. "Word"/"Image" map themselves without opening the dialog.
    if (name && !$miscSettings.ankiServerSettings.fieldTemplates[name]) {
      updateAnkiServerSetting('fieldTemplates', {
        ...$miscSettings.ankiServerSettings.fieldTemplates,
        [name]: defaultFieldTemplates(fieldsFor(name))
      });
    }
  }

  // ── Anki Server actions ─────────────────────────────────────────────────────
  async function refreshServerStatus() {
    if (!cfg.token || !cfg.serverUrl) return;
    try {
      serverStatus = await getStatus(cfg.serverUrl, cfg.token);
      error = serverStatus.last_error ?? '';
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearServerSession();
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  function clearServerSession() {
    updateAnkiServerSetting('token', '');
    updateAnkiServerSetting('username', '');
    serverStatus = null;
  }

  async function handleServerLogin() {
    error = '';
    busy = true;
    try {
      const token = await apiLogin(serverUrl, username, password);
      updateAnkiServerSetting('serverUrl', serverUrl.replace(/\/+$/, ''));
      updateAnkiServerSetting('username', username);
      updateAnkiServerSetting('token', token);
      password = '';
      await refreshServerStatus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function handleServerSync() {
    error = '';
    syncing = true;
    try {
      await apiSync(cfg.serverUrl, cfg.token);
      await refreshServerStatus();
      showSnackbar('Synced with AnkiWeb');
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearServerSession();
        error = e.message;
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      syncing = false;
    }
  }

  async function handleServerLogout() {
    busy = true;
    try {
      await apiLogout(cfg.serverUrl, cfg.token);
    } finally {
      clearServerSession();
      error = '';
      busy = false;
    }
  }

  // ── AnkiConnect actions ─────────────────────────────────────────────────────
  async function handleConnect() {
    isConnecting = true;
    try {
      const data = await fetchConnectionData(ankiUrl || undefined);
      if (data) {
        updateAnkiSetting('connectionData', data);
        updateAnkiSetting('enabled', true);
      }
    } finally {
      isConnecting = false;
    }
  }

  function handleDisconnect() {
    updateAnkiSetting('connectionData', null);
    updateAnkiSetting('enabled', false);
  }

  // Load the server's decks/models whenever the server protocol is active and we
  // have a session but no status yet — covers both initial mount and switching
  // to Anki Server at runtime (so the card destination doesn't stay hidden).
  // Guarded by `!serverStatus` so it fetches once, not on every reactive tick.
  $effect(() => {
    if (protocol === 'server' && cfg.token && cfg.serverUrl && !serverStatus) {
      refreshServerStatus();
    }
  });

  onMount(() => {
    // Re-open a persisted AnkiConnect session (the server path is handled above).
    if (
      protocol === 'ankiconnect' &&
      ankiUrl &&
      !connectionData &&
      $settings.ankiConnectSettings.enabled
    ) {
      handleConnect();
    }
  });
</script>

<AccordionItem>
  {#snippet header()}Anki{/snippet}
  <div class="flex flex-col gap-5">
    <!-- Protocol selector -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Connect via:</Label>
      <Select
        placeholder=""
        value={protocol}
        onchange={(e) => setProtocol(e.currentTarget.value as AnkiProtocol)}
      >
        <option value="server">Anki Server — self-hosted, syncs to AnkiWeb</option>
        <option value="ankiconnect">AnkiConnect — local desktop Anki</option>
      </Select>
    </div>

    {#if protocol === 'server'}
      <!-- ── Anki Server connection ── -->
      <Helper>
        Create cards on a self-hosted server that syncs to AnkiWeb — no AnkiConnect or desktop Anki
        required. Make sure the server's
        <b class="text-primary-500">ANKI_SERVER_CORS_ORIGINS</b>
        includes this reader (<code class="text-primary-500">{$page.url.origin}</code>).
      </Helper>

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
        <div
          class="rounded bg-green-100 p-2 text-sm text-green-800 dark:bg-green-900 dark:text-green-200"
        >
          Logged in as <b>{cfg.username}</b>
          {#if serverStatus}
            <br />{serverStatus.decks.length} decks · {serverStatus.models.length} note types
          {/if}
        </div>

        {#if serverStatus?.full_sync_needed}
          <Helper class="text-amber-600 dark:text-amber-400">
            AnkiWeb needs a full sync ({serverStatus.full_sync_needed}). Resolve it before mining
            more cards.
          </Helper>
        {/if}

        <div class="flex gap-2">
          <Button
            size="sm"
            color="primary"
            outline
            onclick={handleServerSync}
            disabled={busy || syncing}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button
            size="sm"
            color="red"
            outline
            onclick={handleServerLogout}
            disabled={busy || syncing}
          >
            {busy ? 'Logging out…' : 'Logout'}
          </Button>
        </div>
      {:else}
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
                if (e.key === 'Enter') handleServerLogin();
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
          <Helper class="mt-1">
            Your password is sent to your server only and is never stored.
          </Helper>
        </div>

        <Button
          size="sm"
          color="primary"
          onclick={handleServerLogin}
          disabled={busy || !serverUrl || !username || !password}
        >
          {busy ? 'Logging in…' : 'Login'}
        </Button>
      {/if}
    {:else}
      <!-- ── AnkiConnect connection ── -->
      <Helper>
        Add this reader (<code class="text-primary-500">{$page.url.origin}</code>) to your
        AnkiConnect <b class="text-primary-500">webCorsOriginList</b> setting, then connect.
      </Helper>

      <div>
        <Label class="mb-1 text-gray-900 dark:text-white">AnkiConnect URL:</Label>
        <div class="flex gap-2">
          <Input
            type="text"
            placeholder="http://127.0.0.1:8765"
            bind:value={ankiUrl}
            onchange={() => {
              updateAnkiSetting('url', ankiUrl);
              if (isConnected) updateAnkiSetting('connectionData', null);
            }}
            class="flex-1"
          />
          {#if isConnected}
            <Button
              size="sm"
              color="red"
              outline
              onclick={handleDisconnect}
              class="whitespace-nowrap"
            >
              Disconnect
            </Button>
          {:else}
            <Button
              size="sm"
              color="primary"
              onclick={handleConnect}
              class="whitespace-nowrap"
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect'}
            </Button>
          {/if}
        </div>

        {#if isConnected}
          <div
            class="mt-2 rounded bg-green-100 p-2 text-sm text-green-800 dark:bg-green-900 dark:text-green-200"
          >
            Connected to AnkiConnect v{connectionData?.version}
            ({models.length} note types)
          </div>
        {:else if !isConnecting}
          <Helper class="mt-1">Connect to AnkiConnect to choose a card destination.</Helper>
        {/if}
      </div>
    {/if}

    <!-- ── Shared card destination ── -->
    {#if ready}
      <hr class="border-gray-200 dark:border-gray-700" />
      <div class="flex flex-col gap-4">
        <Label class="text-base font-semibold text-gray-900 dark:text-white">Card destination</Label
        >

        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Deck:</Label>
          <Select
            placeholder="Choose a deck…"
            value={cfg.deck}
            onchange={(e) => updateAnkiServerSetting('deck', e.currentTarget.value)}
          >
            {#each decks as deck}
              <option value={deck}>{deck}</option>
            {/each}
          </Select>
        </div>

        <div>
          <Label class="mb-1 text-gray-900 dark:text-white">Note type:</Label>
          <div class="flex gap-2">
            <Select
              placeholder="Choose a note type…"
              value={cfg.noteType}
              onchange={(e) => onNoteTypeChange(e.currentTarget.value)}
              class="flex-1"
            >
              {#each models as model}
                <option value={model}>{model}</option>
              {/each}
            </Select>
            {#if cfg.noteType && noteFields.length > 0}
              <Button
                size="sm"
                color="alternative"
                class="whitespace-nowrap"
                onclick={() => openConfigureFields(cfg.noteType, noteFields)}
              >
                Configure
              </Button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- ── Mining preferences (shared) ── -->
    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Crop tool:</Label>
      <Select
        placeholder=""
        value={cfg.cropMode}
        onchange={(e) =>
          updateAnkiServerSetting('cropMode', e.currentTarget.value as 'draw' | 'frame')}
      >
        <option value="frame">Frame — pan/zoom the page, move a window</option>
        <option value="draw">Draw — freeze the page, draw a box</option>
      </Select>
    </div>

    <div>
      <Label class="mb-1 text-gray-900 dark:text-white">Card language:</Label>
      <Select
        placeholder=""
        value={cfg.cardLanguage}
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
