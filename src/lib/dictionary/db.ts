import Dexie, { type Table } from 'dexie';
import type { DictionaryMeta, StoredTerm, StoredTag, StoredTermMeta } from './types';

class DictionaryDatabase extends Dexie {
  dictionaries!: Table<DictionaryMeta, number>;
  terms!: Table<StoredTerm, number>;
  tags!: Table<StoredTag, number>;
  termMeta!: Table<StoredTermMeta, number>;

  constructor() {
    super('mokuro_dictionary');
    this.version(1).stores({
      dictionaries: '++id, title',
      terms: '++id, dictionaryId, expression, reading',
      tags: '++id, [dictionaryId+name]'
    });
    // v2 adds a `sequence` index so a lookup can pull in every writing/reading
    // of a matched lexical entry (Yomitan merge mode). Dexie auto-reindexes
    // existing rows on upgrade.
    this.version(2).stores({
      terms: '++id, dictionaryId, expression, reading, sequence'
    });
    // v3 adds term_meta rows (pitch accent / frequency) from Yomitan
    // term_meta_bank files, indexed by expression for per-lookup joins.
    this.version(3).stores({
      termMeta: '++id, dictionaryId, expression'
    });
    // v4/v5 move the term dictionary from Yomitan (Jitendex) to word-level
    // jmdict-simplified entries: each row is a whole JMdict word indexed by a
    // multiEntry `*keys` over all its writings/readings, replacing the old
    // per-(expression,reading) `expression`/`reading` indexes.
    //
    // The old-shape Jitendex rows are incompatible and discarded regardless.
    // Originally v4 kept the store and just changed its indexes — but that makes
    // IndexedDB build the new `*keys` multiEntry index over every existing row
    // *before* the upgrade callback can clear them. On devices still holding a
    // large Jitendex terms table (hundreds of thousands of rows) that reindex of
    // soon-to-be-deleted data hung for minutes on mobile ("stuck at Checking
    // existing data"). Deleting an object store is instant and skips the
    // reindex, so v4 drops `terms`/`tags` outright and v5 recreates them empty.
    // Devices already past v4 never re-run v4, so their data is untouched; only
    // v5 (a no-op schema match for them) applies. The bundled loader re-imports
    // JMdict fresh. Pitch/frequency dictionaries (termMeta) are untouched.
    this.version(4).stores({
      terms: null,
      tags: null
    });
    this.version(5)
      .stores({
        terms: '++id, dictionaryId, *keys, sequence',
        tags: '++id, [dictionaryId+name]'
      })
      .upgrade(async (tx) => {
        // Remove stale Jitendex dictionary meta so the loader re-imports JMdict.
        await tx
          .table('dictionaries')
          .filter((d: { title?: string }) => (d.title ?? '').startsWith('Jitendex'))
          .delete();
      });
  }
}

export const dictDb = new DictionaryDatabase();
