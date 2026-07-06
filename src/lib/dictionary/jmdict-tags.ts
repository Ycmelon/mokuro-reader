// Display labels and classification for JMdict tag codes. Labels are copied from
// 10ten (birchill/10ten-ja-reader, GPL-3.0) so tags read identically; JMdict
// entity codes spell some tags with hyphens where 10ten's keys use underscores,
// so lookups normalize `-` → `_` first.

export const POS_LABELS: Record<string, string> = {
  adj_f: 'pre-noun adj.',
  adj_i: 'i adj.',
  adj_ix: 'ii/yoi adj.',
  adj_kari: 'kari adj.',
  adj_ku: 'ku adj.',
  adj_na: 'na adj.',
  adj_nari: 'nari adj.',
  adj_no: 'no-adj.',
  adj_pn: 'pre-noun adj.',
  adj_shiku: 'shiku adj.',
  adj_t: 'taru adj.',
  adv: 'adverb',
  adv_to: 'adverb to',
  aux: 'aux.',
  aux_adj: 'aux. adj.',
  aux_v: 'aux. verb',
  conj: 'conj.',
  cop: 'copula',
  ctr: 'counter',
  exp: 'exp.',
  int: 'int.',
  n: 'noun',
  n_adv: 'adv. noun',
  n_pr: 'proper noun',
  n_pref: 'n-pref',
  n_suf: 'n-suf',
  n_t: 'n-temp',
  num: 'numeric',
  pn: 'pronoun',
  pref: 'prefix',
  prt: 'particle',
  suf: 'suffix',
  unc: '?',
  v_unspec: 'verb',
  v1: 'Ichidan/ru-verb',
  v1_s: 'Ichidan/ru-verb (kureru)',
  v2a_s: '-u Nidan verb',
  v2b_k: '-bu upper Nidan verb',
  v2b_s: '-bu lower Nidan verb',
  v2d_k: '-dzu upper Nidan verb',
  v2d_s: '-dzu lower Nidan verb',
  v2g_k: '-gu upper Nidan verb',
  v2g_s: '-gu lower Nidan verb',
  v2h_k: '-hu/-fu upper Nidan verb',
  v2h_s: '-hu/-fu lower Nidan verb',
  v2k_k: '-ku upper Nidan verb',
  v2k_s: '-ku lower Nidan verb',
  v2m_k: '-mu upper Nidan verb',
  v2m_s: '-mu lower Nidan verb',
  v2n_s: '-nu Nidan verb',
  v2r_k: '-ru upper Nidan verb',
  v2r_s: '-ru lower Nidan verb',
  v2s_s: '-su Nidan verb',
  v2t_k: '-tsu upper Nidan verb',
  v2t_s: '-tsu upper Nidan verb',
  v2w_s: '-u Nidan verb + we',
  v2y_k: '-yu upper Nidan verb',
  v2y_s: '-yu lower Nidan verb',
  v2z_s: '-zu Nidan verb',
  v4b: '-bu Yodan verb',
  v4g: '-gu Yodan verb',
  v4h: '-hu/-fu Yodan verb',
  v4k: '-ku Yodan verb',
  v4m: '-mu Yodan verb',
  v4n: '-nu Yodan verb',
  v4r: '-ru Yodan verb',
  v4s: '-su Yodan verb',
  v4t: '-tsu Yodan verb',
  v5aru: '-aru godan verb',
  v5b: '-bu Godan/u-verb',
  v5g: '-gu Godan/u-verb',
  v5k: '-ku Godan/u-verb',
  v5k_s: 'iku/yuku Godan/u-verb',
  v5m: '-mu Godan/u-verb',
  v5n: '-nu Godan/u-verb',
  v5r: '-ru Godan/u-verb',
  v5r_i: '-ru Godan/u-verb (irr.)',
  v5s: '-su Godan/u-verb',
  v5t: '-tsu Godan/u-verb',
  v5u: '-u Godan/u-verb',
  v5u_s: '-u Godan/u-verb (special)',
  v5uru: '-uru Godan/u-verb',
  vi: 'intrans.',
  vk: 'kuru verb',
  vn: '-nu irr. verb',
  vr: '-ru (-ri) irr. verb',
  vs: '+suru verb',
  vs_c: '-su(ru) verb',
  vs_i: '-suru verb',
  vs_s: '-suru verb (special)',
  vt: 'trans.',
  vz: '-zuru Ichidan/ru-verb'
};

