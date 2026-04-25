# MediBuddy Infra

The `infra/` directory contains the Docker build files and database initialization script used by the root `docker-compose.yml` stack.

## Directory layout

- `backend/Dockerfile`: builds the Bun/NestJS backend image.
- `frontend/Dockerfile`: builds the Vite frontend and serves the static build with `serve`.
- `db/Dockerfile`: extends the MongoDB image with the local initialization script.
- `db/db.setup.sh`: creates the app database user and an initial collection during MongoDB first-run initialization.

## Docker Compose services

The root `docker-compose.yml` starts four services:

- `mongo`: MongoDB with local app database setup.
- `minio`: S3-compatible object storage for generated/stored chat audio.
- `backend`: MediBuddy API and agent runtime.
- `frontend`: Production frontend served on port `3000`.

The services share the `agentic_healthcare_network` bridge network and use named volumes for durable local data:

- `mongo_data`
- `minio_data`

## Startup order

Compose healthchecks define the normal boot sequence:

1. `mongo` starts and runs the DB setup script on first initialization.
2. `minio` starts after MongoDB is healthy.
3. `backend` starts after MinIO is healthy.
4. `frontend` starts after the backend is healthy.

This means a normal local run does not require a manual database migration step.

## Required runtime key

The backend needs a real OpenAI API key:

```bash
OPENAI_KEY=your_openai_api_key_here
```

Use `OPENAI_KEY`, not `OPENAPI_KEY`.

You can provide it by editing `backend/.env.example` before building, or by setting it in the `backend.environment` section of `docker-compose.yml`. Compose-provided environment values can override values copied into the backend image.

The backend also accepts `LOG_LEVEL` in the same places. Supported values are `debug`, `info`, `warn`, and `error`; it defaults to `info`.

## Build files

### Backend image

`infra/backend/Dockerfile`:

- Uses `oven/bun:1-alpine`.
- Installs backend production dependencies.
- Copies backend TypeScript source.
- Copies `backend/.env.example` into the image as `.env`.
- Runs `bun run start`.

### Frontend image

`infra/frontend/Dockerfile`:

- Uses Bun for dependency installation and Vite build.
- Accepts `VITE_API_BASE_URL`, defaulting to `http://localhost:8080`.
- Copies the built `dist` folder into a Node 22 Alpine runtime image.
- Serves the static site with `serve` on port `3000`.

### Database image

`infra/db/Dockerfile` copies `infra/db/db.setup.sh` into MongoDB's initialization directory. Mongo runs that script only when the database volume is first created.

`db.setup.sh` creates:

- The configured application database.
- The configured application user.
- `readWrite` and `dbAdmin` roles for the app database.
- An `init` collection to complete first-run setup.

## Useful commands

Run the full stack from repo root:

```bash
docker compose up --build
```

Stop containers:

```bash
docker compose down
```

Reset local persistent data:

```bash
docker compose down -v
```

View logs:

```bash
docker compose logs backend
docker compose logs frontend
docker compose logs mongo
docker compose logs minio
```

## Ports

- Frontend: `3000`
- Backend: `8080`
- MongoDB: `27017`
- MinIO API: `9000`
- MinIO console: `9001`

If a port is already in use, update the matching value in `docker-compose.yml` before starting the stack.
