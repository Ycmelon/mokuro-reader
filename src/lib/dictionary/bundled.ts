import { writable } from 'svelte/store';
import { base } from '$app/paths';
import { dictDb } from './db';
import {
  importJmdictDictionary,
  importTermMetaDictionary,
  JMDICT_SCHEMA_VERSION,
  TERM_META_SCHEMA_VERSION
} from './import';
import { invalidateTermMetaCache } from './lookup';

/**
 * Bundled dictionaries ship in the app's static assets (same-origin, so no
 * CORS issues). On first launch each is fetched, parsed into IndexedDB, and
 * persisted forever. The user never imports them manually.
 */
export interface BundledDictionary {
  /** Display name shown in settings */
  label: string;
  /** Static asset filename under static/ */
  filename: string;
  /**
   * Prefix of the dictionary's index.json title, used to detect whether it has
   * already been imported (titles carry a volatile date suffix).
   */
  titlePrefix: string;
  /** Which importer to run: the jmdict term dictionary or a Yomitan term_meta
   *  (pitch/frequency) dictionary. */
  kind: 'jmdict' | 'termmeta';
  /** Required runtime shape for an already-imported dictionary. */
  schemaVersion: number;
}

export const BUNDLED_DICTIONARIES: BundledDictionary[] = [
  {
    label: 'Dictionary',
    filename: 'jmdict.zip',
    titlePrefix: 'JMdict (simplified)',
    kind: 'jmdict',
    schemaVersion: JMDICT_SCHEMA_VERSION
  },
  {
    label: 'Pitch Accents',
    filename: 'pitch-accents.zip',
    titlePrefix: 'JMdict Pitch Accents',
    kind: 'termmeta',
    schemaVersion: TERM_META_SCHEMA_VERSION
  }
];

export type BundledDictState = 'idle' | 'queued' | 'downloading' | 'importing' | 'ready' | 'error';

export interface BundledDictStatus {
  label: string;
  state: BundledDictState;
  /** 0–100 */
  progress: number;
  message: string;
  entryCount: number;
}

export const bundledDictStatuses = writable<BundledDictStatus[]>(
  BUNDLED_DICTIONARIES.map((d) => ({
    label: d.label,
    state: 'idle',
    progress: 0,
    message: '',
    entryCount: 0
  }))
);

function setStatus(label: string, patch: Partial<BundledDictStatus>): void {
  bundledDictStatuses.update((list) =>
    list.map((s) => (s.label === label ? { ...s, ...patch } : s))
  );
}

const inFlight = new Map<string, Promise<void>>();
const RETIRED_DICTIONARY_PREFIXES = ['JMdict Frequencies'];

/**
 * Ensures every bundled dictionary is present in IndexedDB. Idempotent and
 * concurrency-safe; safe to call on every app launch. Dictionaries are loaded
 * sequentially to avoid memory pressure from parsing two large zips at once.
 */
export async function ensureBundledDictionaries(): Promise<void> {
  // Ask the browser not to evict our IndexedDB data under storage pressure.
  // Fire-and-forget: awaiting persist() can stall for several seconds in some
  // browsers, which would delay the first download and leave every row queued.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {
      /* best effort */
    });
  }

  // Frequency metadata no longer participates in ranking or display. Remove
  // previously bundled copies as part of the same startup migration that stops
  // downloading the retired asset.
  for (const titlePrefix of RETIRED_DICTIONARY_PREFIXES) {
    await deleteByPrefix(titlePrefix);
  }

  // Mark everything not already confirmed ready as "queued" up front, so a
  // dictionary waiting its turn behind another download reads as queued rather
  // than sitting on a silent, indistinguishable "Waiting…".
  bundledDictStatuses.update((list) =>
    list.map((s) =>
      s.state === 'ready' ? s : { ...s, state: 'queued', progress: 0, message: 'Waiting to start…' }
    )
  );

  for (const dict of BUNDLED_DICTIONARIES) {
    await ensureOne(dict).catch((err) => {
      console.error(`Failed to load bundled dictionary "${dict.label}":`, err);
    });
  }
}

function ensureOne(dict: BundledDictionary): Promise<void> {
  const running = inFlight.get(dict.label);
  if (running) return running;

  const promise = loadDictionary(dict).catch((err) => {
    setStatus(dict.label, {
      state: 'error',
      progress: 0,
      message: err instanceof Error ? err.message : 'Download failed',
      entryCount: 0
    });
    inFlight.delete(dict.label);
    throw err;
  });
  inFlight.set(dict.label, promise);
  return promise;
}

/**
 * Clears a single stored dictionary and re-fetches it from scratch. Used by the
 * per-dictionary "Redownload" button in settings.
 */
export async function redownloadBundledDictionary(label: string): Promise<void> {
  const dict = BUNDLED_DICTIONARIES.find((d) => d.label === label);
  if (!dict) return;

  inFlight.delete(label);
  setStatus(label, {
    state: 'importing',
    progress: 0,
    message: 'Clearing old data…',
    entryCount: 0
  });
  await deleteByPrefix(dict.titlePrefix);
  // Hand straight off to the loader (which re-messages) — no 'idle' flash.
  return ensureOne(dict);
}

