# CLAUDE.md — SLA Dashboard Project Reference

> For: GitHub Copilot, developers, and the non-technical project owner.
> Purpose: Complete guide to what this project is, what exists, what is missing, and how to build it.

---

## 1. Project Overview

**Product:** SLA Dashboard for Mortgage Ezy Pty Ltd
**Goal:** A real-time web dashboard that shows how quickly each loan-processing team is completing their work — and whether they are meeting their SLA (Service Level Agreement) targets.
**Database:** SQL Server — database name: `SEReport`
**Status:** **Live** — backend connected to SQL Server (`DESKTOP-HGGDDCR`, DB `MySEReport`). All KPI tiles, team cards, and delta indicators show live SQL data. Servers: backend `http://localhost:5000`, frontend `http://localhost:5173`.

**Admin account:** Seeded automatically on first backend startup. Looks for `Staff.FirstName = 'System'` — uses that staff record's `EmailAddress` and default password `@dmin`. Only this account can access the User Management panel. Change the password after first login.

---

## 2. Business Goal

Operations managers at Mortgage Ezy need to see at a glance:
- Which loan-processing teams are meeting their SLA targets
- How many tasks are overdue or at risk
- How performance trends over time (7 days, 30 days, 90 days)
- What specific tasks are causing breaches

This replaces manual Excel reporting or no reporting at all.

---

## 3. Target Users

| Role | What They Need |
|------|---------------|
| Operations Manager | Dashboard overview — all teams, overall SLA %, overdue count |
| Team Lead | Drill into their team's task list — what is overdue, who owns it |
| Senior Management | Historical trend reports, month-over-month performance |

---

## 4. Pages / Views

The prototype already defines all 6 views in `frontend/src/components/views.jsx`:

| View | Path (planned) | Description |
|------|---------------|-------------|
| Dashboard | `/` | KPI tiles + team cards + 7-day trend chart + alerts |
| Teams | `/teams` | Table of all teams sorted by SLA performance |
| Tasks | `/tasks` | Full task list with team + status filters |
| Reports | `/reports` | Historical SLA trend chart with date-range selector |
| Alerts | `/alerts` | Active alerts grouped by severity (critical / warning) |
| Settings | `/settings` | Per-team SLA target configuration |
| User Management | `/admin` | **Admin only** — read-only list of registered users (email, role, joined, status) |
| Staff List | `/staff-list` | All departments with active staff counts; click row to drill into staff members |
---

## 5. KPIs / SLA Metrics

> **Updated 2026-06-02:** KPI and Team card calculations aligned to the Work Scope spec (SLA_Dashboard_Work_Scope.docx). Each metric uses a different status filter — see table below. All values are scoped to **`DateCreated = today`** (sargable range pattern).

| KPI | Description | Status filter | SQL logic |
|-----|-------------|---------------|-----------|
| Total Active Tasks | Count of open tasks created **today** | `IN (1,4,5,6)` active only | `SUM(... AND TaskStatusID IN (1,4,5,6))` |
| Overall SLA % | `((tasks completed within target) OR (tasks completed by SLAAdjustedDate) ÷ total tasks completed) × 100` — **DateCompleted** basis | `= 2` completed only | `SUM(CASE WHEN (DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 <= targetExpr OR (SLAAdjustedDate IS NOT NULL AND DateCompleted <= SLAAdjustedDate)) THEN 1 ELSE 0 END) / NULLIF(SUM(1), 0) * 100` scoped to `DateCompleted = today` |
| Avg Turnaround (TAT) | Mean `TotalHoursOnTask` for **active** tasks created today (null/0 excluded) | `IN (1,4,5,6)` active only | `AVG(CASE WHEN TotalHoursOnTask IS NOT NULL AND TotalHoursOnTask <> 0 THEN TotalHoursOnTask ELSE NULL END)` scoped to active tasks (`fetchKpiData` Q1) |
| Overdue / Breached | Count of **open** tasks created today that are overdue | `IN (1,4,5,6)` active only | `SUM(... AND TotalHoursOnTask > 0 AND (TotalHoursOnTask > SLAInHours OR (SLAAdjustedDate IS NOT NULL AND GETDATE() > SLAAdjustedDate)))` |
| Per-Team Volume | Active task count per team, scoped to `DateCreated = today` | `IN (1,4,5,6)` active only | `/api/teams` query 1, grouped by DepartmentId CASE |
| Per-Team SLA % | `(tasks where TotalHoursOnTask ≤ SLAInHours AND DateCompleted ≤ SLAAdjustedDate when set) ÷ total completed × 100` per team — **DateCreated** basis (same as all other per-team metrics) | `= 2` completed only | separate SLA query (Q3 in `fetchTeamsData`) using `(TotalHoursOnTask IS NULL OR TotalHoursOnTask <= SLAInHours) AND (SLAAdjustedDate IS NULL OR DateCompleted <= SLAAdjustedDate)`, grouped by TEAM_ID_CASE, scoped to `DateCreated = today`. Matches completed-tasks drill-through modal SLA%. |
| Per-Team Avg TAT | Mean `TotalHoursOnTask` per team for active tasks today (null/0 excluded) | `IN (1,4,5,6)` active only | `AVG(CASE WHEN TaskStatusID IN (1,4,5,6) AND TotalHoursOnTask IS NOT NULL AND TotalHoursOnTask <> 0 THEN TotalHoursOnTask ELSE NULL END)` (Q1 in `fetchTeamsData`) |
| Per-Team Overdue | Open tasks past SLA target per team, today | `IN (1,4,5,6)` active only | same query 1 |

> **TAT Rule (2026-07-16 — updated):**
> - **Avg TAT metric (KPI tile, team cards, deltas) — active tasks only:** `TotalHoursOnTask` — the stored DB field, scoped to active tasks (`TaskStatusID IN (1,4,5,6)`) only. Tasks where `TotalHoursOnTask IS NULL OR TotalHoursOnTask = 0.00` are excluded from the average denominator and numerator. `DATEDIFF` elapsed-time formula is **no longer used** for any task type in Avg TAT metric calculations.
> - **TAT value in per-task drill-through tables (TAT vs Target column):** `TotalHoursOnTask` — applies to all active-task drill-through tables (`TaskRow`, `AlertDrillTable`, `AlertsPanel` inline table, `TasksView`). Completed-tasks drill-through (SLA % badge click) uses its own separate TAT logic — see that section.
> - **Target value (all tasks):** Team's configured SLA target from Settings (`settings.targets[teamId]`); default 4h. Per-task `t.SLAInHours` is **not** used as the target baseline for the TAT bar or status calculation.
> - **Null `TotalHoursOnTask`:** TAT display is **blank** (no substituted 0). The task is excluded from all TAT averages, overdue counts, and at-risk calculations; status defaults to `'ok'`. In all TAT vs Target table cells, when `TotalHoursOnTask` is null the cell shows `/ Xh target` right-aligned (target only, no TAT value, no progress bar) — applied in `TaskRow`, `AlertDrillTable`, `AlertsPanel` inline table, and `TasksView`. When TAT is non-null, the cell shows `X.Xh / Xh target` (both value and target with "target" suffix) — all 4 tables use the same `/ Xh target` suffix format.

> **Overdue Rule (2026-07-15 — updated):** A task is counted as OVERDUE when ALL of the following apply:
> - Active tasks only: `TaskStatusID IN (1,4,5,6)`
> - Date-scoped by each widget's existing `DateCreated` context
> - `TotalHoursOnTask IS NOT NULL AND TotalHoursOnTask > 0` (null and zero excluded)
>
> AND **one or both** of these overdue conditions is true:
> 1. `TotalHoursOnTask > t.SLAInHours` (per-task SLA field, both non-null non-zero)
> 2. `SLAAdjustedDate IS NOT NULL AND GETDATE() > SLAAdjustedDate` (adjusted deadline has passed)
>
> SQL condition:
> ```sql
> AND t.TotalHoursOnTask > 0
> AND (t.TotalHoursOnTask > t.SLAInHours
>      OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
> ```
>
> Applied to: KPI overdue count, KPI prev-day delta, team card overdue count, team card delta, tasks view `status='bad'` CASE and filter, alerts query `overdue` count, alert-tasks drill-down overdue UNION branch.
> At-risk UNION branch adds `AND NOT (<overdue condition>)` to prevent double-counting.
>
> **EXCEPTION:** The **SLA% badge click — Completed Tasks Drill-Through table** is NOT affected. That table uses `DateCompleted`-based compliance logic and its status calculation remains unchanged.
>
> Note: Overall SLA% KPI and history chart still use the `SLAAdjustedDate` fallback against `DateCompleted` — those are separate compliance metrics unaffected by this change. Per-team card SLA% now uses `DateCreated` scope and the same `TotalHoursOnTask ≤ SLAInHours` formula as the completed-tasks drill-through modal.

> **At Risk Rule (2026-06-12):** A task is at risk if:
> - Real-time TAT >= `atRiskFraction × SLA target` AND TAT <= SLA target AND SLAAdjustedDate has not passed.
> - Default `atRiskFraction` = 87.5% (configurable in Settings). Applied in `/api/alert-tasks` and `/api/tasks` status CASE.
> - SQL: `DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= ${slaExpr} * ${atRiskFraction} AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= ${slaExpr}`


> **Date scope (SLA % only):** Overall KPI SLA% and history chart use `DateCompleted >= 'YYYY-MM-DD' AND DateCompleted < 'next-day'`. Per-team card SLA% uses `DateCreated >= 'YYYY-MM-DD' AND DateCreated < 'next-day'` (same scope as all other per-team metrics). See SLA% Rule below.
> **Delta scope:** today value − prev biz day value. Same per-metric date columns and status filters.
> **Team scope filter (all metrics):** `(ct.UsedForKPI = 1 AND ct.SpecifiedKPIGrp non-empty) OR (ct.UsedForKPI IS NULL AND ct.SpecifiedKPIGrp IS NULL AND s.DepartmentId IN (101, 110, 122, 10) AND s.EmployeeStatus = 1)` — `TEAM_FILTER` constant. Rule 1 branch: KPI-flagged tasks with a non-empty `SpecifiedKPIGrp`. Rule 2 branch: fully-unclassified tasks assigned to a fallback-dept team's active staff (ids 1, 2, 4, 9). All queries use `LEFT JOIN Staff s ON t.AssignedTo = s.StaffID` and `LEFT JOIN ConfigTasks ct ON t.ConfigTaskId = ct.ConfigTaskId`.

> **SLA% Rule (2026-07-16 — updated):**
>
> **Overall KPI SLA% and history chart** (`fetchKpiData` Q2, `fetchHistoryData`) — `DateCompleted` scope; compliant when **either**:
> 1. `DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 <= targetExpr`
> 2. `SLAAdjustedDate IS NOT NULL AND DateCompleted <= SLAAdjustedDate`
>
> **Per-team card SLA%** (`fetchTeamsData` Q3) — `DateCreated` scope (same as all other per-team metrics); compliant when **both**:
> 1. `TotalHoursOnTask IS NULL OR TotalHoursOnTask <= SLAInHours`
> 2. `SLAAdjustedDate IS NULL OR DateCompleted <= SLAAdjustedDate`
>
> This matches exactly the completed-tasks drill-through modal so the badge % and modal % always show the same number.
> ```sql
> -- Per-team Q3 (fetchTeamsData):
> CAST(
>   SUM(CASE WHEN t.TaskStatusID = 2
>            AND (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask <= t.SLAInHours)
>            AND (t.SLAAdjustedDate IS NULL OR t.DateCompleted <= t.SLAAdjustedDate)
>            THEN 1 ELSE 0 END) AS FLOAT
> ) / NULLIF(SUM(CASE WHEN t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100
> ```
> Filtered by `t.DateCreated >= 'YYYY-MM-DD' AND t.DateCreated < 'next-day'`.
> `fetchKpiData()` runs Overall SLA% as a separate parallel query (Q2). `fetchTeamsData()` runs per-team SLA% as Q3. `fetchHistoryData()` uses the **same formula as Q3** — `DateCreated` scope, `TotalHoursOnTask IS NULL OR TotalHoursOnTask <= SLAInHours` compliance, `SLAAdjustedDate IS NULL OR DateCompleted <= SLAAdjustedDate` adjusted-deadline check. This ensures the 7-Day Trend chart, Compliance · Last N days chart, and 7-day Avg stats table all match the values shown on the team performance cards.

---

## 6. Dashboard Teams

The dashboard maps **9 defined teams** identified via `ConfigTasks.UsedForKPI = 1` and `ConfigTasks.SpecifiedKPIGrp` LIKE patterns, plus optional **dynamic teams** auto-discovered from the database.

| id | Dashboard Name | Department | SLA Target | kpiGrp pattern | Fallback Department |
|----|---------------|------------|------------|----------------|---------------------|
| 1 | Data Entry | Origination | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Data%Entry%'` | `fallbackDeptId=101` |
| 2 | Valuations | Origination | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Valuation%'` | `fallbackDeptId=110` |
| 3 | Assessments | Credit | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Assessment%'` | *no fallback — KPI-tagged tasks exist in DB* |
| 4 | Packaging & QA | Credit | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Packaging%' OR ct.SpecifiedKPIGrp LIKE N'%QA%'` | `fallbackDeptId=122` |
| 5 | CLA | Credit | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%CLA%'` | *no fallback — KPI-tagged tasks exist in DB* |
| 6 | Funder Submission | Credit | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Funder%Submission%'` | *no fallback — KPI-tagged tasks exist in DB* |
| 7 | Funder MIR | Credit | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Funder%MIR%'` | *no fallback — KPI-tagged tasks exist in DB* |
| 8 | Settlement | Settlement | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Settlement%'` | *no fallback — KPI-tagged tasks exist in DB* |
| 9 | Ezy Client Care | Client Care | 4 hours | `ct.SpecifiedKPIGrp LIKE N'%Client%Care%'` | `fallbackDeptId=10` |

> **UPDATED 2026-06-25** — Refactored from 8 teams (DepartmentId/REPORT_Loans_Extension) to 9 teams using `ConfigTasks.UsedForKPI`/`SpecifiedKPIGrp`.
> **UPDATED 2026-06-30** — Two-tier classification: kpiGrp-primary WHENs now fire **first** (explicit SpecifiedKPIGrp match wins); DeptId-primary WHENs are the fallback for unclassified tasks.
> **UPDATED 2026-07-01** — Fallback `DepartmentId` added only for teams with **no** `UsedForKPI=1` records in the DB (Data Entry → 101, Valuations → 110, Packaging & QA → 122, Ezy Client Care → 10). Teams that already have KPI-tagged records (Assessments, CLA, Funder Submission, Funder MIR, Settlement) intentionally have **no** dept fallback — counts stay to the explicitly-tagged tasks only, avoiding inflation from unrelated dept staff work. Valuations kpiGrp broadened to `LIKE N'%Valuation%'` (Pre‑ exclusion removed). Fallback (Rule 2) tightened to require `ct.UsedForKPI IS NULL` **and** `ct.SpecifiedKPIGrp IS NULL/empty`.

