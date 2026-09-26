# TaskFlow architecture

This document explains how TaskFlow is put together and — more importantly — *why*. It is written for the engineers who will maintain and extend it.

## 1. System overview

```
 Browser (React SPA)                                   PostgreSQL 16
 ┌──────────────────────────┐   HTTPS /api/v1/*   ┌───────────────────────────┐
 │ TanStack Query cache     │ ──────────────────▶ │ Express API (stateless)   │
 │ Optimistic mutations     │ ◀────────────────── │  auth · tasks · projects  │──── SQL ───▶ tables, indexes,
 │ SSE client (fetch)       │ ◀── text/event-stream│  tags · notifications     │              GIN full-text index
 │ In-memory access token   │                      │  audit · health · metrics │◀── LISTEN/NOTIFY ── realtime fan-out
 └──────────────────────────┘                      │  Scheduler (reminders)    │
        ▲  httpOnly refresh cookie (SameSite=Strict, Path=/api/v1/auth)      └───────────────────────────┘
```

- **One deployable.** In production the API also serves the built SPA (`WEB_DIST_DIR`), so there is a single origin: no CORS in the hot path, `SameSite=Strict` cookies just work, and one image to ship. The SPA can equally be hosted on a CDN in front of the same origin.
- **Stateless API replicas.** All state lives in PostgreSQL. Realtime fan-out uses Postgres `LISTEN/NOTIFY`; the scheduler claims work with `FOR UPDATE SKIP LOCKED`. Replicas can be added without Redis or sticky sessions.
- **Shared contracts.** `packages/shared` holds Zod schemas, DTO types and pure domain logic (quick-add parser, recurrence, time zones). The API validates with the same schemas the web app uses for instant client-side feedback — validation is defined once.

## 2. Monorepo layout

| Package | Responsibility | Key rule |
|---|---|---|
| `packages/shared` | Contracts + pure logic | No I/O, no framework imports. 100% unit-testable. |
| `apps/api` | HTTP API, persistence, scheduling, realtime | Routes are thin: parse → service → respond. Services own business rules. |
| `apps/web` | SPA | Server state only via TanStack Query hooks in `features/*/hooks.ts`; UI state stays local. |

## 3. Backend

### Request pipeline

`pino-http (request id, structured log)` → `helmet (CSP, HSTS…)` → `cors (allow-list)` → `compression (skips SSE)` → `json (100 kb limit)` → `cookie-parser` → `metrics` → `/healthz · /readyz · /metrics` → `/api/v1` [`rate limit` → `X-Timezone` → `auth routes` → `requireAuth` → module routers] → `404` → **error boundary**.

