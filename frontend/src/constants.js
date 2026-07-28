// Shared constants used across all dashboard components.
// TEAM_COLORS is keyed by team name as returned by the backend /api/teams and /api/tasks endpoints.
// Colours match the CSS variables --t1 � --t9 defined in styles.css.
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

// --- Tooltip copy --------------------------------------------------------------
// Centralised here so explanations stay aligned with the actual calculations.
// Format rules:
//   Active-task metrics  ? Meaning / Rules (if any) / Includes / Excluded / Date basis
//   SLA metrics          ? Meaning / Formula / Rules (colour bands) / Includes / Excluded / Date basis
//   Charts               ? Meaning / Rules / Includes / Excluded / Date basis / Interactions
// Sections separated by \n\n; bullet lists use \n-. white-space: pre-line renders them.
// Affected by Settings target ? end with "Target is configurable per team in Settings."
export const TOOLTIPS = {
  kpi: {
    totalTasks:
      'All currently active tasks across every team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed ',

    overallSla:
      'SLA compliance rate for completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nIncludes: Completed \n\nExcluded: Active \n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.',

    avgTat:
      'Average time on task across all currently active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n\nIncludes: Active .\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.\n\nTarget is configurable per team in Settings.',

    totalOverdue:
      'Count of active tasks that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > SLAInHours.\n- TotalHoursOnTask > team\'s SLA target in Settings.\n- Current time > task\'s SLAAdjustedDate.\n\nIncludes: Active \n\nExcluded: Completed; tasks where TotalHoursOnTask is null or 0.\n\nTarget is configurable per team in Settings.',
  },
  team: {
    volume:
      'Active tasks currently assigned to this team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed',

    avgTat:
      'Average time on task for this team\'s active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n\nIncludes: Active.\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.\n\nTarget is configurable per team in Settings.',

    overdue:
      'Active tasks in this team that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > SLAInHours.\n- TotalHoursOnTask > team\'s SLA target in Settings.\n- Current time > task\'s SLAAdjustedDate.\n\nIncludes: Active .\n\nExcluded: Completed; tasks where TotalHoursOnTask is null or 0.\n\nTarget is configurable per team in Settings.',

    sla:
      'SLA compliance rate for this team\'s completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nRules:\n- Green ≥ 90% (On Target)\n- Amber 75–89% (At Risk)\n- Red < 75% (Breach)\n\nIncludes: Completed\n\nExcluded: Active \n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.',
  },
  chart: {
    trend:
      'Daily SLA compliance per team over the past 7 business days.\n\nRules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks that were SLA-compliant on that day.\n\nIncludes: Completed.\n\nExcluded: Active.\n\nDate basis: SLAAdjustedDate.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team in Settings.',

    history:
      'Historical SLA compliance per team over the selected date range.\n\nRules:\n- Business days only (weekends excluded).\n- Each point = % of completed tasks that were SLA-compliant on that day.\n\nIncludes: Completed.\n\nExcluded: Active \n\nDate basis: SLAAdjustedDate.\n\nInteractions:\n- Click a team name in the legend to show or hide its line.\n- Hover over the chart to compare values on a specific day.\n\nTarget is configurable per team in Settings.',
  },
  teams: {
    status: '● On Target — SLA ≥ 90%\n● At Risk — SLA 75–89%\n● Breach — SLA < 75%',
  },
  modal: {
    sla:
      'SLA compliance rate for this team\'s completed tasks today.\n\nFormula: On-time completions ÷ total completions today × 100\n\nRules:\n- Green ≥ 90% (On Target)\n- Amber 75–89% (At Risk)\n- Red < 75% (Breach)\n\nIncludes: Completed\n\nExcluded: Active\n\nDate basis: SLAAdjustedDate.\n\nTarget is configurable per team in Settings.',

    volume:
      'Active tasks currently assigned to this team.\n\nIncludes: In Progress, On Hold, On Queue, Not Queued.\n\nExcluded: Completed',

    avgTat:
      'Average time on task for this team\'s active tasks.\n\nRules:\n- Avg TAT = average TotalHoursOnTask.\n\nIncludes: Active.\n\nExcluded: Tasks where TotalHoursOnTask is null or 0.',

    avgTatCompleted:
      'Average time on task for completed tasks.\n\nRules:\n- Uses TotalHoursOnTask when available (business hours).\n- Falls back to DateCompleted - DateCreated (in hours) when TotalHoursOnTask is null.\n\nIncludes: Completed tasks.\n\nExcluded: Tasks where both TotalHoursOnTask and SLAAdjustedDate are null.\n\nDate basis: SLAAdjustedDate.',

    overdue:
      'Active tasks in this team that have exceeded their SLA deadline.\n\nA task is overdue when any of these apply:\n- TotalHoursOnTask > SLAInHours.\n- TotalHoursOnTask > team\'s SLA target in Settings.\n- Current time > task\'s SLAAdjustedDate.\n\nIncludes:  Active.\n\nExcluded:  Completed; tasks where TotalHoursOnTask is null or 0.\n\nTarget is configurable per team in Settings.',

    overdueCompleted:
      'Completed tasks in this team that exceeded their SLA deadline.\n\nA task is overdue when either of these apply:\n- TotalHoursOnTask >  SLAInHours.\n- DateCompleted > SLAAdjustedDate.\n\nIncludes: Completed \n\nExcluded:  Active tasks; tasks where TotalHoursOnTask is null or 0.\n\nDate basis: SLAAdjustedDate.',
  },
  alerts: {
    panel:
      'How SLA alerts are generated:\n\n1. For each team, the system calculates what % of active tasks are within their SLA limit.\n\n2. If SLA% drops below 90%, a warning is raised. Below 75% triggers a critical alert.\n\n3. Alerts resolve automatically when the team\'s SLA% recovers (checked every 5 minutes). Users can also dismiss alerts manually for their session.\n\nTarget is configurable per team in Settings.',
  },
  loan: {
    received:
      'Total loan applications received on the latest reporting date.\n\nCounts applications where Date_ApplicationReceived matches the reporting date.\n\nClick to view individual application details.',

    approved:
      'Total applications approved by the funder on the latest reporting date.\n\nCounts applications where Date_FunderApproval matches the reporting date.\n\nClick to view individual application details.',

    settled:
      'Total loans settled on the latest reporting date.\n\nCounts applications where Date_Settled matches the reporting date.\n\nClick to view individual application details.',
  },
};


