# Security

TaskFlow assumes hostile clients. This document lists the threats considered and the controls in place. Report vulnerabilities privately to the maintainers — do not open public issues.

## Threat model & controls

| Threat | Controls |
|---|---|
| **Credential stuffing / brute force** | Per-IP auth rate limit (20 failures / 15 min), account lockout after 10 consecutive failures (15 min, `423` + `Retry-After`), generic "incorrect email or password" message, equalised timing for unknown emails (dummy hash), audit events + metrics for failures. |
| **Password database leak** | scrypt (N=2¹⁵, r=8, p=1, 16-byte salt, 64-byte key) with parameters stored per hash and transparent rehash on login; NFKC normalisation; 10–128 char policy with letter + number. |
| **Access-token theft (XSS)** | Access token held in memory only (never `localStorage`), 15-minute lifetime; strict CSP (`script-src 'self'`, no inline scripts — theme bootstrap is an external file), React escaping, no `dangerouslySetInnerHTML`. |
| **Refresh-token theft** | Opaque 256-bit tokens, only SHA-256 stored, `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie, rotation on every use, **family revocation on reuse** (with a 15 s grace window for concurrent tabs), audit event `auth.refresh_reuse_detected`. |
| **CSRF** | Cookie only reaches `/api/v1/auth/*`; cookie endpoints require `X-Requested-With: taskflow` (a non-simple header that forces a CORS preflight, which the allow-list rejects); all other endpoints use Bearer tokens, which browsers never attach automatically. |
| **JWT attacks** | Algorithm pinned to HS256 (no `alg: none` / key confusion), issuer and audience verified, secret ≥ 32 chars enforced at boot. |
| **Broken object-level authorization (IDOR)** | Every query is scoped by `user_id` in SQL (`findOwned`, `assertProject`, owned bulk filters). Another user's resources are indistinguishable from missing ones (`404`). Covered by integration tests. |
| **Mass assignment** | Zod schemas whitelist writable fields; server-controlled fields (`userId`, `completedAt`, `version`, `role`, …) cannot be set by clients. |
| **Injection** | Parameterised queries via Drizzle for all input; `ILIKE` wildcards escaped; full-text search uses `websearch_to_tsquery` (never raw tsquery syntax); UUID params validated before hitting the DB. |
| **Resource exhaustion** | 100 kB body limit, bounded lengths on every string/array, page size ≤ 200, bulk ≤ 200, per-user caps (200 projects, 100 subtasks/task, 10 SSE streams), 15 s DB `statement_timeout`, 30 s request timeout, global rate limit. |
| **Clickjacking / sniffing / downgrade** | `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, HSTS (1 year, subdomains) when served over TLS, `Referrer-Policy: no-referrer`, `upgrade-insecure-requests`. |
| **Information leakage** | Uniform error envelope; stack traces and SQL never returned; `X-Powered-By` removed; logs redact `Authorization`, cookies, passwords and tokens; tokens never placed in URLs (SSE uses a header via `fetch`). |
| **Session management** | Users can list sessions (device, IP, last used), revoke any, or sign out everywhere; password change revokes all other sessions; expired sessions are purged hourly. |
| **Supply chain** | Lockfile committed, `npm audit --omit=dev` in CI, minimal runtime image with production deps only, non-root container, read-only root filesystem and `no-new-privileges` in Compose. |
| **Auditability** | Append-only `audit_logs` for auth events and all mutations (actor, action, entity, IP, user agent, metadata). Audit writes never block requests; failures fall back to structured logs. |

## Configuration hardening checklist

- [ ] `NODE_ENV=production`, strong unique `JWT_SECRET` from a secret manager
- [ ] HTTPS everywhere; `COOKIE_SECURE` left at its production default (`true`)
- [ ] `CORS_ORIGINS` set to exact origins only
- [ ] `TRUST_PROXY` matches your proxy topology (never higher)
- [ ] `METRICS_TOKEN` set, or `/metrics` blocked at the edge
- [ ] Database user limited to the TaskFlow database; `DATABASE_SSL=true` for remote DBs
- [ ] Backups encrypted at rest; restore tested
- [ ] Shared rate-limit store or edge rate limiting when running multiple replicas
