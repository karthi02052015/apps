# TaskFlow

**Plan it. Do it. Finish it.**

TaskFlow is a fast, focused task manager: natural-language quick add, Today / Upcoming / Board views, recurring tasks, reminders with real-time notifications, and a keyboard-first interface in light and dark mode.

| | |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, Radix UI, dnd-kit, Motion |
| **Backend** | Node.js 20+, Express 5, TypeScript, Drizzle ORM, Zod |
| **Database** | PostgreSQL 16 (production) · embedded PGlite (zero-setup development & tests) |
| **Auth** | Short-lived JWT access tokens + rotating, httpOnly refresh-token cookies with theft detection |
| **Realtime** | Server-Sent Events over PostgreSQL `LISTEN/NOTIFY` (works across replicas) |
| **Quality** | 94 unit & integration tests (API suite also verified on real PostgreSQL 16) + 11 Playwright E2E flows, strict TypeScript, ESLint, CI |

---

## Features

- **Natural-language quick add** — `Pay rent friday 9am #home @personal !high every month` becomes a fully-specified task. Parsed tokens preview live as chips so you learn the syntax by using it.
- **Smart views** — Inbox, Today (with overdue + "completed today" and a progress ring), Upcoming (grouped by day), Overdue, Completed, Trash (30-day retention).
- **List & Board** — drag to reorder in lists; drag between *To do / In progress / Done* on boards (mouse, touch and keyboard).
- **Projects & tags** — colour-coded projects with live open-task counts; tags with filtering.
- **Task details** — notes, subtasks with progress, due date/time, reminders, priority, repeat rules, tags. Autosaves with optimistic updates.
- **Recurring tasks** — daily, weekdays, weekly, monthly, yearly; DST-correct and anchored (Jan 31 → Feb 28 → Mar 31).
- **Notifications** — reminders and overdue alerts, pushed in real time to every open tab, plus optional desktop notifications.
- **Search & command palette** — `⌘K` / `Ctrl+K` for full-text task search, navigation and commands.
- **Bulk actions** — select many tasks to complete, move, re-prioritise or delete.
- **Undo everywhere it matters** — completing or deleting a task shows an Undo toast.
- **Streaks & stats** — daily completion streak and per-view counts.
- **Security centre** — active sessions with per-device sign-out, "sign out everywhere", password change, and an activity log.
- **Resilient UX** — offline banner with queued mutations, automatic retries with backoff, friendly error messages (never raw errors), skeleton loading states.
- **Accessible & responsive** — keyboard shortcuts, visible focus, ARIA roles, reduced-motion support; designed mobile-first for phone, tablet and desktop.

---

## Quick start (local development — no database install needed)

Requirements: **Node.js 20.11+** (22 recommended) and npm 10+.

```bash
npm run setup     # install, create the embedded database, seed a demo account
npm run dev       # API on :4000, web on :5173
```

Open **http://localhost:5173** and sign in with the demo account:

```
demo@taskflow.dev  /  taskflow-demo-1
```

…or create your own account — new users get a short interactive "Getting started" project.

> The development database is an embedded PostgreSQL (PGlite) stored in `apps/api/.data/`. Delete that folder to start fresh. To develop against a real PostgreSQL instead, set `DATABASE_URL` in `apps/api/.env` (see `.env.example`).

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Search & command palette |
| `N` | Focus quick add |
| `G` then `T` / `I` / `U` | Go to Today / Inbox / Upcoming |
| `Enter` / `Space` | Open / complete the focused task |
| `?` | Show all shortcuts |

---

## Run with Docker (production-like)

```bash
cp .env.example .env
# set JWT_SECRET (48+ random chars) and POSTGRES_PASSWORD in .env
docker compose up --build
```

Open **http://localhost:8080**. This runs PostgreSQL 16, a one-shot migration job, and the TaskFlow image (API serving the built web app). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for real deployments.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + web dev servers with hot reload |
| `npm run build` | Production builds (`apps/api/dist`, `apps/web/dist`) |
| `npm start` | Run the built API (serves the web app when `WEB_DIST_DIR` is set) |
| `npm test` | Unit + integration tests for all packages |
| `npm run test:e2e` | Playwright end-to-end tests (starts its own servers; first run `npx playwright install chromium`) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run verify` | Everything CI runs, locally |
| `npm run db:generate` | Create a migration after changing `apps/api/src/db/schema.ts` |
| `npm run db:migrate -w @taskflow/api` | Apply migrations |
| `npm run db:seed -w @taskflow/api` | Seed the demo account (dev only) |

---

## Project structure

```
taskflow/
├─ packages/shared/        # Zod contracts, domain constants, quick-add parser, recurrence & time-zone logic
├─ apps/api/               # Express API
│  ├─ src/modules/         # auth · tasks · projects · tags · notifications · audit
│  ├─ src/db/              # Drizzle schema, client (Postgres | PGlite), migrate, seed
│  ├─ src/realtime/        # SSE endpoint + event bus (in-memory / Postgres LISTEN/NOTIFY)
│  ├─ src/middleware/      # auth, validation, rate limits, error boundary
│  ├─ src/observability/   # /healthz, /readyz, Prometheus /metrics
│  ├─ drizzle/             # SQL migrations (checked in)
│  └─ test/                # supertest integration tests
├─ apps/web/               # React SPA
│  └─ src/{features,components,layout,pages,lib,hooks}
├─ e2e/                    # Playwright specs
├─ docs/                   # Architecture, API, deployment, security
├─ Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, data model, key decisions and trade-offs
- [API reference](docs/API.md) — every endpoint, request/response shapes, errors, pagination
- [Deployment](docs/DEPLOYMENT.md) — environment, scaling, backups, monitoring, runbook
- [Security](docs/SECURITY.md) — threat model and controls

## License

Proprietary — © TaskFlow. All rights reserved.
