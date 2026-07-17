const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
require('dotenv').config();

// Safety net: log but don't crash on unhandled rejections or uncaught exceptions
// (e.g. SQL timeout errors emitted outside of a promise chain during cache warm-up).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
const { sql, connectDB } = require('./db');
const mock = require('./mock-data');

// Production / development mode toggle (drives error verbosity)
const IS_PROD = process.env.NODE_ENV === 'production';

// Generic error responder (CLAUDE.md Section 25 RULE 3).
// In production: return only a generic message; never leak err.message,
// stack traces, file paths, DB names, or table names.
// In development: return err.message to aid debugging.
function sendError(res, status, publicMessage, err) {
  if (err) console.error(`[error] ${publicMessage}:`, err);
  if (IS_PROD) return res.status(status).json({ error: publicMessage });
  return res.status(status).json({ error: err?.message || publicMessage });
}

// --- Team definitions ---------------------------------------------------------
// 9 teams. Primary identification: ConfigTasks.UsedForKPI = 1 AND SpecifiedKPIGrp LIKE '...'
// Fallback (dept-based teams only): Staff.DepartmentId = N AND Staff.EmployeeStatus = 1
// Teams 5 (CLA), 6 (Funder Submission), 7 (Funder MIR) have no dept fallback � count 0 if no KPI match.

// --- Effective reporting date -----------------------------------------------
// The dashboard operates against a reporting DB refreshed nightly from the live
// server.  ALL business calculations use the LATEST available date in that DB,
// not the real system calendar date.
//
// _effectiveDate is resolved at startup (and every 60 min) by querying
// MAX(DateCreated) from Tasks.  Falls back to system today if the query fails.
let _effectiveDate = null;

// Real system clock (YYYY-MM-DD local). Used ONLY inside getNowSql().
function systemTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Effective reporting date for all business calculations.
// Falls back to real system date until resolveEffectiveDate() completes.
function todayLocal() {
  return _effectiveDate || systemTodayLocal();
}

// Query MAX(DateCreated) from Tasks and cache as _effectiveDate.
// Refreshed every 60 min so the date advances when the DB refreshes.
async function resolveEffectiveDate() {
  try {
    const pool   = await connectDB();
    const result = await pool.request().query(
      `SELECT CONVERT(varchar(10), MAX(DateCreated), 120) AS maxDate
       FROM Tasks WITH (NOLOCK) WHERE DateCreated IS NOT NULL`
    );
    const maxDate = result.recordset[0]?.maxDate;
    if (maxDate) {
      _effectiveDate = maxDate;
      console.log(`[reporting date] effective date: ${_effectiveDate}`);
    } else {
      _effectiveDate = systemTodayLocal();
      console.log('[reporting date] no task data, using system date: ' + _effectiveDate);
    }
  } catch (err) {
    if (!_effectiveDate) _effectiveDate = systemTodayLocal();
    console.warn('[reporting date] resolution failed, keeping:', _effectiveDate, err.message);
  }
}
function prevBizDay(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = dow === 1 ? -3 : dow === 0 ? -2 : -1; // Mon?Fri, Sun?Fri, else -1
  d.setDate(d.getDate() + offset);
  // Use local date parts ? toISOString() would return UTC and lose a day in AEST
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function nextDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Compute all 4 date strings fresh on each call (handles midnight/day rollovers)
function nBizDaysBack(dateStr, n) {
  let d = dateStr;
  for (let i = 0; i < n; i++) d = prevBizDay(d);
  return d;
}
function computeDates() {
  const today = todayLocal();
  const prev  = prevBizDay(today);
  const prev5 = nBizDaysBack(today, 5);
  return { today, prev, todayNext: nextDay(today), prevNext: nextDay(prev), prev5, prev5Next: nextDay(prev5) };
}

// Grouping priority (source of truth � see CLAUDE.md Section 6):
//   Rule 1 (PRIORITY): Tasks with ct.UsedForKPI = 1 AND non-empty ct.SpecifiedKPIGrp
//           are grouped by SpecifiedKPIGrp (static team patterns + dynamic teams).
//   Rule 2 (FALLBACK): Tasks with ct.UsedForKPI IS NULL AND ct.SpecifiedKPIGrp IS NULL/empty
//           fall back to s.DepartmentId, requiring s.EmployeeStatus = 1.
// Rule 1 and Rule 2 are mutually exclusive by design (no double counting).
// Tasks that satisfy neither rule (e.g. UsedForKPI=1 with kpiGrp not matching any team,
// or UsedForKPI IS NULL with a non-null kpiGrp) are excluded entirely.
// Grouping priority (source of truth):
//   Rule 1 (PRIORITY): Tasks with ct.UsedForKPI = 1 AND non-empty ct.SpecifiedKPIGrp
//           are grouped by exact SpecifiedKPIGrp value (KPI teams).
//   Rule 2 (FALLBACK): Tasks with ct.UsedForKPI IS NULL AND ct.SpecifiedKPIGrp IS NULL/empty
//           fall back to s.DepartmentId, requiring s.EmployeeStatus = 1 (Dept teams).
// Rule 1 and Rule 2 are mutually exclusive by design (no double counting).
const _NULL_KPIGRP     = `(ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'')`;
const _NONEMPTY_KPIGRP = `(ct.SpecifiedKPIGrp IS NOT NULL AND LTRIM(RTRIM(ct.SpecifiedKPIGrp)) <> N'')`;
const _RULE1_MATCH = `(ct.UsedForKPI = 1 AND ${_NONEMPTY_KPIGRP})`;
const _RULE2_MATCH = `(ct.UsedForKPI IS NULL AND ${_NULL_KPIGRP})`;
// SQL JOIN required to access ConfigTasks.UsedForKPI and ConfigTasks.SpecifiedKPIGrp.
const CONFIG_TASKS_JOIN = `
      LEFT JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId`;

// _allTeams: populated by refreshAllTeams() at startup and every 60 s.
// Contains both KPI teams (isKpi:true) and Dept teams (isDept:true).
let _allTeams = [];

// Returns the dynamic TEAM_FILTER SQL condition built from current _allTeams.
// Must be called as a function (not a constant) because dept IDs are discovered at runtime.
function getTeamFilter() {
  const deptIds = _allTeams.filter(t => t.isDept).map(t => t.fallbackDeptId).join(', ');
  if (!deptIds) return _RULE1_MATCH;
  return `(${_RULE1_MATCH} OR (${_RULE2_MATCH} AND s.DepartmentId IN (${deptIds}) AND s.EmployeeStatus = 1))`;
}

// Stable integer id for a KPI team derived from its SpecifiedKPIGrp name.
// Mapped to [1000, 8999] so saved SLA targets persist when groups are added/removed.
function nameToTeamId(name) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  return (h >>> 0) % 8000 + 1000;
}

// Global team configuration (hiddenTeams + groupOrder) — written by admin via
// PUT /api/admin/settings, read by all authenticated users via GET /api/settings.
// Stored in ConfigDashboards.GlobalSettings (added by startup auto-migration).
// version counter lets frontend polling detect changes without full diffs.
let _globalTeamConfig = { hiddenTeams: [], groupOrder: [], version: 0 };

async function loadGlobalTeamConfig() {
  try {
    const pool   = await connectDB();
    const result = await pool.request()
      .input('id', sql.Int, SLA_DASHBOARD_ID)
      .query('SELECT GlobalSettings FROM ConfigDashboards WHERE DashboardID = @id');
    const json = result.recordset[0]?.GlobalSettings;
    if (json) {
      const saved = JSON.parse(json);
      _globalTeamConfig = {
        hiddenTeams: Array.isArray(saved.hiddenTeams) ? saved.hiddenTeams : [],
        groupOrder:  Array.isArray(saved.groupOrder)  ? saved.groupOrder  : [],
        version:     typeof saved.version === 'number' ? saved.version    : 0,
      };
      console.log('[global-config] loaded team config (v' + _globalTeamConfig.version + ')');
    }
  } catch (err) {
    console.warn('[global-config] load failed:', err.message);
  }
}

async function saveGlobalTeamConfigToDB() {
  try {
    const pool = await connectDB();
    await pool.request()
      .input('id',   sql.Int,              SLA_DASHBOARD_ID)
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(_globalTeamConfig))
      .query('UPDATE ConfigDashboards SET GlobalSettings = @json WHERE DashboardID = @id');
  } catch (err) {
    console.warn('[global-config] save failed:', err.message);
  }
}

