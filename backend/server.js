const express = require('express');
const cors    = require('cors');
require('dotenv').config();
const { sql, connectDB } = require('./db');
const mock = require('./mock-data');

// ─── Team definitions ─────────────────────────────────────────────────────────
// Maps the 6 dashboard teams to their ConfigQueue QueueIds in the live DB.
const TEAMS = [
  { id: 1, name: 'Data Entry',        dept: 'Origination', target: 4, queueIds: [1] },
  { id: 2, name: 'Valuations',        dept: 'Origination', target: 4, queueIds: [3, 4] },
  { id: 3, name: 'Assessments',       dept: 'Credit',      target: 4, queueIds: [2, 44, 46, 47] },
  { id: 4, name: 'QA',                dept: 'Credit',      target: 4, queueIds: [28] },
  { id: 5, name: 'Funder Submission', dept: 'Lodgement',   target: 4, queueIds: [5, 6] },
  { id: 6, name: 'Settlements',       dept: 'Settlement',  target: 4, queueIds: [8, 16] },
];
const ALL_QUEUE_IDS = TEAMS.flatMap(t => t.queueIds); // [1,3,4,2,44,46,47,28,5,6,8,16]

// ─── Date helpers for KPI delta (vs previous business day) ───────────────────
// TODAY_FIXED: override date for testing. Set to null to use real local clock.
// Set to '2026-05-28' — last date with actual task data in the backed-up DB snapshot.
const TODAY_FIXED = '2026-05-28';
// Returns today's date as YYYY-MM-DD using local clock (not UTC — avoids AEST off-by-one)
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
  const offset = dow === 1 ? -3 : dow === 0 ? -2 : -1; // Mon→Fri, Sun→Fri, else -1
  d.setDate(d.getDate() + offset);
  // Use local date parts — toISOString() would return UTC and lose a day in AEST
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

// Build a SQL CASE expression mapping QueueID → team id (1–6)
const TEAM_ID_CASE = TEAMS.map(t =>
  `WHEN cf.QueueID IN (${t.queueIds.join(',')}) THEN ${t.id}`
).join(' ');

// Set to true to serve mock data without a DB connection.
// Switch to false once SQL Server TCP/IP is enabled (see db-health endpoint).
const USE_MOCK = false;

// ─── In-memory response cache ─────────────────────────────────────────────────
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

async function fetchKpiData() {
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const QIDS    = ALL_QUEUE_IDS.join(',');
  const funcSub = `SELECT FunctionID FROM ConfigFunction WITH (NOLOCK) WHERE QueueID IN (${QIDS})`;

  // Single query — active tasks only (TaskStatusID IN 1,4,5,6), DateCreated scoped to
  // today and prev biz day. Main KPI values = today; deltas = today − prev biz day.
  const result = await pool.request().query(`
    SELECT
      -- TODAY active tasks (DateCreated = today)
      SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
               THEN 1 ELSE 0 END)                                                AS totalTasks,
      SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
               AND t.TotalHoursOnTask > t.SLAInHours
               THEN 1 ELSE 0 END)                                                AS totalOverdue,
      CAST(
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                 AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
                          THEN 1 ELSE 0 END), 0) * 100                           AS overallSla,
      AVG(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
               THEN t.TotalHoursOnTask ELSE NULL END)                            AS avgTat,
      -- PREV BIZ DAY active tasks (for delta comparison)
      SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
               THEN 1 ELSE 0 END)                                                AS prevTasks,
      SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
               AND t.TotalHoursOnTask > t.SLAInHours
               THEN 1 ELSE 0 END)                                                AS prevOverdue,
      CAST(
        SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                 AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(SUM(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
                          THEN 1 ELSE 0 END), 0) * 100                           AS prevSla,
      AVG(CASE WHEN t.DateCreated >= '${prev}' AND t.DateCreated < '${prevNext}'
               THEN t.TotalHoursOnTask ELSE NULL END)                            AS prevTat
    FROM Tasks t WITH (NOLOCK)
    WHERE t.TaskStatusID IN (1, 4, 5, 6)
      AND t.FunctionID IN (${funcSub})
      AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
  `);

  const r = result.recordset[0];
  return {
    totalTasks:   r.totalTasks   || 0,
    overallSla:   parseFloat((r.overallSla || 0).toFixed(2)),
    avgTat:       Math.round((r.avgTat     || 0) * 10) / 10,
    totalOverdue: r.totalOverdue || 0,
    deltas: {
      totalTasks:   (r.totalTasks   || 0) - (r.prevTasks   || 0),
      overallSla:   parseFloat(((r.overallSla || 0) - (r.prevSla    || 0)).toFixed(2)),
      avgTat:       Math.round(((r.avgTat     || 0) - (r.prevTat    || 0)) * 10) / 10,
      totalOverdue: (r.totalOverdue || 0) - (r.prevOverdue || 0),
      today,
      prevBizDay:   prev,
    },
  };
}

