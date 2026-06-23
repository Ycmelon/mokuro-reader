import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import type { Entry } from '@zip.js/zip.js';

function readText(entry: Entry): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (entry as any).getData(new TextWriter()) as Promise<string>;
}
import { dictDb } from './db';
import type { StoredTerm, StoredTag, Definition } from './types';

type TermBankEntry = [string, string, string, string, number, Definition[], number, string];
type TagBankEntry = [string, string, number, string, number];

const CHUNK_SIZE = 500;

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
        reading,
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

  await zipReader.close();
  // Mark complete only after every term bank is in — this is the integrity gate.
  await dictDb.dictionaries.update(dictionaryId, { entryCount: totalTerms, complete: true });
  onProgress?.(100, `Imported ${totalTerms.toLocaleString()} entries`);
}