// Build SQL NOT conditions to exclude all 9 known team patterns from discovery query.
// Queries DB for ALL KPI groups (ConfigTasks.UsedForKPI=1) and ALL departments
// with active staff. Both are surfaced in Settings so admins configure targets,
// order, and visibility without any code change. Called at startup and every 60 s.
async function refreshAllTeams() {
  try {
    const pool = await connectDB();
    const [kpiRes, deptRes] = await Promise.all([
      pool.request().query(`
        SELECT DISTINCT LTRIM(RTRIM(ct.SpecifiedKPIGrp)) AS grpName
        FROM ConfigTasks ct WITH (NOLOCK)
        WHERE ct.UsedForKPI = 1
          AND ct.SpecifiedKPIGrp IS NOT NULL
          AND LTRIM(RTRIM(ct.SpecifiedKPIGrp)) <> N''
        ORDER BY LTRIM(RTRIM(ct.SpecifiedKPIGrp))
      `),
      pool.request().query(`
        SELECT s.DepartmentId, MAX(d.Name) AS DeptName
        FROM Staff s WITH (NOLOCK)
        LEFT JOIN Department d WITH (NOLOCK) ON d.DepartmentId = s.DepartmentId
        WHERE s.EmployeeStatus = 1 AND s.DepartmentId IS NOT NULL
        GROUP BY s.DepartmentId
        ORDER BY MAX(d.Name)
      `),
    ]);

    // KPI teams: exact SpecifiedKPIGrp match; stable hash ID (1000-8999).
    const kpiTeams = (kpiRes.recordset || []).map(r => {
      const name = r.grpName.trim();
      return {
        id:            nameToTeamId(name),
        name,
        dept:          'KPI Group',
        target:        4,
        kpiGrp:        `LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'${name.replace(/'/g, "''")}'`,
        fallbackDeptId: null,
        isKpi:         true,
      };
    });

    // Dept teams: DepartmentId fallback for untagged tasks; ID = DeptId + 10000.
    const deptTeams = (deptRes.recordset || []).map(r => {
      const name = (r.DeptName || `Dept ${r.DepartmentId}`).trim();
      return {
        id:            r.DepartmentId + 10000,
        name,
        dept:          'Department',
        target:        4,
        kpiGrp:        null,
        fallbackDeptId: r.DepartmentId,
        isDept:        true,
      };
    });

    const newTeams = [...kpiTeams, ...deptTeams];
    const oldSig   = _allTeams.map(t => `${t.id}:${t.name}`).join('|');
    const newSig   = newTeams.map(t => `${t.id}:${t.name}`).join('|');
    const changed  = oldSig !== newSig;
    _allTeams = newTeams;

    if (changed) {
      console.log(`[teams] refreshed: ${kpiTeams.length} KPI group(s) [${kpiTeams.map(t => t.name).join(', ')}], ${deptTeams.length} department(s)`);
      _cache.teams.data = null;
      _cache.teams.ts   = 0;
    }
  } catch (err) {
    console.error('[teams] refresh failed:', err.message);
    // Keep previous _allTeams on error — do not reset
  }
}

// Returns all teams discovered from the DB (KPI groups + departments).
function getAllTeams() { return _allTeams; }

// Build SQL CASE for team id.
// Rule 1 (KPI teams):  UsedForKPI=1 AND exact SpecifiedKPIGrp match.
// Rule 2 (Dept teams): untagged tasks routed by active staff DepartmentId.
function getTeamIdCase() {
  const cases = [
    ..._allTeams
      .filter(t => t.isKpi)
      .map(t => `WHEN ${_RULE1_MATCH} AND ${t.kpiGrp} THEN ${t.id}`),
    ..._allTeams
      .filter(t => t.isDept)
      .map(t => `WHEN ${_RULE2_MATCH} AND s.DepartmentId = ${t.fallbackDeptId} AND s.EmployeeStatus = 1 THEN ${t.id}`),
  ];
  return cases.length ? cases.join(' ') : 'WHEN 1=0 THEN NULL';
}

// Build SQL CASE for team name.
function getTeamNameCase() {
  const cases = [
    ..._allTeams
      .filter(t => t.isKpi)
      .map(t => `WHEN ${_RULE1_MATCH} AND ${t.kpiGrp} THEN N'${t.name.replace(/'/g, "''")}'`),
    ..._allTeams
      .filter(t => t.isDept)
      .map(t => `WHEN ${_RULE2_MATCH} AND s.DepartmentId = ${t.fallbackDeptId} AND s.EmployeeStatus = 1 THEN N'${t.name.replace(/'/g, "''")}'`),
  ];
  return cases.length ? cases.join(' ') : 'WHEN 1=0 THEN NULL';
}

// Simpler CASE for ConfigTasks queries (no Staff join needed).
// KPI teams only — returns teamId for each ConfigTask whose SpecifiedKPIGrp matches.
// Used by fetchTeamsData Q4 to build task-code lists shown in team card tooltips.
function getTeamIdCaseForConfigTasks() {
  const cases = _allTeams
    .filter(t => t.isKpi)
    .map(t => `WHEN ${t.kpiGrp} THEN ${t.id}`);
  return cases.length ? cases.join(' ') : 'WHEN 1=0 THEN NULL';
}

// --- Custom-target helpers ----------------------------------------------------
// Parse ?t1=2&t2=4&t3=4&t4=4&t5=4&t6=4 into { 1: 2.0, 2: 4.0, ... }
// Includes dynamic team IDs (100+) so custom targets work for dynamic groups too.
function parseTargets(query) {
  const out = {};
  getAllTeams().forEach(team => {
    const val = parseFloat(query[`t${team.id}`]);
    if (val > 0) out[team.id] = val;
  });
  return out;
}
// Build a SQL CASE expression that returns the custom target hours for each team,
// falling back to t.SLAInHours for teams without a custom target configured.
function buildTargetExpr(customTargets) {
  if (!customTargets || Object.keys(customTargets).length === 0) return 't.SLAInHours';
  const cases = [];
  for (const team of _allTeams) {
    const h = customTargets[team.id];
    if (!h) continue;
    if (team.isKpi) {
      cases.push(`WHEN ${_RULE1_MATCH} AND ${team.kpiGrp} THEN ${h}`);
    } else if (team.isDept) {
      cases.push(`WHEN ${_RULE2_MATCH} AND s.DepartmentId = ${team.fallbackDeptId} AND s.EmployeeStatus = 1 THEN ${h}`);
    }
  }
  if (cases.length === 0) return 't.SLAInHours';
  return `CASE ${cases.join(' ')} ELSE t.SLAInHours END`;
}

// --- TAT SQL expression helper -----------------------------------------------
// Snapshot/reporting mode (effective date < system today):
//   CAST('<effective+1>' AS DATETIME) measures TAT within the reporting day.
// Live mode (effective date = system today): GETDATE() gives real-time TAT.
function getNowSql() {
  const effective = todayLocal();
  const sysToday  = systemTodayLocal();
  return effective < sysToday
    ? `CAST('${nextDay(effective)}' AS DATETIME)`
    : 'GETDATE()';
}
// Set to true to serve mock data without a DB connection.
// Switch to false once SQL Server TCP/IP is enabled (see db-health endpoint).
const USE_MOCK = false;

// --- In-memory response cache -------------------------------------------------
// Stale-while-revalidate: serve cached data immediately, refresh in background.
// On first server start (cold DB), the first request waits for the initial fetch.
// Cache is pre-warmed at startup so users never hit the cold 100+ second scan.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _cache = {
  kpi:     { data: null, ts: 0, pending: null },
  teams:   { data: null, ts: 0, pending: null },
  history: { data: null, ts: 0, pending: null },
};

function getCached(key, fetchFn) {
  if (!_cache[key]) _cache[key] = { data: null, ts: 0, pending: null };
  const c = _cache[key];
  const stale = !c.data || (Date.now() - c.ts >= CACHE_TTL_MS);
  if (stale && !c.pending) {
    const hadData = !!c.data;
    const p = fetchFn()
      .then(data => { c.data = data; c.ts = Date.now(); return data; })
      .catch(err  => { console.error(`[cache ${key} refresh failed]`, err.message); throw err; })
      .finally(()  => { c.pending = null; });
    c.pending = p;
    // Background SWR refresh has no awaiter � swallow to prevent unhandled rejection killing the process.
    if (hadData) p.catch(() => {});
  }
  if (c.data)    return Promise.resolve(c.data); // serve stale while refreshing
  if (c.pending) return c.pending;               // wait for first load
  return Promise.reject(new Error(`[cache ${key}] no data and no pending fetch`));
}

async function fetchKpiData(customTargets = {}, visibleTeamIds = null) {
  const NOW_SQL = getNowSql();
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const targetExpr = buildTargetExpr(customTargets);
  // When specific teams are visible (others hidden), restrict both queries to those team IDs only.
  const teamIdFilter = visibleTeamIds && visibleTeamIds.length > 0
    ? `AND (CASE ${getTeamIdCase()} END) IN (${visibleTeamIds.join(',')})`
    : '';

  // Two parallel queries:
  // Q1: totalTasks, avgTat, totalOverdue ? active/all tasks, filtered by DateCreated.
  //     TAT for open tasks = GETDATE() - DateCreated (real-time elapsed).
  //     TAT for closed tasks = DateCompleted - DateCreated.
  // Q2: overallSla ? completed tasks (status=2), filtered by DateCompleted.
  //     SLA compliance = DATEDIFF(DateCreated, DateCompleted) <= configured target.
  const [mainRes, slaRes] = await Promise.all([
    pool.request().query(`
      SELECT
        -- volume = active tasks created today
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 THEN 1 ELSE 0 END)                                              AS totalTasks,
        -- overdue = open tasks where TotalHoursOnTask > 0 AND (TotalHoursOnTask > SLAInHours OR GETDATE() > SLAAdjustedDate)
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 AND t.TotalHoursOnTask > 0
                 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END)                                              AS totalOverdue,
        -- avgTat = mean TotalHoursOnTask for active tasks created today (NULL/zero excluded)
        AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1,4,5,6)
                 AND t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0
                 THEN t.TotalHoursOnTask ELSE NULL END)                           AS avgTat,
        -- prev biz day equivalents for deltas
        SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 THEN 1 ELSE 0 END)                                              AS prevTasks,
        SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 AND t.TotalHoursOnTask > 0
                 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END)                                              AS prevOverdue,
        AVG(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TaskStatusID IN (1,4,5,6)
                 AND t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0
                 THEN t.TotalHoursOnTask ELSE NULL END)                           AS prevTat
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${getTeamFilter()}
        ${teamIdFilter}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
    `),
    // SLA% uses DateCompleted ? completed tasks regardless of when they were created.
    // Compliance uses a combined OR rule (count once):
    //   (closed-task TAT <= targetExpr) OR (DateCompleted <= SLAAdjustedDate when SLAAdjustedDate exists).
    // targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
    pool.request().query(`
      SELECT
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                   AND (
                     DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                     OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                   )
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS overallSla,
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                   AND (
                     DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                     OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                   )
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS prevSla
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID = 2
        AND ${getTeamFilter()}
        ${teamIdFilter}
        AND t.DateCompleted >= '${prev}' AND t.DateCompleted < '${todayNext}'
    `),
  ]);

  const r   = mainRes.recordset[0];
  const sla = slaRes.recordset[0];
  return {
    totalTasks:   r.totalTasks   || 0,
    overallSla:   parseFloat((sla.overallSla || 0).toFixed(2)),
    avgTat:       r.avgTat != null ? r.avgTat : 0,
    totalOverdue: r.totalOverdue || 0,
    deltas: {
      totalTasks:   (r.totalTasks   || 0) - (r.prevTasks   || 0),
      overallSla:   parseFloat(((sla.overallSla || 0) - (sla.prevSla || 0)).toFixed(2)),
      avgTat:       (r.avgTat != null ? r.avgTat : 0) - (r.prevTat != null ? r.prevTat : 0),
      totalOverdue: (r.totalOverdue || 0) - (r.prevOverdue || 0),
      today,
      prevBizDay:   prev,
    },
  };
}

