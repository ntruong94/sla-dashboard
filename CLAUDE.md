# CLAUDE.md — SLA Dashboard Project Reference

> For: GitHub Copilot, developers, and the non-technical project owner.
> Purpose: Complete guide to what this project is, what exists, what is missing, and how to build it.

---

## 1. Project Overview

**Product:** SLA Dashboard for Mortgage Ezy Pty Ltd
**Goal:** A real-time web dashboard that shows how quickly each loan-processing team is completing their work — and whether they are meeting their SLA (Service Level Agreement) targets.
**Database:** SQL Server — database name: `SEReport`
**Status:** **Live** — backend connected to SQL Server (`DESKTOP-HGGDDCR`, DB `MySEReport`). All KPI tiles, team cards, and delta indicators show live SQL data. Servers: backend `http://localhost:5000`, frontend `http://localhost:5173`.

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

---

## 5. KPIs / SLA Metrics

> **Updated 2026-06-01:** All 4 KPI tiles now use **active tasks only** (`TaskStatusID IN (1,4,5,6)`) scoped to **today's `DateCreated`**. `TaskStatusID = 2` (completed) is no longer used for any KPI tile value or delta. All metrics answer: "What is happening right now, today vs yesterday?"

| KPI | Description | SQL Source (confirmed — live) |
|-----|-------------|------------------------------|
| Total Active Tasks | Count of active tasks created **today** across the 6 defined teams | `SUM(CASE WHEN DateCreated >= today AND DateCreated < tomorrow THEN 1 ELSE 0 END)` — `TaskStatusID IN (1,4,5,6)` |
| Overall SLA % | % of today's active tasks where `TotalHoursOnTask ≤ SLAInHours`, to 2 decimal places | `SUM(within SLA today) / NULLIF(COUNT today, 0) * 100` — `TaskStatusID IN (1,4,5,6)` |
| Avg Turnaround (TAT) | Mean `TotalHoursOnTask` of active tasks created today | `AVG(TotalHoursOnTask) WHERE DateCreated = today` — `TaskStatusID IN (1,4,5,6)` |
| Overdue / Breached | Count of today's active tasks where `TotalHoursOnTask > SLAInHours` | `SUM(CASE WHEN TotalHoursOnTask > SLAInHours THEN 1 ELSE 0 END) WHERE DateCreated = today` — `TaskStatusID IN (1,4,5,6)` |
| Per-Team Volume | Active task count per team (all active, not date-scoped) | `/api/teams` — `TaskStatusID IN (1,4,5,6)` grouped by QueueID CASE |
| Per-Team SLA % | Active task SLA compliance rate per team | Same query grouped by QueueID CASE |
| Per-Team Avg TAT | Average `TotalHoursOnTask` per team (active tasks) | Same query grouped by QueueID CASE |
| Per-Team Overdue | Overdue active task count per team | Same query grouped by QueueID CASE |

> **KPI tile status filter (all 4 tiles):** `TaskStatusID IN (1, 4, 5, 6)` = In Progress, On Hold, On Queue, Not Queued — active tasks only. `TaskStatusID = 2` (Completed) is **not used** for KPI tiles.
> **KPI date scope:** All 4 KPI values are scoped to `DateCreated >= today AND DateCreated < tomorrow` (sargable range — not `CAST(DateCreated AS DATE) = today`).
> **KPI delta scope:** today value − prev biz day value, same active-only filter, same `DateCreated` range.
> **Team scope filter (all metrics):** `FunctionID IN (SELECT FunctionID FROM ConfigFunction WHERE QueueID IN (1,2,3,4,5,6,8,16,28,44,46,47))` — restricts all KPIs to the 6 defined teams only.

---

## 6. Dashboard Teams

The dashboard maps **6 logical teams** to their `ConfigQueue.QueueId` values in the live database:

| Dashboard Name | Department | SLA Target | QueueIds |
|---------------|------------|------------|----------|
| Data Entry | Origination | 4 hours | 1 |
| Valuations | Origination | 4 hours | 3, 4 |
| Assessments | Credit | 4 hours | 2, 44, 46, 47 |
| QA | Credit | 4 hours | 28 |
| Funder Submission | Lodgement | 4 hours | 5, 6 |
| Settlements | Settlement | 4 hours | 8, 16 |

> **CONFIRMED** — QueueId mapping verified against live `ConfigQueue` table (2026-05-29).
> All tasks from other QueueIds are excluded from the dashboard.

