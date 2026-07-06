import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import type { Entry } from '@zip.js/zip.js';

function readText(entry: Entry): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (entry as any).getData(new TextWriter()) as Promise<string>;
}
import { dictDb } from './db';
import { invalidateTermMetaCache } from './lookup';
import { posToRules, isObscureHeadword, isSearchOnlyHeadword } from './jmdict-tags';
import type { StoredTerm, StoredTermMeta, Sense, Headword, Gloss } from './types';

// ── jmdict-simplified term dictionary ────────────────────────────────────────
// The bundled asset (static/jmdict.zip, built by scripts/generate-jmdict-
// dictionary.py) is a chunked, trimmed form of jmdict-simplified. Each raw word
// keeps short keys; the JMdict → reader mapping lives here so it has a single
// source of truth.

/** `[text, infoTags, common01]` */
type RawHeadword = [string, string[], 0 | 1];

interface RawSense {
  p: string[];
  f: string[];
  m: string[];
  d: string[];
  n: string[];
  /** `[glossText, type|null]` */
  g: [string, string | null][];
  x: string[];
  /** `[lang, text|null, wasei01]` */
  l: [string, string | null, 0 | 1][];
}

interface RawWord {
  i: number;
  k: RawHeadword[];
  r: RawHeadword[];
  s: RawSense[];
}

// jmdict-simplified spells gloss types out in full; our union matches.
const GLOSS_TYPES = new Set(['literal', 'figurative', 'explanation', 'trademark']);

function toHeadword([text, tags, common]: RawHeadword): Headword {
  return {
    text,
    info: tags,
    obscure: isObscureHeadword(tags),
    hidden: isSearchOnlyHeadword(tags),
    priority: common === 1
  };
}

// Standard forms first, then priority, then the rest, with search-only forms
// last — so the primary writing and reading are always the first entries and
// hidden forms never become the fallback primary.
function sortHeadwords(list: Headword[]): Headword[] {
  return list.sort(
    (a, b) =>
      Number(a.hidden) - Number(b.hidden) ||
      Number(a.obscure) - Number(b.obscure) ||
      Number(b.priority) - Number(a.priority)
  );
}

function toSense(raw: RawSense, inheritedPos: string[]): Sense {
  const glosses: Gloss[] = raw.g.map(([text, type]) =>
    type && GLOSS_TYPES.has(type) ? { text, type: type as Gloss['type'] } : { text }
  );
  return {
    // JMdict omits part-of-speech on a sense when it repeats the previous one.
    pos: raw.p.length > 0 ? raw.p : inheritedPos,
    field: raw.f,
    misc: raw.m,
    dialect: raw.d,
    info: raw.n,
    glosses,
    xref: raw.x,
    langSource: raw.l.map(([lang, text, wasei]) => ({
      lang,
      ...(text != null ? { text } : {}),
      wasei: wasei === 1
    })),
    examples: []
  };
}

function wordToStoredTerm(w: RawWord, dictionaryId: number): StoredTerm {
  const writings = sortHeadwords(w.k.map(toHeadword));
  const readings = sortHeadwords(w.r.map(toHeadword));

  let prevPos: string[] = [];
  const senses = w.s.map((s) => {
    const sense = toSense(s, prevPos);
    prevPos = sense.pos;
    return sense;
  });

  const allPos = new Set<string>();
  for (const s of senses) for (const p of s.pos) allPos.add(p);

  const common = writings.some((h) => h.priority) || readings.some((h) => h.priority);
  const keys = [...new Set([...writings.map((h) => h.text), ...readings.map((h) => h.text)])];

  return {
    dictionaryId,
    sequence: w.i,
    keys,
    writings,
    readings,
    rules: posToRules(allPos),
    score: common ? 1 : 0,
    senses
  };
}

