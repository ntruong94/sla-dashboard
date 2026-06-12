import React from 'react';
import { Icon } from './icons.jsx';
import { HistoryChart } from './history-chart.jsx';
import { AlertsPanel, InfoTip } from './components.jsx';
import { fmtHMS } from './utils.js';
import { TEAM_COLORS, slaClass, slaLabel, TOOLTIPS } from '../constants.js';
import { activeTeams } from '../chartUtils.js';
import { getAdminUsers, approveUser, rejectUser, getStaffDepartments, getStaffByDepartment } from '../api.js';

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
              <th style={{textAlign:'right', width: 100}}>Status<InfoTip text={TOOLTIPS.teams.status}/></th>
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
                  <td style={{textAlign:'right'}}>{t.volume}</td>
                  <td style={{textAlign:'right', fontWeight: 500, color: t.avgTat > t.target ? undefined : 'var(--ink)'}} className={t.avgTat > t.target ? 'danger-text' : ''}>{fmtHMS(t.avgTat)}</td>
                  <td style={{textAlign:'right'}} className="soft">{t.target}h</td>
                  <td style={{textAlign:'right'}} className={t.overdue > 0 ? 'danger-text' : 'soft'}>{t.overdue}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div className="progress" style={{flex:1}}>
                        <div className={`progress-fill ${cls}`} style={{width:`${t.sla}%`}}/>
                      </div>
                      <span style={{width:42,textAlign:'right',fontSize:12,fontWeight:600}}>{t.sla}%</span>
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
                  <td><span className="task-id">{t.id}</span></td>
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
                <td style={{textAlign:'right', fontWeight:500, color:'var(--ink)'}}>{avg}%</td>
                <td style={{textAlign:'right', fontWeight:500, color:'var(--ink)'}}>{min}%</td>
                <td style={{textAlign:'right', fontWeight:500, color:'var(--ink)'}}>{max}%</td>
                <td style={{textAlign:'right'}} className={delta < 0 ? 'danger-text' : delta > 0 ? 'ok-text' : 'soft'}>
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
          <h1 className="page-title">Active Alerts<InfoTip text={TOOLTIPS.alerts.panel} width={280}/></h1>
          <div className="page-sub">{alerts.length} alerts · {critical.length} critical, {warning.length} warning</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="trend-card" style={{padding:'48px 24px',textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>✓</div>
          <div style={{fontWeight:600,marginBottom:4}}>All clear</div>
          <div style={{color:'var(--ink-muted)',fontSize:10}}>No active alerts. All teams operating within thresholds.</div>
        </div>
      ) : (
        <AlertsPanel alerts={alerts} onDismiss={onDismiss}/>
      )}
    </main>
  );
};

