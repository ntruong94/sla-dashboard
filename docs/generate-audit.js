// generate-audit.js — run from the docs/ folder or project root with Node.js
// Generates SLA Logic Audit Excel workbook.
// Usage: node "C:\...\SLA Dashboard\docs\generate-audit.js"

const XLSX = require('../backend/node_modules/xlsx');
const path = require('path');

// ─── Audit data ──────────────────────────────────────────────────────────────
const rows = [
  {
    Figure_Area: 'Overall KPI — Avg TAT',
    Scope_Requirement: 'Open tasks: TAT = GETDATE() − DateCreated\nClosed tasks: TAT = DateCompleted − DateCreated',
    Implemented_Logic: 'AVG(CASE WHEN TaskStatusID IN (1,4,5,6) THEN DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0 ELSE DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 END)\nScoped to DateCreated = today (active + completed)',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now uses real-time computed TAT for open tasks and DateCompleted−DateCreated for closed tasks. Previously used stored TotalHoursOnTask which was NULL for 98% of active tasks.',
    Full_Query_Fragment: `-- fetchKpiData Q1 — avgTat
AVG(CASE WHEN t.DateCreated >= '${'{today}'}' AND t.DateCreated < '${'{todayNext}'}'
         THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                   THEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0
                   ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
              END ELSE NULL END) AS avgTat
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,2,4,5,6) AND [TEAM_FILTER]
  AND t.DateCreated >= '[prev]' AND t.DateCreated < '[todayNext]'`
  },
  {
    Figure_Area: 'Overall KPI — Avg TAT (delta)',
    Scope_Requirement: 'Delta = today avg TAT − previous business day avg TAT (same formula)',
    Implemented_Logic: 'AVG of mixed DATEDIFF TAT for prevBizDay tasks (DateCreated = prev biz day). Uses same CASE WHEN active/closed split.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Delta correctly uses GETDATE() for still-open yesterday tasks and DateCompleted for completed yesterday tasks.',
    Full_Query_Fragment: `-- fetchKpiData Q1 — prevTat (delta basis)
AVG(CASE WHEN t.DateCreated >= '[prev]' AND t.DateCreated < '[prevNext]'
         THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                   THEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0
                   ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
              END ELSE NULL END) AS prevTat`
  },
  {
    Figure_Area: 'Overall KPI — SLA %',
    Scope_Requirement: 'Completed within target ÷ total completed × 100 (per day, DateCompleted basis)',
    Implemented_Logic: 'CAST(SUM(CASE WHEN DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 <= targetExpr THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(total, 0) * 100\nScoped to DateCompleted = today. targetExpr = configured per-team SLA target.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'TAT now computed as DateCompleted − DateCreated. Previously used TotalHoursOnTask IS NULL = within SLA rule (removed).',
    Full_Query_Fragment: `-- fetchKpiData Q2 — overallSla
SELECT
  CAST(SUM(CASE WHEN t.DateCompleted >= '[today]' AND t.DateCompleted < '[todayNext]'
                AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= [targetExpr]
                THEN 1 ELSE 0 END) AS FLOAT)
  / NULLIF(SUM(CASE WHEN t.DateCompleted >= '[today]' AND t.DateCompleted < '[todayNext]'
                    THEN 1 ELSE 0 END), 0) * 100 AS overallSla
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID = 2 AND [TEAM_FILTER]
  AND t.DateCompleted >= '[prev]' AND t.DateCompleted < '[todayNext]'`
  },
  {
    Figure_Area: 'Overall KPI — Overdue Count',
    Scope_Requirement: 'Open tasks where TAT (GETDATE() − DateCreated) > configured SLA target',
    Implemented_Logic: 'SUM(... AND (DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0 > targetExpr OR (SLAAdjustedDate IS NOT NULL AND GETDATE() > SLAAdjustedDate)))\nActive tasks only, DateCreated = today.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Dual-condition overdue: elapsed TAT > target OR past SLAAdjustedDate. targetExpr uses Settings-configured per-team target.',
    Full_Query_Fragment: `-- fetchKpiData Q1 — totalOverdue
SUM(CASE WHEN t.DateCreated >= '[today]' AND t.DateCreated < '[todayNext]'
         AND t.TaskStatusID IN (1,4,5,6)
         AND (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [targetExpr]
              OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
         THEN 1 ELSE 0 END) AS totalOverdue
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,2,4,5,6) AND [TEAM_FILTER]`
  },
  {
    Figure_Area: 'Overall KPI — Total Active Tasks',
    Scope_Requirement: 'Count of active tasks created today',
    Implemented_Logic: 'SUM(CASE WHEN DateCreated >= today AND DateCreated < todayNext AND TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END)',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'No change from previous implementation. Counts tasks with active statuses only.',
    Full_Query_Fragment: `SUM(CASE WHEN t.DateCreated >= '[today]' AND t.DateCreated < '[todayNext]'
         AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS totalTasks`
  },
  {
    Figure_Area: 'Team Cards — Avg TAT',
    Scope_Requirement: 'Per-team: open TAT = GETDATE()−DateCreated; closed TAT = DateCompleted−DateCreated',
    Implemented_Logic: 'AVG(CASE WHEN TaskStatusID IN (1,4,5,6) THEN DATEDIFF(MIN,DateCreated,GETDATE())/60.0 ELSE DATEDIFF(MIN,DateCreated,DateCompleted)/60.0 END)\nScoped to DateCreated = today, grouped by DepartmentId.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now uses real-time DATEDIFF. Previously used AVG(TotalHoursOnTask) which was NULL for 98% of active tasks.',
    Full_Query_Fragment: `-- fetchTeamsData Q1 — avgTat
AVG(CASE WHEN t.TaskStatusID IN (1,4,5,6)
         THEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0
         ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
    END) AS avgTat
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,2,4,5,6) AND [TEAM_FILTER]
  AND t.DateCreated >= '[today]' AND t.DateCreated < '[todayNext]'
GROUP BY CASE [TEAM_ID_CASE] END`
  },
  {
    Figure_Area: 'Team Cards — SLA %',
    Scope_Requirement: 'Per-team: completed within target ÷ total completed × 100 (DateCompleted today)',
    Implemented_Logic: 'CAST(SUM(CASE WHEN DATEDIFF(DateCreated,DateCompleted)/60.0 <= targetExpr THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(total,0) * 100\nGrouped by DepartmentId, scoped to DateCompleted = today.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'TAT now computed from DateCompleted−DateCreated. targetExpr = per-team configured target.',
    Full_Query_Fragment: `-- fetchTeamsData Q3 — todaySla per team
CAST(SUM(CASE WHEN t.DateCompleted >= '[today]' AND t.DateCompleted < '[todayNext]'
             AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= [targetExpr]
             THEN 1 ELSE 0 END) AS FLOAT)
/ NULLIF(SUM(CASE WHEN t.DateCompleted >= '[today]' AND t.DateCompleted < '[todayNext]'
                  THEN 1 ELSE 0 END), 0) * 100 AS todaySla
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID = 2 AND [TEAM_FILTER]
  AND t.DateCompleted >= '[prev]' AND t.DateCompleted < '[todayNext]'
GROUP BY CASE [TEAM_ID_CASE] END`
  },
  {
    Figure_Area: 'Team Cards — Overdue Count',
    Scope_Requirement: 'Per-team open tasks where TAT > configured SLA target',
    Implemented_Logic: 'SUM(... AND (DATEDIFF(MIN,DateCreated,GETDATE())/60.0 > targetExpr OR SLAAdjustedDate condition))\nGrouped by DepartmentId, scoped to DateCreated = today.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now uses real-time TAT. Dual condition: elapsed TAT > target OR past SLAAdjustedDate.',
    Full_Query_Fragment: `-- fetchTeamsData Q1 — overdue per team
SUM(CASE WHEN t.TaskStatusID IN (1,4,5,6)
         AND (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [targetExpr]
              OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
         THEN 1 ELSE 0 END) AS overdue
GROUP BY CASE [TEAM_ID_CASE] END`
  },
  {
    Figure_Area: 'Team Cards — Overdue Delta',
    Scope_Requirement: 'Delta = today overdue − prevBizDay overdue (same TAT rule)',
    Implemented_Logic: 'todayOverdue and prevOverdue computed in Q2 delta query using DATEDIFF(DateCreated,GETDATE())/60.0 > targetExpr per date window.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Both today and prev use GETDATE() for still-open tasks in each date window. Correctly reflects real-time status.',
    Full_Query_Fragment: `-- fetchTeamsData Q2 — todayOverdue / prevOverdue delta
SUM(CASE WHEN t.DateCreated >= '[today]' AND t.DateCreated < '[todayNext]'
         AND t.TaskStatusID IN (1,4,5,6)
         AND (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [targetExpr]
              OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
         THEN 1 ELSE 0 END) AS todayOverdue`
  },
  {
    Figure_Area: 'Tasks View — Status (bad/warn/ok)',
    Scope_Requirement: 'bad: TAT > SLA target; warn: TAT >= atRiskFraction × target; ok: TAT < threshold',
    Implemented_Logic: `CASE
  WHEN SLAInHours IS NULL OR SLAInHours = 0 THEN 'ok'
  WHEN DATEDIFF(MIN,DateCreated,GETDATE())/60.0 > SLAInHours OR SLAAdjustedDate cond THEN 'bad'
  WHEN DATEDIFF(MIN,DateCreated,GETDATE())/60.0 >= SLAInHours * atRiskFraction THEN 'warn'
  ELSE 'ok'
END
atRiskFraction default 87.5%, configurable via ?atRiskPct=N`,
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now uses real-time DATEDIFF TAT. atRiskFraction now accepted as query param (was hardcoded 0.875). At-risk warn filter also excludes SLAAdjustedDate-breached tasks.',
    Full_Query_Fragment: `-- /api/tasks — status CASE in SELECT
CASE
  WHEN t.SLAInHours IS NULL OR t.SLAInHours = 0 THEN 'ok'
  WHEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > t.SLAInHours
    OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate) THEN 'bad'
  WHEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= t.SLAInHours * ${'{atRiskFraction}'} THEN 'warn'
  ELSE 'ok'
END AS status

-- status='bad' WHERE filter:
AND (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > t.SLAInHours
     OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))

-- status='warn' WHERE filter:
AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= t.SLAInHours * [atRiskFraction]
AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= t.SLAInHours
AND (t.SLAAdjustedDate IS NULL OR GETDATE() <= t.SLAAdjustedDate)

-- ORDER BY (worst first):
ORDER BY DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 DESC`
  },
  {
    Figure_Area: 'Alerts Panel — SLA %',
    Scope_Requirement: 'Per-team SLA% based on active tasks breaching target (realtime)',
    Implemented_Logic: 'compliant = active tasks where DATEDIFF(DateCreated,GETDATE())/60.0 <= alertTargetExpr AND SLAAdjustedDate not passed\noverdue = DATEDIFF > alertTargetExpr OR SLAAdjustedDate passed\nSLA% = compliant/total * 100\nNo date scope — all currently active tasks.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Previously used TotalHoursOnTask IS NULL = compliant (inflated compliant count). Now uses real-time DATEDIFF — alerts will fire correctly even when TotalHoursOnTask is NULL.',
    Full_Query_Fragment: `-- /api/alerts — per-team compliant / overdue counts
SELECT
  CASE [TEAM_ID_CASE] END AS teamId,
  COUNT(*) AS total,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= [alertTargetExpr]
                AND (t.SLAAdjustedDate IS NULL OR GETDATE() <= t.SLAAdjustedDate)
           THEN 1 ELSE 0 END) AS compliant,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [alertTargetExpr]
             OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate)
           THEN 1 ELSE 0 END) AS overdue
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,4,5,6) AND [TEAM_FILTER]
GROUP BY CASE [TEAM_ID_CASE] END`
  },
  {
    Figure_Area: 'Alert Drill-through — Overdue Tasks',
    Scope_Requirement: 'Show open tasks whose elapsed TAT > SLA target, sorted worst-first',
    Implemented_Logic: 'WHERE DATEDIFF(MIN,DateCreated,GETDATE())/60.0 > slaExpr OR SLAAdjustedDate condition\nORDER BY DATEDIFF(MIN,DateCreated,GETDATE())/60.0 / slaExpr DESC\noverdueHours = DATEDIFF elapsed − slaExpr (or SLAAdjustedDate gap)',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now 100% real-time. Previously used TotalHoursOnTask for WHERE/ORDER — missed all tasks where TotalHoursOnTask was NULL.',
    Full_Query_Fragment: `-- /api/alert-tasks/:teamId — overdue UNION branch (TOP 25)
SELECT TOP 25
  t.TaskID, t.ShortDescription, t.TotalHoursOnTask, t.SLAInHours, t.OverDueComments,
  CASE
    WHEN DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [slaExpr]
      THEN ROUND(DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 - [slaExpr], 1)
    WHEN t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate
      THEN ROUND(DATEDIFF(MINUTE, t.SLAAdjustedDate, GETDATE()) / 60.0, 1)
    ELSE 0
  END AS overdueHours,
  'overdue' AS taskType
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,4,5,6) AND s.DepartmentId = [deptId] AND s.EmployeeStatus = 1
  AND [slaExpr] > 0
  AND (DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 > [slaExpr]
       OR (t.SLAAdjustedDate IS NOT NULL AND GETDATE() > t.SLAAdjustedDate))
ORDER BY DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 / [slaExpr] DESC`
  },
  {
    Figure_Area: 'Alert Drill-through — At Risk Tasks',
    Scope_Requirement: 'Show open tasks where TAT >= atRiskFraction × SLA target AND TAT <= SLA target',
    Implemented_Logic: 'WHERE DATEDIFF(MIN,DateCreated,GETDATE())/60.0 >= slaExpr * atRiskFraction AND <= slaExpr AND SLAAdjustedDate not passed\nORDER BY DATEDIFF / slaExpr DESC\natRiskFraction default 87.5%, configurable via ?atRiskPct=N',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'Now uses real-time DATEDIFF. Previously relied on TotalHoursOnTask which was NULL for most active tasks. At-risk tasks now correctly excluded if SLAAdjustedDate has already passed (those show as overdue instead).',
    Full_Query_Fragment: `-- /api/alert-tasks/:teamId — at-risk UNION branch (TOP 25)
SELECT TOP 25
  t.TaskID, t.ShortDescription, t.TotalHoursOnTask, t.SLAInHours, t.OverDueComments,
  0 AS overdueHours, 'atrisk' AS taskType
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID IN (1,4,5,6) AND s.DepartmentId = [deptId] AND s.EmployeeStatus = 1
  AND [slaExpr] > 0
  AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 >= [slaExpr] * [atRiskFraction]
  AND DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 <= [slaExpr]
  AND (t.SLAAdjustedDate IS NULL OR GETDATE() <= t.SLAAdjustedDate)
ORDER BY DATEDIFF(MINUTE, t.DateCreated, GETDATE()) / 60.0 / [slaExpr] DESC`
  },
  {
    Figure_Area: '7-Day Trend Chart + History Chart',
    Scope_Requirement: 'Per-team per-day SLA%: completed within target ÷ total completed (DateCompleted basis)',
    Implemented_Logic: 'SUM(CASE WHEN DATEDIFF(MIN,DateCreated,DateCompleted)/60.0 <= targetExpr THEN 1 ELSE 0 END) / COUNT(*)\nGrouped by CONVERT(varchar,DateCompleted,120) and DepartmentId. BusinessDays-only X-axis in frontend.',
    Meets_Scope: 'Yes',
    Notes_Gaps: 'TAT now computed as DateCompleted−DateCreated. Filter: TaskStatusID=2, DateCompleted >= startDate, DateCreated IS NOT NULL, SLAInHours > 0.',
    Full_Query_Fragment: `-- fetchHistoryData — per-team per-day SLA%
SELECT
  CONVERT(varchar(10), t.DateCompleted, 120) AS Date,
  CASE [TEAM_ID_CASE] END AS teamId,
  COUNT(*) AS total,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= [targetExpr]
           THEN 1 ELSE 0 END) AS compliant
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
WHERE t.TaskStatusID = 2
  AND t.DateCompleted >= @startDate
  AND t.DateCompleted IS NOT NULL
  AND t.DateCreated IS NOT NULL
  AND t.SLAInHours > 0
  AND [TEAM_FILTER]
GROUP BY CONVERT(varchar(10), t.DateCompleted, 120), CASE [TEAM_ID_CASE] END`
  },
];

