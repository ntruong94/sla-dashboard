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
    totalTasks:   'Active tasks across all teams right now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\n Date basis:Created_Date.\n\nUpdates on every auto-refresh.',
    overallSla:   'Percentage of completed tasks that are SLA-compliant.\n\nFormula:\nCompleted where TotalOnTask <= SLAHours \nOR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nRules:\n- A completed task is counted once even if both conditions are true\n- Applies to COMPLETED tasks only\n\n Date basis: Completed_Date\n\nTarget is configurable per team In Settings.',
    avgTat:       'Average time-in-progress across all teams.\n\nOpen tasks: time elapsed since Created Date (GETDATE() − DateCreated).\nClosed tasks: DateCompleted − DateCreated.\n\nIncludes all tasks created today (active + completed).\n\nDate basis: Created_Date & Completed_Date.\n\nTarget is configurable per team In Settings.',
    totalOverdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation (GETDATE() − DateCreated) exceeds the configured SLA target\n- OR the current time is past the task’s SLA adjusted deadline (SLAAdjustedDate).\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\n Date basis: Created_Date\n\nTarget is configurable per team In Settings.',
  },
  team: {
    volume:  'Number of active tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: time since task creation (GETDATE() − DateCreated).\nClosed tasks: DateCompleted − DateCreated.\n\nIncludes all tasks created today.\nRed when the average exceeds this team\'s SLA target.\n\nDate basis: Created_Date & Completed_Date.\n\nTarget is configurable per team In Settings.',
    overdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks in this team that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation exceeds the team\'s configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate).\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\nDate basis: Created_Date\n\nTarget is configurable per team In Settings.',
    sla:     'SLA compliance rate for this team today.\n\nFormula:\n(Completed where TAT <= target OR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nRules:\n- A completed task is counted once even if both conditions are true\n\nColour thresholds:\n- Green — ≥ 90% (On Target)\n- Amber — 75–89% (At Risk)\n- Red — < 75% (Breach)\n\nThe bar below reflects this value.\n\nTarget is configurable per team In Settings.',
  },
  chart: {
    trend:  '7-day SLA compliance % per team.\n\nRules:\n- Business days only (weekends excluded)\n- Each point = % of completed tasks that are SLA-compliant that day\n- SLA-compliant = (TAT <= target OR CompletedDate <= SLAAdjustedDate)\n- Missing data shown as a gap in the line\n\nInteractions:\n- Click a team name in the legend to show or hide it\n- Hover over the chart to compare values on a specific day\n\nTarget is configurable per team In Settings.',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:     'SLA compliance for this team today.\n\nFormula: (Completed where TAT <= target OR CompletedDate <= SLAAdjustedDate) ÷ total completed × 100\n\nA completed task is counted once even if both conditions are true.\n\nGreen ≥ 90% · Amber 75–89% · Red < 75%\n\nTarget is configurable per team In Settings.',
    volume:  'Total active tasks currently in this team\'s queue.\n\nExcludes completed and cancelled tasks.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: time since creation (GETDATE() − DateCreated).\nClosed tasks: DateCompleted − DateCreated.\nRed when the average exceeds the SLA target.\n\nTarget is configurable per team In Settings.',
    overdue: 'Overdue / Breached Items — count of tasks past their SLA deadline.\n\nActive tasks in this team that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation exceeds the configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate)\n\nTarget is configurable per team In Settings.',
  },
  alerts: {
    panel: 'Teams that need immediate attention.\n\nAn alert appears when:\n- A team\'s SLA % drops below the threshold\n- One or more tasks are overdue\n\nCounting rule:\n- Counts include active tasks created today only\n- Included statuses: In Progress, On Hold, On Queue, Not Queued\n- Excluded statuses: Completed and Cancelled\n\nSeverity levels:\n- Critical — SLA % has breached the threshold\n- Warning — SLA % is close to the threshold (At Risk)\n\nAlerts clear automatically when performance recovers.\n\nTarget is configurable per team In Settings.',
  },  loan: {
    received:  'Total applications received today.\n\nCounts distinct Application IDs where Date_ApplicationReceived falls on today\'s date.\n\nTotal Loan Amount shows the combined value of all received applications.\n\nClick the card to view individual application details.',
    approved:  'Total applications approved by the funder today.\n\nCounts distinct Application IDs where Date_FunderApproval falls on today\'s date.\n\nTotal Loan Amount shows the combined value of all approved applications.\n\nClick the card to view individual application details.',
    settled:   'Total loans settled today.\n\nCounts distinct Application IDs where Date_Settled falls on today\'s date.\n\nTotal Loan Amount shows the combined value of all settled loans.\n\nClick the card to view individual application details.',
  },};
