import { writable, derived } from 'svelte/store';

/**
 * One selected OCR text box. `id` is the box's `boxId`
 * (`${volumeUuid}-${pageIndex}-${index}`), which is globally unique across pages
 * so the selection can persist across page turns. `text` is the box's lines
 * concatenated with no separator (same normalization as `copySentence`).
 */
export interface TextSelectionEntry {
  id: string;
  text: string;
}

/**
 * The ordered selection. Order is the order boxes were tapped (requirement:
 * copied text follows selection order). Shared (not component) state because
 * TextBoxes.svelte is instantiated per page and dual-page mode renders two
 * instances — mirrors the `activeTextBox` store in dictionary/lookup.ts.
 */
export const selection = writable<TextSelectionEntry[]>([]);

/** Whether select mode is active (changes tap behavior + shows the action bar). */
export const selectMode = writable<boolean>(false);

/** Toggle a box in/out of the ordered selection. Re-tapping removes it; the
 *  remaining entries keep their relative order (and renumber accordingly). */
export function toggleSelection(id: string, text: string): void {
  selection.update((list) => {
    const idx = list.findIndex((e) => e.id === id);
    if (idx >= 0) return list.filter((e) => e.id !== id);
    return [...list, { id, text }];
  });
}

export function clearSelection(): void {
  selection.set([]);
}

export function setSelection(entries: TextSelectionEntry[]): void {
  selection.set(entries);
}

export function enterSelectMode(): void {
  selectMode.set(true);
}

export function exitSelectMode(): void {
  selectMode.set(false);
  clearSelection();
}

/** Ordered text: each box on its own line, boxes joined by a single line break. */
export const copyText = derived(selection, ($selection) =>
  $selection.map((e) => e.text).join('\n')
);

export const selectionCount = derived(selection, ($selection) => $selection.length);
