import React from 'react';
import { Icon } from './icons.jsx';
import { slaClass, slaLabel } from '../constants.js';

// Team card + KPI strip + Alerts panel + Task modal

// --- KPI tile ---
const KpiTile = ({ label, value, unit, delta, deltaDir, accent, icon }) => {
  const deltaClass = deltaDir === 'up' ? (accent === 'bad' ? 'up-bad' : 'up') :
                     deltaDir === 'down' ? (accent === 'bad' ? 'down up' : 'down') : 'up';
  return (
    <div className={`kpi ${accent ? 'accent-' + accent : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon name={icon} size={20}/></span>
      </div>
      <div className="kpi-value">
        {value}{unit && <span className="unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`kpi-delta ${deltaClass}`}>
          <Icon name={deltaDir === 'up' ? 'arrow-up' : 'arrow-down'} size={12}/>
          {delta}<span className="since">since yesterday</span>
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
        </span>
      </div>

      <div className="card-stats">
        <div className="stat">
          <div className="stat-label">Volume</div>
          <div className="stat-value">{team.volume}</div>
          {fmtD(d.volume) && (
            <div className="stat-delta neutral">{fmtD(d.volume)}</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Avg TAT</div>
          <div className={`stat-value ${over ? 'danger' : ''}`}>
            {team.avgTat.toFixed(1)}<span className="unit">h</span>
          </div>
          {fmtD(d.avgTat, 'h') && (
            <div className={`stat-delta ${d.avgTat > 0 ? 'up' : 'down'}`}>{fmtD(d.avgTat, 'h')}</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Overdue</div>
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

// --- Alerts panel ---
const AlertsPanel = ({ alerts, onDismiss }) => (
  <div className="alerts-panel">
    <div className="alerts-head">
      <span className="title">
        <Icon name="alerts" size={15}/> Active Alerts
      </span>
      <span className="count-badge">{alerts.length}</span>
    </div>
    <div className="alerts-list">
      {alerts.length === 0 ? (
        <div className="alerts-empty">✓ All clear — no active alerts</div>
      ) : alerts.map(a => (
        <div key={a.id} className={`alert ${a.severity}`}>
          <div className="alert-icon">
            <Icon name={a.severity === 'critical' ? 'alert-critical' : 'alert-warning'} size={14}/>
          </div>
          <div className="alert-body">
            <div className="alert-title">{a.title}</div>
            <div className="alert-desc">{a.desc}</div>
          </div>
          <div className="alert-time">{a.time}</div>
          <button className="alert-dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(a.id); }}
            aria-label="Dismiss alert">
            <Icon name="close" size={12}/>
          </button>
        </div>
      ))}
    </div>
  </div>
);

// --- Task row ---
const TaskRow = ({ task, target }) => {
  const pct = Math.min(task.tatHours / target, 1.6);
  const barCls = task.status;
  const rowCls = task.status === 'bad' ? 'overdue-row' : task.status === 'warn' ? 'risk-row' : 'on-track-row';
  const statusLabel = task.status === 'ok' ? 'On Track' : task.status === 'warn' ? 'At Risk' : 'Overdue';
  const prioLabel = task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low';

  return (
    <tr className={rowCls}>
      <td><span className="mono task-id">{task.id}</span></td>
      <td>
        <div className="task-desc-main">{task.desc}</div>
        <div className="task-client">{task.client}</div>
      </td>
      <td>
        <span className={`pill ${task.status}`}>
          <span className="pill-dot"/>{statusLabel}
        </span>
      </td>
      <td>
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
      <td>
        <span className={`priority ${task.priority === 'high' ? 'high' : task.priority === 'med' ? 'med' : 'low'}`}>
          <span className="dot"/>{prioLabel}
        </span>
      </td>
    </tr>
  );
};

// --- Modal ---
const TaskModal = ({ team, tasks = [], onClose }) => {
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
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-head-top">
            <div className="modal-title">
              <div className="sub">{team.dept} · SLA target {team.target}h</div>
              <h2>{team.name} — Top 10 Active Tasks</h2>
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18}/>
            </button>
          </div>
          <div className="modal-chips">
            <div className="chip">
              <div className="chip-label">SLA %</div>
              <div className="chip-value">{team.sla}<span className="unit">%</span></div>
            </div>
            <div className="chip">
              <div className="chip-label">Volume</div>
              <div className="chip-value">{team.volume}</div>
            </div>
            <div className={`chip ${team.avgTat > team.target ? 'danger' : ''}`}>
              <div className="chip-label">Avg TAT</div>
              <div className="chip-value">{team.avgTat.toFixed(1)}<span className="unit">h</span></div>
            </div>
            <div className="chip overdue danger">
              <div className="chip-label">Overdue</div>
              <div className="chip-value">{team.overdue}</div>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <table className="task-table">
            <thead>
              <tr>
                <th style={{width: '110px'}}>Task ID</th>
                <th>Description</th>
                <th style={{width: '110px'}}>Status</th>
                <th style={{width: '220px'}}>TAT vs Target</th>
                <th style={{width: '100px'}}>Priority</th>
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

export { KpiTile, TeamCard, AlertsPanel, TaskRow, TaskModal };
