import React from 'react';
import { Icon } from './icons.jsx';
import { HistoryChart } from './history-chart.jsx';
import { TEAM_COLORS, slaClass, slaLabel } from '../constants.js';
import { activeTeams } from '../chartUtils.js';

// Additional views for sidebar nav routing

// ===== TEAMS VIEW — full team listing with extended metrics =====
const TeamsView = ({ teams, onOpenTeam }) => {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Operations</div>
          <h1 className="page-title">All Teams</h1>
          <div className="page-sub">{teams.length} operational teams · sorted by SLA performance</div>
        </div>
      </div>

      <div className="teams-table-wrap">
        <table className="teams-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Department</th>
              <th style={{textAlign:'right'}}>Volume</th>
              <th style={{textAlign:'right'}}>Avg TAT</th>
              <th style={{textAlign:'right'}}>Target</th>
              <th style={{textAlign:'right'}}>Overdue</th>
              <th style={{width: 220}}>SLA Compliance</th>
              <th style={{textAlign:'right', width: 100}}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...teams].sort((a,b) => a.sla - b.sla).map(t => {
              const cls = slaClass(t.sla);
              return (
                <tr key={t.id} onClick={() => onOpenTeam(t.id)} style={{cursor:'pointer'}}>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{width:8,height:32,borderRadius:2,background:TEAM_COLORS[t.name]}}/>
                      <strong>{t.name}</strong>
                    </div>
                  </td>
                  <td><span className="dept-tag" style={{background:`color-mix(in srgb, ${TEAM_COLORS[t.name]} 20%, transparent)`,color:`color-mix(in srgb, ${TEAM_COLORS[t.name]} 80%, #000)`}}>{t.dept}</span></td>
                  <td style={{textAlign:'right'}} className="mono">{t.volume}</td>
                  <td style={{textAlign:'right'}} className={`mono ${t.avgTat > t.target ? 'danger-text' : ''}`}>{t.avgTat.toFixed(1)}h</td>
                  <td style={{textAlign:'right'}} className="mono soft">{t.target}h</td>
                  <td style={{textAlign:'right'}} className={`mono ${t.overdue > 0 ? 'danger-text' : 'soft'}`}>{t.overdue}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div className="progress" style={{flex:1}}>
                        <div className={`progress-fill ${cls}`} style={{width:`${t.sla}%`}}/>
                      </div>
                      <span className="mono" style={{width:42,textAlign:'right',fontSize:12,fontWeight:600}}>{t.sla}%</span>
                    </div>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span className={`badge ${cls}`}><span className="badge-dot"/>{slaLabel(t.sla)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
};

// ===== TASKS VIEW — combined task table across teams with filters =====
const TasksView = ({ teams, tasks }) => {
  const [filterTeam, setFilterTeam] = React.useState('all');
  const [filterStatus, setFilterStatus] = React.useState('all');

  const allTasks = React.useMemo(() => {
    const out = [];
    teams.forEach(t => {
      (tasks[t.id] || []).forEach(task => out.push({ ...task, teamId: t.id, teamName: t.name, target: t.target }));
    });
    return out;
  }, [teams]);

  const filtered = allTasks.filter(t =>
    (filterTeam === 'all' || t.teamId === filterTeam) &&
    (filterStatus === 'all' || t.status === filterStatus)
  );

  const counts = {
    all: allTasks.length,
    ok: allTasks.filter(t => t.status === 'ok').length,
    warn: allTasks.filter(t => t.status === 'warn').length,
    bad: allTasks.filter(t => t.status === 'bad').length,
  };

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Operations</div>
          <h1 className="page-title">All Active Tasks</h1>
          <div className="page-sub">{filtered.length} of {allTasks.length} tasks · live from So Ezy</div>
        </div>
      </div>

      <div className="filter-row" style={{background:'transparent'}}>
        <div className="filter-group">
          <span className="filter-label">Team</span>
          <div className="seg seg-wide">
            <button className={`seg-btn ${filterTeam === 'all' ? 'active' : ''}`}
              onClick={() => setFilterTeam('all')}>All</button>
            {teams.map(t => (
              <button key={t.id} className={`seg-btn ${filterTeam === t.id ? 'active' : ''}`}
                onClick={() => setFilterTeam(t.id)}>{t.name}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Status</span>
          <div className="seg seg-wide">
            <button className={`seg-btn ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}>All ({counts.all})</button>
            <button className={`seg-btn ${filterStatus === 'ok' ? 'active' : ''}`}
              onClick={() => setFilterStatus('ok')}>On Track ({counts.ok})</button>
            <button className={`seg-btn ${filterStatus === 'warn' ? 'active' : ''}`}
              onClick={() => setFilterStatus('warn')}>At Risk ({counts.warn})</button>
            <button className={`seg-btn ${filterStatus === 'bad' ? 'active' : ''}`}
              onClick={() => setFilterStatus('bad')}>Overdue ({counts.bad})</button>
          </div>
        </div>
      </div>

      <div className="trend-card" style={{padding:0,overflow:'hidden',background:'transparent',boxShadow:'none'}}>
        <table className="task-table">
          <thead>
            <tr>
              <th style={{width:110}}>Task ID</th>
              <th>Description</th>
              <th style={{width:140}}>Team</th>
              <th style={{width:110}}>Status</th>
              <th style={{width:200}}>TAT vs Target</th>
              <th style={{width:100}}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="6" style={{textAlign:'center',padding:48,color:'var(--ink-muted)'}}>No tasks match the current filter.</td></tr>
            ) : filtered.map(t => {
              const rowCls = t.status === 'bad' ? 'overdue-row' : t.status === 'warn' ? 'risk-row' : 'on-track-row';
              const statusLabel = t.status === 'ok' ? 'On Track' : t.status === 'warn' ? 'At Risk' : 'Overdue';
              const prioLabel = t.priority === 'high' ? 'High' : t.priority === 'med' ? 'Med' : 'Low';
              const pct = Math.min(t.tatHours / t.target, 1.6);
              return (
                <tr key={t.teamId + '-' + t.id} className={rowCls}>
                  <td><span className="mono task-id">{t.id}</span></td>
                  <td>
                    <div className="task-desc-main">{t.desc}</div>
                    <div className="task-client">{t.client}</div>
                  </td>
                  <td>
                    <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:500}}>
                      <span style={{width:8,height:8,borderRadius:2,background:TEAM_COLORS[t.teamName]}}/>
                      {t.teamName}
                    </span>
                  </td>
                  <td><span className={`pill ${t.status}`}><span className="pill-dot"/>{statusLabel}</span></td>
                  <td>
                    <div className="tat-cell">
                      <div className="t"><span className="mono">{t.tatHours.toFixed(1)}h</span><span className="vs">/ {t.target}h</span></div>
                      <div className="tat-bar"><div className={`progress-fill ${t.status}`} style={{width:`${Math.min(pct*100,100)}%`}}/></div>
                    </div>
                  </td>
                  <td>
                    <span className={`priority ${t.priority === 'high' ? 'high' : t.priority === 'med' ? 'med' : 'low'}`}>
                      <span className="dot"/>{prioLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
};

// ===== REPORTS VIEW — ranged history with month picker =====
const ReportsView = ({ teams, history, availableMonths, dimmedTeams, toggleDim }) => {
  // range: '7d' | '30d' | '90d' | { year, month }
  const [range, setRange] = React.useState('30d');

  const slice = React.useMemo(() => {
    if (!history) return null;
    const total = history.dates.length;
    if (typeof range === 'object') {
      const start = history.dates.findIndex(
        d => d.getFullYear() === range.year && d.getMonth() === range.month
      );
      // findLastIndex polyfill
      let end = -1;
      for (let i = total - 1; i >= 0; i--) {
        if (history.dates[i].getFullYear() === range.year && history.dates[i].getMonth() === range.month) {
          end = i; break;
        }
      }
      if (start === -1 || end === -1) return null;
      const slicedDates = history.dates.slice(start, end + 1);
      const slicedByTeam = {};
      for (const [k, v] of Object.entries(history.byTeam)) slicedByTeam[k] = v.slice(start, end + 1);
      return { dates: slicedDates, byTeam: slicedByTeam };
    }
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    // Weekends already excluded by normalizeHistory — just take the last N entries.
    const startIdx = Math.max(0, total - days);
    const slicedDates = history.dates.slice(startIdx);
    const slicedByTeam = {};
    for (const [k, v] of Object.entries(history.byTeam)) slicedByTeam[k] = v.slice(startIdx);
    return { dates: slicedDates, byTeam: slicedByTeam };
  }, [history, range]);

  const months = availableMonths;

  const rangeLabel = (() => {
    if (range === '7d') return 'Last 7 days';
    if (range === '30d') return 'Last 30 days';
    if (range === '90d') return 'Last 90 days';
    const d = new Date(range.year, range.month, 1);
    return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  })();

  const rangeSub = (() => {
    if (!slice || slice.dates.length === 0) return '';
    const first = slice.dates[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const last = slice.dates[slice.dates.length - 1].toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${first} → ${last} · ${slice.dates.length} days`;
  })();

  const tableRows = teams.map(t => {
    const raw = slice && slice.byTeam[t.id] ? slice.byTeam[t.id] : [];
    const arr = raw.filter(v => v != null && !Number.isNaN(v));  // exclude missing data
    if (arr.length === 0) return { team: t, avg: 0, min: 0, max: 0, delta: 0, arr: [] };
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const delta = arr[arr.length - 1] - arr[0];
    return { team: t, avg, min, max, delta, arr };
  });

  const isMonth = typeof range === 'object';
  const activeMonthKey = isMonth ? `${range.year}-${range.month}` : null;

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Reports</div>
          <h1 className="page-title">SLA Trend — {rangeLabel}</h1>
          <div className="page-sub">{rangeSub}</div>
        </div>
      </div>

      <div className="range-controls">
        <div className="filter-group">
          <span className="filter-label">Range</span>
          <div className="seg seg-wide">
            {[['7d','7 days'],['30d','30 days'],['90d','90 days']].map(([v, l]) => (
              <button key={v} className={`seg-btn ${range === v ? 'active' : ''}`}
                onClick={() => setRange(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Month</span>
          <div className="seg seg-wide month-seg">
            {months.map(m => {
              const key = `${m.year}-${m.month}`;
              const label = new Date(m.year, m.month, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
              return (
                <button key={key} className={`seg-btn ${activeMonthKey === key ? 'active' : ''}`}
                  onClick={() => setRange({ year: m.year, month: m.month })}>{label}</button>
              );
            })}
          </div>
        </div>
      </div>

      <section className="trend-card" style={{padding:'24px 28px 20px', overflow:'visible'}}>
        <div className="trend-head">
          <div>
            <h2 className="section-title">Compliance · {rangeLabel}</h2>
            <div className="section-sub">Click a team in the legend to dim its line</div>
          </div>
          <div className="chart-legend">
            {activeTeams(teams, slice?.byTeam || {}).map(t => (
              <span key={t.id} className={`legend-item ${dimmedTeams.has(t.id) ? 'dim' : ''}`} onClick={() => toggleDim(t.id)}>
                <span className="legend-swatch" style={{background:TEAM_COLORS[t.name]}}/>
                {t.name}
              </span>
            ))}
          </div>
        </div>
        {slice ? (
          <HistoryChart teams={teams} slice={slice} dimmed={dimmedTeams}/>
        ) : (
          <div style={{padding:60,textAlign:'center',color:'var(--ink-muted)'}}>No history available for this month.</div>
        )}
      </section>

      <section className="trend-card trend-stats" style={{padding:0,overflow:'hidden',marginTop:0}}>
        <table className="teams-table">
          <thead>
            <tr>
              <th>Team</th>
              <th style={{textAlign:'right'}}>7-day Avg</th>
              <th style={{textAlign:'right'}}>Min</th>
              <th style={{textAlign:'right'}}>Max</th>
              <th style={{textAlign:'right'}}>Δ Mon → Sun</th>
              <th style={{width:200}}>Trajectory</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({team, avg, min, max, delta, arr}) => (
              <tr key={team.id}>
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <span style={{width:8,height:32,borderRadius:2,background:TEAM_COLORS[team.name]}}/>
                    <strong>{team.name}</strong>
                  </div>
                </td>
                <td style={{textAlign:'right'}} className="mono">{avg}%</td>
                <td style={{textAlign:'right'}} className="mono soft">{min}%</td>
                <td style={{textAlign:'right'}} className="mono soft">{max}%</td>
                <td style={{textAlign:'right'}} className={`mono ${delta < 0 ? 'danger-text' : delta > 0 ? 'ok-text' : 'soft'}`}>
                  {delta > 0 ? '+' : ''}{delta}%
                </td>
                <td>
                  {arr.length > 0 && <Sparkline data={arr} color={TEAM_COLORS[team.name]}/>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

// Mini sparkline for reports
const Sparkline = ({ data, color }) => {
  const W = 180, H = 36;
  const min = 55, max = 100;
  const xStep = W / (data.length - 1);
  const yAt = v => H - ((v - min) / (max - min)) * (H - 4) - 2;
  const path = data.map((v, i) => `${i ? 'L' : 'M'}${(i*xStep).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <path d={area} fill={color} opacity="0.1"/>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx={W} cy={yAt(data[data.length-1])} r="2.5" fill={color}/>
    </svg>
  );
};

// ===== ALERTS VIEW — full feed =====
const AlertsView = ({ alerts, onDismiss }) => {
  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warning');

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Operations</div>
          <h1 className="page-title">Active Alerts</h1>
          <div className="page-sub">{alerts.length} alerts · {critical.length} critical, {warning.length} warning</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="trend-card" style={{padding:'48px 24px',textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>✓</div>
          <div style={{fontWeight:600,marginBottom:4}}>All clear</div>
          <div style={{color:'var(--ink-muted)',fontSize:13}}>No active alerts. All teams operating within thresholds.</div>
        </div>
      ) : (
        <div className="alerts-panel" style={{maxWidth:'none'}}>
          <div className="alerts-list">
            {alerts.map(a => (
              <div key={a.id} className={`alert ${a.severity}`}>
                <div className="alert-icon">
                  <Icon name={a.severity === 'critical' ? 'alert-critical' : 'alert-warning'} size={14}/>
                </div>
                <div className="alert-body">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-desc">{a.desc}</div>
                </div>
                <div className="alert-time">{a.time}</div>
                <button className="alert-dismiss" onClick={() => onDismiss(a.id)} aria-label="Dismiss">
                  <Icon name="close" size={12}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
};

// ===== SETTINGS VIEW — configurable SLA targets =====
const SettingsView = ({ teams, settings, onChange }) => {
  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Admin</div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Configurable SLA targets and refresh thresholds</div>
        </div>
      </div>

      <section className="trend-card" style={{padding:'22px 26px'}}>
        <h2 className="section-title" style={{marginBottom:4}}>SLA Targets per Team</h2>
        <div className="section-sub" style={{marginBottom:18}}>Turnaround time target (hours). Saved to So Ezy config on apply.</div>

        <div className="settings-grid">
          {teams.map(t => (
            <div key={t.id} className="setting-row">
              <div className="setting-meta">
                <span style={{width:8,height:24,borderRadius:2,background:TEAM_COLORS[t.name]}}/>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{t.name}</div>
                  <div style={{fontSize:11,color:'var(--ink-muted)',letterSpacing:'0.06em',textTransform:'uppercase'}}>{t.dept}</div>
                </div>
              </div>
              <div className="setting-input">
                <input type="number" min="1" max="48" step="0.5"
                  value={settings.targets[t.id] ?? t.target}
                  onChange={e => onChange('targets', { ...settings.targets, [t.id]: +e.target.value })}/>
                <span className="setting-unit">hours</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="trend-card" style={{padding:'22px 26px'}}>
        <h2 className="section-title" style={{marginBottom:4}}>Refresh & Thresholds</h2>
        <div className="section-sub" style={{marginBottom:18}}>Polling cadence and "at risk" threshold against target SLA.</div>

        <div className="settings-grid two-col">
          <div className="setting-row">
            <div className="setting-meta">
              <Icon name="clock" size={18}/>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>Refresh interval</div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>How often to poll So Ezy</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="1" max="60" value={settings.refreshMin}
                onChange={e => onChange('refreshMin', +e.target.value)}/>
              <span className="setting-unit">minutes</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-meta">
              <Icon name="alerts" size={18}/>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>At Risk threshold</div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>% of target before flagging</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="50" max="100" value={settings.atRiskPct}
                onChange={e => onChange('atRiskPct', +e.target.value)}/>
              <span className="setting-unit">%</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-meta">
              <Icon name="tasks-sm" size={18}/>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>Tasks in drill-down</div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>Top N shown in modal</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="5" max="50" value={settings.modalTaskCount}
                onChange={e => onChange('modalTaskCount', +e.target.value)}/>
              <span className="setting-unit">tasks</span>
            </div>
          </div>
        </div>

        <div style={{marginTop:18,paddingTop:16,borderTop:'1px solid var(--line)',display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button className="btn-secondary">Reset defaults</button>
          <button className="btn-primary">Apply changes</button>
        </div>
      </section>
    </main>
  );
};

export { TeamsView, TasksView, ReportsView, AlertsView, SettingsView };
