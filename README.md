# Mokurod (Mokuro with dictionary)

Opinionated fork of Mokuro Reader with a focus on (1) frictionless, (2) mobile-friendly Japanese language learning

Notable features:

- Inbuilt Japanese-English dictionary lookup (credit to Yomitan, JMdict, 10ten)
- Hosted Anki sync server as an alternative to AnkiConnect (which is desktop only)
- Optimised Anki card creation flow, including mobile-friendly manga crop
- LLM features for quick sentence explanation and flashcard generation

## Credits

- **[Mokuro Reader](https://github.com/Gnathonic/mokuro-reader)** - the base
  manga reader this is forked from, licensed under GPL-3.0
- **[Yomitan](https://github.com/yomidevs/yomitan)** - the Japanese
  word-segmentation and deinflection engine is derived from Yomitan, licensed
  under GPL-3.0-or-later
- **[10ten Japanese Reader](https://github.com/birchill/10ten-ja-reader)** and
  **[@birchill/jpdict-idb](https://github.com/birchill/jpdict-idb)** - the
  dictionary popup's layout and styling (POS-grouped, numbered, tagged senses),
  its tag labels, the bundled pitch-accent and word-frequency/priority data, and
  the era-year (和暦) conversion are derived from or ported in spirit from 10ten;
  the sense-grouping algorithm (`groupSenses` in
  [sense-grouping.ts](src/lib/dictionary/sense-grouping.ts)) is ported
  near-verbatim from jpdict-idb. Both licensed under GPL-3.0
- **[jmdict-simplified](https://github.com/scriptin/jmdict-simplified)** - the
  Japanese-English dictionary data, converted to field-separated JSON by Stephen
  Kraus (scriptin); build tooling under a permissive licence, data under the
  licences below
- **[JMdict](https://www.edrdg.org/)** - the source dictionary, © the EDRDG,
  used under the EDRDG License (CC BY-SA)

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full license details
