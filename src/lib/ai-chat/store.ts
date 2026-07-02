import { get, writable } from 'svelte/store';
import { miscSettings } from '$lib/settings/misc';
import { streamOpenRouter, type ChatMessage } from './openrouter';
import { SYSTEM_PROMPT, EXPLAIN_TEMPLATE } from './prompts';

export { type ChatMessage };

export const chatOpen = writable(false);
export const chatMessages = writable<ChatMessage[]>([]);
export const chatPendingInput = writable('');
export const chatLoading = writable(false);
export const chatError = writable('');

export function openChatWithExplain(fullText: string) {
  const prompt = EXPLAIN_TEMPLATE.replace('$1', fullText);
  chatPendingInput.set(prompt);
  chatOpen.set(true);
}

export function closeChat() {
  chatOpen.set(false);
}

export function clearHistory() {
  chatMessages.set([]);
  chatError.set('');
}

export async function sendMessage(content: string) {
  const { openrouterApiKey, model, maxHistoryMessages } = get(miscSettings).aiChatSettings;

  const userMessage: ChatMessage = { role: 'user', content };
  chatMessages.update((msgs) => [...msgs, userMessage]);
  chatLoading.set(true);
  chatError.set('');

  // The first delta appends a fresh assistant message (and clears the
  // "Thinking…" spinner); subsequent deltas grow that same message's content
  // in place, and the UI re-renders markdown from the full text on every
  // update so formatting appears live as the response streams in.
  let assistantStarted = false;
  function appendDelta(delta: string) {
    if (!assistantStarted) {
      assistantStarted = true;
      chatLoading.set(false);
      chatMessages.update((msgs) => [
        ...msgs,
        { role: 'assistant', content: delta, streaming: true }
      ]);
    } else {
      chatMessages.update((msgs) => {
        const last = msgs[msgs.length - 1];
        return [...msgs.slice(0, -1), { ...last, content: last.content + delta }];
      });
    }
  }

  try {
    const history = get(chatMessages).slice(-maxHistoryMessages);
    await streamOpenRouter(history, model, openrouterApiKey, SYSTEM_PROMPT, appendDelta);
  } catch (e) {
    chatError.set(e instanceof Error ? e.message : String(e));
  } finally {
    chatLoading.set(false);
    if (assistantStarted) {
      chatMessages.update((msgs) => {
        const last = msgs[msgs.length - 1];
        return [...msgs.slice(0, -1), { ...last, streaming: false }];
      });
    }
  }
}
