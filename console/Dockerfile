FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine

WORKDIR /app
COPY --chown=node:node server.mjs ./
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.mjs"]
