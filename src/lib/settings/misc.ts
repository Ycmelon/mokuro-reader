import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { isMobilePlatform } from '$lib/util/platform';
import type { FieldMapping } from '$lib/settings/settings';

export type AiChatSettings = {
  openrouterApiKey: string;
  model: string;
  maxHistoryMessages: number;
  chatFontSize: number;
};

// Which transport delivers mined cards. 'server' = the self-hosted Python server
// (POST /cards → AnkiWeb); 'ankiconnect' = a local AnkiConnect instance (addNote).
export type AnkiProtocol = 'server' | 'ankiconnect';

// Shared Anki config for the mining flow. Despite the name, this now covers BOTH
// protocols (the AnkiConnect side keeps only connection state in
// `settings.ankiConnectSettings`). Card destination + per-note-type field
// templates live here so the "Configure fields" UI is protocol-agnostic.
export type AnkiServerSettings = {
  protocol: AnkiProtocol; // which transport mined cards are sent through
  serverUrl: string; // base URL of the Python anki server, e.g. https://anki.example.com
  token: string; // bearer token from /login ('' = logged out)
  username: string; // AnkiWeb username, for display only ('' = logged out)
  // Card-mining crop tool: 'draw' = freeze the page and draw a box; 'frame' =
  // keep panning/zooming with a movable/resizable frame over the live page.
  cropMode: 'draw' | 'frame';
  // Language for AI-generated card meaning/extra (reading is always kana).
  cardLanguage: 'english' | 'japanese';
  // Card destination.
  deck: string; // deck mined cards are filed into ('' = unset)
  noteType: string; // note type (model) name ('' = unset)
  // Per-note-type field templates, keyed by note type name. Each field's template
  // is resolved from the mined card ({word},{reading},{meaning},{sentence},{extra},
  // {image},{series},{volume},{page}). {image} routes the cropped image into that
  // field. Replaces the old logical fieldMap + imageField.
  fieldTemplates: Record<string, FieldMapping[]>;
  // Tags added to every mined card, resolved from the mined vars ({series},
  // {volume}, {page}) plus any literal tags. Fully user-editable — e.g. the
  // default 'mokuro {series} {volume}' can be customised or cleared.
  tagsTemplate: string;
};

export type MiscSettings = {
  galleryLayout: 'grid' | 'list';
  gallerySorting: 'ASC' | 'DESC' | 'SMART';
  deviceRamGB: 4 | 8 | 16 | 32;
  turboMode: boolean;
  gdriveAutoReAuth: boolean;
  /** Height of the dictionary definition popup, in vh. */
  dictionaryPopupHeight: number;
  /** How pitch-accent info is drawn on dictionary readings. */
  pitchAccentDisplay: 'none' | 'downstep' | 'binary';
  aiChatSettings: AiChatSettings;
  ankiServerSettings: AnkiServerSettings;
};

export type MiscSettingsKey = keyof MiscSettings;

// Detect device memory and set default RAM config
function getDefaultRamSetting(): 4 | 8 | 16 | 32 {
  if (browser) {
    const deviceMemory = (navigator as any).deviceMemory;
    if (deviceMemory !== undefined) {
      // deviceMemory is capped at 8GB, but if it reports 8, assume 16GB+ is likely
      if (deviceMemory >= 8) return 16;
      if (deviceMemory >= 4) return 8;
      if (deviceMemory >= 2) return 4;
    }
  }
  return 4; // Conservative default
}

const defaultSettings: MiscSettings = {
  galleryLayout: 'grid',
  gallerySorting: 'SMART',
  deviceRamGB: getDefaultRamSetting(),
  turboMode: false, // Default to single-operation mode (patient users)
  gdriveAutoReAuth: true, // Keep users synced during long reading sessions
  dictionaryPopupHeight: 30,
  pitchAccentDisplay: 'downstep',
  aiChatSettings: {
    openrouterApiKey: '',
    model: 'anthropic/claude-sonnet-4-6',
    maxHistoryMessages: 20,
    chatFontSize: 20
  },
  ankiServerSettings: {
    protocol: 'server',
    serverUrl: '',
    token: '',
    username: '',
    // Framing (movable window over a live page) suits touch; drawing a box on a
    // frozen page suits a mouse.
    cropMode: isMobilePlatform() ? 'frame' : 'draw',
    cardLanguage: 'english',
    deck: '',
    noteType: '',
    fieldTemplates: {},
    tagsTemplate: 'mokuro {series} {volume}'
  }
};

const stored = browser ? window.localStorage.getItem('miscSettings') : undefined;
const parsedStored = stored ? JSON.parse(stored) : undefined;

// Merge over defaults so keys added in newer versions get their default value
// for users with an older stored object. Nested objects are merged one level
// deeper — a shallow spread would drop any newly added sub-keys (e.g.
// chatFontSize) for users with an existing stored value.
export const miscSettings = writable<MiscSettings>(
  parsedStored
    ? {
        ...defaultSettings,
        ...parsedStored,
        aiChatSettings: { ...defaultSettings.aiChatSettings, ...parsedStored.aiChatSettings },
        ankiServerSettings: {
          ...defaultSettings.ankiServerSettings,
          ...parsedStored.ankiServerSettings,
          // fieldTemplates is a per-note-type map; a shallow spread from the
          // stored value is correct (each note type's list is replaced wholesale).
          fieldTemplates: parsedStored.ankiServerSettings?.fieldTemplates ?? {}
        }
      }
    : defaultSettings
);

miscSettings.subscribe((miscSettings) => {
  if (browser) {
    window.localStorage.setItem('miscSettings', JSON.stringify(miscSettings));
  }
});

export function updateMiscSetting(key: MiscSettingsKey, value: any) {
  miscSettings.update((miscSettings) => {
    return {
      ...miscSettings,
      [key]: value
    };
  });
}

export function updateAiChatSetting<K extends keyof AiChatSettings>(
  key: K,
  value: AiChatSettings[K]
) {
  miscSettings.update((s) => ({
    ...s,
    aiChatSettings: { ...s.aiChatSettings, [key]: value }
  }));
}

export function updateAnkiServerSetting<K extends keyof AnkiServerSettings>(
  key: K,
  value: AnkiServerSettings[K]
) {
  miscSettings.update((s) => ({
    ...s,
    ankiServerSettings: { ...s.ankiServerSettings, [key]: value }
  }));
}

/** Drop the stored Anki-server session (expired/invalid token). Shared by the
 *  settings panel and the mine review dialog so a 401 anywhere logs out fully. */
export function clearAnkiServerSession() {
  miscSettings.update((s) => ({
    ...s,
    ankiServerSettings: { ...s.ankiServerSettings, token: '', username: '' }
  }));
}
