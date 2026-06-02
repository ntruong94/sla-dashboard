import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import '../styles.css';
import '../styles-views.css';
import MezyIconDark from './MezyIcon_Dark';
import { getKpiSummary, getTeams, getTasks, getHistory, getAlerts } from './api';
import { Icon } from './components/icons.jsx';
import { KpiTile, TeamCard, AlertsPanel, TaskModal } from './components/components.jsx';
import { TrendChart } from './components/trend.jsx';
import { TeamsView, TasksView, ReportsView, AlertsView, SettingsView } from './components/views.jsx';
import { TEAM_COLORS } from './constants.js';
import { isWeekend, activeTeams, fmtAxisLabel } from './chartUtils.js';
import Mezylogin from './Mezylogin.jsx';

// â”€â”€â”€ Data normalisation helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Format a numeric delta with explicit sign and optional unit
function fmtDelta(val, unit = '') {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val}${unit}`;
}

function normalizeTask(t) {
  const tatH = t.TotalHoursOnTask ?? 0;
  const slaH = t.SLAInHours ?? 4;
  const pct  = slaH > 0 ? tatH / slaH : 0;
  return {
    id:       `T-${t.TaskID}`,
    desc:     t.TaskName       || 'Unnamed Task',
    client:   t.ClientName     || t.AssignedToName || '-',
    status:   t.status         || (pct > 1 ? 'bad' : pct >= 0.875 ? 'warn' : 'ok'),
    tatHours: tatH,
    priority: t.Priority === 'high' ? 'high' : t.Priority === 'med' ? 'med' : 'low',
    target:   slaH,
    teamId:   t.QueueId,
    teamName: t.QueueName,
  };
}

function groupTasksByTeam(rawTasks) {
  const out = {};
  rawTasks.forEach(t => {
    const norm = normalizeTask(t);
    if (!out[norm.teamId]) out[norm.teamId] = [];
    out[norm.teamId].push(norm);
  });
  return out;
}

function normalizeHistory(raw, teams) {
  if (!raw) return null;
  const nameToId = {};
  teams.forEach(t => { nameToId[t.name] = t.id; });
  // Parse as local midnight (not UTC) then exclude weekends at source.
  // All downstream consumers (charts, slices) receive business-days-only data.
  const allDates = raw.dates.map(d => new Date(d + 'T00:00:00'));
  const bizIdx   = allDates.map((d, i) => i).filter(i => !isWeekend(allDates[i]));
  const dates    = bizIdx.map(i => allDates[i]);
  const byTeam   = {};
  for (const [name, arr] of Object.entries(raw.byTeam)) {
    const id = nameToId[name];
    if (id != null) byTeam[id] = bizIdx.map(i => arr[i] ?? null);
  }
  return { dates, byTeam };
}

function getAvailableMonthsFromHistory(history) {
  if (!history || history.dates.length === 0) return [];
  const seen = new Set();
  const out  = [];
  for (const d of history.dates) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!seen.has(key)) { seen.add(key); out.push({ year: d.getFullYear(), month: d.getMonth() }); }
  }
  return out;
}

function build7DayTrend(history) {
  if (!history || history.dates.length === 0) return { dayLabels: [], trendData: {} };
  // Data already has weekends excluded (normalizeHistory). Take the last 7 dates.
  const start = Math.max(0, history.dates.length - 7);
  const dates = history.dates.slice(start);
  const dayLabels = dates.map(d => fmtAxisLabel(d, dates.length));
  const trendData = {};
  for (const [id, arr] of Object.entries(history.byTeam)) {
    trendData[id] = arr.slice(start);
  }
  return { dayLabels, trendData };
}

// â”€â”€â”€ Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NAV_MAIN = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'teams',     label: 'Teams',     icon: 'teams'     },
  { id: 'tasks',     label: 'Tasks',     icon: 'tasks'     },
  { id: 'reports',   label: 'Reports',   icon: 'chart'     },
  { id: 'alerts',    label: 'Alerts',    icon: 'alerts'    },
];

// â”€â”€â”€ Root App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function App() {
  // Auth gate — must be the first hook so it is always called
  const [authed, setAuthed] = useState(() => localStorage.getItem('mezyAuth') === 'true');

  const handleLogin  = useCallback(() => { localStorage.setItem('mezyAuth', 'true');  setAuthed(true);  }, []);
  const handleLogout = useCallback(() => { localStorage.removeItem('mezyAuth');        setAuthed(false); }, []);

  const [view, setView]               = useState('dashboard');
  const [kpi, setKpi]                 = useState({ totalTasks: 0, overallSla: 0, avgTat: 0, totalOverdue: 0, deltas: { totalTasks: 0, overallSla: 0, avgTat: 0, totalOverdue: 0 } });
  const [teams, setTeams]             = useState([]);
  const [tasksByTeam, setTasksByTeam] = useState({});
  const [history, setHistory]         = useState(null);
  const [alerts, setAlerts]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [dimmedTeams, setDimmed]      = useState(new Set());
  const [modalTeamId, setModalTeamId] = useState(null);
  const [settings, setSettings]       = useState({ targets: {}, refreshMin: 5, atRiskPct: 87.5, modalTaskCount: 10 });

  // Watermark — fixed to viewport centre, no parallax
  const watermarkRef = useRef(null);

  // Live AEST clock
  const [now, setNow]                     = useState(new Date());
  const [lastRefresh, setLastRefresh]     = useState(new Date());
  const [justRefreshed, setJustRefreshed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initial data load — history is decoupled (slow cold-scan) and won't block KPI/teams
  useEffect(() => {
    Promise.all([
      getKpiSummary(),
      getTeams(),
      getTasks(),
      getAlerts(),
    ])
      .then(([kpiData, teamsData, tasksData, alertsData]) => {
        setKpi(kpiData);
        setTeams(teamsData);
        setTasksByTeam(groupTasksByTeam(tasksData));
        setAlerts(alertsData);
        setLastRefresh(new Date());
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 800);
        setLoading(false);
        // Load history separately — won't block dashboard if slow or fails
        getHistory('90d')
          .then(historyData => setHistory(normalizeHistory(historyData, teamsData)))
          .catch(err => console.warn('[history] failed to load:', err.message));
      })
      .catch(err => {
        console.error(err);
        setError('Could not connect to backend. Make sure the server is running on port 5000.');
        setLoading(false);
      });
  }, []);

  const toggleDim    = useCallback(id => setDimmed(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  }), []);
  const dismissAlert  = useCallback(id => setAlerts(prev => prev.filter(a => a.id !== id)), []);
  const closeModal    = useCallback(() => setModalTeamId(null), []);
  const changeSettings = useCallback((key, val) => setSettings(prev => ({ ...prev, [key]: val })), []);

  const { dayLabels, trendData }  = useMemo(() => build7DayTrend(history), [history]);
  const availableMonths           = useMemo(() => getAvailableMonthsFromHistory(history), [history]);
  const modalTeam  = teams.find(t => t.id === modalTeamId) ?? null;
  const modalTasks = modalTeam ? (tasksByTeam[modalTeam.id] || []).slice(0, settings.modalTaskCount) : [];

  // AEST time strings
  const timeFmt    = now.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' });
  const dateFmt    = now.toLocaleDateString('en-AU',  { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });
  const refreshFmt = lastRefresh.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' });

  // Auth gate — render login if not authenticated
  if (!authed) return <Mezylogin onLogin={handleLogin} />;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: '#1a1a1a', display: 'grid', placeItems: 'center', fontWeight: 800, color: 'white', fontSize: 18, letterSpacing: '-0.04em' }}>
          M<span style={{ color: '#C8102E' }}>E</span>
        </div>
        <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Connecting to backend...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--bad)' }}>Backend not reachable</div>
        <div style={{ color: 'var(--ink-muted)', fontSize: 13, maxWidth: 400, textAlign: 'center' }}>{error}</div>
        <button style={{ marginTop: 8, padding: '8px 20px', background: 'var(--brand)', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="app">

      {/* â”€â”€ Sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <aside className="sidebar">
        <div className="sidebar-logo" style={{ background: 'transparent', padding: 0, overflow: 'hidden' }}>
          <MezyIconDark compact height={44} style={{ display: 'block' }} />
        </div>

        {NAV_MAIN.map(item => (
          <button key={item.id}
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            title={item.label}
            onClick={() => setView(item.id)}>
            <Icon name={item.icon} size={20}/>
          </button>
        ))}

        <div className="sidebar-spacer"/>

        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          title="Settings" onClick={() => setView('settings')}>
          <Icon name="settings" size={20}/>
        </button>
      </aside>

      {/* â”€â”€ Main column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="main">
        <div ref={watermarkRef} className="watermark" />

        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-brand">
            <MezyIconDark height={28} />
            <div className="divider"/>
          </div>
          <div className="topbar-title">
            <div className="crumb">Operations &middot; So Ezy Integration</div>
            <h1>SLA Performance</h1>
          </div>
          <div className="topbar-spacer"/>
          <div className="live-indicator">
            <span className="live-dot"/> Live Feed
          </div>
          <div className="refresh-stamp">
            <span className="label">Last refresh (AEST)</span>
            <span className="time mono" style={{ opacity: justRefreshed ? 0.5 : 1, transition: 'opacity .3s' }}>
              {refreshFmt} &middot; {dateFmt}
            </span>
          </div>
          <button
            title="Sign out"
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.65)', borderRadius: 8, flexShrink: 0 }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </header>

        {/* â”€â”€ Dashboard view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {view === 'dashboard' && (
          <main className="content">

            {/* KPI strip */}
            <section className="kpi-strip">
              <KpiTile label="Total Active Tasks"  value={kpi.totalTasks}   icon="tasks-sm"
                delta={fmtDelta(kpi.deltas.totalTasks)}
                deltaDir={kpi.deltas.totalTasks > 0 ? 'up' : kpi.deltas.totalTasks < 0 ? 'down' : null}
                accent={null}/>
              <KpiTile label="Overall SLA %"       value={kpi.overallSla.toFixed(2)}   unit="%" icon="pct"
                delta={fmtDelta(kpi.deltas.overallSla, '%')}
                deltaDir={kpi.deltas.overallSla > 0 ? 'up' : kpi.deltas.overallSla < 0 ? 'down' : null}/>
              <KpiTile label="Avg Turnaround"
                value={kpi.avgTat >= 24 ? Math.round((kpi.avgTat / 24) * 10) / 10 : kpi.avgTat}
                unit={kpi.avgTat >= 24 ? ' day/s' : ' hour/s'} icon="clock"
                delta={fmtDelta(kpi.deltas.avgTat, 'h')}
                deltaDir={kpi.deltas.avgTat > 0 ? 'up' : kpi.deltas.avgTat < 0 ? 'down' : null}/>
              <KpiTile label="Overdue / Breached"  value={kpi.totalOverdue} icon="hourglass"
                delta={fmtDelta(kpi.deltas.totalOverdue)}
                deltaDir={kpi.deltas.totalOverdue > 0 ? 'up' : kpi.deltas.totalOverdue < 0 ? 'down' : null}
                accent="bad"/>
            </section>

            {/* Team cards + Alerts */}
            <section className="main-grid">
              <div>
                <div className="section-head">
                  <h2 className="section-title">Team Performance</h2>
                  <span className="section-sub">{teams.length} operational teams &middot; click any card to drill in</span>
                </div>
                <div className="team-grid">
                  {teams.map(t => (
                    <TeamCard key={t.id} team={t} onClick={() => setModalTeamId(t.id)}/>
                  ))}
                </div>
              </div>
              <AlertsPanel alerts={alerts} onDismiss={dismissAlert}/>
            </section>

            {/* Trend chart */}
            {dayLabels.length > 0 && (
              <section className="trend-card">
                <div className="trend-head">
                  <div>
                    <h2 className="section-title">7-Day SLA Compliance Trend</h2>
                    <div className="section-sub">Rolling SLA % per team &middot; hover for detail</div>
                  </div>
                  <div className="chart-legend">
                    {activeTeams(teams, trendData).map(t => (
                      <span key={t.id}
                        className={`legend-item ${dimmedTeams.has(t.id) ? 'dim' : ''}`}
                        onClick={() => toggleDim(t.id)}>
                        <span className="legend-swatch" style={{ background: TEAM_COLORS[t.name] }}/>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
                <TrendChart
                  teams={teams}
                  trendData={trendData}
                  dimmed={dimmedTeams}
                  onLegendClick={toggleDim}
                  dayLabels={dayLabels}
                />
              </section>
            )}
          </main>
        )}

        {/* â”€â”€ Secondary views (each manages its own <main className="content">) â”€â”€ */}
        {view === 'teams'   && <TeamsView teams={teams} onOpenTeam={setModalTeamId}/>}
        {view === 'tasks'   && <TasksView teams={teams} tasks={tasksByTeam}/>}
        {view === 'reports' && (
          <ReportsView
            teams={teams}
            history={history}
            availableMonths={availableMonths}
            dimmedTeams={dimmedTeams}
            toggleDim={toggleDim}
          />
        )}
        {view === 'alerts'   && <AlertsView  alerts={alerts} onDismiss={dismissAlert}/>}
        {view === 'settings' && <SettingsView teams={teams} settings={settings} onChange={changeSettings}/>}
      </div>

      {/* Task drill-down modal */}
      {modalTeam && (
        <TaskModal team={modalTeam} tasks={modalTasks} onClose={closeModal}/>
      )}
    </div>
  );
}

