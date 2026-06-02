// Historical SLA data — 6 months of daily values per team
// Deterministic pseudo-random: seeded by team id + day index so data is stable across reloads.

function seededRand(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function makeHistory(teamId, baseline, volatility, days) {
  const out = [];
  const seedBase = teamId.charCodeAt(0) * 31 + teamId.charCodeAt(1);
  let v = baseline;
  for (let i = 0; i < days; i++) {
    const r = seededRand(seedBase + i * 7);
    const r2 = seededRand(seedBase * 3 + i);
    // drift toward baseline, random noise
    v = v + (baseline - v) * 0.12 + (r - 0.5) * volatility * 2;
    // occasional dips (incidents)
    if (r2 < 0.04) v -= volatility * 2.5;
    v = Math.max(55, Math.min(100, v));
    out.push(Math.round(v));
  }
  return out;
}

// 180 days back from today (index 179 = today, index 0 = ~6 months ago)
const HISTORY_DAYS = 180;

// Per-team baselines (roughly match current dashboard states)
const TEAM_HISTORY_CONFIG = {
  'data-entry':         { baseline: 93, volatility: 3 },
  'valuations':         { baseline: 86, volatility: 4 },
  'assessments':        { baseline: 72, volatility: 5 },
  'qa':                 { baseline: 95, volatility: 2 },
  'funder-submission':  { baseline: 83, volatility: 4 },
  'settlements':        { baseline: 76, volatility: 4 },
};

const HISTORY = {};
for (const [id, cfg] of Object.entries(TEAM_HISTORY_CONFIG)) {
  HISTORY[id] = makeHistory(id, cfg.baseline, cfg.volatility, HISTORY_DAYS);
}

// Reference "today" — matches the dashboard's displayed Sun 20 Apr 2026
const REFERENCE_TODAY = new Date(2026, 3, 20); // month is 0-indexed → April

// Helper: get a slice by date range.
// range: '7d' | '30d' | '90d' | { year, month } for a calendar month
function getHistorySlice(range) {
  const result = { byTeam: {}, dates: [] };
  let endIdx, startIdx;

  if (range === '7d' || range === '30d' || range === '90d') {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    endIdx = HISTORY_DAYS - 1;
    startIdx = Math.max(0, endIdx - days + 1);
  } else {
    // calendar month: { year, month (0-indexed) }
    const first = new Date(range.year, range.month, 1);
    const last = new Date(range.year, range.month + 1, 0); // last day of month
    // map dates to history indices
    const todayIdx = HISTORY_DAYS - 1;
    const daysFromRefToFirst = Math.floor((first - REFERENCE_TODAY) / 86400000);
    const daysFromRefToLast  = Math.floor((last  - REFERENCE_TODAY) / 86400000);
    startIdx = Math.max(0, todayIdx + daysFromRefToFirst);
    endIdx   = Math.min(HISTORY_DAYS - 1, todayIdx + daysFromRefToLast);
    if (endIdx < 0 || startIdx >= HISTORY_DAYS) return null;
  }

  // Build date labels
  const todayIdx = HISTORY_DAYS - 1;
  for (let i = startIdx; i <= endIdx; i++) {
    const d = new Date(REFERENCE_TODAY);
    d.setDate(d.getDate() - (todayIdx - i));
    result.dates.push(d);
  }
  for (const teamId of Object.keys(HISTORY)) {
    result.byTeam[teamId] = HISTORY[teamId].slice(startIdx, endIdx + 1);
  }
  return result;
}

// Available months for the month picker (last 6 including current)
function getAvailableMonths() {
  const months = [];
  const d = new Date(REFERENCE_TODAY);
  d.setDate(1);
  for (let i = 0; i < 6; i++) {
    months.push({ year: d.getFullYear(), month: d.getMonth() });
    d.setMonth(d.getMonth() - 1);
  }
  return months.reverse(); // oldest first
}

Object.assign(window, { HISTORY, getHistorySlice, getAvailableMonths, REFERENCE_TODAY });
