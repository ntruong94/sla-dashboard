import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import '../styles.css';
import '../styles-views.css';
import MezyIconDark from './MezyIcon_Dark';
import { getKpiSummary, getTeams, getTasks, getHistory, getAlerts, getLoanSummary, getLoanDetail, getLoanTrend, getUserSettings, putUserSettings, getGlobalSettings, saveGlobalSettings, connectDataStream } from './api';
import { Icon } from './components/icons.jsx';
import { KpiTile, TeamCard, AlertsPanel, TaskModal, InfoTip, LoanKpiTile, LoanModal } from './components/components.jsx';
import { TrendChart } from './components/trend.jsx';
import { TeamsView, TasksView, ReportsView, AlertsView, SettingsView, StaffListView, AdminView } from './components/views.jsx';
import { TEAM_COLORS, TOOLTIPS } from './constants.js';
import { isWeekend, activeTeams, fmtAxisLabel } from './chartUtils.js';
import Mezylogin from './Mezylogin.jsx';

// ─── Data normalisation helpers ───────────────────────────────────────────────

// Format a numeric delta with explicit sign and optional unit.
// Returns null (hidden) when value is 0, null, undefined, or NaN.
function fmtDelta(val, unit = '') {
  if (val === null || val === undefined || isNaN(val) || val === 0) return null;
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

// Per-user localStorage key � isolates each user's settings on shared browsers.
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

// Merge admin-controlled GlobalSettings fields into a settings object.
// Returns a new object (always, for consistent reference check) with global values applied.
function applyGlobalConfig(base, cfg) {
  const patch = {};
  if (cfg.targets     && Object.keys(cfg.targets).length > 0)
    patch.targets     = { ...DEFAULT_SETTINGS.targets,     ...cfg.targets };
  if (cfg.loanTargets && typeof cfg.loanTargets === 'object')
    patch.loanTargets = { ...DEFAULT_SETTINGS.loanTargets, ...cfg.loanTargets };
  if (typeof cfg.atRiskPct      === 'number') patch.atRiskPct      = cfg.atRiskPct;
  if (typeof cfg.refreshMin     === 'number') patch.refreshMin     = cfg.refreshMin;
  if (typeof cfg.modalTaskCount === 'number') patch.modalTaskCount = cfg.modalTaskCount;
  return Object.keys(patch).length > 0 ? { ...base, ...patch } : base;
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
  const adjTs = parseDMYLocal(t.SLAAdjustedDte);
  if (!t.CompletedDte) {
    // Active task � canonical overdue rule (CLAUDE.md �5):
    // Condition B fires regardless of TAT value (including null/0): GETDATE() > SLAAdjustedDate.
    const condB = adjTs != null && Date.now() > adjTs;
    if (tatH == null || tatH === 0) {
      // No TAT � only condition B can make it overdue.
      status = condB ? 'bad' : 'ok';
    } else {
      const taskSlaH = t.SLAInHours != null ? Number(t.SLAInHours) : null;
      const condA_C  = (taskSlaH != null && taskSlaH > 0 && tatH > taskSlaH) || tatH > slaH;
      if (condA_C || condB) { status = 'bad';  }
      else if (pct >= atRisk){ status = 'warn'; }
      else                   { status = 'ok';   }
    }
  } else {
    // Completed task (SLA% badge click drill-through)
    // Overdue: TotalHoursOnTask > SLAInHours (per-task, when non-null), OR DateCompleted > SLAAdjustedDate
    const taskSlaH = t.SLAInHours != null ? Number(t.SLAInHours) : null;
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
    milestoneGroupName: t.MilestoneGroupName ? (t.MilestoneGroupName === 'Approved Loans' ? 'Approved' : t.MilestoneGroupName) : null,
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

// ─── Nav ─────────────────────────────────────────────────────────────────────

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

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  // Auth gate � must be the first hook so it is always called
  const [authed, setAuthed]   = useState(() => !!localStorage.getItem('sla_token'));
  const [userRole, setUserRole] = useState(() => getStoredUser().role || 'viewer');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [settings, setSettings]         = useState(() => loadSettingsFromStorage(getStoredUser().email));
  const [globalTeamConfig, setGlobalTeamConfig] = useState({ hiddenTeams: [], groupOrder: [], targets: {}, loanTargets: DEFAULT_SETTINGS.loanTargets, atRiskPct: DEFAULT_SETTINGS.atRiskPct, version: 0 });

  const handleLogin  = useCallback(async (token, user) => {
    localStorage.setItem('sla_token', token);
    localStorage.setItem('sla_user', JSON.stringify(user));
    setUserRole(user.role || 'viewer');
    setError('');
    // Determine settings for this user:
    // 1. Start with the localStorage cache (fast, synchronous � no flicker).
    // 2. Sync from the DB (source of truth) so cross-device and post-clear scenarios
    //    always restore the last saved config.
    // settingsRef is updated BEFORE setAuthed(true) so the [authed] data-load effect
    // always reads the correct settings on its first run � no race condition.
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
      }
    } catch (e) {
      console.warn('[settings] backend sync failed on login � using local cache:', e.message);
    }
    // Load global team config and merge admin-set targets BEFORE setting settings state.
    // Admin-set SLA targets are global � applied to ALL users regardless of per-user settings.
    // Must complete before setAuthed(true) so the first render uses the correct values.
    let globalCfg = { hiddenTeams: [], groupOrder: [], targets: {}, version: 0 };
    try {
      globalCfg = await getGlobalSettings();
      // One-time migration: if admin has targets saved in UserSettings but they have never
      // been pushed to GlobalSettings (e.g. first login after the global-targets feature was
      // deployed), auto-push them now so all other users see the correct targets immediately.
      if (user.role === 'admin') {
        const hasGlobalTargets = globalCfg.targets && Object.keys(globalCfg.targets).length > 0;
        const hasUserTargets   = loaded.targets    && Object.keys(loaded.targets).length    > 0;
        if (!hasGlobalTargets && hasUserTargets) {
          try {
            // eslint-disable-next-line no-useless-assignment
            globalCfg = await saveGlobalSettings({
              hiddenTeams: globalCfg.hiddenTeams || [],
              groupOrder:  globalCfg.groupOrder  || [],
              targets:     loaded.targets,
              loanTargets: loaded.loanTargets  || DEFAULT_SETTINGS.loanTargets,
              atRiskPct:   typeof loaded.atRiskPct === 'number' ? loaded.atRiskPct : DEFAULT_SETTINGS.atRiskPct,
            });
          } catch { /* migration failure is non-fatal � admin can re-save manually */ }
        }
      }
      globalTeamConfigRef.current = globalCfg;
      setGlobalTeamConfig(globalCfg);
      loaded = applyGlobalConfig(loaded, globalCfg);
    } catch (e) {
      console.warn('[global-config] load failed on login:', e.message);
    }
    // Refresh localStorage cache with the final merged value (user settings + global targets).
    localStorage.setItem(settingsKey(user.email), JSON.stringify(loaded));
    settingsRef.current = loaded;
    setSettings(loaded);
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
  const [dimmedTeams, setDimmed]      = useState(new Set());
  const [modalTeamId, setModalTeamId]       = useState(null);
  const [modalTeamRawTasks, setModalTeamRawTasks] = useState([]);
  const [modalTeamLoading, setModalTeamLoading]   = useState(false);
  const [slaModalTeamId, setSlaModalTeamId] = useState(null);
  const [slaRawTasks, setSlaRawTasks]       = useState([]);
  const [slaTasksLoading, setSlaTasksLoading] = useState(false);
  const [loanModal, setLoanModal]     = useState(null); // { type, label } | null
  const [loanDetail, setLoanDetail]   = useState({ data: [], loading: false, error: null });
  const [loanTrend, setLoanTrend]     = useState([]);

  // Watermark � fixed to viewport centre, no parallax
  const watermarkRef = useRef(null);
  // Refs for stable values used inside callbacks that must not change on every render
  const settingsRef         = useRef(settings);
  const teamsRef            = useRef([]);
  const globalTeamConfigRef = useRef({ hiddenTeams: [], groupOrder: [], targets: {}, version: 0 });
  const userRoleRef         = useRef(userRole);
  const refreshSeqRef       = useRef(0); // incremented on every refresh; stale responses are discarded
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { teamsRef.current = teams; },    [teams]);
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { globalTeamConfigRef.current = globalTeamConfig; }, [globalTeamConfig]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  // Safety-net: always persist settings to the per-user localStorage key whenever
  // they change. Belt-and-suspenders for the explicit writes in applySettings.
  // Never removes the key � only adds/updates. handleLogout does NOT touch any settings key.
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

  // Shared refresh function � reads targets from settingsRef so the interval
  // always uses the latest configured values without recreating on every settings change.
  // refreshSeqRef prevents a slower in-flight response from overwriting a newer one.
  const refreshData = useCallback(() => {
    const seq     = ++refreshSeqRef.current;
    const targets = settingsRef.current?.targets || {};
    Promise.all([
      getKpiSummary(targets),
      getTeams(targets),
      getTasks(null, null, null, targets),
      getTasks(null, null, null, targets),
      getAlerts(targets),
      getLoanSummary(),
    ])
      .then(([kpiData, teamsData, tasksData, modalTasksData, alertsData, loanData]) => {
        if (seq !== refreshSeqRef.current) return; // discard stale concurrent response
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

  // Initial data load � loads global team config (and admin-set targets) FIRST,
  // then fires data requests so they always use the correct targets.
  // history is decoupled (slow cold-scan) and won't block KPI/teams.
  useEffect(() => {
    if (!authed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false); return;
    }
    // Load global config sequentially BEFORE data requests � ensures admin-set targets
    // are applied to settingsRef before the Promise.all fires (no race condition).
    getGlobalSettings()
      .then(cfg => {
        globalTeamConfigRef.current = cfg;
        setGlobalTeamConfig(cfg);
        const merged = applyGlobalConfig(settingsRef.current, cfg);
        settingsRef.current = merged;
        setSettings(merged);
        // Migration: admin already logged in � push their UserSettings targets to
        // GlobalSettings so all viewer sessions receive them via the SSE event.
        if (userRoleRef.current === 'admin' && !(cfg.targets && Object.keys(cfg.targets).length > 0)) {
          const cur = settingsRef.current;
          if (cur?.targets && Object.keys(cur.targets).length > 0) {
            saveGlobalSettings({
              hiddenTeams: cfg.hiddenTeams || [],
              groupOrder:  cfg.groupOrder  || [],
              targets:     cur.targets,
              loanTargets: cur.loanTargets || DEFAULT_SETTINGS.loanTargets,
              atRiskPct:   typeof cur.atRiskPct === 'number' ? cur.atRiskPct : DEFAULT_SETTINGS.atRiskPct,
            }).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        // Fire data requests after global config resolves � settingsRef now has correct targets.
        const targets = settingsRef.current?.targets || {};
        Promise.all([
          getKpiSummary(targets),
          getTeams(targets),
          getTasks(null, null, null, targets),
          getTasks(null, null, null, targets),
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
            // Load history separately � won't block dashboard if slow or fails
            getHistory('400d', targets)
              .then(historyData => setHistory(normalizeHistory(historyData, teamsData)))
              .catch(err => console.warn('[history] failed to load:', err.message));

          })
          .catch(err => {
            console.error(err);
            setError('Could not connect to backend. Make sure the server is running on port 5000.');
            setLoading(false);
          });
      });
  }, [authed]);

  // Auto-refresh every settings.refreshMin minutes � guaranteed fallback if SSE is unavailable.
  useEffect(() => {
    const ms = (settings.refreshMin || 5) * 60 * 1000;
    const t  = setInterval(refreshData, ms);
    return () => clearInterval(t);
  }, [settings.refreshMin, refreshData]);

  // SSE push � server sends "data-changed" when DB fingerprint changes (every 30 s check).
  // Debounced 200 ms to coalesce burst signals. Auto-reconnects on error (5 s backoff).
  // Falls back gracefully to interval polling above if SSE is unavailable.
  useEffect(() => {
    if (!authed) return;
    let es            = null;
    let reconnectTimer = null;
    let debounceTimer  = null;
    let stopped        = false;

    function connect() {
      if (stopped) return;
      es = connectDataStream();
      es.addEventListener('data-changed', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { if (!stopped) refreshData(); }, 200);
      });
      // Admin settings saved � reload GlobalSettings and re-fetch all affected data instantly.
      es.addEventListener('settings-changed', () => {
        if (stopped) return;
        getGlobalSettings()
          .then(cfg => {
            globalTeamConfigRef.current = cfg;
            setGlobalTeamConfig(cfg);
            setSettings(prev => {
              const updated = applyGlobalConfig(prev, cfg);
              settingsRef.current = updated;
              return updated;
            });
            refreshData();
          })
          .catch(() => {});
      });
      es.onerror = () => {
        es.close();
        es = null;
        if (!stopped) reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      if (es) es.close();
    };
  }, [authed, refreshData]);

  // Refresh immediately when the browser tab becomes visible � catches any changes
  // that occurred while the tab was in the background (SSE and polling both paused).
  useEffect(() => {
    if (!authed) return;
    const onVisible = () => { if (document.visibilityState === 'visible') refreshData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [authed, refreshData]);

  // Poll global team config every 15 s � lightweight version check.
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
            // Propagate all admin-set settings to all users immediately.
            setSettings(prev => {
              const updated = applyGlobalConfig(prev, cfg);
              settingsRef.current = updated;
              return updated;
            });
            // Re-fetch data with new settings so all dashboard components update immediately.
            refreshData();
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
  const openModal = useCallback((teamId) => {
    setModalTeamId(teamId);
    setModalTeamRawTasks([]);
    setModalTeamLoading(true);
    getTasks(teamId)
      .then(data => { setModalTeamRawTasks(data); setModalTeamLoading(false); })
      .catch(() => setModalTeamLoading(false));
  }, []);
  const closeModal = useCallback(() => {
    setModalTeamId(null);
    setModalTeamRawTasks([]);
    setModalTeamLoading(false);
  }, []);
  const openLoanModal = useCallback((type, label) => {
    setLoanModal({ type, label });
    setLoanDetail({ data: [], loading: true, error: null });
    setLoanTrend([]);
    getLoanDetail(type)
      .then(data => setLoanDetail({ data, loading: false, error: null }))
      .catch(err  => setLoanDetail({ data: [], loading: false, error: err.message }));
    getLoanTrend(type)
      .then(data => setLoanTrend(data))
      .catch(() => setLoanTrend([]));
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
    try { localStorage.setItem(settingsKey(email), JSON.stringify(newSettings)); } catch { /* localStorage write failure is non-fatal */ }
    // Persist to backend DB (source of truth). Fire-and-forget � never blocks the UI.
    putUserSettings(newSettings).catch(err => console.warn('[settings] backend save failed:', err.message));
    // Update ref BEFORE setSettings so refreshData reads the new targets immediately
    // eslint-disable-next-line react-hooks/immutability
    settingsRef.current = newSettings;
    setSettings(newSettings);
    // Admin: persist all admin-managed settings as global config so ALL sessions
    // update instantly via SSE settings-changed event (no page reload needed).
    if (userRoleRef.current === 'admin') {
      saveGlobalSettings({
        hiddenTeams:    newSettings.hiddenTeams    || [],
        groupOrder:     newSettings.groupOrder     || [],
        targets:        newSettings.targets        || {},
        loanTargets:    newSettings.loanTargets    || DEFAULT_SETTINGS.loanTargets,
        atRiskPct:      typeof newSettings.atRiskPct      === 'number' ? newSettings.atRiskPct      : DEFAULT_SETTINGS.atRiskPct,
        refreshMin:     typeof newSettings.refreshMin     === 'number' ? newSettings.refreshMin     : DEFAULT_SETTINGS.refreshMin,
        modalTaskCount: typeof newSettings.modalTaskCount === 'number' ? newSettings.modalTaskCount : DEFAULT_SETTINGS.modalTaskCount,
      })
        .then(cfg => { globalTeamConfigRef.current = cfg; setGlobalTeamConfig(cfg); })
        .catch(err => console.warn('[global-config] save failed:', err.message));
    }
    // Immediately re-fetch all SLA-affected data with the new targets
    const targets = newSettings.targets || {};
    Promise.all([
      getKpiSummary(targets),
      getTeams(targets),
      getTasks(null, null, null, targets),
      getTasks(null, null, null, targets),
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
    try { localStorage.removeItem(settingsKey(email)); } catch { /* non-fatal */ }
    try { localStorage.removeItem('sla_dash_settings'); } catch { /* non-fatal */ }
    // eslint-disable-next-line react-hooks/immutability
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    // Clear backend settings so the next login also starts from defaults.
    putUserSettings({}).catch(() => {});
    // Admin: also reset global team config (including targets) so all sessions revert to defaults.
    if (userRoleRef.current === 'admin') {
      saveGlobalSettings({ hiddenTeams: [], groupOrder: [], targets: {}, loanTargets: DEFAULT_SETTINGS.loanTargets, atRiskPct: DEFAULT_SETTINGS.atRiskPct, refreshMin: DEFAULT_SETTINGS.refreshMin, modalTaskCount: DEFAULT_SETTINGS.modalTaskCount })
        .then(cfg => { globalTeamConfigRef.current = cfg; setGlobalTeamConfig(cfg); })
        .catch(() => {});
    }
  }, []);

  const { dayLabels, trendData }  = useMemo(() => build7DayTrend(history), [history]);
  const availableMonths           = useMemo(() => getAvailableMonthsFromHistory(history), [history]);
  // Settings-aware derived state � recomputes automatically when settings or raw data changes
  const modalTasksByTeam = useMemo(() => groupTasksByTeam(modalRawTasks, settings), [modalRawTasks, settings]);
  // Filter hidden teams, apply custom targets, then apply saved display order.
  // All downstream views (team cards, charts, tables, task filter, reports) consume
  // teamsDisplay � so hiding/restoring a team propagates immediately everywhere.
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
  // contribute 0 � consistent with summing card values and dividing by card count).
  // When no teams are hidden the backend kpi response is used directly.
  const effectiveKpi = useMemo(() => {
    if (!globalTeamConfig.hiddenTeams?.length) return kpi;
    const vis = teamsDisplay;
    if (!vis.length) return kpi;
    const totalTasks   = vis.reduce((s, t) => s + (t.volume  || 0), 0);
    const totalOverdue = vis.reduce((s, t) => s + (t.overdue || 0), 0);
    const overallSla   = vis.reduce((s, t) => s + (t.sla     || 0), 0) / vis.length;
    const avgTat       = vis.reduce((s, t) => s + (t.avgTat  || 0), 0) / vis.length;
    // Deltas: prev = today - delta (server stores delta = today - prev)
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

  // Alerts scoped to visible teams � hidden teams' alerts are suppressed immediately.
  const visibleAlerts = useMemo(() => {
    const visIds = new Set(teamsDisplay.map(t => t.id));
    const filtered = alerts.filter(a => visIds.has(a.queueId));
    // Sort by the same admin-configured team order as teamsDisplay.
    const orderMap = new Map(teamsDisplay.map((t, i) => [t.id, i]));
    return [...filtered].sort((a, b) =>
      (orderMap.get(a.queueId) ?? Infinity) - (orderMap.get(b.queueId) ?? Infinity)
    );
  }, [alerts, teamsDisplay]);

  // For SettingsView: merge global team config into settings so the admin always
  // initialises the team-order/hidden-teams draft from the live global config.
  // Per-user settings (targets, refreshMin, etc.) are unaffected.
  const adminSettings = useMemo(() => ({
    ...settings,
    hiddenTeams: globalTeamConfig.hiddenTeams || [],
    groupOrder:  globalTeamConfig.groupOrder  || [],
  }), [settings, globalTeamConfig]);

  const modalTeam  = teamsDisplay.find(t => t.id === modalTeamId) ?? null;
  const modalTaskLimit = settings.modalTaskCount;
  // On-demand fetch per team — avoids the global TOP 500 cap cutting tasks with low/zero TAT.
  const modalTasks = useMemo(
    () => modalTeamRawTasks.map(t => normalizeTask(t, settings)).slice(0, modalTaskLimit),
    [modalTeamRawTasks, settings, modalTaskLimit]
  );
  const slaModalTeam  = teamsDisplay.find(t => t.id === slaModalTeamId) ?? null;
  const slaModalTasks = useMemo(() => slaRawTasks.map(t => normalizeTask(t, settings)), [slaRawTasks, settings]);

  // AEST time strings
  const dateFmt    = now.toLocaleDateString('en-AU',  { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' });
  const refreshFmt = lastRefresh.toLocaleTimeString('en-AU', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Sydney' });
  // Reporting date: the latest data date returned by the backend (kpi.deltas.today).
  // Falls back to local calendar date if KPI data isn't loaded yet.
  const reportingDateFmt = kpi?.deltas?.today
    ? new Date(kpi.deltas.today + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    : dateFmt;

  // Auth gate � render login if not authenticated
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

      {/* ── Sidebar ────────────────────────────────────────────── */}
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

      {/* ── Main column ────────────────────────────────────────── */}
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

        {/* ── Dashboard view ──────────────────────────────────── */}
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
                delta={effectiveKpi.deltas.avgTat != null && effectiveKpi.deltas.avgTat !== 0 ? `${effectiveKpi.deltas.avgTat > 0 ? '+' : '-'}${fmtHMS(effectiveKpi.deltas.avgTat)}` : null}
                deltaDir={effectiveKpi.deltas.avgTat > 0 ? 'up' : effectiveKpi.deltas.avgTat < 0 ? 'down' : null}
                deltaInvert/>
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
                    <TeamCard key={t.id} team={t} onClick={() => openModal(t.id)} onSlaClick={() => openSlaModal(t.id)}/>
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

        {/* ── Secondary views (each manages its own <main className="content">) ── */}
        {view === 'teams'   && <TeamsView teams={teamsDisplay} onOpenTeam={openModal}/>}
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
        {view === 'alerts'   && <AlertsView  alerts={visibleAlerts} onDismiss={dismissAlert}
          customTargets={settings.targets} atRiskPct={settings.atRiskPct} maxTasks={settings.modalTaskCount}/>}
        {view === 'settings' && userRole === 'admin' && <SettingsView teams={teams} settings={adminSettings} onApply={applySettings} onReset={resetSettings}/>}
        {view === 'staff-list' && <StaffListView />}
        {view === 'admin' && userRole === 'admin' && <AdminView />}
      </div>

      {/* Task drill-down modal */}
      {modalTeam && (
        <TaskModal team={modalTeam} tasks={modalTasks} onClose={closeModal} maxTasks={modalTaskLimit} loading={modalTeamLoading}/>
      )}

      {/* SLA % completed-task drill-down modal */}
      {slaModalTeam && (
        <TaskModal
          team={slaModalTeam}
          tasks={slaModalTasks}
          onClose={closeSlaModal}
          taskLabel={<><span style={{color:'var(--bad)',fontWeight:700,letterSpacing:'0.05em'}}>COMPLETED</span>{' Tasks � Today'}</>}
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
          trendData={loanTrend}
          onClose={closeLoanModal}
        />
      )}
    </div>
  );
}


