import Dexie, { type Table } from 'dexie';
import type { DictionaryMeta, StoredTerm, StoredTag } from './types';

class DictionaryDatabase extends Dexie {
  dictionaries!: Table<DictionaryMeta, number>;
  terms!: Table<StoredTerm, number>;
  tags!: Table<StoredTag, number>;

  constructor() {
    super('mokuro_dictionary');
    this.version(1).stores({
      dictionaries: '++id, title',
      terms: '++id, dictionaryId, expression, reading',
      tags: '++id, [dictionaryId+name]'
    });
  }
}

export const dictDb = new DictionaryDatabase();
