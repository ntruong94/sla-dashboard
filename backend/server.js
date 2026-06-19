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
// 8 teams mapped to either Staff.DepartmentId (dept-based) or a loan status
// pattern via REPORT_Loans_Extension -> ConfigLoanStatus (loan_status-based).
// Only dept-based teams require s.EmployeeStatus = 1.
const TEAMS = [
  { id: 1, name: 'Data Entry',        dept: 'Origination',  target: 4, departmentId: 101 },
  { id: 2, name: 'Valuations',        dept: 'Origination',  target: 4, departmentId: 110 },
  { id: 3, name: 'Assessments',       dept: 'Credit',       target: 4, departmentId: 86  },
  { id: 4, name: 'Packaging & QA',    dept: 'Credit',       target: 4, departmentId: 122 },
  // Teams 5 & 6 identified by the application's current ConfigLoanStatus.Name
  // via: LEFT JOIN REPORT_Loans_Extension rle ON t.ApplicationID = rle.ApplicationID
  //       LEFT JOIN ConfigLoanStatus cls ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
  { id: 5, name: 'CLA',               dept: 'Credit',       target: 4, departmentId: null,
    type: 'loan_status',
    clsFilter: "cls.Name LIKE N'%CLA%'" },
  { id: 6, name: 'Funder Submission', dept: 'Credit',       target: 4, departmentId: null,
    type: 'loan_status',
    clsFilter: "(cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')" },
  { id: 7, name: 'Settlement',        dept: 'Settlement',   target: 4, departmentId: 82  },
  { id: 8, name: 'Ezy Client Care',   dept: 'Client Care',  target: 4, departmentId: 10  },
];
const DEPT_TEAM_IDS = TEAMS.filter(t => t.departmentId).map(t => t.departmentId); // [101,110,86,122,12,10]

