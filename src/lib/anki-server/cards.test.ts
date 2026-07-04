import { describe, expect, it } from 'vitest';
import {
  buildCardRequest,
  defaultFieldTemplates,
  resolveMinedTemplate,
  validateCardConfig,
  type CardMeta,
  type LogicalCard
} from './cards';
import type { AnkiServerSettings } from '$lib/settings/misc';

const baseCfg: AnkiServerSettings = {
  protocol: 'server',
  serverUrl: 'https://anki.example.com',
  token: 'tok',
  username: 'me',
  cropMode: 'frame',
  cardLanguage: 'english',
  deck: 'Mining',
  noteType: 'Lapis',
  fieldTemplates: {
    Lapis: [
      { fieldName: 'Expression', template: '{word}' },
      { fieldName: 'Reading', template: '{reading}' },
      { fieldName: 'Meaning', template: '{meaning}' },
      { fieldName: 'Sentence', template: '{sentence}' },
      { fieldName: 'Notes', template: '{extra}' },
      { fieldName: 'Picture', template: '{image}' }
    ]
  },
  tagsTemplate: 'mokuro {series} {volume}'
};

const card: LogicalCard = {
  word: '大外れ',
  reading: 'おおはずれ',
  meaning: 'a total miss',
  sentence: 'これは大外れだ。',
  extra: '',
  image: 'data:image/jpeg;base64,AAAA'
};

const meta: CardMeta = {
  seriesTitle: 'My Series',
  volumeTitle: 'Vol 1',
  volumeUuid: 'abcd1234ef567890',
  pageIndex: 41
};

describe('defaultFieldTemplates', () => {
  it('fills fields whose name exactly matches a logical variable (case-insensitive)', () => {
    expect(defaultFieldTemplates(['Word', 'reading', 'IMAGE'])).toEqual([
      { fieldName: 'Word', template: '{word}' },
      { fieldName: 'reading', template: '{reading}' },
      { fieldName: 'IMAGE', template: '{image}' }
    ]);
  });

  it('leaves non-matching field names blank (no fuzzy aliases)', () => {
    expect(defaultFieldTemplates(['Expression', 'Picture', 'Front'])).toEqual([
      { fieldName: 'Expression', template: '' },
      { fieldName: 'Picture', template: '' },
      { fieldName: 'Front', template: '' }
    ]);
  });
});

describe('resolveMinedTemplate', () => {
  it('substitutes text variables and strips {image}', () => {
    expect(resolveMinedTemplate('{reading}【{word}】', card, meta)).toBe('おおはずれ【大外れ】');
    expect(resolveMinedTemplate('{image}', card, meta)).toBe('');
    expect(resolveMinedTemplate('{series} p{page}', card, meta)).toBe('My Series p42');
  });

  it('converts newlines to <br>', () => {
    expect(resolveMinedTemplate('a\nb', card, meta)).toBe('a<br>b');
  });
});

describe('validateCardConfig', () => {
  it('passes a fully configured destination', () => {
    expect(validateCardConfig(baseCfg)).toBeNull();
  });

  it('requires a deck', () => {
    expect(validateCardConfig({ ...baseCfg, deck: '' })).toMatch(/deck/i);
  });

  it('requires a note type', () => {
    expect(validateCardConfig({ ...baseCfg, noteType: '' })).toMatch(/note type/i);
  });

  it('requires at least one non-empty template', () => {
    const cfg: AnkiServerSettings = {
      ...baseCfg,
      fieldTemplates: { Lapis: [{ fieldName: 'Expression', template: '' }] }
    };
    expect(validateCardConfig(cfg)).toMatch(/configure at least one/i);
  });

  it('accepts an image-only template', () => {
    const cfg: AnkiServerSettings = {
      ...baseCfg,
      fieldTemplates: { Lapis: [{ fieldName: 'Picture', template: '{image}' }] }
    };
    expect(validateCardConfig(cfg)).toBeNull();
  });
});

describe('buildCardRequest', () => {
  it('resolves templates onto note fields, skipping empties', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.deck).toBe('Mining');
    expect(req.model).toBe('Lapis');
    expect(req.fields).toEqual({
      Expression: '大外れ',
      Reading: 'おおはずれ',
      Meaning: 'a total miss',
      Sentence: 'これは大外れだ。'
      // Notes omitted — extra is empty; Picture omitted — {image} is not text
    });
  });

  it('skips fields with a blank template', () => {
    const cfg: AnkiServerSettings = {
      ...baseCfg,
      fieldTemplates: {
        Lapis: baseCfg.fieldTemplates.Lapis.map((m) =>
          m.fieldName === 'Meaning' ? { ...m, template: '' } : m
        )
      }
    };
    const req = buildCardRequest(card, cfg, meta);
    expect(req.fields).not.toHaveProperty('Meaning');
  });

  it('routes the image into the {image} field with a page-numbered filename', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.images).toHaveLength(1);
    expect(req.images[0].field).toBe('Picture');
    expect(req.images[0].data).toBe(card.image);
    expect(req.images[0].filename).toMatch(/^mokuro_abcd1234_p42_\d+\.jpg$/);
  });

  it('omits the image when there is none or no {image} field', () => {
    expect(buildCardRequest({ ...card, image: '' }, baseCfg, meta).images).toHaveLength(0);
    const noImageField: AnkiServerSettings = {
      ...baseCfg,
      fieldTemplates: { Lapis: [{ fieldName: 'Expression', template: '{word}' }] }
    };
    expect(buildCardRequest(card, noImageField, meta).images).toHaveLength(0);
  });

  it('resolves the tag template into sanitized tags', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.tags).toEqual(['mokuro', 'My_Series', 'Vol_1']);
  });

  it('drops empty tag parts', () => {
    const req = buildCardRequest(
      card,
      { ...baseCfg, tagsTemplate: '{series} {volume}' },
      { ...meta, volumeTitle: '' }
    );
    expect(req.tags).toEqual(['My_Series']);
  });
});
