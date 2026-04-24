FROM oven/bun:1-alpine AS runtime

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=8080

COPY --chown=bun:bun backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun backend/tsconfig.json ./
COPY --chown=bun:bun backend/src ./src
COPY --chown=bun:bun backend/.env.example ./.env

USER bun

EXPOSE 8080

CMD ["bun", "run", "start"]