async function deleteByPrefix(titlePrefix: string): Promise<void> {
  const dicts = await dictDb.dictionaries.filter((d) => d.title.startsWith(titlePrefix)).toArray();
  if (dicts.length === 0) return;

  const idsToDelete = dicts.map((d) => d.id!).filter((id) => id !== undefined);
  const remainingCount = await dictDb.dictionaries.count();

  await dictDb.transaction(
    'rw',
    dictDb.dictionaries,
    dictDb.terms,
    dictDb.tags,
    dictDb.termMeta,
    async () => {
      // If we're deleting every dictionary in the DB, clear() is a single native
      // O(1) IDBObjectStore operation — orders of magnitude faster than a
      // cursor-based where().delete() across ~200k rows.
      if (idsToDelete.length === remainingCount) {
        await dictDb.terms.clear();
        await dictDb.tags.clear();
        await dictDb.termMeta.clear();
      } else {
        for (const id of idsToDelete) {
          await dictDb.terms.where('dictionaryId').equals(id).delete();
          await dictDb.tags.where('dictionaryId').equals(id).delete();
          await dictDb.termMeta.where('dictionaryId').equals(id).delete();
        }
      }
      await dictDb.dictionaries.bulkDelete(idsToDelete);
    }
  );
  invalidateTermMetaCache();
}

const MAX_ATTEMPTS = 2;

/**
 * A stored dictionary is only trustworthy if the number of term rows actually
 * in the DB matches its recorded entryCount. entryCount is written only after
 * every term bank is imported, so `entryCount > 0` already implies completion;
 * the count match additionally catches storage eviction. This rejects partial
 * imports (the "0 entries · ready" bug).
 */
async function verifyHealthy(titlePrefix: string, schemaVersion: number): Promise<number | null> {
  const record = await dictDb.dictionaries.filter((d) => d.title.startsWith(titlePrefix)).first();
  if (
    !record ||
    record.id === undefined ||
    record.entryCount <= 0 ||
    record.schemaVersion !== schemaVersion
  ) {
    return null;
  }
  // entryCount spans both tables (a pitch dictionary stores term_meta, not terms).
  const [terms, meta] = await Promise.all([
    dictDb.terms.where('dictionaryId').equals(record.id).count(),
    dictDb.termMeta.where('dictionaryId').equals(record.id).count()
  ]);
  return terms + meta === record.entryCount ? record.entryCount : null;
}

async function loadDictionary(dict: BundledDictionary): Promise<void> {
  // Surface the health-check phase so the row doesn't sit silently on "queued"
  // while the DB opens and the existing-data check runs.
  setStatus(dict.label, { state: 'importing', progress: 0, message: 'Checking existing data…' });
  const healthyCount = await verifyHealthy(dict.titlePrefix, dict.schemaVersion);
  if (healthyCount !== null) {
    setStatus(dict.label, {
      state: 'ready',
      progress: 100,
      message: 'Ready',
      entryCount: healthyCount
    });
    return;
  }

  // Either never imported or a corrupt/partial import — start clean and (re)fetch.
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // deleteByPrefix can churn through hundreds of thousands of rows on a
    // re-import; message it so the row doesn't look frozen.
    setStatus(dict.label, { state: 'importing', progress: 0, message: 'Preparing…' });
    await deleteByPrefix(dict.titlePrefix);
    try {
      setStatus(dict.label, {
        state: 'downloading',
        progress: 0,
        message: attempt > 1 ? 'Retrying download…' : 'Downloading…',
        entryCount: 0
      });

      const blob = await downloadWithProgress(`${base}/${dict.filename}`, (pct) => {
        setStatus(dict.label, {
          state: 'downloading',
          progress: pct,
          message: `Downloading… ${pct}%`
        });
      });

      setStatus(dict.label, { state: 'importing', progress: 0, message: 'Reading dictionary…' });

      const importer = dict.kind === 'jmdict' ? importJmdictDictionary : importTermMetaDictionary;
      await importer(blob, (pct, message) => {
        setStatus(dict.label, { state: 'importing', progress: pct, message });
      });

      // Confirm the import actually landed before declaring success.
      const count = await verifyHealthy(dict.titlePrefix, dict.schemaVersion);
      if (count === null) throw new Error('Import verification failed');

      setStatus(dict.label, { state: 'ready', progress: 100, message: 'Ready', entryCount: count });
      return;
    } catch (err) {
      lastError = err;
      console.warn(`Dictionary "${dict.label}" load attempt ${attempt} failed:`, err);
      await deleteByPrefix(dict.titlePrefix);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Dictionary load failed');
}

async function downloadWithProgress(url: string, onProgress: (pct: number) => void): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || total === 0) {
    // No streaming / unknown size — fall back to a plain blob download.
    return await response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(99, Math.round((received / total) * 100)));
    }
  }

  return new Blob(chunks as BlobPart[]);
}
