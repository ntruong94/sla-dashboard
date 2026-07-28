# CLAUDE.md — SLA Dashboard Specification

> **Audience:** GitHub Copilot, developers, project owner.
> **Purpose:** Authoritative current-state reference. All rules here reflect live, implemented behaviour.

---

## 0. MUST Rule — Admin Settings Instant Propagation (MANDATORY)

> **This rule is authoritative and must never be weakened.**

When an admin saves **any** setting in the Settings tab (SLA targets, team order, hidden teams, loan targets, at-risk threshold, or any future admin-managed setting), **all connected dashboard sessions must reflect the change immediately — no manual page refresh required for any user (admin or viewer).**

### Requirements

| # | Requirement | Detail |
|---|---|---|
| 1 | **Immediate propagation** | On successful admin save, all affected dashboard data and ordering must refresh/recompute instantly. No manual page refresh required for viewers or admins. |
| 2 | **Full scope** | Changes must apply to ALL settings-driven components and metrics: team cards, KPI tiles, charts (trend + history), tables (All Teams, All Tasks), drill-through modals/popups, alerts panel, loan strip, and all aggregates. |
| 3 | **Atomic consistency** | All components must switch to the updated settings state together — no partial stale state where one component shows the old target while another shows the new one. |
| 4 | **Persistence** | Re-login or page refresh must load the latest saved admin configuration. Admin settings are the authoritative source; per-user settings never override them. |

### Constraints

- **Do not** change UI design or format when implementing or modifying this rule.
- **Do not** change any unrelated logic.
- **Do not** make any of these settings per-user-only.
- **Do not** remove or weaken the `broadcastSettingsChanged()` call or the `settings-changed` SSE listener.

### Implementation

| Requirement | Implementation |
|---|---|
| Instant propagation on admin save | `PUT /api/admin/settings` calls `broadcastSettingsChanged()` which sends a `settings-changed` SSE event to all connected clients |
| Viewer sessions update without polling delay | SSE listener in App.jsx catches `settings-changed`, calls `getGlobalSettings()`, applies `applyGlobalConfig()`, then calls `refreshData()` |
| All components update together | `applyGlobalConfig` patches the single `settings` state; all useMemos (`teamsDisplay`, `effectiveKpi`, `tasksByTeam`, etc.) recompute atomically |
| Scope | `targets` (SLA hours per team), `loanTargets`, `atRiskPct`, `refreshMin`, `modalTaskCount`, `hiddenTeams`, `groupOrder` — all stored in `GlobalSettings` |
| Fallback | 15-second poll on `GET /api/settings` version check also calls `refreshData()` — covers SSE-disconnected sessions |
| Re-login consistency | All GlobalSettings fields are loaded and merged via `applyGlobalConfig` on every login and page refresh |

### Enforcement (automated — runs on every commit)

A `pre-commit` git hook in `.git/hooks/pre-commit` runs `check-must-rules.js` before every `git commit`. The script performs static analysis and **blocks the commit** if any of the following structural invariants are missing:

| Check | File | Pattern required |
|-------|------|-----------------|
| `broadcastSettingsChanged` function defined | `server.js` | `function broadcastSettingsChanged(` |
| Called inside `PUT /api/admin/settings` handler | `server.js` | handler body contains `broadcastSettingsChanged()` |
| SSE event uses `settings-changed` name | `server.js` | `event: settings-changed` |
| SSE listener registered for `settings-changed` | `App.jsx` | `addEventListener('settings-changed', ...)` |
| `applyGlobalConfig` called in that listener | `App.jsx` | within 500 chars of listener |
| `refreshData()` called after apply | `App.jsx` | within 800 chars of listener |

Run manually at any time:
```powershell
# From backend/
npm run check-must        # MUST Rule only
npm run check-all         # date literals + MUST Rule (full pre-commit suite)
```

**CI must run `npm run check-all` before deploying** — if it exits non-zero, abort the deploy.

---

## 1. Project Overview

| Item | Value |
|------|-------|
| Product | SLA Dashboard — Mortgage Ezy Pty Ltd |
| Goal | Real-time view of loan-processing team SLA performance |
| Backend URL | `http://localhost:5000` |
| Frontend URL | `http://localhost:5173` |
| Database | SQL Server — server `DESKTOP-HGGDDCR`, DB `MySEReport`, user `ntruong`, port 1433 |
| Credentials file | `backend/.env` — never commit to Git |

**Admin account:** Auto-seeded on first backend start. Looks for `Staff.FirstName = 'System'` → uses that record's `EmailAddress` + default password `@dmin`. Only admins can access User Management and global team settings.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express 5 + mssql |
| Database | SQL Server (MySEReport) |
| Auth | JWT (`sla_token` in localStorage, 8h expiry) |
| Deployment | Frontend → Vercel; Backend → local or Railway |

Views are toggled by state in `App.jsx` (no React Router installed yet).

---

## 3. Dashboard Views

| View | Description |
|------|-------------|
| Dashboard | Loan strip · KPI tiles · Team cards · 7-day trend · Alerts panel |
| All Teams | Table of all teams sorted by SLA% |
| All Active Tasks | Full task list with team + status + search filters |
| Reports | Historical SLA compliance chart, date-range selector, stats table |
| Active Alerts | Alert feed with per-team drill-through |
| Settings | Per-team SLA targets, at-risk threshold, team order/visibility, loan targets |
| Staff List | Departments + absent-today table; click row → staff modal |
| User Management | Admin only — registered users list with Remove action |