async function fetchTeamsData(customTargets = {}) {
  // Refresh dynamic groups so new SpecifiedKPIGrp values are included in this cycle.
  await refreshAllTeams();
  const NOW_SQL = getNowSql();
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const targetExpr = buildTargetExpr(customTargets);

  // Four parallel queries:
  // Q1: volume, avgTat, overdue � active/all tasks, DateCreated today.
  // Q2: volume/overdue/TAT deltas � DateCreated today + prev.
  // Q3: SLA% per team (DateCreated scope, TotalHoursOnTask/SLAInHours compliance) � completed tasks (status=2), DateCompleted today + prev.
  const [result, delta, slaResult, tcResult] = await Promise.all([
    pool.request().query(`
      SELECT
        CASE ${getTeamIdCase()} END AS teamId,
        -- volume: active tasks only
        SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6) THEN 1 ELSE 0 END)           AS volume,
        -- avgTat: TotalHoursOnTask for active tasks only (NULL/zero excluded)
        AVG(CASE WHEN t.TaskStatusID IN (1,4,5,6)
                 AND t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0
                 THEN t.TotalHoursOnTask ELSE NULL END)                            AS avgTat,
        -- overdue: open tasks where TotalHoursOnTask > 0 AND (TotalHoursOnTask > SLAInHours OR GETDATE() > SLAAdjustedDate)
        SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6)
                 AND t.TotalHoursOnTask > 0
                 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${getTeamFilter()}
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${getTeamIdCase()} END
    `),
    pool.request().query(`
      SELECT
        CASE ${getTeamIdCase()} END AS teamId,
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
        SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) AND t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS todayOverdue,
        SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) AND t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS prevOverdue,
        AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) AND t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0 THEN t.TotalHoursOnTask ELSE NULL END) AS todayTat,
        AVG(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) AND t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask <> 0 THEN t.TotalHoursOnTask ELSE NULL END) AS prevTat
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${getTeamFilter()}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${getTeamIdCase()} END
    `),
    pool.request().query(`
      SELECT
        CASE ${getTeamIdCase()} END AS teamId,
        CAST(
          SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                   AND (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask <= t.SLAInHours)
                   AND (t.SLAAdjustedDate IS NULL OR t.DateCompleted <= t.SLAAdjustedDate)
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS todaySla,
        CAST(
          SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                   AND (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask <= t.SLAInHours)
                   AND (t.SLAAdjustedDate IS NULL OR t.DateCompleted <= t.SLAAdjustedDate)
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS prevSla
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID = 2
        AND ${getTeamFilter()}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${getTeamIdCase()} END
    `),
    // Q4: TaskCode per KPI group team (used for team card group tooltip)
    pool.request().query(`
      SELECT CASE ${getTeamIdCaseForConfigTasks()} END AS teamId, ct.TaskCode
      FROM ConfigTasks ct WITH (NOLOCK)
      WHERE ct.UsedForKPI = 1
        AND ct.SpecifiedKPIGrp IS NOT NULL
        AND LTRIM(RTRIM(ct.SpecifiedKPIGrp)) <> N''
        AND ct.TaskCode IS NOT NULL
        AND LTRIM(RTRIM(ct.TaskCode)) <> N''
    `),
  ]);

  // Build map: teamId → sorted array of TaskCode strings (for tooltip display)
  const taskCodeMap = new Map();
  (tcResult.recordset || []).forEach(r => {
    if (r.teamId == null) return;
    if (!taskCodeMap.has(r.teamId)) taskCodeMap.set(r.teamId, []);
    taskCodeMap.get(r.teamId).push(String(r.TaskCode).trim());
  });

  const round1 = v => Math.round((v || 0) * 10) / 10;
  return getAllTeams().map(team => {
    const row = result.recordset.find(r => r.teamId === team.id) || {};
    const d   = delta.recordset.find(r => r.teamId === team.id)  || {};
    const sla = slaResult.recordset.find(r => r.teamId === team.id) || {};
    return {
      id:      team.id,
      name:    team.name,
      dept:    team.dept,
      target:  team.target,
      volume:  row.volume || 0,
      sla:     Math.round(sla.todaySla || 0),
      avgTat:  row.avgTat != null ? row.avgTat : 0,
      overdue:        row.overdue || 0,
      taskCodes:      taskCodeMap.get(team.id) || [],
      fallbackDeptId: team.fallbackDeptId || null,
      deltas: {
        volume:  (d.todayVol     || 0) - (d.prevVol     || 0),
        sla:     parseFloat(((sla.todaySla || 0) - (sla.prevSla || 0)).toFixed(1)),
        avgTat:  (d.todayTat || 0) - (d.prevTat || 0),
        overdue: (d.todayOverdue || 0) - (d.prevOverdue || 0),
      },
    };
  });
}
const app = express();

// Trust the first proxy hop (Vercel/Cloudflare/ngrok) so rate-limiter and
// req.ip see the real client IP, not the proxy IP. Required for express-rate-limit
// when behind a reverse proxy (CLAUDE.md Section 25 RULE 4 spirit).
app.set('trust proxy', 1);

// Security headers (CLAUDE.md Section 25 RULE 7 spirit). Helmet sets:
// HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.
// CSP is left to default-off because the API serves JSON only and is loaded
// cross-origin by the frontend; tightening CSP here would have no effect.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS locked to production frontend only (CLAUDE.md Section 25 RULE 5).
// Allowed origins come from env var (comma-separated) so adding a new
// preview/staging domain doesn't require a code change. Falls back to a
// safe default list for local dev.
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const DEFAULT_ORIGINS = [
  'https://sla.mezy.com.au',
  'https://sla-dashboard.vercel.app',
  'https://sla-dashboard-mezyproject2026.vercel.app',
  'https://sla-dashboard-ntruong94-mezyproject2026.vercel.app',
  'https://sla-dashboard-prod.vercel.app',
  'https://sla-dashboard-git-main-mezyproject2026.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://balmy-accurate-handpick.ngrok-free.dev',
];
const ALLOWED_ORIGINS = ENV_ORIGINS.length ? ENV_ORIGINS : DEFAULT_ORIGINS;
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/sla-dashboard-[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/frontend-[a-z0-9-]+\.vercel\.app$/i,
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_PATTERNS.some(rx => rx.test(origin))) {
      return cb(null, true);
    }
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());

// Rate limiter for auth endpoints to throttle credential-stuffing /
// password-spray / token-guessing attacks (CLAUDE.md Section 25 RULE 4 spirit).
// 10 attempts per IP per 15 min; failed responses count toward the limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// --- Root ---------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`SLA Dashboard backend running (mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'})`);
});

// --- Health check -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', mode: USE_MOCK ? 'mock' : 'live' });
});

// --- DB health check ----------------------------------------------------------
// Pings the SQL Server with SELECT 1. Use this to verify the connection works.
app.get('/api/db-health', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ status: 'OK', mode: 'mock', message: 'Mock mode ? no DB connection attempted.' });
  }
  try {
    const pool = await connectDB();
    await pool.request().query('SELECT 1 AS ping');
    res.json({ status: 'OK', mode: 'live', message: 'SQL Server connection successful.' });
  } catch (err) {
    console.error('[health] DB ping failed:', err);
    res.status(503).json({
      status: 'ERROR',
      mode: 'live',
      message: IS_PROD ? 'Database connection failed.' : err.message,
    });
  }
});