**Backend implementation:** `TEAMS` constant in `backend/server.js` defines the mapping. A SQL `CASE` expression groups tasks into the 6 teams before aggregation. The `?team=<id>` query param on `/api/tasks` accepts team id 1–6 and expands to the correct `QueueId` list.

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
| `components/views.jsx` | **Reusable** | All 6 views defined — just needs live data props |
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

> **CONFIRMED** — All 4 KPI queries use live SQL against `MySEReport` database as of 2026-05-29.
> All metrics are scoped to the 6 defined teams via `JOIN ConfigFunction cf ON cf.FunctionID = t.FunctionID AND cf.QueueID IN (1,2,3,4,5,6,8,16,28,44,46,47)`.
> **overallSla uses TaskStatusID=2** (Completed tasks) — measures SLA compliance on finished work, not active tasks.
> **Delta fields** — `/api/kpi-summary` returns `deltas: { totalTasks, overallSla, avgTat, totalOverdue, today, prevBizDay }` — change vs previous business day. `totalTasks` uses `DateCreated`; the other three use `DateCompleted`. TODAY fixed as `'2026-05-28'`.
> **Team card deltas** — `/api/teams` now returns `deltas: { volume, sla, avgTat, overdue }` per team — same date logic. `volume` uses `DateCreated` (active tasks); `sla`, `avgTat`, `overdue` use `DateCompleted` (completed tasks, TaskStatusID=2).

```sql
-- Single query powering all 4 KPI tiles (/api/kpi-summary)
SELECT
    -- Active task metrics (In Progress, On Hold, On Queue, Not Queued)
    SUM(CASE WHEN t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END)              AS totalTasks,
        -- Avg TAT = average hours on completed tasks (TaskStatusID=2)
        AVG(CASE WHEN t.TaskStatusID = 2 THEN t.TotalHoursOnTask ELSE NULL END)
                                                                               AS avgTat,
    -- Overdue = completed tasks that exceeded their SLA (TaskStatusID=2)
    SUM(CASE WHEN t.TaskStatusID = 2 AND t.TotalHoursOnTask > t.SLAInHours
             THEN 1 ELSE 0 END)                                                AS totalOverdue,
    -- Overall SLA % = completed tasks within SLA ÷ all completed tasks × 100 (2 dp)
    CAST(SUM(CASE WHEN t.TaskStatusID = 2 AND t.TotalHoursOnTask <= t.SLAInHours
                  THEN 1 ELSE 0 END) AS FLOAT)
      / NULLIF(SUM(CASE WHEN t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100  AS overallSla
FROM Tasks t WITH (NOLOCK)
JOIN ConfigFunction cf WITH (NOLOCK) ON cf.FunctionID = t.FunctionID
WHERE (t.TaskStatusID IN (1, 4, 5, 6) OR t.TaskStatusID = 2)
  AND cf.QueueID IN (1, 2, 3, 4, 5, 6, 8, 16, 28, 44, 46, 47)

-- Delta A: Total Active Tasks — today vs previous business day (DateCreated)
SELECT
    SUM(CASE WHEN CAST(t.DateCreated AS DATE) = '2026-05-28' THEN 1 ELSE 0 END) AS todayTasks,
    SUM(CASE WHEN CAST(t.DateCreated AS DATE) = '2026-05-27' THEN 1 ELSE 0 END) AS prevTasks
FROM Tasks t WITH (NOLOCK)
JOIN ConfigFunction cf WITH (NOLOCK) ON cf.FunctionID = t.FunctionID
WHERE t.TaskStatusID IN (1,4,5,6)
  AND cf.QueueID IN (1, 2, 3, 4, 5, 6, 8, 16, 28, 44, 46, 47)
  AND CAST(t.DateCreated AS DATE) IN ('2026-05-28', '2026-05-27')

-- Delta B: SLA %, Avg TAT, Overdue — today vs previous business day (DateCompleted)
SELECT
    SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' AND t.TotalHoursOnTask > t.SLAInHours THEN 1 ELSE 0 END) AS todayOverdue,
    SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' AND t.TotalHoursOnTask > t.SLAInHours THEN 1 ELSE 0 END) AS prevOverdue,
    CAST(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
      / NULLIF(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
    CAST(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
      / NULLIF(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' THEN 1 ELSE 0 END), 0) * 100 AS prevSla,
    AVG(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' THEN t.TotalHoursOnTask ELSE NULL END) AS todayTat,
    AVG(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' THEN t.TotalHoursOnTask ELSE NULL END) AS prevTat
FROM Tasks t WITH (NOLOCK)
JOIN ConfigFunction cf WITH (NOLOCK) ON cf.FunctionID = t.FunctionID
WHERE t.TaskStatusID = 2
  AND cf.QueueID IN (1, 2, 3, 4, 5, 6, 8, 16, 28, 44, 46, 47)
  AND CAST(t.DateCompleted AS DATE) IN ('2026-05-28', '2026-05-27')

-- Per-team delta queries (run in parallel in /api/teams) ──────────────────────

-- Delta A (per team): Volume — active tasks by DateCreated, grouped by teamId
SELECT
  CASE <TEAM_ID_CASE> END AS teamId,
  SUM(CASE WHEN CAST(t.DateCreated AS DATE) = '2026-05-28' THEN 1 ELSE 0 END) AS todayVol,
  SUM(CASE WHEN CAST(t.DateCreated AS DATE) = '2026-05-27' THEN 1 ELSE 0 END) AS prevVol
FROM Tasks t WITH (NOLOCK)
INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
WHERE t.TaskStatusID IN (1,4,5,6)
  AND cf.QueueID IN (1, 2, 3, 4, 5, 6, 8, 16, 28, 44, 46, 47)
  AND CAST(t.DateCreated AS DATE) IN ('2026-05-28','2026-05-27')
GROUP BY CASE <TEAM_ID_CASE> END

-- Delta B (per team): SLA%, AvgTAT, Overdue — completed tasks by DateCompleted
SELECT
  CASE <TEAM_ID_CASE> END AS teamId,
  SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' AND t.TotalHoursOnTask > t.SLAInHours THEN 1 ELSE 0 END) AS todayOverdue,
  SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' AND t.TotalHoursOnTask > t.SLAInHours THEN 1 ELSE 0 END) AS prevOverdue,
  CAST(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
  CAST(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' THEN 1 ELSE 0 END), 0) * 100 AS prevSla,
  AVG(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-28' THEN t.TotalHoursOnTask ELSE NULL END) AS todayTat,
  AVG(CASE WHEN CAST(t.DateCompleted AS DATE) = '2026-05-27' THEN t.TotalHoursOnTask ELSE NULL END) AS prevTat
FROM Tasks t WITH (NOLOCK)
INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
WHERE t.TaskStatusID = 2
  AND cf.QueueID IN (1, 2, 3, 4, 5, 6, 8, 16, 28, 44, 46, 47)
  AND CAST(t.DateCompleted AS DATE) IN ('2026-05-28','2026-05-27')
GROUP BY CASE <TEAM_ID_CASE> END
```