---

## 4. Codebase Structure

```
SLA Dashboard/
├── backend/
│   ├── server.js          ← All API endpoints + SQL logic
│   ├── db.js              ← SQL Server connection (env-driven)
│   ├── .env               ← DB credentials + FORCE_TODAY override
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx        ← State, normalizeTask(), routing logic
│   │   ├── api.js         ← All fetch helpers
│   │   ├── constants.js   ← TOOLTIPS object, TEAM_COLORS proxy
│   │   ├── chartUtils.js  ← computePctAxis()
│   │   └── components/
│   │       ├── components.jsx   ← KpiTile, TeamCard, TaskRow, TaskModal, AlertsPanel, LoanKpiTile, LoanModal
│   │       ├── views.jsx        ← All view components
│   │       ├── trend.jsx        ← 7-day SVG trend chart
│   │       ├── history-chart.jsx← Multi-line SVG history chart
│   │       ├── utils.js         ← parseDMY, sortRows, useSortState, SortTh, fmtHMS
│   │       └── icons.jsx
│   ├── styles.css
│   └── styles-views.css
└── docs/
    └── CLAUDE.md
```

---

## 5. Database — Key Fields

### Tasks table (primary source)

| Field | Type | Meaning |
|-------|------|---------|
| `TaskID` | int | Primary key |
| `ConfigTaskId` | int | Links to `ConfigTasks` (team grouping) |
| `TaskStatusID` | int | 1=InProgress, 2=Completed, 4=OnHold, 5=OnQueue, 6=NotQueued |
| `AssignedTo` | int | FK → `Staff.StaffID` |
| `SLAInHours` | real | Per-task SLA target (hours) |
| `TotalHoursOnTask` | real | **Business-hours time spent on task** — used for all TAT, overdue, and SLA calculations |
| `TotalHoursOnHold` | real | Hours task has been on hold |
| `SLAAdjustedDate` | datetime | Extended deadline. Overdue condition B fires when `GETDATE() > SLAAdjustedDate` |
| `DateCreated` | datetime | Task creation timestamp — primary date scope for all metrics |
| `DateCompleted` | datetime | Completion timestamp — used only for Overall KPI SLA%, history chart, and completed-tasks drill-through |
| `Priority` | varchar | `high` / `med` / `low` |
| `ApplicationID` | int | Loan application reference |

> **`TotalHoursOnTask` is the single TAT field used everywhere.**

### Other tables used

| Table | Purpose |
|-------|---------|
| `ConfigTasks` | `UsedForKPI` + `SpecifiedKPIGrp` — drives team grouping Rule 1 |
| `Staff` | `StaffID`, `FirstName`, `Surname`, `DepartmentId`, `EmployeeStatus` |
| `Department` | `DepartmentId`, `Name` — drives team grouping Rule 2 |
| `ConfigTaskStatus` | Maps `TaskStatusID` → display name |
| `Loans` | `ApplicationID`, `LoanAmount`, `Date_ApplicationReceived`, `Date_FunderApproval`, `Date_Settled` |
| `WorkStatusHistory` + `ConfigWorkStatus` | Absent-today staff feed (`IsAbsent = 1`) |
| `ConfigReportUsers` | Dashboard user accounts + `UserSettings NVARCHAR(MAX)` |
| `ConfigDashboards` | `GlobalSettings NVARCHAR(MAX)` — team order + hidden teams |
| `DashboardAccess` | Links user → approved access |

---

## 6. Team Discovery (Dynamic — No Hardcoding)

> **NEVER hardcode team names, IDs, department IDs, or `SpecifiedKPIGrp` patterns. All teams are discovered from the DB every 60 seconds.**

Teams come from two sources:

| Source | Type | ID formula |
|--------|------|-----------|
| `ConfigTasks WHERE UsedForKPI=1` + distinct non-empty `SpecifiedKPIGrp` | **KPI team** (`isKpi:true`) | `nameToTeamId(name)` → djb2 hash in [1000, 8999] |
| `Department` JOIN `Staff WHERE EmployeeStatus=1` (at least 1 active staff) | **Dept team** (`isDept:true`) | `DepartmentId + 10000` |

**Grouping priority (all queries, charts, tables):**
1. **Rule 1 (PRIORITY):** Task has `ct.UsedForKPI = 1` AND non-empty `ct.SpecifiedKPIGrp` → group by exact `SpecifiedKPIGrp` value.
2. **Rule 2 (FALLBACK):** Task has `ct.UsedForKPI IS NULL` AND `ct.SpecifiedKPIGrp IS NULL/empty` → group by `s.DepartmentId` (requires `s.EmployeeStatus = 1`).

Rules are mutually exclusive — a task is never counted twice. Tasks matching neither rule are excluded entirely.

**Key backend functions in `server.js`:**
- `refreshAllTeams()` — called at startup + every 60 s; populates `_allTeams`
- `getAllTeams()` — returns current `_allTeams`
- `getTeamIdCase()` — builds SQL CASE (Rule 1 first, then Rule 2)
- `getTeamFilter()` — builds WHERE condition admitting both rules
- `buildTargetExpr(customTargets)` — CASE expression for team-configured SLA target, falls back to `t.SLAInHours`
- `CONFIG_TASKS_JOIN` — `LEFT JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId`

Default SLA target = **4 hours** per team. Overridable per team in Settings.

