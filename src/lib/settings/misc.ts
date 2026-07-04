import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { isMobilePlatform } from '$lib/util/platform';

export type AiChatSettings = {
  openrouterApiKey: string;
  model: string;
  maxHistoryMessages: number;
  chatFontSize: number;
};

// Maps our logical card fields onto the chosen note type's field names. '' means
// the logical field isn't written to any note field. (Image is handled
// separately via `imageField`, since the server appends it as an <img>.)
export type AnkiCardFieldMap = {
  word: string;
  reading: string;
  meaning: string;
  sentence: string;
  extra: string;
};

export type AnkiServerSettings = {
  serverUrl: string; // base URL of the Python anki server, e.g. https://anki.example.com
  token: string; // bearer token from /login ('' = logged out)
  username: string; // AnkiWeb username, for display only ('' = logged out)
  // Card-mining crop tool: 'draw' = freeze the page and draw a box; 'frame' =
  // keep panning/zooming with a movable/resizable frame over the live page.
  cropMode: 'draw' | 'frame';
  // Language for AI-generated card meaning/extra (reading is always kana).
  cardLanguage: 'english' | 'japanese';
  // Card destination (all populated from GET /status once logged in).
  deck: string; // deck mined cards are filed into ('' = unset)
  noteType: string; // note type (model) name ('' = unset)
  fieldMap: AnkiCardFieldMap; // logical field → note field name
  imageField: string; // note field the cropped <img> is appended into ('' = none)
  markerTag: string; // tag added to every mined card, alongside series/volume
};

export type MiscSettings = {
  galleryLayout: 'grid' | 'list';
  gallerySorting: 'ASC' | 'DESC' | 'SMART';
  deviceRamGB: 4 | 8 | 16 | 32;
  turboMode: boolean;
  gdriveAutoReAuth: boolean;
  /** Height of the dictionary definition popup, in vh. */
  dictionaryPopupHeight: number;
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
  aiChatSettings: {
    openrouterApiKey: '',
    model: 'anthropic/claude-sonnet-4-6',
    maxHistoryMessages: 20,
    chatFontSize: 20
  },
  ankiServerSettings: {
    serverUrl: '',
    token: '',
    username: '',
    // Framing (movable window over a live page) suits touch; drawing a box on a
    // frozen page suits a mouse.
    cropMode: isMobilePlatform() ? 'frame' : 'draw',
    cardLanguage: 'english',
    deck: '',
    noteType: '',
    fieldMap: { word: '', reading: '', meaning: '', sentence: '', extra: '' },
    imageField: '',
    markerTag: 'mokuro'
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
          // fieldMap is one level deeper again — merge so a newly added logical
          // field defaults to '' instead of undefined for existing users.
          fieldMap: {
            ...defaultSettings.ankiServerSettings.fieldMap,
            ...parsedStored.ankiServerSettings?.fieldMap
          }
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
