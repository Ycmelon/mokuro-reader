import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { dictDb } from './db';
import { findBestMatch, invalidateTermMetaCache } from './lookup';
import type { StoredTerm, StoredTermMeta } from './types';

// Minimal Jitendex-shaped fixtures. `definitionTags` uses NBSP inside multi-word
// tag names, exactly as Jitendex ships them.
const NBSP = ' ';
const star = '★';
const priorityForm = `★ priority${NBSP}form`;
const oldKanji = `old${NBSP}kanji${NBSP}form`;

function term(t: Partial<StoredTerm> & Pick<StoredTerm, 'expression' | 'reading'>): StoredTerm {
  return {
    dictionaryId: 1,
    definitionTags: '',
    rules: '',
    score: 0,
    definitions: ['def'],
    sequence: 0,
    termTags: '',
    ...t
  };
}

beforeAll(async () => {
  await dictDb.dictionaries.add({
    title: 'Test',
    revision: '1',
    format: 3,
    importedAt: new Date(),
    entryCount: 0,
    complete: true
  });

  const terms: StoredTerm[] = [
    // 見る (common, v1) and its old-kanji writing 視る sharing a sequence.
    term({
      expression: '見る',
      reading: 'みる',
      rules: 'v1',
      score: 200,
      sequence: 1000,
      definitionTags: priorityForm
    }),
    term({
      expression: '視る',
      reading: 'みる',
      rules: 'v1',
      score: -100,
      sequence: 1000,
      definitionTags: oldKanji
    }),
    // 日 / 火 — kanji words read ひ (so ひ matches them only as a reading).
    term({
      expression: '日',
      reading: 'ひ',
      rules: '',
      score: 150,
      sequence: 2000,
      definitionTags: priorityForm
    }),
    term({
      expression: '火',
      reading: 'ひ',
      rules: '',
      score: 140,
      sequence: 3000,
      definitionTags: priorityForm
    }),
    // A standalone kana word ひ (an interjection) — should outrank 日/火 on a kana click.
    term({ expression: 'ひ', reading: 'ひ', rules: '', score: 10, sequence: 4000 }),
    // 分かる vs 分かつ — identical in Jitendex (both ★, both score 200); only the
    // frequency dictionary can rank the far more common 分かる first.
    term({
      expression: '分かる',
      reading: 'わかる',
      rules: 'v5',
      score: 200,
      sequence: 5000,
      definitionTags: priorityForm
    }),
    term({
      expression: '分かつ',
      reading: 'わかつ',
      rules: 'v5',
      score: 200,
      sequence: 6000,
      definitionTags: priorityForm
    }),
    // 頭: clicking the kanji, the common あたま (a priority form) must outrank the
    // rare counter とう (entry-level ★ only).
    term({
      expression: '頭',
      reading: 'あたま',
      score: 200,
      sequence: 7000,
      definitionTags: priorityForm
    }),
    term({ expression: '頭', reading: 'とう', score: 200, sequence: 7001, definitionTags: star }),
    // よく: clicking the kana, the adverb 良く (a priority form) must outrank the
    // rare よく reading of 翼 — whose *つばさ* reading is the priority form, not よく.
    term({
      expression: '良く',
      reading: 'よく',
      score: 200,
      sequence: 8000,
      definitionTags: priorityForm
    }),
    term({ expression: '善く', reading: 'よく', score: 99, sequence: 8000, definitionTags: star }),
    term({ expression: '翼', reading: 'よく', score: 99, sequence: 9000, definitionTags: star }),
    term({
      expression: '翼',
      reading: 'つばさ',
      score: 200,
      sequence: 9000,
      definitionTags: priorityForm
    })
  ];
  await dictDb.terms.bulkAdd(terms);

  const meta: StoredTermMeta[] = [
    { dictionaryId: 1, expression: '見る', reading: 'みる', mode: 'pitch', positions: [1] },
    { dictionaryId: 1, expression: 'みる', reading: 'みる', mode: 'pitch', positions: [1] },
    // Frequency scores (10ten priority sums): 分かる is far more common than 分かつ.
    { dictionaryId: 1, expression: '分かる', mode: 'freq', frequency: '53', frequencyValue: 53.05 },
    { dictionaryId: 1, expression: 'わかる', mode: 'freq', frequency: '53', frequencyValue: 53.51 },
    { dictionaryId: 1, expression: '分かつ', mode: 'freq', frequency: '45', frequencyValue: 45.5 },
    { dictionaryId: 1, expression: 'わかつ', mode: 'freq', frequency: '45', frequencyValue: 45.5 }
  ];
  await dictDb.termMeta.bulkAdd(meta);
  invalidateTermMetaCache();
});

describe('findBestMatch', () => {
  it('deinflects and merges writings, dimming the old-kanji form', async () => {
    const res = await findBestMatch('見た', 0);
    expect(res).not.toBeNull();
    const entry = res!.state.results[0];
    expect(entry.expression).toBe('見る');
    // Both writings surface; 視る is marked obscure, 見る is not.
    const writings = Object.fromEntries(entry.writings.map((w) => [w.text, w.obscure]));
    expect(writings).toEqual({ 見る: false, 視る: true });
    // Reached via the past-tense (-た) inflection.
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

  it('uses frequency to break ties Jitendex score/priority cannot (分かる > 分かつ)', async () => {
    // わかってる → both 分かる and 分かつ deinflect via the て/てる chain and are
    // otherwise identical; the frequency dictionary must surface 分かる first.
    const res = await findBestMatch('わかってる', 0);
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs).toContain('分かる');
    expect(exprs).toContain('分かつ');
    expect(exprs.indexOf('分かる')).toBeLessThan(exprs.indexOf('分かつ'));
  });

  it('ranks a priority-form reading above a bare-★ homophone (頭: あたま > とう)', async () => {
    const res = await findBestMatch('頭', 0);
    const readings = res!.state.results.map((r) => r.reading);
    expect(readings.indexOf('あたま')).toBeLessThan(readings.indexOf('とう'));
  });

  it('scores the matched reading, not the entry (よく: 良く > 翼)', async () => {
    // 翼 is a common word, but よく is a rare reading of it; the adverb 良く is the
    // priority form for よく, so it must rank first.
    const res = await findBestMatch('よく', 0);
    const exprs = res!.state.results.map((r) => r.expression);
    expect(exprs.indexOf('良く')).toBeLessThan(exprs.indexOf('翼'));
  });
});