async function fetchTeamsData() {
  const pool = await connectDB();
  const { today, prev, todayNext, prevNext } = computeDates();
  const QIDS = ALL_QUEUE_IDS.join(',');

  const [result, dVol, dComp] = await Promise.all([
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END                                                  AS teamId,
        COUNT(*)                                                                   AS volume,
        CAST(SUM(CASE WHEN t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(COUNT(*), 0) * 100                                              AS sla,
        AVG(t.TotalHoursOnTask)                                                    AS avgTat,
        SUM(CASE WHEN t.TotalHoursOnTask > t.SLAInHours THEN 1 ELSE 0 END)        AS overdue
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
        AND cf.QueueID IN (${QIDS})
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        SUM(CASE WHEN t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}' THEN 1 ELSE 0 END) AS todayVol,
        SUM(CASE WHEN t.DateCreated >= '${prev}'  AND t.DateCreated < '${prevNext}'  THEN 1 ELSE 0 END) AS prevVol
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
      WHERE t.TaskStatusID IN (1,4,5,6)
        AND cf.QueueID IN (${QIDS})
        AND t.DateCreated >= '${prev}' AND t.DateCreated < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
    pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END AS teamId,
        SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}' AND t.TotalHoursOnTask > t.SLAInHours  THEN 1 ELSE 0 END) AS todayOverdue,
        SUM(CASE WHEN t.DateCompleted >= '${prev}'  AND t.DateCompleted < '${prevNext}'  AND t.TotalHoursOnTask > t.SLAInHours  THEN 1 ELSE 0 END) AS prevOverdue,
        CAST(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}' AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}' THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
        CAST(SUM(CASE WHEN t.DateCompleted >= '${prev}'  AND t.DateCompleted < '${prevNext}'  AND t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END) AS FLOAT)
          / NULLIF(SUM(CASE WHEN t.DateCompleted >= '${prev}'  AND t.DateCompleted < '${prevNext}'  THEN 1 ELSE 0 END), 0) * 100 AS prevSla,
        AVG(CASE WHEN t.DateCompleted >= '${today}' AND t.DateCompleted < '${todayNext}' THEN t.TotalHoursOnTask ELSE NULL END) AS todayTat,
        AVG(CASE WHEN t.DateCompleted >= '${prev}'  AND t.DateCompleted < '${prevNext}'  THEN t.TotalHoursOnTask ELSE NULL END) AS prevTat
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
      WHERE t.TaskStatusID = 2
        AND cf.QueueID IN (${QIDS})
        AND t.DateCompleted >= '${prev}' AND t.DateCompleted < '${todayNext}'
      GROUP BY CASE ${TEAM_ID_CASE} END
    `),
  ]);

  const round1 = v => Math.round((v || 0) * 10) / 10;
  return TEAMS.map(team => {
    const row = result.recordset.find(r => r.teamId === team.id) || {};
    const dV  = dVol.recordset.find(r => r.teamId === team.id)   || {};
    const dC  = dComp.recordset.find(r => r.teamId === team.id)  || {};
    return {
      id:      team.id,
      name:    team.name,
      dept:    team.dept,
      target:  team.target,
      volume:  row.volume  || 0,
      sla:     Math.round(row.sla    || 0),
      avgTat:  round1(row.avgTat),
      overdue: row.overdue || 0,
      deltas: {
        volume:  (dV.todayVol   || 0) - (dV.prevVol   || 0),
        sla:     parseFloat((((dC.todaySla  || 0) - (dC.prevSla  || 0))).toFixed(1)),
        avgTat:  round1((dC.todayTat  || 0) - (dC.prevTat  || 0)),
        overdue: (dC.todayOverdue || 0) - (dC.prevOverdue || 0),
      },
    };
  });
}

const app = express();
app.use(cors());
app.use(express.json());

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`SLA Dashboard backend running (mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'})`);
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', mode: USE_MOCK ? 'mock' : 'live' });
});

// ─── DB health check ──────────────────────────────────────────────────────────
// Pings the SQL Server with SELECT 1. Use this to verify the connection works.
app.get('/api/db-health', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ status: 'OK', mode: 'mock', message: 'Mock mode — no DB connection attempted.' });
  }
  try {
    const pool = await connectDB();
    await pool.request().query('SELECT 1 AS ping');
    res.json({ status: 'OK', mode: 'live', message: 'SQL Server connection successful.' });
  } catch (err) {
    res.status(503).json({ status: 'ERROR', mode: 'live', message: err.message });
  }
});