> **GROUPING PRIORITY (source of truth — updated 2026-07-01):** Every team / group calculation across the dashboard (team cards, All Teams, SLA / Volume / TAT / Overdue metrics, charts, legends, drill-throughs, popups, tables, filters, aggregates) follows this exact two-step rule:
>
> 1. **Rule 1 — KPI group (PRIORITY):** If a task has `ct.UsedForKPI = 1` **AND** `ct.SpecifiedKPIGrp` is non-null and non-empty (after `LTRIM`/`RTRIM`), it is grouped by `SpecifiedKPIGrp` (static team pattern match, or auto-discovered dynamic team). Card / table / drill-through labels use `SpecifiedKPIGrp`.
> 2. **Rule 2 — Department FALLBACK:** Only tasks where **`ct.UsedForKPI IS NULL` AND `ct.SpecifiedKPIGrp IS NULL/empty`** fall back to `s.DepartmentId`. Fallback requires `s.EmployeeStatus = 1`.
>
> Rule 1 and Rule 2 are mutually exclusive by construction, so a task is **never counted twice**. Any task that satisfies neither rule (e.g. `UsedForKPI=1` with a non-matching kpiGrp, or `UsedForKPI IS NULL` with a non-null kpiGrp) is **excluded entirely** — it does not pollute dept fallback counts.
>
> **Automatic recalculation:** All calculations reflect the current state of `ConfigTasks` on the next cache refresh (5-min TTL) — no code or config change is required. When a task moves from `(UsedForKPI IS NULL + kpiGrp IS NULL)` into `(UsedForKPI=1 + kpiGrp populated)`, it stops being counted under its dept fallback team and starts being counted under its `SpecifiedKPIGrp` team; the reverse is also automatic.
>
> SQL CASE precedence enforces this naturally — Rule 1 WHENs are listed first (all 9 static teams + any dynamic teams), Rule 2 WHENs are listed second (only for teams with a `fallbackDeptId`). A task always matches **at most one** WHEN.

**Dynamic teams (auto-discovery):**
- **Whenever a `ConfigTasks` row has `UsedForKPI = 1` and a non-null, non-empty `SpecifiedKPIGrp` value that does not match any of the 9 defined team patterns, the dashboard automatically surfaces that group as a new team card with full KPI data — no code changes or config edits required.**
- Discovery runs at backend startup and on every 5-minute teams cache refresh (`refreshDynamicGroups()` called at the start of `fetchTeamsData()`).
- Group names are normalized via `LTRIM`/`RTRIM` in SQL and `.trim()` in JS before use, so leading/trailing whitespace differences in the DB do not create duplicate cards.
- IDs start at 100, sorted alphabetically for stability (e.g., first new group = id 100, second = 101).
- Card name = trimmed `SpecifiedKPIGrp` value from the database.
- Dynamic team cards appear **after "Ezy Client Care"** (after id=9) in all views.
- KPI calculations (volume, SLA %, avg TAT, overdue, deltas, history, alerts) follow the same logic as static teams — scoped to `LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'<name>'`.
- Default SLA target = 4 hours; users can override via Settings after the card appears.

**Backend implementation:** `TEAMS` array and helper functions in `backend/server.js`.
- `TEAMS` (static array, 9 entries): each team has `{ id, name, dept, target, kpiGrp, fallbackDeptId }`.
- `_dynamicTeams` (runtime array): populated by `refreshDynamicGroups()`, same shape as TEAMS entries plus `isDynamic: true`.
- `getAllTeams()`: returns `[...TEAMS, ..._dynamicTeams]` — used in all SQL building and result mapping.
- `getTeamIdCase()`: builds SQL CASE for team id (all static + dynamic teams).
- `getTeamNameCase()`: builds SQL CASE for team name (all static + dynamic teams).
- **Team classification — two-tier system (2026-06-30):** Teams are split into two types based on whether `fallbackDeptId` is set in the `TEAMS` array:
  - **DeptId-primary** (ids 1, 2, 4, 9 — `fallbackDeptId` set): `WHEN s.DepartmentId = N AND s.EmployeeStatus = 1` fires **first** in `getTeamIdCase()` / `getTeamNameCase()`. All tasks assigned to staff in that department are captured regardless of `SpecifiedKPIGrp`. Current DeptIds: Data Entry=101, Valuations=110, Packaging & QA=122, Ezy Client Care=10.
  - **kpiGrp-primary** (ids 3, 5, 6, 7, 8 — no `fallbackDeptId`): Only `UsedForKPI=1` tasks whose `SpecifiedKPIGrp` matches the kpiGrp pattern are counted. `Staff.DepartmentId` is never used for classification.
  - **Dynamic teams** (ids 100+): Always kpiGrp-primary — exact `SpecifiedKPIGrp` match only, no fallback.
- **`getTeamIdCase()` / `getTeamNameCase()` WHEN order (updated 2026-06-30 — grouping priority):** Rule 1 (kpiGrp pattern) WHENs fire **first** for both kpiPrimary and deptPrimary teams: `WHEN ct.UsedForKPI = 1 AND <kpiGrp pattern> THEN <id>`. Rule 2 (DeptId fallback) WHENs fire **second** and apply only when `SpecifiedKPIGrp` is NULL/empty: `WHEN (ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'') AND s.DepartmentId = <N> AND s.EmployeeStatus = 1 THEN <id>`. Rule 2 does **not** require `ct.UsedForKPI = 1` — it captures tasks where both `UsedForKPI` and `SpecifiedKPIGrp` are NULL (typical of unclassified/legacy tasks). The two rules together never double-count because the WHEN conditions are mutually exclusive (Rule 1 requires non-empty kpiGrp, Rule 2 requires NULL/empty kpiGrp).
- `TEAM_FILTER` constant: `((ct.UsedForKPI = 1) OR ((ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'') AND s.DepartmentId IN (<fallbackDeptIds>) AND s.EmployeeStatus = 1))` — admits Rule 1 tasks via the first branch and Rule 2 fallback candidates via the second branch. The `<fallbackDeptIds>` list is built dynamically from `TEAMS.filter(t => t.fallbackDeptId)`. Tasks with non-NULL `SpecifiedKPIGrp` that don't match any Rule 1 pattern are filtered out entirely — they are not assigned to any team.
- `CONFIG_TASKS_JOIN` constant: `LEFT JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId` — injected into all aggregate queries.
- The `?team=<id>` query param on `/api/tasks` and `/api/alert-tasks/:teamId` accepts team id 1–9 (static) or 100+ (dynamic); all routed through `getAllTeams().find(...)`.
- `TEAM_COLORS` in `constants.js`: Proxy object — 9 known names return `var(--t1)…var(--t9)`; unknown names (dynamic teams) return colors from `_DYNAMIC_PALETTE` (`#1F7A8C`, `#B5446E`, `#556B2F`, `#8B4513`, `#4169E1`, `#8B008B`), assigned by order of first lookup.
- CSS vars in `styles.css`: `--t1:#0F9ED5` `--t2:#4EA72E` `--t3:#E97132` `--t4:#0E2841` `--t5:#7E350E` `--t6:#F6508F` `--t7:#7030A0` `--t8:#C00000` `--t9:#808080`
- **Exact team order and hex colors (authoritative):**
  | # | Team Name | Hex Color |
  |---|-----------|-----------|
  | 1 | Data Entry | `#0F9ED5` |
  | 2 | Valuations | `#4EA72E` |
  | 3 | Assessments | `#E97132` |
  | 4 | Packaging & QA | `#0E2841` |
  | 5 | CLA | `#7E350E` |
  | 6 | Funder Submission | `#F6508F` |
  | 7 | Funder MIR | `#7030A0` |
  | 8 | Settlement | `#C00000` |
  | 9 | Ezy Client Care | `#808080` |
- Chart lines `strokeWidth="2.5"`; dots `r=4` (hover `r=6`) in both `trend.jsx` and `history-chart.jsx`

---

## 7. Recommended Architecture

```
[Browser]
    ↕  HTTP / REST API
[Node.js + Express backend]  ← /backend/server.js
    ↕  mssql driver
[SQL Server — SEReport database]
```

- **Frontend:** React 19 + Vite (already set up in `/frontend`)
- **Backend:** Node.js + Express + mssql (already set up in `/backend`)
- **Database:** SQL Server, database name `SEReport`
- **Communication:** Frontend calls backend REST API; backend queries SQL Server
- **No direct database access from browser** — always go through backend API

---

## 8. Codebase Inventory

### Backend (`/backend/`)

| File | Status | Notes |
|------|--------|-------|
| `server.js` | **Complete** | All endpoints live with real SQL: `/api/health`, `/api/kpi-summary`, `/api/teams`, `/api/tasks`, `/api/history`, `/api/alerts`. KPI deltas and per-team deltas implemented. |
| `db.js` | Complete | SQL Server connection using environment variables — ready to use |
| `package.json` | Complete | Has: express, mssql, cors, dotenv |
| `.env` | **Present** | Credentials configured: server `DESKTOP-HGGDDCR`, DB `MySEReport`, user `ntruong`, port 1433 |

### Frontend — Source Components (`/frontend/src/`)

| File | Status | Notes |
|------|--------|-------|
| `App.jsx` | Stub / prototype | Simple table view — replace with full dashboard routing |
| `api.js` | Stub | Only one function (`getSlaSummary`) — expand for all endpoints |
| `components/components.jsx` | **Reusable** | KpiTile, TeamCard, AlertsPanel, TaskRow, TaskModal — production quality |
| `components/views.jsx` | **Reusable** | All 6 views + StaffListView + AdminView — just needs live data props |
| `components/history-chart.jsx` | **Reusable** | SVG multi-line chart with hover, tooltips, range support |
| `components/trend.jsx` | **Reusable** | SVG 7-day trend chart; Y-axis fixed 60%–100%, gridlines at 60/70/80/90/100%; X-axis business days only (Mon–Fri) |
| `components/icons.jsx` | **Reusable** | 20 SVG icon components |

### Frontend — Mock Data (`/frontend/data/`)

| File | Status | Notes |
|------|--------|-------|
| `data.js` | Mock data only | Replace with API calls — contains: TEAMS_BASE, TREND_DATA, ALERTS, TASKS |
| `history.js` | Mock data only | Replace with API call — generates fake 180-day history |

### Frontend — Prototypes (`/frontend/`)

| File | Status | Notes |
|------|--------|-------|
| `SLA Dashboard - source.html` | Prototype | Standalone HTML with all features — reference only |
| `SLA Dashboard - Standalone.html` | Prototype | Another standalone version — reference only |
| `SLA Dashboard.html` | Prototype | Another version — reference only |
| `styles.css` | Reusable | Main stylesheet for the dashboard |
| `styles-views.css` | Reusable | Styles for individual views |

---

## 9. SQL Server Schema — Key Tables

### Tables Used for Dashboard

| Table | Purpose | Important Columns |
|-------|---------|------------------|
| `Tasks` | Main work unit tracked for SLA | TaskID, ConfigTaskId, TaskName, TaskStatusID, AssignedTo, SLAInHours, SoEzySLA, SoEzySLA_BH, TotalHoursOnTask, TotalHoursOnTask_BH |
| `TaskRelation` | Task time tracking | TaskRelationID, TaskID, TotalHoursOnTask, TotalHoursOnTask_BH, SLARemaining |
| `ConfigQueue` | Team / queue lookup | QueueId, QueueName |
| `ConfigTaskStatus` | Task status values | ConfigTaskStatusID, TaskStatus |
| `ConfigSLA` | SLA configuration | SLAId, SLAName, SLADescription |
| `ConfigSLACheckPointType` | SLA checkpoint types | ConfigSLACheckPointTypeID, CheckPointType |
| `Issues` | Issues/problems per loan | Issuesid, ApplicationID, ShortDescription, Queue, Status, Priority |
| `Milestone` | Loan stage milestones | MileStoneId, MStatusID, Queue, Function, Status |
| `Staff` | Staff lookup | StaffID, FirstName, DepartmentId |
| `Department` | Department names | DepartmentId, Description |
| `ConfigLoanStatus` | Loan status config | contains ConfigSLACheckPointTypeID |
| `Loans` | Loan milestones (used by `/api/loan-summary`) | ApplicationID (int), LoanAmount (decimal), Date_ApplicationReceived (datetime), Date_FunderApproval (datetime), Date_Settled (datetime) |

### SLA-Specific Fields in Tasks

| Field | Meaning |
|-------|---------|
| `SLAInHours` | SLA target in hours for this task type |
| `SoEzySLA` | SLA tracking value from the So Ezy system |
| `SoEzySLA_BH` | Business-hours variant of SLA |
| `TotalHoursOnTask` | Actual time spent on task (calendar hours) |
| `TotalHoursOnTask_BH` | Actual time spent (business hours only) |
| `SLARemaining` | Remaining SLA time (in TaskRelation table) |
| `IsSLACheckPointOnHold` | Whether SLA is paused at a checkpoint (in ConfigLoanStatus) |

---

## 10. Schema-to-UI Mapping

> **CONFIRMED — 2026-06-02.** All queries verified against live `MySEReport` database. Logic aligns with SLA_Dashboard_Work_Scope.docx.
> All metrics scoped to `DateCreated = today` (sargable range). All deltas use `DateCreated = prevBizDay`, same per-metric status filters.
> **No `DateCompleted` usage** — all date scoping uses `DateCreated` only.
> TODAY fixed as `'2026-05-28'` (last date with data in backup snapshot).

