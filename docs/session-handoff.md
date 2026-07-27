# SLA Dashboard — Session Handoff

**Last updated:** 2026-07-27

---

## What Was Done Today (2026-07-27)

| Change | File(s) |
|--------|---------|
| Fixed `fetchHistoryData` sql.DateTime UTC offset | `backend/server.js` — replaced `sql.DateTime` params with string date variables (`startDateStr`/`endDateStr`) |
| Documented "never use sql.DateTime for date boundaries" rule | `docs/CLAUDE.md` §7 |
| Fixed KPI tile zero-delta display (was showing "+0 ↓") | `frontend/src/App.jsx` (`fmtDelta` returns null for 0; Avg TAT `'◆'` → null) |
| Fixed KPI tile delta colour logic | `frontend/src/components/components.jsx` — `deltaInvert` prop; correct Overdue down→green; neutral fallback |
| Updated CLAUDE.md delta convention section | `docs/CLAUDE.md` §8 |
| Fixed drill-through modal showing incomplete tasks | `frontend/src/App.jsx` — `openModal()` does on-demand per-team fetch; replaced global TOP 500 pre-fetch |
| Modal title shows actual task count + "Loading…" state | `frontend/src/components/components.jsx` |
| Created project memory docs | `docs/project-overview.md`, `docs/architecture.md`, `docs/current-status.md`, `docs/decisions.md`, `docs/task-board.md`, `docs/session-handoff.md` |

---

## Current State of the Codebase

- **Backend:** Running on port 5000, connected to SQL Server `DESKTOP-HGGDDCR` / `MySEReport`
- **Frontend:** Running on port 5173 via `npm run dev -- --host`
- **All 8 views:** Functional
- **SLA% logic:** `SLAAdjustedDate` scope throughout (team card, KPI, history chart, drill-through)
- **Charts:** History and 7-day trend both use string dates — UTC offset bug fixed
- **Modals:** On-demand per-team fetch — all tasks visible regardless of global 500 cap

---

## Known Issues / Verify Before Next Session

1. **Chart vs team card SLA% match** — hard-refresh the browser and confirm the last chart point matches today's team card values. This was the main goal of the history chart string-date fix.
2. **KPI delta colours** — confirm Avg TAT and Overdue show correct colours (up=red, down=green) when deltas are non-zero. Currently all active-task deltas are 0 so this path is untested visually.
3. **`getTasks` custom targets** — the 4th argument `targets` passed to `getTasks(null, null, null, targets)` is silently dropped by `api.js` (function only has 3 params). The global task pre-fetch for `TasksView` doesn't send custom targets to the backend. Low impact since `normalizeTask()` recalculates status client-side.

---

## Suggested Next Prompts

### Verify fixes
```
Hard-refresh the dashboard and take a screenshot of the 7-day trend chart.
Compare the rightmost data point to today's team card SLA% values.
Do they match?
```

```
Click on a KPI team (not a dept team) in the team cards. 
Does the drill-through modal show all tasks? Does the title show the correct count?
```

### Fix remaining issues
```
Fix the getTasks api.js function to accept and forward custom targets as query params
(pattern: t{id}=N for each entry in the targets object).
This ensures the backend uses the correct team SLA target when sorting and calculating 
status for the All Active Tasks view.
```

```
Implement email delivery for password reset.
Currently POST /api/auth/forgot-password returns the reset token directly in the response.
It should instead send an email with a reset link. 
Which email provider do you want to use? (SendGrid / Nodemailer+SMTP / other)
```

```
Add React Router so browser back/forward buttons work and views are bookmarkable.
Use hash routing (#/dashboard, #/teams, etc.) to avoid Vercel redirect config changes.
```

### Maintenance
```
Update the SLA_LOGIC_AUDIT doc — it still uses hardcoded department IDs from 2026-06-17.
The team discovery is now dynamic (KPI groups + dept groups).
Regenerate the audit SQL using the current server.js query patterns.
```

```
Run the full pre-commit check suite and confirm no issues:
cd backend
npm run check-all
```

---

## Key File Locations

| Purpose | File |
|---------|------|
| Authoritative spec + all rules | `docs/CLAUDE.md` |
| All API + SQL logic | `backend/server.js` |
| State, routing, normalisation | `frontend/src/App.jsx` |
| All fetch wrappers | `frontend/src/api.js` |
| KpiTile, TeamCard, TaskModal | `frontend/src/components/components.jsx` |
| All view components | `frontend/src/components/views.jsx` |
| Tooltip content | `frontend/src/constants.js` |
| Deployment runbook | `docs/DEPLOYMENT.md` |

---

## Restart Commands

```powershell
# Kill existing Node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Start backend
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\backend"
node server.js

# Start frontend (separate terminal)
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\frontend"
npm run dev -- --host
```

Wait for: `[cache] kpi ready` + `[cache] teams ready` before testing.