| UI Element | Field | Status filter | Post-processing |
|-----------|-------|---------------|-----------------|
| Total Active Tasks KPI | `totalTasks` | `IN (1,4,5,6)` | As-is integer |
| Overall SLA % KPI | `overallSla` | `= 2` (Completed) | `toFixed(2)` → 2 decimal % |
| Avg Turnaround KPI | `avgTat` | `= 2` (Completed) | `>= 24h` → convert to days (`/ 24`, 1dp, unit `day/s`); else 1dp hours (unit `hour/s`) |
_(mapping table moved above — see updated table in section 10)_

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

---

## 17. Validation Checklist

- [x] `/api/health` returns `{ status: 'OK' }`
- [x] `/api/teams` returns teams with correct QueueId mapping
- [x] KPI numbers confirmed reasonable against live DB
- [x] Delta indicators showing on all 4 KPI tiles and all 6 team cards
- [ ] Team SLA % calculation verified against known records
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
- All 4 KPI tile deltas use `DateCreated` + active status filter `IN (1,4,5,6)` — no `TaskStatusID = 2` in KPI tiles.
- Team-card deltas: `volume` → `DateCreated` (active); `sla/avgTat/overdue` → `DateCompleted` + `TaskStatusID = 2` (completed).
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

### Parallel SQL Queries Pattern
- Use `Promise.all([query1, query2, query3])` when an endpoint needs multiple independent SQL datasets.
- Do not chain `await` calls sequentially — run them in parallel.
- See `/api/teams` (3 queries: main + delta-volume + delta-completed) as an example.
- `/api/kpi-summary` was simplified to 1 query (both today + prev biz day values in a single scan — 2026-06-01).

### Port Usage
- Backend: port **5000** (`http://localhost:5000`)
- Frontend: port **5173** (`http://localhost:5173`)
- To clear port 5000 if occupied: `Get-Process -Name node | Stop-Process -Force`
