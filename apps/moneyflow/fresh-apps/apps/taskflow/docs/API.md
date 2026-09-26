# TaskFlow API reference (v1)

Base URL: `/api/v1` · JSON in, JSON out · all timestamps are ISO-8601 with offset (UTC `Z` in responses) · all ids are UUIDs.

## Conventions

### Authentication

Send the access token from login/register/refresh as `Authorization: Bearer <token>`. Tokens live 15 minutes (configurable). Renew with `POST /auth/refresh`, which uses the `tf_rt` httpOnly cookie and requires the header `X-Requested-With: taskflow`.

### Time zone

Send `X-Timezone: <IANA zone>` (e.g. `Asia/Kolkata`). It defines "today", "overdue", streaks and recurrence. If absent or invalid, the user's profile time zone is used.

### Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "details": [{ "path": "title", "message": "Title is required" }],
    "requestId": "8d0c…"
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed JSON |
| 401 | `UNAUTHENTICATED` | Missing/expired token, bad credentials |
| 403 | `FORBIDDEN` | Missing CSRF header, insufficient role |
| 404 | `NOT_FOUND` | Unknown resource — **including resources owned by other users** |
| 409 | `CONFLICT` | Duplicate name/email, stale `version`, editing a trashed task |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 kB |
| 422 | `VALIDATION_ERROR` | Field validation failed (`details` lists fields) |
| 423 | `ACCOUNT_LOCKED` | Too many failed logins (`Retry-After` header) |
| 429 | `RATE_LIMITED` | Rate limit exceeded (`RateLimit` / `Retry-After` headers) |
| 500 | `INTERNAL_ERROR` | Unexpected failure (quote `requestId` to support) |

Every response carries `X-Request-Id` (you may send your own, 8–64 chars `[A-Za-z0-9._-]`).

### Pagination

List endpoints use opaque keyset cursors: `?limit=50&cursor=<nextCursor>`. Responses: `{ "items": [...], "nextCursor": "…" | null }`. Cursors are stable under concurrent inserts (no duplicates or gaps).

### Rate limits (defaults)

300 requests/min per IP on `/api/v1`; 20 failed credential attempts per 15 min per IP on login/register/change-password; 30 refreshes/min.

---

## Auth — `/auth`

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `POST /auth/register` | – | `{ name, email, password, timezone? }` | `201 AuthResponse` + cookie |
| `POST /auth/login` | – | `{ email, password }` | `200 AuthResponse` + cookie |
| `POST /auth/refresh` | cookie + `X-Requested-With` | – | `200 AuthResponse` (+ rotated cookie) |
| `POST /auth/logout` | cookie + `X-Requested-With` | – | `204` |
| `GET /auth/me` | Bearer | – | `{ user: UserDTO }` |
| `PATCH /auth/me` | Bearer | `{ name?, timezone? }` | `{ user: UserDTO }` |
| `POST /auth/change-password` | Bearer | `{ currentPassword, newPassword }` | `204` (other sessions revoked) |
| `POST /auth/logout-all` | Bearer | – | `204` |
| `GET /auth/sessions` | Bearer | – | `{ items: SessionDTO[] }` |
| `DELETE /auth/sessions/:id` | Bearer | – | `204` |

Password policy: 10–128 characters with at least one letter and one number.

```ts
AuthResponse = { user: UserDTO; accessToken: string; expiresIn: number /* seconds */ }
UserDTO      = { id; email; name; role: 'user' | 'admin'; timezone; createdAt }
SessionDTO   = { id; userAgent; ip; createdAt; lastUsedAt; current: boolean }
```

## Tasks — `/tasks`

### `GET /tasks`

| Query | Type | Notes |
|---|---|---|
| `view` | `inbox \| today \| upcoming \| overdue \| completed \| all \| trash` | default `all` |
| `status` | csv of `todo,in_progress,done` | |
| `priority` | csv of `none,low,medium,high,urgent` | |
| `projectId` | uuid | |
| `tag` | string | |
| `q` | string ≤ 200 | full-text (title + notes) and partial title match |
| `dueFrom`, `dueTo` | ISO datetime | half-open `[from, to)` |
| `sort` | `position \| dueAt \| priority \| createdAt \| updatedAt \| title` | default `position`; views pick smart defaults (e.g. Upcoming → `dueAt`) |
| `order` | `asc \| desc` | |
| `includeCompleted` | `true \| false` | include done tasks in inbox/upcoming/all |
| `limit`, `cursor` | | 1–200, default 50 |

View semantics: **today** = open tasks due before end of today (incl. overdue) + tasks completed today · **upcoming** = due from tomorrow · **overdue** = all-day tasks before today or timed tasks before now · **inbox** = no project.

### Other endpoints

| Method & path | Body | Response |
|---|---|---|
| `POST /tasks` | `CreateTask` | `201 { task }` |
| `GET /tasks/:id` | – | `{ task }` |
| `PATCH /tasks/:id` | `UpdateTask` | `{ task, nextOccurrence? }` |
| `DELETE /tasks/:id` | – | `204` (moves to trash) |
| `DELETE /tasks/:id?permanent=true` | – | `204` (only from trash) |
| `POST /tasks/:id/restore` | – | `{ task }` |
| `DELETE /tasks/trash` | – | `{ deleted: number }` |
| `POST /tasks/bulk` | see below | `{ updated: number }` |
| `GET /tasks/stats` | – | `TaskStatsDTO` |
| `POST /tasks/:id/subtasks` | `{ title }` | `201 { subtask }` |
| `PATCH /tasks/:id/subtasks/:subtaskId` | `{ title?, done?, position? }` | `{ subtask }` |
| `DELETE /tasks/:id/subtasks/:subtaskId` | – | `204` |

