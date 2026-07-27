# SLA Dashboard — Task Board

**Last updated:** 2026-07-27

---

## Done (shipped and verified)

| Item | Notes |
|------|-------|
| Dynamic team discovery | KPI groups + dept groups; refreshes every 60s |
| JWT auth + user management | Login, signup, forgot/reset, admin role |
| All 8 dashboard views | Dashboard, All Teams, All Active Tasks, Reports, Active Alerts, Settings, Staff List, User Management |
| SSE real-time propagation | `data-changed` + `settings-changed`; MUST rule enforced by pre-commit hook |
| Loan strip + sparklines | 3 cards with count/amount, deltas, configurable targets, drill-through modal with 30-day sparkline |
| InfoTip viewport-safe positioning | Portal, click-toggle, ESC/outside-close, clamped to viewport |
| All TOOLTIPS text consistent | Date basis, Includes, Excluded sections; Settings sentence rule |
| Column-header sorting | All 10 tables; asc → desc → reset; type-aware (number/date/text) |
| SLA% scope → SLAAdjustedDate | Team card, overall KPI, history chart, drill-through all aligned |
| History chart string-date fix | Removed sql.DateTime UTC offset bug (was showing tomorrow's data) |
| Chart tooltip sort order | Settings order (not value-sorted) in hover tooltips |
| KPI delta display fix | Zero deltas hidden; Avg TAT + Overdue colour inversion correct |
| Drill-through modal on-demand fetch | Per-team fetch replaces global TOP 500 pre-fetch; all tasks shown |
| Modal title shows actual task count | `tasks.length` used; "Loading…" during fetch |
| No hardcoded date literals | CI check `npm run check-dates`; pre-commit hook |

---

## Doing (in progress today)

| Item | Owner | Notes |
|------|-------|-------|
| Verify chart vs team card SLA% match | — | Chart fix deployed; needs visual confirmation after hard refresh |
| Test on-demand modal across all team types | — | KPI groups and dept groups both need checking |

---

## Todo (backlog)

| Priority | Item | Notes |
|----------|------|-------|
| High | Password reset — email delivery | Currently returns reset token directly in API response; no email sent |
| High | End-to-end test suite | No automated tests exist; purely manual QA |
| Medium | React Router | Browser back button and direct view links don't work |
| Medium | Refresh SLA Logic Audit doc | `SLA_LOGIC_AUDIT_2026-06-17.md` uses old hardcoded team IDs; dynamic discovery superseded this |
| Medium | Consolidate CLAUDE.md files | `docs/CLAUDE.md` and `frontend/src/CLAUDE.md` have overlapping notes |
| Low | Railway deployment | Blocked until SQL Server is reachable from cloud (needs hosted DB or persistent tunnel) |
| Low | TypeScript migration | Currently all `.jsx`/`.js`; TECHNICAL_DOCUMENTATION.md recommends TS for production |
| Low | TasksView (All Active Tasks) — custom target params not sent | `getTasks(null, null, null, targets)` — 4th arg ignored by `api.js` getTasks signature; targets not applied to global pre-fetch |

---

## Blocked

| Item | Blocker |
|------|---------|
| Railway cloud deployment | SQL Server is on local PC; Railway cannot reach `localhost:1433`. Needs either a hosted SQL Server or a persistent tunnel (ngrok static domain / Cloudflare named tunnel). |
| Email-based password reset | No email provider (SMTP/SendGrid/etc.) configured |

---

## Decisions Made (see decisions.md for rationale)

- No React Router (ADR-001)
- Single server.js (ADR-002)
- Dynamic team discovery (ADR-003)
- String dates in SQL (ADR-004)
- SLAAdjustedDate scope for SLA% (ADR-005)
- Stale-while-revalidate cache + SSE (ADR-006)
- On-demand modal fetch (ADR-007)
- Admin settings SSE propagation enforced (ADR-008)
- Raw SQL, no ORM (ADR-009)
- Zero deltas hidden (ADR-010)
