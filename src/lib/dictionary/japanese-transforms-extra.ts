// Supplementary deinflection rules layered on top of the vendored Yomitan
// ruleset (japanese-transforms.js), kept separate so that file stays a verbatim
// upstream copy. These cover forms Yomitan's base ja ruleset does not reach but
// which show up often enough in manga to matter — currently the ざるを得ない
// ("cannot help but ~") construction, which 10ten handles and we did not.
//
// The rules reuse the base descriptor's `conditions`, so the merged descriptor
// resolves their condition names against the same flag namespace.

import { japaneseTransforms } from './vendor/japanese-transforms.js';
import { suffixInflection } from './vendor/language-transforms.js';

// ざるを得ない attaches to the irrealis form (未然形), exactly like the classical
// negative ず/ぬ, so the per-verb-class endings mirror the '-ず' block. The four
// spellings cover kanji/kana 得 and the ぬ contraction of ない.
function zaruWoEnaiRules() {
  const rules = [];
  for (const tail of ['ざるを得ない', 'ざるをえない', 'ざるを得ぬ', 'ざるをえぬ']) {
    rules.push(
      suffixInflection(tail, 'る', [], ['v1']),
      suffixInflection(`か${tail}`, 'く', [], ['v5']),
      suffixInflection(`が${tail}`, 'ぐ', [], ['v5']),
      suffixInflection(`さ${tail}`, 'す', [], ['v5']),
      suffixInflection(`た${tail}`, 'つ', [], ['v5']),
      suffixInflection(`な${tail}`, 'ぬ', [], ['v5']),
      suffixInflection(`ば${tail}`, 'ぶ', [], ['v5']),
      suffixInflection(`ま${tail}`, 'む', [], ['v5']),
      suffixInflection(`ら${tail}`, 'る', [], ['v5']),
      suffixInflection(`わ${tail}`, 'う', [], ['v5']),
      suffixInflection(`ぜ${tail}`, 'ずる', [], ['vz']),
      suffixInflection(`せ${tail}`, 'する', [], ['vs']),
      suffixInflection(`こ${tail}`, 'くる', [], ['vk']),
      suffixInflection(`来${tail}`, '来る', [], ['vk'])
    );
  }
  return rules;
}

/** The base Yomitan descriptor with our supplementary transforms folded in. */
export const japaneseTransformsExtended = {
  ...japaneseTransforms,
  transforms: {
    ...japaneseTransforms.transforms,
    '-ざるを得ない': {
      name: '-ざるを得ない',
      description:
        'Expresses that one cannot help but do something.\n' +
        'Usage: Attach ざるを得ない to the irrealis form (未然形) of verbs.',
      i18n: [{ language: 'ja', name: '～ざるを得ない' }],
      rules: zaruWoEnaiRules()
    }
  }
};
