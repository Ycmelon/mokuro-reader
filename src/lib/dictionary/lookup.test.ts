import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { dictDb } from './db';
import { findBestMatch, invalidateTermMetaCache } from './lookup';
import type { StoredTerm, StoredTermMeta, Headword, Sense } from './types';

function hw(
  text: string,
  opts: {
    obscure?: boolean;
    hidden?: boolean;
    priority?: boolean;
    info?: string[];
    p?: string[];
    app?: 0 | 1;
  } = {}
): Headword {
  return {
    text,
    obscure: !!opts.obscure,
    hidden: !!opts.hidden,
    priority: opts.priority ?? !!opts.p?.length,
    info: opts.info ?? [],
    p: opts.p ?? [],
    ...(opts.app !== undefined ? { app: opts.app } : {})
  };
}

function sense(misc: string[] = []): Sense {
  return {
    pos: [],
    field: [],
    misc,
    dialect: [],
    info: [],
    glosses: [{ text: 'def' }],
    xref: [],
    langSource: [],
    examples: []
  };
}

const defSense = sense();

function word(p: {
  sequence: number;
  writings?: Headword[];
  readings: Headword[];
  rules?: string;
  senses?: Sense[];
}): StoredTerm {
  const writings = p.writings ?? [];
  return {
    dictionaryId: 1,
    sequence: p.sequence,
    writings,
    readings: p.readings,
    keys: [...new Set([...writings.map((w) => w.text), ...p.readings.map((r) => r.text)])],
    rules: p.rules ?? '',
    senses: p.senses ?? [defSense]
  };
}

