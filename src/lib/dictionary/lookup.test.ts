import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { dictDb } from './db';
import { findBestMatch, invalidateTermMetaCache } from './lookup';
import type { StoredTerm, StoredTermMeta, Headword, Sense } from './types';

// Word-level (jmdict-simplified) fixtures. Each StoredTerm is a whole entry with
// all its writings/readings already merged; `priority` on a headword stands in
// for JMdict's `common` flag.

function hw(
  text: string,
  opts: { obscure?: boolean; hidden?: boolean; priority?: boolean } = {}
): Headword {
  return {
    text,
    obscure: !!opts.obscure,
    hidden: !!opts.hidden,
    priority: !!opts.priority,
    info: []
  };
}

const defSense: Sense = {
  pos: [],
  field: [],
  misc: [],
  dialect: [],
  info: [],
  glosses: [{ text: 'def' }],
  xref: [],
  langSource: [],
  examples: []
};

function word(p: {
  sequence: number;
  writings?: Headword[];
  readings: Headword[];
  rules?: string;
  score?: number;
}): StoredTerm {
  const writings = p.writings ?? [];
  return {
    dictionaryId: 1,
    sequence: p.sequence,
    writings,
    readings: p.readings,
    keys: [...new Set([...writings.map((w) => w.text), ...p.readings.map((r) => r.text)])],
    rules: p.rules ?? '',
    score: p.score ?? 0,
    senses: [defSense]
  };
}

