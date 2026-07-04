/**
 * AnkiConnect integration — now scoped to what the unified Anki-mining flow needs:
 * connecting, discovering decks/models/fields, and adding notes. Card building and
 * the review UI live elsewhere (`$lib/anki-server/*`). The legacy in-reader capture
 * (double-tap → cropper modal → create/update) has been removed.
 *
 * The CORS permission request pattern is based on code from Mangatan-WebUI
 * by KolbyML, licensed under Mozilla Public License 2.0.
 * https://github.com/KolbyML/Mangatan-WebUI
 */

import type { AnkiConnectionData } from '$lib/settings/settings';
import { settings } from '$lib/settings';
import { showSnackbar } from '$lib/util';
import { get } from 'svelte/store';

export * from './cropper';

/** Volume identity used when generating image filenames / metadata. */
export type VolumeMetadata = {
  seriesTitle?: string;
  volumeTitle?: string;
  coverImage?: string; // Base64 data URL of the volume cover/thumbnail
};

export async function blobToBase64(blob: Blob) {
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export async function imageResize(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  maxWidth: number,
  maxHeight: number
): Promise<OffscreenCanvas> {
  return new Promise((resolve, reject) => {
    const widthRatio = maxWidth <= 0 ? 1 : maxWidth / canvas.width;
    const heightRatio = maxHeight <= 0 ? 1 : maxHeight / canvas.height;
    const ratio = Math.min(1, Math.min(widthRatio, heightRatio));

    if (ratio < 1) {
      const newWidth = canvas.width * ratio;
      const newHeight = canvas.height * ratio;
      createImageBitmap(canvas, {
        resizeWidth: newWidth,
        resizeHeight: newHeight,
        resizeQuality: 'high'
      })
        .then((sprite) => {
          canvas.width = newWidth;
          canvas.height = newHeight;
          ctx.drawImage(sprite, 0, 0);
          resolve(canvas);
        })
        .catch((e) => reject(e));
    } else {
      resolve(canvas);
    }
  });
}

/**
 * Fetches connection data from AnkiConnect including decks, models, and fields.
 * Also detects if running on AnkiConnect Android by testing createDeck support.
 */
export async function fetchConnectionData(testUrl?: string): Promise<AnkiConnectionData | null> {
  const url = testUrl || get(settings).ankiConnectSettings.url || 'http://127.0.0.1:8765';

  try {
    // Test connection first
    const versionResult = await testConnection(url);
    if (!versionResult.success) {
      showSnackbar(versionResult.message);
      return null;
    }

    // Fetch deck names
    const decks = await ankiConnectRaw(url, 'deckNames', {});
    if (!decks) {
      showSnackbar('Failed to fetch deck names');
      return null;
    }

    // Fetch model names
    const models = await ankiConnectRaw(url, 'modelNames', {});
    if (!models) {
      showSnackbar('Failed to fetch model names');
      return null;
    }

    // Fetch field names for each model
    const modelFields: Record<string, string[]> = {};
    for (const model of models) {
      const fields = await ankiConnectRaw(url, 'modelFieldNames', { modelName: model });
      if (fields) {
        modelFields[model] = fields;
      }
    }

    // Detect Android by trying to create a temporary deck
    let isAndroid = false;
    const tempDeckName = `__mokuro_test_${Date.now()}`;
    const createResult = await ankiConnectRaw(url, 'createDeck', { deck: tempDeckName });

    if (createResult === null) {
      // createDeck failed - likely Android
      isAndroid = true;
    } else {
      // createDeck succeeded - delete the temp deck (desktop only)
      await ankiConnectRaw(url, 'deleteDecks', { decks: [tempDeckName], cardsToo: true });
    }

    return {
      connected: true,
      version: versionResult.version,
      decks,
      models,
      modelFields,
      lastConnected: new Date().toISOString(),
      isAndroid
    };
  } catch (e: any) {
    showSnackbar(`Connection failed: ${e?.message ?? String(e)}`);
    return null;
  }
}

/**
 * Raw AnkiConnect call without showing errors (for internal use).
 */
async function ankiConnectRaw(
  url: string,
  action: string,
  params: Record<string, any>
): Promise<any> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, params, version: 6 })
    });
    const json = await res.json();
    if (json.error) {
      return null;
    }
    return json.result;
  } catch {
    return null;
  }
}

