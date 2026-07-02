export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** True while an assistant message is still receiving deltas. Markdown is
   * re-rendered from the full accumulated content on every delta, so this
   * is only used for the "Thinking…" → live-text handoff, not for choosing
   * how to render. */
  streaming?: boolean;
};

type WireMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function streamOpenRouter(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  systemPrompt: string,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!apiKey) {
    throw new Error('No OpenRouter API key set. Add one in Settings → Chat.');
  }

  const plainMessages: WireMessage[] = messages.map(({ role, content }) => ({ role, content }));
  const wireMessages: WireMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...plainMessages]
    : plainMessages;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages: wireMessages, stream: true })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ?? body?.message ?? '';
    } catch {
      // ignore parse failure
    }
    throw new Error(`OpenRouter error ${response.status}${detail ? ': ' + detail : ''}`);
  }

  if (!response.body) {
    throw new Error('OpenRouter response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // OpenRouter sends newline-delimited SSE ("data: {...}\n\n"); the last
    // line in the buffer may be a partial chunk, so hold it back until more
    // bytes arrive.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // OpenRouter emits ": OPENROUTER PROCESSING" keepalive comments and
        // other non-JSON lines between real chunks — ignore them.
      }
    }
  }

  if (!full) {
    throw new Error('Unexpected response format from OpenRouter');
  }

  return full;
}
