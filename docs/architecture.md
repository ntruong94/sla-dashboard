# SLA Dashboard — Architecture

**Last updated:** 2026-07-27

---

## System Diagram

```
[Browser — users anywhere]
        │  HTTPS
        ▼
[Vercel — React 19 + Vite frontend]    frontend/
        │  REST + SSE  (VITE_API_BASE)
        ▼
[Railway / Local — Node.js + Express]  backend/server.js
        │  mssql driver  (TDS port 1433)
        ▼
[SQL Server — MySEReport]
  server: DESKTOP-HGGDDCR (local PC)
```

The browser **never** talks to the database directly. All queries go through the backend API.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend framework | React 19 + Vite 8 | No React Router — views toggled by state in `App.jsx` |
| Styling | Plain CSS (`styles.css`, `styles-views.css`) | CSS custom properties for theming |
| Charts | Hand-rolled SVG (`trend.jsx`, `history-chart.jsx`) | No chart library dependency |
| Backend | Node.js + Express 5 | Single file `backend/server.js` (~1950 lines) |
| Database driver | `mssql` 12 | Raw parameterised/template SQL — no ORM |
| Auth | JWT (`jsonwebtoken`) + bcrypt | `sla_token` in localStorage, 8h expiry |
| Security | `helmet`, `express-rate-limit`, `cors` | CORS restricted to `ALLOWED_ORIGINS` env var |
| Real-time | SSE (`/api/events`) | DB fingerprint poll every 30s; broadcasts `data-changed` and `settings-changed` |

---

## Repository Structure

```
SLA Dashboard/
├── backend/
│   ├── server.js              ← ALL API endpoints, SQL logic, caching, SSE (~1950 lines)
│   ├── db.js                  ← SQL Server connection pool (env-driven, 180s request timeout)
│   ├── mock-data.js           ← In-memory fallback (USE_MOCK=true)
│   ├── check-hardcoded-dates.js ← CI guard: blocks literal YYYY-MM-DD in source
│   ├── check-must-rules.js    ← CI guard: enforces SSE propagation invariants
│   ├── apply-perf-indexes.js  ← One-off index script
│   ├── set-admin-role.js      ← Utility: promote user to admin
│   └── .env                   ← DB credentials + JWT_SECRET (never committed)
├── frontend/
│   ├── src/
│   │   ├── App.jsx            ← Auth gate, all state, view routing, normalizeTask()
│   │   ├── Mezylogin.jsx      ← Login / signup / forgot / reset screens
│   │   ├── api.js             ← All fetch() wrappers to backend REST API
│   │   ├── constants.js       ← TOOLTIPS object, TEAM_COLORS proxy
│   │   ├── chartUtils.js      ← computePctAxis(), weekend filter, smoothing
│   │   └── components/
│   │       ├── components.jsx ← KpiTile, TeamCard, TaskModal, AlertsPanel, LoanKpiTile, LoanModal, InfoTip
│   │       ├── views.jsx      ← All secondary view components
│   │       ├── trend.jsx      ← 7-day SVG trend chart
│   │       ├── history-chart.jsx ← Multi-line SVG history chart
│   │       ├── utils.js       ← parseDMY, sortRows, useSortState, SortTh, fmtHMS
│   │       └── icons.jsx      ← SVG icon set
│   ├── styles.css             ← Global + component styles
│   └── styles-views.css       ← View-specific overrides
├── sql/
│   ├── SEReport_schema.sql    ← Reference DB schema dump
│   └── create_perf_indexes.sql
└── docs/
    ├── CLAUDE.md              ← Authoritative AI/developer working notes (most detailed)
    ├── TECHNICAL_DOCUMENTATION.md
    ├── DEPLOYMENT.md
    └── USER_GUIDE.md
```

---

## Key Backend Patterns

### Team Discovery (dynamic — runs every 60s)
Teams are **never hardcoded**. `refreshAllTeams()` discovers:
- **KPI teams** from `ConfigTasks WHERE UsedForKPI=1` + distinct `SpecifiedKPIGrp` — ID = djb2 hash in [1000, 8999]
- **Dept teams** from `Department JOIN Staff WHERE EmployeeStatus=1` — ID = `DepartmentId + 10000`

### Caching
- `fetchKpiData()` and `fetchTeamsData()` cached with **5-minute TTL**
- Stale-while-revalidate: stale data served immediately, background refresh queued
- Cache is invalidated on DB fingerprint change (SSE poll) or admin settings save

### Date Handling
All date boundaries use `YYYY-MM-DD` string literals interpolated into SQL — **never** `sql.DateTime` objects (which carry UTC offset). `todayLocal()` returns the system wall-clock date; overridable via `FORCE_TODAY` in `.env` for testing.

### SSE Real-time Flow
```
Admin saves setting
  → PUT /api/admin/settings
  → broadcastSettingsChanged()
  → "settings-changed" SSE event → all browsers
  → getGlobalSettings() + applyGlobalConfig() + refreshData()
  → UI updates instantly (no page reload)

DB data changes (every 30s poll)
  → fingerprint change detected
  → "data-changed" SSE event → all browsers
  → refreshData()
```

---

## Database — Key Tables

| Table | Role |
|-------|------|
| `Tasks` | Primary source — `TotalHoursOnTask`, `SLAAdjustedDate`, `TaskStatusID`, `DateCreated`, `DateCompleted` |
| `ConfigTasks` | Links tasks to KPI groups via `UsedForKPI` + `SpecifiedKPIGrp` |
| `Staff` | `StaffID`, `DepartmentId`, `EmployeeStatus` — used for team routing |
| `Department` | Department names |
| `Loans` | `ApplicationID`, `LoanAmount`, `Date_ApplicationReceived`, `Date_FunderApproval`, `Date_Settled` |
| `ConfigReportUsers` | Dashboard user accounts + per-user `UserSettings` JSON |
| `ConfigDashboards` | `GlobalSettings` JSON — team order, hidden teams, SLA targets |
| `WorkStatusHistory` | Absent-today staff feed |

---

## Auth Flow

```
POST /api/auth/login  →  JWT (8h)  →  localStorage "sla_token"
All data API calls    →  Authorization: Bearer <token>  →  requireAuth middleware
Admin routes          →  + req.user.role === 'admin' check
SSE /api/events       →  JWT via ?token= query param
```
