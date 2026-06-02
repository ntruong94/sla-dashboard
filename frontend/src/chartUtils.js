// ─── Global chart rules for the SLA Dashboard ─────────────────────────────────
//
// Rules applied here (single source of truth for all charts):
//   1. Weekends (Sat=6, Sun=0) excluded from all chart data and x-axis labels.
//   2. Series with no valid data are hidden from charts and legends.
//   3. Null/undefined/NaN values treated as missing — lines break at gaps.
//   4. X-axis label format is consistent across all charts:
//        ≤35 points  →  "Wed 25"
//        >35 points  →  "6 May"

// ── Weekend detection ─────────────────────────────────────────────────────────

export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// ── Business-day filtering ────────────────────────────────────────────────────

// Filter weekends from a history slice { dates: Date[], byTeam: { id: value[] } }
// Returns a new slice with only Mon–Fri entries.
export function filterBizDays({ dates, byTeam }) {
  const indices = dates.map((_, i) => i).filter(i => !isWeekend(dates[i]));
  return {
    dates: indices.map(i => dates[i]),
    byTeam: Object.fromEntries(
      Object.entries(byTeam).map(([k, arr]) => [k, indices.map(i => arr[i] ?? null)])
    ),
  };
}

// ── Empty-data detection ──────────────────────────────────────────────────────

// True if an array has at least one valid numeric value (non-null, non-NaN).
export const hasData = (arr) =>
  Array.isArray(arr) && arr.some(v => v != null && !Number.isNaN(v));

// Filter teams to only those with real data in byTeam.
// Use this to hide series from both chart lines and legend items.
export const activeTeams = (teams, byTeam) =>
  teams.filter(t => hasData(byTeam[t.id]));

// ── X-axis label format ───────────────────────────────────────────────────────

// Consistent axis tick label used on ALL dashboard charts:
//   ≤35 data points  →  "Wed 25"
//   >35 data points  →  "6 May"
export function fmtAxisLabel(date, totalPoints) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return totalPoints <= 35
    ? date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })
    : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ── Tooltip date format ───────────────────────────────────────────────────────

// Full date used in hover tooltips on all charts: "Wed, 25 May 2026"
export function fmtTooltipDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return date.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Null-safe smooth path (Catmull-Rom → cubic bezier) ───────────────────────
//
// Splits the series at null/NaN gaps so the line lifts the pen rather than
// drawing a misleading straight line through missing data.
// xAt(i) and yAt(v) are the coordinate mapping functions from the calling chart.

export function buildSmoothPath(arr, xAt, yAt) {
  if (!arr || arr.length === 0) return '';

  // Collect contiguous segments of valid values
  const segments = [];
  let seg = [];
  arr.forEach((v, i) => {
    if (v != null && !Number.isNaN(v)) {
      seg.push({ i, x: xAt(i), y: yAt(v) });
    } else if (seg.length > 0) {
      segments.push(seg);
      seg = [];
    }
  });
  if (seg.length > 0) segments.push(seg);

  return segments.map(pts => {
    if (pts.length === 1) {
      // Single isolated point — render a tiny stub so it's still visible
      return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    }
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }).join(' ');
}
