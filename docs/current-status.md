# SLA Dashboard — Current Status

**Last updated:** 2026-07-27

---

## Completed

### Core Infrastructure
- [x] Backend REST API — all endpoints operational (`/api/kpi-summary`, `/api/teams`, `/api/tasks`, `/api/history`, `/api/alerts`, `/api/alert-tasks`, `/api/loan-summary`, `/api/loan-detail`, `/api/loan-trend`, `/api/staff/*`, `/api/settings`, `/api/admin/*`, `/api/auth/*`, `/api/events`)
- [x] JWT authentication with login, signup, forgot/reset password
- [x] Admin role with user management
- [x] SQL Server connection pool with 180s timeout for cold starts
- [x] In-memory 5-min cache with stale-while-revalidate
- [x] SSE real-time: `data-changed` (DB fingerprint poll every 30s) + `settings-changed` (instant on admin save)
- [x] Dynamic team discovery from DB — no hardcoded team IDs or names

### Dashboard Views
- [x] Dashboard — loan strip, KPI tiles, team cards, 7-day trend chart, alerts panel
- [x] All Teams view (sorted table)
- [x] All Active Tasks view with Task ID + App ID search filters
- [x] Reports view — multi-line history chart with range selector (7d/30d/90d/180d/400d)
- [x] Active Alerts view with per-team drill-through table
- [x] Settings view — SLA targets, at-risk threshold, team order/visibility, loan targets, refresh interval, task count
- [x] Staff List view — departments + absent-today + staff modal
- [x] User Management (admin only)

### Metrics & Logic
- [x] Active task metrics: Volume, Avg TAT, Overdue — no date filter (all active tasks)
- [x] SLA% (team card, overall KPI, history chart) — `SLAAdjustedDate = today` scope
- [x] Completed-task drill-through (SLA badge click) — `SLAAdjustedDate = today` scope
- [x] Three-condition overdue rule (conditions A, B, C) for active tasks; separate rule for completed
- [x] At-risk detection (configurable %, default 87.5%)
- [x] TAT display as `h:mm:ss` via `fmtHMS()`
- [x] SLA% delta (today vs prev biz day); all other deltas always 0 (hidden)
- [x] Loan strip — Application Received, Funder Approvals, Settlements with sparklines in modal

### UI Polish
- [x] InfoTip (tooltip) component — viewport-safe positioning, portal, click-to-toggle, ESC/outside-close
- [x] All TOOLTIPS text — consistent format with Date basis / Includes / Excluded sections
- [x] Column-header sorting (asc → desc → reset) in all 10 tables
- [x] Drill-through modal — on-demand per-team fetch (fixes TOP 500 truncation bug)
- [x] KPI tile delta display — zero deltas hidden; correct colour inversion for Avg TAT and Overdue
- [x] 7-day and history chart tooltip sort order (Settings order, not value-sorted)
- [x] History chart — string date params (no sql.DateTime timezone offset)

### Security & Guardrails
- [x] No hardcoded date literals in production code (CI check: `npm run check-dates`)
- [x] MUST rule enforcement — `broadcastSettingsChanged()` + SSE listener invariants (pre-commit hook)
- [x] CORS restricted to `ALLOWED_ORIGINS`, JWT min 32 chars, read-only DB user

---

## In Progress

- [ ] Verifying chart SLA% values match team card values after string-date fix (today = 2026-07-27)
- [ ] End-to-end testing of on-demand modal fetch across all team types (KPI groups and dept groups)

---

## Planned / Known Gaps

- [ ] React Router — currently views are toggled by component state; URL does not change on navigation
- [ ] No automated test suite (unit or integration)
- [ ] Railway backend deployment blocked while SQL Server is only on local PC (needs tunnel or hosted DB)
- [ ] Password reset currently returns token directly in API response — email delivery not implemented
- [ ] `SLA_LOGIC_AUDIT_2026-06-17.md` notes old hardcoded team IDs — superseded by dynamic discovery; audit needs refresh
- [ ] `frontend/src/CLAUDE.md` and `docs/CLAUDE.md` contain overlapping notes — could be consolidated
