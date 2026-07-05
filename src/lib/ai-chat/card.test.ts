import { describe, expect, it } from 'vitest';
import { buildGenerationPrompt, parseCardReply } from './card';

describe('parseCardReply', () => {
  it('parses a fenced ```json block', () => {
    const reply = 'Here you go:\n```json\n{"reading": "かな", "meaning": "kana"}\n```';
    expect(parseCardReply(reply)).toEqual({ reading: 'かな', meaning: 'kana' });
  });

  it('parses a fenced block without a language tag', () => {
    expect(parseCardReply('```\n{"reading": "r"}\n```')).toEqual({ reading: 'r' });
  });

  it('falls back to the first bare {...} object', () => {
    expect(parseCardReply('sure: {"meaning": "m", "extra": "e"}')).toEqual({
      meaning: 'm',
      extra: 'e'
    });
  });

  it('returns null while the object is still incomplete (streaming)', () => {
    expect(parseCardReply('```json\n{"reading": "か')).toBeNull();
    expect(parseCardReply('no object here')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseCardReply('```json\n"just a string"\n```')).toBeNull();
    expect(parseCardReply('```json\nnull\n```')).toBeNull();
  });

  it('keeps only known keys and drops null/undefined values', () => {
    const reply = '{"reading": "r", "bogus": "x", "meaning": null, "extra": 5}';
    expect(parseCardReply(reply)).toEqual({ reading: 'r', extra: '5' });
  });
});

describe('buildGenerationPrompt', () => {
  it('includes the sentence and focus', () => {
    const prompt = buildGenerationPrompt({
      sentence: 'これは大外れだ。',
      focus: '大外れ',
      image: ''
    });
    expect(prompt).toContain('Sentence: これは大外れだ。');
    expect(prompt).toContain('Focus: 大外れ');
  });
});
