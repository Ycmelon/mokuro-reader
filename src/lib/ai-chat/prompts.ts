// AI chat prompts — edit these to change the assistant's behaviour.
//
// These used to be user-editable settings, but they're now hardcoded here so
// there's a single, easy-to-find place to tweak them without digging through
// the settings UI or localStorage.

/** Sent as the system message on every chat request. */
export const SYSTEM_PROMPT = `The user will send sentences pasted in from manga. Explain the sentences in simple Japanese.
Do not provide kanji readings.
If follow up questions in Japanese contain mistakes, correct them as well.`;

/**
 * Template used when opening the chat via "Explain" on a text box.
 * `$1` is replaced with the text box content.
 */
export const EXPLAIN_TEMPLATE = '$1';
