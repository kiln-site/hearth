# syntax=docker/dockerfile:1.10

ARG VITE_PLUS_VERSION=0.2.5

FROM ghcr.io/voidzero-dev/vite-plus:${VITE_PLUS_VERSION} AS build

WORKDIR /source

COPY --chown=vp:vp package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version ./
COPY --chown=vp:vp apps/relay/package.json ./apps/relay/package.json
COPY --chown=vp:vp packages/contracts/package.json ./packages/contracts/package.json
COPY --chown=vp:vp patches ./patches
RUN --mount=type=cache,target=/home/vp/.local/share/pnpm/store,uid=1000,gid=1000,sharing=locked \
  vp install --frozen-lockfile --ignore-scripts --filter relay...

COPY --chown=vp:vp tsconfig.json vite.config.ts ./
COPY --chown=vp:vp apps/relay ./apps/relay
COPY --chown=vp:vp packages/contracts ./packages/contracts
RUN vp run relay#build

FROM docker:29.6.2-cli AS docker-cli

FROM gcr.io/distroless/nodejs24-debian12 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=build /source/apps/relay/dist ./dist

EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.KILN_RELAY_PORT || '4100') + '/health', { signal: AbortSignal.timeout(2500) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["--import", "./dist/instrument.mjs", "dist/src/index.mjs"]