```ts
CreateTask = {
  title: string            // 1–500, trimmed
  description?: string|null// ≤ 20 000
  status?: TaskStatus      // default 'todo'
  priority?: TaskPriority  // default 'none'
  projectId?: uuid|null
  dueAt?: iso|null; allDay?: boolean
  remindAt?: iso|null
  recurrence?: 'daily'|'weekdays'|'weekly'|'monthly'|'yearly'|null  // requires dueAt
  tags?: string[]          // ≤ 20, lower-cased, de-duplicated, created on demand
  subtasks?: string[]      // ≤ 100
}
UpdateTask = Partial<CreateTask without subtasks> & { position?: number; version?: number }
```

- **Optimistic concurrency:** send the `version` you last read; a stale version returns `409`.
- **Completing a recurring task** returns `nextOccurrence` (the rule moves to the new task).
- Changing `dueAt`/`remindAt` re-arms overdue/reminder notifications.

Bulk:

```json
{ "action": "complete" | "reopen" | "delete", "ids": ["…"] }
{ "action": "move", "ids": ["…"], "projectId": "…" | null }
{ "action": "priority", "ids": ["…"], "priority": "high" }
```

Up to 200 ids; ids not owned by the caller are silently skipped (count reflects affected rows).

```ts
TaskDTO = {
  id; title; description; status; priority; projectId; dueAt; allDay; remindAt; recurrence;
  position; completedAt; deletedAt; createdAt; updatedAt; version;
  tags: string[]; subtasks: { id; title; done; position }[]
}
TaskStatsDTO = { inbox; today; upcoming; overdue; completedToday; completedThisWeek; streakDays; byProject: Record<uuid, number> }
```

## Projects — `/projects`

| Method & path | Body | Response |
|---|---|---|
| `GET /projects?includeArchived=true` | – | `{ items: ProjectDTO[] }` |
| `POST /projects` | `{ name, color?, icon? }` | `201 { project }` |
| `PATCH /projects/:id` | `{ name?, color?, icon?, position?, archived? }` | `{ project }` |
| `DELETE /projects/:id` | – | `204` — tasks move to the Inbox |

Names are unique per user (case-insensitive). Colours are `#rrggbb`.

## Tags — `/tags`

| Method & path | Body | Response |
|---|---|---|
| `GET /tags` | – | `{ items: { id, name, color, taskCount }[] }` |
| `POST /tags` | `{ name, color? }` | `201 { tag }` |
| `PATCH /tags/:id` | `{ name?, color? }` | `{ tag }` |
| `DELETE /tags/:id` | – | `204` |

Tag names: letters, numbers, `-`, `_`; stored lower-case.

## Notifications — `/notifications`

| Method & path | Body | Response |
|---|---|---|
| `GET /notifications?unread=true&limit=30&cursor=…` | – | `{ items: NotificationDTO[], nextCursor, unreadCount }` |
| `POST /notifications/read` | `{ ids: uuid[] }` or `{ all: true }` | `{ updated }` |

## Realtime — `GET /events`

Server-Sent Events stream (`Authorization: Bearer …`). Events:

```
event: notification     data: { "type": "notification", "notification": NotificationDTO }
event: tasks.changed    data: { "type": "tasks.changed", "taskIds": ["…"] }
event: projects.changed data: { "type": "projects.changed" }
event: ping             data: { "type": "ping" }
```

Comment heartbeats every 25 s. The stream closes when the access token expires — reconnect with a fresh token. Max 10 concurrent streams per user.

## Audit log — `/audit-logs`

`GET /audit-logs?limit=&cursor=&action=` → `{ items: AuditLogDTO[], nextCursor }`. Users see their own entries; admins may pass `userId`.

## Operations (no `/api/v1` prefix)

| Path | Purpose |
|---|---|
| `GET /healthz` | Liveness (process up) |
| `GET /readyz` | Readiness (database reachable within 2 s) → `503` otherwise |
| `GET /metrics` | Prometheus metrics (Bearer `METRICS_TOKEN` when configured) |

## Example

```bash
# register
curl -s -c jar -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"analytical-1"}' \
  http://localhost:4000/api/v1/auth/register | jq -r .accessToken > token

# create a task due tomorrow 9am (Kolkata)
curl -s -H "Authorization: Bearer $(cat token)" -H 'X-Timezone: Asia/Kolkata' -H 'Content-Type: application/json' \
  -d '{"title":"Pay rent","dueAt":"2026-09-24T03:30:00Z","priority":"high","tags":["home"]}' \
  http://localhost:4000/api/v1/tasks

# today's list
curl -s -H "Authorization: Bearer $(cat token)" -H 'X-Timezone: Asia/Kolkata' \
  'http://localhost:4000/api/v1/tasks?view=today'

# refresh the access token
curl -s -b jar -c jar -X POST -H 'X-Requested-With: taskflow' http://localhost:4000/api/v1/auth/refresh
```
