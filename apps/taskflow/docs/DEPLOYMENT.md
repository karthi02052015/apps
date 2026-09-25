# Deploying TaskFlow

TaskFlow ships as **one container image** (API + built web app) plus **PostgreSQL 16**. Anything that runs containers works: a single VM with Docker Compose, Kubernetes, ECS/Fargate, Fly.io, Render, Railway, Cloud Run (with a min-instance for the scheduler), etc.

## 1. Build

```bash
docker build -t registry.example.com/taskflow:$(git rev-parse --short HEAD) .
```

The multi-stage build compiles everything, then produces a slim runtime (Node 22 Alpine, production deps only, non-root `node` user, `tini` as PID 1, built-in `HEALTHCHECK`).

Without Docker: `npm ci && npm run build`, then run `node apps/api/dist/server.js` from `apps/api` with `WEB_DIST_DIR=../web/dist`.

## 2. Configure

All configuration is environment variables, validated at boot (the process refuses to start with invalid or missing production settings). See `.env.example` for the complete list.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV=production` | ✅ | Enables secure cookies, HSTS and production checks |
| `DATABASE_URL` | ✅ | `postgres://user:pass@host:5432/taskflow` |
| `JWT_SECRET` | ✅ | ≥ 32 chars; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGINS` | ✅ | Your public origin(s), comma-separated |
| `TRUST_PROXY` | behind a proxy | Number of proxy hops (e.g. `1` behind one load balancer) so client IPs and rate limits are correct |
| `DATABASE_SSL=true` | managed DBs | Verifies the server certificate |
| `AUTO_MIGRATE=false` | multi-replica | Run migrations as a release step instead (below) |
| `METRICS_TOKEN` | recommended | Protects `/metrics` |
| `WEB_DIST_DIR` | set in image | Serve the SPA from the API |

**Secrets management:** inject `JWT_SECRET` and `DATABASE_URL` from your platform's secret store (AWS Secrets Manager / SSM, GCP Secret Manager, Kubernetes Secrets, Doppler, Vault). Never bake them into images or commit `.env` files (they are git- and docker-ignored).

**Rotating `JWT_SECRET`** invalidates access tokens (≤ 15 min of impact); users are silently re-authenticated via their refresh cookie, which is independent of the secret.

## 3. Migrate

Migrations are plain SQL in `apps/api/drizzle/`, applied in order and recorded in `drizzle.__drizzle_migrations`.

```bash
# as a release/pre-deploy job with the same image
docker run --rm -e NODE_ENV=production -e DATABASE_URL=… -e JWT_SECRET=… taskflow node dist/db/migrate.js
```

Single-instance deploys can leave `AUTO_MIGRATE=true` (default). Author migrations to be backward-compatible (expand → deploy → contract) so old and new replicas can run side by side during rollouts.

## 4. Run behind TLS

Terminate TLS at your load balancer / ingress / reverse proxy and forward to port `4000`. Requirements:

- Serve the app and API on the **same origin** (the image does this) — the refresh cookie is `SameSite=Strict` and scoped to `/api/v1/auth`.
- Disable response buffering for `/api/v1/events` (SSE). The API sends `X-Accel-Buffering: no` for nginx; for others set an idle timeout ≥ 60 s.
- Set `TRUST_PROXY` to the number of proxies.

Minimal nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name tasks.example.com;
  # ssl_certificate …; ssl_certificate_key …;
  location / {
    proxy_pass http://taskflow:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
    proxy_buffering off;   # SSE
  }
}
```

## 5. Scale

- **API replicas are stateless.** Scale horizontally behind any load balancer; no sticky sessions needed.
- **Realtime** fans out through PostgreSQL `LISTEN/NOTIFY`, so an event produced on one replica reaches clients connected to any replica. Each replica holds one extra DB connection for `LISTEN`.
- **Scheduler** runs in every replica; work is claimed with `FOR UPDATE SKIP LOCKED`, so notifications are never duplicated. Set `SCHEDULER_ENABLED=false` on some replicas if you prefer a dedicated worker.
- **Rate limiting** is per-replica in memory. With many replicas, add a shared store (e.g. Redis via `rate-limit-redis`) in `apps/api/src/middleware/rateLimit.ts`, or enforce limits at the edge/WAF.
- **Database:** size the pool with `DATABASE_POOL_MAX` (default 10/replica) and keep `replicas × pool + replicas` below the server's `max_connections`, or put PgBouncer (transaction mode) in front. Queries use indexes designed for each view; the scheduler uses partial indexes so its cost doesn't grow with history. A 15 s `statement_timeout` protects the pool from runaway queries.

## 6. Observe

- **Logs:** structured JSON (pino) to stdout with `requestId`, method, URL, status and latency. Credentials, cookies and tokens are redacted. Ship stdout to your log platform.
- **Metrics:** `GET /metrics` (Prometheus) — `taskflow_http_request_duration_seconds{method,route,status}`, `taskflow_sse_connections`, `taskflow_auth_events_total{event}`, `taskflow_notifications_sent_total{type}`, `taskflow_scheduler_runs_total{outcome}`, plus Node/process metrics.
- **Health:** liveness `GET /healthz`, readiness `GET /readyz` (checks the DB).

Suggested alerts:

| Alert | Condition |
|---|---|
| High error rate | 5xx > 1% of requests for 5 min |
| Latency | p95 of `taskflow_http_request_duration_seconds` > 500 ms for 10 min |
| Scheduler failing | `increase(taskflow_scheduler_runs_total{outcome="error"}[10m]) > 0` |
| Token theft signals | `increase(taskflow_auth_events_total{event="refresh_reuse"}[1h]) > 5` |
| Brute force | `rate(taskflow_auth_events_total{event="login_failed"}[5m])` unusually high |
| Readiness | `/readyz` non-200 |

For error tracking, wire Sentry (or similar) into `errorHandler` (API) and `ErrorBoundary` (web) — both have a single, marked hook point.

## 7. Back up & restore

- Enable automated backups + point-in-time recovery on managed Postgres, or run `pg_dump` nightly: `pg_dump -Fc "$DATABASE_URL" > taskflow-$(date +%F).dump`.
- Restore: `pg_restore --clean --no-owner -d "$DATABASE_URL" taskflow-YYYY-MM-DD.dump`.
- Test restores quarterly. The `audit_logs` table can be exported to cold storage and pruned by age if it grows large.

## 8. Operations runbook

| Situation | Action |
|---|---|
| Suspected account compromise | Ask the user to use **Settings → Sign out of all devices** and change password, or run `UPDATE sessions SET revoked_at = now() WHERE user_id = '…' AND revoked_at IS NULL;` |
| Promote an admin | `UPDATE users SET role = 'admin' WHERE lower(email) = lower('…');` |
| Unlock an account early | `UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE lower(email) = lower('…');` |
| Graceful restart | Send `SIGTERM`: the server stops accepting connections, finishes in-flight requests (≤ 5 s), closes SSE streams (clients reconnect), stops the scheduler and closes the pool. Hard stop after 15 s. |
| Roll back | Re-deploy the previous image. Migrations are forward-only; write a new migration to revert schema changes. |

## 9. Local production-like stack

```bash
cp .env.example .env   # set JWT_SECRET and POSTGRES_PASSWORD
docker compose up --build
# http://localhost:8080
```

`docker-compose.yml` sets `COOKIE_SECURE=false` **only** because it serves plain HTTP on localhost. Remove that override for any deployment behind TLS.
