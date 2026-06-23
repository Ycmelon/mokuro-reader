# Third-Party Notices

This project bundles and builds upon third-party software and data. Each is
credited below along with its license.

## Yomitan (source code)

The Japanese word-segmentation and deinflection engine is taken from
**[Yomitan](https://github.com/yomidevs/yomitan)** (© Yomitan Authors), licensed
under the **GNU General Public License v3.0 or later** — the same license as
this project.

Files derived from Yomitan:

- `src/lib/dictionary/vendor/language-transformer.js` — vendored from
  `ext/js/language/language-transformer.js`. _Modified:_ replaced the
  `../core/log.js` import with a minimal `console.warn` stub; added
  `// @ts-nocheck`.
- `src/lib/dictionary/vendor/language-transforms.js` — vendored from
  `ext/js/language/language-transforms.js`. _Modified:_ added `// @ts-nocheck`.
- `src/lib/dictionary/vendor/japanese-transforms.js` — vendored from
  `ext/js/language/ja/japanese-transforms.js`. _Modified:_ changed the import
  path to the sibling module; added `// @ts-nocheck`.
- `src/lib/dictionary/vendor/CJK-util.js` — vendored from
  `ext/js/language/CJK-util.js`. _Modified:_ added `// @ts-nocheck`.
- `src/lib/dictionary/japanese.ts` — reimplemented in TypeScript from
  `ext/js/language/ja/japanese.js` and `ext/js/language/CJK-util.js` (Japanese
  codepoint detection and kana conversion).

Each file retains its original copyright and GPL-3.0 header.

## Jitendex (dictionary data)

`static/jitendex-yomitan.zip` is the **[Jitendex](https://jitendex.org)**
Japanese–English dictionary, © CC BY-SA 4.0 Stephen Kraus 2023–2026, downloaded
and redistributed unmodified under the
**[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**
license. Jitendex incorporates:

- **JMdict** dictionary data, © the Electronic Dictionary Research and
  Development Group ([EDRDG](https://www.edrdg.org/)), used under the
  [EDRDG License](https://www.edrdg.org/edrdg/licence.html).
- **Example sentences** from [Tatoeba](https://tatoeba.org/), licensed
  CC BY 2.0 FR.
