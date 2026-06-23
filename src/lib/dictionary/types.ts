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

export interface LookupResult {
  expression: string;
  reading: string;
  definitions: Definition[];
  dictionaryTitle: string;
  score: number;
  inflectionPath: string[];
}
