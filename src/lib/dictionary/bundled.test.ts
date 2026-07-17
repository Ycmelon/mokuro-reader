import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { dictDb } from './db';
import { ensureBundledDictionaries } from './bundled';

configure({ useWebWorkers: false });

async function zip(entries: Record<string, unknown>): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [filename, contents] of Object.entries(entries)) {
    await writer.add(filename, new TextReader(JSON.stringify(contents)));
  }
  return writer.close();
}

describe('bundled dictionary schema migration', () => {
  beforeEach(async () => {
    await dictDb.delete();
    await dictDb.open();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces a healthy v1 JMdict record instead of returning ready early', async () => {
    const oldDictionaryId = await dictDb.dictionaries.add({
      title: 'JMdict (simplified) old',
      revision: 'old',
      format: 0,
      importedAt: new Date(),
      entryCount: 1,
      complete: true,
      schemaVersion: 1
    });
    await dictDb.terms.add({
      dictionaryId: oldDictionaryId,
      sequence: 1,
      keys: ['旧'],
      writings: [{ text: '旧', obscure: false, hidden: false, priority: false, p: [], info: [] }],
      readings: [
        {
          text: 'きゅう',
          obscure: false,
          hidden: false,
          priority: false,
          p: [],
          app: 1,
          info: []
        }
      ],
      rules: '',
      senses: []
    });
    const retiredFrequencyId = await dictDb.dictionaries.add({
      title: 'JMdict Frequencies old',
      revision: 'old',
      format: 3,
      importedAt: new Date(),
      entryCount: 1,
      complete: true,
      schemaVersion: 1
    });
    await dictDb.termMeta.add({
      dictionaryId: retiredFrequencyId,
      expression: '旧',
      mode: 'freq',
      frequency: '1',
      frequencyValue: 1
    });

    const jmdict = await zip({
      'index.json': {
        format: 'mokurod-jmdict-2',
        title: 'JMdict (simplified)',
        revision: 'new'
      },
      'term_bank_1.json': [
        {
          i: 2,
          k: [['新', [], 1, ['i1']]],
          r: [['しん', [], 1, ['i1'], 1]],
          s: [{ p: [], f: [], m: [], d: [], n: [], g: [['new', null]], x: [], l: [] }]
        }
      ]
    });
    const pitch = await zip({
      'index.json': { title: 'JMdict Pitch Accents', revision: 'test', format: 3 },
      'term_meta_bank_1.json': [['新', 'pitch', { reading: 'しん', pitches: [{ position: 1 }] }]]
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/jmdict.zip') ? jmdict : pitch;
        return new Response(body, {
          status: 200,
          headers: { 'content-length': String(body.size) }
        });
      })
    );

    await ensureBundledDictionaries();

    expect(await dictDb.terms.where('keys').equals('旧').count()).toBe(0);
    expect(await dictDb.terms.where('keys').equals('新').count()).toBe(1);
    expect(
      await dictDb.dictionaries.filter((d) => d.title.startsWith('JMdict Frequencies')).count()
    ).toBe(0);
    expect(await dictDb.termMeta.where('dictionaryId').equals(retiredFrequencyId).count()).toBe(0);
    const current = await dictDb.dictionaries
      .filter((d) => d.title.startsWith('JMdict (simplified)'))
      .first();
    expect(current).toMatchObject({ revision: 'new', schemaVersion: 2, entryCount: 1 });
  });
});
