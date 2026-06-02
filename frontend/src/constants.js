// Shared constants used across all dashboard components.
// TEAM_COLORS is keyed by QueueName (the real ConfigQueue.QueueName value).
// Colours match the CSS variables --t1 … --t6 defined in styles.css.

export const TEAM_COLORS = {
  'Data Entry':        'var(--t1)',
  'Valuations':        'var(--t2)',
  'Assessments':       'var(--t3)',
  'QA':                'var(--t4)',
  'Funder Submission': 'var(--t5)',
  'Settlements':       'var(--t6)',
};

export const slaClass = (pct) => pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'bad';
export const slaLabel = (pct) => pct >= 90 ? 'On Target' : pct >= 75 ? 'At Risk' : 'Breach';
