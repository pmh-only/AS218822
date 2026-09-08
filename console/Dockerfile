FROM prom/prometheus:v3.5.0 AS prometheus

FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY server.mjs auth.mjs monitoring.mjs *.test.mjs ./
COPY --from=prometheus /bin/promtool /usr/local/bin/promtool
RUN pnpm build && PROMTOOL=/usr/local/bin/promtool pnpm test && pnpm prune --prod

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node server.mjs auth.mjs monitoring.mjs ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.mjs"]