// ===== SETTINGS VIEW — configurable SLA targets =====
const SettingsView = ({ teams, settings, onApply, onReset }) => {
  const makeDraft = (s) => ({
    targets:        { ...s.targets },
    refreshMin:     s.refreshMin,
    atRiskPct:      s.atRiskPct,
    modalTaskCount: s.modalTaskCount,
    loanTargets: {
      received: s.loanTargets?.received ?? 10,
      approved: s.loanTargets?.approved ?? 10,
      settled:  s.loanTargets?.settled  ?? 10,
    },
  });

  const [draft, setDraft]           = React.useState(() => makeDraft(settings));
  const [applyStatus, setApplyStatus] = React.useState('idle'); // idle | saving | saved | error
  const [errorMsg, setErrorMsg]     = React.useState('');

  // Re-sync draft when settings change (after Apply or Reset)
  React.useEffect(() => {
    setDraft(makeDraft(settings));
  }, [settings]);

  const setTarget = (id, val) =>
    setDraft(d => ({ ...d, targets: { ...d.targets, [id]: val } }));

  const setLoanTarget = (key, val) =>
    setDraft(d => ({ ...d, loanTargets: { ...d.loanTargets, [key]: val } }));

  const validate = (d) => {
    if (!d.refreshMin || d.refreshMin < 1 || d.refreshMin > 60)
      return 'Refresh interval must be between 1 and 60 minutes.';
    if (!d.atRiskPct || d.atRiskPct < 50 || d.atRiskPct >= 100)
      return 'At Risk threshold must be between 50% and 99%.';
    if (!d.modalTaskCount || d.modalTaskCount < 1 || d.modalTaskCount > 100)
      return 'Tasks in drill-down must be between 1 and 100.';
    for (const [, v] of Object.entries(d.targets)) {
      if (!v || v < 0.5 || v > 168)
        return 'SLA target hours must be between 0.5 and 168.';
    }
    return null;
  };

  const handleApply = () => {
    const err = validate(draft);
    if (err) { setErrorMsg(err); setApplyStatus('error'); return; }
    setApplyStatus('saving');
    setErrorMsg('');
    try {
      onApply({
        targets:        draft.targets,
        refreshMin:     Number(draft.refreshMin),
        atRiskPct:      Number(draft.atRiskPct),
        modalTaskCount: Number(draft.modalTaskCount),
        loanTargets: {
          received: Number(draft.loanTargets.received),
          approved: Number(draft.loanTargets.approved),
          settled:  Number(draft.loanTargets.settled),
        },
      });
      setApplyStatus('saved');
      setTimeout(() => setApplyStatus('idle'), 2500);
    } catch {
      setApplyStatus('error');
      setErrorMsg('Failed to save settings.');
    }
  };

  const handleReset = () => {
    onReset();
    setApplyStatus('idle');
    setErrorMsg('');
  };

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
        <h2 className="section-title" style={{marginBottom:4}}>Loan Targets</h2>
        <div className="section-sub" style={{marginBottom:18}}>Daily application count targets displayed on each loan summary card.</div>

        <div className="settings-grid">
          {[
            { key: 'received', label: 'Application Received', sub: 'Applications received today' },
            { key: 'approved', label: 'Funder Approvals',     sub: 'Funder approvals today'     },
            { key: 'settled',  label: 'Settlements',          sub: 'Settlements today'           },
          ].map(({ key, label, sub }) => (
            <div key={key} className="setting-row">
              <div className="setting-meta">
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{label}</div>
                </div>
              </div>
              <div className="setting-input">
                <input type="number" min="1" max="9999" step="1"
                  value={draft.loanTargets[key]}
                  onChange={e => setLoanTarget(key, +e.target.value)}/>
                <span className="setting-unit">applications</span>
              </div>
            </div>
          ))}
        </div>
      </section>

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
                  <div style={{fontSize:10,color:'var(--ink-muted)',letterSpacing:'0.06em',textTransform:'uppercase'}}>{t.dept}</div>
                </div>
              </div>
              <div className="setting-input">
                <input type="number" min="0.5" max="168" step="0.5"
                  value={draft.targets[t.id] ?? t.target}
                  onChange={e => setTarget(t.id, +e.target.value)}/>
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
                <div style={{fontWeight:600,fontSize:14}}>Refresh interval<InfoTip width={280} text={"How often the dashboard silently fetches fresh data from the database.\n\nNo page reload — all cards update in the background.\n\nWhat refreshes:\n- KPI tiles\n- Team cards\n- Tasks list\n- Alerts\n- Loan summary\n\nWhat does NOT auto-refresh:\n- History chart (only loads on login or Apply)\n\nValid range: 1–60 minutes.\nDefault: 5 minutes."}/></div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>How often to poll So Ezy</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="1" max="60"
                value={draft.refreshMin}
                onChange={e => setDraft(d => ({ ...d, refreshMin: +e.target.value }))}/>
              <span className="setting-unit">minutes</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-meta">
              <Icon name="alerts" size={18}/>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>At Risk threshold<InfoTip width={300} text={"How it works:\nA task turns amber before it breaches SLA.\n\nTask states (consumed = time spent ÷ SLA target):\n- Green — below threshold (on track)\n- Amber — at or above threshold (at risk)\n- Red — above 100% (overdue / breached)\n\nExamples with a 4h SLA target:\n- 50% threshold → amber at 2h, red at 4h\n- 87.5% (default) → amber at 3.5h, red at 4h\n\nApplies to:\n- Task list row colours\n- Alerts panel drill-down\n- Warning alerts per team"}/></div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>% of target before flagging</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="50" max="99"
                value={draft.atRiskPct}
                onChange={e => setDraft(d => ({ ...d, atRiskPct: +e.target.value }))}/>
              <span className="setting-unit">%</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-meta">
              <Icon name="tasks-sm" size={18}/>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>Tasks in drill-down<InfoTip width={260} text={"Max number of tasks shown when you click into a team card or alert.\n\nTasks are ranked by SLA consumption (highest first), so the most critical items appear at the top.\n\nValid range: 1–100.\nDefault: 10."}/></div>
                <div style={{fontSize:12,color:'var(--ink-muted)'}}>Top N shown in modal</div>
              </div>
            </div>
            <div className="setting-input">
              <input type="number" min="1" max="100"
                value={draft.modalTaskCount}
                onChange={e => setDraft(d => ({ ...d, modalTaskCount: +e.target.value }))}/>
              <span className="setting-unit">tasks</span>
            </div>
          </div>
        </div>

        <div style={{marginTop:18,paddingTop:16,borderTop:'1px solid var(--line)',display:'flex',gap:10,justifyContent:'flex-end',alignItems:'center'}}>
          {applyStatus === 'saved' && (
            <span style={{fontSize:14,color:'var(--ok)',fontWeight:500,marginRight:'auto'}}>✓ Settings applied — dashboard updated</span>
          )}
          {applyStatus === 'error' && (
            <span style={{fontSize:14,color:'var(--bad)',fontWeight:500,marginRight:'auto'}}>{errorMsg || 'Invalid values — check inputs'}</span>
          )}
          <button className="btn-secondary" onClick={handleReset} disabled={applyStatus === 'saving'}>Reset defaults</button>
          <button className="btn-primary" onClick={handleApply} disabled={applyStatus === 'saving'}>
            {applyStatus === 'saving' ? 'Applying…' : 'Apply changes'}
          </button>
        </div>
      </section>
    </main>
  );
};

