# SLA Dashboard — Technical Documentation

**Product:** SLA Dashboard for Mortgage Ezy Pty Ltd
**Purpose:** Real-time web dashboard showing how quickly each loan-processing team completes work against its SLA (Service Level Agreement) targets.
**Audience:** Developers and technical staff maintaining or extending this codebase.

> This document is a curated technical reference. The most detailed and continuously updated internal notes live in `docs/CLAUDE.md` (AI/developer working notes) and `docs/DEPLOYMENT.md` (deployment runbook) — this file organizes that material into a stable reference plus fills in setup and API detail.

---

## 1. Architecture Overview

```
[Browser]
    ↕  HTTPS / REST (JSON)
[React 19 + Vite frontend]     — frontend/
    ↕  HTTPS API calls (VITE_API_BASE)
[Node.js + Express backend]    — backend/server.js
    ↕  mssql driver (TDS/1433)
[SQL Server — "MySEReport" database]
```

- The frontend never talks to the database directly — every read goes through the backend's REST API.
- The backend is a single Express app (`backend/server.js`, ~1950 lines) with in-memory caching, JWT auth, and one connection pool (`backend/db.js`) to SQL Server.
- Teams (the units shown on the dashboard) are **not** hardcoded — they are discovered dynamically from the database every 60 seconds (see §6).

### Deployed topology (production)

| Layer | Platform | Notes |
|---|---|---|
| Frontend | Vercel (auto-deploys on push to `main`) | `https://sla.mezy.com.au` / `https://sla-dashboard.vercel.app` |
| Backend | Railway, or a local machine + Cloudflare Tunnel | Needs to reach the SQL Server instance |
| Database | SQL Server on a local PC (`MySEReport`) | Listens on `localhost:1433` only — never exposed to the public internet |

Because the database currently lives on a local PC, a cloud-hosted backend (Railway) only works end-to-end if that PC's SQL Server is reachable from the cloud (e.g. via a tunnel), or the backend also runs locally behind a tunnel. Full deployment steps are in §11 and `docs/DEPLOYMENT.md`.

---

## 2. Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Frontend framework | React | 19.2.x | No React Router — views are toggled by component state (`view` in `App.jsx`), not URL routes |
| Frontend build tool | Vite | 8.0.x | Dev server on port 5173 |
| Backend framework | Express | 5.2.x | |
| Database driver | `mssql` | 12.5.x | Connects to SQL Server |
| Auth | `jsonwebtoken` + `bcryptjs` | — | JWT bearer tokens, bcrypt password hashing |
| Security middleware | `helmet`, `express-rate-limit`, `cors` | — | See §10 |
| Env config | `dotenv` | — | Backend reads `backend/.env` |
| Database | Microsoft SQL Server | — | Database name `SEReport`/`MySEReport` |

No ORM is used — all queries are raw parameterised/template SQL against the `mssql` pool.

---

## 3. Repository Structure

```
sla-dashboard/
├── backend/
│   ├── server.js          # All API routes, business logic, SQL queries (~1950 lines)
│   ├── db.js               # SQL Server connection pool
│   ├── mock-data.js        # In-memory fallback data (USE_MOCK=true)
│   ├── probe-*.js          # One-off scripts used to inspect schema during development
│   ├── set-admin-role.js   # Utility to promote a user to admin role
│   ├── apply-perf-indexes.js
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Root component — auth gate, state, layout, dashboard view
│   │   ├── Mezylogin.jsx   # Login / signup / forgot-password / reset-password screen
│   │   ├── api.js          # All fetch() wrappers to the backend REST API
│   │   ├── constants.js    # TEAM_COLORS, TOOLTIPS
│   │   ├── chartUtils.js   # Axis scaling, weekend filtering, smoothing helpers for charts
│   │   └── components/
│   │       ├── components.jsx   # KpiTile, TeamCard, AlertsPanel, TaskModal, LoanKpiTile, LoanModal, InfoTip
│   │       ├── views.jsx        # TeamsView, TasksView, ReportsView, AlertsView, SettingsView, StaffListView, AdminView, TaskCodesView
│   │       ├── trend.jsx         # 7-day SVG trend chart
│   │       ├── history-chart.jsx # Multi-range SVG history chart
│   │       └── icons.jsx         # SVG icon set
│   ├── data/                # Legacy mock data (data.js, history.js) — unused once wired to live API
│   ├── styles.css / styles-views.css
│   └── .env.example
├── sql/
│   ├── SEReport_schema.sql          # Reference dump of the source database schema
│   ├── create_dashboard_users.sql   # Auth table DDL
│   ├── create_new_auth_tables.sql
│   └── create_perf_indexes.sql
├── docs/
│   ├── CLAUDE.md              # Living technical/AI reference — most detailed source of truth
│   ├── DEPLOYMENT.md          # Deployment runbook
│   ├── SLA_LOGIC_AUDIT_2026-06-17.md
│   └── SLA_Dashboard_Tooltips.xlsx  # Authoritative tooltip copy
├── package.json                # Root: `npm start` runs backend + frontend concurrently
└── start-sla-dashboard.ps1 / install-autostart.ps1
```