// --- Date helpers for KPI delta (vs previous business day) -------------------
// TODAY_FIXED: override date for testing. Set to null to use real local clock.
// Set to '2026-05-28' � last date with actual task data in the backed-up DB snapshot.
const TODAY_FIXED = '2026-05-28';
// Returns today's date as YYYY-MM-DD using local clock (not UTC � avoids AEST off-by-one)
function todayLocal() {
  if (TODAY_FIXED) return TODAY_FIXED;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function prevBizDay(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offset = dow === 1 ? -3 : dow === 0 ? -2 : -1; // Mon?Fri, Sun?Fri, else -1
  d.setDate(d.getDate() + offset);
  // Use local date parts � toISOString() would return UTC and lose a day in AEST
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
function computeDates() {
  const today = todayLocal();
  const prev  = prevBizDay(today);
  return { today, prev, todayNext: nextDay(today), prevNext: nextDay(prev) };
}

// Build SQL CASE expressions mapping tasks -> team id / name (1-8).
// CRITICAL: loan_status teams (5 & 6) MUST have HIGHER precedence than dept-based teams (1-4, 7-8).
// If a task's AssignedTo has DepartmentId 86 (Assessments) but the task also matches Funder Submission
// ConfigLoanStatus.Name, it MUST report as team 6, NOT team 3. So we check cls filters FIRST.
// Requires: LEFT JOIN Staff s ON t.AssignedTo = s.StaffID
//           LEFT JOIN REPORT_Loans_Extension rle ON t.ApplicationID = rle.ApplicationID
//           LEFT JOIN ConfigLoanStatus cls ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
const loanStatusTeams = TEAMS.filter(t => !t.departmentId);  // teams 5, 6
const deptTeams       = TEAMS.filter(t => t.departmentId);   // teams 1-4, 7-8
const TEAM_ID_CASE = [
  ...loanStatusTeams.map(t => `WHEN ${t.clsFilter} THEN ${t.id}`),
  ...deptTeams.map(t => `WHEN s.DepartmentId = ${t.departmentId} THEN ${t.id}`)
].join(' ');
const TEAM_NAME_CASE = [
  ...loanStatusTeams.map(t => `WHEN ${t.clsFilter} THEN '${t.name}'`),
  ...deptTeams.map(t => `WHEN s.DepartmentId = ${t.departmentId} THEN '${t.name}'`)
].join(' ');
// WHERE predicate: dept-based teams by Staff.DepartmentId; loan_status teams by cls.Name.
const LOAN_STATUS_TEAMS = TEAMS.filter(t => t.type === 'loan_status');
const TEAM_FILTER = `(
  (s.DepartmentId IN (${DEPT_TEAM_IDS.join(',')}) AND s.EmployeeStatus = 1)
  OR ${LOAN_STATUS_TEAMS.map(t => t.clsFilter).join(' OR ')}
)`;
// SQL JOINs required for loan_status teams (safe to include in all queries as LEFT JOINs).
const LOAN_STATUS_JOIN = `
      LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
      LEFT JOIN ConfigLoanStatus       cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId`;

// --- Custom-target helpers ----------------------------------------------------
// Parse ?t1=2&t2=4&t3=4&t4=4&t5=4&t6=4 into { 1: 2.0, 2: 4.0, ... }
function parseTargets(query) {
  const out = {};
  TEAMS.forEach(team => {
    const val = parseFloat(query[`t${team.id}`]);
    if (val > 0) out[team.id] = val;
  });
  return out;
}
// Build a SQL CASE expression that returns the custom target hours for each team
// (based on the team-identifying column), falling back to t.SLAInHours for
// teams that don't have a custom target configured.
function buildTargetExpr(customTargets) {
  if (!customTargets || Object.keys(customTargets).length === 0) return 't.SLAInHours';
  const cases = TEAMS.map(team => {
    const h = customTargets[team.id];
    if (!h) return null;
    return team.departmentId
      ? `WHEN s.DepartmentId = ${team.departmentId} THEN ${h}`
      : `WHEN ${team.clsFilter} THEN ${h}`;
  }).filter(Boolean);
  if (cases.length === 0) return 't.SLAInHours';
  return `CASE ${cases.join(' ')} ELSE t.SLAInHours END`;
}

// --- TAT SQL expressions ------------------------------------------------------
// NOW_SQL: the SQL expression used as "current time" in open-task TAT calculations.
// When TODAY_FIXED is set (snapshot DB), we use the end of the snapshot day so that
// TAT is measured within the snapshot day, not against real time weeks later.
// In live mode (TODAY_FIXED = null), GETDATE() is the correct real-time reference.
const NOW_SQL = TODAY_FIXED
  ? `CAST('${nextDay(TODAY_FIXED)}' AS DATETIME)`
  : `GETDATE()`;

// Elapsed hours for OPEN (active) tasks � real-time: NOW_SQL minus creation time.
// Use for all overdue / at-risk / avgTat calculations on active tasks.
const OPEN_TAT_EXPR   = `DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0`;
// Elapsed hours for CLOSED (completed) tasks � DateCompleted minus DateCreated.
// Use for SLA compliance checks and avgTat on completed tasks.
const CLOSED_TAT_EXPR = `DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0`;

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
    c.pending = fetchFn()
      .then(data => { c.data = data; c.ts = Date.now(); })
      .catch(err  => { console.error(`[cache ${key} refresh failed]`, err.message); })
      .finally(()  => { c.pending = null; });
  }
  if (c.data)    return Promise.resolve(c.data); // serve stale while refreshing
  if (c.pending) return c.pending;               // wait for first load
  return Promise.reject(new Error(`[cache ${key}] no data and no pending fetch`));
}

