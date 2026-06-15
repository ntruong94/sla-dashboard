# CLAUDE.md — SLA Dashboard Project Reference

> For: GitHub Copilot, developers, and the non-technical project owner.
> Purpose: Complete guide to what this project is, what exists, what is missing, and how to build it.

---

## 1. Project Overview

**Product:** SLA Dashboard for Mortgage Ezy Pty Ltd
**Goal:** A real-time web dashboard that shows how quickly each loan-processing team is completing their work — and whether they are meeting their SLA (Service Level Agreement) targets.
**Database:** SQL Server — database name: `SEReport`
**Status:** **Live** — backend connected to SQL Server (`DESKTOP-HGGDDCR`, DB `MySEReport`). All KPI tiles, team cards, and delta indicators show live SQL data. Servers: backend `http://localhost:5000`, frontend `http://localhost:5173`.

**Admin account:** `ntruong@mezy.com.au` (role: `admin`, password: `123456`). Only this account can access the User Management panel inside the dashboard to approve or reject user access requests.

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
| Settings | `/settings` | Per-team SLA target configuration || User Management | `/admin` | **Admin only** — approve / reject user access requests |
| Staff List | `/staff-list` | All departments with active staff counts; click row to drill into staff members |
---

## 5. KPIs / SLA Metrics

> **Updated 2026-06-02:** KPI and Team card calculations aligned to the Work Scope spec (SLA_Dashboard_Work_Scope.docx). Each metric uses a different status filter — see table below. All values are scoped to **`DateCreated = today`** (sargable range pattern).

| KPI | Description | Status filter | SQL logic |
|-----|-------------|---------------|-----------|
| Total Active Tasks | Count of open tasks created **today** | `IN (1,4,5,6)` active only | `SUM(... AND TaskStatusID IN (1,4,5,6))` |
| Overall SLA % | `(tasks completed within target ÷ total tasks completed) × 100` — **DateCompleted** basis | `= 2` completed only | `SUM(CASE WHEN DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 <= targetExpr THEN 1 ELSE 0 END) / NULLIF(SUM(1), 0) * 100` scoped to `DateCompleted = today` |
| Avg Turnaround (TAT) | Mean elapsed time across all tasks created today | all (1,2,4,5,6) | Open tasks: `AVG(DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0)` · Closed tasks: `AVG(DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0)` |
| Overdue / Breached | Count of **open** tasks created today that are overdue | `IN (1,4,5,6)` active only | `SUM(... AND (DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0 > targetExpr OR (SLAAdjustedDate IS NOT NULL AND GETDATE() > SLAAdjustedDate)))` |
| Per-Team Volume | Active task count per team, scoped to `DateCreated = today` | `IN (1,4,5,6)` active only | `/api/teams` query 1, grouped by DepartmentId CASE |
| Per-Team SLA % | `completed within target ÷ total completed × 100` per team — **DateCompleted** basis | `= 2` completed only | separate SLA query (Q3 in `fetchTeamsData`) using `DATEDIFF(DateCreated, DateCompleted) / 60.0 <= targetExpr`, grouped by TEAM_ID_CASE, scoped to `DateCompleted = today` |
| Per-Team Avg TAT | Mean elapsed time per team, all tasks today | all (1,2,4,5,6) | Same mixed CASE: `WHEN active THEN DATEDIFF(DateCreated, GETDATE()) ELSE DATEDIFF(DateCreated, DateCompleted)` |
| Per-Team Overdue | Open tasks past SLA target per team, today | `IN (1,4,5,6)` active only | same query 1 |

> **TAT Rule (2026-06-12 — updated from stored field to real-time computed):**
> - **Open (active) tasks:** TAT = `DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0` — elapsed calendar hours from task creation to now.
> - **Closed (completed) tasks:** TAT = `DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0` — elapsed calendar hours from creation to completion.
>
> The `TotalHoursOnTask` stored column is **no longer used** for any TAT, overdue, or at-risk calculation (it was NULL for ~98% of active tasks). All calculations now use the DATEDIFF formula.