// --- DB diagnostic ------------------------------------------------------------
// Confirms ConfigQueue names, Tasks columns, and task statuses against live DB.
app.get('/api/db-test', async (req, res) => {
  if (USE_MOCK) {
    const sampleTask = mock.TASKS[0];
    return res.json({
      mode: 'mock',
      queues: mock.CONFIG_QUEUE,
      taskColumns: Object.keys(sampleTask).map(k => ({
        COLUMN_NAME: k,
        DATA_TYPE: typeof sampleTask[k] === 'number' ? 'real/int' : 'nvarchar',
      })),
      taskStatuses: mock.CONFIG_TASK_STATUS,
      staff: mock.STAFF,
    });
  }
  try {
    const pool = await connectDB();
    const [queues, taskCols, statuses] = await Promise.all([
      pool.request().query('SELECT QueueId, QueueName FROM ConfigQueue ORDER BY QueueId'),
      pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'Tasks'
        ORDER BY ORDINAL_POSITION
      `),
      pool.request().query('SELECT ConfigTaskStatusID, TaskStatus FROM ConfigTaskStatus'),
    ]);
    res.json({
      mode: 'live',
      queues:      queues.recordset,
      taskColumns: taskCols.recordset,
      taskStatuses: statuses.recordset,
    });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- KPI Summary --------------------------------------------------------------
// Returns: { totalTasks, overallSla, avgTat, totalOverdue }
// - totalTasks        ? active tasks (TaskStatusID IN 1,4,5,6)
// - overallSla, avgTat, totalOverdue ? completed tasks only (TaskStatusID = 2)
app.get('/api/kpi-summary', async (req, res) => {
  if (USE_MOCK) {
    const active = mock.TASKS.filter(t => t.TaskStatusID === 1);
    const total     = active.length;
    const compliant = active.filter(t => t.TotalHoursOnTask <= t.SLAInHours).length;
    const overdue   = active.filter(t => t.TotalHoursOnTask >  t.SLAInHours).length;
    const avgTat    = total > 0
      ? Math.round((active.reduce((s, t) => s + t.TotalHoursOnTask, 0) / total) * 10) / 10
      : 0;
    return res.json({
      totalTasks:  total,
      overallSla:  total > 0 ? parseFloat(((compliant / total) * 100).toFixed(2)) : 0,
      avgTat,
      totalOverdue: overdue,
    });
  }
  try {
    const customTargets = parseTargets(req.query);
    const hasCustom = Object.keys(customTargets).length > 0;
    const visibleTeams = req.query.visibleTeams
      ? req.query.visibleTeams.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
      : null;
    const hasFilter = visibleTeams && visibleTeams.length > 0;
    // Bypass cache when custom targets or visible-team filter is set — serve fresh filtered data.
    res.json(hasCustom || hasFilter
      ? await fetchKpiData(customTargets, visibleTeams)
      : await getCached('kpi', fetchKpiData));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Teams --------------------------------------------------------------------
// Returns array: [{ id, name, dept, target, volume, sla, avgTat, overdue }]
//
// Tasks are mapped to teams via Staff.DepartmentId (AssignedTo ? Staff ? DepartmentId).
app.get('/api/teams', async (req, res) => {
  if (USE_MOCK) {
    const active = mock.TASKS.filter(t => t.TaskStatusID === 1);
    const teams  = mock.CONFIG_QUEUE.map(q => {
      const qTasks    = active.filter(t => t.QueueId === q.QueueId);
      const volume    = qTasks.length;
      const compliant = qTasks.filter(t => t.TotalHoursOnTask <= t.SLAInHours).length;
      const overdue   = qTasks.filter(t => t.TotalHoursOnTask >  t.SLAInHours).length;
      const avgTat    = volume > 0
        ? Math.round((qTasks.reduce((s, t) => s + t.TotalHoursOnTask, 0) / volume) * 10) / 10
        : 0;
      const cfg = mock.TEAM_CONFIG[q.QueueId];
      return {
        id:      q.QueueId,
        name:    q.QueueName,
        dept:    cfg.dept,
        target:  cfg.slaTarget,
        volume,
        sla:     volume > 0 ? Math.round((compliant / volume) * 100) : 0,
        avgTat,
        overdue,
      };
    });
    return res.json(teams);
  }
  try {
    const customTargets = parseTargets(req.query);
    const hasCustom = Object.keys(customTargets).length > 0;
    res.json(hasCustom ? await fetchTeamsData(customTargets) : await getCached('teams', fetchTeamsData));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Tasks --------------------------------------------------------------------
// Query params: ?team=<QueueId>&status=ok|warn|bad
// Returns array of task objects matching the mock-data shape.
app.get('/api/tasks', async (req, res) => {
  const { team, status, scope } = req.query;
  const NOW_SQL = getNowSql();

  if (USE_MOCK) {
    let tasks = mock.TASKS.filter(t => t.TaskStatusID === 1);
    if (team)             tasks = tasks.filter(t => t.QueueId === parseInt(team));
    if (status === 'ok')  tasks = tasks.filter(t => t.status === 'ok');
    if (status === 'warn') tasks = tasks.filter(t => t.status === 'warn');
    if (status === 'bad') tasks = tasks.filter(t => t.status === 'bad');
    tasks = tasks.sort((a, b) => b.TotalHoursOnTask - a.TotalHoursOnTask);
    return res.json(tasks);
  }
  try {
    const pool    = await connectDB();
    const request = pool.request();
    const { today, todayNext } = computeDates();
    // atRiskFraction: default 87.5%, configurable via ?atRiskPct=N (clamped 50?99)
    const atRiskFraction = Math.min(0.99, Math.max(0.50, parseFloat(req.query.atRiskPct || 87.5) / 100));

    // ----- Completed-task drill-through (SLA % badge click) -----
    if (status === 'completed') {
      let cQuery = `
        SELECT TOP 500
          t.TaskID,
          t.ApplicationID,
          CONVERT(VARCHAR(10), t.DateCreated, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCreated, 108) AS CreateDte,
          CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) + ' ' + CONVERT(VARCHAR(8), t.SLAAdjustedDate, 108) AS SLAAdjustedDte,
          CONVERT(VARCHAR(10), t.DateCompleted, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCompleted, 108) AS CompletedDte,
          t.TaskName,
          t.ShortDescription,
          t.CreatedBy,
          t.TotalHoursOnTask,
          t.TotalHoursOnTask_BH,
          t.TotalHoursOnHold,
          t.SLAInHours,
          t.SoEzySLA,
          NULL AS SLARemaining,
          t.DateCreated,
          t.Priority,
          t.TaskStatusID,
          ts.TaskStatus,
          CASE ${getTeamIdCase()} END AS QueueId,
          CASE ${getTeamNameCase()} END AS QueueName,
          t.AssignedTo,
          s.FirstName AS AssignedToName,
          RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
          ISNULL(s.IsGroup, 0) AS AssignedToIsGroup,
          RTRIM(ISNULL(cb.FirstName,'') + ISNULL(' ' + cb.Surname, '')) AS CreatedByFullName,
          ISNULL(cb.IsGroup, 0) AS CreatedByIsGroup,
          DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 AS RealtimeTAT,
          CASE
            WHEN (t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask > t.SLAInHours)
              OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted > t.SLAAdjustedDate)
              THEN 'bad'
            ELSE 'ok'
          END AS status
        FROM Tasks t WITH (NOLOCK)
        LEFT JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
        LEFT JOIN Staff s             WITH (NOLOCK) ON t.AssignedTo   = s.StaffID
        LEFT JOIN Staff cb            WITH (NOLOCK) ON t.CreatedBy    = cb.StaffID
        ${CONFIG_TASKS_JOIN}
        WHERE t.TaskStatusID = 2
          AND ${getTeamFilter()}
          AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
      `;
      if (team) {
        const teamDef = getAllTeams().find(t => t.id === parseInt(team));
        if (teamDef) {
          const primary  = `(ct.UsedForKPI = 1 AND ${teamDef.kpiGrp})`;
          const fallback = teamDef.fallbackDeptId
            ? ` OR ((ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'') AND s.DepartmentId = ${teamDef.fallbackDeptId} AND s.EmployeeStatus = 1)`
            : '';
          cQuery += ` AND (${primary}${fallback})`;
        }
      }
      cQuery += `
        ORDER BY
          CASE WHEN (t.TotalHoursOnTask IS NOT NULL AND t.TotalHoursOnTask > t.SLAInHours)
                    OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted > t.SLAAdjustedDate)
               THEN 0 ELSE 1 END,
          t.TotalHoursOnTask DESC
      `;
      const cResult = await request.query(cQuery);
      return res.json(cResult.recordset);
    }
    // ----- end completed-task branch -----

    // Tasks are mapped to teams via Staff.DepartmentId (AssignedTo ? Staff ? DepartmentId).
    // SLARemaining comes from TaskRelation (IsCurrent = 1 row).
    // Limited to TOP 500 sorted by worst SLA first to avoid timeout on large datasets.
    // TaskRelation join removed ? expensive on large tables; SLARemaining set to NULL.
    let query = `
      SELECT TOP 500
        t.TaskID,
        t.ApplicationID,
        CONVERT(VARCHAR(10), t.DateCreated, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCreated, 108) AS CreateDte,
        CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) + ' ' + CONVERT(VARCHAR(8), t.SLAAdjustedDate, 108) AS SLAAdjustedDte,
        t.TaskName,
        t.ShortDescription,
        t.CreatedBy,
        t.TotalHoursOnTask,
        t.TotalHoursOnTask_BH,
        t.TotalHoursOnHold,
        t.SLAInHours,
        t.SoEzySLA,
        NULL           AS SLARemaining,
        t.DateCreated,
        t.Priority,
        t.TaskStatusID,
        ts.TaskStatus,
        CASE ${getTeamIdCase()} END AS QueueId,
        CASE ${getTeamNameCase()} END AS QueueName,
        t.AssignedTo,
        s.FirstName    AS AssignedToName,
        RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
        ISNULL(s.IsGroup, 0) AS AssignedToIsGroup,
        RTRIM(ISNULL(cb.FirstName,'') + ISNULL(' ' + cb.Surname, '')) AS CreatedByFullName,
        ISNULL(cb.IsGroup, 0) AS CreatedByIsGroup,
        -- RealtimeTAT: TotalHoursOnTask for active tasks (NULL = excluded from TAT calculation)
        t.TotalHoursOnTask AS RealtimeTAT,
        CASE
          WHEN t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 'bad'
          WHEN t.TotalHoursOnTask > 0 AND t.TotalHoursOnTask >= ISNULL(NULLIF(t.SLAInHours, 0), 4) * ${atRiskFraction} THEN 'warn'
          ELSE 'ok'
        END AS status
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
      LEFT  JOIN Staff s             WITH (NOLOCK) ON t.AssignedTo   = s.StaffID
      LEFT  JOIN Staff cb            WITH (NOLOCK) ON t.CreatedBy    = cb.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID IN (1, 4, 5, 6)  -- In Progress, On Hold, On Queue, Not Queued
        AND ${getTeamFilter()}
    `;

    if (team) {
      // team param = team id (1-9 static, 100+ dynamic); filter by kpiGrp or fallback DeptId
      const teamDef = getAllTeams().find(t => t.id === parseInt(team));
      if (teamDef) {
        const primary = `(ct.UsedForKPI = 1 AND ${teamDef.kpiGrp})`;
        const fallback = teamDef.fallbackDeptId
          ? ` OR ((ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'') AND s.DepartmentId = ${teamDef.fallbackDeptId} AND s.EmployeeStatus = 1)`
          : '';
        query += ` AND (${primary}${fallback})`;
      }
    }
    if (status === 'ok') {
      query += ` AND (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask = 0 OR t.TotalHoursOnTask < ISNULL(NULLIF(t.SLAInHours, 0), 4) * ${atRiskFraction})`;
    } else if (status === 'warn') {
      query += ` AND t.TotalHoursOnTask > 0 AND t.TotalHoursOnTask >= ISNULL(NULLIF(t.SLAInHours, 0), 4) * ${atRiskFraction} AND t.TotalHoursOnTask <= ISNULL(NULLIF(t.SLAInHours, 0), 4)`;
    } else if (status === 'bad') {
      query += ` AND t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))`;
    }
    if (scope === 'today') {
      query += ` AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'`;
    }
    query += ` ORDER BY ISNULL(t.TotalHoursOnTask, -1) DESC`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- History ------------------------------------------------------------------
