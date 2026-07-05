import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import type { Entry } from '@zip.js/zip.js';

function readText(entry: Entry): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (entry as any).getData(new TextWriter()) as Promise<string>;
}
import { dictDb } from './db';
import { invalidateTermMetaCache } from './lookup';
import type { StoredTerm, StoredTag, StoredTermMeta, Definition } from './types';

type TermBankEntry = [string, string, string, string, number, Definition[], number, string];
type TagBankEntry = [string, string, number, string, number];

// Yomitan term_meta_bank rows: [expression, mode, data]. We consume pitch and
// frequency modes; the data shape depends on the mode.
type TermMetaEntry = [string, string, unknown];

const CHUNK_SIZE = 500;

/**
 * Parses one Yomitan term_meta_bank row into a StoredTermMeta, or null for modes
 * we don't store. Pitch data is `{ reading, pitches: [{ position }] }`; frequency
 * data comes in several shapes (bare number/string, `{ value, displayValue }`, or
 * a `[reading, data]` pair for reading-specific frequencies).
 */
function parseTermMeta(
  dictionaryId: number,
  [expression, mode, data]: TermMetaEntry
): StoredTermMeta | null {
  if (mode === 'pitch') {
    const d = data as { reading?: string; pitches?: { position?: number }[] };
    const positions = (d.pitches ?? [])
      .map((p) => p.position)
      .filter((p): p is number => typeof p === 'number');
    if (positions.length === 0) return null;
    return { dictionaryId, expression, mode: 'pitch', reading: d.reading, positions };
  }

  if (mode === 'freq') {
    let reading: string | undefined;
    let value: unknown = data;
    // Reading-specific frequency: [reading, freqData]
    if (Array.isArray(data) && data.length === 2 && typeof data[0] === 'string') {
      reading = data[0];
      value = data[1];
    }
    let frequency: string;
    let frequencyValue: number;
    if (typeof value === 'number') {
      frequencyValue = value;
      frequency = String(value);
    } else if (typeof value === 'string') {
      frequencyValue = Number.parseInt(value, 10) || 0;
      frequency = value;
    } else if (value && typeof value === 'object') {
      const v = value as { value?: number; displayValue?: string };
      frequencyValue = typeof v.value === 'number' ? v.value : 0;
      frequency = v.displayValue ?? String(v.value ?? '');
    } else {
      return null;
    }
    return { dictionaryId, expression, mode: 'freq', reading, frequency, frequencyValue };
  }

  return null;
}

export async function importYomitanDictionary(
  file: Blob,
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  const zipReader = new ZipReader(new BlobReader(file));
  const entries = await zipReader.getEntries();

  onProgress?.(0, 'Reading dictionary index…');

  const indexEntry = entries.find((e) => e.filename === 'index.json');
  if (!indexEntry) throw new Error('No index.json found in zip');

  const indexText = await readText(indexEntry);
  const index = JSON.parse(indexText) as { title: string; revision: string; format: number };

  if (index.format !== 3)
    throw new Error(`Unsupported dictionary format v${index.format} (need v3)`);

  const existing = await dictDb.dictionaries.where('title').equals(index.title).first();
  if (existing?.complete) throw new Error(`"${index.title}" is already imported`);
  // A record without `complete` is a leftover partial import — clear it and retry.
  if (existing?.id !== undefined) {
    await dictDb.transaction('rw', dictDb.dictionaries, dictDb.terms, dictDb.tags, async () => {
      await dictDb.terms.where('dictionaryId').equals(existing.id!).delete();
      await dictDb.tags.where('dictionaryId').equals(existing.id!).delete();
      await dictDb.dictionaries.delete(existing.id!);
    });
  }

  // Yomitan dictionaries may bundle a styles.css that styles structured content
  // via data-sc-* attributes (e.g. Jitendex's glossary cards).
  const stylesEntry = entries.find((e) => e.filename === 'styles.css');
  const styleCss = stylesEntry ? await readText(stylesEntry) : undefined;

  const dictionaryId = await dictDb.dictionaries.add({
    title: index.title,
    revision: index.revision,
    format: index.format,
    importedAt: new Date(),
    entryCount: 0,
    styleCss,
    complete: false
  });

  // Import tags
  const tagBankFiles = entries.filter((e) => /^tag_bank_\d+\.json$/.test(e.filename));
  const allTags: StoredTag[] = [];
  for (const entry of tagBankFiles) {
    const text = await readText(entry);
    const tags: TagBankEntry[] = JSON.parse(text);
    for (const [name, category, order, notes, score] of tags) {
      allTags.push({ dictionaryId, name, category, order, notes, score });
    }
  }
  if (allTags.length > 0) await dictDb.tags.bulkAdd(allTags);

  // Import terms
  const termBanks = entries
    .filter((e) => /^term_bank_\d+\.json$/.test(e.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  let totalTerms = 0;

  for (let i = 0; i < termBanks.length; i++) {
    const entry = termBanks[i];

    onProgress?.(
      Math.round((i / termBanks.length) * 90),
      `Importing term bank ${i + 1} of ${termBanks.length}…`
    );

    const text = await readText(entry);
    const rawTerms: TermBankEntry[] = JSON.parse(text);

    const terms: StoredTerm[] = rawTerms.map(
      ([expression, reading, definitionTags, rules, score, definitions, sequence, termTags]) => ({
        dictionaryId,
        expression,
        // Yomitan importer parity: an empty reading means "reads as written".
        // Storing '' would pile every kana-only term onto one index key.
        reading: reading.length > 0 ? reading : expression,
        definitionTags,
        rules,
        score,
        definitions,
        sequence,
        termTags
      })
    );

    for (let j = 0; j < terms.length; j += CHUNK_SIZE) {
      await dictDb.terms.bulkAdd(terms.slice(j, j + CHUNK_SIZE));
    }

    totalTerms += terms.length;
  }

  // Import term_meta banks (pitch accent / frequency), if present.
  const metaBanks = entries
    .filter((e) => /^term_meta_bank_\d+\.json$/.test(e.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  let totalMeta = 0;
  for (let i = 0; i < metaBanks.length; i++) {
    onProgress?.(90 + Math.round((i / metaBanks.length) * 8), `Importing pitch/frequency data…`);
    const raw: TermMetaEntry[] = JSON.parse(await readText(metaBanks[i]));
    const metas: StoredTermMeta[] = [];
    for (const entry of raw) {
      const parsed = parseTermMeta(dictionaryId, entry);
      if (parsed) metas.push(parsed);
    }
    for (let j = 0; j < metas.length; j += CHUNK_SIZE) {
      await dictDb.termMeta.bulkAdd(metas.slice(j, j + CHUNK_SIZE));
    }
    totalMeta += metas.length;
  }

  await zipReader.close();
  // entryCount is the integrity gate (compared against row counts on load), so
  // it must cover both tables — a pitch-only dictionary has 0 terms but many
  // term_meta rows.
  const entryCount = totalTerms + totalMeta;
  await dictDb.dictionaries.update(dictionaryId, { entryCount, complete: true });
  invalidateTermMetaCache();
  onProgress?.(100, `Imported ${entryCount.toLocaleString()} entries`);
}