> **Overdue Rule (2026-06-12):** A task is overdue if **either** condition is true:
> 1. Real-time TAT (`DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0`) exceeds the team's configured SLA target hours
> 2. `SLAAdjustedDate IS NOT NULL AND GETDATE() > SLAAdjustedDate` (current datetime is past the task's SLA adjusted deadline)
>
> Combined SQL condition (active tasks only):
> ```sql
> (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > ${targetExpr}
>  OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
> ```
> Applied to: KPI overdue count, KPI prev-day delta, team card overdue count, team card delta, tasks view `status='bad'` filter, alerts query `overdue` count + SLA%, alert-tasks drill-down overdue UNION branch.
> `SLAAdjustedDate` is a `datetime` column in the `Tasks` table (confirmed in `SEReport_schema.sql` line 4364).

> **At Risk Rule (2026-06-12):** A task is at risk if:
> - Real-time TAT >= `atRiskFraction × SLA target` AND TAT <= SLA target AND SLAAdjustedDate has not passed.
> - Default `atRiskFraction` = 87.5% (configurable in Settings). Applied in `/api/alert-tasks` and `/api/tasks` status CASE.
> - SQL: `DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= ${slaExpr} * ${atRiskFraction} AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= ${slaExpr}`


> **Date scope (SLA % only):** `DateCompleted >= 'YYYY-MM-DD' AND DateCompleted < 'next-day'` — uses `DateCompleted`, not `DateCreated`. See SLA% Rule below.
> **Delta scope:** today value − prev biz day value. Same per-metric date columns and status filters.
> **Team scope filter (all metrics):** `s.DepartmentId IN (101, 128, 10, 122, 86, 82) AND s.EmployeeStatus = 1` — `TEAM_FILTER` constant. All queries use `LEFT JOIN Staff s ON t.AssignedTo = s.StaffID`.

> **SLA% Rule (2026-06-12 — updated):** All SLA% figures (Overall KPI, per-team cards, history chart) use `DateCompleted` for date scoping and compute TAT as `DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0`:
> ```sql
> CAST(
>   SUM(CASE WHEN t.TaskStatusID = 2
>            AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= targetExpr
>            THEN 1 ELSE 0 END) AS FLOAT
> ) / NULLIF(SUM(CASE WHEN t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100
> ```
> Filtered by `t.DateCompleted >= 'YYYY-MM-DD' AND t.DateCompleted < 'next-day'`.
> `fetchKpiData()` runs this as a separate parallel query (Q2). `fetchTeamsData()` runs it as Q3. `fetchHistoryData()` also uses computed DATEDIFF TAT.

---

## 6. Dashboard Teams

The dashboard maps **6 logical teams** using `Staff.DepartmentId` in the live database. No `ConfigQueue.QueueId` filtering is used.

| id | Dashboard Name | Department | SLA Target | DepartmentId |
|----|---------------|------------|------------|--------------|
| 1 | Data Entry | Origination | 4 hours | 101 |
| 2 | Pre-Valuation Department | Origination | 4 hours | 128 |
| 3 | Ezy Client Care | Client Care | 4 hours | 10 |
| 4 | Packaging & QA Department | Credit | 4 hours | 122 |
| 5 | Approvals Department | Credit | 4 hours | 86 |
| 6 | Settlements Department | Settlement | 4 hours | 82 |

> **UPDATED 2026-06-11** — All 6 teams now use `Staff.DepartmentId` exclusively. `ConfigFunction.QueueID` is no longer used for team filtering.
> Staff rows are matched via `t.AssignedTo = s.StaffID`. Only Staff with `EmployeeStatus = 1` are matched by the filter. The `IsGroup` condition has been removed.
> All tasks assigned outside these 6 departments are excluded from the dashboard.

**Backend implementation:** `TEAMS` constant in `backend/server.js` defines the mapping.
- All teams use `departmentId` field — filtered via `LEFT JOIN Staff ON t.AssignedTo = s.StaffID WHERE s.DepartmentId = N AND s.EmployeeStatus = 1`
- `TEAM_FILTER` constant: `s.DepartmentId IN (101, 128, 10, 122, 86, 82) AND s.EmployeeStatus = 1`
- `TEAM_ID_CASE` SQL CASE expression maps each task → team id using `WHEN s.DepartmentId = N THEN id`
- `ConfigFunction` / `ConfigQueue` joins are not used in any aggregate query
- The `?team=<id>` query param on `/api/tasks` accepts team id 1–6 and expands to `s.DepartmentId = N`

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
| Overall SLA % KPI | `overallSla` | `= 2` completed only | `toFixed(2)` → 2 decimal % |
| Avg Turnaround KPI | `avgTat` | all (1,2,4,5,6) | `>= 24h` → days (1dp); else hours (1dp) |
| Overdue KPI | `totalOverdue` | `IN (1,4,5,6)` active only | As-is integer |
| Team Volume | `volume` | `IN (1,4,5,6)` active only | As-is integer |
| Team SLA % | `sla` | `= 2` completed only | `Math.round()` → integer % |
| Team Avg TAT | `avgTat` | all (1,2,4,5,6) | 1dp hours |
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
| `/api/loan-summary` | GET | `{ received, approved, settled }` — each: `{ count, amount, deltas: { count, amount } }`. Count of loans + total `LoanAmount` for `Date_ApplicationReceived`, `Date_FunderApproval`, `Date_Settled` today vs prev biz day. | Dashboard loan strip |
| `/api/loan-detail/:type` | GET | `[{ ApplicationID, FunderName, LoanAmount }]` — filtered to today for `type = received \| approved \| settled`. Returns rows sorted by `LoanAmount DESC`. 400 on invalid type, 500 on DB error. | `LoanModal` drill-down |
| `/api/staff/departments` | GET | `[{ departmentId, departmentName, totalStaff }]` — all departments with active staff count (`EmployeeStatus = 1`), ordered high → low. DepartmentId IS NOT NULL filter applied. | StaffListView summary table |
| `/api/staff/department/:id` | GET | `[{ staffId, fullName, employeeStatus, isGroup }]` — active staff (EmployeeStatus=1, non-null name) in one department, ordered by name. | StaffListView drill-through modal |
| `/api/admin/users` | GET | `[{ id, email, companyName, role, status, createdAt }]` — status: `pending\|approved\|rejected`. **Admin JWT required.** | AdminView user list |
| `/api/admin/users/:id/approve` | POST | `{ message }` — sets `IsApproved=1, IsRejected=0`. **Admin JWT required.** | AdminView approve button |
| `/api/admin/users/:id/reject` | POST | `{ message }` — sets `IsApproved=0, IsRejected=1`. **Admin JWT required.** | AdminView reject button |
| `/api/auth/forgot-password` | POST | `{ token, expiresIn }` — generates a 1-hour reset token stored in DB, returns it directly (no email infra). 404 if email not found/not approved. | Login "Lost password" flow |
| `/api/auth/reset-password` | POST | `{ message }` — validates token, checks expiry, updates `PasswordHash`, clears token. 400 on invalid/expired token. | Login "Set new password" form |

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

---

## 15. Remaining Work

1. ~~**`.env` file**~~ — **DONE** (credentials configured: `DESKTOP-HGGDDCR`, `MySEReport`, `ntruong`).

2. ~~**Column confirmation**~~ — **DONE** (all columns verified via live queries).

3. ~~**Real API endpoints**~~ — **DONE** (all 6 endpoints live with SQL Server queries).

4. ~~**Frontend data wiring**~~ — **DONE** (App.jsx uses live `/api/` calls; `data.js`/`history.js` mocks are bypassed).

5. **Routing** — `App.jsx` does not yet use React Router. Views are toggled by state. Full routing not yet implemented.

6. **`react-router-dom`** — Not yet installed. Run `cd frontend && npm install react-router-dom` when routing is needed.

7. **`TODAY_FIXED` date** — Set to `'2026-05-28'` (last date with actual task data in the backed-up DB snapshot — 2026-05-29 has 0 tasks). `todayLocal()` returns `TODAY_FIXED` when set; otherwise falls back to real local clock. `computeDates()` returns `{ today, prev, todayNext, prevNext }` on every cache refresh.

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
- [x] `TODAY_FIXED` set to `'2026-05-29'` (backed-up DB snapshot) — set to `null` when connecting to live data

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

### Tooltip Rule (2026-06-09)
- All shared tooltip text lives in `frontend/src/constants.js` → `TOOLTIPS` object, keyed by section (`kpi`, `team`, `chart`, `teams`, `modal`).
- Settings-specific tooltip text (Refresh interval, At Risk threshold, Tasks in drill-down) lives inline in `views.jsx`.
- **Formatting requirements for all tooltips:**
  - Use `\n` line breaks to separate sections and bullet points.
  - Use `- ` prefix for bullet lists. `white-space: pre-line` on the bubble renders them correctly.
  - Keep wording short and plain-English; avoid long paragraphs.
  - Each tooltip should cover: what the figure means, how it is calculated, any rules/thresholds, date basis where relevant.
  - If a metric depends on configurable settings (targets, At Risk threshold), mention it briefly.
- **Width:** `InfoTip` accepts an optional `width` prop (default 240px). Pass 260–300px for multi-line content to prevent awkward line breaks. `KpiTile` exposes a `tooltipWidth` prop that forwards to `InfoTip`.
- `TOOLTIPS.alerts.panel` — used on the "Active Alerts" title in both `AlertsPanel` (dashboard panel) and `AlertsView` (full Alerts page). Explains what triggers an alert (At Risk threshold breach, overdue tasks) and the two severity levels (Critical / Warning). Width 280px.

### Parallel SQL Queries Pattern
- Use `Promise.all([query1, query2, query3])` when an endpoint needs multiple independent SQL datasets.
- Do not chain `await` calls sequentially — run them in parallel.
- See `/api/teams` (2 queries in Promise.all: main stats + combined delta query) as an example.
- `/api/kpi-summary` was simplified to 1 query (both today + prev biz day values in a single scan — 2026-06-01).

### Port Usage
- Backend: port **5000** (`http://localhost:5000`)
- Frontend: port **5173** (`http://localhost:5173`)
- To clear port 5000 if occupied: `Get-Process -Name node | Stop-Process -Force`

### Settings Persistence Rule (2026-06-08, updated 2026-06-09)

> **INVARIANT: User-configured settings MUST persist across logout/login, page refresh, backend restart, and reopening the site. Settings must NEVER silently revert to defaults.**

- Settings are persisted to `localStorage` key `sla_dash_settings`.
- **Two write paths** (belt-and-suspenders):
  1. `applySettings()` calls `localStorage.setItem(...)` immediately on Apply.
  2. A `useEffect([settings])` in `App.jsx` always syncs settings to localStorage whenever the state changes — this is the safety net that ensures settings are never lost even if a single write path fails.
- **Read path:** `useState` lazy initializer in `App.jsx` reads from `localStorage` on every page load/mount. Merges with `DEFAULT_SETTINGS` so new keys added in future releases have sensible defaults without overwriting saved values.
- **Initial data load MUST use saved targets:** `useEffect([authed])` reads `settingsRef.current.targets` and passes them to `getKpiSummary`, `getTeams`, `getAlerts`, and `getHistory`. This ensures the dashboard data reflects user-configured SLA targets from the very first render, not hardcoded defaults.
- `handleLogout()` must **never** remove `sla_dash_settings` — only `sla_token` and `sla_user` are cleared on logout.
- `handleLogin()` must **never** call `setSettings()` — in-memory settings survive logout/login without a page refresh; on page refresh, the `useState` lazy initializer re-reads from `localStorage`.
- `resetSettings()` explicitly removes `sla_dash_settings` and resets `settingsRef.current` to `DEFAULT_SETTINGS` before calling `setSettings(DEFAULT_SETTINGS)`. The safety-net `useEffect([settings])` then saves defaults back. This only runs when the user explicitly clicks "Reset defaults".
- **`SettingsView` draft must not depend on `teams` for initialization** — `makeDraft(s)` uses `targets: { ...s.targets }` (sparse dict, not a teams loop). The render already falls back to `t.target` via `draft.targets[t.id] ?? t.target`. This prevents the bug where draft targets become `{}` when teams haven't loaded yet (e.g., immediately after re-login while still on the Settings tab).
- The `useEffect` in `SettingsView` that re-syncs `draft` depends only on `[settings]` — this is correct. Adding `teams` to the deps would reset in-progress edits on auto-refresh.

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

### Summary Table

- **Source tables:** `Department` (left join) `Staff`
- **Filter:** `d.DepartmentId IS NOT NULL`; staff counted only where `s.EmployeeStatus = 1`
- **Columns:** Department ID · Department Name · Total Staff Count
- **Order:** Highest Total Staff Count first, then alphabetical by name
- **Subtitle:** `There are total N departments in SoEzy` — N = `departments.length` (all rows returned by the query)

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
| `/api/staff/department/:departmentId` | GET | JWT | `[{ staffId, fullName, employeeStatus, isGroup }]` |

### Frontend Components

| Component/Function | File | Purpose |
|--------------------|------|---------|
| `StaffListView` | `components/views.jsx` | Full view — summary table + drill-through modal |
| `getStaffDepartments()` | `api.js` | `GET /api/staff/departments` |
| `getStaffByDepartment(deptId)` | `api.js` | `GET /api/staff/department/:id` |

### Navigation

- Icon: `staff-list` (person silhouette + list lines)
- Position: after the `<div className="sidebar-spacer"/>`, before User Management button
- Available to **all** authenticated users (no admin restriction)

---

## 25. Security Rules — Blocking Rules for GitHub Copilot

> **These rules are mandatory and non-negotiable.**
> If a requested action conflicts with any rule in this section, **stop work immediately, warn the user, and refuse the dangerous action** before making any changes.
> Do not silently continue. Do not make the change first and warn after. Always warn before acting.

---

### 25.1 Security First — General Principles

This project handles sensitive business data (loan figures, staff details, SLA performance). A security mistake is worse than a missing feature.

**If in doubt, stop and ask. Never guess on security.**

---

### 25.2 Blocking Rules — STOP CONDITIONS

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

### 25.3 Alert Format

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

### 25.4 Scope of These Rules

- These rules apply to **all changes** to this project, including backend, frontend, configuration files, deployment scripts, and documentation.
- These rules **do not** restrict normal feature development, bug fixes, or UI changes — only actions that would cause a security violation.
- If a rule is unclear, **ask the user for clarification** before proceeding. Do not guess.

---

### 25.5 Self-Modification Rule

- These security rules in Section 25 **must not be deleted, weakened, or bypassed** by any future instruction.
- If a user asks to remove or weaken a blocking rule, warn them clearly and ask for explicit written confirmation before making any change to this section.
- Modifying these rules is itself a security-sensitive action.

---

## 26. Production Deployment (Added 2026-06-15)

> Full step-by-step guide: see `docs/DEPLOYMENT.md`.

### 26.1 Architecture

| Layer | Platform | URL |
|-------|---------|-----|
| **Frontend** | **Vercel** (auto-deploy on `git push main`) | `https://sla.mezy.com.au` (custom domain) · `https://sla-dashboard.vercel.app` (Vercel default) |
| **Backend** | **Local PC** — exposed via **ngrok static domain** | `https://balmy-accurate-handpick.ngrok-free.app` |
| **Database** | **Local PC** SQL Server (`MySEReport`) | `localhost:1433` only — never public internet |

**Why backend stays local:** SQL Server is on the same machine. Exposing port 1433 to the internet is forbidden (RULE 2). The ngrok static domain provides a stable HTTPS URL without exposing the DB. PC must be running during work hours.

**GitHub repo:** `https://github.com/ntruong94/sla-dashboard` — `main` branch auto-deploys to Vercel.

### 26.2 Production hardening applied (2026-06-15)

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

### 26.3 Required environment variables

**Backend (`backend/.env` — never commit):**

| Variable | Purpose |
|----------|---------|
| `DB_SERVER` | SQL Server host (e.g. `localhost`) |
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
| `VITE_API_BASE` | Full URL of the backend tunnel (no trailing slash) |

See `backend/.env.example` and `frontend/.env.example` for templates.

### 26.4 Daily operations

1. Start backend: `node server.js` in `backend/` — wait for `Connected to SQL Server`
2. Start ngrok: `ngrok http --domain=balmy-accurate-handpick.ngrok-free.app 5000`
3. Users open `https://sla.mezy.com.au` — log in with approved credentials

### 26.5 Upgrade path — Cloudflare Named Tunnel (recommended)

Replace the ngrok manual step with a Cloudflare Named Tunnel running as a Windows service — auto-starts on boot, reconnects after network interruptions. See `docs/DEPLOYMENT.md` Section 7 for setup steps.

Tunnel URL would become `https://api.sla.mezy.com.au`. Update `VITE_API_BASE` in Vercel and `ALLOWED_ORIGINS` in `backend/.env`.