---

## 7. Date / Time Rules

### Global Date/Time Rule (Mandatory)

> **All "current date / now" values must come from runtime sources. Hardcoded `YYYY-MM-DD` literals are prohibited in production code.**

| Context | Correct source | Prohibited |
|---------|---------------|-----------|
| SQL date-range params (backend) | `todayLocal()` → `computeDates()` | Literal `'2026-05-28'` in source |
| SQL real-time comparisons (overdue, at-risk) | `getNowSql()` → `GETDATE()` | `GETDATE()` hard-wired as string |
| Frontend real-time overdue check | `Date.now()` / `new Date()` (runtime) | Literal date strings in `.jsx`/`.js` |
| Testing date override | `FORCE_TODAY=YYYY-MM-DD` in `backend/.env` only | Any other location |

**Guardrails** — run before every commit and before every deployment:

```powershell
# From backend/
npm run check-dates
```

- `backend/check-hardcoded-dates.js` scans `server.js` + key frontend files (`App.jsx`, `api.js`, `components.jsx`, `views.jsx`, `constants.js`).
- Exits `1` and blocks the commit if any quoted `YYYY-MM-DD` literal is found on a non-comment line.
- A `pre-commit` git hook in `.git/hooks/pre-commit` runs this check automatically on every `git commit`.
- **CI must run `npm run check-dates` before deploying** — if it exits non-zero, abort the deploy.

**Legitimate runtime uses that are NOT flagged:**
- `Date.now()`, `new Date()`, `setInterval(() => setNow(new Date()), 1000)` — these are live clock reads, not hardcoded dates.
- `FORCE_TODAY` value in `.env` — excluded from scanning (`.env` is never committed).

### Current date source (backend implementation)

```javascript
function systemTodayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
const todayLocal = () =>
  (process.env.FORCE_TODAY && /^\d{4}-\d{2}-\d{2}$/.test(process.env.FORCE_TODAY))
    ? process.env.FORCE_TODAY
    : systemTodayLocal();
```

- `todayLocal()` = system wall clock date (local time, not UTC) unless `FORCE_TODAY` is set.
- **`FORCE_TODAY` in `backend/.env`** overrides the date for testing (e.g. `FORCE_TODAY=2026-05-28`). Remove it for live operation.
- `prevBizDay()`: Mon → Fri (−3d), Sun → Fri (−2d), else −1d.
- All date range SQL params use sargable pattern: `col >= 'YYYY-MM-DD' AND col < 'next-day'` — never `CAST(col AS DATE)`.
- Real-time comparisons (overdue, at-risk) use `GETDATE()` via `getNowSql()` — evaluated by SQL Server at query time.
- **Never pass date boundaries as `sql.DateTime` objects** — the mssql driver serialises JS `Date` objects in UTC, which shifts the boundary by the local UTC offset (e.g. AEST UTC+10 shifts by 10 h). Always compute `YYYY-MM-DD` strings manually (same pattern as `computeDates()`) and interpolate them directly into the SQL string: `AND col >= '${startDateStr}' AND col < '${endDateStr}'`. `fetchHistoryData()` uses this pattern for `startDateStr`/`endDateStr`.

### Date scope per metric

| Metric | Date column | Scope |
|--------|------------|-------|
| Total Active Tasks, Avg TAT, Overdue, Team Volume, Per-team TAT/Overdue | *(none — `TaskStatusID` filter only)* | all active tasks |
| Overall KPI SLA%, Overall SLA% delta | `SLAAdjustedDate` | today |
| Per-team card SLA%, history chart | `SLAAdjustedDate` | today |
| Completed-tasks drill-through (SLA badge) | `SLAAdjustedDate` | today |
| SLA deltas (per-team card, overall KPI) | `SLAAdjustedDate` (same as SLA metric) | prev biz day |
| Volume, TAT, Overdue deltas | *(n/a — always 0; no date filter to compare against)* | — |

---

## 8. Metric Calculations

### Task status filters

| Filter | StatusIDs | Used for |
|--------|-----------|---------|
| Active | `IN (1,4,5,6)` | Volume, TAT, Overdue, At-Risk |
| Completed | `= 2` | SLA%, completed drill-through |

### Overdue rule — active tasks

A task is **OVERDUE** when it is active (`TaskStatusID IN (1,4,5,6)`) AND **any** of:

| Condition | Fires when |
|-----------|-----------|
| **A** `TotalHoursOnTask > SLAInHours` | TAT is non-null and non-zero |
| **B** `GETDATE() > SLAAdjustedDate` | `SLAAdjustedDate IS NOT NULL` — fires **regardless of TAT value, including null/0** |
| **C** `TotalHoursOnTask > teamTargetHours` | TAT is non-null and non-zero; team target from Settings |

**Canonical SQL:**
```sql
AND ((t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0
      AND (t.TotalHoursOnTask > t.SLAInHours OR t.TotalHoursOnTask > ${targetExpr}))
     OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
```

**Frontend `normalizeTask()` — active tasks (condition B checked FIRST):**
```javascript
const condB = adjTs != null && Date.now() > adjTs;   // fires even when tatH is null/0
if (tatH == null || tatH === 0) {
  status = condB ? 'bad' : 'ok';
} else {
  const condA_C = (taskSlaH > 0 && tatH > taskSlaH) || tatH > slaH;
  status = (condA_C || condB) ? 'bad' : pct >= atRisk ? 'warn' : 'ok';
}
```

