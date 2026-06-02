import React from 'react';
import { TEAM_COLORS } from '../constants.js';
import { activeTeams, buildSmoothPath } from '../chartUtils.js';

// 7-day trend chart — SVG multi-line with smooth curves and hollow dots

export const TrendChart = ({ teams, trendData, dimmed, onLegendClick, dayLabels }) => {
  const W = 900, H = 280;
  const pad = { top: 24, right: 32, bottom: 42, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const yMin = 60, yMax = 100;
  const xStep = innerW / Math.max(dayLabels.length - 1, 1);

  const xAt = (i) => pad.left + i * xStep;
  const yAt = (v) => pad.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const gridY = [60, 70, 80, 90, 100];

  const [hoverIdx, setHoverIdx] = React.useState(null);
  const wrapRef = React.useRef(null);

  const handleMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const scale = rect.width / W;
    const px = (e.clientX - rect.left) / scale;
    const i = Math.round((px - pad.left) / xStep);
    setHoverIdx(i >= 0 && i < dayLabels.length ? i : null);
  };

  // Only render/show teams that have at least one valid data point
  const visibleTeams = activeTeams(teams, trendData);
  if (visibleTeams.length === 0) return <div style={{padding:40,textAlign:'center',color:'var(--ink-muted)'}}>No trend data available.</div>;

  const smoothPath = (arr) => buildSmoothPath(arr, xAt, yAt);

  const textProps = {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontWeight: '500',
    fontSize: '10',
    letterSpacing: '0.06em',
    fill: 'var(--ink-muted)',
  };

  return (
    <div className="chart-wrap" ref={wrapRef}
      onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} textRendering="geometricPrecision">

        {/* Soft horizontal gridlines */}
        {gridY.map(v => (
          <g key={v}>
            <line
              x1={pad.left} x2={W - pad.right}
              y1={yAt(v)} y2={yAt(v)}
              stroke="rgba(0,0,0,0.07)"
              strokeWidth="1"
              strokeDasharray={v === 60 ? '0' : '3 5'}
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

        {/* Subtle green target band 90–100 */}
        <rect
          x={pad.left} y={yAt(100)}
          width={innerW} height={yAt(90) - yAt(100)}
          fill="var(--ok)" opacity="0.04"
        />

        {/* Smooth lines + hollow dots */}
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {arr.map((v, i) => {
                if (v == null || Number.isNaN(v)) return null;
                return (
                  <circle
                    key={i}
                    cx={xAt(i)} cy={yAt(v)}
                    r={hoverIdx === i ? 5 : 3}
                    fill="white"
                    stroke={color}
                    strokeWidth={hoverIdx === i ? 2.5 : 2}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)} x2={xAt(hoverIdx)}
            y1={pad.top} y2={H - pad.bottom}
            stroke="var(--ink)" strokeOpacity="0.12"
            strokeDasharray="3 4" strokeWidth="1"
          />
        )}
      </svg>

      {hoverIdx !== null && (() => {
        const leftPct = (xAt(hoverIdx) / W) * 100;
        return (
          <div className="tooltip show" style={{ left: `${leftPct}%`, top: '20%' }}>
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
      })()}
    </div>
  );
};

export default TrendChart;
