import React from 'react';
import ReactDOM from 'react-dom';
import { TEAM_COLORS } from '../constants.js';
import { activeTeams, buildSmoothPath, computePctAxis } from '../chartUtils.js';

// 7-day trend chart — SVG multi-line with smooth curves and hollow dots

export const TrendChart = ({ teams, trendData, dimmed, onLegendClick, dayLabels }) => {
  const W = 900, H = 280;
  const pad = { top: 24, right: 32, bottom: 42, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const dotRadius = 4;
  const hoverDotRadius = 6;
  const dotStrokeWidth = 2;
  const hoverDotStrokeWidth = 2.5;
  const plotOverflow = 8;

  // Only render/show teams that have at least one valid data point
  const visibleTeams = activeTeams(teams, trendData);

  // Auto-scale Y-axis based on visible (non-dimmed) series; fall back to all
  // visible series if every team is dimmed so the chart still renders correctly.
  const seriesForAxis = visibleTeams.filter(t => !dimmed.has(t.id));
  const axisTeams = seriesForAxis.length > 0 ? seriesForAxis : visibleTeams;
  const allVals = axisTeams.flatMap(t => trendData[t.id] || []);
  const { yMin, yMax, ticks: gridY } = computePctAxis(allVals);
  const edgePad = 4;
  const displayYMin = yMin <= 0 ? -edgePad : yMin;
  const displayYMax = yMax >= 100 ? 100 + edgePad : yMax;

  const xStep = innerW / Math.max(dayLabels.length - 1, 1);
  const xAt = (i) => pad.left + i * xStep;
  const yAt = (v) => pad.top + innerH - ((v - displayYMin) / (displayYMax - displayYMin)) * innerH;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const xDotAt = (i, radius) => clamp(xAt(i), pad.left + radius, W - pad.right - radius);
  const yDotAt = (v, radius) => clamp(yAt(v), pad.top + radius, H - pad.bottom - radius);

  // Unique clipPath id so the chart never bleeds outside the plot area,
  // even when multiple charts are mounted on the same page.
  const clipId = 'trend-clip-' + React.useId().replace(/:/g, '');

  const [hoverIdx, setHoverIdx] = React.useState(null);
  const wrapRef = React.useRef(null);

  const handleMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const scale = rect.width / W;
    const px = (e.clientX - rect.left) / scale;
    const i = Math.round((px - pad.left) / xStep);
    setHoverIdx(i >= 0 && i < dayLabels.length ? i : null);
  };

  if (visibleTeams.length === 0) return <div style={{padding:40,textAlign:'center',color:'var(--ink-muted)'}}>No trend data available.</div>;

  const smoothPath = (arr) => buildSmoothPath(arr, xAt, yAt);

  // Target band 90–100 — only show where it intersects the visible range
  const bandLo = Math.max(displayYMin, 90);
  const bandHi = Math.min(displayYMax, 100);
  const showTargetBand = bandHi > bandLo;

  const textProps = {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontWeight: '400',
    fontSize: '10',
    letterSpacing: '0.06em',
    fill: 'var(--ink-muted)',
  };

  return (
    <div className="chart-wrap" ref={wrapRef}
      onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} textRendering="geometricPrecision">
        <defs>
          {/* Clip rect locks all data graphics to the inner plot area so
              lines, dots and the target band can never overflow the chart. */}
          <clipPath id={clipId}>
            <rect
              x={pad.left - plotOverflow}
              y={pad.top - plotOverflow}
              width={innerW + plotOverflow * 2}
              height={innerH + plotOverflow * 2}
            />
          </clipPath>
        </defs>

        {/* Soft horizontal gridlines */}
        {gridY.map(v => (
          <g key={v}>
            <line
              x1={pad.left} x2={W - pad.right}
              y1={yAt(v)} y2={yAt(v)}
              stroke="rgba(0,0,0,0.07)"
              strokeWidth="1"
              strokeDasharray={v === yMin ? '0' : '3 5'}
            />
            <text x={pad.left - 12} y={yAt(v) + 4} textAnchor="end"
              {...textProps} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {v}%
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {dayLabels.map((d, i) => (
          <text key={d} x={xAt(i)} y={H - pad.bottom + 22} textAnchor="middle" {...textProps}>
            {d}
          </text>
        ))}

        {/* Subtle green target band 90–100 (clipped to plot area) */}
        {showTargetBand && (
          <rect
            x={pad.left} y={yAt(bandHi)}
            width={innerW} height={yAt(bandLo) - yAt(bandHi)}
            fill="var(--ok)" opacity="0.04"
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Smooth lines clipped to the inner plot area; dots rendered later on top */}
        <g clipPath={`url(#${clipId})`}>
        {visibleTeams.map(t => {
          const arr = trendData[t.id];
          if (!arr) return null;
          const color = TEAM_COLORS[t.name];
          const active = !dimmed.has(t.id);
          return (
            <g key={t.id} opacity={active ? 1 : 0.12}>
              <path
                d={smoothPath(arr)}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
        </g>

        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)} x2={xAt(hoverIdx)}
            y1={pad.top} y2={H - pad.bottom}
            stroke="var(--ink)" strokeOpacity="0.12"
            strokeDasharray="3 4" strokeWidth="1"
          />
        )}

        {visibleTeams.map(t => {
          const arr = trendData[t.id];
          if (!arr) return null;
          const color = TEAM_COLORS[t.name];
          const active = !dimmed.has(t.id);
          return (
            <g key={`top-${t.id}`} opacity={active ? 1 : 0.12}>
              {arr.map((v, i) => {
                if (v == null || Number.isNaN(v)) return null;
                const radius = hoverIdx === i ? hoverDotRadius : dotRadius;
                return (
                  <circle
                    key={i}
                    cx={xDotAt(i, radius)} cy={yAt(v)}
                    r={radius}
                    fill="white"
                    stroke={color}
                    strokeWidth={hoverIdx === i ? hoverDotStrokeWidth : dotStrokeWidth}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && wrapRef.current && ReactDOM.createPortal((() => {
        // Portal renders into document.body with position:fixed so the tooltip
        // escapes any ancestor overflow:hidden / isolation:isolate containers.
        const rect = wrapRef.current.getBoundingClientRect();
        const fixedLeft = rect.left + (xAt(hoverIdx) / W) * rect.width;
        const fixedTop  = rect.top  + 0.20 * rect.height;
        return (
          <div className="tooltip show" style={{ position: 'fixed', left: fixedLeft, top: fixedTop, zIndex: 9998 }}>
            <div className="tooltip-head">{dayLabels[hoverIdx]}</div>
            {teams
              .filter(t => !dimmed.has(t.id))
              .sort((a, b) => (trendData[b.id]?.[hoverIdx] ?? 0) - (trendData[a.id]?.[hoverIdx] ?? 0))
              .map(t => {
                const v = trendData[t.id]?.[hoverIdx];
                if (v == null) return null;
                return (
                  <div key={t.id} className="tooltip-row">
                    <span className="name">
                      <span className="swatch" style={{ background: TEAM_COLORS[t.name] }} />
                      {t.name}
                    </span>
                    <span>{v}%</span>
                  </div>
                );
              })}
          </div>
        );
      })(), document.body)}
    </div>
  );
};

export default TrendChart;
