import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import '../styles.css';
import '../styles-views.css';
import MezyIconDark from './MezyIcon_Dark';
import { getKpiSummary, getTeams, getTasks, getHistory, getAlerts, getLoanSummary, getLoanDetail } from './api';
import { Icon } from './components/icons.jsx';
import { KpiTile, TeamCard, AlertsPanel, TaskModal, InfoTip, LoanKpiTile, LoanModal } from './components/components.jsx';
import { TrendChart } from './components/trend.jsx';
import { TeamsView, TasksView, ReportsView, AlertsView, SettingsView, StaffListView, AdminView } from './components/views.jsx';
import { TEAM_COLORS, TOOLTIPS } from './constants.js';
import { isWeekend, activeTeams, fmtAxisLabel } from './chartUtils.js';
import Mezylogin from './Mezylogin.jsx';

// â”€â”€â”€ Data normalisation helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Format a numeric delta with explicit sign and optional unit
function fmtDelta(val, unit = '') {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val}${unit}`;
}

function fmtHMS(hours) {
  const totalSec = Math.round(Math.abs(hours ?? 0) * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const DEFAULT_SETTINGS = { targets: {}, refreshMin: 5, atRiskPct: 87.5, modalTaskCount: 10, loanTargets: { received: 10, approved: 10, settled: 10 } };

function normalizeTask(t, settings = {}) {
  // Use RealtimeTAT (DATEDIFF computed in SQL) when available; fall back to stored TotalHoursOnTask.
  const tatH    = t.RealtimeTAT != null ? t.RealtimeTAT : (t.TotalHoursOnTask ?? 0);
  // Use the team-level SLA target (from Settings, else 4h default).
  // Per-task t.SLAInHours varies by task type and must NOT be used here — it causes
  // the status badge and the progress bar to evaluate against different targets.
  const slaH    = settings.targets?.[t.QueueId] || 4;
  const atRisk  = (settings.atRiskPct ?? 87.5) / 100;
  const pct     = slaH > 0 ? tatH / slaH : 0;
  const status  = pct > 1 ? 'bad' : pct >= atRisk ? 'warn' : 'ok';
  
  // Prefer a real person name; AssignedTo can point at a staff group like "Settlement Team".
  const isLoanStatusTeam = t.QueueId === 5 || t.QueueId === 6;
  const assignedStaffName = (!t.AssignedToIsGroup && t.StaffFullName && t.StaffFullName.trim()) ? t.StaffFullName.trim() : '';
  const createdByName = (!t.CreatedByIsGroup && t.CreatedByFullName && t.CreatedByFullName.trim()) ? t.CreatedByFullName.trim() : '';
  const staffName = assignedStaffName || createdByName || '';
  const loanStatusDetail = [t.TaskName, t.ConfigLoanStatusName].filter(Boolean).join(' / ');
  const desc = isLoanStatusTeam 
    ? (staffName || t.TaskName || 'Unnamed Task')
    : (staffName || t.TaskName || 'Unnamed Task');
  const client = isLoanStatusTeam
    ? (loanStatusDetail || t.ShortDescription || '-')
    : (t.TaskName || t.ClientName || t.AssignedToName || '-');
  
  return {
    id:       `T-${t.TaskID}`,
    appId:    t.ApplicationID ?? null,
    desc,
    client,
    status,
    tatHours: tatH,
    priority: t.Priority === 'high' ? 'high' : t.Priority === 'med' ? 'med' : 'low',
    target:   slaH,
    teamId:   t.QueueId,
    teamName: t.QueueName,
    createDte:      t.CreateDte || null,
    slaAdjustedDte: t.SLAAdjustedDte || null,
  };
}

function groupTasksByTeam(rawTasks, settings = {}) {
  const out = {};
  rawTasks.forEach(t => {
    const norm = normalizeTask(t, settings);
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

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('sla_user') || '{}'); } catch { return {}; }
}

// â”€â”€â”€ Root App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function App() {
  // Auth gate — must be the first hook so it is always called
  const [authed, setAuthed]   = useState(() => !!localStorage.getItem('sla_token'));
  const [userRole, setUserRole] = useState(() => getStoredUser().role || 'viewer');

  const handleLogin  = useCallback((token, user) => {
    localStorage.setItem('sla_token', token);
    localStorage.setItem('sla_user', JSON.stringify(user));
    setUserRole(user.role || 'viewer');
    setError('');
    setLoading(true);
    setAuthed(true);
  }, []);
  const handleLogout = useCallback(() => {
    localStorage.removeItem('sla_token');
    localStorage.removeItem('sla_user');
    setUserRole('viewer');
    setAuthed(false);
  }, []);

  // Listen for forced logout (e.g. token expired mid-session)
  useEffect(() => {
    const onLogout = () => handleLogout();
    window.addEventListener('sla_logout', onLogout);
    return () => window.removeEventListener('sla_logout', onLogout);
  }, [handleLogout]);

  const [view, setView]               = useState('dashboard');
  const [kpi, setKpi]                 = useState({ totalTasks: 0, overallSla: 0, avgTat: 0, totalOverdue: 0, deltas: { totalTasks: 0, overallSla: 0, avgTat: 0, totalOverdue: 0 } });
  const [teams, setTeams]             = useState([]);
  const [rawTasks, setRawTasks]       = useState([]);
  const [modalRawTasks, setModalRawTasks] = useState([]);
  const [history, setHistory]         = useState(null);
  const [alerts, setAlerts]           = useState([]);
  const [loanSummary, setLoanSummary] = useState({ received: { count: 0, amount: 0, deltas: { count: 0, amount: 0 } }, approved: { count: 0, amount: 0, deltas: { count: 0, amount: 0 } }, settled: { count: 0, amount: 0, deltas: { count: 0, amount: 0 } } });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [dimmedTeams, setDimmed]      = useState(new Set());
  const [modalTeamId, setModalTeamId] = useState(null);
  const [loanModal, setLoanModal]     = useState(null); // { type, label } | null
  const [loanDetail, setLoanDetail]   = useState({ data: [], loading: false, error: null });
  const [settings, setSettings]       = useState(() => {
    try {
      const saved = localStorage.getItem('sla_dash_settings');
      if (!saved) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        targets:     { ...DEFAULT_SETTINGS.targets,     ...(parsed.targets     || {}) },
        loanTargets: { ...DEFAULT_SETTINGS.loanTargets, ...(parsed.loanTargets || {}) },
      };
    } catch { return DEFAULT_SETTINGS; }
  });

  // Watermark — fixed to viewport centre, no parallax
  const watermarkRef = useRef(null);
  // Refs for stable values used inside callbacks that must not change on every render
  const settingsRef = useRef(settings);
  const teamsRef    = useRef([]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { teamsRef.current = teams; },    [teams]);

  // Safety-net: always persist settings to localStorage whenever they change.
  // This ensures Apply changes is never the only write path, and that settings
  // survive page refresh, logout/login, and backend restarts.
  useEffect(() => {
    try { localStorage.setItem('sla_dash_settings', JSON.stringify(settings)); } catch (e) {
      console.warn('[settings] Failed to persist to localStorage:', e.message);
    }
  }, [settings]);

  // Live AEST clock
  const [now, setNow]                     = useState(new Date());
  const [lastRefresh, setLastRefresh]     = useState(new Date());
  const [justRefreshed, setJustRefreshed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Shared refresh function — reads targets from settingsRef so the interval
  // always uses the latest configured values without recreating on every settings change.
  const refreshData = useCallback(() => {
    const targets = settingsRef.current?.targets || {};
    Promise.all([
      getKpiSummary(targets),
      getTeams(targets),
      getTasks(),
      getTasks(null, null, 'today'),
      getAlerts(targets),
      getLoanSummary(),
    ])
      .then(([kpiData, teamsData, tasksData, modalTasksData, alertsData, loanData]) => {
        setKpi(kpiData);
        setTeams(teamsData);
        setRawTasks(tasksData);
        setModalRawTasks(modalTasksData);
        setAlerts(alertsData);
        setLoanSummary(loanData);
        setLastRefresh(new Date());
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 800);
      })
      .catch(err => console.warn('[auto-refresh] failed:', err.message));
  }, []);

  // Initial data load — uses saved targets from settingsRef so the first render
  // reflects any user-configured SLA targets, not hardcoded defaults.
  // history is decoupled (slow cold-scan) and won't block KPI/teams.
  useEffect(() => {
    if (!authed) { setLoading(false); return; }
    // Read targets from ref — already initialised with the lazy-loaded settings
    // value so this is always the persisted user config, never the bare default.
    const targets = settingsRef.current?.targets || {};
    Promise.all([
      getKpiSummary(targets),
      getTeams(targets),
      getTasks(),
      getTasks(null, null, 'today'),
      getAlerts(targets),
      getLoanSummary(),
    ])
      .then(([kpiData, teamsData, tasksData, modalTasksData, alertsData, loanData]) => {
        setKpi(kpiData);
        setTeams(teamsData);
        setRawTasks(tasksData);
        setModalRawTasks(modalTasksData);
        setAlerts(alertsData);
        setLoanSummary(loanData);
        setLastRefresh(new Date());
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 800);
        setLoading(false);
        // Load history separately — won't block dashboard if slow or fails
        getHistory('400d', targets)
          .then(historyData => setHistory(normalizeHistory(historyData, teamsData)))
          .catch(err => console.warn('[history] failed to load:', err.message));
      })
      .catch(err => {
        console.error(err);
        setError('Could not connect to backend. Make sure the server is running on port 5000.');
        setLoading(false);
      });
  }, [authed]);

  // Auto-refresh every settings.refreshMin minutes (non-disruptive — no page reload)
  useEffect(() => {
    const ms = (settings.refreshMin || 5) * 60 * 1000;
    const t  = setInterval(refreshData, ms);
    return () => clearInterval(t);
  }, [settings.refreshMin, refreshData]);

  const toggleDim    = useCallback(id => setDimmed(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  }), []);
  const dismissAlert  = useCallback(id => setAlerts(prev => prev.filter(a => a.id !== id)), []);
  const closeModal    = useCallback(() => setModalTeamId(null), []);
  const openLoanModal = useCallback((type, label) => {
    setLoanModal({ type, label });
    setLoanDetail({ data: [], loading: true, error: null });
    getLoanDetail(type)
      .then(data => setLoanDetail({ data, loading: false, error: null }))
      .catch(err  => setLoanDetail({ data: [], loading: false, error: err.message }));
  }, []);
  const closeLoanModal = useCallback(() => setLoanModal(null), []);
  const applySettings = useCallback((newSettings) => {
    try { localStorage.setItem('sla_dash_settings', JSON.stringify(newSettings)); } catch {}
    // Update ref BEFORE setSettings so refreshData reads the new targets immediately
    settingsRef.current = newSettings;
    setSettings(newSettings);
    // Immediately re-fetch all SLA-affected data with the new targets
    const targets = newSettings.targets || {};
    Promise.all([
      getKpiSummary(targets),
      getTeams(targets),
      getTasks(),
      getTasks(null, null, 'today'),
      getAlerts(targets),
      getLoanSummary(),
    ]).then(([kpiData, teamsData, tasksData, modalTasksData, alertsData, loanData]) => {
      setKpi(kpiData);
      setTeams(teamsData);
      setRawTasks(tasksData);
      setModalRawTasks(modalTasksData);
      setAlerts(alertsData);
      setLoanSummary(loanData);
      setLastRefresh(new Date());
    }).catch(err => console.warn('[settings refresh] failed:', err.message));
    // Refresh history with new targets (uses warm cache for non-custom, fresh for custom)
    getHistory('400d', targets)
      .then(historyData => setHistory(normalizeHistory(historyData, teamsRef.current)))
      .catch(err => console.warn('[settings history refresh] failed:', err.message));
  }, []);
  const resetSettings = useCallback(() => {
    // Clear persisted settings first; the safety-net useEffect([settings]) will
    // then write DEFAULT_SETTINGS back, which is identical to having no entry.
    try { localStorage.removeItem('sla_dash_settings'); } catch {}
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const { dayLabels, trendData }  = useMemo(() => build7DayTrend(history), [history]);
  const availableMonths           = useMemo(() => getAvailableMonthsFromHistory(history), [history]);
  // Settings-aware derived state — recomputes automatically when settings or raw data changes
  const tasksByTeam  = useMemo(() => groupTasksByTeam(rawTasks, settings), [rawTasks, settings]);
  const modalTasksByTeam = useMemo(() => groupTasksByTeam(modalRawTasks, settings), [modalRawTasks, settings]);
  const teamsDisplay = useMemo(() => teams.map(team => {
    const customTarget = settings.targets[team.id];
    if (!customTarget) return team;
    // Only override the display target. The backend already received the custom targets
    // and computed overdue/sla correctly in SQL — no client-side recalculation needed.
    return { ...team, target: customTarget };
  }), [teams, settings.targets]);
  const modalTeam  = teamsDisplay.find(t => t.id === modalTeamId) ?? null;
  const modalTaskLimit = modalTeam ? Math.min(settings.modalTaskCount, modalTeam.volume ?? settings.modalTaskCount) : settings.modalTaskCount;
  const modalTasks = modalTeam ? (modalTasksByTeam[modalTeam.id] || []).slice(0, modalTaskLimit) : [];

  // AEST time strings
  const timeFmt    = now.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' });
  const dateFmt    = now.toLocaleDateString('en-AU',  { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });
  const refreshFmt = lastRefresh.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' });
  // Reporting date: the latest data date returned by the backend (kpi.deltas.today).
  // Falls back to local calendar date if KPI data isn't loaded yet.
  const reportingDateFmt = kpi?.deltas?.today
    ? new Date(kpi.deltas.today + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    : dateFmt;

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

        <button className={`nav-item ${view === 'staff-list' ? 'active' : ''}`}
          title="Staff List" onClick={() => setView('staff-list')}>
          <Icon name="staff-list" size={20}/>
        </button>

        {userRole === 'admin' && (
          <button className={`nav-item ${view === 'admin' ? 'active' : ''}`}
            title="User Management" onClick={() => setView('admin')}>
            <Icon name="user-shield" size={20}/>
          </button>
        )}

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
              {refreshFmt} &middot; Data as of {reportingDateFmt}
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

            {/* Loan summary strip */}
            <section className="loan-strip">
              <LoanKpiTile
                label="Application Received"
                count={loanSummary.received.count}
                amount={loanSummary.received.amount}
                countDelta={loanSummary.received.deltas.count}
                amtDelta={loanSummary.received.deltas.amount}
                target={settings.loanTargets?.received ?? 10}
                onClick={() => openLoanModal('received', 'Application Received')}
                tooltip={TOOLTIPS.loan.received}
              />
              <LoanKpiTile
                label="Funder Approvals"
                count={loanSummary.approved.count}
                amount={loanSummary.approved.amount}
                countDelta={loanSummary.approved.deltas.count}
                amtDelta={loanSummary.approved.deltas.amount}
                target={settings.loanTargets?.approved ?? 10}
                onClick={() => openLoanModal('approved', 'Funder Approvals')}
                tooltip={TOOLTIPS.loan.approved}
              />
              <LoanKpiTile
                label="Settlements"
                count={loanSummary.settled.count}
                amount={loanSummary.settled.amount}
                countDelta={loanSummary.settled.deltas.count}
                amtDelta={loanSummary.settled.deltas.amount}
                target={settings.loanTargets?.settled ?? 10}
                onClick={() => openLoanModal('settled', 'Settlements')}
                tooltip={TOOLTIPS.loan.settled}
              />
            </section>

            {/* KPI strip */}
            <section className="kpi-strip">
              <KpiTile label="Total Active Tasks"  value={kpi.totalTasks}   icon="tasks-sm"
                tooltip={TOOLTIPS.kpi.totalTasks} tooltipWidth={270}
                delta={fmtDelta(kpi.deltas.totalTasks)}
                deltaDir={kpi.deltas.totalTasks > 0 ? 'up' : kpi.deltas.totalTasks < 0 ? 'down' : null}
                accent={null}/>
              <KpiTile label="Overall SLA %"       value={kpi.overallSla.toFixed(2)}   unit="%" icon="pct"
                tooltip={TOOLTIPS.kpi.overallSla} tooltipWidth={300}
                delta={fmtDelta(kpi.deltas.overallSla, '%')}
                deltaDir={kpi.deltas.overallSla > 0 ? 'up' : kpi.deltas.overallSla < 0 ? 'down' : null}/>
              <KpiTile label="Avg Turnaround"
                value={fmtHMS(kpi.avgTat)}
                icon="clock"
                tooltip={TOOLTIPS.kpi.avgTat} tooltipWidth={260}
                delta={kpi.deltas.avgTat != null && kpi.deltas.avgTat !== 0 ? `${kpi.deltas.avgTat > 0 ? '+' : '-'}${fmtHMS(kpi.deltas.avgTat)}` : '—'}
                deltaDir={kpi.deltas.avgTat > 0 ? 'up' : kpi.deltas.avgTat < 0 ? 'down' : null}/>
              <KpiTile label="Overdue / Breached"  value={kpi.totalOverdue} icon="hourglass"
                tooltip={TOOLTIPS.kpi.totalOverdue} tooltipWidth={270}
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
                  {teamsDisplay.map(t => (
                    <TeamCard key={t.id} team={t} onClick={() => setModalTeamId(t.id)}/>
                  ))}
                </div>

                {/* Trend chart */}
                {dayLabels.length > 0 && (
                  <section className="trend-card" style={{ marginTop: 12 }}>
                    <div className="trend-head">
                      <div>
                        <h2 className="section-title">7-Day SLA Compliance Trend<InfoTip text={TOOLTIPS.chart.trend} width={280}/></h2>
                        <div className="section-sub">Rolling SLA % per team &middot; hover for detail</div>
                      </div>
                      <div className="chart-legend">
                        {activeTeams(teamsDisplay, trendData).map(t => (
                          <span key={t.id}
                            className={`legend-item ${dimmedTeams.has(t.id) ? 'dim' : ''}`}
                            title="Click to show or hide this team's trend line"
                            onClick={() => toggleDim(t.id)}>
                            <span className="legend-swatch" style={{ background: TEAM_COLORS[t.name] }}/>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <TrendChart
                      teams={teamsDisplay}
                      trendData={trendData}
                      dimmed={dimmedTeams}
                      onLegendClick={toggleDim}
                      dayLabels={dayLabels}
                    />
                  </section>
                )}
              </div>
              <AlertsPanel alerts={alerts} onDismiss={dismissAlert}
                atRiskPct={settings.atRiskPct} maxTasks={settings.modalTaskCount}
                customTargets={settings.targets} enableDrillDown={false}/>
            </section>
          </main>
        )}

        {/* â”€â”€ Secondary views (each manages its own <main className="content">) â”€â”€ */}
        {view === 'teams'   && <TeamsView teams={teamsDisplay} onOpenTeam={setModalTeamId}/>}
        {view === 'tasks'   && <TasksView teams={teamsDisplay} tasks={modalTasksByTeam}/>}
        {view === 'reports' && (
          <ReportsView
            teams={teamsDisplay}
            history={history}
            availableMonths={availableMonths}
            dimmedTeams={dimmedTeams}
            toggleDim={toggleDim}
          />
        )}
        {view === 'alerts'   && <AlertsView  alerts={alerts} onDismiss={dismissAlert}/>}
        {view === 'settings' && <SettingsView teams={teams} settings={settings} onApply={applySettings} onReset={resetSettings}/>}
        {view === 'staff-list' && <StaffListView />}
        {view === 'admin' && userRole === 'admin' && <AdminView />}
      </div>

      {/* Task drill-down modal */}
      {modalTeam && (
        <TaskModal team={modalTeam} tasks={modalTasks} onClose={closeModal} maxTasks={modalTaskLimit}/>
      )}

      {/* Loan drill-down modal */}
      {loanModal && (
        <LoanModal
          label={loanModal.label}
          loans={loanDetail.data}
          loading={loanDetail.loading}
          error={loanDetail.error}
          onClose={closeLoanModal}
        />
      )}
    </div>
  );
}

