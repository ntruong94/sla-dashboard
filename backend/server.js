const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
require('dotenv').config();
const { sql, connectDB } = require('./db');
const mock = require('./mock-data');

// â”€â”€â”€ Team definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All 6 teams are now filtered by Staff.DepartmentId â€” ConfigQueue.QueueId is NOT used.
// Only Staff rows with EmployeeStatus = 1 are used for team identification.
const TEAMS = [
  { id: 1, name: 'Data Entry',                dept: 'Origination',  target: 4, departmentId: 101 },
  { id: 2, name: 'Pre-Valuation Department',  dept: 'Origination',  target: 4, departmentId: 128 },
  { id: 3, name: 'Ezy Client Care',           dept: 'Client Care',  target: 4, departmentId: 10  },
  { id: 4, name: 'Packaging & QA Department', dept: 'Credit',       target: 4, departmentId: 122 },
  { id: 5, name: 'Approvals Department',      dept: 'Credit',       target: 4, departmentId: 86  },
  { id: 6, name: 'Settlements Department',    dept: 'Settlement',   target: 4, departmentId: 82  },
];
// All teams use DepartmentId â€” ConfigQueue.QueueId is not used for team filtering.
const DEPT_TEAM_IDS = TEAMS.map(t => t.departmentId); // [101, 128, 10, 122, 86, 82]

// â”€â”€â”€ Date helpers for KPI delta (vs previous business day) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TODAY_FIXED: override date for testing. Set to null to use real local clock.
// Set to '2026-05-28' â€” last date with actual task data in the backed-up DB snapshot.
const TODAY_FIXED = null;
// Returns today's date as YYYY-MM-DD using local clock (not UTC â€” avoids AEST off-by-one)
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
  const offset = dow === 1 ? -3 : dow === 0 ? -2 : -1; // Monâ†’Fri, Sunâ†’Fri, else -1
  d.setDate(d.getDate() + offset);
  // Use local date parts â€” toISOString() would return UTC and lose a day in AEST
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

// Build a SQL CASE expression mapping tasks â†’ team id (1â€“6).
// All teams use s.DepartmentId via LEFT JOIN Staff (EmployeeStatus=1).
const TEAM_ID_CASE = TEAMS.map(t =>
  `WHEN s.DepartmentId = ${t.departmentId} THEN ${t.id}`
).join(' ');
// Build a SQL CASE expression mapping tasks â†’ team name string (for /api/tasks).
const TEAM_NAME_CASE = TEAMS.map(t =>
  `WHEN s.DepartmentId = ${t.departmentId} THEN '${t.name}'`
).join(' ');
// Combined WHERE predicate â€” all 6 teams filtered via Staff.DepartmentId.
// Only active staff (EmployeeStatus=1) are matched.
const TEAM_FILTER = `s.DepartmentId IN (${DEPT_TEAM_IDS.join(',')}) AND s.EmployeeStatus = 1`;

// â”€â”€â”€ Custom-target helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    return `WHEN s.DepartmentId = ${team.departmentId} THEN ${h}`;
  }).filter(Boolean);
  if (cases.length === 0) return 't.SLAInHours';
  return `CASE ${cases.join(' ')} ELSE t.SLAInHours END`;
}

// â”€â”€â”€ TAT SQL expressions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NOW_SQL: the SQL expression used as "current time" in open-task TAT calculations.
// When TODAY_FIXED is set (snapshot DB), we use the end of the snapshot day so that
// TAT is measured within the snapshot day, not against real time weeks later.
// In live mode (TODAY_FIXED = null), GETDATE() is the correct real-time reference.
const NOW_SQL = TODAY_FIXED
  ? `CAST('${nextDay(TODAY_FIXED)}' AS DATETIME)`
  : `GETDATE()`;

// Elapsed hours for OPEN (active) tasks â€” real-time: NOW_SQL minus creation time.
// Use for all overdue / at-risk / avgTat calculations on active tasks.
const OPEN_TAT_EXPR   = `DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0`;
// Elapsed hours for CLOSED (completed) tasks â€” DateCompleted minus DateCreated.
// Use for SLA compliance checks and avgTat on completed tasks.
const CLOSED_TAT_EXPR = `DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0`;