export const MISC_LABELS: Record<string, string> = {
  abbr: 'abbrev.',
  aphorism: 'aphorism',
  arch: 'archaic',
  char: 'character',
  chn: 'children',
  col: 'colloquial',
  company: 'company',
  creat: 'creature',
  dated: 'dated',
  dei: 'deity',
  derog: 'derogatory',
  doc: 'document',
  euph: 'euphemistic',
  ev: 'event',
  fam: 'familiar',
  fem: 'female term',
  fict: 'fiction',
  form: 'formal',
  given: 'given name',
  group: 'group',
  hist: 'historical',
  hon: 'honorific',
  hum: 'humble',
  id: 'idiomatic',
  joc: 'jocular',
  leg: 'legend',
  m_sl: 'manga slang',
  male: 'male',
  myth: 'mythology',
  net_sl: 'Internet slang',
  obj: 'object',
  obs: 'obsolete',
  obsc: 'obscure',
  on_mim: 'onomatopoeia',
  organization: 'org.',
  oth: 'other',
  person: 'person',
  place: 'place',
  poet: 'poetical',
  pol: 'polite',
  product: 'product',
  proverb: 'proverb',
  quote: 'quote',
  rare: 'rare',
  relig: 'religion',
  sens: 'sensitive',
  serv: 'service',
  ship: 'ship',
  sl: 'slang',
  station: 'station',
  surname: 'surname',
  uk: 'usually kana',
  unclass: 'unclassified',
  vulg: 'vulgar',
  work: 'work',
  X: 'X-rated',
  yoji: 'yojijukugo'
};

export const FIELD_LABELS: Record<string, string> = {
  agric: 'agriculture',
  anat: 'anatomy',
  archeol: 'archeolology',
  archit: 'architecture',
  art: 'art',
  astron: 'astronomy',
  audvid: 'audiovisual',
  aviat: 'aviation',
  baseb: 'baseball',
  biochem: 'biochemistry',
  biol: 'biology',
  bot: 'botany',
  boxing: 'boxing',
  Buddh: 'Buddhism',
  bus: 'business',
  cards: 'card games',
  chem: 'chemistry',
  chmyth: 'Chinese myth.',
  Christn: 'Christianity',
  civeng: 'civil eng.',
  cloth: 'clothing',
  comp: 'computing',
  cryst: 'crystallography',
  dent: 'dentistry',
  ecol: 'ecology',
  econ: 'economics',
  elec: 'electricity',
  electr: 'electronics',
  embryo: 'embryology',
  engr: 'engineering',
  ent: 'entomology',
  figskt: 'figure skating',
  film: 'film',
  finc: 'finance',
  fish: 'fishing',
  food: 'food',
  gardn: 'gardening',
  genet: 'genetics',
  geogr: 'geography',
  geol: 'geology',
  geom: 'geometry',
  go: 'Go',
  golf: 'golf',
  gramm: 'grammar',
  grmyth: 'Greek mythology',
  hanaf: 'hanafuda',
  horse: 'horse racing',
  internet: 'Internet',
  jpmyth: 'Japanese myth.',
  kabuki: 'kabuki',
  law: 'law',
  ling: 'linguistics',
  logic: 'logic',
  MA: 'martial arts',
  mahj: 'mahjong',
  manga: 'manga',
  math: 'mathematics',
  mech: 'mechanical engineering',
  med: 'medicine',
  met: 'climate, weather',
  mil: 'military',
  min: 'mineralogy',
  mining: 'mining',
  motor: 'motorsport',
  music: 'music',
  noh: 'Noh',
  ornith: 'ornithology',
  paleo: 'paleontology',
  pathol: 'pathology',
  pharm: 'pharmacology',
  phil: 'philosophy',
  photo: 'photography',
  physics: 'physics',
  physiol: 'physiology',
  politics: 'politics',
  print: 'printing',
  prowres: 'wrestling',
  psy: 'psychiatry',
  psyanal: 'psychoanalysis',
  psych: 'psychology',
  rail: 'railway',
  rommyth: 'Roman mythology',
  Shinto: 'Shinto',
  shogi: 'shogi',
  ski: 'skiing',
  sports: 'sports',
  stat: 'statistics',
  stockm: 'stock market',
  sumo: 'sumo',
  surg: 'surgery',
  telec: 'telecommunications',
  tradem: 'trademark',
  tv: 'TV',
  vet: 'veterinary',
  vidg: 'video games',
  zool: 'zoology'
};

