import React from 'react';
import { TEAM_COLORS } from '../constants.js';
import { activeTeams, fmtAxisLabel, fmtTooltipDate, buildSmoothPath, computePctAxis } from '../chartUtils.js';

// New chart that adapts to date range (7d / 30d / 90d / calendar month)
// Renders dates dynamically — smart x-axis tick density based on range length.

export const HistoryChart = ({ teams, slice, dimmed }) => {
  const W = 980, H = 320;
  const pad = { top: 20, right: 28, bottom: 38, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const dates = slice.dates;
  const n = dates.length;
  if (n === 0) return <div style={{padding:40,textAlign:'center',color:'var(--ink-muted)'}}>No data in this range.</div>;

  // Only render teams that have at least one valid data point
  const visibleTeams = activeTeams(teams, slice.byTeam);
  if (visibleTeams.length === 0) return <div style={{padding:40,textAlign:'center',color:'var(--ink-muted)'}}>No data in this range.</div>;

  // Auto-scale Y-axis based on currently undimmed series so the chart adapts
  // when the user toggles teams off in the legend.
  const seriesForAxis = visibleTeams.filter(t => !dimmed.has(t.id));
  const axisTeams = seriesForAxis.length > 0 ? seriesForAxis : visibleTeams;
  const allVals = axisTeams.flatMap(t => slice.byTeam[t.id] || []);
  const { yMin, yMax, ticks: gridY } = computePctAxis(allVals, { fallbackMin: 55 });

  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const xAt = (i) => pad.left + i * xStep;
  const yAt = (v) => pad.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // Unique clipPath id — prevents collision when multiple charts mount.
  const clipId = 'history-clip-' + React.useId().replace(/:/g, '');

  const [hoverIdx, setHoverIdx] = React.useState(null);
  const wrapRef = React.useRef(null);

  const handleMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const scale = rect.width / W;
    const px = (e.clientX - rect.left) / scale;
    const i = Math.round((px - pad.left) / (xStep || 1));
    if (i >= 0 && i < n) setHoverIdx(i);
    else setHoverIdx(null);
  };

  // Tick density — use consistent format from chartUtils
  const tickEvery = n <= 10 ? 1 : n <= 16 ? 2 : n <= 35 ? 5 : n <= 65 ? 10 : 14;
  const tickIdxs = [];
  for (let i = 0; i < n; i += tickEvery) tickIdxs.push(i);
  if (tickIdxs[tickIdxs.length - 1] !== n - 1) tickIdxs.push(n - 1);

  const fmtTooltip = (d) => fmtTooltipDate(d);

  const smoothPath = (arr) => buildSmoothPath(arr, xAt, yAt);

  const showDots = n <= 35;

  return (
    <div className="chart-wrap" ref={wrapRef}
      onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} textRendering="geometricPrecision">
        <defs>
          {/* Clip rect locks all data graphics to the inner plot area so
              lines and dots can never overflow the chart edges. */}
          <clipPath id={clipId}>
            <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {gridY.map(v => (
          <g key={v}>
            <line x1={pad.left} x2={W - pad.right} y1={yAt(v)} y2={yAt(v)}
              stroke="rgba(0,0,0,0.07)" strokeDasharray="3 5" strokeWidth="1"/>
            <text x={pad.left - 10} y={yAt(v) + 4} textAnchor="end"
              fontSize="10" fontFamily="Inter, system-ui, -apple-system, sans-serif"
              fontWeight="400" letterSpacing="0.06em"
              fill="var(--ink-muted)" style={{fontVariantNumeric:'tabular-nums'}}>{v}%</text>
          </g>
        ))}


        {tickIdxs.map(i => (
          <text key={i} x={xAt(i)} y={H - pad.bottom + 20} textAnchor="middle"
            fontSize="10" fontFamily="Inter, system-ui, -apple-system, sans-serif"
            fontWeight="400" letterSpacing="0.06em"
            fill="var(--ink-muted)">{fmtAxisLabel(dates[i], n)}</text>
        ))}

        <g clipPath={`url(#${clipId})`}>
        {visibleTeams.map(t => {
          const arr = slice.byTeam[t.id];
          if (!arr) return null;
          const active = !dimmed.has(t.id);
          const color = TEAM_COLORS[t.name];
          return (
            <g key={t.id} opacity={active ? 1 : 0.12}>
              <path d={smoothPath(arr)} fill="none" stroke={color}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              {showDots && arr.map((v, i) => {
                if (v == null || Number.isNaN(v)) return null;
                if (v < yMin || v > yMax) return null;
                return (
                  <circle key={i} cx={xAt(i)} cy={yAt(v)}
                    r={hoverIdx === i ? 5 : 3}
                    fill="white" stroke={color}
                    strokeWidth={hoverIdx === i ? 2.5 : 2}/>
                );
              })}
              {!showDots && hoverIdx !== null && arr[hoverIdx] != null
                && arr[hoverIdx] >= yMin && arr[hoverIdx] <= yMax && (
                <circle cx={xAt(hoverIdx)} cy={yAt(arr[hoverIdx])}
                  r="5" fill="white" stroke={color} strokeWidth="2.5"/>
              )}
            </g>
          );
        })}
        </g>

        {hoverIdx !== null && (
          <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={pad.top} y2={H - pad.bottom}
            stroke="rgba(0,0,0,0.10)" strokeDasharray="3 5" strokeWidth="1"/>
        )}
      </svg>

      {hoverIdx !== null && (() => {
        const leftPct = (xAt(hoverIdx) / W) * 100;
        return (
          <div className="tooltip show" style={{ left: `${leftPct}%`, top: '12%' }}>
            <div className="tooltip-head">{fmtTooltip(dates[hoverIdx])}</div>
            {visibleTeams.filter(t => !dimmed.has(t.id))
              .sort((a, b) => (slice.byTeam[b.id][hoverIdx] ?? 0) - (slice.byTeam[a.id][hoverIdx] ?? 0))
              .map(t => {
                const v = slice.byTeam[t.id][hoverIdx];
                if (v == null) return null;
                return (
                  <div key={t.id} className="tooltip-row">
                    <span className="name"><span className="swatch" style={{background:TEAM_COLORS[t.name]}}/>{t.name}</span>
                    <span>{v}%</span>
                  </div>
                );
              })}
          </div>
        );
      })()}
    </div>
  );
};

export default HistoryChart;
