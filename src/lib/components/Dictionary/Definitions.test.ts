import 'fake-indexeddb/auto';
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Definitions from './Definitions.svelte';
import type { Sense } from '$lib/dictionary/types';

function sense(p: Partial<Sense> & Pick<Sense, 'pos'>): Sense {
  return {
    field: [],
    misc: [],
    dialect: [],
    info: [],
    glosses: [{ text: 'gloss' }],
    xref: [],
    langSource: [],
    examples: [],
    ...p
  };
}

describe('Definitions', () => {
  it('renders a single sense inline without a numbered list', () => {
    const { container } = render(Definitions, {
      senses: [sense({ pos: ['n'], glosses: [{ text: 'book' }] })]
    });
    expect(container.querySelector('ol')).toBeNull();
    expect(container.textContent).toContain('book');
  });

  it('joins multiple glosses of one sense with a semicolon', () => {
    const { container } = render(Definitions, {
      senses: [sense({ pos: ['n'], glosses: [{ text: 'well' }, { text: 'say' }] })]
    });
    expect(container.textContent).toContain('well; say');
  });

  it('groups senses that share a part-of-speech under one heading and numbers them', () => {
    const { container } = render(Definitions, {
      senses: [
        sense({ pos: ['n'], glosses: [{ text: 'a' }] }),
        sense({ pos: ['n'], glosses: [{ text: 'b' }] }),
        sense({ pos: ['n'], glosses: [{ text: 'c' }] })
      ]
    });
    const headings = container.querySelectorAll('.def-group-heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain('noun');
    const items = container.querySelectorAll('ol li');
    expect(items).toHaveLength(3);
  });

  it('renders misc and field tags as pills', () => {
    const { container } = render(Definitions, {
      senses: [sense({ pos: ['exp'], misc: ['uk'], field: ['comp'] })]
    });
    const tags = [...container.querySelectorAll('.dict-tag')].map((t) => t.textContent);
    expect(tags).toContain('usually kana');
    expect(tags).toContain('computing');
  });

  it('factors a tag shared by every sense into a single heading', () => {
    const { container } = render(Definitions, {
      senses: [
        sense({ pos: ['adv'], misc: ['uk'], glosses: [{ text: 'a' }] }),
        sense({ pos: ['adv'], misc: ['uk'], glosses: [{ text: 'b' }] }),
        sense({ pos: ['adv', 'int'], misc: ['uk'], glosses: [{ text: 'c' }] })
      ]
    });
    // Only one heading, carrying the shared adv + uk tags.
    const headings = container.querySelectorAll('.def-group-heading');
    expect(headings).toHaveLength(1);
    const headingTags = [...headings[0].querySelectorAll('.dict-tag')].map((t) => t.textContent);
    expect(headingTags).toContain('adverb');
    expect(headingTags).toContain('usually kana');
    // The distinguishing tag stays on its sense; the shared ones are not repeated.
    const items = [...container.querySelectorAll('ol li')];
    expect(items).toHaveLength(3);
    expect(items[2].textContent).toContain('int.');
    expect(items[0].textContent).not.toContain('adverb');
    expect(items[0].textContent).not.toContain('usually kana');
  });

  it('keeps a lone residual sense in the list with an inline tag, not its own heading', () => {
    // Shape of 良い: every sense is adj-i (hoisted to the common heading), and
    // the final sense additionally carries suf. That suffix sense must stay in
    // the numbered list with an inline "suffix" tag rather than being split out
    // under its own heading.
    const { container } = render(Definitions, {
      senses: [
        sense({ pos: ['adj-i'], glosses: [{ text: 'a' }] }),
        sense({ pos: ['adj-i'], glosses: [{ text: 'b' }] }),
        sense({ pos: ['adj-i'], glosses: [{ text: 'c' }] }),
        sense({ pos: ['adj-i'], glosses: [{ text: 'd' }] }),
        sense({ pos: ['suf', 'adj-i'], glosses: [{ text: 'e' }] })
      ]
    });
    // Exactly one heading — the shared i-adjective. No separate suffix heading.
    const headings = container.querySelectorAll('.def-group-heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain('i adj.');
    expect(headings[0].textContent).not.toContain('suffix');
    // All five senses are numbered, continuously, with suffix inline on the last.
    const items = [...container.querySelectorAll('ol li')];
    expect(items).toHaveLength(5);
    expect(items[4].textContent).toContain('suffix');
    expect(items[4].textContent).toContain('e');
    // The shared i-adjective tag is not repeated on the suffix sense.
    expect(items[4].textContent).not.toContain('i adj.');
  });

  it('numbers continuously across two part-of-speech groups', () => {
    const { container } = render(Definitions, {
      senses: [
        sense({ pos: ['n'], glosses: [{ text: 'a' }] }),
        sense({ pos: ['n'], glosses: [{ text: 'b' }] }),
        sense({ pos: ['vs'], glosses: [{ text: 'c' }] }),
        sense({ pos: ['vs'], glosses: [{ text: 'd' }] })
      ]
    });
    const ols = container.querySelectorAll('ol');
    expect(ols).toHaveLength(2);
    // Second group continues the numbering (starts at 3).
    expect(ols[1].getAttribute('start')).toBe('3');
  });
});
