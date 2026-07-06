import { describe, it, expect } from 'vitest';
import { groupSenses } from './sense-grouping';
import type { Sense } from './types';

function sense(pos: string[], misc: string[] = [], gloss = 'x'): Sense {
  return {
    pos,
    misc,
    field: [],
    dialect: [],
    info: [],
    glosses: [{ text: gloss }],
    xref: [],
    langSource: [],
    examples: []
  };
}

describe('groupSenses', () => {
  it('handles an empty sense list', () => {
    expect(groupSenses([])).toEqual([]);
  });

  it('keeps every sense of a shared primary POS in one group', () => {
    // 切り-shaped: all senses are nouns, some kana-only, one carries an extra
    // POS. The old exact-equality grouping fragmented this into four groups;
    // now it stays a single numbered noun list.
    const groups = groupSenses([
      sense(['n'], ['uk']),
      sense(['n'], ['uk']),
      sense(['n']),
      sense(['n']),
      sense(['n', 'adv']),
      sense(['n'])
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].pos).toEqual(['n']);
    expect(groups[0].misc).toEqual([]); // 'uk' is not on every sense, so not hoisted
    expect(groups[0].senses).toHaveLength(6);
    // 'n' is dropped from each sense; residual tags remain inline.
    expect(groups[0].senses[0].misc).toEqual(['uk']);
    expect(groups[0].senses[2].misc).toEqual([]);
    expect(groups[0].senses[4].pos).toEqual(['adv']);
  });

  it('hoists further POS common to the whole group', () => {
    const groups = groupSenses([
      sense(['v5u', 'vt']),
      sense(['v5u', 'vt']),
      sense(['v5u', 'vt', 'vi'])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pos).toEqual(['v5u', 'vt']);
    expect(groups[0].senses[0].pos).toEqual([]);
    expect(groups[0].senses[2].pos).toEqual(['vi']);
  });

  it('hoists misc tags common to the whole group', () => {
    const groups = groupSenses([
      sense(['adv'], ['uk']),
      sense(['adv'], ['uk']),
      sense(['adv', 'int'], ['uk'])
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pos).toEqual(['adv']);
    expect(groups[0].misc).toEqual(['uk']);
    expect(groups[0].senses[2].pos).toEqual(['int']);
    expect(groups[0].senses.every((s) => s.misc.length === 0)).toBe(true);
  });

  it('splits senses with disjoint primary POS into separate groups', () => {
    const groups = groupSenses([sense(['n']), sense(['vs']), sense(['adj-i'])]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.pos)).toEqual([['n'], ['vs'], ['adj-i']]);
  });

  it('groups consecutive POS-less senses together', () => {
    const groups = groupSenses([sense([]), sense([])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pos).toEqual([]);
    expect(groups[0].senses).toHaveLength(2);
  });

  it('joins a later sense that includes the group POS as a secondary tag', () => {
    // Grouping is on the *primary* POS, but membership only requires the sense
    // to include it — so ['adj-i','n'] joins the leading adj-i group.
    const groups = groupSenses([sense(['adj-i']), sense(['adj-i', 'n'])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pos).toEqual(['adj-i']);
    expect(groups[0].senses[1].pos).toEqual(['n']);
  });
});
