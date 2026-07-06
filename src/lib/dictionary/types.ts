// ── jmdict-simplified sense model ────────────────────────────────────────────
// Fields are kept separated (part-of-speech, misc/field/dialect tags, glosses,
// notes, cross-references, language source) so the popup can lay entries out in
// the 10ten style — POS-grouped, numbered, tagged — rather than rendering an
// opaque display blob.

/** One English gloss. `type` carries JMdict's g_type (literal/figurative/
 *  explanation/trademark) when present. */
export interface Gloss {
  text: string;
  type?: 'literal' | 'figurative' | 'explanation' | 'trademark';
}

/** A loanword's source language (JMdict lsource). */
export interface LangSource {
  /** ISO-639 language code of the source (e.g. 'fre'); defaults to English. */
  lang?: string;
  /** The source-language word, when given. */
  text?: string;
  /** 和製 — a Japanese-made pseudo-loan (wasei). */
  wasei?: boolean;
}

/** A bilingual example sentence. Empty until a Tatoeba pass attaches them by
 *  JMdict sequence; the popup renders nothing when absent. */
export interface Example {
  japanese: string;
  english: string;
}

/** One sense of an entry — a group of glosses sharing part-of-speech and tags. */
export interface Sense {
  /** Part-of-speech codes (JMdict entities, e.g. 'v5r', 'n', 'adj-i'). */
  pos: string[];
  /** Field-of-application tags (e.g. 'comp', 'med'). */
  field: string[];
  /** Miscellaneous tags (e.g. 'uk', 'col', 'hon'). */
  misc: string[];
  /** Dialect tags (e.g. 'ksb'). */
  dialect: string[];
  /** Sense-level notes (JMdict s_inf). */
  info: string[];
  /** English glosses, in order. */
  glosses: Gloss[];
  /** Cross-reference terms (first element of each JMdict xref/ant). */
  xref: string[];
  /** Loanword source(s), when the sense is a borrowing. */
  langSource: LangSource[];
  /** Bilingual examples (Tatoeba). Empty until the examples pass runs. */
  examples: Example[];
}

export interface DictionaryMeta {
  id?: number;
  title: string;
  revision: string;
  format: number;
  importedAt: Date;
  entryCount: number;
  /** Contents of the dictionary's bundled styles.css (Yomitan external CSS), if any */
  styleCss?: string;
  /** True only once every term bank has been imported. Guards against partial imports. */
  complete?: boolean;
}

export interface StoredTag {
  id?: number;
  dictionaryId: number;
  name: string;
  category: string;
  order: number;
  notes: string;
  score: number;
}

/** One stored dictionary word (a whole JMdict entry). Unlike the old Yomitan
 *  per-(expression,reading) rows, a word already carries every writing, reading
 *  and sense, so lookup no longer re-merges by sequence. Indexed by `keys` (a
 *  multiEntry index over every writing + reading text). */
export interface StoredTerm {
  id?: number;
  dictionaryId: number;
  /** JMdict entry id — stable across builds, used to attach examples/meta. */
  sequence: number;
  /** Every writing + reading text, for the multiEntry lookup index. */
  keys: string[];
  /** Kanji forms (empty for kana-only words), primary first. */
  writings: Headword[];
  /** Kana forms, primary first. */
  readings: Headword[];
  /** Space-joined deinflection rule tokens (subset of v1 v5 vk vs vz adj-i),
   *  the union across the word's senses. Empty for non-inflecting words. */
  rules: string;
  /** Ranking score (higher = more common). */
  score: number;
  senses: Sense[];
}

/** A single writing or reading of an entry, with display hints derived from the
 *  dictionary's headword tags. */
export interface Headword {
  text: string;
  /** Rare/old/irregular/obsolete form — rendered de-emphasized. */
  obscure: boolean;
  /** Search-only form (JMdict sK/sk): a lookup alias never meant for display.
   *  Kept in the term's `keys` index so it still resolves, but not rendered. */
  hidden: boolean;
  /** Priority (common) spelling or reading — carries a star. */
  priority: boolean;
  /** Raw JMdict info tags (iK, ik, oK, ok, rK, rk, sK, sk, io…) for tooltips. */
  info: string[];
}

/** Pitch-accent data for one reading. Each position is the mora index of the
 *  downstep; 0 means heiban (no downstep). */
export interface PitchAccent {
  reading: string;
  positions: number[];
}

/** A Yomitan term_meta_bank row. Only pitch and frequency modes are stored;
 *  other modes (e.g. IPA) are ignored on import. */
export interface StoredTermMeta {
  id?: number;
  dictionaryId: number;
  expression: string;
  mode: 'pitch' | 'freq';
  reading?: string;
  /** Pitch: downstep mora positions (0 = heiban). */
  positions?: number[];
  /** Freq: a display string (e.g. a rank) and a numeric value for sorting. */
  frequency?: string;
  frequencyValue?: number;
}

export interface LookupResult {
  /** Primary writing (first non-obscure). */
  expression: string;
  /** Primary reading. */
  reading: string;
  /** All kanji writings of the entry, primary first. */
  writings: Headword[];
  /** All kana readings of the entry, primary first. */
  readings: Headword[];
  /** Separated senses (POS/tags/glosses), for 10ten-style layout. */
  senses: Sense[];
  dictionaryTitle: string;
  score: number;
  /** The entry as a whole is a high-priority (common) word. */
  priority: boolean;
  inflectionPath: string[];
  /** Pitch-accent readings, when a pitch dictionary is installed. */
  pitches: PitchAccent[];
}
