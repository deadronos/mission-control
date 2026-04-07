# Robustness Findings — Top 5

Reviewed: 2026-04-07  
Scope: runtime hardening, auth, persistence, gateway reliability, realtime delivery, and operational safety.

Validation snapshot:

- `npm run test` ✅ passed (28/28)
- `npm run lint` ✅ passed with warnings only
- `npm run build` ✅ passed

This project is in decent shape overall, but the following five items offer the highest leverage for hardening reliability and production safety.

## 1. Tighten API authentication in `src/proxy.ts`

**Priority:** Critical

### Authentication impact

The global API protection allows requests through when `Origin` or `Referer` match the current host. Those headers are useful browser hints, but they are not trustworthy authentication signals because non-browser clients can spoof them.

### Authentication risks

- External clients may bypass `MC_API_TOKEN`
- Sensitive write endpoints under `/api/*` are affected
- The health endpoint uses a similar inline authentication pattern

### Authentication changes

- Remove header-based same-origin auth bypass for protected API routes
- Require explicit bearer auth, or move to real session/cookie auth if browser UX needs first-party access
- Keep `Origin` / `Referer` checks only for CSRF-style decisions, not identity

### Authentication files

- `src/proxy.ts`
- `src/app/api/health/route.ts`

## 2. Reduce unauthenticated operational exposure from health endpoints

**Priority:** High

### Health exposure impact

`/api/health/metrics` currently returns detailed Prometheus-style operational data derived from full internal health detail, including queue depth, agent counts, cost cap utilization, and research freshness.

### Health exposure risks

- Reveals internal system activity to anyone who can reach the service
- Makes reconnaissance easier in public or semi-public deployments

### Health exposure changes

- Require auth or network allowlisting for detailed metrics
- If public metrics are needed, expose a minimal redacted set only
- Separate “public summary” and “private detailed metrics” modes by environment

### Health exposure files

- `src/app/api/health/metrics/route.ts`
- `src/lib/health.ts`

## 3. Unify secrets and fail closed for webhook security

**Priority:** High

### Webhook security impact

Webhook configuration is inconsistent:

- `.env.example` documents `WEBHOOK_SECRET`
- `agent-completion` uses `WEBHOOK_SECRET`
- GitHub webhook uses `GITHUB_WEBHOOK_SECRET`

That split is easy to misconfigure, and the current behavior falls back to permissive dev-mode behavior when secrets are unset.

### Webhook security risks

- Operators may believe signature validation is enabled when it is not
- Production deployments can silently run with weakened webhook protections

### Webhook security changes

- Standardize the secret naming and documentation
- Emit a startup warning or fail fast in production when required webhook secrets are missing
- Consider explicit environment flags for “insecure local dev mode” rather than implicit fallback

### Webhook security files

- `.env.example`
- `src/app/api/webhooks/agent-completion/route.ts`
- `src/app/api/webhooks/github/route.ts`

## 4. Reject in-flight gateway requests immediately on disconnect

**Priority:** High

### Gateway reliability impact

The OpenClaw client does a lot right, including reconnect and forced reset paths, but unexpected disconnects do not appear to reject all pending RPC requests immediately. In practice, callers may sit until the per-request timeout fires.

### Gateway reliability risks

- Slow failure propagation during gateway incidents
- Hanging callers and noisy retry behavior
- Harder diagnosis when the gateway is degraded

### Gateway reliability changes

- On unexpected `onclose` / `onerror`, reject and clear all pending requests
- Add backoff with jitter for reconnect attempts
- Consider tracking connection state transitions explicitly for observability

### Gateway reliability files

- `src/lib/openclaw/client.ts`

## 5. Consolidate backup/restore conventions and verify restores

**Priority:** Medium-High

### Backup consistency impact

There are multiple backup conventions in the repo today:

- `src/lib/backup.ts` uses `backups/`
- migrations use `db-backups/`
- package scripts use `mission-control.db.backup` in the repo root

All three can work, but they increase operational ambiguity during restores and incident response.

### Backup consistency risks

- Confusing backup source of truth
- Higher chance of restoring the wrong artifact
- Restore flows may succeed mechanically without validating DB integrity afterward

### Backup consistency changes

- Choose one canonical backup directory and naming scheme
- Align admin API, migrations, scripts, and docs to that convention
- After restore, run integrity validation such as `PRAGMA integrity_check`
- Add tests for restore of old/corrupt/incomplete backup scenarios

### Backup consistency files

- `src/lib/backup.ts`
- `src/lib/db/migrations.ts`
- `package.json`
- `PR-DATABASE-SAFETY.md`

## Honorable mentions

These were not in the top five, but are still worth doing:

- Decouple health checks from active SSE client count in `src/lib/events.ts`
- Add exponential backoff and stale-stream detection for `src/hooks/useSSE.ts`
- Reduce lint warning volume so new reliability issues stand out faster
- Prefer direct internal service calls over HTTP self-calls in `src/lib/orchestration.ts`

## Suggested implementation order

1. Fix auth bypass behavior in `src/proxy.ts`
2. Lock down health detail / metrics exposure
3. Standardize webhook secret handling and production startup checks
4. Harden gateway disconnect behavior
5. Unify backup semantics and add restore verification tests
