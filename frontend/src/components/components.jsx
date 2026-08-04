import React from 'react';
import ReactDOM from 'react-dom';
import { Icon } from './icons.jsx';
import { slaClass, TOOLTIPS } from '../constants.js';
import { getAlertTasks } from '../api.js';
import { fmtHMS, useSortState, sortRows, parseDMY, SortTh } from './utils.js';

// Team card + KPI strip + Alerts panel + Task modal

// ─── Info Tooltip ─────────────────────────────────────────────────────────────
// Renders the bubble into document.body via a portal so parent overflow:hidden
// or stacking contexts cannot clip it. Positioned with position:fixed.
// Interaction: click-to-toggle. Outside-click and ESC close. One open at a time.
export const InfoTip = ({ text, width }) => {
  const iconRef = React.useRef(null);
  const [pos, setPos] = React.useState(null); // {top, left, below} in px when visible
  // Stable unique id per instance — used to close other open InfoTips on open
  const stableId = React.useId().replace(/:/g, '');

  const toggle = (e) => {
    e.stopPropagation();
    setPos(prev => {
      if (prev) return null; // already open → close
      // closed → open: compute viewport-safe position and signal others to close
      const r        = iconRef.current.getBoundingClientRect();
      const bubbleW  = width || 240;
      const MARGIN   = 8;
      const GAP      = 7;
      const vw       = window.innerWidth;
      const vh       = window.innerHeight;
      // Horizontal: centre bubble on icon, then clamp inside viewport
      const rawLeft   = r.left + r.width / 2 - bubbleW / 2;
      const left      = Math.max(MARGIN, Math.min(rawLeft, vw - MARGIN - bubbleW));
      // Arrow caret tracks the icon centre, clamped within bubble bounds
      const arrowLeft = Math.max(8, Math.min((r.left + r.width / 2) - left, bubbleW - 8));
      // Vertical: prefer above; fall back to below when space above < 80px or below has more room
      const below     = r.top < 80 || (vh - r.bottom) > r.top;
      document.dispatchEvent(new CustomEvent('infotip-opened', { detail: { id: stableId } }));
      return {
        ...(below ? { top: r.bottom + GAP } : { bottom: vh - r.top + GAP }),
        left,
        arrowLeft,
        below,
      };
    });
  };

  // One-at-a-time: close when another InfoTip opens
  React.useEffect(() => {
    const handler = (e) => { if (e.detail.id !== stableId) setPos(null); };
    document.addEventListener('infotip-opened', handler);
    return () => document.removeEventListener('infotip-opened', handler);
  // stableId comes from useId() and is stable — adding it here satisfies exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click/tap (pointerdown covers mouse + touch)
  React.useEffect(() => {
    if (!pos) return;
    const handler = (e) => {
      if (iconRef.current?.contains(e.target)) return;
      setPos(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [pos]);

  // Close on ESC
  React.useEffect(() => {
    if (!pos) return;
    const handler = (e) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pos]);

  return (
    <span
      ref={iconRef}
      className="info-tip"
      tabIndex={0}
      role="button"
      aria-label={text}
      aria-expanded={pos != null}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
        else if (e.key === 'Escape') setPos(null);
      }}
    >
      <span className="info-tip-icon">i</span>
      {pos && ReactDOM.createPortal(
        <span
          className={`info-tip-bubble info-tip-bubble--fixed${pos.below ? ' info-tip-bubble--below' : ''}`}
          style={{
            ...(pos.below ? { top: pos.top } : { bottom: pos.bottom }),
            left: pos.left,
            '--arrow-left': `${pos.arrowLeft}px`,
            ...(width ? { width } : {}),
          }}
        >
          <span className="info-tip-bubble__content">{text}</span>
        </span>,
        document.body
      )}
    </span>
  );
};

// --- KPI tile ---
const KpiTile = ({ label, value, unit, delta, deltaDir, accent, icon, tooltip, tooltipWidth, deltaInvert }) => {
  // deltaInvert=true: metric where up=bad/down=good (Avg TAT).
  // accent='bad':     same inversion + pink tile background (Overdue).
  const invert = deltaInvert || accent === 'bad';
  const deltaClass = deltaDir === 'up'   ? (invert ? 'up-bad' : 'up') :
                     deltaDir === 'down' ? (invert ? 'up'     : 'down') : 'neutral';
  return (
    <div className={`kpi ${accent ? 'accent-' + accent : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}{tooltip && <InfoTip text={tooltip} width={tooltipWidth}/>}</span>
        <span className="kpi-icon"><Icon name={icon} size={20}/></span>
      </div>
      <div className="kpi-value">
        {value}{unit && <span className="unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`kpi-delta ${deltaClass}`}>
          <Icon name={deltaDir === 'up' ? 'arrow-up' : 'arrow-down'} size={12}/>
          {delta}<span className="since">vs yesterday</span>
        </div>
      )}
    </div>
  );
};

// --- Team Card ---
const TeamCard = ({ team, onClick, onSlaClick }) => {
  const cls = slaClass(team.sla);
  const hasOverdue = team.overdue > 0;
  const d = team.deltas || { volume: 0, sla: 0, avgTat: 0, overdue: 0 };

  const codes = (team.taskCodes || []).map(String);
  const groupLabel = team.fallbackDeptId ? 'Department Group' : 'KPI Group';
  const groupTooltip = team.fallbackDeptId
    ? `All tasks from ${team.name} - Dept ${team.fallbackDeptId}`
    : codes.length > 0
      ? `${team.name} includes TaskcodeID:\n'${codes.length > 30 ? codes.slice(0, 30).join("', '") + `'\n... and ${codes.length - 30} more` : codes.join("', '")}'`
      : `${team.name} - KPI Group`;

  const fmtD = (val, unit = '') => {
    if (val === 0 || val === null || val === undefined) return null;
    const sign = val > 0 ? '+' : '';
    return `${sign}${val}${unit}`;
  };

  return (
    <div className="card" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div className="card-head">
        <div>
          <div className="card-dept">{groupLabel}</div>
          <h3 className="card-team">{team.name}<InfoTip text={groupTooltip} width={280}/></h3>
        </div>
        <span
          className={`badge ${cls}${onSlaClick ? ' badge--sla-trigger' : ''}`}
          onClick={onSlaClick ? (e) => { e.stopPropagation(); onSlaClick(); } : undefined}
          role={onSlaClick ? 'button' : undefined}
          style={onSlaClick ? { cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.22)' } : undefined}
        >
          <span className="badge-dot" />
          {team.sla}%
          <InfoTip text={TOOLTIPS.team.sla}/>
        </span>
      </div>

      <div className="card-stats">
        <div className="stat">
          <div className="stat-label">Volume<InfoTip text={TOOLTIPS.team.volume} width={230}/></div>
          <div className="stat-value">{team.volume}</div>
          {fmtD(d.volume) && (
            <div className="stat-delta neutral">{fmtD(d.volume)}</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Avg TAT<InfoTip text={TOOLTIPS.team.avgTat} width={250}/></div>
          <div className="stat-value">
            {fmtHMS(team.avgTat)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Overdue<InfoTip text={TOOLTIPS.team.overdue} width={260}/></div>
          <div className={`stat-value ${hasOverdue ? 'danger' : ''}`}>{team.overdue}</div>
          {fmtD(d.overdue) && (
            <div className={`stat-delta ${d.overdue > 0 ? 'up' : 'down'}`}>{fmtD(d.overdue)}</div>
          )}
        </div>
      </div>

      <div className="progress" aria-label={`SLA ${team.sla}%`}>
        <div className={`progress-fill ${cls}`} style={{ width: `${team.sla}%` }} />
      </div>

      <div className="card-foot">
        <span className={`overdue-line ${hasOverdue ? 'has' : 'none'}`}>
          {hasOverdue ? (
            <><span>⚠</span> {team.overdue} overdue</>
          ) : (
            <><span>✓</span> No overdue items</>
          )}
        </span>
        <span className="target-line">Target: <strong>{team.target}h</strong></span>
      </div>
    </div>
  );
};

// Formats an ISO timestamp as a human-readable relative time: "just now", "5m ago", "3h ago", "2d ago"
function relativeTime(iso) {
  if (!iso) return 'just now';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'just now';
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days  = Math.floor(diffMs / 86400000);
  if (mins  <  1) return 'just now';
  if (hours <  1) return `${mins}m ago`;
  if (days  <  1) return `${hours}h ago`;
  return `${days}d ago`;
}

function splitAlertDesc(desc) {
  const m = String(desc || '').match(/^\s*(\d+)\s+active tasks today,\s*(\d+)\s+files?\s+complete,\s*(\d+)\s+files?\s+overdue,\s*SLA at\s*(\d+)%\.?\s*$/i);
  if (!m) return { main: desc || '', meta: '' };
  const [, total, complete, overdue, pct] = m;
  return {
    main: `${total} active tasks today, SLA at ${pct}%`,
    meta: `(${complete} file${complete === '1' ? '' : 's'} in progress, ${overdue} file${overdue === '1' ? '' : 's'} overdue)`,
  };
}

// Shared helpers for alert task rendering
const normalizePriorityVal = (p) => {
  const v = String(p || '').trim().toLowerCase();
  if (v === 'high' || v === 'highest' || v === 'urgent' || v === 'h') return 'high';
  if (v === 'med' || v === 'medium' || v === 'm') return 'med';
  return 'low';
};

const alertStatusInfoVal = (taskType) => {
  if (taskType === 'overdue') return { cls: 'bad', label: 'Overdue' };
  return { cls: 'warn', label: 'At Risk' };
};

// Sortable drill-through table for alert tasks (handles its own sort state)
// eslint-disable-next-line no-unused-vars
const AlertDrillTable = ({ rows }) => {
  const [sort, cycleSort] = useSortState();
  const sorted = sortRows(rows, sort.col, sort.dir, (t, col) => {
    if (col === 'id')        return t.TaskID ?? 0;
    if (col === 'appId')     return t.ApplicationID ?? null;
    if (col === 'createDte') return parseDMY(t.CreateDte);
    if (col === 'slaAdj')    return parseDMY(t.SLAAdjustedDte);
    if (col === 'desc')      return (t.StaffFullName?.trim()) || t.ShortDescription || '';
    if (col === 'slaHours')  return t.SLAInHours != null ? Number(t.SLAInHours) : null;
    if (col === 'onHold')    return t.TotalHoursOnHold ?? null;
    if (col === 'onTask')    return t.TotalHoursOnTask_BH ?? null;
    if (col === 'milestone') return t.MilestoneGroupName || '';
    if (col === 'current')   return t.TaskStatus || '';
    if (col === 'status')    return t.taskType === 'overdue' ? 0 : 1;
    if (col === 'tat')       return t.TotalHoursOnTask_BH ?? t.TatHours ?? 0;
    if (col === 'priority')  return ({high:0,med:1,low:2}[String(t.Priority||'').toLowerCase()] ?? 3);
    return '';
  });
  return (
    <table className="task-table">
      <thead>
        <tr>
          <SortTh sortKey="id"        sort={sort} onSort={cycleSort} style={{width: '90px'}}>Task ID</SortTh>
          <SortTh sortKey="appId"     sort={sort} onSort={cycleSort} style={{width: '100px'}}>App ID</SortTh>
          <SortTh sortKey="createDte" sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Create Dte</SortTh>
          <SortTh sortKey="slaAdj"    sort={sort} onSort={cycleSort} style={{width: '110px', whiteSpace:'normal'}}>SLAAdjusted Dte</SortTh>
          <SortTh sortKey="desc"      sort={sort} onSort={cycleSort} style={{width:'25%'}}>Description</SortTh>
          <SortTh sortKey="slaHours"  sort={sort} onSort={cycleSort} style={{width: '65px', whiteSpace:'normal'}}>SLA (hours)</SortTh>
          <SortTh sortKey="onHold"    sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On hold (hours)</SortTh>
          <SortTh sortKey="onTask"    sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On task (hours)</SortTh>
          <SortTh sortKey="milestone" sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Milestone</SortTh>
          <SortTh sortKey="current"   sort={sort} onSort={cycleSort} style={{width: '100px'}}>Current</SortTh>
          <SortTh sortKey="status"    sort={sort} onSort={cycleSort} style={{width: '90px'}}>Status</SortTh>
          <SortTh sortKey="tat"       sort={sort} onSort={cycleSort} style={{width: '160px'}}>TAT vs Target</SortTh>
          <SortTh sortKey="priority"  sort={sort} onSort={cycleSort} style={{width: '70px'}}>Priority</SortTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map(t => {
          const status = alertStatusInfoVal(t.taskType);
          const target = t.TargetHours != null ? Number(t.TargetHours) : (t.SLAInHours != null ? Number(t.SLAInHours) : 0);
          const tat = t.TotalHoursOnTask_BH != null ? Number(t.TotalHoursOnTask_BH) : (t.TatHours != null ? Number(t.TatHours) : null);
          const pct = (tat != null && target > 0) ? Math.min(tat / target, 1.6) : 0;
          const desc = (t.StaffFullName && t.StaffFullName.trim())
            ? t.StaffFullName.trim()
            : (t.ShortDescription || `Task #${t.TaskID}`);
          const prio = normalizePriorityVal(t.Priority);
          const prioLabel = prio === 'high' ? 'High' : prio === 'med' ? 'Med' : 'Low';
          const rowCls = status.cls === 'bad' ? 'overdue-row' : 'risk-row';
          return (
            <tr key={t.TaskID + '-' + t.taskType} className={rowCls}>
              <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TaskID}</span></td>
              <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.ApplicationID != null ? t.ApplicationID : '-'}</span></td>
              <td style={{whiteSpace:'nowrap'}}>
                <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(t.CreateDte||'').split(' ')[0]||'-'}</div>
                {t.CreateDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{t.CreateDte.split(' ')[1]}</div>}
              </td>
              <td style={{whiteSpace:'nowrap'}}>
                <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(t.SLAAdjustedDte||'').split(' ')[0]||'-'}</div>
                {t.SLAAdjustedDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{t.SLAAdjustedDte.split(' ')[1]}</div>}
              </td>
              <td>
                <div className="task-desc-main">{desc}</div>
                <div className="task-client">{t.ShortDescription || '-'}</div>
              </td>
              <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.SLAInHours != null ? Number(t.SLAInHours) : '-'}</span></td>
              <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TotalHoursOnHold != null ? parseFloat(t.TotalHoursOnHold).toFixed(1) : '-'}</span></td>
              <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TotalHoursOnTask_BH != null ? parseFloat(t.TotalHoursOnTask_BH).toFixed(1) : '-'}</span></td>
              <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.MilestoneGroupName === 'Approved Loans' ? 'Approved' : (t.MilestoneGroupName || '-')}</span></td>
              <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.TaskStatus || '-'}</span></td>
              <td style={{whiteSpace:'nowrap'}}>
                <span className={`pill ${status.cls}`}>
                  <span className="pill-dot"/>{status.label}
                </span>
              </td>
              <td>
                <div className="tat-cell">
                  {tat != null ? (
                    <>
                      <div className="t">
                        <span className="mono">{tat.toFixed(1)}h</span>
                        <span className="vs">/ {target.toFixed(1)}h target</span>
                      </div>
                      <div className="tat-bar">
                        <div className={`progress-fill ${status.cls}`} style={{ width: `${Math.min(pct * 100, 100)}%` }}/>
                      </div>
                    </>
                  ) : (
                    <div className="t"><span className="vs" style={{marginLeft:'auto'}}>/ {target.toFixed(1)}h target</span></div>
                  )}
                </div>
              </td>
              <td style={{whiteSpace:'nowrap'}}>
                <span className={`priority ${prio === 'high' ? 'high' : prio === 'med' ? 'med' : 'low'}`}>
                  <span className="dot"/>{prioLabel}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// --- Alerts panel ---
const AlertsPanel = ({ alerts, onDismiss, atRiskPct = 87.5, maxTasks = 10, customTargets = {}, enableDrillDown = true, drillMode = 'list' }) => {
  const [expandedId, setExpandedId] = React.useState(null);
  const [taskMap, setTaskMap]       = React.useState({});
  const [loadingId, setLoadingId]   = React.useState(null);
  const [errorId, setErrorId]       = React.useState(null);
  // Tick every 60s so relative timestamps stay current without a data refetch
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const handleAlertClick = (a) => {
    if (!enableDrillDown) return;
    if (expandedId === a.id) { setExpandedId(null); return; }
    setExpandedId(a.id);
    if (taskMap[a.id]) return; // already fetched
    setLoadingId(a.id);
    setErrorId(null);
    getAlertTasks(a.queueId, atRiskPct, customTargets[a.queueId] || null)
      .then(data => { setTaskMap(prev => ({ ...prev, [a.id]: data })); setLoadingId(null); })
      .catch(() => { setErrorId(a.id); setLoadingId(null); });
  };

  const normalizePriority = (p) => {
    const v = String(p || '').trim().toLowerCase();
    if (v === 'high' || v === 'highest' || v === 'urgent' || v === 'h') return 'high';
    if (v === 'med' || v === 'medium' || v === 'm') return 'med';
    return 'low';
  };

  const alertStatusInfo = (taskType) => {
    if (taskType === 'overdue') return { cls: 'bad', label: 'Overdue' };
    return { cls: 'warn', label: 'At Risk' };
  };

  return (
    <div className="alerts-panel">
      <div className="alerts-head">
        <span className="title">
          <Icon name="alerts" size={15}/> Active Alerts<InfoTip text={TOOLTIPS.alerts.panel} width={280}/>
        </span>
        <span className="count-badge">{alerts.length}</span>
      </div>
      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="alerts-empty">✓ All clear — no active alerts</div>
        ) : alerts.map(a => {
          const isExpanded = enableDrillDown && expandedId === a.id;
          const isLoading  = loadingId === a.id;
          const hasError   = errorId === a.id;
          const tasks      = (taskMap[a.id] || []).slice(0, maxTasks);
          const descLines  = splitAlertDesc(a.desc);
          return (
            <div key={a.id} className={`alert ${a.severity}${isExpanded ? ' expanded' : ''}`}>
              <div className="alert-main"
                onClick={() => enableDrillDown && handleAlertClick(a)}
                role={enableDrillDown ? 'button' : undefined}
                tabIndex={enableDrillDown ? 0 : undefined}
                onKeyDown={e => {
                  if (!enableDrillDown) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAlertClick(a); }
                }}>
                <div className="alert-icon">
                  <Icon name={a.severity === 'critical' ? 'alert-critical' : 'alert-warning'} size={14}/>
                </div>
                <div className="alert-body">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-desc">
                    <div className="alert-desc-main">{descLines.main}</div>
                    {descLines.meta && <div className="alert-desc-meta">{descLines.meta}</div>}
                  </div>
                </div>
                <div className="alert-right">
                  <div className="alert-time">{relativeTime(a.triggeredAt)}</div>
                  {enableDrillDown && (
                    <span className="alert-chevron">
                      <Icon name={isExpanded ? 'arrow-up' : 'arrow-down'} size={12}/>
                    </span>
                  )}
                </div>
                <button className="alert-dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(a.id); }}
                  aria-label="Dismiss alert">
                  <Icon name="close" size={12}/>
                </button>
              </div>
              {isExpanded && (
                <div className="alert-tasks">
                  {isLoading && <div className="alert-tasks-state">Loading tasks…</div>}
                  {hasError  && <div className="alert-tasks-state error">Failed to load tasks.</div>}
                  {!isLoading && !hasError && tasks.length === 0 && (
                    <div className="alert-tasks-state">No at-risk or overdue tasks found.</div>
                  )}
                  {!isLoading && !hasError && (() => {
                    const overdue = tasks.filter(t => t.taskType === 'overdue');
                    const atrisk  = tasks.filter(t => t.taskType === 'atrisk');
                    const rows = [...overdue, ...atrisk];

                    if (drillMode === 'table') {
                      return (
                        <table className="task-table">
                          <thead>
                            <tr>
                              <th style={{width: '90px'}}>Task ID</th>
                              <th style={{width: '100px'}}>App ID</th>
                              <th style={{width: '100px', whiteSpace:'normal'}}>Create Dte</th>
                              <th style={{width: '110px', whiteSpace:'normal'}}>SLAAdjusted Dte</th>
                              <th style={{width:'25%'}}>Description</th>
                              <th style={{width: '70px', whiteSpace:'normal'}}>On hold (hours)</th>
                              <th style={{width: '70px', whiteSpace:'normal'}}>On task (hours)</th>
                              <th style={{width: '100px', whiteSpace:'normal'}}>Milestone</th>
                              <th style={{width: '100px'}}>Current</th>
                              <th style={{width: '90px'}}>Status</th>
                              <th style={{width: '160px'}}>TAT vs Target</th>
                              <th style={{width: '70px'}}>Priority</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(t => {
                              const status = alertStatusInfo(t.taskType);
                              const target = t.TargetHours != null ? Number(t.TargetHours) : (t.SLAInHours != null ? Number(t.SLAInHours) : 0);
                              const tat = t.TotalHoursOnTask_BH != null ? Number(t.TotalHoursOnTask_BH) : (t.TatHours != null ? Number(t.TatHours) : null);
                              const pct = (tat != null && target > 0) ? Math.min(tat / target, 1.6) : 0;
                              const desc = (t.StaffFullName && t.StaffFullName.trim())
                                ? t.StaffFullName.trim()
                                : (t.ShortDescription || `Task #${t.TaskID}`);
                              const prio = normalizePriority(t.Priority);
                              const prioLabel = prio === 'high' ? 'High' : prio === 'med' ? 'Med' : 'Low';
                              const rowCls = status.cls === 'bad' ? 'overdue-row' : 'risk-row';
                              return (
                                <tr key={t.TaskID + '-' + t.taskType} className={rowCls}>
                                  <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TaskID}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.ApplicationID != null ? t.ApplicationID : '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(t.CreateDte||'').split(' ')[0]||'-'}</div>
                                    {t.CreateDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{t.CreateDte.split(' ')[1]}</div>}
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(t.SLAAdjustedDte||'').split(' ')[0]||'-'}</div>
                                    {t.SLAAdjustedDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{t.SLAAdjustedDte.split(' ')[1]}</div>}
                                  </td>
                                  <td>
                                    <div className="task-desc-main">{desc}</div>
                                    <div className="task-client">{t.ShortDescription || '-'}</div>
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TotalHoursOnHold != null ? parseFloat(t.TotalHoursOnHold).toFixed(1) : '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="task-id">{t.TotalHoursOnTask_BH != null ? parseFloat(t.TotalHoursOnTask_BH).toFixed(1) : '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.MilestoneGroupName === 'Approved Loans' ? 'Approved' : (t.MilestoneGroupName || '-')}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.TaskStatus || '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    <span className={`pill ${status.cls}`}>
                                      <span className="pill-dot"/>{status.label}
                                    </span>
                                  </td>
                                  <td>
                                    <div className="tat-cell">
                                      {tat != null ? (
                                        <>
                                          <div className="t">
                                            <span className="mono">{tat.toFixed(1)}h</span>
                                            <span className="vs">/ {target.toFixed(1)}h target</span>
                                          </div>
                                          <div className="tat-bar">
                                            <div className={`progress-fill ${status.cls}`} style={{ width: `${Math.min(pct * 100, 100)}%` }}/>
                                          </div>
                                        </>
                                      ) : (
                                        <div className="t"><span className="vs" style={{marginLeft:'auto'}}>/ {target.toFixed(1)}h target</span></div>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`priority ${prio}`}>
                                      <span className="dot"/>{prioLabel}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    }

                    return (
                      <>
                        {overdue.map(t => (
                          <div className="alert-task-row is-overdue" key={t.TaskID}>
                            <span className="alert-task-dot" />
                            <div className="alert-task-body">
                              <div className="alert-task-title">{(t.StaffFullName && t.StaffFullName.trim()) ? t.StaffFullName.trim() : (t.ShortDescription || `Task #${t.TaskID}`)}</div>
                              <div className="alert-task-sub">
                                #{t.TaskID}{t.OverDueComments ? ` · ${t.OverDueComments}` : ''}
                              </div>
                            </div>
                            <span className="alert-task-badge overdue">
                              +{parseFloat(t.overdueHours).toFixed(1)}h
                            </span>
                          </div>
                        ))}
                        {atrisk.length > 0 && (
                          <>
                            <div className="alert-tasks-divider">At Risk</div>
                            {atrisk.map(t => (
                              <div className="alert-task-row is-atrisk" key={t.TaskID}>
                                <span className="alert-task-dot" />
                                <div className="alert-task-body">
                                  <div className="alert-task-title">{(t.StaffFullName && t.StaffFullName.trim()) ? t.StaffFullName.trim() : (t.ShortDescription || `Task #${t.TaskID}`)}</div>
                                  <div className="alert-task-sub">
                                    #{t.TaskID}{t.OverDueComments ? ` · ${t.OverDueComments}` : ''}
                                  </div>
                                </div>
                                <span className="alert-task-badge atrisk">At risk</span>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Task row ---
const TaskRow = ({ task, target, showCompletedDte = false }) => {
  const pct = task.tatHours != null ? Math.min(task.tatHours / target, 1.6) : 0;
  const barCls = task.status;
  const rowCls = task.status === 'bad' ? 'overdue-row' : task.status === 'warn' ? 'risk-row' : 'on-track-row';
  const statusLabel = task.status === 'ok' ? 'On Track' : task.status === 'warn' ? 'At Risk' : 'Overdue';
  const prioLabel = task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low';

  return (
    <tr className={rowCls}>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.id}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.appId != null ? task.appId : '-'}</span></td>
      {!showCompletedDte && (
        <td style={{whiteSpace:'nowrap'}}>
          <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(task.createDte||'').split(' ')[0]||'-'}</div>
          {task.createDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{task.createDte.split(' ')[1]}</div>}
        </td>
      )}
      <td style={{whiteSpace:'nowrap'}}>
        <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(task.slaAdjustedDte||'').split(' ')[0]||'-'}</div>
        {task.slaAdjustedDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{task.slaAdjustedDte.split(' ')[1]}</div>}
      </td>
      {showCompletedDte && (
        <td style={{whiteSpace:'nowrap'}}>
          <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{(task.completedDte||'').split(' ')[0]||'-'}</div>
          {task.completedDte?.split(' ')[1] && <div style={{fontSize:'12px',color:'var(--ink-soft)'}}>{task.completedDte.split(' ')[1]}</div>}
        </td>
      )}
      <td>
        <div className="task-desc-main">{task.desc}</div>
        <div className="task-client">{task.client}</div>
      </td>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.slaInHours != null ? task.slaInHours : '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.onHoldHours != null ? task.onHoldHours.toFixed(1) : '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.onTaskHours != null ? task.onTaskHours.toFixed(1) : '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="soft">{task.milestoneGroupName || '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="soft">{task.taskStatus || '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}>
        <span className={`pill ${task.status}`}>
          <span className="pill-dot"/>{statusLabel}
        </span>
      </td>
      <td>
        <div className="tat-cell">
          {task.tatHours != null ? (
            <>
              <div className="t">
                <span className="mono">{task.tatHours.toFixed(1)}h</span>
                <span className="vs">/ {target}h target</span>
              </div>
              <div className="tat-bar">
                <div className={`progress-fill ${barCls}`} style={{ width: `${Math.min(pct*100, 100)}%` }}/>
              </div>
            </>
          ) : (
            <div className="t"><span className="vs" style={{marginLeft:'auto'}}>/ {target}h target</span></div>
          )}
        </div>
      </td>
      <td>
        <span className={`priority ${task.priority === 'high' ? 'high' : task.priority === 'med' ? 'med' : 'low'}`}>
          <span className="dot"/>{prioLabel}
        </span>
      </td>
    </tr>
  );
};

// --- Modal ---
const TaskModal = ({ team, tasks = [], onClose, maxTasks = 10, taskLabel, loading = false, completedMode = false }) => {
  const [sort, cycleSort] = useSortState();
  const sortedTasks = sortRows(tasks, sort.col, sort.dir, (t, col) => {
    if (col === 'id')           return parseInt((t.id||'').replace('T-',''),10)||0;
    if (col === 'appId')        return t.appId         ?? null;
    if (col === 'createDte')    return parseDMY(t.createDte);
    if (col === 'completedDte') return parseDMY(t.completedDte);
    if (col === 'slaAdj')       return parseDMY(t.slaAdjustedDte);
    if (col === 'desc')         return t.desc          || '';
    if (col === 'slaHours')     return t.slaInHours    ?? null;
    if (col === 'onHold')       return t.onHoldHours   ?? null;
    if (col === 'onTask')       return t.onTaskHours   ?? null;
    if (col === 'milestone')    return t.milestoneGroupName || '';
    if (col === 'current')      return t.taskStatus    || '';
    if (col === 'status')       return ({bad:0,warn:1,ok:2}[t.status] ?? 3);
    if (col === 'tat')          return t.tatHours      ?? 0;
    if (col === 'priority')     return ({high:0,med:1,low:2}[t.priority] ?? 3);
    return '';
  });
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const completedAvgTat = React.useMemo(() => {
    if (!completedMode || tasks.length === 0) return null;
    const vals = tasks.map(t => {
      const tat = t.tatHours;
      // Primary: TotalHoursOnTask_BH when positive (non-null, non-zero, non-negative)
      // Negative tatHours means the normalizeTask fallback computed (CompletedDate - SLAAdjustedDate)
      // which is negative when completed before the adjusted deadline — exclude from avg TAT
      if (tat != null && isFinite(tat) && tat > 0) return tat;
      // Fallback: (CompletedDateTime - DateCreatedDateTime) in hours
      // when TotalHoursOnTask_BH IS NULL or zero, both dates present
      // DateCreated=today is guaranteed by the API filter for this drill-through
      if (t.completedDte && t.createDte) {
        const createTs = parseDMY(t.createDte);
        const compTs   = parseDMY(t.completedDte);
        if (createTs !== 0 && compTs !== 0) {
          const diff = (compTs - createTs) / 3600000;
          if (isFinite(diff)) return diff;
        }
      }
      return null;
    }).filter(h => h != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [completedMode, tasks]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={completedMode ? {background:'#D3D3D3'} : undefined}>
        <div className="modal-head">
          <div className="modal-head-top">
            <div className="modal-title">
              <div className="sub">{team.fallbackDeptId ? 'Department Group' : 'KPI Group'} · SLA target {team.target}h</div>
              <h2>{team.name} — {taskLabel ?? (loading ? 'Loading…' : `Top ${tasks.length} Active Tasks`)}</h2>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18}/>
            </button>
          </div>
          <div className="modal-chips">
            <div className="chip">
              <div className="chip-label">SLA% (only Completed tasks)<InfoTip text={TOOLTIPS.modal.sla} width={260}/></div>
              <div className="chip-value">
                {completedMode && tasks.length > 0
                  ? Math.round(tasks.filter(t => t.status !== 'bad').length / tasks.length * 100)
                  : team.sla
                }<span className="unit">%</span>
              </div>
            </div>
            {completedMode ? (
              <>
                <div className="chip">
                  <div className="chip-label">Total Completed Tasks</div>
                  <div className="chip-value">{tasks.length}</div>
                </div>
                <div className="chip">
                  <div className="chip-label">Total On-Time Tasks</div>
                  <div className="chip-value">{tasks.filter(t => t.status !== 'bad').length}</div>
                </div>
                <div className="chip overdue danger">
                  <div className="chip-label">Overdue (Only Completed Tasks)<InfoTip text={TOOLTIPS.modal.overdueCompleted} width={280}/></div>
                  <div className="chip-value">{tasks.filter(t => t.status === 'bad').length}</div>
                </div>
                <div className={`chip ${(completedAvgTat ?? team.avgTat) > team.target ? 'danger' : ''}`}>
                  <div className="chip-label">Avg TAT (ONLY COMPLETED TASKS)<InfoTip text={TOOLTIPS.modal.avgTatCompleted} width={280}/></div>
                  <div className="chip-value" style={{color:'#111'}}>{completedAvgTat != null ? fmtHMS(completedAvgTat) : fmtHMS(team.avgTat)}</div>
                </div>
              </>
            ) : (
              <>
                <div className="chip">
                  <div className="chip-label">Volume<InfoTip text={TOOLTIPS.modal.volume} width={220}/></div>
                  <div className="chip-value">{team.volume}</div>
                </div>
                <div className={`chip ${team.avgTat > team.target ? 'danger' : ''}`}>
                  <div className="chip-label">Avg TAT<InfoTip text={TOOLTIPS.modal.avgTat} width={240}/></div>
                  <div className="chip-value">{fmtHMS(team.avgTat)}</div>
                </div>
                <div className="chip overdue danger">
                  <div className="chip-label">Overdue (only Active tasks)<InfoTip text={TOOLTIPS.modal.overdue} width={240}/></div>
                  <div className="chip-value">{team.overdue}</div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="modal-body" style={completedMode ? {background:'#fff'} : undefined}>
          {loading ? (
            <div style={{padding: 48, textAlign: 'center', color: 'var(--ink-muted)'}}>Loading…</div>
          ) : (
          <table className="task-table">
            <thead>
              {completedMode ? (
                <tr>
                  <SortTh sortKey="id"           sort={sort} onSort={cycleSort} style={{width: '90px'}}>Task ID</SortTh>
                  <SortTh sortKey="appId"        sort={sort} onSort={cycleSort} style={{width: '100px'}}>App ID</SortTh>
                  <SortTh sortKey="slaAdj"       sort={sort} onSort={cycleSort} style={{width: '110px', whiteSpace:'normal'}}>SLAAdjusted Dte</SortTh>
                  <SortTh sortKey="completedDte" sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Completed Dte</SortTh>
                  <SortTh sortKey="desc"         sort={sort} onSort={cycleSort} style={{width:'25%'}}>Description</SortTh>
                  <SortTh sortKey="slaHours"     sort={sort} onSort={cycleSort} style={{width: '65px', whiteSpace:'normal'}}>SLA (hours)</SortTh>
                  <SortTh sortKey="onHold"       sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On hold (hours)</SortTh>
                  <SortTh sortKey="onTask"       sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On task (hours)</SortTh>
                  <SortTh sortKey="milestone"    sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Milestone</SortTh>
                  <SortTh sortKey="current"      sort={sort} onSort={cycleSort} style={{width: '100px'}}>Current</SortTh>
                  <SortTh sortKey="status"       sort={sort} onSort={cycleSort} style={{width: '90px'}}>Status</SortTh>
                  <SortTh sortKey="tat"          sort={sort} onSort={cycleSort} style={{width: '160px'}}>TAT vs Target</SortTh>
                  <SortTh sortKey="priority"     sort={sort} onSort={cycleSort} style={{width: '70px'}}>Priority</SortTh>
                </tr>
              ) : (
                <tr>
                  <SortTh sortKey="id"        sort={sort} onSort={cycleSort} style={{width: '90px'}}>Task ID</SortTh>
                  <SortTh sortKey="appId"     sort={sort} onSort={cycleSort} style={{width: '100px'}}>App ID</SortTh>
                  <SortTh sortKey="createDte" sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Create Dte</SortTh>
                  <SortTh sortKey="slaAdj"    sort={sort} onSort={cycleSort} style={{width: '110px', whiteSpace:'normal'}}>SLAAdjusted Dte</SortTh>
                  <SortTh sortKey="desc"      sort={sort} onSort={cycleSort} style={{width:'25%'}}>Description</SortTh>
                  <SortTh sortKey="slaHours"  sort={sort} onSort={cycleSort} style={{width: '65px', whiteSpace:'normal'}}>SLA (hours)</SortTh>
                  <SortTh sortKey="onHold"    sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On hold (hours)</SortTh>
                  <SortTh sortKey="onTask"    sort={sort} onSort={cycleSort} style={{width: '70px', whiteSpace:'normal'}}>On task (hours)</SortTh>
                  <SortTh sortKey="milestone" sort={sort} onSort={cycleSort} style={{width: '100px', whiteSpace:'normal'}}>Milestone</SortTh>
                  <SortTh sortKey="current"   sort={sort} onSort={cycleSort} style={{width: '100px'}}>Current</SortTh>
                  <SortTh sortKey="status"    sort={sort} onSort={cycleSort} style={{width: '90px'}}>Status</SortTh>
                  <SortTh sortKey="tat"       sort={sort} onSort={cycleSort} style={{width: '160px'}}>TAT vs Target</SortTh>
                  <SortTh sortKey="priority"  sort={sort} onSort={cycleSort} style={{width: '70px'}}>Priority</SortTh>
                </tr>
              )}
            </thead>
            <tbody>
              {sortedTasks.map(t => <TaskRow key={t.id} task={t} target={team.target} showCompletedDte={completedMode}/>)}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Loan KPI Tile ---
// Layout matches provided screenshot: title row, two-col stats (count left / amount right),
// footer with count delta (left, green/red) and amount delta (right, green/red).
const LoanKpiTile = ({ label, count, amount, countDelta, amtDelta, countDelta5, amtDelta5, target, onClick, tooltip, tooltipWidth }) => {
  // Full number with commas for the stat value (e.g. $1,100,000)
  const fmtAmtFull = (v) => {
    if (v == null || isNaN(v)) return '$0';
    return '$' + Math.round(v).toLocaleString('en-AU');
  };
  // Abbreviated absolute amount (no sign — arrow conveys direction)
  const fmtAmtAbs = (abs) => {
    if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)} mil`;
    if (abs >= 1_000)     return `$${Math.round(abs / 1_000)}K`;
    return `$${Math.round(abs)}`;
  };

  const hasCnt = countDelta != null && countDelta !== 0;
  const hasAmt = amtDelta  != null && amtDelta  !== 0;
  const posCol  = 'var(--ok)';
  const negCol  = 'var(--bad)';
  const greyCol = 'var(--ink-muted)';

  return (
    <div className="card" onClick={onClick} role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onKeyDown={onClick ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }) : undefined}>
      <div className="card-head" style={{ paddingBottom: '10px', marginBottom: '6px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <h3 className="card-team" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}
          {tooltip && <span onClick={e => e.stopPropagation()}><InfoTip text={tooltip} width={tooltipWidth ?? 260}/></span>}
        </h3>
        {target != null && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px', lineHeight: 1.6, whiteSpace: 'nowrap', marginLeft: 8 }}>
            Target : {target}
          </span>
        )}
      </div>

      <div className="loan-stats">
        <div className="stat">
          <div className="stat-label" style={{textTransform: 'none'}}>Application IDs #:</div>
          <div className="stat-value">{count}</div>
        </div>
        <div className="stat" style={{ textAlign: 'right' }}>
          <div className="stat-label" style={{textTransform: 'none'}}>Total Loan Amount:</div>
          <div className="stat-value" style={{ fontSize: '22px' }}>{fmtAmtFull(amount)}</div>
        </div>
      </div>

      <div className="card-foot" style={{ marginTop: '8px' }}>
        <span className="stat-delta" style={{ color: greyCol, fontWeight: 400 }}>
          {!hasCnt && !hasAmt ? (
            <span>No change vs yesterday</span>
          ) : (
            <>
              {hasCnt && (
                <span style={{ color: countDelta > 0 ? posCol : negCol, fontWeight: 600 }}>
                  {countDelta > 0 ? '↑' : '↓'} {Math.abs(countDelta)}
                </span>
              )}
              {hasCnt && hasAmt && (
                <span style={{ color: greyCol, fontWeight: 400 }}> and </span>
              )}
              {hasAmt && (
                <span style={{ color: amtDelta > 0 ? posCol : negCol, fontWeight: 600 }}>
                  {amtDelta > 0 ? '↑' : '↓'} {fmtAmtAbs(Math.abs(amtDelta))}
                </span>
              )}
              <span style={{ color: greyCol, fontWeight: 400 }}> vs yesterday</span>
            </>
          )}
        </span>
        {(() => {
          const hasCnt5 = countDelta5 != null && countDelta5 !== 0;
          const hasAmt5 = amtDelta5  != null && amtDelta5  !== 0;
          return (
            <span className="stat-delta" style={{ color: greyCol, fontWeight: 400, display: 'block', marginTop: '2px' }}>
              {!hasCnt5 && !hasAmt5 ? (
                <span>No change vs 5 days ago</span>
              ) : (
                <>
                  {hasCnt5 && (
                    <span style={{ color: countDelta5 > 0 ? posCol : negCol, fontWeight: 600 }}>
                      {countDelta5 > 0 ? '↑' : '↓'} {Math.abs(countDelta5)}
                    </span>
                  )}
                  {hasCnt5 && hasAmt5 && (
                    <span style={{ color: greyCol, fontWeight: 400 }}> and </span>
                  )}
                  {hasAmt5 && (
                    <span style={{ color: amtDelta5 > 0 ? posCol : negCol, fontWeight: 600 }}>
                      {amtDelta5 > 0 ? '↑' : '↓'} {fmtAmtAbs(Math.abs(amtDelta5))}
                    </span>
                  )}
                  <span style={{ color: greyCol, fontWeight: 400 }}> vs 5 days ago</span>
                </>
              )}
            </span>
          );
        })()}
      </div>
    </div>
  );
};

// --- Modal Sparkline — 30-day daily trend inside LoanModal chips ---
// Weekends excluded; hi=green dot, lo=red dot; hover portal tooltip.
const SPARK_LINE  = '#808080';
const SPARK_AREA  = '#CBCBCB';
const ModalSparkline = ({ data = [], field, fmtFn }) => {
  const W = 400, H = 44;
  const wrapRef = React.useRef(null);
  const [hoverIdx, setHoverIdx] = React.useState(null);

  const pts = data.filter(d => {
    const day = new Date(d.date + 'T00:00:00').getDay();
    return day !== 0 && day !== 6;
  });
  if (pts.length < 2) return null;

  const vals = pts.map(d => d[field] ?? 0);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const pad = 6;
  const xAt = i => i * (W / Math.max(pts.length - 1, 1));
  const yAt = v => H - pad - ((v - minV) / range) * (H - pad * 2);

  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const area = `${path} L${xAt(vals.length - 1)},${H} L0,${H} Z`;
  const hiIdx = vals.indexOf(Math.max(...vals));
  const loIdx = vals.indexOf(Math.min(...vals));

  const handleMove = (e) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHoverIdx(Math.min(Math.max(Math.round(ratio * (pts.length - 1)), 0), pts.length - 1));
  };

  return (
    <div ref={wrapRef} style={{ marginTop: 8 }}
      onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        <path d={area} fill={SPARK_AREA} opacity="0.7"/>
        <path d={path} fill="none" stroke={SPARK_LINE} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
        {hiIdx !== loIdx && <circle cx={xAt(loIdx)}  cy={yAt(vals[loIdx])}  r="3.5" fill="var(--bad)"/>}
        <circle cx={xAt(hiIdx)} cy={yAt(vals[hiIdx])} r="3.5" fill="var(--ok)"/>
        {hoverIdx !== null && <>
          <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={0} y2={H} stroke={SPARK_LINE} strokeWidth="1" strokeDasharray="3 2" opacity="0.35"/>
          <circle cx={xAt(hoverIdx)} cy={yAt(vals[hoverIdx])} r="3.5" fill="white" stroke={SPARK_LINE} strokeWidth="1.5"/>
        </>}
      </svg>
      {hoverIdx !== null && wrapRef.current && ReactDOM.createPortal(
        <div className="tooltip show" style={{ position: 'fixed', left: wrapRef.current.getBoundingClientRect().left + (xAt(hoverIdx) / W) * wrapRef.current.getBoundingClientRect().width, top: wrapRef.current.getBoundingClientRect().top, zIndex: 9998 }}>
          <div className="tooltip-head">{pts[hoverIdx].date}</div>
          <div className="tooltip-row"><span>{fmtFn ? fmtFn(vals[hoverIdx]) : vals[hoverIdx]}</span></div>
        </div>,
        document.body
      )}
    </div>
  );
};

// --- Loan Detail Modal ---
// Drill-down modal for the 3 loan summary cards — mirrors TaskModal UX exactly.
// Props: label (card title), type ('received'|'approved'|'settled'), loans (array), loading, error, onClose, trendData
export const LoanModal = ({ label, loans = [], loading, error, onClose, trendData = [] }) => {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const fmtAmt = (v) => {
    if (v == null || isNaN(v)) return '$0';
    return '$' + parseFloat(v).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const total = loans.reduce((s, r) => s + (parseFloat(r.LoanAmount) || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-head-top">
            <div className="modal-title">
              <div className="sub">Loan Milestone · Today</div>
              <h2 style={{fontSize: '16px'}}>{label}</h2>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18}/>
            </button>
          </div>
          <div className="modal-chips">
            <div className="chip">
              <div className="chip-label">Applications</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <div className="chip-value">{loading ? '…' : loans.length}</div>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}><ModalSparkline data={trendData} field="count" fmtFn={v => v}/></div>
              </div>
            </div>
            <div className="chip">
              <div className="chip-label">Total Loan Amount</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <div className="chip-value" style={{ fontSize: '22px', whiteSpace: 'nowrap' }}>{loading ? '…' : fmtAmt(total)}</div>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}><ModalSparkline data={trendData} field="amount" fmtFn={fmtAmt}/></div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-body">
          {loading && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
              Loading applications…
            </div>
          )}
          {error && !loading && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--bad)', fontSize: 12 }}>
              Failed to load: {error}
            </div>
          )}
          {!loading && !error && loans.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
              No applications found for today.
            </div>
          )}
          {!loading && !error && loans.length > 0 && (
            <table className="task-table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Date</th>
                  <th style={{ width: '130px' }}>Application ID</th>
                  <th>Funder Name</th>
                  <th style={{ width: '160px', textAlign: 'right' }}>Loan Amount</th>
                </tr>
              </thead>
              <tbody>
                {loans.map(row => (
                  <tr key={row.ApplicationID}>
                    <td style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>{row.MilestoneDate || '—'}</td>
                    <td><span className="task-id">#{row.ApplicationID}</span></td>
                    <td style={{fontSize: '12px'}}>{row.FunderName || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '12px' }}>
                      {fmtAmt(row.LoanAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export { KpiTile, TeamCard, AlertsPanel, TaskRow, TaskModal, LoanKpiTile };
