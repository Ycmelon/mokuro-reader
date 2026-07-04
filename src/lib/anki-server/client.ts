// HTTP client for the standalone Python anki server (see anki_server/).
// The server authenticates via an AnkiWeb login that returns an opaque bearer
// token; every other call sends it as `Authorization: Bearer <token>`.

export type AnkiServerStatus = {
  username: string;
  decks: string[];
  models: { name: string; fields: string[] }[];
  last_pull_at: number;
  pending_push: boolean;
  full_sync_needed: string | null;
  last_error: string | null;
};

/** Thrown when the server rejects the session token (expired / invalid). */
export class UnauthorizedError extends Error {
  constructor(message = 'Session expired — log in again') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

async function errorFrom(response: Response): Promise<string> {
  // FastAPI errors are `{ "detail": "..." }`.
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (detail) return JSON.stringify(detail);
  } catch {
    // non-JSON body — fall through
  }
  return `HTTP ${response.status}`;
}

/**
 * Shared fetch for the authenticated endpoints (status / cards / sync): sends the
 * bearer token, JSON-encodes a body when given, and maps the three failure modes
 * every caller handles the same way — unreachable server, 401, and other non-2xx.
 * `login`/`logout` don't use this: login has its own 401 semantics (bad
 * credentials aren't an expired session), and logout swallows all errors.
 */
async function authedFetch(
  serverUrl: string,
  path: string,
  opts: { method?: string; token: string; json?: unknown } = { token: '' }
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(joinUrl(serverUrl, path), {
      method: opts.method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined
    });
  } catch {
    throw new Error(`Could not reach the server at ${serverUrl}`);
  }

  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(await errorFrom(response));
  }
  return response;
}

/** Exchange AnkiWeb credentials for a session token. */
export async function login(
  serverUrl: string,
  username: string,
  password: string
): Promise<string> {
  if (!serverUrl) {
    throw new Error('Enter the Anki server URL first.');
  }

  let response: Response;
  try {
    response = await fetch(joinUrl(serverUrl, '/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
  } catch {
    throw new Error(`Could not reach the server at ${serverUrl}`);
  }

  if (!response.ok) {
    throw new Error(await errorFrom(response));
  }

  const body = await response.json();
  if (!body?.token) {
    throw new Error('Server did not return a token');
  }
  return body.token as string;
}

/** Fetch decks / note types / sync state for the logged-in account. */
export async function getStatus(serverUrl: string, token: string): Promise<AnkiServerStatus> {
  const response = await authedFetch(serverUrl, '/status', { token });
  return (await response.json()) as AnkiServerStatus;
}

/** The `POST /cards` body — mirrors the server's `CardRequest` model. */
export type CardRequest = {
  deck: string;
  model: string;
  fields: Record<string, string>;
  images: { field: string; filename: string; data: string }[];
  tags: string[];
};

/** Create a note in the logged-in account's collection. The server commits it
 *  locally and pushes to AnkiWeb on a debounce, so this returns as soon as the
 *  note is added. Throws `UnauthorizedError` on an expired token, or an Error
 *  carrying the server's message (e.g. unknown field / note type) otherwise. */
export async function createCard(
  serverUrl: string,
  token: string,
  body: CardRequest
): Promise<{ note_id: number; image_filenames: string[] }> {
  const response = await authedFetch(serverUrl, '/cards', { method: 'POST', token, json: body });
  return (await response.json()) as { note_id: number; image_filenames: string[] };
}

/** Force a sync with AnkiWeb. `direction` defaults to `auto`; `download`/`upload`
 *  are used to resolve a full-sync the server refused to pick a side for. */
export async function sync(
  serverUrl: string,
  token: string,
  direction: 'auto' | 'download' | 'upload' = 'auto'
): Promise<void> {
  await authedFetch(serverUrl, '/sync', { method: 'POST', token, json: { direction } });
}

/** Best-effort logout — invalidates the token server-side. */
export async function logout(serverUrl: string, token: string): Promise<void> {
  try {
    await fetch(joinUrl(serverUrl, '/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    // Ignore — the client clears its token regardless.
  }
}
