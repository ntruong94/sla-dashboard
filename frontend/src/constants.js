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
// Formatting rules: use \n line breaks and - bullets for readability.
// Keep wording short and plain-English for business users.
export const TOOLTIPS = {
  kpi: {
    totalTasks:   'Active tasks across all teams right now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\nDate basis: reporting date (latest DateCreated in DB).\n\nUpdates on every auto-refresh.',
    overallSla:   'Percentage of completed tasks that are SLA-compliant.\n\nFormula:\n(Completed where TAT <= SLAHours\nOR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nRules:\n- A completed task is counted once even if both conditions are true\n- Applies to COMPLETED tasks only\n\nDate basis: reporting date (DateCompleted on reporting date).\n\nTarget is configurable per team In Settings.',
    avgTat:       'Average time-in-progress across all teams.\n\nOpen tasks: elapsed time since task creation.\nClosed tasks: DateCompleted − DateCreated.\n\nIncludes all tasks on the reporting date (active + completed).\n\nDate basis: reporting date.\n\nTarget is configurable per team In Settings.',
    totalOverdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks that have exceeded the SLA target.\n\nA task is overdue when:\n- Elapsed time since creation exceeds the configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate)\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\nDate basis: reporting date.\n\nTarget is configurable per team In Settings.'
  },
  team: {
    volume:  'Number of active tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: elapsed time since task creation.\nClosed tasks: DateCompleted − DateCreated.\n\nIncludes all tasks on the reporting date.\nRed when the average exceeds this team\'s SLA target.\n\nDate basis: reporting date.\n\nTarget is configurable per team In Settings.',
    overdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks in this team that have exceeded the SLA target.\n\nA task is overdue when:\n- Elapsed time since creation exceeds the team\'s configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate)\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\nDate basis: reporting date.\n\nTarget is configurable per team In Settings.',
    sla:     'SLA compliance rate for this team on the reporting date.\n\nFormula:\n(Completed where TAT <= target OR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nRules:\n- A completed task is counted once even if both conditions are true\n\nColour thresholds:\n- Green — ≥ 90% (On Target)\n- Amber — 75–89% (At Risk)\n- Red — < 75% (Breach)\n\nThe bar below reflects this value.\n\nTarget is configurable per team In Settings.',
  },
  chart: {
    trend:  '7-day SLA compliance % per team.\n\nRules:\n- Business days only (weekends excluded)\n- Each point = % of completed tasks that are SLA-compliant that day\n- SLA-compliant = (TAT <= target OR CompletedDate <= SLAAdjustedDate)\n- Missing data shown as a gap in the line\n\nInteractions:\n- Click a team name in the legend to show or hide it\n- Hover over the chart to compare values on a specific day\n\nTarget is configurable per team In Settings.',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:     'SLA compliance for this team on the reporting date.\n\nFormula: (Completed where TAT <= target OR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nA completed task is counted once even if both conditions are true.\n\nGreen ≥ 90% · Amber 75–89% · Red < 75%\n\nTarget is configurable per team In Settings.',
    volume:  'Total active tasks currently in this team\'s queue.\n\nExcludes completed and cancelled tasks.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: elapsed time since task creation.\nClosed tasks: DateCompleted \u2212 DateCreated.\nRed when the average exceeds the SLA target.\n\nTarget is configurable per team In Settings.',
    overdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks in this team that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation exceeds the configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate)\n\nTarget is configurable per team In Settings.',
  },
  alerts: {
    panel: 'Teams that need immediate attention.\n\nAn alert is raised when a team\'s SLA % falls below a threshold:\n- Critical — SLA % < 75% (breach)\n- Warning — SLA % 75\u201389% (at risk)\n\nCounting rule:\n- Counts include active tasks on the reporting date only\n- Included statuses: In Progress, On Hold, On Queue, Not Queued\n- Excluded statuses: Completed and Cancelled\n\nAlerts clear automatically when SLA % recovers.\n\nTarget is configurable per team In Settings.'
  },  loan: {
    received:  'Total applications received on the latest reporting date.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on the reporting date.\n\nTotal Loan Amount shows the combined value of all received applications.\n\nClick the card to view individual application details.',
    approved:  'Total applications approved by the funder on the latest reporting date.\n\nCounts distinct Application IDs where Date_FunderApproval falls on the reporting date.\n\nTotal Loan Amount shows the combined value of all approved applications.\n\nClick the card to view individual application details.',
    settled:   'Total loans settled on the latest reporting date.\n\nCounts distinct Application IDs where Date_Settled falls on the reporting date.\n\nTotal Loan Amount shows the combined value of all settled loans.\n\nClick the card to view individual application details.',
  },};