export const DIAL_LABELS: Record<string, string> = {
  '9s': 'Kyushu dialect',
  bra: 'Brazilian dialect',
  ho: 'Hokkaido dialect',
  ks: 'Kansai dialect',
  kt: 'Kanto dialect',
  ky: 'Kyoto dialect',
  na: 'Nagano dialect',
  ok: 'Ryuukyuu dialect',
  os: 'Osaka dialect',
  th: 'Tohoku dialect',
  ts: 'Tosa dialect',
  tsug: 'Tsugaru dialect'
};

// Headword info tag → label key. JMdict spells kanji/kana info as iK/ik/oK/…;
// 10ten's label keys collapse these to ikanji/ikana/okanji/… .
const HEAD_INFO_LABEL_KEY: Record<string, string> = {
  iK: 'ikanji',
  ik: 'ikana',
  io: 'io',
  oK: 'okanji',
  ok: 'okana',
  rK: 'rkanji',
  rk: 'rkana',
  sK: 'ikanji',
  sk: 'ikana',
  ateji: 'ateji',
  gikun: 'gikun'
};

const HEAD_INFO_LABELS: Record<string, string> = {
  ateji: 'ateji',
  gikun: 'gikun',
  ikana: 'irreg.',
  ikanji: 'irreg.',
  io: 'irreg.',
  okana: 'old',
  okanji: 'old',
  rkana: 'rare',
  rkanji: 'rare'
};

/** Info tags that mark a writing/reading as non-standard (de-emphasized). */
const OBSCURE_INFO = new Set(['iK', 'io', 'oK', 'rK', 'ik', 'ok', 'rk']);

/** Search-only info tags (JMdict sK/sk): lookup aliases never meant for display.
 *  Both Yomitan and 10ten hide these entirely. */
const SEARCH_ONLY_INFO = new Set(['sK', 'sk']);

/** True when a headword's info tags mark it rare/irregular/old (shown dimmed). */
export function isObscureHeadword(info: string[]): boolean {
  return info.some((t) => OBSCURE_INFO.has(t));
}

/** True when a headword is a search-only form (sK/sk) — hidden from display. */
export function isSearchOnlyHeadword(info: string[]): boolean {
  return info.some((t) => SEARCH_ONLY_INFO.has(t));
}

/** Display label for a headword info tag (e.g. 'iK' → 'irreg.'). */
export function headInfoLabel(tag: string): string {
  const key = HEAD_INFO_LABEL_KEY[tag] ?? tag;
  return HEAD_INFO_LABELS[key] ?? tag;
}

const norm = (code: string): string => code.replace(/-/g, '_');

export const posLabel = (code: string): string => POS_LABELS[norm(code)] ?? code;
export const miscLabel = (code: string): string => MISC_LABELS[norm(code)] ?? code;
export const fieldLabel = (code: string): string =>
  FIELD_LABELS[code] ?? FIELD_LABELS[norm(code)] ?? code;
export const dialLabel = (code: string): string =>
  DIAL_LABELS[code] ?? DIAL_LABELS[norm(code)] ?? code;

/** Tag pill colour class per tag family, matching 10ten (field=green,
 *  misc=blue, dial=pink; pos has no fill). */
export type TagKind = 'pos' | 'field' | 'misc' | 'dial';

/**
 * Maps a set of JMdict part-of-speech codes to the space-joined deinflection
 * rule tokens the LanguageTransformer understands. Only the six dictionary-form
 * conditions are recognized (`v1 v5 vk vs vz adj-i`); every other POS (nouns,
 * na-adjectives, adverbs…) contributes no rule. The union across a word's senses
 * is what a deinflected candidate is matched against.
 */
export function posToRules(pos: Iterable<string>): string {
  const rules = new Set<string>();
  for (const p of pos) {
    if (p === 'adj-i' || p === 'adj-ix') rules.add('adj-i');
    else if (p === 'vz') rules.add('vz');
    else if (p === 'vk') rules.add('vk');
    else if (p.startsWith('vs'))
      rules.add('vs'); // vs, vs-s, vs-i, vs-c
    else if (p.startsWith('v1'))
      rules.add('v1'); // v1, v1-s
    else if (p.startsWith('v5'))
      rules.add('v5'); // v5r, v5u, v5k-s, …
    else if (p === 'vn' || p === 'vr') rules.add('v5'); // irregular nu/ri → godan-ish
  }
  return [...rules].join(' ');
}