> A task with no TAT but a passed `SLAAdjustedDate` correctly shows as Overdue in both SQL and frontend.

### Overdue rule — completed tasks (SLA badge drill-through only)

Overdue when: `TotalHoursOnTask > SLAInHours` OR `DateCompleted > SLAAdjustedDate`.
Do **not** apply the active-task three-condition rule here.

### At-Risk rule

```sql
DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= slaExpr * atRiskFraction
AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= slaExpr
AND NOT (overdue condition)
```
- Default `atRiskFraction` = 87.5% — configurable in Settings.
- At-risk UNION branch explicitly excludes overdue tasks to prevent double-counting.

### TAT (Avg Turnaround) rule

| Context | Field | Exclusions |
|---------|-------|-----------|
| KPI tile, team cards, deltas | `TotalHoursOnTask` — active tasks only | Null and 0 excluded from avg |
| TAT vs Target column (all active tables) | `TotalHoursOnTask` | Shows `-` when null; no 0-substitution |
| Completed-tasks drill-through primary | `TotalHoursOnTask` when positive (> 0) | — |
| Completed-tasks drill-through fallback | `(DateCompleted − DateCreated)` in hours | Used when primary is null/0/negative |

- **Display format:** `h:mm:ss` via `fmtHMS()` in `utils.js`.
- **TAT bar target:** team's configured SLA target from Settings (default 4h). Per-task `SLAInHours` is not used as the bar target.
- **Cell format:** `X.Xh / Xh target` when non-null; `/ Xh target` right-aligned when null.

### SLA % rule

**Overall KPI SLA% and history chart** — `SLAAdjustedDate` scope (tasks whose adjusted SLA deadline falls today). Compliant when either:
1. `DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 <= targetExpr`
2. `SLAAdjustedDate IS NOT NULL AND DateCompleted <= SLAAdjustedDate`

**Per-team card SLA%** — `SLAAdjustedDate` scope. Compliant when both:
1. `TotalHoursOnTask IS NULL OR TotalHoursOnTask <= SLAInHours`
2. `SLAAdjustedDate IS NULL OR DateCompleted <= SLAAdjustedDate`

```sql
CAST(SUM(CASE WHEN t.TaskStatusID = 2
              AND t.SLAAdjustedDate >= @today AND t.SLAAdjustedDate < @todayNext
              AND (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask <= t.SLAInHours)
              AND (t.SLAAdjustedDate IS NULL OR t.DateCompleted <= t.SLAAdjustedDate)
         THEN 1 ELSE 0 END) AS FLOAT)
/ NULLIF(SUM(CASE WHEN t.TaskStatusID = 2
                  AND t.SLAAdjustedDate >= @today AND t.SLAAdjustedDate < @todayNext
             THEN 1 ELSE 0 END), 0) * 100
```

The history chart uses this same per-team formula so chart values always match team cards.

### Delta rule

- **Active-task deltas (volume, overdue, avgTat):** Always `0` — no date boundary to compare against when the metric covers all active tasks regardless of creation date.
- **SLA% delta:** today value − prev biz day value. Date column (`SLAAdjustedDate`) and status filter are identical to the main SLA% metric.
- **Loan deltas:** computed normally (today vs yesterday, today vs 5 biz days ago).

### Delta colour convention

| Delta direction | CSS class | Colour |
|----------------|-----------|--------|
| Up (worse) — more overdue, higher TAT | `up` | Red (`var(--bad)`) |
| Down (better) — fewer overdue, lower TAT | `down` | Green (`var(--ok)`) |
| Volume (neutral) | `neutral` | Muted grey |
| Loan count/amount — more = good | inverted: positive = `down` | Green for positive |

Delta hidden when value = 0.

---

## 9. API Endpoints

