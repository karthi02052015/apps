# TaskFlow — single production image: API + built web app (served by the API).

ARG NODE_VERSION=22-alpine

# ---- deps: install the full workspace once (cached by lockfile) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- build: compile API bundle and web assets ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- prod-deps: runtime dependencies for the API only ----
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @taskflow/api

# ---- runtime ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared ./packages/shared
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null || exit 1
# tini reaps zombies and forwards SIGTERM so graceful shutdown runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