beforeAll(async () => {
  await dictDb.dictionaries.add({
    title: 'Test',
    revision: '1',
    format: 0,
    importedAt: new Date(),
    entryCount: 0,
    complete: true,
    schemaVersion: 2
  });

  const terms: StoredTerm[] = [
    word({
      sequence: 1000,
      writings: [hw('見る', { p: ['i1'] }), hw('視る', { obscure: true })],
      readings: [hw('みる', { p: ['i1'], app: 1 })],
      rules: 'v1'
    }),
    // Per-reading priority breaks this deinflection tie.
    word({
      sequence: 5000,
      writings: [hw('分かる', { p: ['i1'] })],
      readings: [hw('わかる', { p: ['i1'], app: 1 })],
      rules: 'v5'
    }),
    word({
      sequence: 6000,
      writings: [hw('分かつ', { p: ['i2'] })],
      readings: [hw('わかつ', { p: ['i2'], app: 1 })],
      rules: 'v5'
    }),
    word({
      sequence: 7000,
      writings: [hw('頭', { p: ['i1'] })],
      readings: [hw('あたま', { p: ['i1'], app: 1 })]
    }),
    word({ sequence: 7001, writings: [hw('頭')], readings: [hw('とう', { app: 1 })] }),
    // Text-processor longest-match regression fixtures.
    word({ sequence: 10000, readings: [hw('いっそ', { p: ['i1'], app: 0 })] }),
    word({ sequence: 11000, readings: [hw('いそいそ', { p: ['i1'], app: 0 })] }),
    word({
      sequence: 12000,
      writings: [hw('酢', { p: ['i1'] })],
      readings: [hw('す', { app: 1 })]
    }),
    word({
      sequence: 13000,
      writings: [hw('凄い', { p: ['i1'] })],
      readings: [hw('すごい', { p: ['i1'], app: 1 })],
      rules: 'adj-i'
    }),
    // 風: the earlier/longer 振り entry's matched 風 headword has no priority.
    word({
      sequence: 1361130,
      writings: [hw('振り', { p: ['i1', 'n1', 'nf13'] }), hw('風', { info: ['rK'] })],
      readings: [hw('ふり', { p: ['i1', 'n1', 'nf13'], app: 1 })]
    }),
    word({
      sequence: 1499720,
      writings: [hw('風', { p: ['i1'] })],
      readings: [hw('かぜ', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 1499730,
      writings: [hw('風', { p: ['i1', 's1'] })],
      readings: [hw('ふう', { p: ['i1', 's1'], app: 1 })]
    }),
    word({
      sequence: 1317330,
      writings: [hw('自ずから', { p: ['i1'] }), hw('自ら')],
      readings: [hw('おのずから', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 1317340,
      writings: [hw('自ら', { p: ['i1', 'n1', 'nf01'] })],
      readings: [hw('みずから', { p: ['i1', 'n1', 'nf01'], app: 1 })]
    }),
    word({
      sequence: 1535300,
      writings: [hw('目印', { p: ['i1', 'n2', 'nf29'] }), hw('目標'), hw('目じるし')],
      readings: [hw('めじるし', { p: ['i1', 'n2', 'nf29'], app: 1 })]
    }),
    word({
      sequence: 1535650,
      writings: [hw('目標', { p: ['i1', 'n1', 'nf01'] })],
      readings: [hw('もくひょう', { p: ['i1', 'n1', 'nf01'], app: 1 })]
    }),
    word({
      sequence: 1005180,
      writings: [hw('先'), hw('先刻')],
      readings: [hw('さっき', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 1387210,
      writings: [hw('先', { p: ['i1'] }), hw('前'), hw('先き')],
      readings: [hw('さき', { p: ['i1'], app: 1 })]
    }),
    // Kana-primary because every kanji spelling is rK and the senses are uk.
    word({ sequence: 1597170, readings: [hw('たまたま', { app: 0 })] }),
    word({
      sequence: 1597180,
      writings: [
        hw('偶々', { info: ['rK'] }),
        hw('偶偶', { info: ['rK'] }),
        hw('偶', { info: ['rK'] }),
        hw('適', { info: ['rK'] })
      ],
      readings: [hw('たまたま', { p: ['i1'], app: 1 })],
      senses: [sense(['uk'])]
    }),
    // The obscure-reading check must run before the uk/nokanji clauses.
    word({
      sequence: 2000,
      writings: [hw('日')],
      readings: [hw('ひ', { p: ['n1'], app: 1 })]
    }),
    word({
      sequence: 3000,
      writings: [hw('火')],
      readings: [hw('ひ', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 3001,
      writings: [hw('檜')],
      readings: [hw('ひ', { info: ['ok'], app: 0 })],
      senses: [sense(['uk'])]
    }),
    word({
      sequence: 3002,
      writings: [hw('羆')],
      readings: [hw('ひ', { info: ['rk'], app: 0 })],
      senses: [sense(['uk'])]
    }),
    // よく must score the reached reading, never 翼's common つばさ reading.
    word({
      sequence: 8000,
      writings: [hw('欲')],
      readings: [hw('よく', { p: ['n1'], app: 1 })]
    }),
    word({
      sequence: 8001,
      writings: [hw('良く')],
      readings: [hw('よく', { p: ['i1'], app: 1 })],
      senses: [sense(['uk'])]
    }),
    word({
      sequence: 9000,
      writings: [hw('翼')],
      readings: [hw('よく', { app: 1 }), hw('つばさ', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 1600000,
      writings: [hw('鳴る')],
      readings: [hw('なる', { p: ['i1', 's1'], app: 1 })]
    }),
    word({
      sequence: 1600001,
      writings: [hw('成る')],
      readings: [hw('なる', { p: ['i1'], app: 1 })],
      senses: [sense(['uk']), sense(['uk']), sense()]
    }),
    word({
      sequence: 1700000,
      writings: [hw('私事', { p: ['i1'] }), hw('私')],
      readings: [hw('わたくしごと', { p: ['i1'], app: 1 })]
    }),
    word({
      sequence: 1700001,
      writings: [hw('私', { p: ['i1', 'n1', 'nf01'] })],
      readings: [hw('わたし', { p: ['i1', 'n1', 'nf01'], app: 1 })]
    }),
    // The two documented noisy-tail cases remain longest-match-first.
    word({
      sequence: 1800000,
      writings: [hw('経る')],
      readings: [hw('へる', { app: 1 })],
      rules: 'v1'
    }),
    word({ sequence: 1800001, readings: [hw('へま', { app: 0 })] }),
    word({
      sequence: 1800002,
      writings: [hw('どうって事ない')],
      readings: [hw('どうってことない', { app: 1 })]
    }),
    word({ sequence: 1800003, readings: [hw('どる', { app: 0 })], rules: 'v5' })
  ];
  await dictDb.terms.bulkAdd(terms);

  const meta: StoredTermMeta[] = [
    { dictionaryId: 1, expression: '見る', reading: 'みる', mode: 'pitch', positions: [1] },
    { dictionaryId: 1, expression: 'みる', reading: 'みる', mode: 'pitch', positions: [1] }
  ];
  await dictDb.termMeta.bulkAdd(meta);
  invalidateTermMetaCache();
});

describe('findBestMatch', () => {
  it('deinflects and surfaces merged writings, dimming the old-kanji form', async () => {
    const res = await findBestMatch('見た', 0);
    expect(res).not.toBeNull();
    const entry = res!.state.results[0];
    expect(entry.expression).toBe('見る');
    expect(Object.fromEntries(entry.writings.map((w) => [w.text, w.obscure]))).toEqual({
      見る: false,
      視る: true
    });
    expect(entry.inflectionPath.length).toBeGreaterThan(0);
  });

  it('attaches pitch accent to the matched reading', async () => {
    const res = await findBestMatch('みる', 0);
    expect(res!.state.results[0].pitches).toEqual([{ reading: 'みる', positions: [1] }]);
  });

  it('uses matched-reading priority to break a deinflection tie', async () => {
    const res = await findBestMatch('わかってる', 0);
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs.indexOf('分かる')).toBeLessThan(exprs.indexOf('分かつ'));
  });

  it('ranks a common matched writing above a rare homograph', async () => {
    const res = await findBestMatch('頭', 0);
    const readings = res!.state.results.map((r) => r.reading);
    expect(readings.indexOf('あたま')).toBeLessThan(readings.indexOf('とう'));
  });

  it('keeps longest-match-first behavior through emphatic preprocessing', async () => {
    const repeated = await findBestMatch('いっそいっそ', 0);
    expect(repeated!.utf16Length).toBe(6);
    expect(repeated!.state.results[0].expression).toBe('いそいそ');
    expect(repeated!.state.results.map((r) => r.expression)).toContain('いっそ');

    const geminated = await findBestMatch('すっごい', 0);
    expect(geminated!.utf16Length).toBe(4);
    expect(geminated!.state.results[0].expression).toBe('凄い');
  });

  it.each([
    // Section 7 deliberately accepts 10ten's 風【ふう】 > 風【かぜ】 ordering.
    ['風', '風', 'ふう'],
    ['自ら', '自ら', 'みずから'],
    ['目標', '目標', 'もくひょう'],
    ['先', '先', 'さき'],
    ['たまたま', '偶々', 'たまたま'],
    ['ひ', '火', 'ひ'],
    ['よく', '良く', 'よく'],
    ['なる', '成る', 'なる'],
    ['私', '私', 'わたし']
  ])('ranks %s as %s【%s】 first', async (lookup, expression, reading) => {
    const res = await findBestMatch(lookup, 0);
    expect(res).not.toBeNull();
    expect(res!.state.results[0]).toMatchObject({ expression, reading });
  });

  it('leaves the two documented longest-match cases untouched', async () => {
    const politeConditional = await findBestMatch('ヘマしたら', 0);
    expect(politeConditional!.state.results[0].expression).toBe('経る');

    const kansaiTail = await findBestMatch('どうってことない', 0);
    expect(kansaiTail!.state.results[0].expression).toBe('どうって事ない');
  });
});