All data endpoints require a valid JWT (`Authorization: Bearer <token>`).

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/health` | GET | `{ status: 'OK', mode: 'live' }` |
| `/api/kpi-summary` | GET | `{ totalTasks, overallSla, avgTat, totalOverdue, deltas }` |
| `/api/teams` | GET | `[{ id, name, dept, target, volume, sla, avgTat, overdue, deltas, taskCodes, fallbackDeptId }]` |
| `/api/tasks` | GET | Task array — params: `?team=`, `?status=active\|completed`, `?scope=today`, `?atRiskPct=`, custom target params |
| `/api/history` | GET | `{ dates[], byTeam: { teamId: [sla%] } }` — param: `?range=7d\|30d\|90d\|180d\|400d` |
| `/api/alerts` | GET | Alert array |
| `/api/alert-tasks/:teamId` | GET | Top 50 overdue + at-risk tasks (UNION ALL) |
| `/api/loan-summary` | GET | `{ received, approved, settled }` each with `{ count, amount, deltas, deltas5 }` |
| `/api/loan-detail/:type` | GET | `[{ ApplicationID, FunderName, LoanAmount }]` — type: `received\|approved\|settled` |
| `/api/loan-trend/:type` | GET | `[{ date, count, amount }]` × 30 days — daily aggregates for sparklines; missing days filled with zero |
| `/api/staff/departments` | GET | `[{ departmentId, departmentName, totalStaff }]` |
| `/api/staff/absent-today` | GET | `[{ staffId, fullName, departmentName, workStatusName, startedTime, endedTime }]` |
| `/api/staff/department/:id` | GET | `[{ staffId, fullName, employeeStatus, isGroup }]` |
| `/api/settings` | GET | `{ hiddenTeams, groupOrder, targets, loanTargets, atRiskPct, version }` |
| `/api/user/settings` | GET/PUT | Per-user settings JSON (refreshMin, modalTaskCount only) |
| `/api/admin/settings` | PUT | Admin: save `{ hiddenTeams, groupOrder, targets, loanTargets, atRiskPct }` — broadcasts `settings-changed` SSE to all clients |
| `/api/admin/users` | GET | All approved users |
| `/api/admin/users/:id` | DELETE | Remove user |
| `/api/auth/login` | POST | `{ token }` |
| `/api/auth/signup` | POST | Requires `email` + `password` — must match active `Staff` record |
| `/api/auth/forgot-password` | POST | Returns reset token directly |
| `/api/auth/reset-password` | POST | Validates token, updates password |
| `/api/events` | GET (SSE) | Event stream — JWT via `?token=` query param |

---

## 10. Caching & Performance

- `fetchKpiData()` and `fetchTeamsData()` cached in `_cache` with **5-minute TTL**.
- Stale-while-revalidate: stale data served immediately, background refresh queued.
- Pre-warmed at startup before first user request.
- `requestTimeout` in `db.js` = **180 000 ms** to survive cold SQL Server buffer-cache scans.
- Warm query latency: ~165 ms. Cold scan (after DB restart): up to ~115 s.

---

## 11. Auto-Refresh (SSE + Polling)

- Browser connects to `/api/events` (SSE) on login. JWT passed as `?token=`.
- Backend polls DB fingerprint every **30 seconds**:
  ```sql
  SELECT COUNT(*) AS n, ISNULL(SUM(CAST(TaskStatusID AS BIGINT)*3 + TaskID%997),0) AS chk
  FROM Tasks WITH (NOLOCK)
  WHERE TaskStatusID IN (1,2,4,5,6) AND DateCreated >= '<today>' AND DateCreated < '<tomorrow>'
  ```
- Fingerprint change → invalidate cache → broadcast `data-changed` → frontend debounces 200 ms → `refreshData()`.
- Admin settings save → broadcast `settings-changed` → frontend calls `getGlobalSettings()`, applies `applyGlobalConfig()`, calls `refreshData()` — **instant, no poll delay**.
- `:keepalive` comment sent every 25 s prevents proxy timeouts.
- Fallback: `settings.refreshMin` interval (default 5 min).
- Tab visibility: `refreshData()` fires immediately when tab becomes visible.
- Race guard: `refreshSeqRef` (useRef) discards stale concurrent responses.
- History chart is **not** in the auto-refresh cycle.

---

## 12. Settings Persistence

### Per-user
Stored in `ConfigReportUsers.UserSettings NVARCHAR(MAX)` (DB source of truth) + `localStorage` key `sla_dash_settings_<email>` (fast-load cache).

Contains the full settings snapshot for fast-load on login. All dashboard-affecting values are overwritten by global config on every login and every `settings-changed` SSE event.

> **All dashboard-affecting settings are global (admin-controlled)** — see below.

### Global team config (admin-only writes, all-users reads)
Stored in `ConfigDashboards.GlobalSettings NVARCHAR(MAX)`.

Includes: `hiddenTeams`, `groupOrder`, **`targets` (per-team SLA hours)**, **`loanTargets`**, **`atRiskPct`**, **`refreshMin`**, **`modalTaskCount`**, `version`.

**Propagation:** Admin saves → `broadcastSettingsChanged()` fires immediately → all connected SSE sessions receive `settings-changed` event → reload GlobalSettings + apply `applyGlobalConfig()` + call `refreshData()`. No page reload, no poll delay.

**Key invariants:**
- Logout removes only `sla_token` + `sla_user` — settings keys are never touched.
- `setAuthed(true)` called only after both per-user settings and global config are loaded.
- `SettingsView` draft initialises from `settings` state only (not `teams` prop) — prevents reset on auto-refresh.
- Hidden teams are filtered frontend-only — backend always returns all teams.
- KPI tile SLA% and Avg TAT when teams are hidden = simple average of visible team card values (not volume-weighted).

### Team order
`teamsDisplay` useMemo applies `groupOrder` sort after filtering hidden teams. Teams not in `groupOrder` append in natural backend order (stable sort).

**Active Alerts ordering:** `visibleAlerts` useMemo applies the same `groupOrder` sort as `teamsDisplay`. Alert cards on the dashboard panel and the Active Alerts tab always appear in the same sequence as the admin-configured team order. Sort is derived from the index position of each team in `teamsDisplay` (keyed by `queueId`).

**Active Alerts SLA targets:** `AlertsView` (Active Alerts tab) receives `customTargets={settings.targets}` and `atRiskPct={settings.atRiskPct}` from `App.jsx` and forwards them to `AlertsPanel`, which passes each team's configured target to `getAlertTasks()` via `customTargets[queueId]`. This ensures the TAT vs Target column and overdue/at-risk detection in the drill-through table reflect admin-configured targets, not the hardcoded 4h default.

---

## 13. Drill-Through Rules

### Task name display
Primary: `StaffFullName` = `RTRIM(ISNULL(s.FirstName,'') + ISNULL(' '+s.Surname,''))` via `LEFT JOIN Staff`.
Fallback: `TaskName` → `ShortDescription` → `'Task #<id>'`.

### Column set — active tasks (TaskModal, TasksView, AlertsPanel)
Task ID · App ID · Create Dte · SLAAdjusted Dte · Description · SLA (hours) · On hold (hours) · On task (hours) · Current · Status · TAT vs Target · Priority

### Column set — completed tasks (SLA badge drill-through)
Task ID · App ID · SLAAdjusted Dte · **Completed Dte** · Description · SLA (hours) · On hold (hours) · On task (hours) · Current · Status · TAT vs Target · Priority
*(Create Dte removed; Completed Dte added after SLAAdjusted Dte)*

### Column widths — drill-through modals
90px · 100px · 100px(wrap) · 110px(wrap) · 25% · 65px(wrap) · 70px(wrap) · 70px(wrap) · 100px · 90px · 160px · 70px

### Column widths — TasksView (All Active Tasks page)
90px · 100px · 100px(wrap) · 110px(wrap) · 25% · 65px(wrap) · 70px(wrap) · 70px(wrap) · 110px · 120px · 90px · 160px · 70px

### Date cell format
Two stacked lines: date (`DD/MM/YYYY`) on top, time (`HH:MM:SS`) below.
SQL: `CONVERT(VARCHAR(10), col, 103) + ' ' + CONVERT(VARCHAR(8), col, 108)`.
Never truncate seconds with `LEFT(...,5)`.

### Other rules
- All `<td>` cells: `whiteSpace:'nowrap'` except Description. Date/On-hold/On-task `<th>` headers use `whiteSpace:'normal'`.
- Modal width: `.modal` = `95vw`.
- Summary chips order (active tasks): **Volume → SLA% → Avg TAT → Overdue**
- AVG TAT chip value: `h:mm:ss` format, always `color: '#111'` (never inherits danger red).

### SLA % badge click (completed-tasks modal)
- Opens `TaskStatusID = 2` tasks scoped to `DateCreated = today`.
- Modal background `#D3D3D3` (grey); table area `#fff`.
- Title word "COMPLETED" rendered in red (`var(--bad)`), `fontWeight:700`.
- Summary chips: SLA% · Total Completed · On-Time · Overdue · Avg TAT (all from returned rows).
- Badge gets class `badge--sla-trigger`, `boxShadow: '0 2px 10px rgba(0,0,0,0.22)'`; hover darkens 30%.