async function fetchKpiData(customTargets = {}) {
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const targetExpr = buildTargetExpr(customTargets);

  // Two parallel queries:
  // Q1: totalTasks, avgTat, totalOverdue � active/all tasks, filtered by DateCreated.
  //     TAT for open tasks = GETDATE() - DateCreated (real-time elapsed).
  //     TAT for closed tasks = DateCompleted - DateCreated.
  // Q2: overallSla � completed tasks (status=2), filtered by DateCompleted.
  //     SLA compliance = DATEDIFF(DateCreated, DateCompleted) <= configured target.
  const [mainRes, slaRes] = await Promise.all([
    pool.request().query(`
      SELECT
        -- volume = active tasks created today
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 THEN 1 ELSE 0 END)                                              AS totalTasks,
        -- overdue = open tasks where real-time TAT > configured SLA target OR past SLAAdjustedDate
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr}
                      OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END)                                              AS totalOverdue,
        -- avgTat = mean elapsed hours across all tasks created today
        --          open tasks: GETDATE()-DateCreated; closed: DateCompleted-DateCreated
        AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                           THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                           ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
                      END ELSE NULL END)                                          AS avgTat,
        -- prev biz day equivalents for deltas
        SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 THEN 1 ELSE 0 END)                                              AS prevTasks,
        SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr}
                      OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END)                                              AS prevOverdue,
        AVG(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                           THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                           ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
                      END ELSE NULL END)                                          AS prevTat
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
    `),
    // SLA% uses DateCompleted � completed tasks regardless of when they were created.
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
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID = 2
        AND ${TEAM_FILTER}
        AND t.DateCompleted >= '${prev}' AND t.DateCompleted < '${todayNext}'
    `),
  ]);

  const r   = mainRes.recordset[0];
  const sla = slaRes.recordset[0];
  return {
    totalTasks:   r.totalTasks   || 0,
    overallSla:   parseFloat((sla.overallSla || 0).toFixed(2)),
    avgTat:       Math.round((r.avgTat       || 0) * 10) / 10,
    totalOverdue: r.totalOverdue || 0,
    deltas: {
      totalTasks:   (r.totalTasks   || 0) - (r.prevTasks   || 0),
      overallSla:   parseFloat(((sla.overallSla || 0) - (sla.prevSla || 0)).toFixed(2)),
      avgTat:       Math.round(((r.avgTat       || 0) - (r.prevTat   || 0)) * 10) / 10,
      totalOverdue: (r.totalOverdue || 0) - (r.prevOverdue || 0),
      today,
      prevBizDay:   prev,
    },
  };
}

async function fetchTeamsData(customTargets = {}) {
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const targetExpr = buildTargetExpr(customTargets);
  const claFilter = TEAMS.find(t => t.id === 5)?.clsFilter || '1=0';
  const funderFilter = TEAMS.find(t => t.id === 6)?.clsFilter || '1=0';
  const claTarget = customTargets[5] || TEAMS.find(t => t.id === 5)?.target || 4;
  const funderTarget = customTargets[6] || TEAMS.find(t => t.id === 6)?.target || 4;

  // Three parallel queries:
  // Q1: volume, avgTat, overdue � active/all tasks, DateCreated today.
  //     TAT for open tasks = GETDATE()-DateCreated; closed = DateCompleted-DateCreated.
  // Q2: volume/overdue/TAT deltas � DateCreated today + prev.
  // Q3: SLA% per team � completed tasks (status=2), DateCompleted today + prev.
  //     SLA compliance = DATEDIFF(DateCreated, DateCompleted) <= configured target.
  //     targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
  // Q4: raw active metrics/day deltas for loan_status teams only (CLA/Funder),
  //     independent from TEAM_ID_CASE precedence so these cards reflect clsFilter counts.
  const [result, delta, slaResult, loanStatusRaw] = await Promise.all([
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        -- volume: active tasks only
        SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6) THEN 1 ELSE 0 END)           AS volume,
        -- avgTat: real-time elapsed hours per task
        --         open tasks: GETDATE()-DateCreated; closed: DateCompleted-DateCreated
        AVG(CASE WHEN t.TaskStatusID IN (1,4,5,6)
                 THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                 ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0
            END)                                                                    AS avgTat,
        -- overdue: open tasks where real-time TAT > configured SLA target OR past SLAAdjustedDate
        SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6)
                 AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr}
                      OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    // Delta query: volume/overdue/TAT only � all date-scoped by DateCreated
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
        SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr} OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS todayOverdue,
        SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr} OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS prevOverdue,
        AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' THEN CASE WHEN t.TaskStatusID IN (1,4,5,6) THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS todayTat,
        AVG(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  THEN CASE WHEN t.TaskStatusID IN (1,4,5,6) THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS prevTat
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    // SLA% query: completed tasks only, date-scoped by DateCompleted.
    // Compliance uses a combined OR rule (count once):
    //   (closed-task TAT <= targetExpr) OR (DateCompleted <= SLAAdjustedDate when SLAAdjustedDate exists).
    // targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                   AND (
                     DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                     OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                   )
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS todaySla,
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
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID = 2
        AND ${TEAM_FILTER}
        AND t.DateCompleted >= '${prev}' AND t.DateCompleted < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
        pool.request().query(`
      SELECT 5 AS teamId,
             SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
           SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
           SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6)
              AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${claTarget}
                   OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
              THEN 1 ELSE 0 END) AS todayOverdue,
           SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6)
              AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${claTarget}
                   OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
              THEN 1 ELSE 0 END) AS prevOverdue,
           AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
              THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                  THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                  ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END
              ELSE NULL END) AS todayTat,
           AVG(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'
              THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                  THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                  ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END
                      ELSE NULL END) AS prevTat,
             CAST(
               SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                        AND t.TaskStatusID = 2
                        AND (
                          DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${claTarget}
                          OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                        )
                        THEN 1 ELSE 0 END) AS FLOAT)
               / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                                 AND t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
             CAST(
               SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                        AND t.TaskStatusID = 2
                        AND (
                          DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${claTarget}
                          OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                        )
                        THEN 1 ELSE 0 END) AS FLOAT)
               / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                                 AND t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS prevSla
      FROM Tasks t WITH (NOLOCK)
      ${LOAN_STATUS_JOIN}
      WHERE ${claFilter}
      UNION ALL
      SELECT 6 AS teamId,
             SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
             SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
             SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' AND t.TaskStatusID IN (1,4,5,6)
                      AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${funderTarget}
                           OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                      THEN 1 ELSE 0 END) AS todayOverdue,
             SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  AND t.TaskStatusID IN (1,4,5,6)
                      AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${funderTarget}
                           OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                      THEN 1 ELSE 0 END) AS prevOverdue,
             AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                      THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                                THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                                ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END
                      ELSE NULL END) AS todayTat,
             AVG(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'
                      THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                                THEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0
                                ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END
                      ELSE NULL END) AS prevTat,
             CAST(
               SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                        AND t.TaskStatusID = 2
                        AND (
                          DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${funderTarget}
                          OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                        )
                        THEN 1 ELSE 0 END) AS FLOAT)
               / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                                 AND t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
             CAST(
               SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                        AND t.TaskStatusID = 2
                        AND (
                          DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${funderTarget}
                          OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
                        )
                        THEN 1 ELSE 0 END) AS FLOAT)
               / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                                 AND t.TaskStatusID = 2 THEN 1 ELSE 0 END), 0) * 100 AS prevSla
      FROM Tasks t WITH (NOLOCK)
      ${LOAN_STATUS_JOIN}
      WHERE ${funderFilter}
    `),
  ]);

  const round1 = v => Math.round((v || 0) * 10) / 10;
  const rawByTeam = new Map((loanStatusRaw.recordset || []).map(r => [r.teamId, r]));
  return TEAMS.map(team => {
    const row = result.recordset.find(r => r.teamId === team.id) || {};
    const d   = delta.recordset.find(r => r.teamId === team.id)  || {};
    const sla = slaResult.recordset.find(r => r.teamId === team.id) || {};
    const raw = rawByTeam.get(team.id) || {};
    const isLoanStatusTeam = team.id === 5 || team.id === 6;
    const volume = isLoanStatusTeam ? (raw.todayVol || 0) : (row.volume || 0);
    const avgTat = isLoanStatusTeam ? round1(raw.todayTat) : round1(row.avgTat);
    const overdue = isLoanStatusTeam ? (raw.todayOverdue || 0) : (row.overdue || 0);
    const volumeDelta = isLoanStatusTeam
      ? ((raw.todayVol || 0) - (raw.prevVol || 0))
      : ((d.todayVol || 0) - (d.prevVol || 0));
    const avgTatDelta = isLoanStatusTeam
      ? round1((raw.todayTat || 0) - (raw.prevTat || 0))
      : round1((d.todayTat || 0) - (d.prevTat || 0));
    const overdueDelta = isLoanStatusTeam
      ? ((raw.todayOverdue || 0) - (raw.prevOverdue || 0))
      : ((d.todayOverdue || 0) - (d.prevOverdue || 0));
    const slaValue = isLoanStatusTeam ? Math.round(raw.todaySla || 0) : Math.round(sla.todaySla || 0);
    const slaDelta = isLoanStatusTeam
      ? parseFloat((((raw.todaySla || 0) - (raw.prevSla || 0)).toFixed(1)))
      : parseFloat((((sla.todaySla || 0) - (sla.prevSla || 0))).toFixed(1));
    return {
      id:      team.id,
      name:    team.name,
      dept:    team.dept,
      target:  team.target,
      volume,
      sla:     slaValue,
      avgTat,
      overdue,
      deltas: {
        volume:  volumeDelta,
        sla:     slaDelta,
        avgTat:  avgTatDelta,
        overdue: overdueDelta,
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
    return res.json({ status: 'OK', mode: 'mock', message: 'Mock mode � no DB connection attempted.' });
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
    // Bypass cache when custom targets are set � serve fresh data with the correct thresholds.
    res.json(hasCustom ? await fetchKpiData(customTargets) : await getCached('kpi', fetchKpiData));
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
    // atRiskFraction: default 87.5%, configurable via ?atRiskPct=N (clamped 50�99)
    const atRiskFraction = Math.min(0.99, Math.max(0.50, parseFloat(req.query.atRiskPct || 87.5) / 100));

    // Tasks are mapped to teams via Staff.DepartmentId (AssignedTo ? Staff ? DepartmentId).
    // SLARemaining comes from TaskRelation (IsCurrent = 1 row).
    // Limited to TOP 500 sorted by worst SLA first to avoid timeout on large datasets.
    // TaskRelation join removed � expensive on large tables; SLARemaining set to NULL.
    let query = `
      SELECT TOP 500
        t.TaskID,
        CONVERT(VARCHAR(10), t.DateCreated, 103) AS CreateDte,
        CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) AS SLAAdjustedDte,
        t.TaskName,
        t.ShortDescription,
        t.CreatedBy,
        t.TotalHoursOnTask,
        t.TotalHoursOnTask_BH,
        t.SLAInHours,
        t.SoEzySLA,
        NULL           AS SLARemaining,
        t.DateCreated,
        t.Priority,
        t.TaskStatusID,
        ts.TaskStatus,
        CASE ${TEAM_ID_CASE} END AS QueueId,
        CASE ${TEAM_NAME_CASE} END AS QueueName,
        t.AssignedTo,
        s.FirstName    AS AssignedToName,
        RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
        ISNULL(s.IsGroup, 0) AS AssignedToIsGroup,
        RTRIM(ISNULL(cb.FirstName,'') + ISNULL(' ' + cb.Surname, '')) AS CreatedByFullName,
        ISNULL(cb.IsGroup, 0) AS CreatedByIsGroup,
        ISNULL(cls.Name, '') AS ConfigLoanStatusName,
        CASE
          WHEN t.SLAInHours IS NULL OR t.SLAInHours = 0 THEN 'ok'
          WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > t.SLAInHours THEN 'bad'
          WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 >= t.SLAInHours * ${atRiskFraction} THEN 'warn'
          ELSE 'ok'
        END AS status
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
      LEFT  JOIN Staff s             WITH (NOLOCK) ON t.AssignedTo   = s.StaffID
      LEFT  JOIN Staff cb            WITH (NOLOCK) ON t.CreatedBy    = cb.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID IN (1, 4, 5, 6)  -- In Progress, On Hold, On Queue, Not Queued
        AND ${TEAM_FILTER}
    `;

    if (team) {
      // team param = TEAMS.id (1�6); expand to DepartmentId filter
      const teamDef = TEAMS.find(t => t.id === parseInt(team));
      if (teamDef) {
        if (teamDef.departmentId) {
          // dept-based team: filter by Staff.DepartmentId
          query += ` AND s.DepartmentId = ${teamDef.departmentId} AND s.EmployeeStatus = 1`;
        } else {
          // loan_status-based team (CLA/Funder Submission): filter by ConfigLoanStatus.Name
          query += ` AND ${teamDef.clsFilter}`;
        }
      }
    }
    if (status === 'ok') {
      query += ` AND (t.SLAInHours IS NULL OR t.SLAInHours = 0 OR DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 < t.SLAInHours * ${atRiskFraction})`;
    } else if (status === 'warn') {
      query += ` AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 >= t.SLAInHours * ${atRiskFraction} AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 <= t.SLAInHours AND (t.SLAAdjustedDate IS NULL OR ${NOW_SQL} <= t.SLAAdjustedDate)`;
    } else if (status === 'bad') {
      query += ` AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))`;
    }
    if (scope === 'today') {
      query += ` AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'`;
    }
    query += ` ORDER BY DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 DESC`;

    const result = await request.query(query);
    // For teams 5 & 6 (CLA & Funder Submission), append ConfigLoanStatusName to ShortDescription
    const tasks = result.recordset.map(task => {
      if ((task.QueueId === 5 || task.QueueId === 6) && task.ConfigLoanStatusName) {
        return {
          ...task,
          ShortDescription: task.ShortDescription + ' / ' + task.ConfigLoanStatusName
        };
      }
      return task;
    });
    res.json(tasks);
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
  // No explicit timeout � inherits 180s from db.js (needed for cold-start full scan)
  const targetExpr = buildTargetExpr(customTargets);
  const refDate = TODAY_FIXED ? new Date(TODAY_FIXED + 'T00:00:00') : new Date();
  request.input('startDate', sql.DateTime, new Date(refDate.getTime() - days * 24 * 60 * 60 * 1000));
  const result = await request.query(`
      SELECT
        CONVERT(varchar(10), t.DateCompleted, 120)                             AS Date,
        CASE ${TEAM_ID_CASE} END                                               AS teamId,
        COUNT(*)                                                               AS total,
        SUM(CASE WHEN (
              DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
              OR (t.SLAAdjustedDate IS NOT NULL AND t.DateCompleted <= t.SLAAdjustedDate)
            ) THEN 1 ELSE 0 END) AS compliant
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID = 2
        AND t.DateCompleted >= @startDate
        AND t.DateCompleted IS NOT NULL
        AND t.DateCreated IS NOT NULL
        AND t.SLAInHours > 0
        AND ${TEAM_FILTER}
      GROUP BY CONVERT(varchar(10), t.DateCompleted, 120), CASE ${TEAM_ID_CASE} END
    `);
  const aggRows = result.recordset;
  const dateSet = [...new Set(aggRows.map(r => r.Date))].sort();
  const byTeamMap = {};
  for (const row of aggRows) {
    const team = TEAMS.find(t => t.id === row.teamId);
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
// Derived from active-task breach thresholds � no alerts table in the DB.
// Returns array: [{ id, severity, title, desc, triggeredAt, queueId }]
//
// _alertFirstSeen: persists the first time each alert condition was detected.
// Key = "<teamId>-<severity>" � survives API re-calls so "3h ago" stays accurate.
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
          desc:  `${row.total} active tasks today, ${row.compliant} file${row.compliant !== 1 ? 's' : ''} complete, ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue, SLA at ${pct}%.`,
          triggeredAt, queueId: row.QueueId,
        });
      } else {
        alerts.push({
          id: `a-${key}`, severity,
          title: `${row.QueueName} SLA at risk`,
          desc:  `${row.total} active tasks today, ${row.compliant} file${row.compliant !== 1 ? 's' : ''} complete, ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue, SLA at ${pct}%.`,
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
    const { today, todayNext } = computeDates();
    const alertTargets = parseTargets(req.query);
    const alertTargetExpr = buildTargetExpr(alertTargets);
    const result = await pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END                                                AS teamId,
        COUNT(*)                                                                AS total,
        SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 <= ${alertTargetExpr}
                      AND (t.SLAAdjustedDate IS NULL OR ${NOW_SQL} <= t.SLAAdjustedDate) THEN 1 ELSE 0 END) AS compliant,
        SUM(CASE WHEN (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${alertTargetExpr} OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate)) THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      ${LOAN_STATUS_JOIN}
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
        AND ${TEAM_FILTER}
      GROUP BY CASE ${TEAM_ID_CASE} END
    `);
    // Attach team name from TEAMS definition before generating alerts
    const rows = result.recordset.map(r => {
      const team = TEAMS.find(t => t.id === r.teamId) || {};
      return { ...r, QueueId: r.teamId, QueueName: team.name || `Team ${r.teamId}` };
    });
    res.json(buildAlerts(rows));
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Alert task drill-down ----------------------------------------------------
// Returns top 50 active tasks for a team that are at-risk or overdue.
// Query param: ?atRiskPct=87.5 (default 87.5 � matches frontend DEFAULT_SETTINGS)
app.get('/api/alert-tasks/:teamId', async (req, res) => {
  const teamId  = parseInt(req.params.teamId, 10);
  const teamDef = TEAMS.find(t => t.id === teamId);
  if (!teamDef) return res.status(404).json({ error: 'Team not found' });
  const { today, todayNext } = computeDates();

  // atRiskFraction: clamped to [0.50, 0.99] to prevent nonsensical values
  const atRiskFraction = Math.min(0.99, Math.max(0.50, parseFloat(req.query.atRiskPct || 87.5) / 100));
  // customTarget: optional override for this team's SLA hours (from Settings)
  const customTargetH = parseFloat(req.query.customTarget);
  const slaExpr = (customTargetH > 0) ? customTargetH.toString() : 't.SLAInHours';

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
    // Dept-based teams filter by Staff.DepartmentId; loan_status teams filter by ConfigLoanStatus.Name.
    // Loan_status teams also need REPORT_Loans_Extension + ConfigLoanStatus joins.
    let teamFilter, extraJoin;
    if (teamDef.departmentId) {
      teamFilter = `s.DepartmentId = ${teamDef.departmentId} AND s.EmployeeStatus = 1`;
      extraJoin  = '';
    } else {
      teamFilter = teamDef.clsFilter;
      extraJoin  = `
      LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
      LEFT JOIN ConfigLoanStatus       cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId`;
    }
    const staffJoin = `LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID${extraJoin}`;
    // UNION guarantees both overdue (real-time TAT > SLA) and at-risk tasks are shown.
    // TAT = DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0 for all active tasks.
    // slaExpr: custom target hours from Settings if configured, else DB t.SLAInHours.
    const result = await pool.request().query(`
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          CONVERT(VARCHAR(10), t.DateCreated, 103) AS CreateDte,
          CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) AS SLAAdjustedDte,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.SLAInHours,
          ROUND(DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0, 1) AS TatHours,
          ${slaExpr} AS TargetHours,
          LOWER(ISNULL(CONVERT(VARCHAR(20), t.Priority), 'low')) AS Priority,
          t.OverDueComments,
          CASE
            WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${slaExpr}
              THEN ROUND(DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 - ${slaExpr}, 1)
            WHEN t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate
              THEN ROUND(DATEDIFF(MINUTE, t.SLAAdjustedDate, ${NOW_SQL}) / 60.0, 1)
            ELSE 0
          END AS overdueHours,
          'overdue' AS taskType,
          RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
          AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
          AND ${teamFilter}
          AND ${slaExpr} > 0
          AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${slaExpr} OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
        ORDER BY DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 / ${slaExpr} DESC
      ) AS Overdue
      UNION ALL
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          CONVERT(VARCHAR(10), t.DateCreated, 103) AS CreateDte,
          CONVERT(VARCHAR(10), t.SLAAdjustedDate, 103) AS SLAAdjustedDte,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.SLAInHours,
          ROUND(DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0, 1) AS TatHours,
          ${slaExpr} AS TargetHours,
          LOWER(ISNULL(CONVERT(VARCHAR(20), t.Priority), 'low')) AS Priority,
          t.OverDueComments,
          0 AS overdueHours,
          'atrisk' AS taskType,
          RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
          AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
          AND ${teamFilter}
          AND ${slaExpr} > 0
          AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 >= ${slaExpr} * ${atRiskFraction}
          AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 <= ${slaExpr}
          AND (t.SLAAdjustedDate IS NULL OR ${NOW_SQL} <= t.SLAAdjustedDate)
        ORDER BY DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 / ${slaExpr} DESC
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
// Returns: { received, approved, settled } � each: { count, amount, deltas: { count, amount } }
app.get('/api/loan-summary', async (req, res) => {
  try {
    const pool = await connectDB();
    const { today, prev, todayNext, prevNext } = computeDates();

    const loanQuery = (col) => pool.request().query(`
      SELECT
        SUM(CASE WHEN ${col} >= '${today}' AND ${col} < '${todayNext}' THEN 1 ELSE 0 END)                                                          AS todayCount,
        ISNULL(SUM(CASE WHEN ${col} >= '${today}' AND ${col} < '${todayNext}' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0)                           AS todayAmt,
        SUM(CASE WHEN ${col} >= '${prev}'  AND ${col} < '${prevNext}'  THEN 1 ELSE 0 END)                                                          AS prevCount,
        ISNULL(SUM(CASE WHEN ${col} >= '${prev}'  AND ${col} < '${prevNext}'  THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0)                           AS prevAmt
      FROM Loans WITH (NOLOCK)
      WHERE ${col} >= '${prev}' AND ${col} < '${todayNext}'
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
      return {
        count:  todayCount,
        amount: todayAmt,
        deltas: { count: todayCount - prevCount, amount: todayAmt - prevAmt },
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

// SLA Dashboard ID in ConfigDashboards — matches the actual row in the DB.
// Query: SELECT DashboardID FROM ConfigDashboards WHERE Name='SLA Dashboard'
const SLA_DASHBOARD_ID = 0;

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid � please log in again' });
  }
}

// --- Auth endpoints (public � no requireAuth) ---------------------------------

// POST /api/auth/forgot-password
// Public � generates a time-limited reset token and returns it directly
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
// Public � validates token, updates password, clears token
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
  const { email, password, companyName } = req.body || {};
  if (!email || !password || !companyName)
    return res.status(400).json({ error: 'Email, password and company name are required.' });
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
    await pool.request()
      .input('staffId', sql.Int,           staffId)
      .input('hash',    sql.NVarChar(sql.MAX), hash)
      .query(`INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt)
              VALUES (@staffId, @hash, GETDATE())`);
    res.json({ message: 'Signup successful. Your account is pending admin approval.' });
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
    // Same error for wrong email OR wrong password — avoids user enumeration
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

// GET /api/admin/users � list all registered users (admin only)
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

// POST /api/admin/users/:id/approve � approve a pending user (admin only)
app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    // Upsert DashboardAccess — grant active access to this dashboard
    await pool.request()
      .input('id',     sql.Int, id)
      .input('dashId', sql.Int, SLA_DASHBOARD_ID)
      .query(`IF EXISTS (SELECT 1 FROM DashboardAccess WHERE UserId = @id AND ConfigDashboardId = @dashId)
                UPDATE DashboardAccess SET IsActive = 1
                WHERE UserId = @id AND ConfigDashboardId = @dashId
              ELSE
                INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
                VALUES (@dashId, @id, 'viewer', 1)`);
    res.json({ message: 'User approved.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// DELETE /api/admin/users/:id — permanently remove a user’s registration (admin only)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    // Remove access rows first (FK), then the user row
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM DashboardAccess WHERE UserId = @id');
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM ConfigReportUsers WHERE UserId = @id');
    res.json({ message: 'User removed.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// POST /api/admin/users/:id/reject — reject a user (admin only)
app.post('/api/admin/users/:id/reject', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    // Upsert DashboardAccess — revoke access to this dashboard
    await pool.request()
      .input('id',     sql.Int, id)
      .input('dashId', sql.Int, SLA_DASHBOARD_ID)
      .query(`IF EXISTS (SELECT 1 FROM DashboardAccess WHERE UserId = @id AND ConfigDashboardId = @dashId)
                UPDATE DashboardAccess SET IsActive = 0
                WHERE UserId = @id AND ConfigDashboardId = @dashId
              ELSE
                INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
                VALUES (@dashId, @id, 'viewer', 0)`);
    res.json({ message: 'User rejected.' });
  } catch (err) {
    sendError(res, 500, 'Internal server error', err);
  }
});

// --- Staff List ---------------------------------------------------------------
// GET /api/staff/departments  � all departments with active staff count (ordered high ? low)
// GET /api/staff/department/:id � active staff detail for one department
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

// --- Protect all data endpoints with JWT -------------------------------------
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
  console.log(`SLA Dashboard backend running on port ${PORT} � mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'}`);

  // Verify new auth tables exist — must be created via sql/create_new_auth_tables.sql
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

      // Seed default system admin if system@admin.local account doesn't exist yet
      try {
        const existing = await pool.request().query(
          `SELECT TOP 1 cru.UserId FROM ConfigReportUsers cru
           INNER JOIN Staff s ON cru.StaffId = s.StaffID
           WHERE s.EmailAddress = 'system@admin.local'`
        );

        if (!existing.recordset.length) {
          // Find or create a Staff record for the system account
          let staffId;
          const sysStaff = await pool.request().query(
            `SELECT TOP 1 StaffID FROM Staff WHERE FirstName = 'System' AND EmailAddress = 'system@admin.local'`
          );
          if (sysStaff.recordset.length) {
            staffId = sysStaff.recordset[0].StaffID;
          } else {
            // StaffID is NOT IDENTITY — use -1 as reserved system account
            await pool.request().query(
              `INSERT INTO Staff (StaffID, FirstName, Surname, EmailAddress, OfficeId, EmployeeStatus, IsGroup)
               VALUES (-1, 'System', 'Admin', 'system@admin.local', 0, 1, 0)`
            );
            staffId = -1;
          }

          // Hash the default password
          const defaultHash = await bcrypt.hash('@dmin', 12);

          // Insert ConfigReportUsers
          const newUser = await pool.request()
            .input('staffId', sql.Int,           staffId)
            .input('hash',    sql.NVarChar(sql.MAX), defaultHash)
            .query(`INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt)
                    OUTPUT INSERTED.UserId
                    VALUES (@staffId, @hash, GETDATE())`);
          const userId = newUser.recordset[0].UserId;

          // Grant admin access
          await pool.request()
            .input('userId', sql.Int, userId)
            .input('dashId', sql.Int, SLA_DASHBOARD_ID)
            .query(`INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
                    VALUES (@dashId, @userId, 'admin', 1)`);

          console.log('[startup] seeded default system admin — email: system@admin.local  password: @dmin');
          console.log('[startup] *** Change this password after first login ***');
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
      const warmups = [
        ['kpi',     fetchKpiData],
        ['teams',   fetchTeamsData],
        ['history', () => fetchHistoryData('90d')],
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
