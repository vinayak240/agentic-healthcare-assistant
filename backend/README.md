# MediBuddy Backend

The backend is a NestJS 11 application running on Bun. It exposes the API used by the MediBuddy frontend, streams chat responses, runs the agent/tool loop, persists healthcare chat data in MongoDB, and stores generated audio through an S3-compatible MinIO service.

## Responsibilities

- User onboarding and login by email.
- Conversation, message, run, tool event, and usage persistence.
- Server-sent event chat streaming through `/chat/stream`.
- Agent orchestration with model calls and tool execution.
- Patient-context lookup for allergies, conditions, and medical history.
- Safe symptom/drug guidance that avoids prescriptions, dosages, and emergency advice replacement.
- Appointment follow-up contact suggestions.
- Message audio generation metadata and S3/MinIO storage support.
- Health checks through `/system/health`.

## Main modules

- `src/api`: REST controllers, DTOs, and application services for users, conversations, runs, usage, health, and follow-up actions.
- `src/chat`: Chat request preparation, SSE event mapping, message persistence, and agent streaming integration.
- `src/agent`: Agent loop wrapper, conversation-history loading, model calls, tool streaming, and safety/scope handling.
- `src/tool`: Tool registry and healthcare tools such as patient context, drug info, and appointment booking.
- `src/dal`: Mongoose schemas and repositories for MongoDB collections.
- `src/clients`: OpenAI and MinIO/S3 client wrappers.
- `src/events`: Internal event emission and usage projection.
- `src/config`, `src/logger`, and `src/common`: environment access, structured logging, and shared error handling.

## Environment

The backend reads configuration from process environment variables. In Docker, `infra/backend/Dockerfile` copies `backend/.env.example` into the image as `.env`, and `docker-compose.yml` also provides runtime environment values.

Required:

```bash
MONGODB_URI=mongodb://app:healtcare@mongo:27017/healtcare-agent-db?authSource=healtcare-agent-db
OPENAI_KEY=your_openai_api_key_here
```

Important defaults:

```bash
PORT=8080
CORS_ORIGIN=*
OPENAI_MODEL=gpt-4.1-mini
AGENT_MAX_CAP=5
AGENT_HISTORY_CAP=10
LOG_LEVEL=info
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_BUCKET=chat-audio
```

`LOG_LEVEL` controls the minimum structured log level. Supported values are `debug`, `info`, `warn`, and `error`; missing or invalid values default to `info`.

Use `OPENAI_KEY`, not `OPENAPI_KEY`.

## Local development

If you want to run the backend process locally while keeping MongoDB and MinIO in Docker, start the services-only Compose file from the repo root:

```bash
docker compose -f docker-compose.local.yml up -d
```

From `backend/`:

```bash
bun install
MONGODB_URI="mongodb://app:healtcare@localhost:27017/healtcare-agent-db?authSource=healtcare-agent-db" \
S3_ENDPOINT="http://localhost:9000" \
S3_PUBLIC_ENDPOINT="http://localhost:9000" \
OPENAI_KEY="your_openai_api_key_here" \
bun run start
```

For local non-Docker development, make sure MongoDB and MinIO-compatible storage are reachable and that the environment values match those services. The local Compose defaults expose MongoDB at `localhost:27017`, MinIO API at `localhost:9000`, and the MinIO console at `http://localhost:9001` with `admin` / `admin123`.

Stop the local Docker services from the repo root:

```bash
docker compose -f docker-compose.local.yml down
```

Run backend tests:

```bash
bun test
```

## Docker behavior

The backend Docker image:

- Uses `oven/bun:1-alpine`.
- Installs production dependencies from `backend/package.json` and `backend/bun.lock`.
- Copies `backend/src`, `backend/tsconfig.json`, and `backend/.env.example`.
- Starts with `bun run start`.
- Exposes port `8080`.

In the full stack, Docker Compose waits for MinIO health before starting the backend, and the backend healthcheck calls:

```text
http://127.0.0.1:8080/system/health
```

## API overview

Common endpoint groups:

- `/system/health`: backend health.
- `/users`: create/list/read users and login by email.
- `/chat/stream`: stream chat runs as SSE.
- `/conversations`: list conversations, read messages, read tool events, delete conversations/messages.
- `/usage`: read usage totals.

The frontend wraps these calls in `frontend/src/lib/api/client.ts`.

## Data model notes

MongoDB stores users, conversations, messages, runs, events, and usage records. The local Docker database setup is already handled by `infra/db/db.setup.sh`, and Mongoose creates application collections as needed. No manual root migration step is required for the basic Docker Compose setup.