### TaskModal breadcrumb
Shows `'Department Group' · SLA target Xh` or `'KPI Group' · SLA target Xh`. Raw `dept` value is not shown.

### TasksView search boxes
Two inputs in top-right of page header: **Task ID** (130px) and **App ID** (110px). Both stack with team + status filters.

---

## 14. Column-Header Sorting

Clickable in all 10 tables. Cycle: asc → desc → reset (3rd click). Inactive arrow at 25% opacity.

**Type-aware:** Numbers → numeric; dates (`DD/MM/YYYY HH:MM:SS`) → `parseDMY()` timestamp; text → `localeCompare`. Nulls always sort to bottom.

Tables: TeamsView, TasksView, ReportsView stats, StaffListView (absent + depts + staff modal), TaskCodesView, AdminView, TaskModal, AlertDrillTable.

**Utilities in `utils.js`:** `parseDMY`, `sortRows`, `useSortState`, `SortTh`.
`SortTh` uses `React.createElement` (file is `.js` not `.jsx`).

---

## 15. Chart Rules

Applies to `trend.jsx` and `history-chart.jsx`.

- Y-axis auto-scales via `computePctAxis()` from `chartUtils.js`. Never hardcode `yMin/yMax`.
- Y-axis re-fits on legend toggle — pass only undimmed series to `computePctAxis()`.
- All data graphics clipped to inner plot area via `<clipPath>` with unique id from `React.useId()`.
- Skip dots outside `[yMin, yMax]`.
- Target bands clipped; only drawn where they intersect visible Y range.
- Chart lines: `strokeWidth="2.5"`. Dots: `r=4`, hover `r=6`.
- Hover tooltips: `ReactDOM.createPortal(..., document.body)`, `position:'fixed'`, `zIndex:9998`.

---

## 16. Tooltip Rules

### Content source
`frontend/src/constants.js` → `TOOLTIPS` object (sections: `kpi`, `team`, `chart`, `teams`, `modal`, `alerts`, `loan`).
Settings-specific inline tooltips (Refresh interval, At Risk threshold, Tasks in drill-down) live in `views.jsx`.

> **Source of truth for tooltip text:** `docs/SLA_Dashboard_Tooltips.xlsx` — Column D contains the authoritative tooltip text for all 24 keys. When updating tooltip content, edit Column D in the xlsx first, then run `node docs/patch-tooltips.js` from the project root to propagate changes to `constants.js`. Formatting is preserved exactly as written in Column D (same indentation, line breaks, spacing, punctuation, and capitalisation).

### Text formatting standards

| Rule | Requirement |
|------|-------------|
| Section separator | `\n\n` between every section |
| Bullet lists | `\n-` prefix per item |
| Line rendering | `white-space: pre-line` — never use `<br>` or HTML |
| Trailing spaces | None — no trailing space before `\n` |
| Sentence endings | Every section ends with a full stop `.` |
| Capitalization | Section labels title-case: `Includes:` `Excluded:` `Date basis:` `Rules:` `Formula:` |
| Settings sentence | Affected metrics end with `Target is configurable per team in Settings.` |

**Section structure by metric type:**

