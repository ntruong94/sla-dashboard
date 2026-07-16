/**
 * generate-tooltips-xlsx.js
 * Extracts all tooltip text from constants.js and views.jsx (inline),
 * then writes/overwrites docs/SLA_Dashboard_Tooltips.xlsx
 * Run: node docs/generate-tooltips-xlsx.js  (from project root)
 */

const XLSX  = require('../backend/node_modules/xlsx');
const path  = require('path');

// ── All tooltip rows ─────────────────────────────────────────────────────────
// Format: [Section, Key, UI Location, Tooltip Text]

const rows = [

  // ── KPI Tiles ──────────────────────────────────────────────────────────────
  [
    'KPI',
    'kpi.totalTasks',
    'Dashboard → KPI tile: Total Active Tasks',
    'Count of ACTIVE tasks across all teams now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
  ],
  [
    'KPI',
    'kpi.overallSla',
    'Dashboard → KPI tile: Overall SLA %',
    'Percentage of COMPLETED tasks that are SLA-compliant on the reporting date.\n\nFormula: \n (TotalHoursOnTask < SLAInHours or\n DateCompleted ≤ SLAAdjustedDate) ÷ total completed # × 100\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.',
  ],
  [
    'KPI',
    'kpi.avgTat',
    'Dashboard → KPI tile: Avg Turnaround',
    'Average time-in-progress across all teams on the reporting date.\n\nRules:\n- Open tasks: TotalHoursOnTask is used (tasks where TotalHoursOnTask IS NULL are excluded from the average).\n- Closed tasks: elapsed = DateCompleted − DateCreated (in hours).\n\nIncludes: Active tasks with non-null TotalHoursOnTask + Completed.\n\nExcluded: Cancelled; Active tasks where TotalHoursOnTask IS NULL.\n\nDate basis: Date Created and Date Completed.',
  ],
  [
    'KPI',
    'kpi.totalOverdue',
    'Dashboard → KPI tile: Overdue',
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- TotalHoursOnTask must be non-null and > 0\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when SLAAdjustedDate is set and current time > SLAAdjustedDate\n\nIncludes: In Progress, On Hold, On Queue, Not Queued\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask IS NULL or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  ],

  // ── Team Cards ─────────────────────────────────────────────────────────────
  [
    'Team',
    'team.volume',
    'Dashboard → Team card: Volume chip',
    'Number of ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
  ],
  [
    'Team',
    'team.sla',
    'Dashboard → Team card: SLA % badge',
    'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n (TotalHoursOnTask < SLAInHours or\n DateCompleted ≤ SLAAdjustedDate) ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings.',
  ],
  [
    'Team',
    'team.avgTat',
    'Dashboard → Team card: Avg TAT chip',
    'Average time-in-progress across all teams on the reporting date.\n\nRules:\n- Open tasks: TotalHoursOnTask is used (tasks where TotalHoursOnTask IS NULL are excluded from the average).\n- Closed tasks: elapsed = DateCompleted − DateCreated (in hours).\n\nIncludes: Active tasks with non-null TotalHoursOnTask + Completed.\n\nExcluded: Cancelled; Active tasks where TotalHoursOnTask IS NULL.\n\nDate basis: Date Created and Date Completed.',
  ],
  [
    'Team',
    'team.overdue',
    'Dashboard → Team card: Overdue chip',
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- TotalHoursOnTask must be non-null and > 0\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when SLAAdjustedDate is set and current time > SLAAdjustedDate\n\nIncludes: In Progress, On Hold, On Queue, Not Queued\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask IS NULL or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  ],

  // ── Charts ─────────────────────────────────────────────────────────────────
  [
    'Chart',
    'chart.trend',
    'Dashboard → 7-Day SLA Compliance Trend chart title',
    'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n- SLA-compliant = TotalHoursOnTask < SLAInHours, OR DateCompleted ≤ SLAAdjustedDate.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Completed.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team In Settings.',
  ],
  [
    'Chart',
    'chart.history',
    'Reports → Compliance · Last N days chart title',
    'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n- SLA-compliant = TotalHoursOnTask ≠ 0 AND TotalHoursOnTask < SLAInHours, OR DateCompleted ≤ SLAAdjustedDate.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Completed.\n\nInteractions:\n- Click a team name in the legend to dim or restore its line.\n- Hover over the chart to compare values on a specific day.\n- Use the range selector to change the viewing period.\n\nTarget is configurable per team In Settings.',
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
    'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n (TotalHoursOnTask < SLAInHours or\n DateCompleted ≤ SLAAdjustedDate) ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings.',
  ],
  [
    'Modal',
    'modal.volume',
    'Task Modal → Volume chip (active tasks mode)',
    'Total ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
  ],
  [
    'Modal',
    'modal.avgTat',
    'Task Modal → Avg TAT chip (active tasks mode)',
    'Average time-in-progress across all teams on the reporting date.\n\nRules:\n- Open tasks: TotalHoursOnTask is used (tasks where TotalHoursOnTask IS NULL are excluded from the average).\n- Closed tasks: elapsed = DateCompleted − DateCreated (in hours).\n\nIncludes: Active tasks with non-null TotalHoursOnTask + Completed.\n\nExcluded: Cancelled; Active tasks where TotalHoursOnTask IS NULL.\n\nDate basis: Date Created and Date Completed.',
  ],
  [
    'Modal',
    'modal.avgTatCompleted',
    'Task Modal → Avg TAT chip (completed tasks mode — SLA % badge click)',
    'Average TAT across completed tasks in this drill-through.\n\nRules:\n- Per-task TAT: TotalHoursOnTask when not null\n- Fallback: DATEDIFF(SLAAdjustedDate, DateCompleted) in hours when TotalHoursOnTask IS NULL and SLAAdjustedDate is set\n- Tasks where neither value is available are excluded from the average\n\nIncludes: Completed tasks (TaskStatusID = 2)\n\nExcluded: Tasks where TotalHoursOnTask IS NULL and SLAAdjustedDate IS NULL\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings.',
  ],
  [
    'Modal',
    'modal.overdue',
    'Task Modal → Overdue chip (active tasks mode)',
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- TotalHoursOnTask must be non-null and > 0\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when SLAAdjustedDate is set and current time > SLAAdjustedDate\n\nIncludes: In Progress, On Hold, On Queue, Not Queued\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask IS NULL or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  ],
  [
    'Modal',
    'modal.overdueCompleted',
    'Task Modal → Overdue (Only Completed Tasks) chip (completed tasks mode)',
    'Count of completed tasks that exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours (per-task field, when TotalHoursOnTask is not null)\n- Overdue when DateCompleted > SLAAdjustedDate (when SLAAdjustedDate is set)\n\nIncludes: Completed tasks only (TaskStatusID = 2)\n\nExcluded: Active tasks; Tasks where TotalHoursOnTask IS NULL and SLAAdjustedDate is not breached\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings.',
  ],

  // ── Alerts Panel ───────────────────────────────────────────────────────────
  [
    'Alerts',
    'alerts.panel',
    'Dashboard → Active Alerts panel title / Alerts tab title',
    '1. For every team, the backend counts how many of today\'s active tasks (In Progress, On Hold, On Queue, Not Queued) are compliant — meaning their elapsed time hasn\'t exceeded the task\'s own SLAInHours limit.\n\n2. It divides that by the total active task count to get a live SLA% for each team.\n\n3. If SLA% drops below a threshold, an alert fires:\n- < 75% → Critical (breach threshold)\n- 75–89% → Warning (at risk)\n- ≥ 90% → No alert\n\n4. The alert description is written as: "X active tasks today, Y files complete, Z files overdue, SLA at N%"\n\n5. Alerts clear automatically the next time the cache refreshes (every 5 min) if the team\'s SLA% has recovered above the threshold. No manual dismissal needed — though users can manually dismiss from the UI to hide it for their session.\n\n6. The "triggered X ago" timestamp is preserved in memory so refreshes don\'t reset the clock.\n\nTarget is configurable per team In Settings.',
  ],

  // ── Loan Strip Cards ───────────────────────────────────────────────────────
  [
    'Loan',
    'loan.received',
    'Dashboard → Loan card: Application Received',
    'Total applications received on the latest reporting date.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on the reporting date.\n\nClick the card to view individual application details.',
  ],
  [
    'Loan',
    'loan.approved',
    'Dashboard → Loan card: Funder Approvals',
    'Total applications approved by the funder on the latest reporting date.\n\nCounts distinct Application IDs where Date_FunderApproval falls on the reporting date.\n\nClick the card to view individual application details.',
  ],
  [
    'Loan',
    'loan.settled',
    'Dashboard → Loan card: Settlements',
    'Total loans settled on the latest reporting date.\n\nCounts distinct Application IDs where Date_Settled falls on the reporting date.\n\nClick the card to view individual application details.',
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