export type ConnectionTestResult = {
  success: boolean;
  error?: 'network' | 'cors' | 'invalid_response' | 'anki_error' | 'permission_denied';
  message: string;
  version?: number;
};

/**
 * Requests permission from AnkiConnect.
 * This triggers a popup in Anki asking the user to grant permission to this website.
 * Returns true if permission was granted, false otherwise.
 */
async function requestAnkiPermission(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'requestPermission', version: 6 })
    });
    const json = await res.json();
    return json.result?.permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Tests the AnkiConnect connection and returns detailed error information.
 * Uses the "version" action which is a simple ping that returns the API version.
 * If CORS blocks the request, attempts to request permission from Anki.
 */
export async function testConnection(testUrl?: string): Promise<ConnectionTestResult> {
  const url = testUrl || get(settings).ankiConnectSettings.url || 'http://127.0.0.1:8765';

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'version', version: 6 })
    });

    const json = await res.json();

    if (json.error) {
      return {
        success: false,
        error: 'anki_error',
        message: `Anki error: ${json.error}`
      };
    }

    return {
      success: true,
      message: `Connected to AnkiConnect v${json.result}`,
      version: json.result
    };
  } catch (e: any) {
    // Distinguish between different error types
    const errorMessage = e?.message ?? String(e);

    // CORS errors typically show as "Failed to fetch" or similar network errors
    if (e instanceof TypeError && errorMessage.includes('Failed to fetch')) {
      // Try requesting permission from Anki - this triggers a popup in Anki
      const granted = await requestAnkiPermission(url);

      if (granted) {
        // Permission granted, retry the connection
        return testConnection(testUrl);
      }

      // Permission not granted or request failed
      return {
        success: false,
        error: 'cors',
        message:
          'Connection blocked. If Anki showed a permission popup, click "Yes" and try again. Otherwise, add this site to webCorsOriginList in AnkiConnect settings.'
      };
    }

    if (errorMessage.includes('NetworkError') || errorMessage.includes('net::')) {
      return {
        success: false,
        error: 'network',
        message: 'Network error: Check that Anki is running and the URL is correct'
      };
    }

    return {
      success: false,
      error: 'invalid_response',
      message: `Connection failed: ${errorMessage}`
    };
  }
}

/**
 * Invoke an AnkiConnect action. Shows a snackbar and returns undefined on error
 * (unless `silent`), so callers that need to detect failure should check for a
 * falsy result. Retries once through a permission request on CORS failure.
 */
export async function ankiConnect(
  action: string,
  params: Record<string, any>,
  options?: { silent?: boolean; retried?: boolean }
) {
  const url = get(settings).ankiConnectSettings.url || 'http://127.0.0.1:8765';

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, params, version: 6 })
    });
    const json = await res.json();

    if (json.error) {
      throw new Error(json.error);
    }

    return json.result;
  } catch (e: any) {
    // Skip showing errors if silent mode
    if (options?.silent) {
      return undefined;
    }

    // Provide more helpful error messages
    const errorMessage = e?.message ?? String(e);

    if (e instanceof TypeError && errorMessage.includes('Failed to fetch')) {
      // Try requesting permission if we haven't already retried
      if (!options?.retried) {
        const granted = await requestAnkiPermission(url);
        if (granted) {
          // Retry the request
          return ankiConnect(action, params, { ...options, retried: true });
        }
      }

      showSnackbar(
        'Error: Cannot connect to AnkiConnect. If Anki showed a permission popup, click "Yes" and try again.'
      );
    } else {
      showSnackbar(`Error: ${errorMessage}`);
    }
  }
}