---

## 4. Local Development Setup

### Prerequisites
- Node.js (v18+ recommended)
- Access to a SQL Server instance with the `MySEReport`/`SEReport` database (or `USE_MOCK=true` for mock data)

### Steps

```bash
# 1. Clone and install
git clone https://github.com/ntruong94/sla-dashboard
cd sla-dashboard
npm install                # installs root devDependency: concurrently

cd backend && npm install
cd ../frontend && npm install
```

```bash
# 2. Configure environment
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Edit backend/.env with real DB credentials and a JWT_SECRET (see §5)
# Leave frontend/.env.local VITE_API_BASE blank for local dev (Vite proxies to localhost)
```

```bash
# 3. Run both servers together (from repo root)
npm start
# — or run separately —
cd backend && node server.js        # http://localhost:5000
cd frontend && npm run dev -- --host  # http://localhost:5173
```

On successful backend startup you should see `Connected to SQL Server` in the console. Visit `http://localhost:5173` and log in (see §9 for the seeded admin account).

### Useful scripts
| Command | Location | Purpose |
|---|---|---|
| `node server.js` | `backend/` | Start backend |
| `npm run dev -- --host` | `frontend/` | Start Vite dev server, bound to all interfaces |
| `npm run build` | `frontend/` | Production build to `frontend/dist` |
| `npm run lint` | `frontend/` | ESLint |
| `node set-admin-role.js` | `backend/` | Promote a user to the `admin` role |
| `node apply-perf-indexes.js` | `backend/` | Apply indexes from `sql/create_perf_indexes.sql` |

---