```sql
-- ── /api/kpi-summary — single query, today + prev biz day in one scan ────────
SELECT
  -- Total Active Tasks: open tasks created today
  SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
           AND TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END)            AS totalTasks,

  -- Overdue: open tasks created today that exceeded SLA target
  SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
           AND TaskStatusID IN (1,4,5,6)
           AND TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END)        AS totalOverdue,

  -- SLA %: completed tasks within target ÷ total completed × 100 (spec formula)
  CAST(SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
               AND TaskStatusID = 2
               AND TotalHoursOnTask <= SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
                      AND TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS overallSla,

  -- Avg TAT: mean across all tasks created today (active + completed)
  AVG(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
           THEN TotalHoursOnTask ELSE NULL END)                         AS avgTat,

  -- ── Same 4 metrics for prev biz day (2026-05-27) — used for delta arrows ──
  SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28'
           AND TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END)            AS prevTasks,
  SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28'
           AND TaskStatusID IN (1,4,5,6)
           AND TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END)        AS prevOverdue,
  CAST(SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28'
               AND TaskStatusID = 2
               AND TotalHoursOnTask <= SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28'
                      AND TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS prevSla,
  AVG(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28'
           THEN TotalHoursOnTask ELSE NULL END)                         AS prevTat

FROM Tasks t WITH (NOLOCK)
WHERE TaskStatusID IN (1, 2, 4, 5, 6)
  AND FunctionID IN (SELECT FunctionID FROM ConfigFunction WITH (NOLOCK)
                     WHERE QueueID IN (1,2,3,4,5,6,8,28,44,46,47))
  AND DateCreated >= '2026-05-27' AND DateCreated < '2026-05-29'


-- ── /api/teams — 2 queries run in Promise.all ─────────────────────────────────

-- Query 1: main team card stats (volume, sla, avgTat, overdue) scoped to today
SELECT
  CASE <TEAM_ID_CASE> END AS teamId,
  -- volume: active tasks only
  SUM(CASE WHEN TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END)           AS volume,
  -- sla: completed tasks within target ÷ total completed × 100
  CAST(SUM(CASE WHEN TaskStatusID = 2 AND TotalHoursOnTask <= SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS sla,
  -- avgTat: all tasks
  AVG(TotalHoursOnTask)                                                 AS avgTat,
  -- overdue: open tasks past SLA target
  SUM(CASE WHEN TaskStatusID IN (1,4,5,6) AND TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END) AS overdue
FROM Tasks t WITH (NOLOCK)
INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
WHERE TaskStatusID IN (1, 2, 4, 5, 6)
  AND cf.QueueID IN (1,2,3,4,5,6,8,28,44,46,47)
  AND DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29'
GROUP BY CASE <TEAM_ID_CASE> END

-- Query 2: delta values for all 4 team metrics (today vs prev biz day)
SELECT
  CASE <TEAM_ID_CASE> END AS teamId,
  SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29' AND TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
  SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28' AND TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
  SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29' AND TaskStatusID IN (1,4,5,6) AND TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END) AS todayOverdue,
  SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28' AND TaskStatusID IN (1,4,5,6) AND TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END) AS prevOverdue,
  CAST(SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29' AND TaskStatusID = 2 AND TotalHoursOnTask <= SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29' AND TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
  CAST(SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28' AND TaskStatusID = 2 AND TotalHoursOnTask <= SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28' AND TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS prevSla,
  AVG(CASE WHEN DateCreated >= '2026-05-28' AND DateCreated < '2026-05-29' THEN TotalHoursOnTask ELSE NULL END) AS todayTat,
  AVG(CASE WHEN DateCreated >= '2026-05-27' AND DateCreated < '2026-05-28' THEN TotalHoursOnTask ELSE NULL END) AS prevTat
FROM Tasks t WITH (NOLOCK)
INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
WHERE TaskStatusID IN (1, 2, 4, 5, 6)
  AND cf.QueueID IN (1,2,3,4,5,6,8,28,44,46,47)
  AND DateCreated >= '2026-05-27' AND DateCreated < '2026-05-29'
GROUP BY CASE <TEAM_ID_CASE> END
```

| UI Element | Field | Status filter | Post-processing |
|-----------|-------|---------------|-----------------|
| Total Active Tasks KPI | `totalTasks` | `IN (1,4,5,6)` active only | As-is integer |
| Overall SLA% (only Completed tasks) KPI | `overallSla` | `= 2` completed only | `toFixed(2)` → 2 decimal % |
| Avg Turnaround KPI | `avgTat` | `IN (1,4,5,6)` active only | `>= 24h` → days (1dp); else hours (1dp) |
| Overdue (only Active tasks) KPI | `totalOverdue` | `IN (1,4,5,6)` active only | As-is integer |
| Team Volume | `volume` | `IN (1,4,5,6)` active only | As-is integer |
| SLA% (only Completed tasks) | `sla` | `= 2` completed only | `Math.round()` → integer % |
| Team Avg TAT | `avgTat` | `IN (1,4,5,6)` active only | 1dp hours |
| Team Overdue | `overdue` | `IN (1,4,5,6)` active only | As-is integer |

---

## 11. Planned API Endpoints

| Endpoint | Method | Returns | Used By |
|----------|--------|---------|---------|
| `/api/health` | GET | `{ status: 'OK' }` | Health check |
| `/api/db-test` | GET | Table columns + queue names | Diagnostic — remove after setup |
| `/api/kpi-summary` | GET | `{ totalTasks, overallSla, avgTat, totalOverdue, deltas: { totalTasks, overallSla, avgTat, totalOverdue, today, prevBizDay } }` | Dashboard KPI tiles |
| `/api/teams` | GET | Array of team objects: `{ id, name, dept, target, volume, sla, avgTat, overdue, deltas: { volume, sla, avgTat, overdue } }` | Teams view + Dashboard cards |
| `/api/tasks` | GET | Array of tasks (query params: `?team=&status=`) | Tasks view |
| `/api/history` | GET | `{ dates[], byTeam: { teamId: [sla%] } }` (param: `?range=7d`) | Reports view |
| `/api/alerts` | GET | Array of alerts generated from breach rules | Alerts view + Dashboard panel |
| `/api/loan-summary` | GET | `{ received, approved, settled }` — each: `{ count, amount, deltas: { count, amount }, deltas5: { count, amount } }`. Count of loans + total `LoanAmount` for `Date_ApplicationReceived`, `Date_FunderApproval`, `Date_Settled` today vs prev biz day and vs 5 business days ago. | Dashboard loan strip |
| `/api/loan-detail/:type` | GET | `[{ ApplicationID, FunderName, LoanAmount }]` — filtered to today for `type = received \| approved \| settled`. Returns rows sorted by `LoanAmount DESC`. 400 on invalid type, 500 on DB error. | `LoanModal` drill-down |
| `/api/staff/departments` | GET | `[{ departmentId, departmentName, totalStaff }]` — all departments with active staff count (`EmployeeStatus = 1`), ordered high → low. DepartmentId IS NOT NULL filter applied. | StaffListView summary table |
| `/api/staff/absent-today` | GET | `[{ staffId, fullName, departmentName, workStatusName, startedTime, endedTime }]` — all staff absent today (`ConfigWorkStatus.IsAbsent = 1`) where `WorkStatusHistory.StartedTime` is in today range (`>= today` and `< next day`). | StaffListView “Absent Today” table |
| `/api/staff/department/:id` | GET | `[{ staffId, fullName, employeeStatus, isGroup }]` — active staff (EmployeeStatus=1, non-null name) in one department, ordered by name. | StaffListView drill-through modal |
| `/api/admin/users` | GET | `[{ id, email, companyName, role, status, createdAt }]` — status: `approved`. **Admin JWT required.** | AdminView user list |
| `/api/admin/users/:id` | DELETE | `{ message }` — removes user from `DashboardAccess` and `ConfigReportUsers`. **Admin JWT required.** | AdminView Remove button |
| `/api/auth/forgot-password` | POST | `{ token, expiresIn }` — generates a 1-hour reset token stored in DB, returns it directly (no email infra). 404 if email not found/not approved. | Login "Lost password" flow |
| `/api/auth/reset-password` | POST | `{ message }` — validates token, checks expiry, updates `PasswordHash`, clears token. 400 on invalid/expired token. | Login "Set new password" form |

> **Signup note (2026-06-26):** `/api/auth/signup` no longer requires `companyName`. Only `email` and `password` are required. User identity is tied to a matching active `Staff` record by email address.

---

## 12. Mismatches Between Prototype and Schema

| Mismatch | Detail |
|---------|--------|
| Team IDs | Dashboard uses string IDs (`'data-entry'`, `'valuations'`) — schema uses integer `QueueId` |
| History data | No daily SLA history table found — must aggregate from Tasks with date columns |
| Alerts | Dashboard shows rule-based alerts but no alerts table in schema — must generate from breach thresholds in backend |
| Client names | Tasks in prototype show client names — Tasks table links to clients via `ApplicationID` → Applications → Borrowers (multi-join required) |
| SLA target source | Prototype hardcodes 4h for all teams — real targets may vary per queue in `ConfigSLA` |

---

## 13. Assumptions

1. **CONFIRMED:** Teams map to `QueueId` values in `ConfigQueue` — via `Tasks → ConfigFunction → QueueID` join (not direct). See Section 6 for full mapping.
2. **CONFIRMED:** A task is "within SLA" when `TotalHoursOnTask <= SLAInHours` (both columns confirmed present in Tasks table).
3. **CONFIRMED:** Active tasks = `TaskStatusID IN (1,4,5,6)` (InProgress, OnHold, OnQueue, NotQueued). Completed = `TaskStatusID = 2`.
4. **CONFIRMED:** Tasks links to ConfigQueue via `Tasks.FunctionID → ConfigFunction.FunctionID → ConfigFunction.QueueID`.
5. **CONFIRMED:** Tasks table has `DateCreated` and `DateCompleted` columns (both used in delta queries).
6. **CONFIRMED:** SLA target hardcoded as 4 hours for all 6 teams (set in `TEAMS` constant in `server.js`). Real ConfigSLA values not yet checked.
7. **CONFIRMED:** Backend runs on `DESKTOP-HGGDDCR` same machine as SQL Server.

---

## 14. Resolved Questions

| # | Question | Resolution |
|---|---------|------------|
| 1 | QueueName values in ConfigQueue? | RESOLVED — 6 teams mapped to QueueIds (see Section 6). Join is via `ConfigFunction.QueueID`. |
| 2 | Tasks table QueueID/Queue column? | RESOLVED — Tasks links via `FunctionID → ConfigFunction → QueueID`. |
| 3 | DateCreated / DateCompleted columns? | RESOLVED — both confirmed present and used in delta queries. |
| 4 | Active/open TaskStatusID values? | RESOLVED — active: `IN (1,4,5,6)`, completed: `= 2`. |
| 5 | SLA target from ConfigSLA or hardcoded? | RESOLVED (partial) — hardcoded 4h for all teams. ConfigSLA values not yet checked. |
| 6 | SLAInHours or SoEzySLA for compliance? | RESOLVED — using `TotalHoursOnTask <= SLAInHours` (confirmed working in live queries). |
| 7 | SQL Server connection details? | RESOLVED — server `DESKTOP-HGGDDCR`, DB `MySEReport`, user `ntruong`, port 1433. |
| 8 | Drill-through modal showing summary stats but no task rows? | RESOLVED (2026-06-17) — Bug was TEAM_ID_CASE SQL expression precedence. When tasks matched both a DepartmentId AND a ConfigLoanStatus, the dept filter was checked first, causing wrong QueueId assignment. Fixed by reordering CASE conditions: loan_status filters first (teams 5-6), then dept filters (teams 1-4,7-8). Verified end-to-end: `/api/tasks?team=6` now returns 7 Funder Submission tasks with QueueId=6, and modal renders all 7 rows correctly. |

---

## 15. Remaining Work

1. ~~**`.env` file**~~ — **DONE** (credentials configured: `DESKTOP-HGGDDCR`, `MySEReport`, `ntruong`).

2. ~~**Column confirmation**~~ — **DONE** (all columns verified via live queries).

3. ~~**Real API endpoints**~~ — **DONE** (all 6 endpoints live with SQL Server queries).

4. ~~**Frontend data wiring**~~ — **DONE** (App.jsx uses live `/api/` calls; `data.js`/`history.js` mocks are bypassed).

5. **Routing** — `App.jsx` does not yet use React Router. Views are toggled by state. Full routing not yet implemented.

6. **`react-router-dom`** — Not yet installed. Run `cd frontend && npm install react-router-dom` when routing is needed.

7. ~~**`TODAY_FIXED` hardcoded date**~~ — **DONE** (2026-06-19). Replaced with dynamic `resolveEffectiveDate()` that queries `MAX(DateCreated)` from `Tasks` on startup and every 60 min. `todayLocal()` returns `_effectiveDate` (set by the resolver) or falls back to the real system date. All calculations use the reporting date automatically. See Section 28.

8. ~~**Loan summary strip**~~ — **DONE** (`/api/loan-summary` + `LoanKpiTile` component, 3 cards above KPI row with count, total amount, and deltas).

9. ~~**Loan drill-down modal**~~ — **DONE** (`/api/loan-detail/:type` endpoint, `getLoanDetail` in `api.js`, `LoanModal` component, click handlers on all 3 loan cards; same UX pattern as `TaskModal`).

10. ~~**Loan Targets in Settings**~~ — **DONE** (new "Loan Targets" section above "SLA Targets per Team"; 3 number inputs persisted in `localStorage` as `settings.loanTargets`; target badge shown top-right of each `LoanKpiTile`).

---

## 16. Implementation Phases

### Phase 1 — Environment Setup
- [x] Create `/backend/.env` with SQL Server credentials
- [x] Run `cd backend && npm install`
- [x] Test DB connection: `node server.js` → call `/api/health`
- [x] Add `/api/db-test` endpoint and confirm Tasks columns + ConfigQueue names

### Phase 2 — Core API
- [x] Write SQL query for team metrics grouped by Queue
- [x] Create `/api/teams` endpoint (includes per-team deltas)
- [x] Write SQL query for dashboard KPI totals
- [x] Create `/api/kpi-summary` endpoint (includes KPI deltas vs prev biz day)
- [x] Create `/api/tasks` endpoint with optional team/status filters

### Phase 3 — Frontend Integration
- [ ] Install React Router: `cd frontend && npm install react-router-dom`
- [ ] Rewrite `App.jsx` with routing to all 6 views
- [x] Expand `api.js` with functions for each new endpoint
- [x] Wire API data into existing components (live data from `/api/` endpoints)
- [x] Add loading spinners and error messages

### Phase 4 — History & Reports
- [x] Write daily SLA aggregation SQL query
- [x] Create `/api/history` endpoint
- [ ] Replace `history.js` mock with live API call in ReportsView

### Phase 5 — Alerts & Polish
- [x] Create `/api/alerts` endpoint (rule-based from breach thresholds)
- [ ] Final end-to-end testing with real data
- [ ] Verify all view filters work correctly
- [x] ~~`TODAY_FIXED` hardcoded~~ — replaced with `resolveEffectiveDate()` (dynamic MAX DateCreated from DB)

### Phase 6 — Loan Strip & Drill-down (2026-06-03)
- [x] Add `/api/loan-summary` endpoint — count + total `LoanAmount` for received/approved/settled, with deltas vs prev biz day
- [x] Add `/api/loan-detail/:type` endpoint — returns `[{ ApplicationID, FunderName, LoanAmount }]` for today, sorted by amount DESC
- [x] Add `getLoanSummary` and `getLoanDetail` to `api.js`
- [x] Add `LoanKpiTile` component — card with count, total amount, deltas, configurable target badge top-right, click-to-open drill-down
- [x] Add `LoanModal` component — same overlay/modal UX as `TaskModal`; summary chips (Applications count + Total Loan Amount); table of `ApplicationID`, `FunderName`, `LoanAmount`
- [x] Wire `loanSummary` state + `openLoanModal`/`closeLoanModal` callbacks into `App.jsx`
- [x] Add **Loan Targets** section to `SettingsView` (above "SLA Targets per Team") with 3 inputs (Application Received, Funder Approvals, Settlements); defaults `{ received: 10, approved: 10, settled: 10 }`; persisted in `localStorage` via existing `applySettings` flow

---

## 17. Validation Checklist

- [x] `/api/health` returns `{ status: 'OK' }`
- [x] `/api/teams` returns teams with correct QueueId mapping
- [x] KPI numbers confirmed reasonable against live DB
- [x] Delta indicators showing on all 4 KPI tiles and all 6 team cards
- [x] Team SLA % calculation verified — matches spec formula (completed within target ÷ total completed × 100)
- [ ] Tasks list loads and filters work (by team and status)
- [ ] History trend shows correct dates and SLA values
- [ ] All 6 views render without JavaScript errors
- [ ] Alerts are generated when SLA thresholds are breached
- [ ] All SQL queries use parameterized inputs (no SQL injection risk — currently using template literals with hardcoded date strings only)

---