beforeAll(async () => {
  await dictDb.dictionaries.add({
    title: 'Test',
    revision: '1',
    format: 0,
    importedAt: new Date(),
    entryCount: 0,
    complete: true
  });

  const terms: StoredTerm[] = [
    // 見る (common, v1) with an old-kanji writing 視る in the same entry.
    word({
      sequence: 1000,
      writings: [hw('見る', { priority: true }), hw('視る', { obscure: true })],
      readings: [hw('みる')],
      rules: 'v1',
      score: 1
    }),
    // 日 / 火 — kanji words read ひ (so ひ matches them only as a reading).
    word({
      sequence: 2000,
      writings: [hw('日', { priority: true })],
      readings: [hw('ひ')],
      score: 1
    }),
    word({
      sequence: 3000,
      writings: [hw('火', { priority: true })],
      readings: [hw('ひ')],
      score: 1
    }),
    // A standalone kana word ひ — should outrank 日/火 on a kana click.
    word({ sequence: 4000, readings: [hw('ひ')], score: 0 }),
    // 分かる vs 分かつ — identical (both common, v5); only the frequency dictionary
    // can rank the far more common 分かる first.
    word({
      sequence: 5000,
      writings: [hw('分かる', { priority: true })],
      readings: [hw('わかる', { priority: true })],
      rules: 'v5',
      score: 1
    }),
    word({
      sequence: 6000,
      writings: [hw('分かつ', { priority: true })],
      readings: [hw('わかつ', { priority: true })],
      rules: 'v5',
      score: 1
    }),
    // 頭: clicking the kanji, the common あたま entry (頭 is a common writing) must
    // outrank the rare counter とう entry (頭 not marked common there).
    word({
      sequence: 7000,
      writings: [hw('頭', { priority: true })],
      readings: [hw('あたま', { priority: true })],
      score: 1
    }),
    word({ sequence: 7001, writings: [hw('頭')], readings: [hw('とう')], score: 1 }),
    // よく: clicking the kana, the adverb 良く (よく is its common reading) must
    // outrank the rare よく reading of 翼 (whose common reading is つばさ).
    word({
      sequence: 8000,
      writings: [hw('良く', { priority: true })],
      readings: [hw('よく', { priority: true })],
      score: 1
    }),
    word({
      sequence: 9000,
      writings: [hw('翼', { priority: true })],
      readings: [hw('よく'), hw('つばさ', { priority: true })],
      score: 1
    }),
    // いっそ (adverb) and いそいそ (adverb). Clicking いっそいっそ, a full emphatic
    // collapse turns the whole run into いそいそ; the clean word いっそ at a shorter
    // prefix must win over that longer, lossy match.
    word({ sequence: 10000, readings: [hw('いっそ', { priority: true })], score: 1 }),
    word({ sequence: 11000, readings: [hw('いそいそ', { priority: true })], score: 1 }),
    // す (vinegar) and すごい. Clicking the emphatic すっごい, only the full collapse
    // (→ すごい) reaches a real word, so the lossy longer match must still win over
    // the trivial clean single-char す.
    word({
      sequence: 12000,
      writings: [hw('酢', { priority: true })],
      readings: [hw('す')],
      score: 1
    }),
    word({
      sequence: 13000,
      writings: [hw('凄い', { priority: true })],
      readings: [hw('すごい', { priority: true })],
      rules: 'adj-i',
      score: 1
    })
  ];
  await dictDb.terms.bulkAdd(terms);

  const meta: StoredTermMeta[] = [
    { dictionaryId: 1, expression: '見る', reading: 'みる', mode: 'pitch', positions: [1] },
    { dictionaryId: 1, expression: 'みる', reading: 'みる', mode: 'pitch', positions: [1] },
    // Frequency scores: 分かる is far more common than 分かつ.
    { dictionaryId: 1, expression: '分かる', mode: 'freq', frequency: '53', frequencyValue: 53.05 },
    { dictionaryId: 1, expression: 'わかる', mode: 'freq', frequency: '53', frequencyValue: 53.51 },
    { dictionaryId: 1, expression: '分かつ', mode: 'freq', frequency: '45', frequencyValue: 45.5 },
    { dictionaryId: 1, expression: 'わかつ', mode: 'freq', frequency: '45', frequencyValue: 45.5 }
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
    const writings = Object.fromEntries(entry.writings.map((w) => [w.text, w.obscure]));
    expect(writings).toEqual({ 見る: false, 視る: true });
    expect(entry.inflectionPath.length).toBeGreaterThan(0);
  });

  it('attaches pitch accent to the matched reading', async () => {
    const res = await findBestMatch('みる', 0);
    const entry = res!.state.results[0];
    expect(entry.pitches).toEqual([{ reading: 'みる', positions: [1] }]);
  });

  it('ranks a standalone kana word above kanji words it is only a reading of', async () => {
    const res = await findBestMatch('ひ', 0);
    expect(res!.state.results[0].expression).toBe('ひ');
  });

  it('uses frequency to break ties score/priority cannot (分かる > 分かつ)', async () => {
    const res = await findBestMatch('わかってる', 0);
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs).toContain('分かる');
    expect(exprs).toContain('分かつ');
    expect(exprs.indexOf('分かる')).toBeLessThan(exprs.indexOf('分かつ'));
  });

  it('ranks a common writing above a rare homophone entry (頭: あたま > とう)', async () => {
    const res = await findBestMatch('頭', 0);
    const readings = res!.state.results.map((r) => r.reading);
    expect(readings.indexOf('あたま')).toBeLessThan(readings.indexOf('とう'));
  });

  it('scores the matched reading, not the entry (よく: 良く > 翼)', async () => {
    const res = await findBestMatch('よく', 0);
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs.indexOf('良く')).toBeLessThan(exprs.indexOf('翼'));
  });

  it('lets full emphatic collapse extend the match, longest wins (Yomitan)', async () => {
    // Yomitan ranks by longest source substring. いっそいっそ full-collapses to the
    // real word いそいそ (6 chars), which outranks the shorter clean いっそ (3). This
    // is Yomitan's actual behaviour: the emphatic っ in いっそ is collapsible, so a
    // longer coincidental word can swallow it. See the port notes for the tradeoff.
    const res = await findBestMatch('いっそいっそ', 0);
    expect(res).not.toBeNull();
    expect(res!.utf16Length).toBe(6);
    expect(res!.state.results[0].expression).toBe('いそいそ');
    // The shorter clean parse is still offered, just ranked below the longer one.
    expect(res!.state.results.map((r) => r.expression)).toContain('いっそ');
  });

  it('resolves genuine gemination via full collapse (すっごい → すごい)', async () => {
    const res = await findBestMatch('すっごい', 0);
    expect(res).not.toBeNull();
    // The whole すっごい (4 chars) collapses to すごい and ranks first.
    expect(res!.utf16Length).toBe(4);
    expect(res!.state.results[0].expression).toBe('凄い');
    // 酢 (す) also matches at length 1, but ranks below the longer 凄い.
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs.indexOf('凄い')).toBeLessThan(exprs.indexOf('酢'));
  });
});
