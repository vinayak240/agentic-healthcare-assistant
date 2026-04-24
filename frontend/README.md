# Frontend

Standalone Vite + React + Bun frontend for MediBuddy.

## Run locally

1. From `frontend/`, install dependencies with `bun install`.
2. Start the backend separately from `backend/` with `bun run start`.
3. Start the frontend dev server from `frontend/` with `bun run dev`.

The frontend calls the backend through the Vite `/api` proxy, which targets `http://localhost:3000` by default. You can override this outside local proxy-based development with `VITE_API_BASE_URL`.