// Set to true to serve mock data without a DB connection.
// Switch to false once SQL Server TCP/IP is enabled (see db-health endpoint).
const USE_MOCK = false;

// â”€â”€â”€ In-memory response cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Q1: totalTasks, avgTat, totalOverdue â€” active/all tasks, filtered by DateCreated.
  //     TAT for open tasks = GETDATE() - DateCreated (real-time elapsed).
  //     TAT for closed tasks = DateCompleted - DateCreated.
  // Q2: overallSla â€” completed tasks (status=2), filtered by DateCompleted.
  //     SLA compliance = DATEDIFF(DateCreated, DateCompleted) <= configured target.
  const [mainRes, slaRes] = await Promise.all([
    pool.request().query(`
      SELECT
        -- volume = active tasks created today
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TaskStatusID IN (1, 4, 5, 6)
                 THEN 1 ELSE 0 END)                                              AS totalTasks,
        -- overdue = open tasks where real-time TAT > configured SLA target,
        --           OR current datetime has passed the task's SLAAdjustedDate deadline
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
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
    `),
    // SLA% uses DateCompleted â€” completed tasks regardless of when they were created.
    // TAT for closed tasks = DateCompleted - DateCreated (computed, not stored field).
    // targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
    pool.request().query(`
      SELECT
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                   AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS overallSla,
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                   AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS prevSla
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
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

  // Three parallel queries:
  // Q1: volume, avgTat, overdue â€” active/all tasks, DateCreated today.
  //     TAT for open tasks = GETDATE()-DateCreated; closed = DateCompleted-DateCreated.
  // Q2: volume/overdue/TAT deltas â€” DateCreated today + prev.
  // Q3: SLA% per team â€” completed tasks (status=2), DateCompleted today + prev.
  //     SLA compliance = DATEDIFF(DateCreated, DateCompleted) <= configured target.
  //     targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
  const [result, delta, slaResult] = await Promise.all([
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
        -- overdue: open tasks where real-time TAT > configured SLA target,
        --          OR current datetime has passed the task's SLAAdjustedDate deadline
        SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6)
                 AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${targetExpr}
                      OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
                 THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    // Delta query: volume/overdue/TAT only â€” all date-scoped by DateCreated
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
      WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
        AND ${TEAM_FILTER}
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    // SLA% query: completed tasks only, date-scoped by DateCompleted.
    // TAT for closed tasks = DATEDIFF(DateCreated, DateCompleted) / 60.0.
    // targetExpr uses custom per-team target hours when configured, else t.SLAInHours.
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                   AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS todaySla,
        CAST(
          SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                   AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr}
                   THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}' AND t.DateCompleted < '${prevNext}'
                            THEN 1 ELSE 0 END), 0) * 100                         AS prevSla
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      WHERE t.TaskStatusID = 2
        AND ${TEAM_FILTER}
        AND t.DateCompleted >= '${prev}' AND t.DateCompleted < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
  ]);

  const round1 = v => Math.round((v || 0) * 10) / 10;
  return TEAMS.map(team => {
    const row = result.recordset.find(r => r.teamId === team.id) || {};
    const d   = delta.recordset.find(r => r.teamId === team.id)  || {};
    const sla = slaResult.recordset.find(r => r.teamId === team.id) || {};
    return {
      id:      team.id,
      name:    team.name,
      dept:    team.dept,
      target:  team.target,
      volume:  row.volume  || 0,
      sla:     Math.round(sla.todaySla || 0),
      avgTat:  round1(row.avgTat),
      overdue: row.overdue || 0,
      deltas: {
        volume:  (d.todayVol    || 0) - (d.prevVol    || 0),
        sla:     parseFloat((((sla.todaySla || 0) - (sla.prevSla || 0))).toFixed(1)),
        avgTat:  round1((d.todayTat   || 0) - (d.prevTat   || 0)),
        overdue: (d.todayOverdue || 0) - (d.prevOverdue || 0),
      },
    };
  });
}

const app = express();
// CORS locked to production frontend only (CLAUDE.md Rule 5)
const ALLOWED_ORIGINS = [
  'https://sla.mezy.com.au',
  'http://localhost:5173',
  'http://localhost:5174',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());

// â”€â”€â”€ Root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/', (req, res) => {
  res.send(`SLA Dashboard backend running (mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'})`);
});

// â”€â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', mode: USE_MOCK ? 'mock' : 'live' });
});

