import 'fake-indexeddb/auto';
import { describe, expect, it, beforeAll } from 'vitest';
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { dictDb } from './db';
import { importJmdictDictionary } from './import';
import { findBestMatch } from './lookup';

// No Web Workers in the jsdom test environment — run zip codecs on the main thread.
configure({ useWebWorkers: false });

// Two real jmdict-simplified entries, trimmed to the bundled-asset shape.
const WORDS = [
  {
    i: 1358280,
    k: [
      ['食べる', [], 1],
      ['喰べる', ['rK'], 0],
      ['たべ得る', ['sK'], 0]
    ],
    r: [['たべる', [], 1]],
    s: [
      { p: ['v1', 'vt'], f: [], m: [], d: [], n: [], g: [['to eat', null]], x: [], l: [] },
      {
        p: [],
        f: [],
        m: ['pol'],
        d: [],
        n: [],
        g: [['to live on (e.g. a salary)', null]],
        x: [],
        l: []
      }
    ]
  },
  {
    i: 1000060,
    k: [['あの', [], 1]],
    r: [['あの', [], 1]],
    s: [
      {
        p: ['int'],
        f: [],
        m: ['uk'],
        d: [],
        n: [],
        g: [
          ['say', null],
          ['well', null]
        ],
        x: [],
        l: []
      }
    ]
  }
];

async function buildZip(): Promise<Blob> {
  const zw = new ZipWriter(new BlobWriter('application/zip'));
  await zw.add(
    'index.json',
    new TextReader(
      JSON.stringify({ format: 'mokurod-jmdict-1', title: 'JMdict (simplified)', revision: 'test' })
    )
  );
  await zw.add('term_bank_1.json', new TextReader(JSON.stringify(WORDS)));
  return zw.close();
}

beforeAll(async () => {
  await dictDb.delete();
  await dictDb.open();
  await importJmdictDictionary(await buildZip());
});

describe('importJmdictDictionary', () => {
  it('imports word-level rows keyed by every writing and reading', async () => {
    const tabe = await dictDb.terms.where('keys').equals('食べる').toArray();
    expect(tabe).toHaveLength(1);
    const w = tabe[0];
    expect(w.sequence).toBe(1358280);
    // Search-only forms stay in the lookup index so they still resolve.
    expect(w.keys.sort()).toEqual(['たべる', 'たべ得る', '喰べる', '食べる']);
    expect(w.rules).toBe('v1');
    // The rare 喰べる writing is flagged obscure; 食べる (common) is primary.
    expect(w.writings[0].text).toBe('食べる');
    expect(w.writings.find((h) => h.text === '喰べる')?.obscure).toBe(true);
    // The sK form is hidden (not displayed) and sorts last, never the primary.
    const searchOnly = w.writings.find((h) => h.text === 'たべ得る');
    expect(searchOnly?.hidden).toBe(true);
    expect(searchOnly?.obscure).toBe(false);
    expect(w.writings.at(-1)?.text).toBe('たべ得る');
  });

  it('resolves a search-only form to its entry', async () => {
    const res = await dictDb.terms.where('keys').equals('たべ得る').toArray();
    expect(res).toHaveLength(1);
    expect(res[0].sequence).toBe(1358280);
  });

  it('resolves part-of-speech inheritance onto later senses', async () => {
    const w = (await dictDb.terms.where('keys').equals('食べる').toArray())[0];
    // Second sense has empty partOfSpeech in the source; it inherits [v1, vt].
    expect(w.senses[1].pos).toEqual(['v1', 'vt']);
    expect(w.senses[1].misc).toEqual(['pol']);
  });

  it('deinflects a conjugated form to the imported entry with separated senses', async () => {
    const res = await findBestMatch('食べた', 0);
    expect(res).not.toBeNull();
    const entry = res!.state.results[0];
    expect(entry.expression).toBe('食べる');
    expect(entry.senses[0].pos).toEqual(['v1', 'vt']);
    expect(entry.senses[0].glosses[0].text).toBe('to eat');
    expect(entry.inflectionPath.length).toBeGreaterThan(0);
  });
});
