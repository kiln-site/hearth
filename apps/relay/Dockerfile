FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/relay/package.json ./apps/relay/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild
COPY . .
RUN pnpm --filter @workspace/contracts build && pnpm --filter relay build
RUN npm_config_ignore_scripts=true pnpm --filter relay deploy --prod --legacy /output

FROM node:24-alpine AS runtime

RUN apk add --no-cache docker-cli docker-cli-compose
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /output/ ./
COPY --from=builder /source/apps/relay/instrument.mjs ./instrument.mjs

EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.KILN_RELAY_PORT || '4100') + '/health', { signal: AbortSignal.timeout(2500) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--import", "./instrument.mjs", "dist/index.js"]