## 5. Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DB_SERVER` | Yes | SQL Server host (`localhost` if co-located) |
| `DB_PORT` | No (default `1433`) | SQL Server port |
| `DB_DATABASE` | Yes | Database name (`MySEReport`) |
| `DB_USER` / `DB_PASSWORD` | Yes (unless using Windows Auth) | SQL login credentials |
| `JWT_SECRET` | Yes | Signing key for auth tokens. **Must be ≥32 characters, randomly generated.** Server refuses to start otherwise. Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ALLOWED_ORIGINS` | No | Comma-separated list of frontend origins allowed by CORS. Falls back to a hardcoded default list (includes localhost) if blank |
| `NODE_ENV` | No | `production` on live server — suppresses detailed error messages in API responses |
| `USE_MOCK` | No (default `false`) | `true` uses in-memory mock data instead of SQL Server (useful for CI/demo without a DB) |
| `PORT` | No (default `5000`) | Backend listen port |

### Frontend (`frontend/.env.local` locally, or the hosting platform's env panel in production)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Full URL of the backend API. Leave blank for local dev (Vite proxies to `localhost:5000`). Required in production (e.g. the Railway or tunnel URL). |

**Never commit `.env` or `.env.local`** — both are listed in `.gitignore`. Secrets belong only in local `.env` files or the hosting platform's environment-variable panel.

---

## 6. Core Domain Logic

### 6.1 Teams are discovered, not configured

There is no hardcoded team list. `refreshTeams()` in `server.js` rebuilds the team list at startup and every 60 seconds, using two rules (Rule 1 takes precedence over Rule 2):

- **Rule 1 — KPI group:** A task belongs to a KPI-group "team" when its `ConfigTasks` row has `UsedForKPI = 1` and a non-empty `SpecifiedKPIGrp`. The card label is that `SpecifiedKPIGrp` value.
- **Rule 2 — Department fallback:** Any other task assigned to an active staff member (`EmployeeStatus = 1`) groups by that staff member's `DepartmentId`. The card label is the department name with a trailing "Department" word stripped.

If a Rule-2 department card's name collides with an existing Rule-1 card name, the Rule-2 card is suppressed. Team IDs are sequential integers but preserved across refreshes via an identity key (`kpi:<name>` or `dept:<deptId>`).

### 6.2 Task status codes

| Code | Meaning |
|---|---|
| `1, 4, 5, 6` | Active/open (In Progress, On Hold, On Queue, Not Queued) |
| `2` | Completed |

### 6.3 SLA metric formulas

All metrics are scoped to "today" using a sargable date range (`col >= 'YYYY-MM-DD' AND col < 'next-day'`) — never `CAST(col AS DATE) = ...`, which blocks index seeks.

| Metric | Formula | Status filter | Date column |
|---|---|---|---|
| Volume / Total Active Tasks | Count of tasks | `IN (1,4,5,6)` | `DateCreated` |
| SLA % | `(TotalHoursOnTask ≠ 0 AND TotalHoursOnTask < SLAInHours) OR (DateCompleted ≤ SLAAdjustedDate)`, divided by all completed tasks | `= 2` | `DateCompleted` |
| Avg Turnaround (TAT) | Open tasks: `GETDATE() − DateCreated`; closed tasks: `DateCompleted − DateCreated` (real-time `DATEDIFF`, never the stored `TotalHoursOnTask` column for this metric) | all statuses | — |
| Overdue / Breached | Open: elapsed hours > configured SLA target OR `GETDATE() > SLAAdjustedDate`. Closed: `TotalHoursOnTask > SLAInHours` OR `DateCompleted > SLAAdjustedDate` | `IN (1,4,5,6)` + `= 2` | — |
| At Risk | Elapsed hours ≥ `atRiskFraction × target` and ≤ target | — | — |

- `atRiskFraction` defaults to 87.5% and is configurable per-deployment in Settings.
- Deltas ("vs yesterday") use the exact same status filter and date column as the main metric, compared against the previous business day (`prevBizDay()`: Monday → Friday, Sunday → Friday, otherwise → yesterday).
- The 4 summary KPI cards aggregate only over teams currently visible in Team Performance (hidden teams excluded) — the frontend passes `?visibleTeams=<ids>` to `/api/kpi-summary`, and the backend bypasses its cache whenever that parameter is present.

### 6.4 "Reporting date" resolution

Rather than using the real system clock, the backend resolves an **effective date** (`resolveEffectiveDate()`) by querying `MAX(DateCreated)` from `Tasks` at startup and every 60 minutes. All "today"/"yesterday" calculations use this resolved date, falling back to the real system date if the query fails. This matters when working against a backup/snapshot of the database that isn't fully current.

---

## 7. Database Schema (Key Tables)

| Table | Purpose | Key columns |
|---|---|---|
| `Tasks` | Main work unit tracked for SLA | `TaskID`, `ConfigTaskId`, `TaskName`, `TaskStatusID`, `AssignedTo`, `FunctionID`, `SLAInHours`, `TotalHoursOnTask`, `DateCreated`, `DateCompleted`, `SLAAdjustedDate` |
| `ConfigTasks` | Task-type configuration | `ConfigTaskId`, `TaskCode`, `UsedForKPI`, `SpecifiedKPIGrp` |
| `ConfigFunction` | Links tasks to queues | `FunctionID`, `QueueID` |
| `ConfigQueue` | Team/queue lookup | `QueueId`, `QueueName` |
| `ConfigTaskStatus` | Task status labels | `ConfigTaskStatusID`, `TaskStatus` |
| `ConfigLoanStatus` | Loan stage/status config | includes `ConfigSLACheckPointTypeID`, `IsSLACheckPointOnHold` |
| `Staff` | Staff lookup | `StaffID`, `FirstName`, `Surname`, `DepartmentId`, `EmployeeStatus` |
| `Department` | Department names | `DepartmentId`, `Description` |
| `Loans` | Loan milestones (used by `/api/loan-summary`) | `ApplicationID`, `LoanAmount`, `Date_ApplicationReceived`, `Date_FunderApproval`, `Date_Settled` |
| `WorkStatusHistory` / `ConfigWorkStatus` | Staff attendance | used for the Staff List "Absent Today" table (`IsAbsent = 1`) |
| `DashboardGlobalSettings` | Dashboard's own settings table (auto-created) | `SettingKey` (always `'global'`), `SettingValue` (JSON blob), `UpdatedAt` |
| `DashboardAccess` / `ConfigReportUsers` | Dashboard auth (user accounts) | see `sql/create_dashboard_users.sql`, `sql/create_new_auth_tables.sql` |

Full DDL/reference for the source system is in `sql/SEReport_schema.sql` (6000+ lines — reference only, not applied by the app).

All dashboard queries use `WITH (NOLOCK)` for read performance and never modify source data — the dashboard is strictly read-only against `SEReport` tables. Only its own auth/settings tables are written.

---

## 8. API Reference

Base path: backend root (e.g. `http://localhost:5000`). All endpoints return JSON. Endpoints marked **Auth** require an `Authorization: Bearer <token>` header; **Admin** additionally requires the caller's role to be `admin`.

