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
RUN pnpm --filter @workspace/contracts build && pnpm --filter relay build
RUN pnpm --filter relay deploy --prod --legacy /output

FROM node:24-alpine AS runtime

RUN apk add --no-cache docker-cli docker-cli-compose
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /output/ ./

EXPOSE 4100
CMD ["node", "dist/index.js"]