// ─── Worksheet column widths ──────────────────────────────────────────────────
const colWidths = [
  { wch: 38 },  // Figure / Area
  { wch: 60 },  // Scope Requirement
  { wch: 70 },  // Implemented Logic
  { wch: 14 },  // Meets Scope
  { wch: 70 },  // Notes / Gaps
  { wch: 100 }, // Full Query
];

// ─── Build workbook ───────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

// Header row
const headers = [
  'Figure / Area',
  'Scope Requirement',
  'Current Implemented Logic',
  'Meets Scope?',
  'Notes / Gaps',
  'Full Query Used',
];

const wsData = [
  headers,
  ...rows.map(r => [
    r.Figure_Area,
    r.Scope_Requirement,
    r.Implemented_Logic,
    r.Meets_Scope,
    r.Notes_Gaps,
    r.Full_Query_Fragment,
  ]),
];

const ws = XLSX.utils.aoa_to_sheet(wsData);
ws['!cols'] = colWidths;

// Freeze header row
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws, 'SLA Logic Audit');

// ─── Summary sheet ────────────────────────────────────────────────────────────
const total = rows.length;
const meetYes = rows.filter(r => r.Meets_Scope === 'Yes').length;
const meetPartial = rows.filter(r => r.Meets_Scope === 'Partial').length;
const meetNo = rows.filter(r => r.Meets_Scope === 'No').length;