| Type | Sections |
|------|---------|
| Active-task metrics (Volume, TAT, Overdue) | Meaning → Rules (if any) → Includes → Excluded → Date basis |
| SLA metrics | Meaning → Formula → Rules (colour bands) → Includes → Excluded → Date basis |
| Charts | Meaning → Rules → Includes → Excluded → Date basis → Interactions |
| Alerts panel | Numbered explanation → Settings note |
| Loan metrics | Meaning → Date column note → Click action |

**Wording standards:**
- Plain English for business users — avoid internal jargon where possible.
- Use `task's own SLAInHours` (not `SLAInHours`) and `team's SLA target in Settings` (not `Setting tab`) for consistency.
- `Includes:` and `Excluded:` use complete sentences or comma lists ending with `.`
- Avoid `"avg TAT = avg"` (redundant) → use `"Avg TAT = average TotalHoursOnTask."`
- `Overdue when any of these apply:` → bullet list (not inline `AND` conditions on one line)

**Affected by Settings target** — must end with `Target is configurable per team in Settings.`:
`kpi.overallSla`, `kpi.avgTat`, `kpi.totalOverdue`, `team.sla`, `team.avgTat`, `team.overdue`, `chart.trend`, `chart.history`, `modal.sla`, `modal.avgTat`, `modal.overdue`, `alerts.panel`.

**Not affected** — must NOT include that sentence:
`kpi.totalTasks`, `team.volume`, `teams.status`, `modal.volume`, `modal.avgTatCompleted`, `modal.overdueCompleted`, `loan.*`.

### InfoTip bubble — visual standards

| Property | Value |
|----------|-------|
| Padding | `10px 13px` (top/bottom × left/right) |
| Font size | `12px` |
| Line height | `1.6` |
| Max height | `65vh` with `overflow-y: auto` (long content scrolls) |
| Min width | Passed via `width` prop; default `240px` |
| Background | `var(--ink)` (dark) with white text |
| Border radius | `7px` |
| Arrow | `--arrow-left` CSS var tracks icon centre even when bubble is clamped |

### InfoTip behaviour
- `ReactDOM.createPortal(..., document.body)`. `position:fixed; z-index:9999`.
- Click-to-toggle. ESC or outside-click closes.
- Only one open at a time (`infotip-opened` custom DOM event closes others).
- Optional `width` prop (default 240px).

**Viewport-safe positioning (guaranteed full visibility):** On open, the component measures the icon's `getBoundingClientRect()` and computes:
- **Horizontal:** centres bubble on icon, then clamps `left` to `[MARGIN, vw − MARGIN − bubbleWidth]` so the bubble never overflows left or right.
- **Vertical:** picks the side with more space (`above` default; falls back to `below` when space above < 80 px or space below is greater). Sets `bottom` (above case) or `top` (below case) directly in `px` — no CSS `transform`. A `7px` gap separates bubble from icon.
- **Arrow:** `--arrow-left` CSS custom property keeps the caret pointing at the icon even when the bubble is horizontally shifted by clamping.
- **Long content:** inner `.info-tip-bubble__content` has `overflow-y: auto` and `max-height: 65vh` — content scrolls internally rather than overflowing.
- No `transform` is used; `top`/`bottom`/`left` are all computed and set as absolute `px` values.

### Z-index hierarchy
InfoTip = 9999 · chart hover tooltip = 9998 · modal overlay = 100 · sidebar = 10 · topbar = 9.

> Any new tooltip must use the portal pattern. Never use `position:absolute` inside an `overflow:hidden` ancestor.

> **All Departments drill-through modal** (StaffListView) must use `ReactDOM.createPortal(..., document.body)`. The `.main` layout element has `isolation: isolate` which creates a local stacking context — any modal rendered inside it cannot stack above the sidebar regardless of its z-index. Portalling to `document.body` escapes this context and ensures all columns are visible above the sidebar.

---

## 17. Team Card UI Rules

**Group label (`div.card-dept`):** `"Department Group"` when `team.fallbackDeptId` is set; `"KPI Group"` otherwise.

**InfoTip tooltip text:**
- Dept team: `All tasks from {name} - Dept {fallbackDeptId}`
- KPI team (codes known): `{name} includes TaskcodeID:\n'{code1}', ...` (up to 30, then `\n... and N more`)
- KPI team (no codes): `{name} - KPI Group`

Data source: `team.taskCodes` (array of `TaskCode` strings) + `team.fallbackDeptId` from `/api/teams`.

**CSS:** `.card-team` = `font-size: 16px`. `.card-dept`, `.stat-label` = `font-size: 9px`.

**TeamsView "Department" column:** Shows `'Department Group'` or `'KPI Group'` at `fontSize:9`. Not the raw `dept` value.

---

## 18. Loan Strip

Three cards above KPI tiles: **Application Received**, **Funder Approvals**, **Settlements**.

Each card: count, total `LoanAmount`, delta vs yesterday, delta vs 5 biz days ago, configurable target badge.

Delta colour: more loans = good → positive delta is green (`down` class). Inverted from task overdue convention.

Loan targets in `settings.loanTargets` (`{ received, approved, settled }`, default 10 each).

Drill-down: `LoanModal` shows `[{ ApplicationID, FunderName, LoanAmount }]` sorted by amount DESC.

**Sparkline trend charts — drill-through popup only:**