export async function importJmdictDictionary(
  file: Blob,
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  const zipReader = new ZipReader(new BlobReader(file));
  const entries = await zipReader.getEntries();

  onProgress?.(0, 'Reading dictionary index…');

  const indexEntry = entries.find((e) => e.filename === 'index.json');
  if (!indexEntry) throw new Error('No index.json found in zip');
  const index = JSON.parse(await readText(indexEntry)) as {
    format: string;
    title: string;
    revision: string;
  };
  if (index.format !== 'mokurod-jmdict-1')
    throw new Error(`Unsupported jmdict format "${index.format}"`);

  const existing = await dictDb.dictionaries.where('title').equals(index.title).first();
  if (existing?.complete) throw new Error(`"${index.title}" is already imported`);
  if (existing?.id !== undefined) {
    await dictDb.transaction('rw', dictDb.dictionaries, dictDb.terms, async () => {
      await dictDb.terms.where('dictionaryId').equals(existing.id!).delete();
      await dictDb.dictionaries.delete(existing.id!);
    });
  }

  const dictionaryId = await dictDb.dictionaries.add({
    title: index.title,
    revision: index.revision,
    format: 0,
    importedAt: new Date(),
    entryCount: 0,
    complete: false
  });

  const termBanks = entries
    .filter((e) => /^term_bank_\d+\.json$/.test(e.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  let totalTerms = 0;
  for (let i = 0; i < termBanks.length; i++) {
    onProgress?.(
      Math.round((i / termBanks.length) * 98),
      `Importing entries ${i + 1} of ${termBanks.length}…`
    );

    const rawWords: RawWord[] = JSON.parse(await readText(termBanks[i]));
    const terms = rawWords.map((w) => wordToStoredTerm(w, dictionaryId));

    // One bulkAdd per bank (~10k rows) instead of 500-row slices: Dexie commits
    // the whole array in a single transaction, so this is one IndexedDB round
    // trip per bank rather than ~20, cutting hundreds of commits off the import.
    await dictDb.terms.bulkAdd(terms);
    totalTerms += terms.length;
  }

  await zipReader.close();
  await dictDb.dictionaries.update(dictionaryId, { entryCount: totalTerms, complete: true });
  invalidateTermMetaCache();
  onProgress?.(100, `Imported ${totalTerms.toLocaleString()} entries`);
}

// ── Yomitan term_meta dictionaries (pitch accent / frequency) ────────────────
// These bundled dictionaries carry only term_meta_bank rows (no term banks); we
// keep the Yomitan importer for them so pitch and frequency data keep working.

// Yomitan term_meta_bank rows: [expression, mode, data].
type TermMetaEntry = [string, string, unknown];
type TagBankEntry = [string, string, number, string, number];

/**
 * Parses one Yomitan term_meta_bank row into a StoredTermMeta, or null for modes
 * we don't store. Pitch data is `{ reading, pitches: [{ position }] }`; frequency
 * data comes in several shapes.
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

export async function importTermMetaDictionary(
  file: Blob,
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  const zipReader = new ZipReader(new BlobReader(file));
  const entries = await zipReader.getEntries();

  onProgress?.(0, 'Reading dictionary index…');

  const indexEntry = entries.find((e) => e.filename === 'index.json');
  if (!indexEntry) throw new Error('No index.json found in zip');
  const index = JSON.parse(await readText(indexEntry)) as {
    title: string;
    revision: string;
    format: number;
  };

  const existing = await dictDb.dictionaries.where('title').equals(index.title).first();
  if (existing?.complete) throw new Error(`"${index.title}" is already imported`);
  if (existing?.id !== undefined) {
    await dictDb.transaction('rw', dictDb.dictionaries, dictDb.tags, dictDb.termMeta, async () => {
      await dictDb.tags.where('dictionaryId').equals(existing.id!).delete();
      await dictDb.termMeta.where('dictionaryId').equals(existing.id!).delete();
      await dictDb.dictionaries.delete(existing.id!);
    });
  }

  const dictionaryId = await dictDb.dictionaries.add({
    title: index.title,
    revision: index.revision,
    format: index.format,
    importedAt: new Date(),
    entryCount: 0,
    complete: false
  });

  // Tags (rarely present for pitch/freq, imported for completeness).
  const tagBankFiles = entries.filter((e) => /^tag_bank_\d+\.json$/.test(e.filename));
  for (const entry of tagBankFiles) {
    const tags: TagBankEntry[] = JSON.parse(await readText(entry));
    if (tags.length > 0) {
      await dictDb.tags.bulkAdd(
        tags.map(([name, category, order, notes, score]) => ({
          dictionaryId,
          name,
          category,
          order,
          notes,
          score
        }))
      );
    }
  }

  const metaBanks = entries
    .filter((e) => /^term_meta_bank_\d+\.json$/.test(e.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  let totalMeta = 0;
  for (let i = 0; i < metaBanks.length; i++) {
    onProgress?.(
      Math.round((i / metaBanks.length) * 98),
      `Importing data ${i + 1} of ${metaBanks.length}…`
    );
    const raw: TermMetaEntry[] = JSON.parse(await readText(metaBanks[i]));
    const metas: StoredTermMeta[] = [];
    for (const entry of raw) {
      const parsed = parseTermMeta(dictionaryId, entry);
      if (parsed) metas.push(parsed);
    }
    await dictDb.termMeta.bulkAdd(metas);
    totalMeta += metas.length;
  }

  await zipReader.close();
  await dictDb.dictionaries.update(dictionaryId, { entryCount: totalMeta, complete: true });
  invalidateTermMetaCache();
  onProgress?.(100, `Imported ${totalMeta.toLocaleString()} entries`);
}
