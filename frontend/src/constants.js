// Shared constants used across all dashboard components.
// TEAM_COLORS is keyed by team name as returned by the backend /api/teams and /api/tasks endpoints.
// Colours match the CSS variables --t1 … --t6 defined in styles.css.

export const TEAM_COLORS = {
  'Data Entry':                'var(--t1)',
  'Pre-Valuation Department':  'var(--t2)',
  'Ezy Client Care':           'var(--t3)',
  'Packaging & QA Department': 'var(--t4)',
  'Approvals Department':      'var(--t5)',
  'Settlements Department':    'var(--t6)',
};

export const slaClass = (pct) => pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'bad';
export const slaLabel = (pct) => pct >= 90 ? 'On Target' : pct >= 75 ? 'At Risk' : 'Breach';

// ─── Tooltip copy ──────────────────────────────────────────────────────────────
// Centralised here so explanations stay aligned with the actual calculations.
// Formatting rules: use \n line breaks and - bullets for readability.
// Keep wording short and plain-English for business users.
export const TOOLTIPS = {
  kpi: {
    totalTasks:   'Active tasks across all teams right now.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.\n\nUpdates on every auto-refresh.',
    overallSla:   'Percentage of completed tasks that finished within the SLA time limit.\n\nFormula:\nCompleted within target \u00f7 total completed \u00d7 100\n\nRules:\n- TAT = DateCompleted \u2212 DateCreated (actual elapsed calendar time)\n- Date basis: task Completed Date\n- Target is configurable per team in Settings',
    avgTat:       'Average time-in-progress across all teams.\n\nOpen tasks: time elapsed since Created Date (GETDATE() \u2212 DateCreated).\nClosed tasks: DateCompleted \u2212 DateCreated.\n\nIncludes all tasks created today (active + completed).\nDisplayed in hours (1 decimal).\n\nRed when the average exceeds the SLA target.',
    totalOverdue: 'Active tasks that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation (GETDATE() \u2212 DateCreated) exceeds the configured SLA target\n- OR the current time is past the task\u2019s SLA adjusted deadline (SLAAdjustedDate)\n\nOnly active tasks counted.\nTarget is configurable per team in Settings.',
  },
  team: {
    volume:  'Number of active tasks currently in this team\'s queue.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\nExcludes: Completed and Cancelled.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: time since task creation (GETDATE() \u2212 DateCreated).\nClosed tasks: DateCompleted \u2212 DateCreated.\n\nIncludes all tasks created today.\nRed when the average exceeds this team\u2019s SLA target.',
    overdue: 'Active tasks in this team that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation exceeds the team\u2019s configured SLA target\n- OR the current time is past the task\u2019s SLA adjusted deadline (SLAAdjustedDate)\n\nTarget is configurable in Settings \u2192 SLA Targets per Team.',
    sla:     'SLA compliance rate for this team today.\n\nFormula:\nCompleted within target ÷ total completed × 100\n\nColour thresholds:\n- Green — ≥ 90% (On Target)\n- Amber — 75–89% (At Risk)\n- Red — < 75% (Breach)\n\nThe bar below reflects this value.\nRecalculates when you change the target in Settings.',
  },
  chart: {
    trend:  '7-day SLA compliance % per team.\n\nRules:\n- Business days only (weekends excluded)\n- Each point = % of tasks completed within target that day\n- Missing data shown as a gap in the line\n\nInteractions:\n- Click a team name in the legend to show or hide it\n- Hover over the chart to compare values on a specific day',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:     'SLA compliance for this team today.\n\nFormula: completed within target ÷ total completed × 100\n\nGreen ≥ 90% · Amber 75–89% · Red < 75%',
    volume:  'Total active tasks currently in this team\'s queue.\n\nExcludes completed and cancelled tasks.',
    avgTat:  'Average time-in-progress for this team.\n\nOpen tasks: time since creation (GETDATE() \u2212 DateCreated).\nClosed tasks: DateCompleted \u2212 DateCreated.\nRed when the average exceeds the SLA target.',
    overdue: 'Active tasks in this team that have exceeded the SLA target.\n\nA task is overdue if either:\n- Elapsed time since creation exceeds the configured SLA target\n- OR the current time is past the task\'s SLA adjusted deadline (SLAAdjustedDate)',
  },
  alerts: {
    panel: 'Teams or tasks that need immediate attention.\n\nAn alert appears when:\n- A team\'s SLA % (based on real-time elapsed TAT for active tasks) drops below the At Risk threshold\n- One or more active tasks have exceeded the SLA time limit\n\nSeverity levels:\n- Critical \u2014 SLA % has breached the minimum threshold\n- Warning \u2014 SLA % is approaching the threshold (At Risk)\n\nAlerts clear automatically when performance recovers.',
  },
};
