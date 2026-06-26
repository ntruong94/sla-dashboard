// Shared constants used across all dashboard components.
// TEAM_COLORS is keyed by team name as returned by the backend /api/teams and /api/tasks endpoints.
// Colours match the CSS variables --t1 … --t8 defined in styles.css.

export const TEAM_COLORS = {
  'Data Entry':        'var(--t1)',
  'Valuations':        'var(--t2)',
  'Assessments':       'var(--t3)',
  'Packaging & QA':    'var(--t4)',
  'CLA':               'var(--t5)',
  'Funder Submission': 'var(--t6)',
  'Settlement':        'var(--t7)',
  'Ezy Client Care':   'var(--t8)',
};

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
    overallSla:   'Percentage of COMPLETED tasks that are SLA-compliant on the reporting date.\n\nFormula: completed where \n - TAT \u2264 SLA config target hours\n - OR CompletedDate \u2264 SLAAdjustedDate \u00f7 total completed \u00d7 100\n\nRules:\n- A completed task is counted once even if both conditions are true.\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.',
    avgTat:       'Average time-in-progress across all teams on the reporting date.\n\nRules:\n- Open tasks: elapsed time from Date Created to now.\n- Closed tasks: Date Completed \u2212 Date Created.\n\nIncludes: Active + completed.\n\nExcluded: Cancelled.\n\nDate basis: Date Created and Date Completed.',
    totalOverdue: 'Count of ACTIVE tasks that have exceeded their SLA target deadline.\n\nRules:\n- A task is overdue when elapsed time since creation exceeds the configured SLA target.\n- SLAAdjustedDate is not used for active-task overdue determination.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  },
  team: {
    volume:  'Number of ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
    avgTat:  'Average time-in-progress for this team on the reporting date.\n\nRules:\n- Open tasks: elapsed time from Date Created to now.\n- Closed tasks: Date Completed \u2212 Date Created.\n\nIncludes: All tasks for this team on the reporting date (active + completed).\n\nExcluded: Cancelled tasks.\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
    overdue: 'Count of ACTIVE tasks in this team that have exceeded their SLA target.\n\nRules:\n- A task is overdue when elapsed time since creation exceeds the team\'s configured SLA target.\n- SLAAdjustedDate is not used for active-task overdue determination.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued for this team.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
    sla:     'SLA compliance rate % - For COMPLETED tasks only \n\nFormula: completed where \n - TAT \u2264 SLA config target hours\n - OR CompletedDate \u2264 SLAAdjustedDate \u00f7 total completed \u00d7 100\n\nRules:\n- A completed task is counted once even if both conditions are true.\n- Green \u2265 90% (On Target) \u00b7 Amber 75\u201389% (At Risk) \u00b7 Red < 75% (Breach).\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings.',
  },
  chart: {
    trend:   'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n- SLA-compliant = TAT \u2264 target OR CompletedDate \u2264 SLAAdjustedDate.\n\nIncludes: Completed tasks .\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Completed.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team In Settings.',
    history: 'Rules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks SLA-compliant that day.\n- SLA-compliant = TAT \u2264 target OR CompletedDate \u2264 SLAAdjustedDate.\n\nIncludes: Completed tasks .\n\nExcluded: Active and Cancelled tasks.\n\nDate basis: Date Completed.\n\nInteractions:\n- Click a team name in the legend to dim or restore its line.\n- Hover over the chart to compare values on a specific day.\n- Use the range selector to change the viewing period.\n\nTarget is configurable per team In Settings.',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:     'SLA compliance rate % for this team on the reporting date.\n\nFormula: completed where \n - TAT \u2264 SLA config target hours\n - OR CompletedDate \u2264 SLAAdjustedDate \u00f7 total completed \u00d7 100\n\nRules:\n- A completed task is counted once even if both conditions are true.\n- Green \u2265 90% (On Target) \u00b7 Amber 75\u201389% (At Risk) \u00b7 Red < 75% (Breach).\n\nIncludes: Completed.\n\nExcluded: Active and Cancelled.\n\nDate basis: Date Completed.\n\nTarget is configurable per team In Settings',
    volume:  'Total ACTIVE tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.',
    avgTat:  'Average time-in-progress across all teams on the reporting date.\n\nRules:\n- Open tasks: elapsed time from Date Created to now.\n- Closed tasks: Date Completed \u2212 Date Created.\n\nIncludes: Active + completed.\n\nExcluded: Cancelled.\n\nDate basis: Date Created and Date Completed.',
    overdue: 'Count of ACTIVE tasks in this team that have exceeded their SLA target.\n\nRules:\n- A task is overdue when elapsed time since creation exceeds the team\'s configured SLA target.\n- SLAAdjustedDate is not used for active-task overdue determination.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued for this team.\n\nExcluded: Completed and Cancelled.\n\nDate basis: Date Created.\n\nTarget is configurable per team In Settings.',
  },
  alerts: {
    panel: 'Teams that need immediate attention.\n\nAn alert is raised when a team\'s SLA % falls below a threshold:\n- Critical — SLA % < 75% (breach)\n- Warning — SLA % 75\u201389% (at risk)\n\nCounting rule:\n- Counts include active tasks on the reporting date only\n- Included statuses: In Progress, On Hold, On Queue, Not Queued\n- Excluded statuses: Completed and Cancelled\n\nAlerts clear automatically when SLA % recovers.\n\nTarget is configurable per team In Settings.',
  },
  loan: {
    received:  'Total applications received on the latest reporting date.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on the reporting date.\n\nClick the card to view individual application details.',
    approved:  'Total applications approved by the funder on the latest reporting date.\n\nCounts distinct Application IDs where Date_FunderApproval falls on the reporting date.\n\nClick the card to view individual application details.',
    settled:   'Total loans settled on the latest reporting date.\n\nCounts distinct Application IDs where Date_Settled falls on the reporting date.\n\nClick the card to view individual application details.',
  },
};