The error boundary is the only place responses for failures are produced. It maps `AppError`, Zod errors, body-parser errors and PostgreSQL error codes (`23505` → 409, `23503` → 422, …) to a stable shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Title is required", "details": [{ "path": "title", "message": "Title is required" }], "requestId": "…" } }
```

Unknown errors become a generic 500 with the request id; stack traces and SQL never reach clients.

### Modules

| Module | Highlights |
|---|---|
| `auth` | scrypt password hashing (per-hash parameters, transparent rehash), account lockout, JWT access tokens, rotating refresh tokens with family-based reuse detection, sessions list/revoke, password change revokes other sessions. |
| `tasks` | Views, filters, full-text search, keyset pagination, optimistic concurrency (`version`), soft delete / trash / purge, bulk actions, subtasks, recurrence spawning, stats & streaks. |
| `projects` / `tags` | Per-user unique names (case-insensitive), open-task counts via correlated subqueries, deleting a project moves its tasks to the Inbox. |
| `notifications` | Inbox of notifications + background **Scheduler** (reminders, overdue alerts, hourly housekeeping). |
| `audit` | Append-only security/activity log; failures never break requests. |
| `realtime` | `GET /api/v1/events` SSE stream, capped per user, closed at access-token expiry. |

### Dependency injection

`createContext(env, logger)` builds an explicit `AppContext` (`env, db, logger, bus, audit`) passed into routers and services. There are no module-level singletons for infrastructure, which is what lets every integration-test file boot an isolated app + database in ~200 ms.

### Scheduler

Runs every `SCHEDULER_INTERVAL_MS` (default 30 s) in each API process:

1. **Reminders** — `UPDATE tasks SET reminder_sent_at = now() WHERE id IN (SELECT … WHERE remind_at <= now() AND reminder_sent_at IS NULL … FOR UPDATE SKIP LOCKED LIMIT 200) RETURNING …` then insert notifications and publish. The claim is atomic, so running many replicas never double-notifies.
2. **Overdue alerts** — same pattern; timed tasks become overdue at their moment, all-day tasks at the end of their local day. Looks back at most 7 days so a dormant account isn't flooded.
3. **Housekeeping** (hourly) — purge trash older than 30 days, delete sessions expired for more than 7 days.

Changing `remindAt` / `dueAt` re-arms the corresponding notification.

## 4. Data model

```
users 1─* sessions            (refresh tokens: sha256 hash only, family_id, replaced_by_id)
users 1─* projects 1─* tasks  (project_id ON DELETE SET NULL → Inbox)
users 1─* tags  *─* tasks     (task_tags)
tasks 1─* subtasks
users 1─* notifications       (task_id ON DELETE SET NULL)
users 1─* audit_logs          (user_id ON DELETE SET NULL — trail survives)
```

Design decisions:

- **UUID primary keys** (`gen_random_uuid()`): non-enumerable, safe to expose, mergeable.
- **Postgres enums** for `task_status`, `recurrence_rule`, `user_role`, `notification_type`; **`smallint` priority 0–4** so "sort by priority" is a plain index-friendly `ORDER BY`.
- **Constraints enforce invariants**: `CHECK (priority BETWEEN 0 AND 4)`, `CHECK ((status = 'done') = (completed_at IS NOT NULL))`, case-insensitive unique indexes on `lower(email)` and `(user_id, lower(name))`.
- **`timestamptz` everywhere.** All-day tasks store *local midnight* as an instant plus `all_day = true`, which keeps "overdue" and day grouping correct in every zone.
- **Generated `search_vector`** (`tsvector`, title weighted A, description B) with a **GIN index**. Search combines `websearch_to_tsquery` (fast, stemming-free "simple" config for multilingual text) with an escaped `ILIKE` on the title so partial words still match.
- **Indexes follow the queries**: `(user_id, deleted_at, status, due_at)` for views, `(user_id, project_id, position)` for project lists, `(user_id, completed_at)` for completed view/streaks, and **partial indexes** for the scheduler (`remind_at WHERE reminder_sent_at IS NULL AND deleted_at IS NULL AND status <> 'done'`) so its scans stay tiny regardless of table size.
- **Soft delete** with `deleted_at`, restored or purged explicitly (or after 30 days).
- **Manual ordering** uses a `double precision position`; reordering writes the midpoint between neighbours — one row update per drag.

### Migrations

Schema lives in `apps/api/src/db/schema.ts`. `npm run db:generate` produces SQL in `apps/api/drizzle/` (reviewed and committed). CI fails if the schema changes without a migration. The same migrations run on PostgreSQL and on PGlite.

### Why PGlite for development?

PGlite is PostgreSQL compiled to WebAssembly. Developers and CI get the *real* Postgres dialect (enums, `tsvector`, partial indexes, `FOR UPDATE SKIP LOCKED`) with zero installation — `npm run setup` just works on Windows, macOS and Linux. CI additionally runs the full API suite against a real PostgreSQL 16 server to guarantee parity.

## 5. Key flows

### Authentication

1. `POST /auth/login` → verify scrypt hash (dummy hash for unknown emails to equalise timing) → issue **access token** (JWT HS256, 15 min, pinned algorithm, `iss`/`aud` checked) in the body and **refresh token** (256-bit random) as an `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. Only the SHA-256 of the refresh token is stored.
2. The SPA keeps the access token **in memory only** and refreshes it a minute before expiry.
3. `POST /auth/refresh` (requires `X-Requested-With: taskflow` as a CSRF guard) rotates the token: old session revoked with `replaced_by_id`, new session in the same `family_id`.
4. **Reuse detection:** presenting an already-rotated token (outside a 15 s grace window for concurrent tabs) revokes the entire family and writes `auth.refresh_reuse_detected` to the audit log.
5. Cross-tab refreshes are serialised with the Web Locks API so tabs never race.

