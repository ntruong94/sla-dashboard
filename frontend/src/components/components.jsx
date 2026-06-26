import React from 'react';
import ReactDOM from 'react-dom';
import { Icon } from './icons.jsx';
import { slaClass, slaLabel, TOOLTIPS } from '../constants.js';
import { getAlertTasks } from '../api.js';
import { fmtHMS } from './utils.js';

// Team card + KPI strip + Alerts panel + Task modal

// ─── Info Tooltip ─────────────────────────────────────────────────────────────
// Renders the bubble into document.body via a portal so parent overflow:hidden
// or stacking contexts cannot clip it. Positioned with position:fixed.
export const InfoTip = ({ text, width }) => {
  const iconRef = React.useRef(null);
  const [pos, setPos] = React.useState(null); // {top, left, below} in px when visible

  const show = (e) => {
    const r = (e.currentTarget || iconRef.current).getBoundingClientRect();
    const bubbleH = 200; // conservative estimate — real height unknown until rendered
    const below = r.top < bubbleH; // flip downward when too close to top of viewport
    // position:fixed uses viewport coords — do NOT add scrollY/scrollX
    setPos({
      top:  below ? r.bottom : r.top,
      left: r.left + r.width / 2,
      below,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={iconRef}
      className="info-tip"
      tabIndex={0}
      role="note"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className="info-tip-icon">i</span>
      {pos && ReactDOM.createPortal(
        <span
          className={`info-tip-bubble info-tip-bubble--fixed${pos.below ? ' info-tip-bubble--below' : ''}`}
          style={{ top: pos.top, left: pos.left, ...(width ? { width } : {}) }}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
};

// --- KPI tile ---
const KpiTile = ({ label, value, unit, delta, deltaDir, accent, icon, tooltip, tooltipWidth }) => {
  const deltaClass = deltaDir === 'up' ? (accent === 'bad' ? 'up-bad' : 'up') :
                     deltaDir === 'down' ? (accent === 'bad' ? 'down up' : 'down') : 'up';
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
const TeamCard = ({ team, onClick }) => {
  const cls = slaClass(team.sla);
  const over = team.avgTat > team.target;
  const hasOverdue = team.overdue > 0;
  const d = team.deltas || { volume: 0, sla: 0, avgTat: 0, overdue: 0 };

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
          <div className="card-dept">{team.dept}</div>
          <h3 className="card-team">{team.name}</h3>
        </div>
        <span className={`badge ${cls}`}>
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
                              <th style={{width: '100px'}}>Create Dte</th>
                              <th style={{width: '120px'}}>SLAAdjusted Dte</th>
                              <th style={{minWidth: '660px'}}>Description</th>
                              <th style={{width: '100px'}}>Current</th>
                              <th style={{width: '90px'}}>Status</th>
                              <th style={{width: '180px'}}>TAT vs Target</th>
                              <th style={{width: '80px'}}>Priority</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(t => {
                              const status = alertStatusInfo(t.taskType);
                              const target = Number(t.TargetHours ?? t.SLAInHours ?? 0);
                              const tat = Number(t.TatHours ?? t.TotalHoursOnTask ?? 0);
                              const pct = target > 0 ? Math.min(tat / target, 1.6) : 0;
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
                                  <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.CreateDte || '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.SLAAdjustedDte || '-'}</span></td>
                                  <td>
                                    <div className="task-desc-main">{desc}</div>
                                    <div className="task-client">{t.ShortDescription || '-'}</div>
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}><span className="soft">{t.TaskStatus || '-'}</span></td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    <span className={`pill ${status.cls}`}>
                                      <span className="pill-dot"/>{status.label}
                                    </span>
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}>
                                    <div className="tat-cell">
                                      <div className="t">
                                        <span className="mono">{tat.toFixed(1)}h</span>
                                        <span className="vs">/ {target.toFixed(1)}h target</span>
                                      </div>
                                      <div className="tat-bar">
                                        <div className={`progress-fill ${status.cls}`} style={{ width: `${Math.min(pct * 100, 100)}%` }}/>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{whiteSpace:'nowrap'}}>
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
const TaskRow = ({ task, target }) => {
  const pct = Math.min(task.tatHours / target, 1.6);
  const barCls = task.status;
  const rowCls = task.status === 'bad' ? 'overdue-row' : task.status === 'warn' ? 'risk-row' : 'on-track-row';
  const statusLabel = task.status === 'ok' ? 'On Track' : task.status === 'warn' ? 'At Risk' : 'Overdue';
  const prioLabel = task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low';

  return (
    <tr className={rowCls}>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.id}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="task-id">{task.appId != null ? task.appId : '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="soft">{task.createDte || '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="soft">{task.slaAdjustedDte || '-'}</span></td>
      <td>
        <div className="task-desc-main">{task.desc}</div>
        <div className="task-client">{task.client}</div>
      </td>
      <td style={{whiteSpace:'nowrap'}}><span className="soft">{task.taskStatus || '-'}</span></td>
      <td style={{whiteSpace:'nowrap'}}>
        <span className={`pill ${task.status}`}>
          <span className="pill-dot"/>{statusLabel}
        </span>
      </td>
      <td style={{whiteSpace:'nowrap'}}>
        <div className="tat-cell">
          <div className="t">
            <span className="mono">{task.tatHours.toFixed(1)}h</span>
            <span className="vs">/ {target}h target</span>
          </div>
          <div className="tat-bar">
            <div className={`progress-fill ${barCls}`} style={{ width: `${Math.min(pct*100, 100)}%` }}/>
          </div>
        </div>
      </td>
      <td style={{whiteSpace:'nowrap'}}>
        <span className={`priority ${task.priority === 'high' ? 'high' : task.priority === 'med' ? 'med' : 'low'}`}>
          <span className="dot"/>{prioLabel}
        </span>
      </td>
    </tr>
  );
};

// --- Modal ---
const TaskModal = ({ team, tasks = [], onClose, maxTasks = 10 }) => {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const cls = slaClass(team.sla);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{width: 'min(1600px, 96vw)'}}>
        <div className="modal-head">
          <div className="modal-head-top">
            <div className="modal-title">
              <div className="sub">{team.dept} · SLA target {team.target}h</div>
              <h2>{team.name} — Top {maxTasks} Active Tasks</h2>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18}/>
            </button>
          </div>
          <div className="modal-chips">
            <div className="chip">
              <div className="chip-label">Volume<InfoTip text={TOOLTIPS.modal.volume} width={220}/></div>
              <div className="chip-value">{team.volume}</div>
            </div>
            <div className="chip">
              <div className="chip-label">SLA %<InfoTip text={TOOLTIPS.modal.sla} width={260}/></div>
              <div className="chip-value">{team.sla}<span className="unit">%</span></div>
            </div>
            <div className={`chip ${team.avgTat > team.target ? 'danger' : ''}`}>
              <div className="chip-label">Avg TAT<InfoTip text={TOOLTIPS.modal.avgTat} width={240}/></div>
              <div className="chip-value" style={{color: '#111'}}>{fmtHMS(team.avgTat)}</div>
            </div>
            <div className="chip overdue danger">
              <div className="chip-label">Overdue<InfoTip text={TOOLTIPS.modal.overdue} width={240}/></div>
              <div className="chip-value">{team.overdue}</div>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <table className="task-table">
            <thead>
              <tr>
                <th style={{width: '90px'}}>Task ID</th>
                <th style={{width: '100px'}}>App ID</th>
                <th style={{width: '100px'}}>Create Dte</th>
                <th style={{width: '120px'}}>SLAAdjusted Dte</th>
                <th style={{minWidth: '660px'}}>Description</th>
                <th style={{width: '100px'}}>Current</th>
                <th style={{width: '90px'}}>Status</th>
                <th style={{width: '180px'}}>TAT vs Target</th>
                <th style={{width: '80px'}}>Priority</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => <TaskRow key={t.id} task={t} target={team.target}/>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- Loan KPI Tile ---
// Layout matches provided screenshot: title row, two-col stats (count left / amount right),
// footer with count delta (left, green/red) and amount delta (right, green/red).
const LoanKpiTile = ({ label, count, amount, countDelta, amtDelta, target, onClick, tooltip, tooltipWidth }) => {
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
      </div>
    </div>
  );
};

// --- Loan Detail Modal ---
// Drill-down modal for the 3 loan summary cards — mirrors TaskModal UX exactly.
// Props: label (card title), type ('received'|'approved'|'settled'), loans (array), loading, error, onClose
export const LoanModal = ({ label, loans = [], loading, error, onClose }) => {
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
              <div className="chip-value">{loading ? '…' : loans.length}</div>
            </div>
            <div className="chip">
              <div className="chip-label">Total Loan Amount</div>
              <div className="chip-value" style={{ fontSize: '22px' }}>{loading ? '…' : fmtAmt(total)}</div>
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