### Health / diagnostics
| Endpoint | Method | Returns |
|---|---|---|
| `/api/health` | GET | `{ status: 'OK' }` |
| `/api/db-health` | GET | DB connectivity check |
| `/api/db-test` | GET | Diagnostic — table columns + queue names (dev only) |

### Dashboard data
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/kpi-summary` | GET | Auth | `{ totalTasks, overallSla, avgTat, totalOverdue, deltas: {...} }`. Optional `?visibleTeams=<ids>` scopes to specific teams and bypasses cache. |
| `/api/teams` | GET | Auth | Array of `{ id, name, dept, target, volume, sla, avgTat, overdue, deltas, tooltip }` |
| `/api/tasks` | GET | Auth | Array of tasks. Query params: `?team=&status=&scope=today` |
| `/api/history` | GET | Auth | `{ dates[], byTeam: { teamId: [sla%] } }`. Param: `?range=7d` (or `400d`, etc.) |
| `/api/alerts` | GET | Auth | Array of rule-based alerts (breach thresholds) |
| `/api/alert-tasks/:teamId` | GET | Auth | Drill-down task list for a specific alert |
| `/api/loan-summary` | GET | Auth | `{ received, approved, settled }`, each `{ count, amount, deltas }` |
| `/api/loan-detail/:type` | GET | Auth | `[{ ApplicationID, FunderName, LoanAmount }]` for `type = received\|approved\|settled` |

### Staff
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/staff/departments` | GET | Auth | `[{ departmentId, departmentName, totalStaff }]` |
| `/api/staff/absent-today` | GET | Auth | `[{ staffId, fullName, departmentName, workStatusName, startedTime, endedTime }]` |
| `/api/staff/department/:departmentId` | GET | Auth | `[{ staffId, fullName, employeeStatus, isGroup }]` |

### Task codes (admin)
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/task-codes` | GET | Admin | `[{ ConfigTaskId, TaskCode, FunctionID, FunctionName, TaskName, Inactive, SLA, UsedForKPI, SpecifiedKPIGrp }]` — always live, never cached |

### Settings
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/settings` | GET | Auth | Global settings JSON (all authenticated users read this) |
| `/api/admin/settings` | PUT | Admin | Overwrites the global settings JSON |

