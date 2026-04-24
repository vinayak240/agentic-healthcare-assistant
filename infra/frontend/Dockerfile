FROM oven/bun:1-alpine AS builder

WORKDIR /app/frontend

ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY frontend/package.json frontend/bun.lock ./
RUN bun install

COPY frontend/index.html ./
COPY frontend/tsconfig.json ./
COPY frontend/vite.config.ts ./
COPY frontend/public ./public
COPY frontend/src ./src

RUN bun run build

FROM node:22-alpine AS runtime

WORKDIR /app/frontend

ENV NODE_ENV=production
ENV PORT=3000

RUN npm install --global serve@14.2.4

COPY --from=builder --chown=node:node /app/frontend/dist ./dist

USER node

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