// â”€â”€â”€ DB health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pings the SQL Server with SELECT 1. Use this to verify the connection works.
app.get('/api/db-health', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ status: 'OK', mode: 'mock', message: 'Mock mode â€” no DB connection attempted.' });
  }
  try {
    const pool = await connectDB();
    await pool.request().query('SELECT 1 AS ping');
    res.json({ status: 'OK', mode: 'live', message: 'SQL Server connection successful.' });
  } catch (err) {
    res.status(503).json({ status: 'ERROR', mode: 'live', message: err.message });
  }
});

// â”€â”€â”€ DB diagnostic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ KPI Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns: { totalTasks, overallSla, avgTat, totalOverdue }
// - totalTasks        â†’ active tasks (TaskStatusID IN 1,4,5,6)
// - overallSla, avgTat, totalOverdue â†’ completed tasks only (TaskStatusID = 2)
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
    // Bypass cache when custom targets are set â€” serve fresh data with the correct thresholds.
    res.json(hasCustom ? await fetchKpiData(customTargets) : await getCached('kpi', fetchKpiData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Teams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns array: [{ id, name, dept, target, volume, sla, avgTat, overdue }]
//
// Tasks are mapped to teams via Staff.DepartmentId (AssignedTo â†’ Staff â†’ DepartmentId).
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Tasks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Query params: ?team=<QueueId>&status=ok|warn|bad
// Returns array of task objects matching the mock-data shape.
app.get('/api/tasks', async (req, res) => {
  const { team, status } = req.query;

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
    // atRiskFraction: default 87.5%, configurable via ?atRiskPct=N (clamped 50â€“99)
    const atRiskFraction = Math.min(0.99, Math.max(0.50, parseFloat(req.query.atRiskPct || 87.5) / 100));

    // Tasks are mapped to teams via Staff.DepartmentId (AssignedTo â†’ Staff â†’ DepartmentId).
    // SLARemaining comes from TaskRelation (IsCurrent = 1 row).
    // Limited to TOP 500 sorted by worst SLA first to avoid timeout on large datasets.
    // TaskRelation join removed â€” expensive on large tables; SLARemaining set to NULL.
    let query = `
      SELECT TOP 500
        t.TaskID,
        t.TaskName,
        t.ShortDescription,
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
        CASE
          WHEN t.SLAInHours IS NULL OR t.SLAInHours = 0 THEN 'ok'
          WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > t.SLAInHours
            OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate) THEN 'bad'
          WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 >= t.SLAInHours * ${atRiskFraction} THEN 'warn'
          ELSE 'ok'
        END AS status
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
      LEFT  JOIN Staff s             WITH (NOLOCK) ON t.AssignedTo   = s.StaffID
      WHERE t.TaskStatusID IN (1, 4, 5, 6)  -- In Progress, On Hold, On Queue, Not Queued
        AND ${TEAM_FILTER}
    `;

    if (team) {
      // team param = TEAMS.id (1â€“6); expand to DepartmentId filter
      const teamDef = TEAMS.find(t => t.id === parseInt(team));
      if (teamDef) {
        query += ` AND s.DepartmentId = ${teamDef.departmentId}`;
      }
    }
    if (status === 'ok') {
      query += ` AND (t.SLAInHours IS NULL OR t.SLAInHours = 0 OR DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 < t.SLAInHours * ${atRiskFraction})`;
    } else if (status === 'warn') {
      query += ` AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 >= t.SLAInHours * ${atRiskFraction} AND DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 <= t.SLAInHours AND (t.SLAAdjustedDate IS NULL OR ${NOW_SQL} <= t.SLAAdjustedDate)`;
    } else if (status === 'bad') {
      query += ` AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > t.SLAInHours OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))`;
    }
    query += ` ORDER BY DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 DESC`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Query param: ?range=7d|30d|90d  (default 30d)
// Returns: { dates: ['2026-04-01', ...], byTeam: { 'Data Entry': [93, 91, ...], ... } }
async function fetchHistoryData(range = '90d', customTargets = {}) {
  // Request extra calendar days to guarantee enough business days:
  // 7 biz days needs 11 cal days; 30 biz days needs 44; 90 biz days needs 128
  const days  = range === '7d' ? 11 : range === '90d' ? 128 : 44;
  const pool    = await connectDB();
  const request = pool.request();
  // No explicit timeout â€” inherits 180s from db.js (needed for cold-start full scan)
  const targetExpr = buildTargetExpr(customTargets);
  const refDate = TODAY_FIXED ? new Date(TODAY_FIXED + 'T00:00:00') : new Date();
  request.input('startDate', sql.DateTime, new Date(refDate.getTime() - days * 24 * 60 * 60 * 1000));
  const result = await request.query(`
      SELECT
        CONVERT(varchar(10), t.DateCompleted, 120)                             AS Date,
        CASE ${TEAM_ID_CASE} END                                               AS teamId,
        COUNT(*)                                                               AS total,
        SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= ${targetExpr} THEN 1 ELSE 0 END) AS compliant
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
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
    const days = range === '7d' ? 11 : range === '90d' ? 128 : 44;
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
    res.json(hasCustom
      ? await fetchHistoryData(range, customTargets)
      : await getCached('history', () => fetchHistoryData(range)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Alerts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Derived from active-task breach thresholds â€” no alerts table in the DB.
// Returns array: [{ id, severity, title, desc, triggeredAt, queueId }]
//
// _alertFirstSeen: persists the first time each alert condition was detected.
// Key = "<teamId>-<severity>" â€” survives API re-calls so "3h ago" stays accurate.
const _alertFirstSeen = new Map();

app.get('/api/alerts', async (req, res) => {
  const buildAlerts = (rows) => {
    const alerts = [];
    const activeKeys = new Set();
    let n = 1;
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
          id: `a${n++}`, severity,
          title: `${row.QueueName} breach threshold`,
          desc:  `SLA at ${pct}%. ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue.`,
          triggeredAt, queueId: row.QueueId,
        });
      } else {
        alerts.push({
          id: `a${n++}`, severity,
          title: `${row.QueueName} SLA at risk`,
          desc:  `SLA at ${pct}% â€” approaching breach threshold. ${row.overdue} overdue.`,
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
    const alertTargets = parseTargets(req.query);
    const alertTargetExpr = buildTargetExpr(alertTargets);
    const result = await pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END                                                AS teamId,
        COUNT(*)                                                                AS total,
        SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 <= ${alertTargetExpr}
                      AND (t.SLAAdjustedDate IS NULL OR ${NOW_SQL} <= t.SLAAdjustedDate) THEN 1 ELSE 0 END) AS compliant,
        SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${alertTargetExpr}
                   OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate) THEN 1 ELSE 0 END) AS overdue
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Alert task drill-down â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns top 50 active tasks for a team that are at-risk or overdue.
// Query param: ?atRiskPct=87.5 (default 87.5 â€” matches frontend DEFAULT_SETTINGS)
app.get('/api/alert-tasks/:teamId', async (req, res) => {
  const teamId  = parseInt(req.params.teamId, 10);
  const teamDef = TEAMS.find(t => t.id === teamId);
  if (!teamDef) return res.status(404).json({ error: 'Team not found' });

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
        ShortDescription: t.ShortDescription || t.desc || null,
        TotalHoursOnTask: t.TotalHoursOnTask,
        SLAInHours:       t.SLAInHours,
        OverDueComments:  t.OverDueComments || null,
        overdueHours:     Math.max(0, Math.round((t.TotalHoursOnTask - t.SLAInHours) * 10) / 10),
        taskType:         t.TotalHoursOnTask > t.SLAInHours ? 'overdue' : 'atrisk',
      }));
    return res.json(tasks);
  }

  try {
    const pool = await connectDB();
    // All teams use Staff.DepartmentId for filtering.
    const teamFilter = `s.DepartmentId = ${teamDef.departmentId} AND s.EmployeeStatus = 1`;
    const staffJoin = 'LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID';
    // UNION guarantees both overdue (real-time TAT > SLA) and at-risk tasks are shown.
    // TAT = DATEDIFF(MINUTE, DateCreated, GETDATE()) / 60.0 for all active tasks.
    // slaExpr: custom target hours from Settings if configured, else DB t.SLAInHours.
    const result = await pool.request().query(`
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.SLAInHours,
          t.OverDueComments,
          CASE
            WHEN DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${slaExpr}
              THEN ROUND(DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 - ${slaExpr}, 1)
            WHEN t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate
              THEN ROUND(DATEDIFF(MINUTE, t.SLAAdjustedDate, ${NOW_SQL}) / 60.0, 1)
            ELSE 0
          END AS overdueHours,
          'overdue' AS taskType
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
          AND ${teamFilter}
          AND ${slaExpr} > 0
          AND (DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 > ${slaExpr}
               OR (t.SLAAdjustedDate IS NOT NULL AND ${NOW_SQL} > t.SLAAdjustedDate))
        ORDER BY DATEDIFF(MINUTE, t.DateCreated, ${NOW_SQL}) / 60.0 / ${slaExpr} DESC
      ) AS Overdue
      UNION ALL
      SELECT * FROM (
        SELECT TOP 25
          t.TaskID,
          t.ShortDescription,
          t.TotalHoursOnTask,
          t.SLAInHours,
          t.OverDueComments,
          0 AS overdueHours,
          'atrisk' AS taskType
        FROM Tasks t WITH (NOLOCK)
        ${staffJoin}
        WHERE t.TaskStatusID IN (1, 4, 5, 6)
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Loan Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns count + total LoanAmount for 3 milestones: received, funder approved, settled.
// Each bucket queries its own date column so each scan is range-limited and sargable.
// Returns: { received, approved, settled } â€” each: { count, amount, deltas: { count, amount } }
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Loan Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        ISNULL(FunderName, 'â€”')                       AS FunderName,
        ISNULL(CAST(LoanAmount AS DECIMAL(18,2)), 0)  AS LoanAmount
      FROM Loans WITH (NOLOCK)
      WHERE ${col} >= '${today}' AND ${col} < '${todayNext}'
      ORDER BY LoanAmount DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Auth helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret-change-in-prod';

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid â€” please log in again' });
  }
}

// â”€â”€â”€ Auth endpoints (public â€” no requireAuth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// POST /api/auth/forgot-password
// Public â€” generates a time-limited reset token and returns it directly
// (no email infrastructure; this is an internal dashboard tool)
app.post('/api/auth/forgot-password', express.json(), async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query('SELECT UserID FROM DashboardUsers WHERE Email = @email AND IsApproved = 1');
    if (!result.recordset.length)
      return res.status(404).json({ error: 'No approved account found for that email address.' });
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.request()
      .input('token',  sql.NVarChar(255), token)
      .input('expiry', sql.DateTime2,     expiry)
      .input('email',  sql.NVarChar(255), email.toLowerCase().trim())
      .query('UPDATE DashboardUsers SET ResetToken = @token, ResetTokenExpiry = @expiry WHERE Email = @email');
    res.json({ token, expiresIn: '1 hour' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
// Public â€” validates token, updates password, clears token
app.post('/api/auth/reset-password', express.json(), async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ error: 'Reset code and new password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('token', sql.NVarChar(255), token)
      .query(`SELECT UserID, ResetTokenExpiry FROM DashboardUsers
              WHERE ResetToken = @token`);
    const user = result.recordset[0];
    if (!user) return res.status(400).json({ error: 'Invalid reset code.' });
    if (new Date(user.ResetTokenExpiry) < new Date())
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    const hash = await bcrypt.hash(password, 12);
    await pool.request()
      .input('hash', sql.NVarChar(255), hash)
      .input('id',   sql.Int,           user.UserID)
      .query('UPDATE DashboardUsers SET PasswordHash = @hash, ResetToken = NULL, ResetTokenExpiry = NULL WHERE UserID = @id');
    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/signup
app.post('/api/auth/signup', express.json(), async (req, res) => {
  const { email, password, companyName } = req.body || {};
  if (!email || !password || !companyName)
    return res.status(400).json({ error: 'Email, password and company name are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const pool = await connectDB();
    await pool.request()
      .input('email',   sql.NVarChar(255), email.toLowerCase().trim())
      .input('company', sql.NVarChar(255), companyName.trim())
      .input('hash',    sql.NVarChar(255), hash)
      .query(`INSERT INTO DashboardUsers (Email, CompanyName, PasswordHash)
              VALUES (@email, @company, @hash)`);
    res.json({ message: 'Signup successful. Your account is pending admin approval.' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'An account with that email already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('email', sql.NVarChar(255), email.toLowerCase().trim())
      .query(`SELECT UserID, Email, CompanyName, PasswordHash, Role, IsApproved
              FROM DashboardUsers WHERE Email = @email`);
    const user = result.recordset[0];
    // Same error message for wrong email OR wrong password â€” avoids user enumeration
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.IsApproved) return res.status(403).json({ error: 'Your account is pending admin approval.' });
    const match = await bcrypt.compare(password, user.PasswordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign(
      { userId: user.UserID, email: user.Email, role: user.Role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, email: user.Email, companyName: user.CompanyName, role: user.Role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Admin-only middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admin access required.' });
    next();
  });
}

// â”€â”€â”€ Admin: user management endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /api/admin/users â€” list all registered users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const pool = await connectDB();
    const result = await pool.request().query(
      `SELECT UserID, Email, CompanyName, Role, IsApproved, IsRejected, CreatedAt
       FROM DashboardUsers ORDER BY CreatedAt DESC`
    );
    res.json(result.recordset.map(u => ({
      id:          u.UserID,
      email:       u.Email,
      companyName: u.CompanyName,
      role:        u.Role,
      status:      u.IsApproved ? 'approved' : (u.IsRejected ? 'rejected' : 'pending'),
      createdAt:   u.CreatedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/approve â€” approve a pending user (admin only)
app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    await pool.request()
      .input('id', sql.Int, id)
      .query('UPDATE DashboardUsers SET IsApproved = 1, IsRejected = 0 WHERE UserID = @id');
    res.json({ message: 'User approved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/reject â€” reject a user (admin only)
app.post('/api/admin/users/:id/reject', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid user ID.' });
  try {
    const pool = await connectDB();
    await pool.request()
      .input('id', sql.Int, id)
      .query('UPDATE DashboardUsers SET IsApproved = 0, IsRejected = 1 WHERE UserID = @id');
    res.json({ message: 'User rejected.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Staff List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/staff/departments  â€” all departments with active staff count (ordered high â†’ low)
// GET /api/staff/department/:id â€” active staff detail for one department
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Protect all data endpoints with JWT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/api/kpi-summary',   requireAuth);
app.use('/api/teams',         requireAuth);
app.use('/api/tasks',         requireAuth);
app.use('/api/history',       requireAuth);
app.use('/api/alerts',        requireAuth);
app.use('/api/alert-tasks',   requireAuth);
app.use('/api/loan-summary',  requireAuth);
app.use('/api/loan-detail',   requireAuth);

// â”€â”€â”€ Start server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`SLA Dashboard backend running on port ${PORT} â€” mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'}`);

  // Ensure IsRejected column exists (safe no-op if already present)
  if (!USE_MOCK) {
    try {
      const pool = await connectDB();
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'DashboardUsers' AND COLUMN_NAME = 'IsRejected'
        )
          ALTER TABLE DashboardUsers ADD IsRejected BIT NOT NULL DEFAULT 0;
      `);
      // Add reset-password columns if missing
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'DashboardUsers' AND COLUMN_NAME = 'ResetToken'
        )
          ALTER TABLE DashboardUsers ADD ResetToken NVARCHAR(255) NULL;
      `);
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'DashboardUsers' AND COLUMN_NAME = 'ResetTokenExpiry'
        )
          ALTER TABLE DashboardUsers ADD ResetTokenExpiry DATETIME2 NULL;
      `);
    } catch (e) {
      console.warn('[startup] column migration skipped:', e.message);
    }
  }

  // Pre-warm the KPI and Teams caches immediately on startup.
  // This fires the slow 100+ second cold-disk queries in the background so that
  // SQL Server's buffer cache is hot before the first user request arrives.
  if (!USE_MOCK) {
    console.log('[cache] warming KPI, Teams and History caches in background...');
    getCached('kpi',     fetchKpiData).catch(() => {});
    getCached('teams',   fetchTeamsData).catch(() => {});
    getCached('history', () => fetchHistoryData('90d')).catch(() => {});
  }
});
