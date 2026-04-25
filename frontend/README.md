# MediBuddy Frontend

The frontend is a React 19 + Vite + TypeScript app for the MediBuddy patient experience. It handles onboarding, login, chat, conversation history, streamed assistant responses, tool activity display, usage status, and browser voice input where supported.

## Responsibilities

- Route signed-out users to onboarding or login.
- Persist the active user in browser storage.
- Validate a stored user against the backend on startup.
- Render the chat workspace and previous conversations.
- Stream assistant responses from the backend SSE endpoint.
- Display tool activity and appointment follow-up contacts.
- Support Markdown/GFM rendering for assistant responses.
- Support browser speech recognition for voice input in compatible browsers.
- Request generated audio for messages and play audio when available.

## Main areas

- `src/app`: Top-level routing, bootstrap, health checks, and auth/onboarding guards.
- `src/features/onboarding`: Multi-step patient profile creation flow.
- `src/features/auth`: Existing-user login by email.
- `src/features/chat`: Chat workspace, message timeline, conversation list, voice input, usage status, and tool output UI.
- `src/lib/api`: Typed API client and shared response/request types.
- `src/lib/config.ts`: Frontend runtime configuration such as `VITE_API_BASE_URL`.
- `src/components`: Shared UI pieces such as cards, pills, list inputs, and the app logo.
- `src/styles.css`: Tailwind CSS entrypoint and global app styling.

## Configuration

The frontend reads:

```bash
VITE_API_BASE_URL
```

If unset, it defaults to `/api`:

```ts
API_BASE_URL = '/api'
```

In Docker Compose, the frontend image is built with:

```bash
VITE_API_BASE_URL=http://localhost:8080
```

That makes the browser call the backend directly at `http://localhost:8080`.

## Local development

If you are running the frontend and backend locally, start MongoDB and MinIO from the repo root first:

```bash
docker compose -f docker-compose.local.yml up -d
```

Start the backend from `backend/` with the local service endpoints shown in `backend/README.md`.

From `frontend/`:

```bash
bun install
VITE_API_BASE_URL="http://localhost:8080" bun run dev
```

Run a production build:

```bash
bun run build
```

Run TypeScript checks without emitting files:

```bash
bun run typecheck
```

The backend should be running separately for the UI to fully work. When the backend is local, set `VITE_API_BASE_URL` to `http://localhost:8080` before starting Vite.

## Docker behavior

The frontend Docker image:

- Uses Bun to install dependencies and build the Vite app.
- Uses `VITE_API_BASE_URL` as a build argument.
- Copies the built static files into a Node 22 Alpine runtime.
- Serves `dist` with `serve` on port `3000`.

When using the root Docker Compose flow, open:

```text
http://localhost:3000
```

## First-time user flow

1. The app checks backend health.
2. If no valid user is stored, it routes to `/onboarding`.
3. The user enters name, email, allergies, medical conditions, and medical history.
4. The frontend creates the user through the backend API.
5. The created user is stored in browser storage.
6. The user is routed to `/` for chat.

Existing users can use `/login` with their email address.

## API usage

The frontend API client is in `src/lib/api/client.ts`. It wraps:

- Health checks.
- User create/read/login.
- Conversation list and message fetches.
- Conversation tool events.
- Chat streaming.
- Appointment follow-up creation.
- Message audio creation.
- Message and conversation deletes.
- Usage reads.

Chat uses `fetch()` with a readable stream and parses SSE-style `data:` chunks from `/chat/stream`.

## Notes and tradeoffs

- The app keeps the active user in browser storage for a simple demo login flow.
- The UI depends on backend health but can still show stored-user context if the backend becomes temporarily unavailable.
- Browser speech recognition support depends on the user's browser. Chrome and Edge are the best targets.
- `VITE_API_BASE_URL` is a build-time Vite value, so rebuild the frontend image if you change it for Docker.
