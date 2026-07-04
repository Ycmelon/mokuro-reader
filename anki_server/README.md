# Anki Card Server

A small standalone service that lets the mobile manga reader create Anki cards
(text + cropped page images) and sync them to **AnkiWeb**, using the official
[`anki`](https://pypi.org/project/anki/) Python package. This replaces
AnkiConnect, which requires a running Anki desktop and is unusable on mobile.

## How it works

- **AnkiWeb login is the auth gate.** `POST /login` exchanges AnkiWeb
  credentials for an opaque bearer token; every other route requires it. Only
  the sync token (`hkey`) + endpoint are stored — never the password. Each
  account gets its own collection under `data/collections/<user_id>/`, so the
  service is naturally multi-account.
- **Sync is debounced around writes.** A capture burst pulls once (if the last
  pull is stale), adds notes locally and returns immediately, then pushes
  (collection + media) a few seconds after the last card — so rapid captures
  coalesce into one upload.
- **One thread per collection.** Anki requires a collection be used from a
  single thread and process, so all work per account runs on a dedicated
  single-thread executor. **Run only ONE worker.**

## Run

```bash
cd anki_server
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn anki_server.app:app --host 127.0.0.1 --port 8000
# (run from the repo root so the `anki_server` package resolves)
```

In production, put it behind TLS (passwords transit `/login`) and set
`ANKI_SERVER_CORS_ORIGINS` to the website origin.

## Configuration (environment variables)

| Variable                                          | Default              | Purpose                                                 |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| `ANKI_SERVER_DATA_DIR`                            | `./data`             | Sessions + per-user collections                         |
| `ANKI_SERVER_CORS_ORIGINS`                        | `*`                  | Comma-separated allowed origins (lock down in prod)     |
| `ANKI_SERVER_PULL_STALE_SECS`                     | `60`                 | Re-pull before a card only if last pull older than this |
| `ANKI_SERVER_PUSH_DEBOUNCE_SECS`                  | `5`                  | Delay after the last card before pushing                |
| `ANKI_SERVER_COLLECTION_IDLE_SECS`                | `900`                | Close idle collections after this                       |
| `ANKI_SERVER_SESSION_IDLE_SECS`                   | `2592000`            | Token inactivity expiry                                 |
| `ANKI_SERVER_LOGIN_MAX_ATTEMPTS` / `_WINDOW_SECS` | `10` / `300`         | Per-IP `/login` rate limit                              |
| `ANKI_SERVER_HOST` / `_PORT`                      | `127.0.0.1` / `8000` | Bind address                                            |

## API

All non-login routes require `Authorization: Bearer <token>`.

- `POST /login` — `{ username, password, endpoint? }` → `{ token }`
- `GET /status` — `{ username, decks[], models[{name,fields[]}], last_pull_at, pending_push, full_sync_needed, last_error }`
- `POST /cards` — create a note (see below) → `{ note_id, image_filenames[] }`
- `POST /sync` — `{ direction: "auto"|"download"|"upload" }` force a sync / resolve a full-sync
- `POST /logout` — flush, close, invalidate token
- `GET /health` — liveness

### `POST /cards` body

```jsonc
{
  "deck": "Series::Volume", // created if missing
  "model": "Basic", // must exist in the user's collection
  "fields": { "Front": "…", "Back": "…" },
  "images": [
    // optional; appended as <img> to the field
    { "field": "Back", "filename": "mokuro_x_p042.jpg", "data": "<base64 jpeg>" }
  ],
  "tags": ["mining", "series"]
}
```

The shape mirrors the existing `src/lib/anki-connect` pipeline (`createCard`
payload + `cropper.ts` base64 JPEG output), so the future browser-side feature
can reuse that image/selection code almost unchanged.

## Full-sync safety

This service only ever _adds_ notes, so the sole local-only data in a collection
is cards that haven't reached AnkiWeb yet. Each added card is therefore mirrored
into a durable per-account **outbox** (`data/collections/<user_id>/outbox.json`,
atomic writes) the moment it's added, and cleared once a push confirms it landed
on AnkiWeb.

That makes any full sync **lossless and automatic** — no user prompt, no
`ambiguous` dead-end:

- **AnkiWeb wants an upload** → upload (local is authoritative; nothing lost).
- **AnkiWeb wants a download, or can't decide (`FULL_SYNC`)** → take AnkiWeb's
  copy, **replay the outbox** onto it, then push. Our mined cards survive because
  they're rebuilt from the queue after the download.

Resolution happens wherever a full sync surfaces: the debounced push, an explicit
`POST /sync` (`auto` self-resolves; `download`/`upload` force a side), a flushing
close, and login (a full download at login also replays any queue left on disk by
a previous session). A queued card whose note type/field no longer exists on the
server copy is dropped (logged) rather than wedging future syncs.

`full_sync_needed` in `/status` therefore stays `null` in normal operation; a
non-null value or a `last_error` mentioning "full sync still required" indicates a
resolution that itself failed (e.g. a network drop) and will be retried.
