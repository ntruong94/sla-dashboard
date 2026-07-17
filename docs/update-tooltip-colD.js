/**
 * update-tooltip-colD.js  (one-time update script)
 * Writes current tooltip text from constants.js / views.jsx into column D
 * of SLA_Dashboard_Tooltips.xlsx.  Column E and all other columns are untouched.
 * Run: node docs/update-tooltip-colD.js  (from project root)
 */
const XLSX = require('../backend/node_modules/xlsx');
const path = require('path');

// ── Current tooltip values sourced from frontend/src/constants.js and views.jsx ──
const updates = {

  // KPI tiles (constants.js → TOOLTIPS.kpi)
  'kpi.totalTasks':
    'Count of ACTIVE tasks across all teams now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',

  'kpi.overallSla':
    'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',

  'kpi.avgTat':
    'Average TAT of ACTIVE tasks (current of all performance team cards) \n\nRules:\n- avg TAT = avg TotalHoursOnTask when not null\n\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null are excuded from the average\n\nDate basis: Date Created.',

  'kpi.totalOverdue':
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',

  // Team cards (constants.js → TOOLTIPS.team)
  'team.volume':
    'Number of ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',

  'team.sla':
    'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',

  'team.avgTat':
    'Average TAT of ACTIVE tasks (current of all performance team cards) \n\nRules:\n- avg TAT = avg TotalHoursOnTask when not null\n\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null are excuded from the average\n\nDate basis: Date Created.',

  'team.overdue':
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',

  // Charts (constants.js → TOOLTIPS.chart)
  'chart.trend':
    'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Created.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.',

  'chart.history':
    'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Created.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.',

  // Teams view (constants.js → TOOLTIPS.teams)
  'teams.status':
    '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',

  // Modal chips (constants.js → TOOLTIPS.modal)
  'modal.sla':
    'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',

  'modal.volume':
    'Total ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',

  'modal.avgTat':
    'Average TAT of ACTIVE tasks (current of all performance team cards) \n\nRules:\n- avg TAT = avg TotalHoursOnTask when not null\n\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null are excuded from the average\n\nDate basis: Date Created.',

  'modal.avgTatCompleted':
    'Average TAT across completed tasks \n\nRules:\n- avg TAT = avg TotalHoursOnTask when not null\n- DATEDIFF(DateCreated, DateCompleted) in hours when TotalHoursOnTask is null and SLAAdjustedDate is set\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null and SLAAdjustedDate is null\n\nDate basis: Date Created.',

  'modal.overdue':
    'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',

  'modal.overdueCompleted':
    'Count of completed tasks that exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when DateCompleted > SLAAdjustedDate\n\nIncludes: Completed\n\nExcluded: Cancelled; Active tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created',

  // Alerts (constants.js → TOOLTIPS.alerts)
  'alerts.panel':
    '1. For every team, the system counts how many of today\'s active tasks (In Progress, On Hold, On Queue, Not Queued) are compliant — meaning their elapsed time hasn\'t exceeded the task\'s own SLAInHours limit.\n\n2. It divides that by the total active task count to get a live SLA% for each team.\n\n3. Alerts clear automatically the next time the cache refreshes (every 5 min) if the team\'s SLA% has recovered above the threshold. No manual dismissal needed — though users can manually dismiss from the UI to hide it for their session.\n\n',

  // Loan cards (constants.js → TOOLTIPS.loan)
  'loan.received':
    'Total applications received on the latest reporting date.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on the reporting date.\n\nClick the card to view individual application details.',

  'loan.approved':
    'Total applications approved by the funder on the latest reporting date.\n\nCounts distinct Application IDs where Date_FunderApproval falls on the reporting date.\n\nClick the card to view individual application details.',

  'loan.settled':
    'Total loans settled on the latest reporting date.\n\nCounts distinct Application IDs where Date_Settled falls on the reporting date.\n\nClick the card to view individual application details.',

  // Settings (inline in views.jsx)
  'settings.refreshInterval':
    'How often the dashboard silently fetches fresh data from the database.\n\nNo page reload — all cards update in the background.\n\nWhat refreshes:\n- KPI tiles\n- Team cards\n- Tasks list\n- Alerts\n- Loan summary\n\nWhat does NOT auto-refresh:\n- History chart (only loads on login or Apply)\n\nValid range: 1–60 minutes.\nDefault: 5 minutes.',

  'settings.atRiskThreshold':
    'How it works:\nA task turns amber before it breaches SLA.\n\nTask states (consumed = time spent ÷ SLA target):\n- Green — below threshold (on track)\n- Amber — at or above threshold (at risk)\n- Red — above 100% (overdue / breached)\n\nExamples with a 4h SLA target:\n- 50% threshold → amber at 2h, red at 4h\n- 87.5% (default) → amber at 3.5h, red at 4h\n\nApplies to:\n- Task list row colours\n- Alerts panel drill-down\n- Warning alerts per team',

  'settings.tasksInDrillDown':
    'Max number of tasks shown when you click into a team card or alert.\n\nTasks are ranked by SLA consumption (highest first), so the most critical items appear at the top.\n\nValid range: 1–100.\nDefault: 10.',
};

// ── Read, update, write ────────────────────────────────────────────────────────
const filePath = path.join(__dirname, 'SLA_Dashboard_Tooltips.xlsx');
const wb       = XLSX.readFile(filePath);
const ws       = wb.Sheets[wb.SheetNames[0]];
const data     = XLSX.utils.sheet_to_json(ws, { header: 1 });
const savedCols = ws['!cols'];

let updatedCount = 0;
data.slice(1).forEach(row => {
  const key = row[1];
  if (Object.prototype.hasOwnProperty.call(updates, key)) {
    row[3] = updates[key];
    updatedCount++;
  }
});

const newWs = XLSX.utils.aoa_to_sheet(data);
newWs['!cols'] = savedCols;
wb.Sheets[wb.SheetNames[0]] = newWs;
XLSX.writeFile(wb, filePath);

console.log(`\nDone. Updated ${updatedCount} rows in column D of SLA_Dashboard_Tooltips.xlsx`);
data.slice(1).forEach(row => {
  const preview = (row[3] || '').replace(/\n/g, ' ').substring(0, 60);
  console.log(`  ${(row[1] || '').padEnd(26)} → ${preview}...`);
});
