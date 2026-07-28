/**
 * generate-tooltips-xlsx.js
 * Extracts all tooltip text from constants.js and views.jsx (inline),
 * then writes/overwrites docs/SLA_Dashboard_Tooltips.xlsx
 * Run: node docs/generate-tooltips-xlsx.js  (from project root)
 * Last updated: 2026-07-28 — synced with constants.js + views.jsx
 */

const XLSX  = require('../backend/node_modules/xlsx');
const path  = require('path');

// ── All tooltip rows ─────────────────────────────────────────────────────────
// Format: [Section, Key, UI Location, Tooltip Text]
// Source of truth: frontend/src/constants.js (TOOLTIPS object)
//                  frontend/src/components/views.jsx (inline InfoTip text props)

const rows = [

  // ── KPI Tiles ──────────────────────────────────────────────────────────────
  [
    'KPI',
    'kpi.totalTasks',
    'Dashboard → KPI tile: Total Active Tasks',
    'All currently active tasks across every team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: No date filter — all currently active tasks.',
  ],
  [
    'KPI',
    'kpi.overallSla',
    'Dashboard → KPI tile: Overall SLA %',
    'SLA compliance rate for completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nIncludes: Completed tasks (SLAAdjustedDate = today).\n\nExcluded: Active and Cancelled.\n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.',
  ],
  [
    'KPI',
    'kpi.avgTat',
    'Dashboard → KPI tile: Avg Turnaround',
    'Average time on task across all currently active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n- Tasks with null or zero TotalHoursOnTask are excluded from the average.\n\nIncludes: Active tasks.\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.',
  ],
  [
    'KPI',
    'kpi.totalOverdue',
    'Dashboard → KPI tile: Overdue',
    "Count of active tasks that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > task's own SLAInHours.\n- TotalHoursOnTask > team's SLA target in Settings.\n- Current time > task's SLAAdjustedDate.\n\nIncludes: Active tasks.\n\nExcluded: Cancelled; Completed; tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.",
  ],

  // ── Team Cards ─────────────────────────────────────────────────────────────
  [
    'Team',
    'team.volume',
    'Dashboard → Team card: Volume chip',
    'Active tasks currently assigned to this team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: No date filter — all currently active tasks.',
  ],
  [
    'Team',
    'team.sla',
    'Dashboard → Team card: SLA % badge',
    "SLA compliance rate for this team's completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nRules:\n- Green ≥ 90% (On Target)\n- Amber 75–89% (At Risk)\n- Red < 75% (Breach)\n\nIncludes: Completed tasks (SLAAdjustedDate = today).\n\nExcluded: Active and Cancelled.\n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.",
  ],
  [
    'Team',
    'team.avgTat',
    'Dashboard → Team card: Avg TAT chip',
    "Average time on task for this team's active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n- Tasks with null or zero TotalHoursOnTask are excluded from the average.\n\nIncludes: Active tasks.\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.",
  ],
  [
    'Team',
    'team.overdue',
    'Dashboard → Team card: Overdue chip',
    "Active tasks in this team that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > task's own SLAInHours.\n- TotalHoursOnTask > team's SLA target in Settings.\n- Current time > task's SLAAdjustedDate.\n\nIncludes: Active tasks.\n\nExcluded: Cancelled; Completed; tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.",
  ],

  // ── Charts ─────────────────────────────────────────────────────────────────
  [
    'Chart',
    'chart.trend',
    'Dashboard → 7-Day SLA Compliance Trend chart title',
    'Daily SLA compliance per team over the past 7 business days.\n\nRules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks that were SLA-compliant on that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled.\n\nDate basis: SLAAdjustedDate.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team in Settings.',
  ],
  [
    'Chart',
    'chart.history',
    'Reports → Compliance · Last N days chart title',
    'Historical SLA compliance per team over the selected date range.\n\nRules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks that were SLA-compliant on that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled.\n\nDate basis: SLAAdjustedDate.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team in Settings.',
  ],

  // ── Teams View ─────────────────────────────────────────────────────────────
  [
    'Teams View',
    'teams.status',
    'Teams tab → Status column header',
    '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  ],

  // ── Task Drill-Through Modal ────────────────────────────────────────────────
  [
    'Modal',
    'modal.sla',
    'Task Modal → SLA % chip (active tasks mode)',
    "SLA compliance rate for this team's completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nRules:\n- Green ≥ 90% (On Target)\n- Amber 75–89% (At Risk)\n- Red < 75% (Breach)\n\nIncludes: Completed tasks (SLAAdjustedDate = today).\n\nExcluded: Active and Cancelled.\n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.",
  ],
  [
    'Modal',
    'modal.volume',
    'Task Modal → Volume chip (active tasks mode)',
    'Active tasks currently assigned to this team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: No date filter — all currently active tasks.',
  ],
  [
    'Modal',
    'modal.avgTat',
    'Task Modal → Avg TAT chip (active tasks mode)',
    "Average time on task for this team's active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n- Tasks with null or zero TotalHoursOnTask are excluded from the average.\n\nIncludes: Active tasks.\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.",
  ],
  [
    'Modal',
    'modal.avgTatCompleted',
    'Task Modal → Avg TAT chip (completed tasks mode — SLA % badge click)',
    'Average time on task for completed tasks.\n\nRules:\n- Uses TotalHoursOnTask when available (business hours).\n- Falls back to DateCompleted - DateCreated (in hours) when TotalHoursOnTask is null.\n\nIncludes: Completed tasks.\n\nExcluded: Tasks where both TotalHoursOnTask and SLAAdjustedDate are null.\n\nDate basis: SLAAdjustedDate.',
  ],
  [
    'Modal',
    'modal.overdue',
    'Task Modal → Overdue chip (active tasks mode)',
    "Active tasks in this team that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > task's own SLAInHours.\n- TotalHoursOnTask > team's SLA target in Settings.\n- Current time > task's SLAAdjustedDate.\n\nIncludes: Active tasks.\n\nExcluded: Cancelled; Completed; tasks where TotalHoursOnTask is null or 0.\n\nDate basis: No date filter — all currently active tasks.\n\nTarget is configurable per team in Settings.",
  ],
  [
    'Modal',
    'modal.overdueCompleted',
    'Task Modal → Overdue chip (completed tasks mode — SLA % badge click)',
    "Completed tasks in this team that exceeded their SLA deadline.\n\nA task is overdue when either of these apply:\n- TotalHoursOnTask > task's own SLAInHours.\n- DateCompleted > SLAAdjustedDate.\n\nIncludes: Completed tasks.\n\nExcluded: Cancelled; Active tasks; tasks where TotalHoursOnTask is null or 0.\n\nDate basis: SLAAdjustedDate.",
  ],

  // ── Alerts Panel ───────────────────────────────────────────────────────────
  [
    'Alerts',
    'alerts.panel',
    'Dashboard → Active Alerts panel title / Alerts tab title',
    "How SLA alerts are generated:\n\n1. For each team, the system calculates what % of active tasks are within their SLA limit.\n\n2. If SLA% drops below 90%, a warning is raised. Below 75% triggers a critical alert.\n\n3. Alerts resolve automatically when the team's SLA% recovers (checked every 5 minutes). Users can also dismiss alerts manually for their session.\n\nTarget is configurable per team in Settings.",
  ],

  // ── Loan Strip Cards ───────────────────────────────────────────────────────
  [
    'Loan',
    'loan.received',
    'Dashboard → Loan card: Application Received',
    'Total loan applications received on the latest reporting date.\n\nCounts applications where Date_ApplicationReceived matches the reporting date.\n\nClick to view individual application details.',
  ],
  [
    'Loan',
    'loan.approved',
    'Dashboard → Loan card: Funder Approvals',
    'Total applications approved by the funder on the latest reporting date.\n\nCounts applications where Date_FunderApproval matches the reporting date.\n\nClick to view individual application details.',
  ],
  [
    'Loan',
    'loan.settled',
    'Dashboard → Loan card: Settlements',
    'Total loans settled on the latest reporting date.\n\nCounts applications where Date_Settled matches the reporting date.\n\nClick to view individual application details.',
  ],

  // ── Settings Tab (inline tooltips in views.jsx) ────────────────────────────
  [
    'Settings',
    'settings.refreshInterval',
    'Settings tab → Refresh interval input',
    'How often the dashboard silently fetches fresh data from the database.\n\nNo page reload — all cards update in the background.\n\nWhat refreshes:\n- KPI tiles\n- Team cards\n- Tasks list\n- Alerts\n- Loan summary\n\nWhat does NOT auto-refresh:\n- History chart (only loads on login or Apply)\n\nValid range: 1–60 minutes.\nDefault: 5 minutes.',
  ],
  [
    'Settings',
    'settings.atRiskThreshold',
    'Settings tab → At Risk threshold input',
    'How it works:\nA task turns amber before it breaches SLA.\n\nTask states (consumed = time spent ÷ SLA target):\n- Green — below threshold (on track)\n- Amber — at or above threshold (at risk)\n- Red — above 100% (overdue / breached)\n\nExamples with a 4h SLA target:\n- 50% threshold → amber at 2h, red at 4h\n- 87.5% (default) → amber at 3.5h, red at 4h\n\nApplies to:\n- Task list row colours\n- Alerts panel drill-down\n- Warning alerts per team',
  ],
  [
    'Settings',
    'settings.tasksInDrillDown',
    'Settings tab → Tasks in drill-down input',
    'Max number of tasks shown when you click into a team card or alert.\n\nTasks are ranked by SLA consumption (highest first), so the most critical items appear at the top.\n\nValid range: 1–100.\nDefault: 50.',
  ],
];

// ── Build workbook ────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

// Sheet 1: All Tooltips flat table
const header = ['Section', 'Key', 'UI Location', 'Tooltip Text'];
const sheetData = [header, ...rows];

const ws = XLSX.utils.aoa_to_sheet(sheetData);

// Column widths (approximate chars)
ws['!cols'] = [
  { wch: 14 },   // Section
  { wch: 28 },   // Key
  { wch: 55 },   // UI Location
  { wch: 90 },   // Tooltip Text
];

// Freeze header row
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws, 'All Tooltips');

// Sheet 2: By Section pivot
const sections = [...new Set(rows.map(r => r[0]))];
const wb2Data  = [['Section', 'Count']];
sections.forEach(s => wb2Data.push([s, rows.filter(r => r[0] === s).length]));
const ws2 = XLSX.utils.aoa_to_sheet(wb2Data);
ws2['!cols'] = [{ wch: 16 }, { wch: 8 }];
XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

// ── Write file ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'SLA_Dashboard_Tooltips.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✅  Written ${rows.length} tooltips → ${outPath}`);
