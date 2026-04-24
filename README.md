# MediBuddy

MediBuddy is an agentic healthcare assistant that helps a patient create a health profile, chat with a care assistant, get safe non-prescriptive symptom support, review doctor follow-up options, and keep the conversation history available across sessions.

Screen recording: [MediBuddy - End to End Journey](https://www.loom.com/share/866e5be4455941f8bbcf826c09672d1d)

## What MediBuddy does

- Onboards a patient from the UI with name, email, allergies, medical conditions, and medical history.
- Uses the saved patient profile as context during chat so responses can account for allergies and conditions.
- Streams assistant responses from the backend to the browser.
- Runs healthcare-oriented tools for patient context, safer symptom/drug guidance, and appointment follow-up contacts.
- Keeps conversations, messages, tool events, runs, usage data, and users in MongoDB.
- Supports voice input in compatible browsers and can generate/store message audio through MinIO-compatible object storage.
- Shows backend health, usage status, previous conversations, tool activity, and appointment follow-up information in the UI.

This app is for demo and support workflows. It is not a replacement for a clinician, diagnosis, prescription, or emergency care.

## Tech stack

**Frontend**

- React 19 with TypeScript for the app UI.
- Vite for fast local builds and production bundling.
- Tailwind CSS for styling.
- React Router for onboarding, login, and chat routing.
- React Markdown and remark-gfm for assistant message rendering.

**Backend**

- NestJS 11 running on Bun for the API and application modules.
- MongoDB with Mongoose for users, conversations, messages, runs, events, and usage records.
- OpenAI SDK for chat/model calls.
- AWS S3 SDK against MinIO for local S3-compatible audio storage.
- Class Validator / Class Transformer for request validation.

**Infrastructure**

- Docker Compose starts MongoDB, MinIO, backend, and frontend together.
- MongoDB initialization scripts create the local app database user and base setup automatically.
- The frontend is served from a production Vite build on port `3000`.
- The backend runs on port `8080`.

## Library choices and tradeoffs

- **NestJS** gives the backend clear module boundaries for API, chat, agent, tools, events, storage, and data access. The tradeoff is a little more structure than a small Express app, but it keeps the project easier to extend.
- **Bun** keeps backend install/startup fast and works well for this TypeScript-first demo. The tradeoff is that some teams may be more familiar with Node-only runtime conventions.
- **MongoDB + Mongoose** fit the conversation/user/event document model well and reduce relational schema overhead. The tradeoff is that data relationships are enforced mostly in application code.
- **MinIO + S3 SDK** makes local object storage behave like a deployable S3-compatible setup. The tradeoff is one more local service, but Docker Compose hides most of that complexity.
- **OpenAI SDK** keeps model calls direct and explicit. The tradeoff is that the app requires a valid `OPENAI_KEY` before meaningful chat/model features will work.
- **React + Vite + Tailwind** gives a fast, polished UI path without a heavier frontend framework. The tradeoff is that routing and data fetching are intentionally app-managed rather than framework-managed.

## Docker Compose setup

Run all commands from the repo root.

### 1. Add your OpenAI API key

You must set `OPENAI_KEY` before starting the app.

Use `OPENAI_KEY`, not `OPENAPI_KEY`.

The backend Dockerfile already copies `backend/.env.example` into the backend image as `.env`, so you do not need to copy `backend/.env.example` into a root `.env` file. You still need to provide a real OpenAI key because the example value is intentionally blank.

Recommended options:

**Option 1: edit `backend/.env.example` before building**

Set:

```bash
OPENAI_KEY=your_openai_api_key_here
```

Then build the Docker images. The backend image copies that file into the container as `.env`.

**Option 2: set the key in `docker-compose.yml`**

In the `backend` service, replace the blank/default key line with your value:

```yaml
OPENAI_KEY: your_openai_api_key_here
```

Compose environment values can override the container `.env`, so use this option when you want the key controlled directly by Docker Compose.

### 2. Start the full stack

```bash
docker compose up -d
```

Docker Compose will build and start:

- `mongo`: local MongoDB with app database/user initialization.
- `minio`: local S3-compatible storage.
- `backend`: NestJS/Bun API.
- `frontend`: production frontend served on port `3000`.

Wait until the frontend and backend containers are healthy. The first build can take a few minutes.

### 3. Open the app

Open:

```text
http://localhost:3000
```

The app should route you to onboarding if no user is stored in your browser yet.

## First-time UI flow

1. Open `http://localhost:3000`.
2. Complete onboarding from the UI.
3. Add your name, email, allergies, medical conditions, and medical history.
4. Submit the profile.
5. MediBuddy creates your patient profile and opens the chat workspace.
6. Start chatting with the assistant.

No manual root database migration is required for the basic local setup. The MongoDB setup script and application collection setup are already wired into the Docker flow.

## Useful URLs

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8080/system/health`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- MongoDB: `localhost:27017`

Default local MinIO credentials:

```text
Username: admin
Password: admin123
```

## Stopping and resetting

Stop containers:

```bash
docker compose down
```

Stop containers and remove local MongoDB/MinIO volumes:

```bash
docker compose down -v
```

Use the volume reset only when you want to delete local users, conversations, messages, uploaded audio, and stored app data.

## Troubleshooting

**Backend starts, but chat/model calls fail**

Confirm `OPENAI_KEY` is set. The required variable is `OPENAI_KEY`, not `OPENAPI_KEY`.

**Frontend cannot reach backend**

Check backend health:

```text
http://localhost:8080/system/health
```

If the health endpoint is not available, check container logs:

```bash
docker compose logs backend
```

**MongoDB authentication or database issues**

For the normal local Docker flow, no manual migration is needed. The MongoDB container runs `infra/db/db.setup.sh` during initialization and the backend creates application collections through Mongoose.

If you previously started the stack with bad database settings and want a clean local reset:

```bash
docker compose down -v
docker compose up --build
```

**MinIO or audio storage issues**

Open the MinIO console at `http://localhost:9001` and log in with `admin` / `admin123`. The local bucket defaults to `chat-audio`.

**Port already in use**

The default ports are:

- Frontend: `3000`
- Backend: `8080`
- MongoDB: `27017`
- MinIO API: `9000`
- MinIO console: `9001`

If one is already used on your machine, update the matching port variable in `docker-compose.yml` before running Compose.
