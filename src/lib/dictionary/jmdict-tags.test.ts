import { describe, it, expect } from 'vitest';
import {
  posToRules,
  isObscureHeadword,
  isSearchOnlyHeadword,
  headInfoLabel,
  posLabel,
  miscLabel
} from './jmdict-tags';

describe('posToRules', () => {
  it('maps godan variants to v5', () => {
    expect(posToRules(['v5r'])).toBe('v5');
    expect(posToRules(['v5u-s'])).toBe('v5');
    expect(posToRules(['v5k-s'])).toBe('v5');
    expect(posToRules(['v5aru'])).toBe('v5');
  });

  it('maps ichidan and its kureru variant to v1', () => {
    expect(posToRules(['v1'])).toBe('v1');
    expect(posToRules(['v1-s'])).toBe('v1');
  });

  it('maps suru/kuru/zuru verbs', () => {
    expect(posToRules(['vs-i'])).toBe('vs');
    expect(posToRules(['vs-s'])).toBe('vs');
    expect(posToRules(['vk'])).toBe('vk');
    expect(posToRules(['vz'])).toBe('vz');
  });

  it('maps i-adjectives', () => {
    expect(posToRules(['adj-i'])).toBe('adj-i');
    expect(posToRules(['adj-ix'])).toBe('adj-i');
  });

  it('does not map non-inflecting POS', () => {
    expect(posToRules(['n'])).toBe('');
    expect(posToRules(['adj-na', 'adv', 'exp'])).toBe('');
  });

  it('dedupes the union across senses', () => {
    expect(posToRules(['v5r', 'vt', 'v5s', 'vi'])).toBe('v5');
    // A word that is both a suru-verb and a noun keeps only the verb rule.
    expect(posToRules(['n', 'vs'])).toBe('vs');
  });
});

describe('isObscureHeadword', () => {
  it('flags irregular/old/rare forms', () => {
    expect(isObscureHeadword(['iK'])).toBe(true);
    expect(isObscureHeadword(['oK'])).toBe(true);
    expect(isObscureHeadword(['rk'])).toBe(true);
    expect(isObscureHeadword(['io'])).toBe(true);
  });

  it('does not flag search-only, ateji/gikun, or empty', () => {
    // Search-only forms are hidden entirely, not merely de-emphasized.
    expect(isObscureHeadword(['sK'])).toBe(false);
    expect(isObscureHeadword(['sk'])).toBe(false);
    expect(isObscureHeadword(['ateji'])).toBe(false);
    expect(isObscureHeadword(['gikun'])).toBe(false);
    expect(isObscureHeadword([])).toBe(false);
  });
});

describe('isSearchOnlyHeadword', () => {
  it('flags search-only kanji/kana forms (sK/sk)', () => {
    expect(isSearchOnlyHeadword(['sK'])).toBe(true);
    expect(isSearchOnlyHeadword(['sk'])).toBe(true);
  });

  it('does not flag displayable forms', () => {
    expect(isSearchOnlyHeadword(['iK'])).toBe(false);
    expect(isSearchOnlyHeadword(['rK'])).toBe(false);
    expect(isSearchOnlyHeadword(['io'])).toBe(false);
    expect(isSearchOnlyHeadword([])).toBe(false);
  });
});

describe('labels', () => {
  it('resolves hyphenated codes via underscore normalization', () => {
    expect(posLabel('v5r')).toBe('-ru Godan/u-verb');
    expect(posLabel('adj-i')).toBe('i adj.');
    expect(miscLabel('on-mim')).toBe('onomatopoeia');
    expect(miscLabel('uk')).toBe('usually kana');
  });

  it('maps headword info tags to their short label', () => {
    expect(headInfoLabel('iK')).toBe('irreg.');
    expect(headInfoLabel('oK')).toBe('old');
    expect(headInfoLabel('rk')).toBe('rare');
  });
});
