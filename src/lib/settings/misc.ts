import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type AiChatSettings = {
  openrouterApiKey: string;
  model: string;
  maxHistoryMessages: number;
  chatFontSize: number;
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
  }
};

const stored = browser ? window.localStorage.getItem('miscSettings') : undefined;
const parsedStored = stored ? JSON.parse(stored) : undefined;

// Merge over defaults so keys added in newer versions get their default value
// for users with an older stored object. aiChatSettings is merged one level
// deeper since it's a nested object — a shallow spread would drop any newly
// added sub-keys (e.g. chatFontSize) for users with an existing stored value.
export const miscSettings = writable<MiscSettings>(
  parsedStored
    ? {
        ...defaultSettings,
        ...parsedStored,
        aiChatSettings: { ...defaultSettings.aiChatSettings, ...parsedStored.aiChatSettings }
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