export { TeamsView, TasksView, ReportsView, AlertsView, SettingsView, StaffListView, AdminView };

// ===== STAFF LIST VIEW — department staff counts with drill-through =====
function StaffListView() {
  const [departments, setDepartments] = React.useState([]);
  const [loading, setLoading]         = React.useState(true);
  const [error, setError]             = React.useState('');
  const [search, setSearch]           = React.useState('');
  const [drillDept, setDrillDept]     = React.useState(null); // { deptId, deptName } | null
  const [drillData, setDrillData]     = React.useState({ staff: [], loading: false, error: '' });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(d =>
      String(d.departmentId).includes(q) ||
      (d.departmentName || '').toLowerCase().includes(q)
    );
  }, [departments, search]);

  const load = React.useCallback(() => {
    setLoading(true);
    setError('');
    getStaffDepartments()
      .then(data => { setDepartments(data); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); });
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const openDrill = (dept) => {
    setDrillDept({ deptId: dept.departmentId, deptName: dept.departmentName });
    setDrillData({ staff: [], loading: true, error: '' });
    getStaffByDepartment(dept.departmentId)
      .then(staff => setDrillData({ staff, loading: false, error: '' }))
      .catch(err  => setDrillData({ staff: [], loading: false, error: err.message }));
  };

  const closeDrill = React.useCallback(() => { setDrillDept(null); }, []);

  React.useEffect(() => {
    if (!drillDept) return;
    const onKey = (e) => { if (e.key === 'Escape') closeDrill(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drillDept, closeDrill]);

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Staff List</h1>
          <div className="page-sub">
            {loading
              ? 'Loading…'
              : error
                ? 'Unable to load departments'
                : `There are total ${departments.length} departments in SoEzy`
            }
          </div>
        </div>
        <input
          type="text"
          placeholder="Search department…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', padding: '7px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--ink)', width: 220, outline: 'none' }}
        />
        <button className="btn-secondary" onClick={load} style={{ marginLeft: 10 }}>
          Refresh
        </button>
      </div>

      {loading && (
        <div className="trend-card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
          Loading departments…
        </div>
      )}

      {!loading && error && (
        <div className="trend-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ color: 'var(--bad)', fontWeight: 600, marginBottom: 8 }}>Failed to load</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{error}</div>
        </div>
      )}

      {!loading && !error && (
        <section className="trend-card" style={{ padding: '22px 26px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
              {departments.length === 0 ? 'No departments found' : 'No departments match your search'}
            </div>
          ) : (
            <table className="teams-table">
              <thead>
                <tr>
                  <th>Department ID</th>
                  <th>Department Name</th>
                  <th style={{ textAlign: 'right' }}>Total Staff Count</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.departmentId} onClick={() => openDrill(d)} style={{ cursor: 'pointer' }}>
                    <td><span className="soft">{d.departmentId}</span></td>
                    <td><strong>{d.departmentName || <em className="soft">—</em>}</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{d.totalStaff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Drill-through modal */}
      {drillDept && (
        <div className="modal-overlay" onClick={closeDrill}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="modal-head-top">
                <div className="modal-title">
                  <div className="sub">Staff · {drillDept.deptName}</div>
                  <h2>{drillDept.deptName}</h2>
                  {!drillData.loading && !drillData.error && (
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                      {drillData.staff.length} active staff member{drillData.staff.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                <button className="modal-close" onClick={closeDrill} aria-label="Close">
                  <Icon name="close" size={18}/>
                </button>
              </div>
            </div>

            {drillData.loading && (
              <div style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
                Loading staff…
              </div>
            )}

            {!drillData.loading && drillData.error && (
              <div style={{ padding: '28px', color: 'var(--bad)', fontSize: 14 }}>
                {drillData.error}
              </div>
            )}

            {!drillData.loading && !drillData.error && drillData.staff.length === 0 && (
              <div style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
                No active staff in this department
              </div>
            )}

            {!drillData.loading && !drillData.error && drillData.staff.length > 0 && (
              <div className="modal-body">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Staff ID</th>
                      <th>Full Name</th>
                      <th style={{ textAlign: 'center', width: 150 }}>Employee Status</th>
                      <th style={{ textAlign: 'center', width: 100 }}>IsGroup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillData.staff.map(s => (
                      <tr key={s.staffId}>
                        <td><span className="soft" style={{ fontSize: 12 }}>{s.staffId}</span></td>
                        <td><strong>{s.fullName || '—'}</strong></td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10, background: 'color-mix(in srgb, var(--ok) 18%, transparent)', color: 'var(--ok)' }}>
                            ACTIVE
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
                          {s.isGroup ? 'Yes' : 'No'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ===== ADMIN VIEW — user approval management (admin only) =====
function AdminView() {
  const [users, setUsers]       = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState('');
  const [busy, setBusy]         = React.useState({}); // { [userId]: 'approving' | 'rejecting' }
  const [msgs, setMsgs]         = React.useState({}); // { [userId]: 'approved' | 'rejected' | 'error' }

  const load = React.useCallback(() => {
    setLoading(true);
    setError('');
    getAdminUsers()
      .then(data => { setUsers(data); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); });
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const doApprove = async (id) => {
    setBusy(b => ({ ...b, [id]: 'approving' }));
    try {
      await approveUser(id);
      setMsgs(m => ({ ...m, [id]: 'approved' }));
      setUsers(us => us.map(u => u.id === id ? { ...u, status: 'approved' } : u));
    } catch {
      setMsgs(m => ({ ...m, [id]: 'error' }));
    } finally {
      setBusy(b => ({ ...b, [id]: null }));
    }
  };

  const doReject = async (id) => {
    setBusy(b => ({ ...b, [id]: 'rejecting' }));
    try {
      await rejectUser(id);
      setMsgs(m => ({ ...m, [id]: 'rejected' }));
      setUsers(us => us.map(u => u.id === id ? { ...u, status: 'rejected' } : u));
    } catch {
      setMsgs(m => ({ ...m, [id]: 'error' }));
    } finally {
      setBusy(b => ({ ...b, [id]: null }));
    }
  };

  const STATUS_STYLE = {
    pending:  { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)',  fontWeight: 600 },
    approved: { background: 'color-mix(in srgb, var(--ok)   18%, transparent)', color: 'var(--ok)',   fontWeight: 600 },
    rejected: { background: 'color-mix(in srgb, var(--bad)  18%, transparent)', color: 'var(--bad)',  fontWeight: 600 },
  };

  const pending  = users.filter(u => u.status === 'pending');
  const rest     = users.filter(u => u.status !== 'pending');

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <div className="crumb">Admin</div>
          <h1 className="page-title">User Management</h1>
          <div className="page-sub">Approve or reject dashboard access requests</div>
        </div>
        <button className="btn-secondary" onClick={load} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {loading && (
        <div className="trend-card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
          Loading users…
        </div>
      )}

      {!loading && error && (
        <div className="trend-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ color: 'var(--bad)', fontWeight: 600, marginBottom: 8 }}>Failed to load users</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Pending section */}
          <section className="trend-card" style={{ padding: '22px 26px', marginBottom: 20 }}>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Pending Approval
              {pending.length > 0 && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'color-mix(in srgb, var(--warn) 20%, transparent)', color: 'var(--warn)' }}>
                  {pending.length}
                </span>
              )}
            </h2>
            <div className="section-sub" style={{ marginBottom: 18 }}>Users awaiting review</div>

            {pending.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 14 }}>
                ✓ No pending requests
              </div>
            ) : (
              <table className="teams-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Requested</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(u => (
                    <tr key={u.id}>
                      <td><strong>{u.email}</strong></td>
                      <td>{u.companyName}</td>
                      <td className="soft">{new Date(u.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ ...STATUS_STYLE[u.status], padding: '2px 10px', borderRadius: 10, fontSize: 12, textTransform: 'capitalize' }}>
                          {msgs[u.id] === 'error' ? 'Error' : u.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            className="btn-primary"
                            style={{ padding: '5px 14px', fontSize: 12 }}
                            disabled={!!busy[u.id]}
                            onClick={() => doApprove(u.id)}
                          >
                            {busy[u.id] === 'approving' ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: '5px 14px', fontSize: 12, color: 'var(--bad)', borderColor: 'var(--bad)' }}
                            disabled={!!busy[u.id]}
                            onClick={() => doReject(u.id)}
                          >
                            {busy[u.id] === 'rejecting' ? 'Rejecting…' : 'Reject'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* All users section */}
          {rest.length > 0 && (
            <section className="trend-card" style={{ padding: '22px 26px' }}>
              <h2 className="section-title" style={{ marginBottom: 4 }}>All Users</h2>
              <div className="section-sub" style={{ marginBottom: 18 }}>Approved and rejected accounts</div>
              <table className="teams-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map(u => (
                    <tr key={u.id}>
                      <td><strong>{u.email}</strong></td>
                      <td>{u.companyName}</td>
                      <td><span className="dept-tag">{u.role}</span></td>
                      <td className="soft">{new Date(u.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ ...STATUS_STYLE[u.status], padding: '2px 10px', borderRadius: 10, fontSize: 12, textTransform: 'capitalize' }}>
                          {msgs[u.id] === 'error' ? 'Error' : u.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {u.status !== 'approved' && (
                            <button
                              className="btn-primary"
                              style={{ padding: '5px 14px', fontSize: 12 }}
                              disabled={!!busy[u.id]}
                              onClick={() => doApprove(u.id)}
                            >
                              {busy[u.id] === 'approving' ? 'Approving…' : 'Approve'}
                            </button>
                          )}
                          {u.status !== 'rejected' && u.role !== 'admin' && (
                            <button
                              className="btn-secondary"
                              style={{ padding: '5px 14px', fontSize: 12, color: 'var(--bad)', borderColor: 'var(--bad)' }}
                              disabled={!!busy[u.id]}
                              onClick={() => doReject(u.id)}
                            >
                              {busy[u.id] === 'rejecting' ? 'Rejecting…' : 'Reject'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