// ─── DB diagnostic ────────────────────────────────────────────────────────────
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

// ─── KPI Summary ──────────────────────────────────────────────────────────────
// Returns: { totalTasks, overallSla, avgTat, totalOverdue }
// - totalTasks        → active tasks (TaskStatusID IN 1,4,5,6)
// - overallSla, avgTat, totalOverdue → completed tasks only (TaskStatusID = 2)
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
    res.json(await getCached('kpi', fetchKpiData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Teams ────────────────────────────────────────────────────────────────────
// Returns array: [{ id, name, dept, target, volume, sla, avgTat, overdue }]
//
// Tasks has no QueueId column.
// Join path: Tasks.FunctionID → ConfigFunction.FunctionID → ConfigFunction.QueueID → ConfigQueue.QueueId
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
    res.json(await getCached('teams', fetchTeamsData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
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

    // Tasks has no QueueId — resolved via ConfigFunction.
    // SLARemaining comes from TaskRelation (IsCurrent = 1 row).
    // Limited to TOP 500 sorted by worst SLA first to avoid timeout on large datasets.
    // TaskRelation join removed — expensive on large tables; SLARemaining set to NULL.
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
        cf.QueueID     AS QueueId,
        q.QueueName,
        t.AssignedTo,
        s.FirstName    AS AssignedToName,
        CASE
          WHEN t.SLAInHours IS NULL OR t.SLAInHours = 0 THEN 'ok'
          WHEN t.TotalHoursOnTask > t.SLAInHours          THEN 'bad'
          WHEN t.TotalHoursOnTask >= t.SLAInHours * 0.875 THEN 'warn'
          ELSE 'ok'
        END AS status
      FROM Tasks t WITH (NOLOCK)
      LEFT  JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
      INNER JOIN ConfigFunction cf   WITH (NOLOCK) ON t.FunctionID   = cf.FunctionID
      INNER JOIN ConfigQueue q       WITH (NOLOCK) ON cf.QueueID      = q.QueueId
      LEFT  JOIN Staff s             WITH (NOLOCK) ON t.AssignedTo   = s.StaffID
      WHERE t.TaskStatusID IN (1, 4, 5, 6)  -- In Progress, On Hold, On Queue, Not Queued
        AND cf.QueueID IN (${ALL_QUEUE_IDS.join(',')})
    `;

    if (team) {
      // team param = TEAMS.id (1–6); map to actual QueueIds
      const teamDef = TEAMS.find(t => t.id === parseInt(team));
      if (teamDef) {
        query += ` AND cf.QueueID IN (${teamDef.queueIds.join(',')})`;
      }
    }
    if (status === 'ok') {
      query += ' AND t.TotalHoursOnTask < t.SLAInHours * 0.875';
    } else if (status === 'warn') {
      query += ' AND t.TotalHoursOnTask >= t.SLAInHours * 0.875 AND t.TotalHoursOnTask <= t.SLAInHours';
    } else if (status === 'bad') {
      query += ' AND t.TotalHoursOnTask > t.SLAInHours';
    }
    query += ' ORDER BY t.TotalHoursOnTask DESC';

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── History ──────────────────────────────────────────────────────────────────
// Query param: ?range=7d|30d|90d  (default 30d)
// Returns: { dates: ['2026-04-01', ...], byTeam: { 'Data Entry': [93, 91, ...], ... } }
async function fetchHistoryData(range = '90d') {
  // Request extra calendar days to guarantee enough business days:
  // 7 biz days needs 11 cal days; 30 biz days needs 44; 90 biz days needs 128
  const days  = range === '7d' ? 11 : range === '90d' ? 128 : 44;
  const pool    = await connectDB();
  const request = pool.request();
  // No explicit timeout — inherits 180s from db.js (needed for cold-start full scan)
  const refDate = TODAY_FIXED ? new Date(TODAY_FIXED + 'T00:00:00') : new Date();
  request.input('startDate', sql.DateTime, new Date(refDate.getTime() - days * 24 * 60 * 60 * 1000));
  const result = await request.query(`
      SELECT
        CONVERT(varchar(10), t.DateCompleted, 120)                             AS Date,
        CASE ${TEAM_ID_CASE} END                                               AS teamId,
        COUNT(*)                                                               AS total,
        SUM(CASE WHEN t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END)   AS compliant
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN ConfigFunction cf WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
      WHERE t.TaskStatusID = 2
        AND t.DateCompleted >= @startDate
        AND t.DateCompleted IS NOT NULL
        AND t.SLAInHours > 0
        AND cf.QueueID IN (${ALL_QUEUE_IDS.join(',')})
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
    res.json(await getCached('history', () => fetchHistoryData(range)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Alerts ───────────────────────────────────────────────────────────────────
// Derived from active-task breach thresholds — no alerts table in the DB.
// Returns array: [{ id, severity, title, desc, time, queueId }]
app.get('/api/alerts', async (req, res) => {
  const buildAlerts = (rows) => {
    const alerts = [];
    let n = 1;
    for (const row of rows) {
      const pct = row.total > 0 ? Math.round((row.compliant / row.total) * 100) : 100;
      if (pct < 75) {
        alerts.push({
          id: `a${n++}`, severity: 'critical',
          title: `${row.QueueName} breach threshold`,
          desc:  `SLA at ${pct}%. ${row.overdue} file${row.overdue !== 1 ? 's' : ''} overdue.`,
          time: 'just now', queueId: row.QueueId,
        });
      } else if (pct < 90) {
        alerts.push({
          id: `a${n++}`, severity: 'warning',
          title: `${row.QueueName} SLA at risk`,
          desc:  `SLA at ${pct}% — approaching breach threshold. ${row.overdue} overdue.`,
          time: 'just now', queueId: row.QueueId,
        });
      }
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
    const result = await pool.request().query(`
      SELECT
        CASE ${TEAM_ID_CASE} END                                                AS teamId,
        COUNT(*)                                                                AS total,
        SUM(CASE WHEN t.TotalHoursOnTask <= t.SLAInHours THEN 1 ELSE 0 END)   AS compliant,
        SUM(CASE WHEN t.TotalHoursOnTask >  t.SLAInHours THEN 1 ELSE 0 END)   AS overdue
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN ConfigFunction cf   WITH (NOLOCK) ON t.FunctionID = cf.FunctionID
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
        AND cf.QueueID IN (${ALL_QUEUE_IDS.join(',')})
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

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SLA Dashboard backend running on port ${PORT} — mode: ${USE_MOCK ? 'MOCK DATA' : 'LIVE DATABASE'}`);
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
