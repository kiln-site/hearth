FROM node:24-alpine AS builder

ARG SOURCE_COMMIT
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.1

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=$VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
ENV VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE
RUN corepack enable
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/relay/package.json ./apps/relay/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild
COPY . .
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN \
  pnpm --filter @workspace/contracts build && pnpm --filter web build

WORKDIR /runtime
COPY apps/web/package.runtime.json ./package.json
RUN pnpm install --prod --no-lockfile

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /runtime/node_modules ./node_modules
COPY --from=builder --chown=node:node /source/apps/web/dist ./dist
COPY --from=builder --chown=node:node /source/apps/web/migrations ./migrations
COPY --from=builder --chown=node:node /source/apps/web/scripts ./scripts
COPY --from=builder --chown=node:node /source/apps/web/keyring.mjs ./keyring.mjs
COPY --from=builder --chown=node:node /source/apps/web/instrument.server.mjs ./instrument.server.mjs
COPY --from=builder --chown=node:node /source/apps/web/package.runtime.json ./package.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', { signal: AbortSignal.timeout(2500) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "scripts/start-container.mjs"]