// Query param: ?range=7d|30d|90d  (default 30d)
// Returns: { dates: ['2026-04-01', ...], byTeam: { 'Data Entry': [93, 91, ...], ... } }
function historyLookbackDays(range = '90d') {
  if (range === '7d') return 11;
  if (range === '30d') return 44;
  if (range === '90d') return 128;
  const m = String(range).match(/^(\d+)d$/i);
  if (m) {
    const d = parseInt(m[1], 10);
    return Number.isFinite(d) && d > 0 ? d : 44;
  }
  return 44;
}

async function fetchHistoryData(range = '90d', customTargets = {}) {
  // Request extra calendar days to guarantee enough business days:
  // 7 biz days needs 11 cal days; 30 biz days needs 44; 90 biz days needs 128
  const days  = historyLookbackDays(range);
  const pool    = await connectDB();
  const request = pool.request();
  // No explicit timeout ? inherits 180s from db.js (needed for cold-start full scan)
  const targetExpr = buildTargetExpr(customTargets);
  const refDate = new Date(todayLocal() + 'T00:00:00');
  request.input('startDate', sql.DateTime, new Date(refDate.getTime() - days * 24 * 60 * 60 * 1000));
  const result = await request.query(`
      SELECT
        CONVERT(varchar(10), t.DateCreated, 120)                              AS Date,
        CASE ${getTeamIdCase()} END                                               AS teamId,
        COUNT(*)                                                               AS total,
        SUM(CASE WHEN
              (t.TotalHoursOnTask IS NULL OR t.TotalHoursOnTask <= t.SLAInHours)
              AND (t.SLAAdjustedDate IS NULL OR t.DateCompleted <= t.SLAAdjustedDate)
            THEN 1 ELSE 0 END)                                                AS compliant
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID = 2
        AND t.DateCreated >= @startDate
        AND t.DateCreated IS NOT NULL
        AND t.DateCompleted IS NOT NULL
        AND t.SLAInHours > 0
        AND ${getTeamFilter()}
      GROUP BY CONVERT(varchar(10), t.DateCreated, 120), CASE ${getTeamIdCase()} END
    `);
  const aggRows = result.recordset;
  const dateSet = [...new Set(aggRows.map(r => r.Date))].sort();
  const byTeamMap = {};
  for (const row of aggRows) {
    const team = getAllTeams().find(t => t.id === row.teamId);
    const name = team ? team.name : `Team ${row.teamId}`;
    if (!byTeamMap[name]) byTeamMap[name] = {};
    byTeamMap[name][row.Date] = Math.round((row.compliant / row.total) * 100);
  }
  const byTeam = {};
  for (const [name, dateMap] of Object.entries(byTeamMap)) {
    byTeam[name] = dateSet.map(d => dateMap[d] ?? null);
  }
  return { dates: dateSet, byTeam };
}

