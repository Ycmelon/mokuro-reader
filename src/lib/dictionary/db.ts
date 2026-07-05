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
  }
}

export const dictDb = new DictionaryDatabase();