## 18. Suggested First Implementation Task

**Add a diagnostic endpoint to confirm database structure:**

Add this to `/backend/server.js` temporarily:

```javascript
app.get('/api/db-test', async (req, res) => {
  try {
    const pool = await connectDB();
    const queues = await pool.request().query(
      'SELECT QueueId, QueueName FROM ConfigQueue ORDER BY QueueId'
    );
    const taskCols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Tasks'
      ORDER BY ORDINAL_POSITION
    `);
    const statuses = await pool.request().query(
      'SELECT ConfigTaskStatusID, TaskStatus FROM ConfigTaskStatus'
    );
    res.json({
      queues: queues.recordset,
      taskColumns: taskCols.recordset,
      taskStatuses: statuses.recordset
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

Then call `http://localhost:5000/api/db-test` in a browser. The response will answer Open Questions 1, 2, 3, and 4, and unblock all subsequent development work.

---

## 19. Recommended Project Structure (Target State)

```
SLA Dashboard/
├── CLAUDE.md                   ← This file
├── backend/
│   ├── .env                    ← CREATE (DB credentials, never commit to git)
│   ├── db.js                   ← Complete — ready to use
│   ├── server.js               ← Expand with real endpoints
│   ├── package.json            ← Complete
│   └── routes/                 ← Optional: split endpoints into separate files
│       ├── teams.js
│       ├── tasks.js
│       ├── kpi.js
│       ├── history.js
│       └── alerts.js
├── frontend/
│   ├── src/
│   │   ├── App.jsx             ← REWRITE with router + live data
│   │   ├── api.js              ← EXPAND with all endpoint calls
│   │   ├── main.jsx            ← Keep as-is
│   │   └── components/
│   │       ├── components.jsx  ← Keep as-is (production quality)
│   │       ├── views.jsx       ← Keep as-is (all 6 views ready)
│   │       ├── history-chart.jsx ← Keep as-is
│   │       ├── trend.jsx       ← Keep as-is
│   │       └── icons.jsx       ← Keep as-is
│   ├── data/
│   │   ├── data.js             ← DELETE after Phase 3
│   │   └── history.js          ← DELETE after Phase 4
│   ├── styles.css              ← Keep
│   ├── styles-views.css        ← Keep
│   └── package.json            ← Add react-router-dom
├── sql/
│   └── SEReport_schema.sql     ← Reference only
└── docs/
    └── SLA_Dashboard_Work_Scope.docx ← Reference only
```

---

## 20. Tech Stack Summary

| Layer | Technology | Version | Status |
|-------|-----------|---------|--------|
| Frontend framework | React | 19.2.6 | Installed |
| Frontend build | Vite | 8.0.12 | Installed |
| Frontend routing | React Router DOM | — | **Not yet installed** (views toggled by state) |
| Backend framework | Express | 5.2.1 | Installed |
| Database driver | mssql | 12.5.4 | Installed |
| Environment config | dotenv | 17.4.2 | Installed |
| CORS handling | cors | 2.8.6 | Installed |
| Database | SQL Server | — | **Live** — `DESKTOP-HGGDDCR`, DB `MySEReport`, port 1433 |

---

## 21. UI Implementation Rules

> Rules discovered through iterative development. Follow these to avoid rework.

### Match Provided HTML Samples Exactly
- When the user provides an HTML sample, reference design, or screenshot — **reproduce it exactly**: same structure, class names, element order, text, and layout.
- Do **not** redesign, "improve", or modernize the provided sample. If a change is not explicitly requested, do not make it.
- Treat provided HTML as a specification, not a suggestion.

### CSS Color Semantics (Delta Indicators)
- Delta values use directional color: `up` class = red (`var(--bad)`) = getting worse; `down` class = green (`var(--ok)`) = getting better.
- Exception: Volume delta uses `neutral` class (muted grey) — volume change is informational, not inherently good or bad.
- Delta is hidden when value is exactly `0` (returns `null` from `fmtD()`).

### Delta Calculation Pattern
- KPI-level deltas: `today value − prevBizDay value`.
- All deltas use `DateCreated` — **never `DateCompleted`**.
- Per-metric status filters are the same for deltas as for main values:
  - `totalTasks` delta → `DateCreated IN (today, prev)` + `TaskStatusID IN (1,4,5,6)`
  - `overallSla` delta → `DateCreated IN (today, prev)` + `TaskStatusID = 2`
  - `avgTat` delta → `DateCreated IN (today, prev)` + all statuses
  - `totalOverdue` delta → `DateCreated IN (today, prev)` + `TaskStatusID IN (1,4,5,6)`
- Team-card deltas: same logic — `volume/overdue` use active filter; `sla` uses completed filter; `avgTat` uses all.
- Dates computed dynamically on every cache refresh via `todayLocal()` + `computeDates()` in `server.js`. No hardcoded date strings. Uses local clock parts (not UTC) to avoid AEST off-by-one. `prevBizDay()`: Mon→−3d (Fri), Sun→−2d (Fri), else −1d.
- Sargable date range pattern: `col >= 'YYYY-MM-DD' AND col < 'next-day'` — never `CAST(col AS DATE) = 'date'` (non-sargable, blocks index seek).

### Cache / Performance Pattern
- `fetchKpiData()` and `fetchTeamsData()` results cached in `_cache` object with 5-minute TTL.
- Stale-while-revalidate: if cached data exists but is stale, serve it immediately and refresh in background.
- Pre-warmed on server startup in `app.listen` callback — fires both fetches before any user request arrives.
- Root cause of original 60s timeout: cold SQL Server buffer cache after restart → ~115s disk I/O on 1M-row Tasks scan. CPU was only 623ms; all extra time was I/O wait.
- `requestTimeout` in `db.js` set to **180000ms** (3 min) to survive cold-start scans. Warm queries: ~165ms.

### Sidebar Layout Rule
- Sidebar must stay `position: sticky`, NOT `position: fixed`.
- Sidebar is in CSS Grid column 1 (88px wide). Using `fixed` removes it from document flow, collapsing `.main` to 88px.

### Component Stability Rule
- `components/components.jsx`, `views.jsx`, `history-chart.jsx`, `trend.jsx`, `icons.jsx` are production-quality and stable.
- Make targeted additions only; do not refactor structure unless explicitly asked.

### Team Card Group Label & Tooltip Rule

Each Team Performance card shows a small label above the team name indicating the classification tier, and an ⓘ `InfoTip` immediately to the right of the **team name** (not the label).

**Label (`div.card-dept`):** text only, no icon.
- `team.fallbackDeptId` is set → `"Department Group"`
- `team.fallbackDeptId` is null/undefined → `"KPI Group"`

**InfoTip placement:** inside `<h3 className="card-team">`, after `{team.name}`.

**Tooltip text (`groupTooltip`):**
| Team type | Tooltip content |
|-----------|----------------|
| Department Group | `All tasks from {team.name} - Dept {team.fallbackDeptId}` |
| KPI Group (codes known) | `{team.name} includes TaskcodeID:\n'{id1}', '{id2}', ...` — up to 30; then `\n... and N more` |
| KPI Group (no codes) | `{team.name} - KPI Group` |

**Data source:** `team.taskCodes` (array of `TaskCode` strings from `ConfigTasks`) and `team.fallbackDeptId` — both returned by `/api/teams`. Backend uses `getTeamIdCaseForConfigTasks()` in Q4 of `fetchTeamsData`: `SELECT CASE ... END AS teamId, ct.TaskCode FROM ConfigTasks` filtered by `UsedForKPI = 1`, non-empty `SpecifiedKPIGrp`, and non-null/non-empty `TaskCode`. Note: `ConfigTaskId` (e.g. `95`) ≠ `TaskCode` (e.g. `'100095'`) — always use `TaskCode` for the tooltip display.

**CSS:** `.card-team { font-size: 16px }` — team name heading in each card; set in `styles.css`. `.card-dept { font-size: 9px }` — set in `styles.css`. `.stat-label { font-size: 9px }` — controls the VOLUME, AVG TAT, and OVERDUE labels inside team cards; set in `styles.css`.

**TeamsView "Department" column (All Teams tab):** Displays `'Department Group'` (when `t.fallbackDeptId` is set) or `'KPI Group'` (when null), at `fontSize: 9`. Does **not** show the raw `t.dept` value (Origination / Credit / etc.).

**TaskModal header breadcrumb (2026-07-17):** The `.sub` line above the team name in the drill-through popup (for both Team Performance card clicks and All Teams row clicks) shows `'Department Group' · SLA target Xh` or `'KPI Group' · SLA target Xh` — uses `team.fallbackDeptId ? 'Department Group' : 'KPI Group'`. The raw `team.dept` value (Origination / Credit / Settlement / Other) is **no longer shown** in any popup or drill-through context.

**TeamsView column formatting (All Teams tab — updated 2026-07-16):**
- **Target, Volume, Avg TAT, Overdue (only Active tasks)** — headers and cell values all use the same plain default font and color (no `danger-text`, no `soft`/muted class). All four columns are **center-aligned** (both `<th>` and `<td>`). No conditional color overrides for Avg TAT or Overdue in this table.
- **Overdue (only Active tasks)** header: `whiteSpace:'normal'` to allow text wrapping (saves horizontal space).
- **Status** column cell: `whiteSpace:'nowrap'` to prevent the badge from wrapping.

### Drill-Through "Task Name" Display Rule (2026-06-16)
- In **all drill-through views** (TaskModal from team cards/KPI cards, TasksView table, AlertsPanel overdue/at-risk rows), the primary display field under the "Task Name / Description" column shows the **staff member's full name**: `FirstName + ' ' + Surname`.
- Source: `RTRIM(ISNULL(s.FirstName,'')) + ' ' + RTRIM(ISNULL(s.Surname,'')) AS StaffFullName` — computed in SQL via the existing `LEFT JOIN Staff s ON t.AssignedTo = s.StaffID`.
- Fallback chain if staff name is empty/null: `TaskName` (for `/api/tasks`) or `ShortDescription` (for `/api/alert-tasks`), then `'Task #<id>'`.
- Implemented in: `normalizeTask()` in `App.jsx` (`desc` field), and both overdue + at-risk rows in `AlertsPanel` in `components.jsx`.
- `/api/tasks` SQL: adds `StaffFullName` computed column alongside the existing `AssignedToName` (FirstName only, kept for the secondary `client` line).
- `/api/alert-tasks` SQL: adds `StaffFullName` to both UNION branches (overdue and at-risk).

### SLA % Badge Click — Completed Tasks Drill-Through (2026-07-15)

**Trigger:** Clicking the SLA % badge (top-right of a Team Performance card) opens a `TaskModal` showing all **completed tasks** (`TaskStatusID = 2`) for that team scoped to today (`DateCreated` basis — consistent with all other dashboard metrics). Clicking the card body still opens the existing active-tasks drill-through.

**Dataset scope:**
- Status: `TaskStatusID = 2` (completed only).
- Date filter: `DateCreated >= today AND DateCreated < next day` — same date scope as all other dashboard metrics (active tasks, deltas, etc.).
- Team filter: same two-tier kpiGrp / dept-fallback logic as all other team queries.

**Sorting:** Overdue completed tasks appear first (non-compliant: `TotalHoursOnTask > SLAInHours` OR `DateCompleted > SLAAdjustedDate`), then remaining completed tasks ordered by `TotalHoursOnTask` descending. Sorting applied in SQL `ORDER BY` in the backend.

**Modal title:** `{Team Name} — Completed Tasks — Today` (via `taskLabel` prop on `TaskModal`).

**Table structure:** Identical to existing drill-through tables — same 11 columns, same `TaskRow` component, same `normalizeTask()` normalization. Per-task TAT: `TotalHoursOnTask` (primary); fallback when null: `DATEDIFF(SLAAdjustedDate, DateCompleted) / 60.0` (hours from adjusted deadline to completion, requires both fields non-null).

**Status badges in completed-task rows (overdue logic — 2026-07-15 updated):** `bad` (red) = overdue: `TotalHoursOnTask > SLAInHours` (per-task, when non-null) OR `DateCompleted > SLAAdjustedDate` (when set). `ok` (green) = compliant. `warn` (amber) = TAT within target but at-risk threshold reached.

**Implementation:**
- Backend: branch added in `/api/tasks` when `req.query.status === 'completed'`. Separate SQL query with `TaskStatusID = 2`, `DateCreated` scoping (same date basis as all other dashboard metrics), overdue-first `ORDER BY`.
- Frontend `components.jsx`: `TeamCard` accepts new `onSlaClick` prop. Badge element has `onClick` with `e.stopPropagation()` so card-level click is not also triggered. `TaskModal` accepts new `taskLabel` prop (overrides default title) and `loading` prop (shows "Loading…" while data fetches).
- Frontend `App.jsx`: `slaModalTeamId`, `slaRawTasks`, `slaTasksLoading` state. `openSlaModal(teamId)` callback calls `getTasks(teamId, 'completed', 'today')`. `slaModalTasks` useMemo normalizes raw records. Separate `<TaskModal>` rendered for SLA modal alongside the existing active-tasks modal.

**`/api/tasks` completed-task constraints:** Same `TOP 500` limit as active-task path. No `atRiskPct` parameter used (completed tasks only have `bad`/`ok` status). `scope` param not used (date scope is always today via `DateCreated` — tasks created today that have been completed).

**Completed-tasks modal — metric cards (2026-07-15):** When `completedMode={true}` on `TaskModal`, the summary chips change:
- **SLA %** — in `completedMode`, recalculated from task rows: `Math.round(tasks.filter(t => t.status !== 'bad').length / tasks.length * 100)`. Consistent with On-Time/Overdue counts using the same overdue logic. Falls back to `team.sla` when `tasks.length === 0`.
- **Total Completed Tasks** — `tasks.length`: count of all completed tasks (`TaskStatusID = 2`) returned by the API for this team today. The backend `/api/tasks?status=completed` only returns `TaskStatusID = 2` rows, so this equals the full completed task count.
- **Total On-Time Tasks** — `tasks.filter(t => t.status !== 'bad').length`: count of compliant completed tasks (`TaskStatusID = 2`) where status is not overdue — i.e., `TotalHoursOnTask ≤ SLAInHours` AND `DateCompleted ≤ SLAAdjustedDate` (when set). Includes both `'ok'` and `'warn'` tasks (at-risk but still completed within SLA counts as on-time).
- **Overdue (Only Completed Tasks)** — `tasks.filter(t => t.status === 'bad').length` (same red styling as Overdue chip)
- **Avg TAT (ONLY COMPLETED TASKS)** — recomputed from task rows using completed-task-specific TAT rules:
  - **Primary:** `TotalHoursOnTask` when **positive** (`> 0` — non-null, non-zero, non-negative). Negative `tatHours` means `normalizeTask` used the `(CompletedDate − SLAAdjustedDate)` display fallback (task completed before adjusted deadline); those values are excluded from the avg and fall through to the elapsed-time fallback below.
  - **Fallback:** `(CompletedDateTime − DateCreatedDateTime)` in hours — applied when `TotalHoursOnTask IS NULL`, 0, or negative. Requires both `completedDte` and `createDte` to be present (guaranteed by `DateCreated = today` API filter).
  - **Excluded:** tasks where neither primary nor fallback yields a valid TAT
  - Implemented in `completedAvgTat` useMemo using `parseDMY` for the fallback date diff
  - Falls back to `team.avgTat` when all tasks have no computable TAT. Uses `TOOLTIPS.modal.avgTatCompleted`.
The regular active-tasks modal retains its original chips (SLA % | Volume | Avg TAT | Overdue (only Active tasks)).

**Invariant:** Total Completed Tasks = Total On-Time Tasks + Overdue (Only Completed Tasks). SLA% = Total On-Time ÷ Total Completed × 100 (rounded). All three counts use the same task dataset (`TaskStatusID = 2`, team-scoped, DateCreated = today).

**Completed-tasks modal — table columns (2026-07-15):** When `completedMode={true}`, the column set differs from the active-tasks modal:
- `Create Dte` column is **removed**
- `Completed Dte` column is **added** immediately after `SLAAdjusted Dte` (same two-line date/time format, 100px wide)
- Column order: Task ID · App ID · SLAAdjusted Dte · **Completed Dte** · Description · On hold · On task · Current · Status · TAT vs Target · Priority (11 columns total — no horizontal scroll)
- Data source: `CONVERT(VARCHAR(10), t.DateCompleted, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCompleted, 108) AS CompletedDte` added to the `/api/tasks` completed-branch SELECT; mapped in `normalizeTask()` as `completedDte`.
- `TaskRow` accepts `showCompletedDte` prop (default `false`): when `true`, hides the Create Dte `<td>` and shows Completed Dte `<td>` after SLAAdjusted Dte.
- `TaskModal` accepts `completedMode` prop (default `false`); passes `showCompletedDte={completedMode}` to each `<TaskRow>`.

**Completed-tasks modal — visual style (2026-07-17):**
- **Modal background:** `#D3D3D3` (grey) — applied via `style={completedMode ? {background:'#D3D3D3'} : undefined}` on the `.modal` div. Active-task modals are unaffected.
- **Table area background:** white (`#fff`) — applied via `style={completedMode ? {background:'#fff'} : undefined}` on the `.modal-body` div, keeping the table section white while the header/chips area shows the grey background.
- **Title word “COMPLETED”:** rendered in `var(--bad)` red with `fontWeight:700` via a `<span>` inside the `taskLabel` JSX prop passed from `App.jsx`. Only the word “COMPLETED” is red; the rest of the title (`Tasks — Today`) remains the default colour.
- **SLA% badge shadow + hover (trigger):** The clickable SLA% badge on each `TeamCard` (when `onSlaClick` is set) receives class `badge--sla-trigger` and inline `boxShadow: '0 2px 10px rgba(0,0,0,0.22)'`. CSS `.badge--sla-trigger:hover { filter: brightness(0.7); }` darkens the badge by 30% on hover. Size, shape, and position are unchanged.



### Drill-Through UI Rules (2026-06-25)

**Summary chips card order** (TaskModal — All Teams and Team Performance card drill-throughs):
- Order is: **Volume → SLA % → Avg TAT → Overdue**
- Volume appears before SLA % (changed 2026-06-25).

**AVG TAT chip formatting:**
- Value always formatted as **`h:mm:ss`** (hours : minutes : seconds), e.g. `9:36:00`.
- Implemented in `fmtHMS()` in `components/utils.js` — converts decimal hours to total seconds then formats.
- Font color is always **`#111` (near-black)** — forced via inline `style={{color: '#111'}}` on the `chip-value` div, so the danger/red chip class does not affect the text color.

**APP ID column in drill-through tables:**
- Column **App ID** appears immediately after **Task ID** in all task drill-through tables.
- Same font class (`task-id`) and size as Task ID.
- Applies to: TaskModal table (All Teams + Team Performance), AlertsPanel table drill-through, TasksView (All Active Tasks page).
- Data source: `t.ApplicationID` — added to `SELECT` in `/api/tasks` and both UNION branches in `/api/alert-tasks` in `server.js`. Passed through `normalizeTask()` as `appId` field in `App.jsx`.
- Displays `-` when `ApplicationID` is null.

**CURRENT column in drill-through tables:**
- Column **Current** appears immediately after **Description** in all task drill-through tables.
- Shows the task's current status name from `ConfigTaskStatus` (e.g., "In Progress", "On Hold", "On Queue", "Not Queued").
- Data source: `ts.TaskStatus` joined via `LEFT JOIN ConfigTaskStatus ts ON t.TaskStatusID = ts.ConfigTaskStatusID`.
  - `/api/tasks`: join already present; `ts.TaskStatus` already selected.
  - `/api/alert-tasks`: join added to `staffJoin`; `ISNULL(ts.TaskStatus, '') AS TaskStatus` added to both UNION branches.
- Passed through `normalizeTask()` as `taskStatus` field in `App.jsx`.
- Displays `-` when null/empty.

**No-wrap rule for task tables:**
- All columns in task tables have `white-space: nowrap` **except Description**.
- Description column may wrap freely — all other columns (Task ID, App ID, Create Dte, SLAAdjusted Dte, Current, Status/Team, TAT vs Target, Priority) must not wrap.
- Applied via `style={{whiteSpace:'nowrap'}}` on each `<td>` in `TaskRow`, `AlertsPanel` drill-through rows, and `TasksView` rows.
- **Header wrapping (2026-07-15):** Create Dte and SLAAdjusted Dte `<th>` headers have `whiteSpace:'normal'` to allow text wrapping within their narrow column widths (100px / 110px). All other headers remain `nowrap` via the global `.task-table thead th` rule.
- **Description column width (2026-07-15):** Description `<th>` has `width:'25%'` — approximately 30% shorter than "all remaining space" behaviour on a standard 1920px monitor.

**Date cell format rule (2026-07-14 — MANDATORY):**
- `Create Dte` and `SLAAdjusted Dte` cells always display as **two stacked lines** — date on top, time below.
- SQL produces a full `DD/MM/YYYY HH:MM:SS` string: `CONVERT(VARCHAR(10), t.DateCreated, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCreated, 108) AS CreateDte`. Same pattern for `SLAAdjustedDate`.
- Frontend splits on the space character: date line = `value.split(' ')[0]`, time line = `value.split(' ')[1]`. Both rendered as `<div style={{fontSize:'12px',color:'var(--ink-soft)'}}>`.
- Applied identically in `TaskRow` (`components.jsx`), `AlertsPanel` drill-through rows (`components.jsx`), and `TasksView` rows (`views.jsx`).
- SQL must use `CONVERT(VARCHAR(8), ..., 108)` for full `HH:MM:SS` seconds — **never** `LEFT(..., 5)` which truncates seconds.

**Modal width:**
- `.modal` CSS width is `95vw` — set in `styles.css`. Expands to 95% of screen width on all screen sizes.

### Column-Header Sorting — All Tables (2026-07-15)

**Behaviour:** Click any column header to sort rows by that column. Cycle: 1st click = ascending, 2nd click = descending, 3rd click = reset to original order. Sort state is local to each table (resetting one table does not affect others).

**Visual indicator:** A small ▲ (ascending) or ▼ (descending) arrow is appended inside every sortable `<th>`. When a column is not the active sort key, the arrow is shown at 25% opacity so headers still look clean.

**Data-type awareness:**
- Numeric fields (Volume, TAT hours, priority enum, etc.) sort numerically.
- Date fields (Create Dte, SLAAdjusted Dte) parse the `DD/MM/YYYY HH:MM:SS` string to a timestamp via `parseDMY()` before comparing.
- Text fields sort case-insensitively via `localeCompare`.
- Nulls always sort to the bottom regardless of direction.

**Tables covered (all 10):**
1. **TeamsView** — Team, Dept, Volume, Avg TAT, Target, Overdue (only Active tasks), SLA% (only Completed tasks), Status
2. **TasksView** — all 12 columns (Task ID numeric, date cols via parseDMY)
3. **ReportsView stats** — Team, 7-day Avg, Min, Max, Δ (Trajectory column left unsortable — sparkline)
4. **StaffListView absent-today** — Staff ID, Full Name, Dept Name, Work Status, StartedTime, EndedTime
5. **StaffListView departments** — Dept ID, Dept Name, Total Staff Count
6. **StaffListView staff modal** — Staff ID, Full Name, IsGroup (Employee Status column always ACTIVE — left unsortable)
7. **TaskCodesView** — all 9 columns
8. **AdminView** — Email, Role, Joined, Status (Action column left unsortable)
9. **TaskModal (active tasks)** — all 11 columns
10. **AlertsPanel drillMode='table'** — all 11 columns (via `AlertDrillTable` sub-component)

**Implementation files:**
- `frontend/src/components/utils.js` — 4 new exports: `parseDMY`, `sortRows`, `useSortState`, `SortTh`.
  - `SortTh` is written with `React.createElement` (not JSX) because the file has a `.js` extension.
  - `useSortState` hook: returns `[{ col, dir }, cycleSort]`. `cycleSort(col)` cycles null→asc→desc→null.
  - `sortRows(arr, col, dir, getVal)`: pure sort; returns original array reference when `col === null`.
  - `parseDMY(s)`: parses `DD/MM/YYYY HH:MM:SS` → Unix timestamp; returns 0 for null/malformed.
- `frontend/src/components/views.jsx` — imports updated; sort state + `sortRows` call added to every view component; all `<th>` in sortable tables replaced with `<SortTh>`.
- `frontend/src/components/components.jsx` — imports updated; `AlertDrillTable` sub-component added before `AlertsPanel` (has its own `useSortState`; `normalizePriorityVal` and `alertStatusInfoVal` moved to module scope); `drillMode==='table'` branch replaced with `<AlertDrillTable rows={rows}/>`. `TaskModal` has its own sort state.

**AlertsPanel sort architecture:** `AlertsPanel` calls `alerts.map()` to render each alert card — hooks cannot be called inside a `.map()`. The solution is to extract the table into `AlertDrillTable`, a named sub-component that owns its own `useSortState` hook. `AlertsPanel` just passes `rows` to it.

**Column widths (task drill-through tables)** — updated to include SLA (hours) column:
- Task ID: 90px · App ID: 100px · Create Dte: 100px (wraps) · SLAAdjusted Dte: 110px (wraps) · Description: **25% of table width** · SLA (hours): 65px (wraps) · On hold (hours): 70px · On task (hours): 70px · Current: 100px · Status: 90px · TAT vs Target: 160px · Priority: 70px

**Column widths (TasksView — All Active Tasks page):**
- Task ID: 90px · App ID: 100px · Create Dte: 100px (wraps) · SLAAdjusted Dte: 110px (wraps) · Description: **25% of table width** · SLA (hours): 65px (wraps) · On hold (hours): 70px · On task (hours): 70px · Current: 110px · Team: 120px · Status: 90px · TAT vs Target: 160px · Priority: 70px

**TasksView search boxes (2026-07-16):**
- Two search inputs displayed in the **top-right of the page header** (`page-head` right slot), aligned bottom to match the title block.
- **Task ID** search (130px wide): substring match on `t.id` (e.g. `T-5696893`), case-insensitive.
- **App ID** search (110px wide): substring match on `String(t.appId ?? '')`.
- Both searches stack with the existing Team and Status filters — all four conditions must pass for a row to appear.
- Displayed only on the All Active Tasks page (`TasksView`). Not present in any drill-through modal or other view.

**On hold / On task columns (2026-07-16 — all tables):**
- Column **On hold (hours)** — header wraps; source field: `t.TotalHoursOnHold` (real, nullable). Displayed as **exactly 1 decimal** using `.toFixed(1)` (e.g. `0.0`, `2.5`), shows `-` when null.
- Column **On task (hours)** — header wraps; source field: `t.TotalHoursOnTask` (real, nullable). Displayed as **exactly 1 decimal** using `.toFixed(1)` (e.g. `0.0`, `4.0`), shows `-` when null.
- Both columns appear **after Description** in all task tables: TaskModal, AlertsPanel drill-through, TasksView.
- Header `<th>` has `whiteSpace:'normal'` to allow wrapping (overrides global `white-space: nowrap` on `.task-table thead th`).
- `TotalHoursOnHold` is now selected in `/api/tasks` and both UNION branches of `/api/alert-tasks/:teamId` in `server.js`.
- Mapped through `normalizeTask()` in `App.jsx` as `onHoldHours` and `onTaskHours` (rounded to 1dp, null-safe).
- AlertsPanel rows use raw `t.TotalHoursOnHold` / `t.TotalHoursOnTask` directly (alert-tasks API path, not normalized).
- No horizontal scrolling: TAT vs Target reduced from 180px → 160px; SLAAdjusted Dte 120px → 110px; Priority 80px → 70px; Team (TasksView) 130px → 120px.

### Chart Rendering Rules (2026-06-15)

> **Applies to all SVG charts in the dashboard** — currently `TrendChart` (`trend.jsx`) and `HistoryChart` (`history-chart.jsx`). Any future chart MUST follow these rules.

- **Auto-scale Y-axis from the visible data, never hardcode `yMin/yMax` or `gridY` arrays.** Use `computePctAxis(values, opts)` from `chartUtils.js` — it returns `{ yMin, yMax, ticks }` with sensible padding (~10%, min 5pp), nice rounded tick steps (1/2/5/10/20/25), and clamps to `[0, 100]` for percentages. Falls back to `[60, 100]` when no data.
- **Y-axis must react to legend toggles.** Pass only undimmed series into `computePctAxis()` so the chart re-fits when teams are filtered out. Fall back to all visible teams if every series is dimmed.
- **Clip every data graphic to the inner plot area.** Add `<defs><clipPath id={uniqueId}><rect x={pad.left} y={pad.top} width={innerW} height={innerH}/></clipPath></defs>` and wrap the series `<g>` (and any target band rect) with `clipPath={`url(#${uniqueId})`}`. The id must be unique per chart instance — use `React.useId()` (strip colons for valid SVG ids) so multiple charts on one page do not collide.
- **Skip dots whose value falls outside `[yMin, yMax]`** rather than rendering them at the clipped edge — prevents half-circles glued to the chart border.
- **Target/threshold bands must be clipped too** and only drawn where the band intersects the visible Y range (`bandLo = max(yMin, target)`, `bandHi = min(yMax, ceiling)`; render only when `bandHi > bandLo`).
- **Do NOT change chart types or styling.** No new chart libraries. No restyle of colors, strokes, or fonts. These changes are limited to axis math and overflow control.
- **Do NOT change business logic upstream.** Auto-scaling is purely a presentation concern — the underlying SLA% values, weekend filtering (`filterBizDays`), null-handling (`buildSmoothPath`), and `activeTeams` selection are unchanged.

### Tooltip Rule (2026-06-09)
- All shared tooltip text lives in `frontend/src/constants.js` → `TOOLTIPS` object, keyed by section (`kpi`, `team`, `chart`, `teams`, `modal`).
- Settings-specific tooltip text (Refresh interval, At Risk threshold, Tasks in drill-down) lives inline in `views.jsx`.
- **Source of truth for tooltip content (2026-07-16):** `docs/SLA_Dashboard_Tooltips.xlsx` column E (`Updated Tooltip Text`). When updating tooltip copy, edit column E in the spreadsheet first, then apply the new text to the corresponding `TOOLTIPS` key in `constants.js`. All 24 tooltip entries are mapped in that file (rows 1–24, one row per key).

#### Tooltip Z-Index / Stacking Rule (2026-06-15 — MANDATORY)

> **Every tooltip bubble must always render in front of all other dashboard content — cards, charts, tables, modals, sidebar, and topbar. It must never be clipped, hidden behind containers, or cut off by `overflow: hidden`.**

- **`InfoTip` (ⓘ icon tooltip):** Uses `ReactDOM.createPortal(bubble, document.body)` so the bubble is a direct child of `<body>`, outside any clipping ancestor. The bubble has `position: fixed; z-index: 9999`. **Interaction model (2026-07-17): click-to-toggle** — clicking the icon opens the bubble; clicking it again (or clicking outside, or pressing ESC) closes it. Only one InfoTip can be open at a time (opening a new one dispatches a `infotip-opened` custom DOM event that closes all others). Keyboard: Enter/Space toggles; Escape closes. `role="button"` + `aria-expanded` communicate state to screen readers. Chart data-point hover tooltips in `trend.jsx` / `history-chart.jsx` are NOT affected — those remain hover-triggered.
- **Chart hover tooltip (`.tooltip` class in `trend.jsx` and `history-chart.jsx`):** Rendered via `ReactDOM.createPortal(..., document.body)` with `position: 'fixed'` and `zIndex: 9998` in the inline style. The fixed pixel position is computed from `wrapRef.current.getBoundingClientRect()` so the tooltip appears at the correct viewport location regardless of scroll position or ancestor overflow rules. The guard `wrapRef.current &&` ensures the ref is available before computing.
- **Why portaling is required:** `.trend-card`, `.kpi`, `.card`, and `.alerts-panel` all have `overflow: hidden; isolation: isolate` in the CSS. Any `position: absolute` child (including chart hover tooltips) is clipped at the card boundary. Portaling moves the DOM node to `<body>` so it is never clipped.
- **Z-index hierarchy:** `InfoTip` bubble = 9999 · chart hover tooltip = 9998 · modal overlay = 100 · sidebar = 10 · topbar = 9.
- **Any new tooltip added in future** must follow the same portal pattern — never use `position: absolute` inside an `overflow: hidden` ancestor.

- **Formatting requirements for all tooltips (2026-06-25 — section-based format):**
  - Use `\n\n` between sections. Use `\n-` for bullet lists within a section. `white-space: pre-line` on the bubble renders them correctly.
  - Keep wording short and plain-English for business users.
  - **Group 1 — Total Active Tasks and Volume cards:** Required sections in order: `Meaning` / `Includes` / `Excluded` / `Date basis`. No Formula, no Rules.
  - **Group 2 — SLA, TAT, and Overdue cards:** Required sections in order: `Meaning` / `Formula` (omit entirely when not applicable) / `Rules` / `Includes` / `Excluded` / `Date basis`.
  - **Group 3 — Active Alerts cards:** No format change — leave tooltips exactly as-is.
  - **Group 4 — Charts (7-Day SLA Compliance Trend, Compliance · Last N days):** Required sections in order: `Rules` / `Includes` / `Excluded` / `Date basis` / `Interactions`.
  - Section labels must match exactly: `Meaning`, `Formula`, `Rules`, `Includes`, `Excluded`, `Date basis`, `Interactions`.
  - `chart.history` key added in `TOOLTIPS.chart` for the "Compliance · Last N days" history chart (ReportsView). InfoTip rendered on `<h2 className="section-title">Compliance · {rangeLabel}</h2>` in `views.jsx` with `width={280}`.
- **Settings-affected tooltip rule (2026-06-19 — MANDATORY):** If the card / chart / table that the tooltip describes is **affected** by user configuration in the Settings tab (SLA target, At Risk threshold, etc.), the tooltip text MUST end with the exact sentence: `Target is configurable per team In Settings.` — placed on its own line after a blank line (`\n\n`). If the metric is **not** affected by Settings (pure counts, hardcoded colour legends, modal volume), the sentence MUST NOT be included.
  - Affected (sentence required): `kpi.overallSla`, `kpi.avgTat`, `kpi.totalOverdue`, `team.sla`, `team.avgTat`, `team.overdue`, `chart.trend`, `chart.history`, `modal.sla`, `modal.avgTat`, `modal.overdue`, `alerts.panel`.
  - Not affected (sentence forbidden): `kpi.totalTasks`, `team.volume`, `teams.status`, `modal.volume`, and the Settings-input inline tooltips in `views.jsx` (Refresh interval, At Risk threshold, Tasks in drill-down) — those describe the settings themselves, not metrics that consume them.
- **Width:** `InfoTip` accepts an optional `width` prop (default 240px). Pass 260–300px for multi-line content to prevent awkward line breaks. `KpiTile` exposes a `tooltipWidth` prop that forwards to `InfoTip`.
- `TOOLTIPS.alerts.panel` — used on the "Active Alerts" title in both `AlertsPanel` (dashboard panel) and `AlertsView` (full Alerts page). Explains what triggers an alert (At Risk threshold breach, overdue tasks) and the two severity levels (Critical / Warning). Width 280px.
- **Active Alerts row description format (2026-07-16):** Backend `/api/alerts` returns each alert `desc` as: `<total> active tasks today, <inProgress> file(s) complete, <overdue> file(s) overdue, SLA at <pct>%`. Applied to all teams/departments and both severities (`critical`, `warning`). `inProgress` = `SUM(TaskStatusID = 1)` — tasks with Current status "In Progress" only, matching the Current column in the drill-through popup. `compliant` = `total − overdue` (tasks not currently breaching SLA). `pct = Math.round(compliant / total * 100)`. The second `<inProgress>` ("files complete" field) equals the TaskStatusID=1 count so frontend `splitAlertDesc()` renders `(N files in progress, K files overdue)` where N matches the "In Progress" rows visible in the team card popup.

#### Active Alerts Tab Drill-Through Fields (2026-06-18)

- Applies to the **Active Alerts tab** feed drill-through only (`AlertsView` usage of `AlertsPanel`).
- Drill-through details must render in the same table pattern used by the All Teams drill-through (`task-table` style):
  - Task ID
  - Description
  - Status
  - TAT vs TARGET
  - Priority
- Loading, empty, and error states remain the same as existing alert drill-through behavior.

### Parallel SQL Queries Pattern
- Use `Promise.all([query1, query2, query3])` when an endpoint needs multiple independent SQL datasets.
- Do not chain `await` calls sequentially — run them in parallel.
- See `/api/teams` (2 queries in Promise.all: main stats + combined delta query) as an example.
- `/api/kpi-summary` was simplified to 1 query (both today + prev biz day values in a single scan — 2026-06-01).

### Port Usage
- Backend: port **5000** (`http://localhost:5000`)
- Frontend: port **5173** (`http://localhost:5173`)
- To clear port 5000 if occupied: `Get-Process -Name node | Stop-Process -Force`

### Settings Persistence Rule (2026-06-08, updated 2026-07-15)

> **INVARIANT: User-configured settings MUST persist across logout/login, page refresh, backend restart, browser data clears, and new devices. Settings must NEVER silently revert to defaults. Order and configuration only change when the user explicitly saves changes in the Settings tab.**

> **PER-USER ISOLATION: SLA targets, at-risk threshold, loan targets, refresh interval, and `modalTaskCount` are stored independently per authenticated user. Changing them as User A has no effect on User B.**

> **GLOBAL TEAM CONFIG: `hiddenTeams` and `groupOrder` are NOT per-user — they are global settings written by an admin and applied to ALL authenticated sessions. When an admin removes, restores, or reorders teams in Settings, every logged-in session (admin and viewer) recomputes `teamsDisplay`, KPI tiles, alerts, and all derived metrics within 15 seconds, with no page reload. The admin's saved team config is the source of truth for all users.**

> **DURABLE STORAGE: Per-user settings are backed by `ConfigReportUsers.UserSettings NVARCHAR(MAX)`. Global team config is backed by `ConfigDashboards.GlobalSettings NVARCHAR(MAX)` (added via startup auto-migration). Both use localStorage as a fast-load cache only.**

- **Database column:** `ConfigReportUsers.UserSettings NVARCHAR(MAX) NULL` — added automatically by the backend startup migration (`IF NOT EXISTS ALTER TABLE`). Stores the full settings JSON per user row.
- **Per-user localStorage key:** `sla_dash_settings_<email>` (email lowercased, non-alphanumeric chars replaced with `_`). Falls back to legacy `sla_dash_settings` key when email is unavailable. Used as a fast-load cache — the DB is the source of truth.
- **Helper functions** in `App.jsx` (module-level): `settingsKey(email)` returns the per-user key; `loadSettingsFromStorage(email)` reads and merges from the per-user key (falling back to legacy key).
- **Read path on page load:** `useState` lazy initializer calls `loadSettingsFromStorage(getStoredUser().email)` — immediate, synchronous, no API wait. Uses any cached value from a previous session.
- **Login path (`handleLogin` — async):**
  1. Stores `sla_token` + `sla_user` in localStorage.
  2. Loads per-user settings from localStorage cache (`loadSettingsFromStorage`).
  3. Calls `GET /api/user/settings` — fetches the authoritative DB settings.
  4. If DB has saved settings: merges with `DEFAULT_SETTINGS`, updates localStorage cache, updates `settingsRef.current` + `setSettings`.
  5. Falls back to localStorage cache silently if the backend call fails.
  6. Calls `GET /api/settings` — fetches the global team config (hiddenTeams, groupOrder, version). Updates `globalTeamConfigRef.current` + `setGlobalTeamConfig`.
  7. Calls `setAuthed(true)` **only after** both `settingsRef.current` and `globalTeamConfigRef.current` are updated — guarantees the `[authed]` data-load effect always reads the correct config on first render. No race condition.
- **Apply path (`applySettings`):** Writes per-user settings to localStorage AND `PUT /api/user/settings` (fire-and-forget). For admin users, also calls `PUT /api/admin/settings` with `{ hiddenTeams, groupOrder }` — increments the global version counter so all polling sessions detect the change within 15 s.
- **Safety-net effect `useEffect([settings])`:** Always syncs `settings` state to the per-user localStorage key on every change — belt-and-suspenders in case a single write path fails.
- **Logout (`handleLogout`):** Removes ONLY `sla_token` and `sla_user`. NEVER removes any settings key. The next login restores the saved settings from the DB.
- **Reset (`resetSettings`):** Removes both the per-user key AND the legacy `sla_dash_settings` key from localStorage, resets `settingsRef.current` to `DEFAULT_SETTINGS`, and calls `PUT /api/user/settings` with `{}` to also clear the DB. For admin users, also calls `PUT /api/admin/settings` with `{ hiddenTeams: [], groupOrder: [] }` to reset the global team config.
- **`SettingsView` draft must not depend on `teams` for initialization** — `makeDraft(s)` uses `targets: { ...s.targets }` and `teamOrder: Array.isArray(s.groupOrder) ? [...s.groupOrder] : []` (sparse dict and array copy, no teams loop). The render falls back to `t.target` via `draft.targets[t.id] ?? t.target`, and `orderedDraftTeams` falls back to the natural `teams` array when `draft.teamOrder` is empty. This prevents the bug where draft values become `{}` or `[]` when teams haven't loaded yet.
- The `useEffect` in `SettingsView` that re-syncs `draft` depends only on `[settings]` — this is correct. Adding `teams` to the deps would reset in-progress edits on auto-refresh.

### Team Order (Drag-and-Drop) — Feature Reference (Added 2026-07-01, updated 2026-07-16)

Controls the display order of team cards, tables, charts, and legends across all views via drag-and-drop in the Settings tab.

**Global config key:** `globalTeamConfig.groupOrder` — array of team **names** (strings) in display order. Stored server-side in `ConfigDashboards.GlobalSettings` as JSON (added by startup auto-migration). Written by admin via `PUT /api/admin/settings`; read by all authenticated sessions via `GET /api/settings`.

**Propagation:** When admin clicks **Apply Changes**, `saveGlobalSettings({ hiddenTeams, groupOrder })` is called, incrementing the server-side `version`. All logged-in sessions poll `GET /api/settings` every **15 seconds**; when the version changes they call `setGlobalTeamConfig(cfg)`, which triggers `teamsDisplay` to recompute immediately. No page reload required for any user.

**Default:** `[]` (empty array). When empty, `teamsDisplay` uses the natural backend order (Data Entry → Valuations → Assessments → Packaging & QA → CLA → Funder Submission → Funder MIR → Settlement → Ezy Client Care, then any dynamic groups in alphabetical order).

**`DEFAULT_SETTINGS`:** `groupOrder: []`.

**`makeDraft(s)` in `SettingsView`:** `teamOrder: Array.isArray(s.groupOrder) ? [...s.groupOrder] : []` — does not depend on the `teams` prop at initialization (safe when teams haven't loaded yet).

**Sorting applied in `teamsDisplay` useMemo (`App.jsx`):**
```javascript
const order = globalTeamConfig.groupOrder;
if (!order || order.length === 0) return display;        // natural order
const orderMap = new Map(order.map((name, i) => [name, i]));
return [...display].sort((a, b) =>
  (orderMap.get(a.name) ?? Infinity) - (orderMap.get(b.name) ?? Infinity)
);
```
Teams not in `orderMap` (new dynamic groups) get `Infinity` and sort after all ordered teams in their original backend order (stable sort).

**Where ordering applies:** `teamsDisplay` is the single derived array used by all views — dashboard team cards, 7-Day Trend chart legend, TeamsView table, TasksView team filter, ReportsView history chart and legend. SettingsView receives raw `teams` (unordered) for the `orderedDraftTeams` memo.

**UI section (Settings tab):** Section renamed from "SLA Targets per Team" to **"Team order and SLA target"**. Each row has `draggable` set and a 6-dot grip handle SVG on the far left. Drag a row to a new position; the outline highlights the drop target. Dropping updates `draft.teamOrder` (array of all team IDs in new order). Clicking **Apply Changes** saves `groupOrder: draft.teamOrder` into `settings`, which triggers `teamsDisplay` to recompute and immediately propagates the new order across all open tabs/views — no page reload needed.

**New dynamic teams (ids 100+):** Appended after all ordered teams when first discovered (not in `groupOrder`). After dragging them into position and applying, they join the saved `groupOrder` array.

**Persistence:** Admin saves via `applySettings()` → `saveGlobalSettings()` → `PUT /api/admin/settings` → persisted to `ConfigDashboards.GlobalSettings`. Survives backend restart (loaded at startup). `resetSettings()` by admin calls `PUT /api/admin/settings` with `{ hiddenTeams: [], groupOrder: [] }`, reverting to natural order for all sessions.

### Team Remove / Restore — Feature Reference (Added 2026-07-15, updated 2026-07-16)

Hides or re-includes a team from all dashboard calculations for **all authenticated sessions** when Apply Changes is clicked in the Settings tab. No page reload required for any user.

**Global config key:** `globalTeamConfig.hiddenTeams` — array of team **names** (strings) to exclude. Stored server-side in `ConfigDashboards.GlobalSettings` alongside `groupOrder`. Written by admin only.

**Propagation:** Same mechanism as Team Order — `PUT /api/admin/settings` increments version; all sessions detect via 15-second polling and recompute `teamsDisplay` + `effectiveKpi` + `visibleAlerts` immediately.

**UI (Settings tab — "Team order and SLA target" section):** Each team row has a red **REMOVE** button on the right. Clicking it moves the team to a "Hidden Teams" section that appears below the main list. Hidden team rows show strikethrough name and a **Restore** button. Changes take effect when **Apply Changes** is clicked.

**Propagation — what updates immediately on Apply:**
- `teamsDisplay` useMemo in `App.jsx` now both filters hidden teams AND applies `groupOrder` sort. Every component that consumes `teamsDisplay` updates automatically: Dashboard team cards, 7-Day Trend chart + legend, TeamsView table, TasksView team filter + task rows (TasksView iterates `teams.forEach(t => tasks[t.id])` so hidden teams' tasks are excluded from the All Tasks view), ReportsView history chart + legend.
- **KPI tiles** (`effectiveKpi` useMemo): when `hiddenTeams` is non-empty, all four KPI values and their deltas are re-derived from `teamsDisplay` data — `totalTasks` = sum of `volume`, `totalOverdue` = sum of `overdue`, `overallSla` = **simple average** of each visible team card's `sla` value (all visible teams included, regardless of volume), `avgTat` = **simple average** of each visible team card's `avgTat` value (all visible teams included; teams showing `0:00` contribute `0` to the sum — consistent with summing all card values and dividing by card count). Previous-day values are back-computed as `today − delta` per team then re-aggregated. When no teams are hidden the backend `kpi` response is used directly (no approximation).
- **Alerts panel / Alerts view** (`visibleAlerts` useMemo): filters the `alerts` array to only include entries whose `queueId` matches a visible team ID. Critical and Warning alerts for hidden teams are suppressed immediately.
- **Drill-throughs / modals**: `teamsDisplay` is the source for `modalTeam` and `slaModalTeam` lookups — hidden teams have no entry in `teamsDisplay` so their modals cannot be opened.

**Consistency guarantee:** All components share the same `teamsDisplay` and `visibleAlerts` memos, so the active-team set is identical across every part of the UI at the same time.

**Restore:** Removing a team name from `hiddenTeams` and applying re-includes the team in all views, reverts KPI totals, and re-enables its alerts — exact same propagation path in reverse.

**Note:** The backend API is not involved in hiding/filtering. The backend always returns data for all teams. Filtering is applied purely on the frontend via `teamsDisplay` and `effectiveKpi` / `visibleAlerts` derived state. KPI tiles when teams are hidden show the simple arithmetic average of the visible team card values (not volume-weighted). This means the KPI tile SLA% and Avg TAT match exactly the average of the values displayed on the visible team cards.

---

## 22. Refresh Frontend & Backend — Compulsory Rules (updated 2026-06-09)

> **COMPULSORY — These rules MUST be followed every time the user asks to refresh, restart, or fix the frontend/backend. Follow the checklist automatically without stopping at error messages or asking for confirmation.**
> **ERR_CONNECTION_REFUSED on localhost:5173 = frontend is not running → execute Step 3.**
> **ERR_NGROK_8012 on ngrok URL = frontend is not running → execute Step 3, then check tunnels.**

When asked to **refresh frontend and backend**, follow this checklist automatically without stopping at error messages:

### Step 1 — Kill existing Node processes
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Step 2 — Start backend (port 5000)
```powershell
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\backend"
node server.js
```
Wait for `SLA Dashboard backend running on port 5000` + `Connected to SQL Server` in output.

### Step 3 — Start frontend (port 5173)
```powershell
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\frontend"
npm run dev -- --host
```
Wait for `VITE vX.X.X  ready` in output.

### Step 4 — Check Cloudflare tunnels
Run `get_terminal_output` on each active `cloudflared` terminal.
- If tunnels are **still running** (show `Registered tunnel connection`): no action needed — tell user to refresh browser.

### Step 5 — PRE-FLIGHT CHECK (MANDATORY before saying "OK / ready / refresh browser")

> **This step MUST be executed every time before informing the user that a Vercel-deployed app is ready for testing. Never skip it.**

Run all checks in parallel:

#### Check A — Backend tunnel is live
```powershell
Invoke-WebRequest -UseBasicParsing https://<TUNNEL_URL>/api/health -TimeoutSec 20 | Select-Object -ExpandProperty Content
```
Expected: `{"status":"OK","mode":"live"}`
If FAIL: Start a new clean tunnel (`cloudflared.exe tunnel --url http://localhost:5000 --config NUL`), copy the new `trycloudflare.com` URL.

#### Check B — VITE_API_BASE is set and matches live tunnel
```powershell
npx vercel env ls --scope mezyproject2026 production
```
Confirm `VITE_API_BASE` is **not empty** and matches the running tunnel URL.
If FAIL: Run `vercel env rm VITE_API_BASE production --yes`, then `echo "<NEW_URL>" | vercel env add VITE_API_BASE production`.

#### Check C — Deployed app JS assets load (no 404)
```powershell
$base='https://sla-dashboard-mezyproject2026.vercel.app'
$html=(Invoke-WebRequest -UseBasicParsing $base).Content
$js=[regex]::Match($html,'<script[^>]+src="([^"]+)"').Groups[1].Value
(Invoke-WebRequest -UseBasicParsing "$base$js" -Method Head).StatusCode
```
Expected: `200`. If 404: redeploy (`npx vercel --prod --yes --scope mezyproject2026`).

#### Check D — Login does not fail to fetch
```powershell
Invoke-RestMethod -Method Post -Uri https://<TUNNEL_URL>/api/auth/login `
  -ContentType 'application/json' `
  -Body '{"email":"ntruong@mezy.com.au","password":"123456789"}'
```
Expected: `{ token: "..." }`. If FAIL: `VITE_API_BASE` mismatch or backend down — go back to Check A.

#### Common causes of "Failed to fetch" on login
| Symptom | Cause | Fix |
|---------|-------|-----|
| `Failed to fetch` on any API call | `VITE_API_BASE` is empty or expired tunnel URL | Checks B + A + redeploy |
| `Failed to fetch` on login with CORS error in console | Deployed frontend origin is not in backend CORS allowlist | Add current Vercel hostname to backend `DEFAULT_ORIGINS` or `ALLOWED_ORIGINS`, restart backend, rerun Check D |
| White page on Vercel | JS assets return 404 (wrong `base` path in old build) | Check C + redeploy |
| Login 401 everywhere | SSO protection enabled on Vercel project | `vercel project protection disable sla-dashboard --sso` |
| Tunnel returns 404 on all paths | cloudflared loaded named tunnel config.yml ingress rules | Kill tunnel; restart with `--config NUL` |

**Only tell the user "OK, refresh" after all 4 checks pass.**
- If tunnels have **died or URLs expired**: start new tunnels (Steps 5–7 below).

### Step 5 — (If tunnels dead) Start backend tunnel
```powershell
& "$env:USERPROFILE\cloudflared.exe" tunnel --url http://localhost:5000
```
Copy the new `https://xxxx.trycloudflare.com` URL from output.

### Step 6 — (If tunnels dead) Update `.env.local` with new backend URL
```powershell
Set-Content "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\frontend\.env.local" "VITE_API_BASE=https://NEW-BACKEND-URL.trycloudflare.com"
```
Then restart the frontend (repeat Step 3) so Vite picks up the new env.

### Step 7 — (If tunnels dead) Start frontend tunnel
```powershell
& "$env:USERPROFILE\cloudflared.exe" tunnel --url http://localhost:5173
```
Copy the new frontend URL — this is what the teammate opens.

### Error auto-fixes
| Error | Cause | Fix |
|-------|-------|-----|
| `Could not connect to backend` | Backend not running or wrong port | Restart backend (Step 2); verify port 5000 |
| `DNS_PROBE_FINISHED_NXDOMAIN` on tunnel URL | Tunnel expired | Start new tunnels (Steps 5–7); update `.env.local` |
| `Blocked request. This host is not allowed` | `allowedHosts` missing | Already fixed: `vite.config.js` has `allowedHosts: true` |
| `401 Unauthorized` on all API calls | Token expired | User must log in again — no server restart needed |

### Key file locations
- Backend tunnel binary: `$env:USERPROFILE\cloudflared.exe` (`C:\Users\Ngoc\cloudflared.exe`)
- Frontend env override: `frontend/.env.local` — `VITE_API_BASE=https://...trycloudflare.com`
- `vite.config.js` — `server: { allowedHosts: true }` (already set)

---

## 23. Loan Strip — Feature Reference (Added 2026-06-03)

Three loan summary cards sit above the 4 KPI tiles in the dashboard, showing today's loan milestones.

### Cards

| Card | API field | Date column filtered |
|------|-----------|----------------------|
| Application Received | `loanSummary.received` | `Date_ApplicationReceived` |
| Funder Approvals | `loanSummary.approved` | `Date_FunderApproval` |
| Settlements | `loanSummary.settled` | `Date_Settled` |

Each card shows: application count, total loan amount, count delta (since yesterday), amount delta (since yesterday), and a configurable **Target** badge top-right.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `LoanKpiTile` | `components/components.jsx` | Card UI — props: `label, count, amount, countDelta, amtDelta, target, onClick` |
| `LoanModal` | `components/components.jsx` | Drill-down modal — same overlay/modal CSS as `TaskModal`; props: `label, loans, loading, error, onClose` |

### API Functions (`api.js`)

| Function | Endpoint | Returns |
|----------|----------|---------|
| `getLoanSummary()` | `GET /api/loan-summary` | `{ received, approved, settled }` each with `{ count, amount, deltas }` |
| `getLoanDetail(type)` | `GET /api/loan-detail/:type` | `[{ ApplicationID, FunderName, LoanAmount }]` — type: `received \| approved \| settled` |

### Settings Integration

`DEFAULT_SETTINGS` in `App.jsx` includes:
```javascript
loanTargets: { received: 10, approved: 10, settled: 10 }
modalTaskCount: 50   // Tasks in drill-down default (Settings tab)
```
Persisted to `localStorage` key `sla_dash_settings` alongside other settings. The **Loan Targets** section in `SettingsView` renders above "SLA Targets per Team" with 3 `<input type="number">` fields (min 1, max 9999). Applying saves via the existing `onApply` → `applySettings` → `localStorage.setItem` flow.

### App.jsx State Pattern

```javascript
const [loanModal, setLoanModal]   = useState(null); // { type, label } | null
const [loanDetail, setLoanDetail] = useState({ data: [], loading: false, error: null });

const openLoanModal = useCallback((type, label) => {
  setLoanModal({ type, label });
  setLoanDetail({ data: [], loading: true, error: null });
  getLoanDetail(type)
    .then(data => setLoanDetail({ data, loading: false, error: null }))
    .catch(err  => setLoanDetail({ data: [], loading: false, error: err.message }));
}, []);
const closeLoanModal = useCallback(() => setLoanModal(null), []);
```

### Delta Color Convention for Loan Cards
- More loans = good → positive count delta uses `down` class (green), negative uses `up` class (red).
- Same convention applies to amount delta.
- This is **inverted** from the task overdue delta (where more = bad).

---

## 24. Staff List — Feature Reference (Added 2026-06-11)

A read-only informational view accessible to all authenticated users. Placed in the sidebar navigation above "User Management".

### Absent Today Table

- **Placement:** Above the existing Staff List summary table
- **Filter rule:** `WorkStatusHistory.StartedTime >= today AND < next day`
- **Absent rule:** `ConfigWorkStatus.IsAbsent = 1`
- **Columns:** Staff ID · Full Name (`FirstName + Surname`) · Department Name · Work Status Name · StartedTime · EndedTime
- **State handling:** Shows loading, error, and empty states independently from the department summary table

### Summary Table

- **Source tables:** `Department` (left join) `Staff`
- **Filter:** `d.DepartmentId IS NOT NULL`; staff counted only where `s.EmployeeStatus = 1`
- **Columns:** Department ID · Department Name · Total Staff Count
- **Order:** Highest Total Staff Count first, then alphabetical by name
- **Subtitle:** `There are total N departments in SoEzy` — N = `departments.length` (all rows returned by the query)

### Search Box

- **Placeholder:** `Search Department Name`
- **Width:** 260px (sized to display full placeholder text)
- **Position:** Between the Absent Today table and the All Departments table (below Absent Today section, above All Departments section). The Refresh button sits to the right of the search input in the same row.
- **Scope:** Filters the **All Departments** table only — matches on `departmentId` or `departmentName` (case-insensitive). Does **not** filter the Absent Today table.
- Implemented via `filtered` useMemo derived from `search` state.

### Drill-Through Modal

Triggered by clicking any department row. Uses the existing `.modal-overlay` / `.modal` CSS pattern (same as `TaskModal`/`LoanModal`).

- **Filter:** `s.DepartmentId = :id AND s.EmployeeStatus = 1` and non-null full name
- **Columns:** Staff ID · Full Name (`FirstName + Surname`) · Employee Status · IsGroup
- **Employee Status display:** Badge showing `ACTIVE` (green) — always `1` because filter requires it
- **IsGroup display:** `Yes` / `No` text

### API Endpoints

| Endpoint | Method | Auth | Returns |
|----------|--------|------|---------|
| `/api/staff/departments` | GET | JWT | `[{ departmentId, departmentName, totalStaff }]` |
| `/api/staff/absent-today` | GET | JWT | `[{ staffId, fullName, departmentName, workStatusName, startedTime, endedTime }]` |
| `/api/staff/department/:departmentId` | GET | JWT | `[{ staffId, fullName, employeeStatus, isGroup }]` |

### Frontend Components

| Component/Function | File | Purpose |
|--------------------|------|---------|
| `StaffListView` | `components/views.jsx` | Full view — summary table + drill-through modal |
| `getStaffDepartments()` | `api.js` | `GET /api/staff/departments` |
| `getStaffAbsentToday()` | `api.js` | `GET /api/staff/absent-today` |
| `getStaffByDepartment(deptId)` | `api.js` | `GET /api/staff/department/:id` |

### Navigation

- Icon: `staff-list` (person silhouette + list lines)
- Position: after the `<div className="sidebar-spacer"/>`, before User Management button
- Available to **all** authenticated users (no admin restriction)

---

## 25. Hotfix: Team ID Mapping Bug (2026-06-17)

### Problem
Drill-through modal showed correct summary statistics (e.g., "Volume: 7") but rendered an empty task table. The task rows failed to display despite the API returning 7 records.

### Root Cause
The `TEAM_ID_CASE` SQL CASE expression in `/api/tasks` was checking department-based team filters BEFORE loan-status-based team filters. When a task was assigned to a staff member with `DepartmentId=86` (Assessments team #3) but the task's loan status matched "Funder Submission" (team #6), the SQL incorrectly tagged it as team 3.

**Example:** Task 5696962 assigned to Charles (DepartmentId=86) with Funder Submission loan status:
- **Before fix:** Returned `QueueId=3, QueueName="Assessments"` in API response
- **After fix:** Returned `QueueId=6, QueueName="Funder Submission"` in API response

Frontend grouped tasks by `QueueId`, so tasks with wrong QueueId landed in the wrong team bucket, causing the modal to find zero matching tasks for team=6.

### Solution Implemented
Reordered the `TEAM_ID_CASE` and `TEAM_NAME_CASE` SQL expressions in `backend/server.js` (lines ~100-110) to enforce **loan-status filter precedence**:

```javascript
const loanStatusTeams = TEAMS.filter(t => !t.departmentId);  // teams 5-6 (CLA, Funder Submission)
const deptTeams       = TEAMS.filter(t => t.departmentId);   // teams 1-4, 7-8 (dept-based)

const TEAM_ID_CASE = [
  ...loanStatusTeams.map(t => `WHEN ${t.clsFilter} THEN ${t.id}`),
  ...deptTeams.map(t => `WHEN s.DepartmentId = ${t.departmentId} THEN ${t.id}`)
].join(' ');
```

**Precedence rule:** Check `ConfigLoanStatus` filters first; if no match, then check `Staff.DepartmentId`. This ensures that a task's loan status categorization takes precedence over its assigned staff's department.

### Verification (2026-06-17)
1. **API Response Test:** `GET /api/tasks?team=6&scope=today`
   - Before: 7 records returned with `QueueId: 3` or `4` (wrong)
   - After: 7 records returned with `QueueId: 6` (correct) ✓
   
2. **End-to-End Testing:** 
   - Logged in via browser at `http://localhost:5173`
   - Opened Funder Submission team card (shows "Volume: 7")
   - Clicked card to open drill-through modal
   - Result: Modal task table renders all 7 rows with complete data (staff name, description, status, TAT, priority) ✓

3. **Affected Tasks Verified:**
   - Task IDs: 5696962, 5696966, 5697092, 5697229, 5697232, 5697342, 5697379
   - All now correctly tagged as team 6 (Funder Submission) in API response

### Files Modified
- `backend/server.js` — Updated TEAM_ID_CASE and TEAM_NAME_CASE expressions (lines ~100-110)

### Impact Assessment
- **Dashboard:** Drill-through modals for teams 1-8 now render correctly
- **No breaking changes:** Frontend and API signatures unchanged; only internal SQL ordering modified
- **Other teams unaffected:** Department-based teams (1-4, 7-8) continue to work correctly

### Future Safeguards
1. Any new loan-status-based teams added in future must be inserted BEFORE dept-based teams in the `TEAM_ID_CASE` array
2. Test drill-through modals for teams 5 and 6 regularly in QA to catch team mapping regressions
3. Consider adding SQL logging/monitoring for TEAM_ID_CASE assignments if team routing becomes business-critical

---

## 26. Security Rules — Blocking Rules for GitHub Copilot

> **These rules are mandatory and non-negotiable.**
> If a requested action conflicts with any rule in this section, **stop work immediately, warn the user, and refuse the dangerous action** before making any changes.
> Do not silently continue. Do not make the change first and warn after. Always warn before acting.

---

### 26.1 Security First — General Principles

This project handles sensitive business data (loan figures, staff details, SLA performance). A security mistake is worse than a missing feature.

**If in doubt, stop and ask. Never guess on security.**

---

### 26.2 Blocking Rules — STOP CONDITIONS

The following are hard stops. If any requested change would trigger one of these conditions, **stop execution immediately** and alert the user.

#### RULE 1 — Never expose secrets or credentials

| Violation | STOP if… |
|-----------|----------|
| `.env` file committed to Git or GitHub | Any action that would add `.env` to a commit, push, or upload |
| Database password in source code | Any hardcoded password, connection string, or credential appearing in `.js`, `.jsx`, `.ts`, `.html`, or any file that is not `.env` |
| JWT secret in source code | `JWT_SECRET` or any secret key hardcoded outside of `.env` |
| Credentials in frontend code | Any `DB_PASSWORD`, `DB_USER`, `DB_SERVER`, or API key placed in `frontend/` files |
| Secrets in screenshots or chat | User sharing `.env` content in messages — alert them immediately |

**What to do instead:**
- Store all secrets in `backend/.env` only
- On hosting platforms (Railway, Render), use the Environment Variables panel — never a file
- Confirm `.env` is listed in `.gitignore` before any Git operation
- If a secret is accidentally exposed, tell the user to rotate (change) that credential immediately

---

#### RULE 2 — Never connect the browser directly to the database

| Violation | STOP if… |
|-----------|----------|
| SQL Server connection string in frontend | Any `mssql`, `tedious`, or direct DB connection in `frontend/` |
| Database query in frontend code | Any SQL string in `frontend/src/` files |
| Port 1433 exposed to the internet | Any code or config that opens SQL Server to public access |

**What to do instead:**
- All database access must go through `backend/server.js` API endpoints only
- The frontend only calls `/api/...` endpoints — never the database directly
- SQL Server port 1433 must only be reachable from the backend server, not from the public internet

---

#### RULE 3 — Never leak error details to users

| Violation | STOP if… |
|-----------|----------|
| Raw `err.message` returned in API response | Any `res.json({ error: err.message })` in production-facing code |
| Stack traces in HTTP responses | Any `err.stack` sent to the browser |
| Database server names or file paths in responses | Error messages that mention `DESKTOP-HGGDDCR`, `MySEReport`, file paths, or internal table names |

**What to do instead:**
```javascript
// Safe — generic message only:
res.status(500).json({ error: 'Something went wrong. Please try again.' });

// NOT this — exposes internal details:
res.status(500).json({ error: err.message }); // ← dangerous in production
```
- Log the full error on the server (console or log file), not in the HTTP response
- Users should never see database internals

---

#### RULE 4 — Never use weak or missing authentication

| Violation | STOP if… |
|-----------|----------|
| No login required to view dashboard data | Any API endpoint returning data without `requireAuth` middleware |
| Weak JWT secret | `JWT_SECRET` that is short, dictionary-based, or a common example value like `secret` or `changeme` |
| Tokens that never expire | JWT tokens with no `expiresIn` or an excessively long expiry |
| Admin endpoints accessible without admin check | `/api/admin/...` routes missing `requireAuth` + role check |

**What to do instead:**
- All data endpoints must use `requireAuth` middleware
- `JWT_SECRET` must be at least 32 characters, randomly generated
- Use `expiresIn: '8h'` or shorter for access tokens
- Admin routes must check `req.user.role === 'admin'`

---

#### RULE 5 — Never use overly permissive CORS

| Violation | STOP if… |
|-----------|----------|
| CORS set to `*` (allow all origins) | `cors({ origin: '*' })` or `Access-Control-Allow-Origin: *` in production |
| CORS allows untrusted domains | Any origin not owned by this project in the allowed list |

**What to do instead:**
```javascript
// Safe — only allow the specific frontend URL:
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
// In .env:
// ALLOWED_ORIGIN=https://your-app.vercel.app
```
- Never use `origin: '*'` in production
- Set `ALLOWED_ORIGIN` in `.env` to the exact frontend URL

---

#### RULE 6 — Never use the admin SQL account for the read-only dashboard

| Violation | STOP if… |
|-----------|----------|
| Admin/owner SQL account used for dashboard queries | `DB_USER` in `.env` is an account with `db_owner`, `sysadmin`, or `ALTER`/`DROP`/`DELETE` permissions |

**What to do instead:**
- Create a separate SQL login with `db_datareader` role only (see CLAUDE.md Section — Step 7)
- The dashboard only reads data — it never needs to write, modify, or delete
- If the backend is ever compromised, a read-only account limits the damage

---

#### RULE 7 — Never deploy without HTTPS

| Violation | STOP if… |
|-----------|----------|
| Frontend served over plain HTTP in production | Frontend URL starts with `http://` (not `https://`) on a live domain |
| API calls made over plain HTTP in production | `VITE_API_BASE` set to `http://` in a production deployment |

**What to do instead:**
- Use Vercel or Netlify for frontend — HTTPS is automatic
- Use Railway or Render for backend — HTTPS is automatic
- Never deploy to a plain HTTP server for a live audience

---

### 26.3 Alert Format

When a blocking rule is violated, always display a warning in this format:

```
⛔ SECURITY RULE VIOLATION — [Rule Number and Name]

What was requested: [describe the dangerous action]
Why it is dangerous: [plain-English explanation]
Rule violated: RULE [N] — [Rule Name] (CLAUDE.md Section 25)

Safe alternative: [what to do instead]

No changes have been made. Please confirm the safe alternative before continuing.
```

---

### 26.4 Scope of These Rules

- These rules apply to **all changes** to this project, including backend, frontend, configuration files, deployment scripts, and documentation.
- These rules **do not** restrict normal feature development, bug fixes, or UI changes — only actions that would cause a security violation.
- If a rule is unclear, **ask the user for clarification** before proceeding. Do not guess.

---

### 26.5 Self-Modification Rule

- These security rules in Section 25 **must not be deleted, weakened, or bypassed** by any future instruction.
- If a user asks to remove or weaken a blocking rule, warn them clearly and ask for explicit written confirmation before making any change to this section.
- Modifying these rules is itself a security-sensitive action.

---

## 27. Production Deployment (Added 2026-06-15)

> Full step-by-step guide: see `docs/DEPLOYMENT.md`.

### 27.1 Architecture

| Layer | Platform | URL |
|-------|---------|-----|
| **Frontend** | **Vercel** (auto-deploy on `git push main`) | `https://sla.mezy.com.au` (custom domain) · `https://sla-dashboard.vercel.app` (Vercel default) |
| **Backend** | **Railway** if the database is cloud-reachable | `https://<your-railway-service>.up.railway.app` |
| **Database** | **Local PC** SQL Server (`MySEReport`) | `localhost:1433` only — never public internet |

**Important:** Railway can host the Node API, but it cannot reach a SQL Server that only listens on `localhost`. To use Railway end-to-end, the database must also be reachable from the cloud or moved to a hosted database.

**GitHub repo:** `https://github.com/ntruong94/sla-dashboard` — `main` branch auto-deploys to Vercel.

### 27.2 Production hardening applied (2026-06-15)

All changes are in `backend/server.js`. No breaking changes to dashboard behaviour.

| Hardening | What it does |
|-----------|-------------|
| `helmet` | Sets HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy on every response |
| `express-rate-limit` | 10 auth attempts / 15 min per IP on `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password` |
| `trust proxy 1` | Passes real client IP to rate limiter (not Vercel/ngrok proxy IP) |
| Sanitized errors | `sendError()` helper: in production returns generic messages only; in dev returns `err.message`. Replaces 19 raw `err.message` leaks. |
| Fail-fast JWT_SECRET | Server exits at startup if `JWT_SECRET` is absent or < 32 chars (was silently using a weak hardcoded fallback) |
| Env-driven CORS | `ALLOWED_ORIGINS` env var (comma-separated) overrides hardcoded origin list — new frontend URLs without code changes |
| `IS_PROD` flag | `NODE_ENV === 'production'` — drives error verbosity and any future prod-only behaviour |

### 27.3 Required environment variables

**Backend (`backend/.env` — never commit):**

| Variable | Purpose |
|----------|---------|
| `DB_SERVER` | SQL Server host reachable from Railway |
| `DB_PORT` | SQL Server port (default `1433`) |
| `DB_DATABASE` | Database name |
| `DB_USER` | SQL login username |
| `DB_PASSWORD` | SQL login password |
| `JWT_SECRET` | JWT signing key — must be ≥32 chars, randomly generated |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins (optional — defaults to hardcoded list) |
| `NODE_ENV` | Set to `production` for live server |
| `PORT` | Listening port (default `5000`) |

**Frontend (Vercel Environment Variables panel — never in code):**

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE` | Full URL of the Railway backend (no trailing slash) |

See `backend/.env.example` and `frontend/.env.example` for templates.

### 27.4 Daily operations

1. Start backend: `node server.js` in `backend/` — wait for `Connected to SQL Server`
2. If using Railway, copy the generated Railway URL into `VITE_API_BASE`
3. Users open `https://sla.mezy.com.au` — log in with approved credentials

### 27.5 Optional fallback — Cloudflare Named Tunnel

Use a Cloudflare Named Tunnel running as a Windows service if you want a local-hosted backend with a stable URL. See `docs/DEPLOYMENT.md` Section 8 for setup steps.

Tunnel URL would become `https://api.sla.mezy.com.au`. Update `VITE_API_BASE` in Vercel and `ALLOWED_ORIGINS` in `backend/.env`.

---

## 28. Dynamic "Today" — `MAX(DateCreated)` Rule (Added 2026-06-19, confirmed 2026-07-16)

> **INVARIANT: There are NO hardcoded date literals anywhere in production code. "Today" is always resolved dynamically at runtime.**

### 28.1 How "today" is resolved

All date-scoped calculations (KPI tiles, team cards, deltas, alerts, tasks drill-through, history chart, loan strip) derive their reporting date from a single function: `todayLocal()` in `backend/server.js`.

```javascript
// _effectiveDate is populated by resolveEffectiveDate() at startup and every 60 min.
// Falls back to real system date if the query fails or hasn't completed yet.
function todayLocal() {
  return _effectiveDate || systemTodayLocal();
}
```

`_effectiveDate` is set by:
```javascript
async function resolveEffectiveDate() {
  // Queries: SELECT CONVERT(varchar(10), MAX(DateCreated), 120) AS maxDate FROM Tasks WITH (NOLOCK)
  // Result is cached in _effectiveDate; refreshed every 60 minutes.
  // Fallback: systemTodayLocal() (real clock) if query fails or returns no rows.
}
```

### 28.2 Why `MAX(DateCreated)` not system clock

The production database is a SQL Server restore from a point-in-time backup. The most recent task in the database may be dated `2026-05-28` even though the server clock says `2026-07-16`. Using the system clock as "today" would return zero results. Using `MAX(DateCreated)` ensures the dashboard always reflects the latest available data regardless of when the backup was taken.

Once the database is replaced with a live connection (real-time data), `MAX(DateCreated)` automatically equals today's system date — no code change required.

### 28.3 All query paths use `todayLocal()`

Every endpoint that needs a date window calls `computeDates()`:
```javascript
function computeDates() {
  const today = todayLocal();          // MAX(DateCreated) or system date
  const prev  = prevBizDay(today);     // previous business day
  ...
  return { today, prev, todayNext, prevNext, prev5, prev5Next };
}
```

`computeDates()` is called fresh inside every cache-refresh function (`fetchKpiData`, `fetchTeamsData`, `fetchHistoryData`, etc.) so dates are recalculated on every 5-minute cache cycle. A day change in the DB propagates within one cache cycle (≤ 5 min for cached endpoints, immediately for uncached ones).

### 28.4 Deployment checklist — no hardcoded dates

Before deploying, verify:
- [ ] `grep -r "2[0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]" backend/` returns only comments, not string literals in queries
- [ ] `_effectiveDate` is `null` at startup (not set to a fixed string)
- [ ] `resolveEffectiveDate()` is called in `app.listen` callback on startup
- [ ] `setInterval(resolveEffectiveDate, 60 * 60 * 1000)` is active for hourly refresh
- [ ] No `TODAY_FIXED`, `hardcoded_date`, or similar constants exist anywhere in `backend/` or `frontend/src/`