Sparklines appear in the `LoanModal` drill-down chips only (not on the main dashboard loan strip tiles). Each of the three modal types (Application Received, Funder Approvals, Settlements) displays a small inline SVG sparkline in both metric chips (count and total loan amount). The sparkline shows the last 30 calendar days of daily data relative to `todayLocal()`. Missing days render as zero so the line is always continuous. Data source: `/api/loan-trend/:type` endpoint. Sparkline is additive visual only — existing count/amount totals are unchanged.

---

## 19. Staff List

- **Absent Today** (top section): `WorkStatusHistory.StartedTime = today` AND `ConfigWorkStatus.IsAbsent = 1`.
- **Departments table**: all depts (`DepartmentId IS NOT NULL`); staff counted for `EmployeeStatus = 1`; ordered by count DESC.
- **Search**: filters departments table only (case-insensitive). Width 260px. Positioned between the two sections.
- **Staff modal**: active staff in selected dept. Columns: Staff ID · Full Name · Employee Status (always ACTIVE badge) · IsGroup.

---

## 20. Settings Screen

| Section | Contents |
|---------|---------|
| Loan Targets | 3 number inputs (Received / Approvals / Settlements) |
| Team order and SLA target | Draggable rows with grip handle; REMOVE/Restore buttons; SLA target input per team |
| At Risk threshold | Input (default 87.5%) |
| Refresh interval | Minutes (default 5) |
| Tasks in drill-down | Max rows in modal (default 50, `modalTaskCount`) |

**Apply Changes** saves per-user settings to DB + localStorage. Admin users additionally save global team config (including `targets`) — which is pushed to all other users within 15 s via the settings poll.

---

## 21. Security Rules (Mandatory — Do Not Weaken)

1. All secrets in `backend/.env` only — never in source code or frontend files.
2. No direct DB access from browser — all queries through backend API.
3. Production API returns generic error messages only. Full errors logged server-side via `sendError()`.
4. All data endpoints use `requireAuth` middleware. Admin routes also check `req.user.role === 'admin'`.
5. No wildcard CORS in production. Restricted to known origins via `ALLOWED_ORIGINS` env var.
6. SQL login should have `db_datareader` role only (read-only).
7. `JWT_SECRET` must be ≥ 32 characters. Server exits at startup if absent or too short.
8. Production frontend and `VITE_API_BASE` must use `https://`.

If any change would violate a rule above: stop immediately, warn the user, propose safe alternative. Do not make the change first and warn after.

---

## 22. Pre-Commit Checklist (Mandatory)

Run before every `git commit`. All items must pass.

### Automated checks (run from `backend/`)

```powershell
npm run check-all   # runs check-hardcoded-dates.js + check-must-rules.js
```

| Check | Command | Must pass |
|-------|---------|-----------|
| No hardcoded `YYYY-MM-DD` date literals | `npm run check-dates` | exit 0 |
| MUST Rule invariants (SSE broadcast chain) | `npm run check-must` | exit 0 |
| Frontend production build | `cd frontend && npm run build` | exit 0, no errors |

### Manual verification

| Item | Verify |
|------|--------|
| No hardcoded department names/group names | `grep -r "SpecifiedKPIGrp" --include="*.js" --include="*.jsx"` — only in SQL builder functions, never as literals in business logic |
| No hardcoded team IDs | All team IDs derived from DB via `refreshAllTeams()` |
| Admin settings propagate instantly | `broadcastSettingsChanged()` called in `PUT /api/admin/settings`; SSE listener in `App.jsx` calls `applyGlobalConfig()` + `refreshData()` |
| All settings are global (admin-broadcast) | `refreshMin`, `modalTaskCount`, `targets`, `loanTargets`, `atRiskPct`, `hiddenTeams`, `groupOrder` all included in `saveGlobalSettings()` payload |
| Tooltip wording matches logic | Run `node docs/patch-tooltips.js` if xlsx was edited; verify `constants.js` TOOLTIPS keys match implemented behaviour |
| `CLAUDE.md` reflects current state | Section 0 MUST rule, Section 6 team discovery, Section 7 date rules, Section 8 metric formulas, Section 12 settings scope |
| No unrelated file changes | `git diff --name-only HEAD` — review every file listed |

### Commit message format

```
<type>: <short summary>

- <bullet: what changed and why>
- <bullet: what changed and why>
```

Types: `feat` / `fix` / `refactor` / `docs` / `chore`

---

## 23. Restart Procedure

```powershell
# 1. Kill existing Node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Start backend (wait for "Connected to SQL Server")
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\backend"
node server.js

# 3. Start frontend
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\frontend"
npm run dev -- --host
```

Ports: backend **5000**, frontend **5173**.

---

## 24. General Coding Conventions

- **Match provided HTML/screenshots exactly.** No redesigning or improvements unless asked.
- **Sidebar:** `position: sticky` (not `fixed`) — `fixed` collapses the CSS Grid main column.
- **Multiple independent SQL datasets:** use `Promise.all()`, not sequential `await`.
- **Component stability:** `components.jsx`, `views.jsx`, `history-chart.jsx`, `trend.jsx`, `icons.jsx` — targeted additions only; no structural refactoring.
- **Alert description format:** `<total> active tasks, <inProgress> file(s) in progress, <overdue> file(s) overdue, SLA at <pct>%`
- **No hardcoded date literals in production SQL.** Use `todayLocal()` and `getNowSql()`. Run `npm run check-dates` (from `backend/`) to verify.