app.get('/api/history', async (req, res) => {
  const range = req.query.range || '90d';

  if (USE_MOCK) {
    const days = historyLookbackDays(range);
    const byTeam = {};
    let dates = [];
    for (const [teamName, history] of Object.entries(mock.HISTORY)) {
      const slice = history.slice(-days);
      byTeam[teamName] = slice.map(h => h.SlaPct);
      if (dates.length === 0) dates = slice.map(h => h.Date);
    }
    return res.json({ dates, byTeam });
  }
  try {
    const customTargets = parseTargets(req.query);
    const hasCustom = Object.keys(customTargets).length > 0;
    const historyCacheKey = `history:${range}`;
    res.json(hasCustom
      ? await fetchHistoryData(range, customTargets)
      : await getCached(historyCacheKey, () => fetchHistoryData(range)));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Alerts -------------------------------------------------------------------
// Derived from active-task breach thresholds ? no alerts table in the DB.
// Returns array: [{ id, severity, title, desc, triggeredAt, queueId }]
//
// _alertFirstSeen: persists the first time each alert condition was detected.
// Key = "<teamId>-<severity>" ? survives API re-calls so "3h ago" stays accurate.
const _alertFirstSeen = new Map();

app.get('/api/alerts', async (req, res) => {
  const buildAlerts = (rows) => {
    const alerts = [];
    const activeKeys = new Set();
    for (const row of rows) {
      const pct = row.total > 0 ? Math.round((row.compliant / row.total) * 100) : 100;
      let severity = null;
      if      (pct < 75) severity = 'critical';
      else if (pct < 90) severity = 'warning';
      if (!severity) continue;

      const key = `${row.QueueId}-${severity}`;
      activeKeys.add(key);
      if (!_alertFirstSeen.has(key)) _alertFirstSeen.set(key, new Date());
      const triggeredAt = _alertFirstSeen.get(key).toISOString();

      if (severity === 'critical') {
        alerts.push({
          id: `a-${key}`, severity,
          title: `${row.QueueName} breach threshold`,
          desc:  `${row.total} active tasks today, ${row.inProgress} file${row.inProgress !== 1 ? 's' : ''} complete, ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue, SLA at ${pct}%.`,
          triggeredAt, queueId: row.QueueId,
        });
      } else {
        alerts.push({
          id: `a-${key}`, severity,
          title: `${row.QueueName} SLA at risk`,
          desc:  `${row.total} active tasks today, ${row.inProgress} file${row.inProgress !== 1 ? 's' : ''} complete, ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue, SLA at ${pct}%.`,
          triggeredAt, queueId: row.QueueId,
        });
      }
    }
    // Prune keys for conditions that have resolved so timestamps reset if they recur
    for (const k of _alertFirstSeen.keys()) {
      if (!activeKeys.has(k)) _alertFirstSeen.delete(k);
    }
    return alerts;
  };

  if (USE_MOCK) {
    const active = mock.TASKS.filter(t => t.TaskStatusID === 1);
    const rows   = mock.CONFIG_QUEUE.map(q => {
      const qTasks = active.filter(t => t.QueueId === q.QueueId);
      return {
        QueueId:   q.QueueId,
        QueueName: q.QueueName,
        total:     qTasks.length,
        compliant: qTasks.filter(t => t.TotalHoursOnTask <= t.SLAInHours).length,
        overdue:   qTasks.filter(t => t.TotalHoursOnTask >  t.SLAInHours).length,
      };
    });
    return res.json(buildAlerts(rows));
  }
  try {
    const pool   = await connectDB();
    const NOW_SQL = getNowSql();
    const { today, todayNext } = computeDates();
    const alertTargets = parseTargets(req.query);
    const alertTargetExpr = buildTargetExpr(alertTargets);
    const result = await pool.request().query(`
      SELECT
        CASE ${getTeamIdCase()} END                                                AS teamId,
        COUNT(*)                                                                AS total,
        -- inProgress: tasks with TaskStatusID = 1 ("In Progress" status only)
        SUM(CASE WHEN t.TaskStatusID = 1 THEN 1 ELSE 0 END)                    AS inProgress,
        -- compliant = total - overdue: tasks not currently breaching SLA (includes TotalHoursOnTask=0/NULL)
        SUM(CASE WHEN NOT (t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))) THEN 1 ELSE 0 END) AS compliant,
        SUM(CASE WHEN t.TotalHoursOnTask > 0 AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${CONFIG_TASKS_JOIN}
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
        AND ${getTeamFilter()}
      GROUP BY CASE ${getTeamIdCase()} END
    `);
    // Attach team name from TEAMS definition before generating alerts
    const rows = result.recordset.map(r => {
      const team = getAllTeams().find(t => t.id === r.teamId) || {};
      return { ...r, QueueId: r.teamId, QueueName: team.name || `Team ${r.teamId}` };
    });
    res.json(buildAlerts(rows));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Alert task drill-down ----------------------------------------------------
// Returns top 50 active tasks for a team that are at-risk or overdue.
// Query param: ?atRiskPct=87.5 (default 87.5 ? matches frontend DEFAULT_SETTINGS)
app.get('/api/alert-tasks/:teamId', async (req, res) => {
  const teamId  = parseInt(req.params.teamId, 10);
  const teamDef = getAllTeams().find(t => t.id === teamId);
  if (!teamDef) return res.status(404).json({ error: 'Team not found' });
  const NOW_SQL = getNowSql();
  const { today, todayNext } = computeDates();

  // atRiskFraction: clamped to [0.50, 0.99] to prevent nonsensical values
  const atRiskFraction = Math.min(0.99, Math.max(0.50, parseFloat(req.query.atRiskPct || 87.5) / 100));
  // customTarget: optional override for this team's SLA hours (from Settings).
  // Falls back to the team's default target (e.g. 4h), NOT t.SLAInHours (per-task DB field
  // that varies by task type and can be 0.5h), so status and TAT bar match All Active Tasks.
  const customTargetH = parseFloat(req.query.customTarget);
  const teamDefaultTarget = teamDef.target || 4;
  const slaExpr = (customTargetH > 0) ? customTargetH.toString() : teamDefaultTarget.toString();

  if (USE_MOCK) {
    const tasks = mock.TASKS
      .filter(t => [1, 4, 5, 6].includes(t.TaskStatusID)
               && t.TotalHoursOnTask >= t.SLAInHours * atRiskFraction)
      .sort((a, b) => b.TotalHoursOnTask - a.TotalHoursOnTask)
      .slice(0, 50)
      .map(t => ({
        TaskID:           t.TaskID,
        CreateDte:        t.DateCreated || null,
        SLAAdjustedDte:   t.SLAAdjustedDate || null,
        ShortDescription: t.ShortDescription || t.desc || null,
        TotalHoursOnTask: t.TotalHoursOnTask,
        SLAInHours:       t.SLAInHours,
        TatHours:         t.TotalHoursOnTask,
        TargetHours:      t.SLAInHours,
        Priority:         (t.Priority || 'low').toString().toLowerCase(),
        OverDueComments:  t.OverDueComments || null,
        overdueHours:     Math.max(0, Math.round((t.TotalHoursOnTask - t.SLAInHours) * 10) / 10),
        taskType:         t.TotalHoursOnTask > t.SLAInHours ? 'overdue' : 'atrisk',
      }));
    return res.json(tasks);
  }

  try {
    const pool = await connectDB();
    // All teams filter by UsedForKPI/SpecifiedKPIGrp (primary) or fallback DeptId.
    const primaryFilter = `(ct.UsedForKPI = 1 AND ${teamDef.kpiGrp})`;
    const fallbackFilter = teamDef.fallbackDeptId
      ? ` OR (s.DepartmentId = ${teamDef.fallbackDeptId} AND s.EmployeeStatus = 1)`
      : '';
    const teamFilter = `(${primaryFilter}${fallbackFilter})`;

    const staffJoin = `LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      LEFT JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId
      LEFT JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID`;
    // UNION returns overdue and at-risk tasks. Overdue = TotalHoursOnTask > SLAInHours (per-task) OR GETDATE() > SLAAdjustedDate.
    // At-risk branch excludes tasks matching the overdue condition to prevent double counting.
    // slaExpr (team-configured target from Settings) is used for at-risk detection only; overdue uses per-task t.SLAInHours.
    const result = await pool.request().query(`
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          t.ApplicationID,
          CONVERT(VARCHAR(10), t.DateCreated, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCreated, 108) AS CreateDte,
          CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) + ' ' + CONVERT(VARCHAR(8), t.SLAAdjustedDate, 108) AS SLAAdjustedDte,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.TotalHoursOnHold,
          t.SLAInHours,
          ROUND(ISNULL(t.TotalHoursOnTask, 0), 1) AS TatHours,
          ${slaExpr} AS TargetHours,
          LOWER(ISNULL(CONVERT(VARCHAR(20), t.Priority), 'low')) AS Priority,
          t.OverDueComments,
          CASE
            WHEN t.TotalHoursOnTask > 0 AND t.TotalHoursOnTask > t.SLAInHours
              THEN ROUND(t.TotalHoursOnTask - t.SLAInHours, 1)
            ELSE 0
          END AS overdueHours,
          'overdue' AS taskType,
          RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
          ISNULL(ts.TaskStatus, '') AS TaskStatus
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
          AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
          AND ${teamFilter}
          AND ${slaExpr} > 0
          AND t.TotalHoursOnTask > 0
          AND (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
        ORDER BY ISNULL(t.TotalHoursOnTask, 0) / ${slaExpr} DESC
      ) AS Overdue
      UNION ALL
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          t.ApplicationID,
          CONVERT(VARCHAR(10), t.DateCreated, 103) + ' ' + CONVERT(VARCHAR(8), t.DateCreated, 108) AS CreateDte,
          CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) + ' ' + CONVERT(VARCHAR(8), t.SLAAdjustedDate, 108) AS SLAAdjustedDte,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.TotalHoursOnHold,
          t.SLAInHours,
          ROUND(ISNULL(t.TotalHoursOnTask, 0), 1) AS TatHours,
          ${slaExpr} AS TargetHours,
          LOWER(ISNULL(CONVERT(VARCHAR(20), t.Priority), 'low')) AS Priority,
          t.OverDueComments,
          0 AS overdueHours,
          'atrisk' AS taskType,
          RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
          ISNULL(ts.TaskStatus, '') AS TaskStatus
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
          AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
          AND ${teamFilter}
          AND ${slaExpr} > 0
          AND t.TotalHoursOnTask > 0
          AND t.TotalHoursOnTask >= ${slaExpr} * ${atRiskFraction}
          AND t.TotalHoursOnTask <= ${slaExpr}
          AND NOT (t.TotalHoursOnTask > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
        ORDER BY ISNULL(t.TotalHoursOnTask, 0) / ${slaExpr} DESC
      ) AS AtRisk
    `);
    // Return overdue rows first, then at-risk rows
    const overdue = result.recordset.filter(r => r.taskType === 'overdue');
    const atrisk  = result.recordset.filter(r => r.taskType === 'atrisk');
    res.json([...overdue, ...atrisk]);
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Loan Summary -------------------------------------------------------------
// Returns count + total LoanAmount for 3 milestones: received, funder approved, settled.
// Each bucket queries its own date column so each scan is range-limited and sargable.
// Returns: { received, approved, settled } ? each: { count, amount, deltas: { count, amount } }
app.get('/api/loan-summary', async (req, res) => {
  try {
    const pool = await connectDB();
    const { today, prev, todayNext, prevNext, prev5, prev5Next } = computeDates();

    const loanQuery = (col) => pool.request().query(`
      SELECT
        SUM(CASE WHEN ${col} >= '${today}' AND ${col} < '${todayNext}' THEN 1 ELSE 0 END)                                                          AS todayCount,
        ISNULL(SUM(CASE WHEN ${col} >= '${today}' AND ${col} < '${todayNext}' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0)                           AS todayAmt,
        SUM(CASE WHEN ${col} >= '${prev}'  AND ${col} < '${prevNext}'  THEN 1 ELSE 0 END)                                                          AS prevCount,
        ISNULL(SUM(CASE WHEN ${col} >= '${prev}'  AND ${col} < '${prevNext}'  THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0)                           AS prevAmt,
        SUM(CASE WHEN ${col} >= '${prev5}' AND ${col} < '${prev5Next}' THEN 1 ELSE 0 END)                                                          AS prev5Count,
        ISNULL(SUM(CASE WHEN ${col} >= '${prev5}' AND ${col} < '${prev5Next}' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0)                           AS prev5Amt
      FROM Loans WITH (NOLOCK)
      WHERE ${col} >= '${prev5}' AND ${col} < '${todayNext}'
    `);

    const [recv, appr, sett] = await Promise.all([
      loanQuery('Date_ApplicationReceived'),
      loanQuery('Date_FunderApproval'),
      loanQuery('Date_Settled'),
    ]);

    const parse = (result) => {
      const r = result.recordset[0] || {};
      const todayCount = r.todayCount || 0;
      const todayAmt   = Math.round(parseFloat(r.todayAmt) || 0);
      const prevCount  = r.prevCount  || 0;
      const prevAmt    = Math.round(parseFloat(r.prevAmt)  || 0);
      const prev5Count = r.prev5Count || 0;
      const prev5Amt   = Math.round(parseFloat(r.prev5Amt) || 0);
      return {
        count:  todayCount,
        amount: todayAmt,
        deltas:  { count: todayCount - prevCount,  amount: todayAmt - prevAmt  },
        deltas5: { count: todayCount - prev5Count, amount: todayAmt - prev5Amt },
      };
    };

    res.json({
      received: parse(recv),
      approved: parse(appr),
      settled:  parse(sett),
    });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Loan Detail --------------------------------------------------------------
// Returns individual loan rows for drill-down on loan summary cards.
// :type = 'received' | 'approved' | 'settled'
// Returns: [{ ApplicationID, FunderName, LoanAmount }] filtered to today.
app.get('/api/loan-detail/:type', async (req, res) => {
  const COL_MAP = {
    received: 'Date_ApplicationReceived',
    approved: 'Date_FunderApproval',
    settled:  'Date_Settled',
  };
  const col = COL_MAP[req.params.type];
  if (!col) return res.status(400).json({ error: 'Invalid type. Use: received, approved, settled' });

  try {
    const pool = await connectDB();
    const { today, todayNext } = computeDates();
    const result = await pool.request().query(`
      SELECT
        ApplicationID,
        CONVERT(varchar(10), ${col}, 120)             AS MilestoneDate,
        ISNULL(FunderName, '�')                       AS FunderName,
        ISNULL(CAST(LoanAmount AS DECIMAL(18,2)), 0)  AS LoanAmount
      FROM Loans WITH (NOLOCK)
      WHERE ${col} >= '${today}' AND ${col} < '${todayNext}'
      ORDER BY LoanAmount DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Auth helpers -------------------------------------------------------------
// Fail loudly if JWT_SECRET is missing or weak (CLAUDE.md Section 25 RULE 1 + RULE 4).
// A silent fallback secret would let anyone forge tokens in production.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET environment variable is missing or shorter than 32 chars.');
  console.error('Generate a strong secret with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// SLA Dashboard ID in ConfigDashboards � seeded on startup as ID = 1.
const SLA_DASHBOARD_ID = 1;

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid ? please log in again' });
  }
}

// --- Auth endpoints (public ? no requireAuth) ---------------------------------

// POST /api/auth/forgot-password
// Public ? generates a time-limited reset token and returns it directly
// (no email infrastructure; this is an internal dashboard tool)
app.post('/api/auth/forgot-password', authLimiter, express.json(), async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const pool = await connectDB();
    // Verify the user exists and has approved access to this dashboard
    const result = await pool.request()
      .input('email',  sql.NVarChar(255), email.toLowerCase().trim())
      .input('dashId', sql.Int,           SLA_DASHBOARD_ID)
      .query(`SELECT cru.UserId
              FROM ConfigReportUsers cru
              INNER JOIN Staff s ON cru.StaffId = s.StaffID
              INNER JOIN DashboardAccess da ON da.UserId = cru.UserId
                AND da.ConfigDashboardId = @dashId AND da.IsActive = 1
              WHERE LOWER(s.EmailAddress) = @email`);
    if (!result.recordset.length)
      return res.status(404).json({ error: 'No approved account found for that email address.' });
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour, stored as ISO string
    await pool.request()
      .input('token',  sql.NVarChar(sql.MAX), token)
      .input('expiry', sql.NVarChar(sql.MAX), expiry)
      .input('userId', sql.Int, result.recordset[0].UserId)
      .query('UPDATE ConfigReportUsers SET ResetToken = @token, ResetTokenExpiry = @expiry WHERE UserId = @userId');
    res.json({ token, expiresIn: '1 hour' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// POST /api/auth/reset-password
// Public ? validates token, updates password, clears token
app.post('/api/auth/reset-password', authLimiter, express.json(), async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ error: 'Reset code and new password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('token', sql.NVarChar(sql.MAX), token)
      .query(`SELECT UserId, ResetTokenExpiry FROM ConfigReportUsers
              WHERE ResetToken = @token`);
    const user = result.recordset[0];
    if (!user) return res.status(400).json({ error: 'Invalid reset code.' });
    if (new Date(user.ResetTokenExpiry) < new Date())
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    const hash = await bcrypt.hash(password, 12);
    await pool.request()
      .input('hash', sql.NVarChar(sql.MAX), hash)
      .input('id',   sql.Int,              user.UserId)
      .query('UPDATE ConfigReportUsers SET PasswordHash = @hash, ResetToken = NULL, ResetTokenExpiry = NULL WHERE UserId = @id');
    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// POST /api/auth/signup
app.post('/api/auth/signup', authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const pool = await connectDB();
    // New model: user identity is tied to a Staff record via EmailAddress
    const staffResult = await pool.request()
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query(`SELECT StaffID FROM Staff
              WHERE LOWER(EmailAddress) = @email AND EmployeeStatus = 1`);
    if (!staffResult.recordset.length)
      return res.status(404).json({ error: 'No active staff account found for that email. Please contact your administrator.' });
    const staffId = staffResult.recordset[0].StaffID;
    // Check not already registered
    const existing = await pool.request()
      .input('staffId', sql.Int, staffId)
      .query(`SELECT UserId FROM ConfigReportUsers WHERE StaffId = @staffId`);
    if (existing.recordset.length)
      return res.status(409).json({ error: 'An account with that email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const newUser = await pool.request()
      .input('staffId', sql.Int,              staffId)
      .input('hash',    sql.NVarChar(sql.MAX), hash)
      .query(`INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt)
              OUTPUT INSERTED.UserId
              VALUES (@staffId, @hash, GETDATE())`);
    const userId = newUser.recordset[0].UserId;
    // Auto-approve: grant viewer access immediately � no admin approval required
    // Resolve the actual dashboard ID from ConfigDashboards
    const cdLookup = await pool.request().query(
      `SELECT TOP 1 DashboardID FROM ConfigDashboards WHERE IsActive = 1 ORDER BY DashboardID`
    );
    const dashId = cdLookup.recordset.length ? cdLookup.recordset[0].DashboardID : SLA_DASHBOARD_ID;
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('dashId', sql.Int, dashId)
      .query(`INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
              VALUES (@dashId, @userId, 'viewer', 1)`);
    res.json({ message: 'Signup successful. You can now log in.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('email',  sql.NVarChar(255), email.toLowerCase().trim())
      .input('dashId', sql.Int,           SLA_DASHBOARD_ID)
      .query(`SELECT cru.UserId,
                     s.EmailAddress                                                           AS Email,
                     ISNULL(s.FirstName,'') + ISNULL(' ' + NULLIF(LTRIM(s.Surname),''), '') AS FullName,
                     cru.PasswordHash,
                     da.Role,
                     da.IsActive AS IsApproved
              FROM ConfigReportUsers cru
              INNER JOIN Staff s ON cru.StaffId = s.StaffID
              LEFT JOIN DashboardAccess da ON da.UserId = cru.UserId
                AND da.ConfigDashboardId = @dashId
              WHERE LOWER(s.EmailAddress) = @email`);
    const user = result.recordset[0];
    // Same error for wrong email OR wrong password � avoids user enumeration
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.IsApproved) return res.status(403).json({ error: 'Your account is pending admin approval.' });
    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    const role = user.Role || 'viewer';
    const token = jwt.sign(
      { userId: user.UserId, email: user.Email, role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, email: user.Email, companyName: user.FullName, role });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Admin-only middleware ----------------------------------------------------
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admin access required.' });
    next();
  });
}

// --- Admin: user management endpoints ----------------------------------------

// GET /api/admin/users ? list all registered users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('dashId', sql.Int, SLA_DASHBOARD_ID)
      .query(`SELECT cru.UserId,
                     s.EmailAddress                                                           AS Email,
                     ISNULL(s.FirstName,'') + ISNULL(' ' + NULLIF(LTRIM(s.Surname),''), '') AS FullName,
                     ISNULL(da.Role, 'viewer')                                               AS Role,
                     da.IsActive,
                     cru.CreatedAt
              FROM ConfigReportUsers cru
              INNER JOIN Staff s ON cru.StaffId = s.StaffID
              LEFT JOIN DashboardAccess da ON da.UserId = cru.UserId
                AND da.ConfigDashboardId = @dashId
              ORDER BY cru.CreatedAt DESC`);
    res.json(result.recordset.map(u => ({
      id:          u.UserId,
      email:       u.Email,
      companyName: u.FullName,
      role:        u.Role,
      status:      u.IsActive == null ? 'pending' : (u.IsActive ? 'approved' : 'rejected'),
      createdAt:   u.CreatedAt,
    })));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// DELETE /api/admin/users/:id � remove a user entirely (admin only)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || isNaN(userId))
    return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    await pool.request()
      .input('userId', sql.Int, userId)
      .query(`DELETE FROM DashboardAccess WHERE UserId = @userId`);
    await pool.request()
      .input('userId', sql.Int, userId)
      .query(`DELETE FROM ConfigReportUsers WHERE UserId = @userId`);
    res.json({ message: 'User removed.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Staff List ---------------------------------------------------------------
// GET /api/staff/departments  ? all departments with active staff count (ordered high ? low)
// GET /api/staff/department/:id ? active staff detail for one department
app.use('/api/staff', requireAuth);

app.get('/api/staff/departments', async (req, res) => {
  try {
    const pool = await connectDB();
    const result = await pool.request().query(`
      SELECT
        s.DepartmentId,
        MAX(d.Name)              AS DepartmentName,
        COUNT(s.StaffID)         AS TotalStaff
      FROM Staff      s WITH (NOLOCK)
      LEFT JOIN Department d WITH (NOLOCK) ON d.DepartmentId = s.DepartmentId
      WHERE s.DepartmentId IS NOT NULL
        AND s.EmployeeStatus = 1
      GROUP BY s.DepartmentId
      HAVING COUNT(s.StaffID) > 0
      ORDER BY COUNT(s.StaffID) DESC, MAX(d.Name) ASC
    `);
    res.json(result.recordset.map(r => ({
      departmentId:   r.DepartmentId,
      departmentName: r.DepartmentName,
      totalStaff:     r.TotalStaff,
    })));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

app.get('/api/staff/absent-today', async (req, res) => {
  if (USE_MOCK) return res.json([]);
  try {
    const pool = await connectDB();
    const { today, todayNext } = computeDates();
    const result = await pool.request().query(`
      SELECT
        s.StaffID,
        LTRIM(RTRIM(ISNULL(s.FirstName, '') + CASE
          WHEN ISNULL(s.Surname, '') <> '' THEN ' ' + s.Surname
          ELSE ''
        END)) AS FullName,
        ISNULL(d.Name, '-') AS DepartmentName,
        ISNULL(cws.WorkStatusName, '-') AS WorkStatusName,
        CONVERT(VARCHAR(10), wsh.StartedTime, 103) AS StartedTime,
        CONVERT(VARCHAR(10), wsh.EndedTime,   103) AS EndedTime
      FROM WorkStatusHistory wsh WITH (NOLOCK)
      LEFT JOIN ConfigWorkStatus cws WITH (NOLOCK) ON wsh.ConfigWorkStatusId = cws.ConfigWorkStatusID
      LEFT JOIN Staff            s   WITH (NOLOCK) ON wsh.StaffId = s.StaffID
      LEFT JOIN Department       d   WITH (NOLOCK) ON s.DepartmentId = d.DepartmentId
      WHERE wsh.StartedTime >= '${today}'
        AND wsh.StartedTime <  '${todayNext}'
        AND ISNULL(cws.IsAbsent, 0) = 1
        AND wsh.StaffId IS NOT NULL
      ORDER BY wsh.StartedTime DESC, s.FirstName ASC, s.Surname ASC
    `);
    res.json(result.recordset.map(r => ({
      staffId:        r.StaffID,
      fullName:       r.FullName,
      departmentName: r.DepartmentName,
      workStatusName: r.WorkStatusName,
      startedTime:    r.StartedTime,
      endedTime:      r.EndedTime,
    })));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

app.get('/api/staff/department/:departmentId', async (req, res) => {
  const deptId = parseInt(req.params.departmentId, 10);
  if (!deptId) return res.status(400).json({ error: 'Invalid department ID.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('deptId', sql.Int, deptId)
      .query(`
        SELECT
          s.StaffID,
          ISNULL(s.FirstName, '') + CASE
            WHEN ISNULL(s.Surname, '') <> '' THEN ' ' + s.Surname
            ELSE ''
          END                        AS FullName,
          s.EmployeeStatus,
          s.IsGroup
        FROM Staff s WITH (NOLOCK)
        WHERE s.DepartmentId = @deptId
          AND s.EmployeeStatus = 1
          AND NULLIF(LTRIM(RTRIM(ISNULL(s.FirstName, '') + ISNULL(s.Surname, ''))), '') IS NOT NULL
        ORDER BY s.FirstName, s.Surname
      `);
    res.json(result.recordset.map(r => ({
      staffId:        r.StaffID,
      fullName:       r.FullName,
      employeeStatus: r.EmployeeStatus,
      isGroup:        r.IsGroup,
    })));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Per-user settings (stored in ConfigReportUsers.UserSettings as JSON) -----

// GET /api/user/settings — retrieve the authenticated user's saved dashboard settings
app.get('/api/user/settings', requireAuth, async (req, res) => {
  if (USE_MOCK) return res.json({});
  try {
    const pool   = await connectDB();
    const result = await pool.request()
      .input('userId', sql.Int, req.user.userId)
      .query('SELECT UserSettings FROM ConfigReportUsers WHERE UserId = @userId');
    const row = result.recordset[0];
    if (!row || !row.UserSettings) return res.json({});
    try { return res.json(JSON.parse(row.UserSettings)); }
    catch { return res.json({}); }
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// PUT /api/user/settings — persist the authenticated user's dashboard settings
app.put('/api/user/settings', requireAuth, express.json(), async (req, res) => {
  if (USE_MOCK) return res.json({ ok: true });
  try {
    const pool = await connectDB();
    await pool.request()
      .input('userId',   sql.Int,              req.user.userId)
      .input('settings', sql.NVarChar(sql.MAX), JSON.stringify(req.body || {}))
      .query('UPDATE ConfigReportUsers SET UserSettings = @settings WHERE UserId = @userId');
    res.json({ ok: true });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Protect all data endpoints with JWT -------------------------------------
// GET /api/settings — global team config readable by all authenticated users.
// Clients poll this every 15 s and recompute teamsDisplay when version changes.
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(_globalTeamConfig);
});

// PUT /api/admin/settings — admin writes global team config (hiddenTeams, groupOrder).
// Increments version so all polling sessions detect the change within 15 s.
app.put('/api/admin/settings', requireAdmin, express.json(), async (req, res) => {
  if (USE_MOCK) return res.json(_globalTeamConfig);
  const { hiddenTeams, groupOrder } = req.body || {};
  _globalTeamConfig = {
    hiddenTeams: Array.isArray(hiddenTeams) ? hiddenTeams : [],
    groupOrder:  Array.isArray(groupOrder)  ? groupOrder  : [],
    version:     (_globalTeamConfig.version || 0) + 1,
  };
  saveGlobalTeamConfigToDB().catch(() => {});
  res.json(_globalTeamConfig);
});

app.use('/api/kpi-summary',   requireAuth);
app.use('/api/teams',         requireAuth);
app.use('/api/tasks',         requireAuth);
app.use('/api/history',       requireAuth);
app.use('/api/alerts',        requireAuth);
app.use('/api/alert-tasks',   requireAuth);
app.use('/api/loan-summary',  requireAuth);
app.use('/api/loan-detail',   requireAuth);

// --- Start server -------------------------------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`SLA Dashboard backend running on port ${PORT} ? mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'}`);

  // Verify new auth tables exist � must be created via sql/create_new_auth_tables.sql
  if (!USE_MOCK) {
    try {
      const pool = await connectDB();
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ConfigReportUsers')
          RAISERROR('ConfigReportUsers table not found. Run sql/create_new_auth_tables.sql first.', 16, 1);
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ConfigDashboards')
          RAISERROR('ConfigDashboards table not found. Run sql/create_new_auth_tables.sql first.', 16, 1);
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardAccess')
          RAISERROR('DashboardAccess table not found. Run sql/create_new_auth_tables.sql first.', 16, 1);
      `);
      console.log('[startup] auth tables verified (ConfigReportUsers, ConfigDashboards, DashboardAccess).');

      // Auto-migration: add UserSettings column to ConfigReportUsers if not present.
      // Stores each user's dashboard configuration (JSON) in the DB so settings
      // survive localStorage clears and persist across devices / browsers.
      try {
        await pool.request().query(`
          IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE Name = N'UserSettings'
              AND Object_ID = Object_ID(N'ConfigReportUsers')
          )
            ALTER TABLE ConfigReportUsers ADD UserSettings NVARCHAR(MAX) NULL;
        `);
        console.log('[startup] ConfigReportUsers.UserSettings column ready.');
      } catch (e) {
        console.warn('[startup] UserSettings migration skipped:', e.message);
      }

      // Auto-migration: add GlobalSettings column to ConfigDashboards if not present.
      // Stores admin-controlled global team config (hiddenTeams, groupOrder, version).
      try {
        await pool.request().query(`
          IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE Name = N'GlobalSettings'
              AND Object_ID = Object_ID(N'ConfigDashboards')
          )
            ALTER TABLE ConfigDashboards ADD GlobalSettings NVARCHAR(MAX) NULL;
        `);
        console.log('[startup] ConfigDashboards.GlobalSettings column ready.');
      } catch (e) {
        console.warn('[startup] GlobalSettings migration skipped:', e.message);
      }
      await loadGlobalTeamConfig();

      // -- Step 1: Seed ConfigDashboards if empty � capture the real generated ID -
      let seedDashId = SLA_DASHBOARD_ID;
      try {
        const cdRow = await pool.request().query(
          `SELECT TOP 1 DashboardID FROM ConfigDashboards WHERE Name = 'SLA Dashboard'`
        );
        if (cdRow.recordset.length) {
          seedDashId = cdRow.recordset[0].DashboardID;
        } else {
          const inserted = await pool.request().query(
            `INSERT INTO ConfigDashboards (Name, IsActive)
             OUTPUT INSERTED.DashboardID
             VALUES ('SLA Dashboard', 1)`
          );
          seedDashId = inserted.recordset[0].DashboardID;
          console.log('[startup] seeded ConfigDashboards: SLA Dashboard (ID=' + seedDashId + ')');
        }
      } catch (e) {
        console.warn('[startup] ConfigDashboards seed skipped:', e.message);
      }

      // -- Step 2: Seed system admin in ConfigReportUsers if not present --------
      try {
        const existing = await pool.request().query(
          `SELECT TOP 1 cru.UserId FROM ConfigReportUsers cru
           INNER JOIN Staff s ON cru.StaffId = s.StaffID
           WHERE s.FirstName = 'System'`
        );

        if (!existing.recordset.length) {
          // Look for an existing Staff record with FirstName = 'System'
          let staffId;
          let adminEmail = 'system@admin.local';
          const sysStaff = await pool.request().query(
            `SELECT TOP 1 StaffID, ISNULL(EmailAddress,'system@admin.local') AS EmailAddress FROM Staff WHERE FirstName = 'System'`
          );
          if (sysStaff.recordset.length) {
            staffId    = sysStaff.recordset[0].StaffID;
            adminEmail = sysStaff.recordset[0].EmailAddress;
            console.log('[startup] found existing System staff, StaffID =', staffId, '| email:', adminEmail);
          } else {
            // StaffID is NOT IDENTITY � reserve -1 for system account
            await pool.request().query(
              `INSERT INTO Staff (StaffID, FirstName, Surname, EmailAddress, OfficeId, EmployeeStatus, IsGroup)
               VALUES (-1, 'System', 'Admin', 'system@admin.local', 0, 1, 0)`
            );
            staffId    = -1;
            adminEmail = 'system@admin.local';
            console.log('[startup] created System staff record (StaffID=-1)');
          }

          // Hash the default password
          const defaultHash = await bcrypt.hash('@dmin', 12);

          // Insert ConfigReportUsers
          const newUser = await pool.request()
            .input('staffId', sql.Int,              staffId)
            .input('hash',    sql.NVarChar(sql.MAX), defaultHash)
            .query(`INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt)
                    OUTPUT INSERTED.UserId
                    VALUES (@staffId, @hash, GETDATE())`);
          const userId = newUser.recordset[0].UserId;

          // Grant admin access in DashboardAccess
          await pool.request()
            .input('userId', sql.Int, userId)
            .input('dashId', sql.Int, seedDashId)
            .query(`INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
                    VALUES (@dashId, @userId, 'admin', 1)`);

          console.log('[startup] seeded system admin � email:', adminEmail, ' password: @dmin');
          console.log('[startup] *** Change this password after first login ***');
        } else {
          console.log('[startup] system admin already exists � seed skipped.');
        }
      } catch (e) {
        console.warn('[startup] system admin seed skipped:', e.message);
      }
    } catch (e) {
      console.warn('[startup] auth table check:', e.message);
    }
  }

  // Pre-warm the KPI and Teams caches sequentially on startup.
  // Sequential (not concurrent) to avoid overwhelming the SQL pool with multiple
  // long-running cold-disk queries simultaneously, which can crash the process.
  if (!USE_MOCK) {
    (async () => {
      // Resolve effective reporting date before warming caches.
      await resolveEffectiveDate();
      setInterval(resolveEffectiveDate, 60 * 60 * 1000);

      // Discover dynamic KPI groups before first cache warm so team cards include them.
      // Also runs every 60 s independently so new ConfigTasks entries appear within ~1 min
      // without requiring a backend restart or waiting for the 5-min teams cache to expire.
      await refreshAllTeams().catch(err =>
        console.warn('[startup] teams refresh failed (non-fatal):', err.message)
      );
      setInterval(
        () => refreshAllTeams().catch(err => console.warn('[teams] interval refresh failed:', err.message)),
        60 * 1000
      );

      // History (90-day scan) is intentionally excluded from startup warmup.
      // It is expensive on cold start and can exhaust the connection pool.
      // It will be warmed on the first real request to /api/history.
      const warmups = [
        ['kpi',   fetchKpiData],
        ['teams', fetchTeamsData],
      ];
      for (const [key, fn] of warmups) {
        try {
          console.log(`[cache] warming ${key}...`);
          await fn().then(data => {
            _cache[key].data = data;
            _cache[key].ts   = Date.now();
            console.log(`[cache] ${key} ready`);
          });
        } catch (err) {
          console.warn(`[cache] ${key} warm-up failed (will retry on first request):`, err.message);
        }
      }
    })();
  }
});
