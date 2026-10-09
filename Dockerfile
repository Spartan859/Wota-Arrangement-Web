# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:web

FROM node:24-alpine AS api-build

WORKDIR /app
ENV npm_config_update_notifier=false

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run typecheck && npm run build:api

FROM nginx:1.29-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1

FROM node:24-alpine AS api

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=api-build /app/server-dist ./server-dist
COPY --from=api-build /app/server/db/migrations ./server/db/migrations
RUN mkdir -p /data/audio && chown -R node:node /data
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=8s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8787/healthz >/dev/null || exit 1

CMD ["node", "server-dist/index.js"]