### User management (admin)
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/admin/users` | GET | Admin | `[{ id, email, companyName, role, status, createdAt }]` |
| `/api/admin/users/:id` | DELETE | Admin | Removes the user's dashboard access |

### Authentication
| Endpoint | Method | Auth | Returns |
|---|---|---|---|
| `/api/auth/login` | POST | Rate-limited | `{ token, email, companyName, role }` |
| `/api/auth/signup` | POST | Rate-limited | Creates a pending account (`companyName` not required — only `email` + `password`; identity is matched against an active `Staff` record by email) |
| `/api/auth/forgot-password` | POST | Rate-limited | Generates a 1-hour reset token (returned directly — no email infrastructure) |
| `/api/auth/reset-password` | POST | Rate-limited | Validates the token and updates the password |

All four auth endpoints are limited to 10 attempts per 15 minutes per IP (`express-rate-limit`, with `trust proxy 1` so the real client IP is used behind Vercel/Railway/tunnels).

---

## 9. Authentication & Authorization

- **Login:** email + password → bcrypt-verified against `ConfigReportUsers`/`DashboardAccess` → JWT issued (`expiresIn: '8h'`).
- **Signup:** identity is tied to an active `Staff` record matched by email (`EmployeeStatus = 1`); signup fails with a 404 if no matching active staff record exists. The account is granted `viewer` access **immediately** (`DashboardAccess.IsActive = 1` is set at signup time) — there is currently no manual approval gate in the code path, despite the login screen's UI copy claiming otherwise (see Known Gaps, §13).
- **Password reset:** "Lost password" generates a short-lived reset token (no email delivery — token is returned directly in the response and shown to the user to copy into the reset form).
- **Roles:** `admin` and `viewer` (default). Role gates: Settings tab, User Management, Task Codes List are admin-only, both in the UI (hidden nav items) and enforced server-side (`requireAdmin` middleware) — never trust client-side hiding alone.
- **Seeded admin account:** created automatically on first backend startup by looking for a `Staff` record where `FirstName = 'System'`; uses that staff record's `EmailAddress` with default password `@dmin`. **Change this password immediately after first login.**
- **Token storage:** the frontend stores the JWT in `localStorage` (`sla_token`) and the user object (`sla_user`). A global `sla_logout` browser event forces logout if a request comes back `401` (expired token).

---

## 10. Security Posture

These are enforced in `backend/server.js` and treated as non-negotiable project rules (see `docs/CLAUDE.md` §26 for the full policy):

1. **No secrets in source code.** All credentials live in `backend/.env` (git-ignored) or the hosting platform's environment-variable panel.
2. **No direct DB access from the browser.** The frontend only calls `/api/...`; SQL Server port 1433 is never exposed publicly.
3. **No raw error leakage.** A `sendError()` helper returns generic messages in production and only exposes `err.message` in development; stack traces and internal identifiers (server names, table names) are never sent to the client.
4. **Auth is mandatory.** Every data endpoint uses `requireAuth` middleware; admin endpoints additionally check `req.user.role === 'admin'`. `JWT_SECRET` must be ≥32 characters — the server refuses to start otherwise.
5. **CORS is allow-listed**, never `origin: '*'` in production. Configured via `ALLOWED_ORIGINS`.
6. **Read-only DB account recommended.** The SQL login used by the backend should have `db_datareader` only — never `db_owner`/`sysadmin` — since the dashboard never needs to write to the source `SEReport` data (only to its own auth/settings tables).
7. **HTTPS only in production**, via Vercel (frontend) and Railway or a Cloudflare Tunnel (backend) — both provide automatic HTTPS.
8. **Security middleware:** `helmet` (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) and `express-rate-limit` on all auth routes.

---

## 11. Deployment

Full step-by-step deployment instructions (Railway setup, Vercel setup, Cloudflare Tunnel, credential rotation, troubleshooting table) live in **`docs/DEPLOYMENT.md`** — treat that file as the canonical deployment runbook and keep this section as a summary only.

### Summary
1. **Frontend → Vercel.** Root directory `frontend`, build command `npm run build`, output `dist`. Auto-deploys on every push to `main`. Set `VITE_API_BASE` in Vercel's environment variables panel.
2. **Backend → Railway (if DB is cloud-reachable) or a local machine.** Root directory `backend`. Set all variables from §5 in Railway's environment panel.
3. **Database stays local**, reachable only via `localhost:1433`. If the backend also runs locally, expose it to the internet with a tunnel (ngrok static domain or a Cloudflare Named Tunnel running as a Windows service for auto-restart on boot).
4. **Verify after any deploy:** `GET /api/health` returns `{status:'OK'}`; login succeeds from the deployed frontend with no CORS errors; JS assets load without 404s.

### Credential rotation
If any secret is exposed, rotate in this order: SQL Server password → `JWT_SECRET` (invalidates all sessions) → tunnel auth token → any CI/hosting platform tokens. Never put actual secret values in documentation, commit messages, or chat.

---

## 12. Performance Notes

- `fetchKpiData()` and `fetchTeamsData()` results are cached in-memory with a 5-minute TTL, using a stale-while-revalidate pattern (serve cached data immediately, refresh in the background).
- Both caches are pre-warmed on server startup, before the first user request arrives.
- `requestTimeout` in `db.js` is set to 180000ms (3 minutes) to survive cold SQL Server buffer-cache scans after a restart (~115s disk I/O observed on a 1M-row `Tasks` table scan); warm queries run in ~165ms.
- Endpoints that need multiple independent datasets use `Promise.all([...])` rather than sequential `await` calls.
- Date-range filters always use the sargable pattern `col >= 'date' AND col < 'next-day'` to allow index seeks — never `CAST(col AS DATE) = 'date'`.

---

## 13. Known Gaps / Areas for Improvement

- React Router is not installed — views are toggled by component state rather than real URLs, so there's no deep-linking or browser back/forward support between views.
- Password reset has no email delivery — the reset token is returned directly to the requester in the API response, which is only appropriate for an internal tool with a small trusted user base.
- The backend and database currently depend on a specific local machine; a durable production setup would need either a cloud-hosted SQL Server or a permanently-online tunnel.
- **UI/backend mismatch on signup:** `Mezylogin.jsx` always displays "Signup successful! Your account is pending admin approval." after a successful signup, but `/api/auth/signup` in `server.js` actually grants `viewer` access immediately (`IsActive = 1` at insert time) — there is no pending state in the current code path. New users can log in right away. The admin Users list will show these accounts as `approved` from the moment they sign up. Either the UI message or the backend's auto-approve behaviour should be revisited so the two agree.

---

*Last reviewed against the codebase: 2026-07-09. For day-to-day implementation rules (UI conventions, tooltip formatting, settings persistence, etc.) not relevant to onboarding a new developer, see `docs/CLAUDE.md`.*