const summaryData = [
  ['SLA Logic Audit — Post-Implementation Summary'],
  ['Generated', new Date().toISOString().slice(0, 10)],
  [],
  ['Key change: All TAT calculations now use real-time DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0'],
  ['for open tasks and DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0 for closed tasks.'],
  ['The stored TotalHoursOnTask column is no longer used for any calculation.'],
  [],
  ['Metric', 'Count'],
  ['Total areas audited', total],
  ['Meets scope (Yes)', meetYes],
  ['Partially meets scope (Partial)', meetPartial],
  ['Does not meet scope (No)', meetNo],
  [],
  ['Main Changes Applied', ''],
  ['fetchKpiData Q1', 'avgTat, overdue, prevOverdue, prevTat — now use DATEDIFF real-time TAT'],
  ['fetchKpiData Q2', 'SLA% — now uses DATEDIFF(DateCreated, DateCompleted) instead of TotalHoursOnTask IS NULL'],
  ['fetchTeamsData Q1', 'avgTat, overdue — now use DATEDIFF real-time TAT'],
  ['fetchTeamsData Q2', 'delta overdue, delta TAT — now use DATEDIFF real-time TAT'],
  ['fetchTeamsData Q3', 'SLA% — now uses DATEDIFF(DateCreated, DateCompleted)'],
  ['/api/tasks', 'status CASE + all status filters + ORDER BY — now use DATEDIFF real-time TAT; atRiskFraction now a query param'],
  ['/api/alerts', 'compliant, overdue counts — now use DATEDIFF real-time TAT (was TotalHoursOnTask IS NULL)'],
  ['/api/alert-tasks', 'overdueHours, overdue WHERE/ORDER, at-risk WHERE/ORDER — all now use DATEDIFF TAT'],
  ['/api/history', 'compliant SUM — now uses DATEDIFF(DateCreated, DateCompleted)'],
  ['constants.js tooltips', 'kpi.avgTat, kpi.totalOverdue, kpi.overallSla, team.avgTat, team.overdue, modal.avgTat, modal.overdue, alerts.panel — all updated'],
  ['CLAUDE.md', 'TAT Rule, Overdue Rule, At Risk Rule, SLA% Rule — all updated to reflect DATEDIFF logic'],
];

const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
wsSummary['!cols'] = [{ wch: 50 }, { wch: 80 }];
XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

// ─── Write file ───────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'SLA_Logic_Audit_2026-06-12.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Excel audit file written to:', outPath);
