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
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @workspace/contracts build && pnpm --filter web build

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
COPY --from=builder --chown=node:node /source/apps/web/package.runtime.json ./package.json
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "scripts/start-container.mjs"]
