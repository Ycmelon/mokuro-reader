import { describe, expect, it } from 'vitest';
import { buildCardRequest, validateCardConfig, type CardMeta, type LogicalCard } from './cards';
import type { AnkiServerSettings } from '$lib/settings/misc';

const baseCfg: AnkiServerSettings = {
  serverUrl: 'https://anki.example.com',
  token: 'tok',
  username: 'me',
  cropMode: 'frame',
  cardLanguage: 'english',
  deck: 'Mining',
  noteType: 'Lapis',
  fieldMap: {
    word: 'Expression',
    reading: 'Reading',
    meaning: 'Meaning',
    sentence: 'Sentence',
    extra: 'Notes'
  },
  imageField: 'Picture',
  markerTag: 'mokuro'
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

  it('requires at least one mapped field or the image field', () => {
    const cfg = {
      ...baseCfg,
      fieldMap: { word: '', reading: '', meaning: '', sentence: '', extra: '' },
      imageField: ''
    };
    expect(validateCardConfig(cfg)).toMatch(/map at least one/i);
  });

  it('accepts image-only mapping', () => {
    const cfg = {
      ...baseCfg,
      fieldMap: { word: '', reading: '', meaning: '', sentence: '', extra: '' }
    };
    expect(validateCardConfig(cfg)).toBeNull();
  });
});

describe('buildCardRequest', () => {
  it('routes mapped, non-empty fields onto note fields', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.deck).toBe('Mining');
    expect(req.model).toBe('Lapis');
    expect(req.fields).toEqual({
      Expression: '大外れ',
      Reading: 'おおはずれ',
      Meaning: 'a total miss',
      Sentence: 'これは大外れだ。'
      // Notes omitted — extra is empty
    });
  });

  it('skips fields with no mapping', () => {
    const cfg = { ...baseCfg, fieldMap: { ...baseCfg.fieldMap, meaning: '' } };
    const req = buildCardRequest(card, cfg, meta);
    expect(req.fields).not.toHaveProperty('Meaning');
  });

  it('appends the image into the configured field with a page-numbered filename', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.images).toHaveLength(1);
    expect(req.images[0].field).toBe('Picture');
    expect(req.images[0].data).toBe(card.image);
    expect(req.images[0].filename).toMatch(/^mokuro_abcd1234_p42_\d+\.jpg$/);
  });

  it('omits the image when there is none or no target field', () => {
    expect(buildCardRequest({ ...card, image: '' }, baseCfg, meta).images).toHaveLength(0);
    expect(buildCardRequest(card, { ...baseCfg, imageField: '' }, meta).images).toHaveLength(0);
  });

  it('builds sanitized marker + series + volume tags', () => {
    const req = buildCardRequest(card, baseCfg, meta);
    expect(req.tags).toEqual(['mokuro', 'My_Series', 'Vol_1']);
  });

  it('drops empty tag parts', () => {
    const req = buildCardRequest(
      card,
      { ...baseCfg, markerTag: '' },
      {
        ...meta,
        volumeTitle: ''
      }
    );
    expect(req.tags).toEqual(['My_Series']);
  });
});
