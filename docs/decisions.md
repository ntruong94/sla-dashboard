# SLA Dashboard — Architectural Decisions

**Last updated:** 2026-07-27

---

## ADR-001: No React Router
**Decision:** Views are toggled by `view` state in `App.jsx`. No URL routing library installed.  
**Reason:** Dashboard is a single-screen tool; bookmarking individual views was not a requirement at build time.  
**Trade-off:** Browser back button doesn't work; direct linking to a view is not possible.  
**Status:** Accepted (could add React Router later without major refactor)

---

## ADR-002: Single server.js file for all backend logic
**Decision:** All API routes, SQL queries, caching, SSE, and business logic live in `backend/server.js` (~1950 lines).  
**Reason:** Simplicity for a solo/small team project; avoids over-engineering a thin CRUD backend.  
**Trade-off:** File grows large; harder to navigate. Mitigated by clear section comments.  
**Status:** Accepted

---

## ADR-003: Dynamic team discovery — no hardcoded team IDs
**Decision:** Teams are discovered from `ConfigTasks` (KPI groups) and `Department` (dept groups) every 60 seconds. No team IDs, department IDs, or `SpecifiedKPIGrp` patterns are hardcoded.  
**Reason:** New teams appear automatically when added to the DB; admin changes require no code deploy.  
**Trade-off:** All SQL `CASE` expressions are built dynamically at runtime; slightly harder to debug.  
**Status:** Accepted (enforced by team discovery audit in `check-must-rules.js`)

---

## ADR-004: String dates in SQL, never sql.DateTime objects
**Decision:** All date range boundaries in SQL queries are `YYYY-MM-DD` string literals interpolated via template literals (e.g., `AND col >= '${today}' AND col < '${todayNext}'`). `sql.DateTime` objects are never used for date boundaries.  
**Reason:** The mssql driver serialises JS `Date` objects as UTC. On AEST UTC+10 this shifts the boundary by 10 hours, causing tomorrow's tasks to appear in today's queries.  
**Status:** Enforced — `check-hardcoded-dates.js` pre-commit guard prevents literal date strings; pattern documented in CLAUDE.md §7.

---

## ADR-005: SLA% scope uses SLAAdjustedDate, not DateCreated or DateCompleted
**Decision:** All SLA% metrics (team card, overall KPI, history chart, drill-through) are scoped to `SLAAdjustedDate = today`.  
**Reason:** `DateCreated` would include tasks created today but not yet due; `DateCompleted` gives a different population than what appears on team cards. `SLAAdjustedDate` is the actual SLA deadline, making "today's SLA%" mean "tasks whose deadline is today".  
**Status:** Accepted (2026-07 change; previously used DateCompleted scope)

---

## ADR-006: Stale-while-revalidate cache with SSE invalidation
**Decision:** KPI and teams data are cached with 5-minute TTL. Stale data is served immediately while a background refresh runs. SSE `data-changed` event bypasses the TTL and forces an immediate refresh.  
**Reason:** SQL queries can take 100-115s on a cold DB buffer cache. Stale-while-revalidate prevents the UI from freezing on every refresh interval.  
**Status:** Accepted

---

## ADR-007: On-demand per-team fetch for drill-through modal
**Decision:** When a team card is clicked, the modal fetches tasks specifically for that team (`GET /api/tasks?team=X`). Previously, a global pre-fetch of all teams' tasks (`TOP 500`) was used.  
**Reason:** The global `TOP 500 ORDER BY TotalHoursOnTask DESC` cut tasks with 0 TAT from smaller teams (e.g. Data Entry had 39 tasks but only 11 appeared in the modal).  
**Status:** Accepted (2026-07 fix)

---

## ADR-008: Admin settings propagate instantly to all sessions via SSE
**Decision:** `PUT /api/admin/settings` always calls `broadcastSettingsChanged()` which sends a `settings-changed` SSE event to all connected clients. Client listeners call `getGlobalSettings()` + `applyGlobalConfig()` + `refreshData()`.  
**Reason:** Settings changes (SLA targets, team visibility) affect all dashboard views for all users simultaneously.  
**Status:** Enforced — `check-must-rules.js` pre-commit guard blocks commits that remove this invariant.

---

## ADR-009: No ORM — raw parameterised SQL
**Decision:** All database queries use raw SQL with mssql's parameterised inputs or template literal string interpolation (for non-user-supplied values like dates from `todayLocal()`).  
**Reason:** The query shapes are complex and performance-sensitive; an ORM would obscure the SQL and make tuning harder.  
**Trade-off:** SQL injection risk if any user-supplied string is ever interpolated — mitigated by strict code review and the fact that user input only ever goes through `request.input()`.  
**Status:** Accepted

---

## ADR-010: KPI tile delta = 0 is hidden, not shown as "+0"
**Decision:** `fmtDelta(0)` returns `null`; the `{delta && ...}` guard in `KpiTile` hides the delta row entirely.  
**Reason:** Volume, Avg TAT, and Overdue deltas are always 0 (active tasks have no date boundary to compare against). Showing "+0 vs yesterday" is misleading noise.  
**Status:** Accepted (2026-07 fix)
