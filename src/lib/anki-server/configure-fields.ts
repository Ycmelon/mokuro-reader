/**
 * Open-state for the "Configure fields" dialog. The Anki settings accordion opens
 * it with the currently selected note type and its field list (sourced from
 * whichever protocol is connected); the dialog edits the per-note-type templates
 * stored in `ankiServerSettings.fieldTemplates`.
 */
import { writable } from 'svelte/store';

export type ConfigureFieldsState = {
  open: boolean;
  noteType: string;
  fields: string[];
};

export const configureFieldsStore = writable<ConfigureFieldsState>({
  open: false,
  noteType: '',
  fields: []
});

export function openConfigureFields(noteType: string, fields: string[]) {
  configureFieldsStore.set({ open: true, noteType, fields });
}

export function closeConfigureFields() {
  configureFieldsStore.update((s) => ({ ...s, open: false }));
}
