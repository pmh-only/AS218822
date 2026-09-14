FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY website/package.json ./website/package.json
RUN pnpm install --filter website --frozen-lockfile
COPY website ./website
RUN pnpm --filter website build

FROM nginx:alpine

COPY website/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/website/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
