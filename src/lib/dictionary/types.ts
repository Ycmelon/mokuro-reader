export type StructuredContentStyle = {
  fontStyle?: string;
  fontWeight?: string;
  fontSize?: string;
  color?: string;
  background?: string;
  backgroundColor?: string;
  verticalAlign?: string;
  textAlign?: string;
  textEmphasis?: string;
  textShadow?: string;
  textDecorationLine?: string | string[];
  textDecorationStyle?: string;
  textDecorationColor?: string;
  borderColor?: string;
  borderStyle?: string;
  borderRadius?: string;
  borderWidth?: string;
  clipPath?: string;
  margin?: string;
  marginTop?: number | string;
  marginLeft?: number | string;
  marginRight?: number | string;
  marginBottom?: number | string;
  padding?: string;
  paddingTop?: string;
  paddingLeft?: string;
  paddingRight?: string;
  paddingBottom?: string;
  wordBreak?: string;
  whiteSpace?: string;
  cursor?: string;
  listStyleType?: string;
};

export type StructuredContent =
  | string
  | StructuredContent[]
  | StructuredContentWrapper
  | StructuredContentNode;

export interface StructuredContentWrapper {
  type: 'structured-content';
  content: StructuredContent;
}

export interface StructuredContentNode {
  tag: string;
  content?: StructuredContent;
  style?: StructuredContentStyle;
  data?: Record<string, string>;
  lang?: string;
  title?: string;
  // table cells
  colSpan?: number;
  rowSpan?: number;
  // details
  open?: boolean;
  // anchor
  href?: string;
}

export type Definition = string | StructuredContentWrapper;

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

export interface StoredTerm {
  id?: number;
  dictionaryId: number;
  expression: string;
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  definitions: Definition[];
  sequence: number;
  termTags: string;
}

/** A single writing or reading of a merged entry, with display hints derived
 *  from the dictionary's headword tags. */
export interface Headword {
  text: string;
  /** Rare/old/irregular/obsolete form — rendered de-emphasized. */
  obscure: boolean;
  /** Priority (common) spelling or reading — carries a star. */
  priority: boolean;
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
  /** Primary writing (first non-obscure, highest-scoring of the merged entry). */
  expression: string;
  /** Primary reading. */
  reading: string;
  /** All kanji writings of the entry (same JMdict sequence), primary first. */
  writings: Headword[];
  /** All kana readings of the entry, primary first. */
  readings: Headword[];
  definitions: Definition[];
  dictionaryTitle: string;
  score: number;
  /** The entry as a whole is a high-priority (common) word. */
  priority: boolean;
  inflectionPath: string[];
  /** Pitch-accent readings, when a pitch dictionary is installed. */
  pitches: PitchAccent[];
}
