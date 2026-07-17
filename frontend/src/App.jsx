import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import '../styles.css';
import '../styles-views.css';
import MezyIconDark from './MezyIcon_Dark';
import { getKpiSummary, getTeams, getTasks, getHistory, getAlerts, getLoanSummary, getLoanDetail, getUserSettings, putUserSettings, getGlobalSettings, saveGlobalSettings } from './api';
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
  const totalMin = Math.round(Math.abs(hours ?? 0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const DEFAULT_SETTINGS = { targets: {}, refreshMin: 5, atRiskPct: 87.5, modalTaskCount: 50, loanTargets: { received: 10, approved: 10, settled: 10 }, hiddenTeams: [], groupOrder: [] };

// Per-user localStorage key — isolates each user's settings on shared browsers.
// Falls back to the legacy key when email is unavailable (e.g. before first login).
function settingsKey(email) {
  return email ? `sla_dash_settings_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : 'sla_dash_settings';
}

// Load and merge settings from localStorage. Tries the per-user key first,
// then falls back to the legacy single key so existing saved values are not lost.
function loadSettingsFromStorage(email) {
  try {
    const raw = localStorage.getItem(settingsKey(email)) || localStorage.getItem('sla_dash_settings');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      targets:     { ...DEFAULT_SETTINGS.targets,     ...(parsed.targets     || {}) },
      loanTargets: { ...DEFAULT_SETTINGS.loanTargets, ...(parsed.loanTargets || {}) },
    };
  } catch { return DEFAULT_SETTINGS; }
}

function normalizeTask(t, settings = {}) {
  // TAT = TotalHoursOnTask; null = blank display and excluded from all TAT calcs.
  // Target (TAT bar + at-risk warn) = team's configured SLA target from Settings; default 4h.
  const tatH    = t.TotalHoursOnTask ?? null;
  const slaH    = settings.targets?.[t.QueueId] || 4;
  const atRisk  = (settings.atRiskPct ?? 87.5) / 100;
  const pct     = (tatH != null && slaH > 0) ? tatH / slaH : 0;
  const parseDMYLocal = s => { if (!s) return null; const [date, time='00:00:00'] = s.split(' '); const [d,m,y] = date.split('/'); return new Date(`${y}-${m}-${d}T${time}`).getTime(); };
  let status;
  if (tatH == null || tatH === 0) {
    status = 'ok';
  } else if (!t.CompletedDte) {
    // Active task — new canonical overdue rule:
    // Overdue if TotalHoursOnTask > per-task SLAInHours, OR current time > SLAAdjustedDate (when set)
    const taskSlaH = t.SLAInHours != null ? Number(t.SLAInHours) : null;
    const cond1    = taskSlaH != null && taskSlaH > 0 && tatH > taskSlaH;
    const adjTs    = parseDMYLocal(t.SLAAdjustedDte);
    const cond2    = adjTs != null && Date.now() > adjTs;
    if (cond1 || cond2)    { status = 'bad';  }
    else if (pct >= atRisk){ status = 'warn'; }
    else                   { status = 'ok';   }
  } else {
    // Completed task (SLA% badge click drill-through)
    // Overdue: TotalHoursOnTask > SLAInHours (per-task, when non-null), OR DateCompleted > SLAAdjustedDate
    const taskSlaH = t.SLAInHours != null ? Number(t.SLAInHours) : null;
    const adjTs    = parseDMYLocal(t.SLAAdjustedDte);
    const compTs   = parseDMYLocal(t.CompletedDte);
    const cCond1   = tatH != null && taskSlaH != null && taskSlaH > 0 && tatH > taskSlaH;
    const cCond2   = adjTs != null && compTs != null && compTs > adjTs;
    if (cCond1 || cCond2) { status = 'bad'; }
    else                  { status = pct >= atRisk ? 'warn' : 'ok'; }
  }

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
  
  // Completed tasks display TAT: TotalHoursOnTask (primary) or DATEDIFF(SLAAdjustedDate, CompletedDate) (fallback)
  let displayTatH = tatH;
  if (t.CompletedDte && tatH === null && t.SLAAdjustedDte) {
    const adjTsF  = parseDMYLocal(t.SLAAdjustedDte);
    const compTsF = parseDMYLocal(t.CompletedDte);
    if (adjTsF != null && compTsF != null) displayTatH = (compTsF - adjTsF) / 3600000;
  }

  return {
    id:       `T-${t.TaskID}`,
    desc,
    client,
    status,
    tatHours: t.CompletedDte ? displayTatH : tatH,
    priority: t.Priority === 'high' ? 'high' : t.Priority === 'med' ? 'med' : 'low',
    target:   slaH,
    teamId:   t.QueueId,
    teamName: t.QueueName,
    createDte:      t.CreateDte || null,
    slaAdjustedDte: t.SLAAdjustedDte || null,
    completedDte:   t.CompletedDte || null,
    appId:          t.ApplicationID != null ? t.ApplicationID : null,
    taskStatus:     t.TaskStatus || null,
    onHoldHours:    t.TotalHoursOnHold != null ? Math.round(parseFloat(t.TotalHoursOnHold) * 10) / 10 : null,
    onTaskHours:    t.TotalHoursOnTask != null ? Math.round(parseFloat(t.TotalHoursOnTask) * 10) / 10 : null,
    slaInHours:     t.SLAInHours != null ? Number(t.SLAInHours) : null,
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

  const handleLogin  = useCallback(async (token, user) => {
    localStorage.setItem('sla_token', token);
    localStorage.setItem('sla_user', JSON.stringify(user));
    setUserRole(user.role || 'viewer');
    setError('');
    // Determine settings for this user:
    // 1. Start with the localStorage cache (fast, synchronous — no flicker).
    // 2. Sync from the DB (source of truth) so cross-device and post-clear scenarios
    //    always restore the last saved config.
    // settingsRef is updated BEFORE setAuthed(true) so the [authed] data-load effect
    // always reads the correct settings on its first run — no race condition.
    let loaded = loadSettingsFromStorage(user.email);
    try {
      const dbSettings = await getUserSettings();
      if (dbSettings && Object.keys(dbSettings).length > 0) {
        loaded = {
          ...DEFAULT_SETTINGS,
          ...dbSettings,
          targets:     { ...DEFAULT_SETTINGS.targets,     ...(dbSettings.targets     || {}) },
          loanTargets: { ...DEFAULT_SETTINGS.loanTargets, ...(dbSettings.loanTargets || {}) },
        };
        // Refresh localStorage cache with the authoritative DB value.
        localStorage.setItem(settingsKey(user.email), JSON.stringify(loaded));
      }
    } catch (e) {
      console.warn('[settings] backend sync failed on login — using local cache:', e.message);
    }
    settingsRef.current = loaded;
    setSettings(loaded);
    // Load global team config (admin-controlled; applies to ALL users).
    // Must complete before setAuthed(true) so the first render uses the correct team set.
    try {
      const globalCfg = await getGlobalSettings();
      globalTeamConfigRef.current = globalCfg;
      setGlobalTeamConfig(globalCfg);
    } catch (e) {
      console.warn('[global-config] load failed on login:', e.message);
    }
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
  const [loanSummary, setLoanSummary] = useState({ received: { count: 0, amount: 0, deltas: { count: 0, amount: 0 }, deltas5: { count: 0, amount: 0 } }, approved: { count: 0, amount: 0, deltas: { count: 0, amount: 0 }, deltas5: { count: 0, amount: 0 } }, settled: { count: 0, amount: 0, deltas: { count: 0, amount: 0 }, deltas5: { count: 0, amount: 0 } } });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [dimmedTeams, setDimmed]      = useState(new Set());
  const [modalTeamId, setModalTeamId]   = useState(null);
  const [slaModalTeamId, setSlaModalTeamId] = useState(null);
  const [slaRawTasks, setSlaRawTasks]       = useState([]);
  const [slaTasksLoading, setSlaTasksLoading] = useState(false);
  const [loanModal, setLoanModal]     = useState(null); // { type, label } | null
  const [loanDetail, setLoanDetail]   = useState({ data: [], loading: false, error: null });
  const [settings, setSettings]         = useState(() => loadSettingsFromStorage(getStoredUser().email));
  const [globalTeamConfig, setGlobalTeamConfig] = useState({ hiddenTeams: [], groupOrder: [], version: 0 });

  // Watermark — fixed to viewport centre, no parallax
  const watermarkRef = useRef(null);
  // Refs for stable values used inside callbacks that must not change on every render
  const settingsRef         = useRef(settings);
  const teamsRef            = useRef([]);
  const globalTeamConfigRef = useRef({ hiddenTeams: [], groupOrder: [], version: 0 });
  const userRoleRef         = useRef(userRole);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { teamsRef.current = teams; },    [teams]);
  useEffect(() => { globalTeamConfigRef.current = globalTeamConfig; }, [globalTeamConfig]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  // Safety-net: always persist settings to the per-user localStorage key whenever
  // they change. Belt-and-suspenders for the explicit writes in applySettings.
  // Never removes the key — only adds/updates. handleLogout does NOT touch any settings key.
  useEffect(() => {
    const email = getStoredUser().email;
    try { localStorage.setItem(settingsKey(email), JSON.stringify(settings)); } catch (e) {
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
    // Load global team config non-blocking (covers page-refresh-with-existing-token case).
    getGlobalSettings()
      .then(cfg => { globalTeamConfigRef.current = cfg; setGlobalTeamConfig(cfg); })
      .catch(() => {});
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

  // Poll global team config every 15 s — lightweight version check.
  // When admin saves changes the version increments; all sessions recompute
  // teamsDisplay (and derived KPIs/alerts) within 15 s, no page reload needed.
  useEffect(() => {
    if (!authed) return;
    const iv = setInterval(() => {
      getGlobalSettings()
        .then(cfg => {
          if (cfg.version !== globalTeamConfigRef.current.version) {
            globalTeamConfigRef.current = cfg;
            setGlobalTeamConfig(cfg);
          }
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, [authed]);

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
  const openSlaModal  = useCallback((teamId) => {
    setSlaModalTeamId(teamId);
    setSlaRawTasks([]);
    setSlaTasksLoading(true);
    getTasks(teamId, 'completed', 'today')
      .then(data => { setSlaRawTasks(data); setSlaTasksLoading(false); })
      .catch(() => setSlaTasksLoading(false));
  }, []);
  const closeSlaModal = useCallback(() => setSlaModalTeamId(null), []);
  const applySettings = useCallback((newSettings) => {
    const email = getStoredUser().email;
    try { localStorage.setItem(settingsKey(email), JSON.stringify(newSettings)); } catch {}
    // Persist to backend DB (source of truth). Fire-and-forget — never blocks the UI.
    putUserSettings(newSettings).catch(err => console.warn('[settings] backend save failed:', err.message));
    // Update ref BEFORE setSettings so refreshData reads the new targets immediately
    settingsRef.current = newSettings;
    setSettings(newSettings);
    // Admin: persist team order + hidden teams as global config so ALL sessions
    // update within 15 s (polling detects the incremented version).
    if (userRoleRef.current === 'admin') {
      saveGlobalSettings({
        hiddenTeams: newSettings.hiddenTeams || [],
        groupOrder:  newSettings.groupOrder  || [],
      })
        .then(cfg => { globalTeamConfigRef.current = cfg; setGlobalTeamConfig(cfg); })
        .catch(err => console.warn('[global-config] save failed:', err.message));
    }
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
    const email = getStoredUser().email;
    // Remove the per-user key AND the legacy key so all read paths start clean.
    try { localStorage.removeItem(settingsKey(email)); } catch {}
    try { localStorage.removeItem('sla_dash_settings'); } catch {}
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    // Clear backend settings so the next login also starts from defaults.
    putUserSettings({}).catch(() => {});
    // Admin: also reset global team config so all sessions revert to natural order.
    if (userRoleRef.current === 'admin') {
      saveGlobalSettings({ hiddenTeams: [], groupOrder: [] })
        .then(cfg => { globalTeamConfigRef.current = cfg; setGlobalTeamConfig(cfg); })
        .catch(() => {});
    }
  }, []);

  const { dayLabels, trendData }  = useMemo(() => build7DayTrend(history), [history]);
  const availableMonths           = useMemo(() => getAvailableMonthsFromHistory(history), [history]);
  // Settings-aware derived state — recomputes automatically when settings or raw data changes
  const tasksByTeam  = useMemo(() => groupTasksByTeam(rawTasks, settings), [rawTasks, settings]);
  const modalTasksByTeam = useMemo(() => groupTasksByTeam(modalRawTasks, settings), [modalRawTasks, settings]);
  // Filter hidden teams, apply custom targets, then apply saved display order.
  // All downstream views (team cards, charts, tables, task filter, reports) consume
  // teamsDisplay — so hiding/restoring a team propagates immediately everywhere.
  const teamsDisplay = useMemo(() => {
    const hidden = new Set(globalTeamConfig.hiddenTeams || []);
    const display = teams
      .filter(t => !hidden.has(t.name))
      .map(team => {
        const customTarget = settings.targets[team.id];
        return customTarget ? { ...team, target: customTarget } : team;
      });
    const order = globalTeamConfig.groupOrder || [];
    if (!order.length) return display;
    const orderMap = new Map(order.map((name, i) => [name, i]));
    return [...display].sort((a, b) =>
      (orderMap.get(a.name) ?? Infinity) - (orderMap.get(b.name) ?? Infinity)
    );
  }, [teams, settings.targets, globalTeamConfig]);

  // Derive KPI summary from visible teams only when any teams are hidden.
  // Volume-weighted aggregation keeps KPI strip consistent with team cards.
  // When no teams are hidden the backend value (kpi) is used directly.
  // KPI tiles when teams are hidden: simple average of visible team card values,
  // matching exactly what each visible card displays. totalTasks and totalOverdue
  // are sums. TAT includes all visible teams in the denominator (teams showing 0:00
  // contribute 0 — consistent with summing card values and dividing by card count).
  // When no teams are hidden the backend kpi response is used directly.
  const effectiveKpi = useMemo(() => {
    if (!globalTeamConfig.hiddenTeams?.length) return kpi;
    const vis = teamsDisplay;
    if (!vis.length) return kpi;
    const totalTasks   = vis.reduce((s, t) => s + (t.volume  || 0), 0);
    const totalOverdue = vis.reduce((s, t) => s + (t.overdue || 0), 0);
    const overallSla   = vis.reduce((s, t) => s + (t.sla     || 0), 0) / vis.length;
    const avgTat       = vis.reduce((s, t) => s + (t.avgTat  || 0), 0) / vis.length;
    // Deltas: prev = today − delta (server stores delta = today − prev)
    const prevVol     = vis.reduce((s, t) => s + Math.max(0, (t.volume  || 0) - (t.deltas?.volume  || 0)), 0);
    const prevOverdue = vis.reduce((s, t) => s + Math.max(0, (t.overdue || 0) - (t.deltas?.overdue || 0)), 0);
    const prevSla     = vis.reduce((s, t) => s + ((t.sla || 0) - (t.deltas?.sla || 0)), 0) / vis.length;
    const prevTat     = vis.reduce((s, t) => s + Math.max(0, (t.avgTat || 0) - (t.deltas?.avgTat || 0)), 0) / vis.length;
    return {
      totalTasks, overallSla, avgTat, totalOverdue,
      deltas: {
        totalTasks:   totalTasks - prevVol,
        overallSla:   parseFloat((overallSla - prevSla).toFixed(2)),
        avgTat:       avgTat - prevTat,
        totalOverdue: totalOverdue - prevOverdue,
        today:        kpi.deltas?.today,
        prevBizDay:   kpi.deltas?.prevBizDay,
      },
    };
  }, [teamsDisplay, kpi, globalTeamConfig.hiddenTeams]);

  // Alerts scoped to visible teams — hidden teams' alerts are suppressed immediately.
  const visibleAlerts = useMemo(() => {
    if (!globalTeamConfig.hiddenTeams?.length) return alerts;
    const visIds = new Set(teamsDisplay.map(t => t.id));
    return alerts.filter(a => visIds.has(a.queueId));
  }, [alerts, teamsDisplay, globalTeamConfig.hiddenTeams]);

  // For SettingsView: merge global team config into settings so the admin always
  // initialises the team-order/hidden-teams draft from the live global config.
  // Per-user settings (targets, refreshMin, etc.) are unaffected.
  const adminSettings = useMemo(() => ({
    ...settings,
    hiddenTeams: globalTeamConfig.hiddenTeams || [],
    groupOrder:  globalTeamConfig.groupOrder  || [],
  }), [settings, globalTeamConfig]);

  const modalTeam  = teamsDisplay.find(t => t.id === modalTeamId) ?? null;
  const modalTaskLimit = modalTeam ? Math.min(settings.modalTaskCount, modalTeam.volume ?? settings.modalTaskCount) : settings.modalTaskCount;
  const modalTasks = modalTeam ? (modalTasksByTeam[modalTeam.id] || []).slice(0, modalTaskLimit) : [];
  const slaModalTeam  = teamsDisplay.find(t => t.id === slaModalTeamId) ?? null;
  const slaModalTasks = useMemo(() => slaRawTasks.map(t => normalizeTask(t, settings)), [slaRawTasks, settings]);

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

        {userRole === 'admin' && (
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            title="Settings" onClick={() => setView('settings')}>
            <Icon name="settings" size={20}/>
          </button>
        )}
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
                countDelta5={loanSummary.received.deltas5?.count}
                amtDelta5={loanSummary.received.deltas5?.amount}
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
                countDelta5={loanSummary.approved.deltas5?.count}
                amtDelta5={loanSummary.approved.deltas5?.amount}
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
                countDelta5={loanSummary.settled.deltas5?.count}
                amtDelta5={loanSummary.settled.deltas5?.amount}
                target={settings.loanTargets?.settled ?? 10}
                onClick={() => openLoanModal('settled', 'Settlements')}
                tooltip={TOOLTIPS.loan.settled}
              />
            </section>

            {/* KPI strip */}
            <section className="kpi-strip">
              <KpiTile label="Total Active Tasks"  value={effectiveKpi.totalTasks}   icon="tasks-sm"
                tooltip={TOOLTIPS.kpi.totalTasks} tooltipWidth={270}
                delta={fmtDelta(effectiveKpi.deltas.totalTasks)}
                deltaDir={effectiveKpi.deltas.totalTasks > 0 ? 'up' : effectiveKpi.deltas.totalTasks < 0 ? 'down' : null}
                accent={null}/>
              <KpiTile label="Overall SLA% (only Completed tasks)"       value={effectiveKpi.overallSla.toFixed(2)}   unit="%" icon="pct"
                tooltip={TOOLTIPS.kpi.overallSla} tooltipWidth={300}
                delta={fmtDelta(effectiveKpi.deltas.overallSla, '%')}
                deltaDir={effectiveKpi.deltas.overallSla > 0 ? 'up' : effectiveKpi.deltas.overallSla < 0 ? 'down' : null}/>
              <KpiTile label="Avg Turnaround"
                value={fmtHMS(effectiveKpi.avgTat)}
                icon="clock"
                tooltip={TOOLTIPS.kpi.avgTat} tooltipWidth={260}
                delta={effectiveKpi.deltas.avgTat != null && effectiveKpi.deltas.avgTat !== 0 ? `${effectiveKpi.deltas.avgTat > 0 ? '+' : '-'}${fmtHMS(effectiveKpi.deltas.avgTat)}` : '—'}
                deltaDir={effectiveKpi.deltas.avgTat > 0 ? 'up' : effectiveKpi.deltas.avgTat < 0 ? 'down' : null}/>
              <KpiTile label="Overdue (only Active tasks)"  value={effectiveKpi.totalOverdue} icon="hourglass"
                tooltip={TOOLTIPS.kpi.totalOverdue} tooltipWidth={270}
                delta={fmtDelta(effectiveKpi.deltas.totalOverdue)}
                deltaDir={effectiveKpi.deltas.totalOverdue > 0 ? 'up' : effectiveKpi.deltas.totalOverdue < 0 ? 'down' : null}
                accent="bad"/>
            </section>

            {/* Team cards + Alerts */}
            <section className="main-grid">
              <div>
                <div className="section-head">
                  <h2 className="section-title">Team Performance</h2>
                  <span className="section-sub">{teamsDisplay.length} operational teams &middot; click any card to drill in</span>
                </div>
                <div className="team-grid">
                  {teamsDisplay.map(t => (
                    <TeamCard key={t.id} team={t} onClick={() => setModalTeamId(t.id)} onSlaClick={() => openSlaModal(t.id)}/>
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
              <AlertsPanel alerts={visibleAlerts} onDismiss={dismissAlert}
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
        {view === 'alerts'   && <AlertsView  alerts={visibleAlerts} onDismiss={dismissAlert}/>}
        {view === 'settings' && userRole === 'admin' && <SettingsView teams={teams} settings={adminSettings} onApply={applySettings} onReset={resetSettings}/>}
        {view === 'staff-list' && <StaffListView />}
        {view === 'admin' && userRole === 'admin' && <AdminView />}
      </div>

      {/* Task drill-down modal */}
      {modalTeam && (
        <TaskModal team={modalTeam} tasks={modalTasks} onClose={closeModal} maxTasks={modalTaskLimit}/>
      )}

      {/* SLA % completed-task drill-down modal */}
      {slaModalTeam && (
        <TaskModal
          team={slaModalTeam}
          tasks={slaModalTasks}
          onClose={closeSlaModal}
          taskLabel={<><span style={{color:'var(--bad)',fontWeight:700,letterSpacing:'0.05em'}}>COMPLETED</span>{' Tasks — Today'}</>}
          loading={slaTasksLoading}
          completedMode={true}
        />
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