### Task completion with recurrence

`PATCH /tasks/:id {status:"done"}` runs in one transaction with `SELECT … FOR UPDATE`: sets `completed_at`, bumps `version`, and — if the task recurs — computes the next occurrence in the caller's time zone (DST-safe, anchored to the original day of month, always in the future), clones tags and fresh subtasks, and moves the rule to the new instance. The response includes `nextOccurrence` so the UI can confirm it.

### Realtime

Every mutation publishes `tasks.changed` / `projects.changed`; the scheduler publishes `notification`. The SPA reads the SSE stream with `fetch()` (so the token travels in a header, not a URL), debounces bursts, and invalidates the relevant queries. Reconnects use exponential backoff with jitter; the server closes the stream when the access token expires.

### Time zones

The browser sends `X-Timezone` (validated IANA name) with every request; the profile time zone is the fallback for API clients. "Today", "Overdue", streaks and recurrence all use the same dependency-free helpers in `packages/shared/src/time.ts`, which are unit-tested across DST gaps and half-hour offsets.

## 6. Frontend

- **Server state:** TanStack Query with a central key factory (`lib/keys.ts`). Mutations are optimistic (patch every cached list + the detail entry, roll back on error, reconcile on settle). Mutations use `networkMode: 'offlineFirst'` so actions taken offline replay on reconnect.
- **API client** (`lib/api.ts`): timeouts, abort propagation, single-flight token refresh + one retry on 401, and normalisation of every failure into an `ApiError` with a human message.
- **Routing:** `/today`, `/inbox`, `/upcoming`, `/overdue`, `/completed`, `/trash`, `/all`, `/projects/:id`, `/tags/:tag`, `/settings`. The open task is in the URL (`?task=<id>`) so details are deep-linkable and the back button closes them. Auth pages and Settings are code-split.
- **Design system:** semantic CSS tokens (`--surface`, `--accent`, …) mapped into Tailwind, redefined for dark mode; Radix primitives for accessible dialogs/menus/popovers; `prefers-reduced-motion` respected globally.
- **Performance:** memoised rows, stable callbacks, vendor chunk splitting, virtual-free lists sized by keyset pages of 100, debounced search, realtime invalidation debounced to one refetch.

## 7. Testing strategy

| Layer | Tooling | What it proves |
|---|---|---|
| Shared unit | Vitest | Parser grammar, DST/recurrence edge cases, schema rules |
| API integration | Vitest + supertest, isolated DB per file | Every endpoint, auth/token rotation & theft detection, authorization boundaries (cross-user access returns 404), pagination stability, scheduler idempotency, SSE delivery, security headers, error shapes |
| API on real Postgres | same suite with `TEST_DATABASE_URL` | Production parity (incl. `LISTEN/NOTIFY`) |
| Web unit/component | Vitest + Testing Library | API client refresh/error handling, date labels, quick add behaviour |
| End-to-end | Playwright (desktop + Pixel 7) | Register/login/session restore, quick add, details & subtasks, complete + undo, trash/restore, projects & board drag-and-drop, command palette, dark mode, mobile drawer & no horizontal overflow |

## 8. Known trade-offs & next steps

- **Rate limiting is in-memory per replica.** For multiple replicas plug a shared store (e.g. `rate-limit-redis`) into `middleware/rateLimit.ts`.
- **Access tokens are stateless** for 15 minutes after revocation (standard trade-off). Refresh tokens are revoked instantly.
- **Email flows** (verification, password reset, email reminders) need an email provider; the notification service is the extension point.
- **Collaboration** (shared projects) would add a `project_members` table and change ownership checks from `user_id =` to membership joins — the service layer already centralises those checks (`findOwned`, `assertProject`).
- **Offline:** mutations queue while offline; a service worker for full offline reads is a natural next step.
