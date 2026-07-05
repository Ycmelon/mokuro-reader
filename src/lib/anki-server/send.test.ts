import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnkiServerSettings } from '$lib/settings/misc';
import type { CardMeta, LogicalCard } from './cards';

vi.mock('$lib/anki-connect', () => ({ ankiConnect: vi.fn() }));
vi.mock('./client', () => ({ createCard: vi.fn() }));

import { sendMinedCard } from './send';
import { ankiConnect } from '$lib/anki-connect';
import { createCard } from './client';

const mockAnkiConnect = vi.mocked(ankiConnect);
const mockCreateCard = vi.mocked(createCard);

const cfg: AnkiServerSettings = {
  protocol: 'ankiconnect',
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
      { fieldName: 'Picture', template: '{image}' }
    ]
  },
  tagsTemplate: 'mokuro'
};

const card: LogicalCard = {
  word: '大外れ',
  reading: '',
  meaning: '',
  sentence: '',
  extra: '',
  image: 'data:image/jpeg;base64,QUFBQQ=='
};

const meta: CardMeta = {
  seriesTitle: 'S',
  volumeTitle: 'V',
  volumeUuid: 'abcd1234ef567890',
  pageIndex: 0
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendMinedCard via AnkiConnect', () => {
  it('pre-creates the deck and adds the note with raw-base64 picture data', async () => {
    mockAnkiConnect.mockResolvedValue(1234); // both createDeck and addNote succeed
    await sendMinedCard(card, cfg, meta);

    expect(mockAnkiConnect).toHaveBeenCalledWith(
      'createDeck',
      { deck: 'Mining' },
      { silent: true }
    );

    const addNoteCall = mockAnkiConnect.mock.calls.find(([action]) => action === 'addNote');
    expect(addNoteCall).toBeDefined();
    const note = (addNoteCall![1] as { note: Record<string, unknown> }).note;
    expect(note.deckName).toBe('Mining');
    expect(note.modelName).toBe('Lapis');
    expect(note.fields).toEqual({ Expression: '大外れ' });
    // The data URL prefix must be stripped for AnkiConnect's picture param.
    expect(note.picture).toEqual([
      expect.objectContaining({ data: 'QUFBQQ==', fields: ['Picture'] })
    ]);
  });

  it('omits the picture param when there is no image', async () => {
    mockAnkiConnect.mockResolvedValue(1234);
    await sendMinedCard({ ...card, image: '' }, cfg, meta);
    const addNoteCall = mockAnkiConnect.mock.calls.find(([action]) => action === 'addNote');
    const note = (addNoteCall![1] as { note: Record<string, unknown> }).note;
    expect(note.picture).toBeUndefined();
  });

  it('throws when addNote reports failure so the dialog stays open', async () => {
    // ankiConnect returns undefined on failure (it snackbars internally).
    mockAnkiConnect.mockResolvedValue(undefined);
    await expect(sendMinedCard(card, cfg, meta)).rejects.toThrow(/could not add/i);
  });
});

describe('sendMinedCard via the Anki server', () => {
  it('POSTs the built request to the configured server', async () => {
    mockCreateCard.mockResolvedValue({ note_id: 1, image_filenames: [] });
    await sendMinedCard(card, { ...cfg, protocol: 'server' }, meta);

    expect(mockAnkiConnect).not.toHaveBeenCalled();
    expect(mockCreateCard).toHaveBeenCalledWith(
      'https://anki.example.com',
      'tok',
      expect.objectContaining({
        deck: 'Mining',
        model: 'Lapis',
        fields: { Expression: '大外れ' }
      })
    );
  });
});
