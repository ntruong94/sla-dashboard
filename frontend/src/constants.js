// Shared constants used across all dashboard components.
// TEAM_COLORS is keyed by team name as returned by the backend /api/teams and /api/tasks endpoints.
// Colours match the CSS variables --t1 … --t9 defined in styles.css.
// For dynamic teams (SpecifiedKPIGrp values not in the 9 known teams), a cycling
// fallback palette is used so new team cards always get a distinct colour.

const _TEAM_COLORS_BASE = {
  'Data Entry':        'var(--t1)',
  'Valuations':        'var(--t2)',
  'Assessments':       'var(--t3)',
  'Packaging & QA':    'var(--t4)',
  'CLA':               'var(--t5)',
  'Funder Submission': 'var(--t6)',
  'Funder MIR':        'var(--t7)',
  'Settlement':        'var(--t8)',
  'Ezy Client Care':   'var(--t9)',
};

// Palette for auto-discovered dynamic KPI groups (names not in _TEAM_COLORS_BASE).
const _DYNAMIC_PALETTE = [
  '#1F7A8C', // teal
  '#B5446E', // rose
  '#556B2F', // olive
  '#8B4513', // saddle brown
  '#4169E1', // royal blue
  '#8B008B', // dark magenta
];
const _dynamicColorCache = {};

// TEAM_COLORS behaves like a plain object for all 9 known teams.
// For any unknown team name (dynamic groups), returns a colour from _DYNAMIC_PALETTE
// assigned deterministically by order of first lookup.
export const TEAM_COLORS = new Proxy(_TEAM_COLORS_BASE, {
  get(target, name) {
    if (typeof name !== 'string') return target[name];
    if (name in target) return target[name];
    if (!(name in _dynamicColorCache)) {
      const idx = Object.keys(_dynamicColorCache).length % _DYNAMIC_PALETTE.length;
      _dynamicColorCache[name] = _DYNAMIC_PALETTE[idx];
    }
    return _dynamicColorCache[name];
  },
});

export const slaClass = (pct) => pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'bad';
export const slaLabel = (pct) => pct >= 90 ? 'On Target' : pct >= 75 ? 'At Risk' : 'Breach';

// ─── Tooltip copy ──────────────────────────────────────────────────────────────
// Centralised here so explanations stay aligned with the actual calculations.
// Section format rules (2026-06-25):
//   Group 1 (Total Active Tasks, Volume): Meaning / Includes / Excluded / Date basis
//   Group 2 (SLA, TAT, Overdue): Meaning / Formula (omit if N/A) / Rules / Includes / Excluded / Date basis
//   Group 4 (Charts): Rules / Includes / Excluded / Date basis / Interactions
// Keep wording short and plain-English for business users.
export const TOOLTIPS = {
  kpi: {
    totalTasks:   'Count of ACTIVE tasks across all teams now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
    overallSla:   'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',
    avgTat:       'Average TAT of ACTIVE tasks \n\nRules:\n- avg TAT = avg TotalHoursOnTask \n\nIncludes: Active\n\nExcluded: Tasks where TotalHoursOnTask is null are excluded from the average\n\nDate basis: Date Created.',
    totalOverdue: 'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  },
  team: {
    volume:  'Number of ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
    avgTat:  'Average TAT of ACTIVE tasks\n\nRules:\n- avg TAT = avg TotalHoursOnTask \n\nIncludes: Active\n\nExcluded: Tasks where TotalHoursOnTask is null are excluded from the average\n\nDate basis: Date Created.',
    overdue: 'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
    sla:     'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',
  },
  chart: {
    trend:   'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Created.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.',
    history: 'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n\nIncludes: Completed tasks.\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Created.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:     'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: \n[Total On-time# + Total Overdue #] ÷ total completed # × 100\n\nRules:\n- Green ≥ 90% (On Target) \n- Amber 75–89% (At Risk) \n- Red < 75% (Breach)\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Created.',
    volume:  'Total ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
    avgTat:  'Average TAT of ACTIVE tasks \n\nRules:\n- avg TAT = avg TotalHoursOnTask\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null are excluded from the average\n\nDate basis: Date Created.',
    avgTatCompleted: 'Average TAT across completed tasks \n\nRules:\n- avg TAT = avg TotalHoursOnTask when not null\n- DateDiff (DateCreated, DateCompleted) in hours when TotalHoursOnTask is null and SLAAdjustedDate is set\n\nIncludes: Completed\n\nExcluded: Tasks where TotalHoursOnTask is null and SLAAdjustedDate is null\n\nDate basis: Date Created.',
    overdue: 'Count of active tasks that have exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when  Current time > SLAAdjustedDate \n- Overdue when TotalHoursOnTask> SLA target hours in Setting tab\n\nIncludes: Active\n\nExcluded: Cancelled; Completed tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
    overdueCompleted: 'Count of completed tasks that exceeded their SLA target.\n\nRules:\n- Overdue when TotalHoursOnTask > SLAInHours\n- Overdue when DateCompleted > SLAAdjustedDate\n\nIncludes: Completed\n\nExcluded: Cancelled; Active tasks; Tasks where TotalHoursOnTask is null or = 0\n\nDate basis: Date Created',
  },
  alerts: {
    panel: '1. For every team, the system counts how many of today\'s active tasks (In Progress, On Hold, On Queue, Not Queued) are compliant — meaning their elapsed time hasn\'t exceeded the task\'s own SLAInHours limit.\n\n2. It divides that by the total active task count to get a live SLA% for each team.\n\n3. Alerts clear automatically the next time the cache refreshes (every 5 min) if the team\'s SLA% has recovered above the threshold. No manual dismissal needed — though users can manually dismiss from the UI to hide it for their session.\n\n',
  },
  loan: {
    received:  'Total applications received on the latest reporting date.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on the reporting date.\n\nClick the card to view individual application details.',
    approved:  'Total applications approved by the funder on the latest reporting date.\n\nCounts distinct Application IDs where Date_FunderApproval falls on the reporting date.\n\nClick the card to view individual application details.',
    settled:   'Total loans settled on the latest reporting date.\n\nCounts distinct Application IDs where Date_Settled falls on the reporting date.\n\nClick the card to view individual application details.',
  },
};
