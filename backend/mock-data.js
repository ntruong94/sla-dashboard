// mock-data.js — Dummy dataset mirroring the SEReport SQL Server schema
// All table and column names match the real schema exactly.
// Swap out this file for real SQL queries when ready (see server.js USE_MOCK flag).

// ── ConfigQueue ───────────────────────────────────────────────────────────────
// Real table: SELECT QueueId, QueueName FROM ConfigQueue
const CONFIG_QUEUE = [
  { QueueId: 1, QueueName: 'Data Entry' },
  { QueueId: 2, QueueName: 'Valuations' },
  { QueueId: 3, QueueName: 'Assessments' },
  { QueueId: 4, QueueName: 'QA' },
  { QueueId: 5, QueueName: 'Funder Submission' },
  { QueueId: 6, QueueName: 'Settlements' },
];

// ── ConfigTaskStatus ──────────────────────────────────────────────────────────
// Real table: SELECT ConfigTaskStatusID, TaskStatus FROM ConfigTaskStatus
const CONFIG_TASK_STATUS = [
  { ConfigTaskStatusID: 1, TaskStatus: 'Active' },
  { ConfigTaskStatusID: 2, TaskStatus: 'Completed' },
  { ConfigTaskStatusID: 3, TaskStatus: 'On Hold' },
  { ConfigTaskStatusID: 4, TaskStatus: 'Cancelled' },
];

// ── Department ────────────────────────────────────────────────────────────────
// Real table: SELECT DepartmentId, Description FROM Department
const DEPARTMENTS = [
  { DepartmentId: 1, Description: 'Origination' },
  { DepartmentId: 2, Description: 'Origination' },
  { DepartmentId: 3, Description: 'Credit' },
  { DepartmentId: 4, Description: 'Credit' },
  { DepartmentId: 5, Description: 'Lodgement' },
  { DepartmentId: 6, Description: 'Settlement' },
];

// ── Staff ─────────────────────────────────────────────────────────────────────
// Real table: SELECT StaffID, FirstName, DepartmentId FROM Staff
const STAFF = [
  { StaffID: 101, FirstName: 'Sarah',    DepartmentId: 1 },
  { StaffID: 102, FirstName: 'James',    DepartmentId: 1 },
  { StaffID: 103, FirstName: 'Priya',    DepartmentId: 1 },
  { StaffID: 201, FirstName: 'Daniel',   DepartmentId: 2 },
  { StaffID: 202, FirstName: 'Emma',     DepartmentId: 2 },
  { StaffID: 203, FirstName: 'Lachlan',  DepartmentId: 2 },
  { StaffID: 301, FirstName: 'Michelle', DepartmentId: 3 },
  { StaffID: 302, FirstName: 'Owen',     DepartmentId: 3 },
  { StaffID: 303, FirstName: 'Fatima',   DepartmentId: 3 },
  { StaffID: 401, FirstName: 'Tara',     DepartmentId: 4 },
  { StaffID: 402, FirstName: 'Raj',      DepartmentId: 4 },
  { StaffID: 501, FirstName: 'Kate',     DepartmentId: 5 },
  { StaffID: 502, FirstName: 'Ben',      DepartmentId: 5 },
  { StaffID: 601, FirstName: 'Amy',      DepartmentId: 6 },
  { StaffID: 602, FirstName: 'Chris',    DepartmentId: 6 },
];

// ── Internal config for task generation ──────────────────────────────────────
// dept, slaTarget (hours), volume (active task count), slaPct (% within SLA)
const TEAM_CONFIG = {
  1: { dept: 'Origination',  slaTarget: 4, volume: 62, slaPct: 94 },
  2: { dept: 'Origination',  slaTarget: 4, volume: 38, slaPct: 87 },
  3: { dept: 'Credit',       slaTarget: 4, volume: 54, slaPct: 68 },
  4: { dept: 'Credit',       slaTarget: 4, volume: 29, slaPct: 96 },
  5: { dept: 'Lodgement',    slaTarget: 4, volume: 41, slaPct: 82 },
  6: { dept: 'Settlement',   slaTarget: 4, volume: 33, slaPct: 72 },
};

// Task description pools per QueueId
const TASK_NAMES = {
  1: ['New loan application — PPOR', 'Refinance application intake', 'Investment loan entry',
      'Construction loan intake', 'Top-up application', 'Pre-approval entry',
      'SMSF loan entry', 'Bridging loan intake', 'Owner-occupier switch', 'Commercial IO loan'],
  2: ['Full valuation order', 'Kerbside valuation', 'Desktop valuation',
      'Commercial property valuation', 'Rural property valuation', 'Strata unit valuation',
      'High-density unit valuation', 'Industrial property valuation'],
  3: ['PPOR credit assessment', 'Investment loan assessment', 'Refinance assessment',
      'Construction staged release', 'SMSF credit review', 'Guarantor servicing check',
      'Lo-doc assessment', 'Bridging finance review', 'Variation — interest-only ext.',
      'Full doc refinance'],
  4: ['File quality check — full doc', 'Pre-settlement QA check', 'Document completeness review',
      'Compliance spot-check', 'Post-assessment QA', 'Commercial file QA',
      'Broker-submitted file review', 'Final QA — investor refi'],
  5: ['Lodgement — Pepper Money', 'Lodgement — Resimac', 'Lodgement — Bluestone',
      'Lodgement — Liberty Financial', 'Lodgement — ING', 'Lodgement — Macquarie',
      'Lodgement — La Trobe', 'Lodgement — Firstmac', 'Lodgement — Bankwest'],
  6: ['Settlement booking', 'PEXA workspace setup', 'Discharge authority',
      'Settlement docs preparation', 'Funder confirmation', 'Cert of title follow-up',
      'Title production', 'Discharge pending follow-up'],
};

const CLIENT_NAMES = [
  'Hayden Bellamy', 'Aisha Rahimi', 'Daniel Korkmaz', "Sarah O'Donnell",
  'Matthew Bryce', 'Priya Deshmukh', 'James Whitfield', 'Ellie Marsh',
  'Ravi Sundaram', 'Georgia Whitlock', 'Aaron Jefferies', 'Mira Kowalski',
  'Darren Ellis', 'Yao Lin', 'Luisa Herrera', 'Patrick Henare',
  'Bastian Weller', 'Harriet Kasumba', 'Oscar Trevino', 'Camille Versteeg',
  'Ironbark Super Fund', 'Halcyon Property Group', 'Meridian Trust Pty Ltd',
  'Rockpool Ventures', 'Thompson Family Trust', 'Nguyen Family Trust',
  'Tasman Coast Pty Ltd', 'Moreton Bay Partners', 'Chen & Nakamura',
  'Prakash Holdings', 'Hollis Family', 'Whitford & Sons',
];

// Stable pseudo-random (same seed → same result every run)
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// Derive task SLA status from hours vs target
function getTaskStatus(hours, slaTarget) {
  if (hours > slaTarget) return 'bad';
  if (hours >= slaTarget * 0.875) return 'warn';
  return 'ok';
}

// ── Tasks (generated) ─────────────────────────────────────────────────────────
// Mirrors: Tasks JOIN ConfigQueue JOIN Staff JOIN ConfigTaskStatus
function generateTasks() {
  const tasks = [];
  let taskId = 1000;
  const now = new Date();

  for (const [queueId, config] of Object.entries(TEAM_CONFIG)) {
    const qid = parseInt(queueId);
    const queueRow = CONFIG_QUEUE.find(q => q.QueueId === qid);
    const staffForQueue = STAFF.filter(s => s.DepartmentId === qid);
    const namePool = TASK_NAMES[qid];

    for (let i = 0; i < config.volume; i++) {
      const seed = qid * 1000 + i;
      const r1 = seededRand(seed);
      const r2 = seededRand(seed + 50);
      const r3 = seededRand(seed + 100);
      const r4 = seededRand(seed + 150);
      const r5 = seededRand(seed + 200);

      // Comply with team's SLA percentage
      const withinSla = r1 * 100 < config.slaPct;

      // TotalHoursOnTask — within or breaching the SLA target
      let hours;
      if (withinSla) {
        hours = 0.3 + r2 * (config.slaTarget - 0.3);  // 0.3h to SLATarget
      } else {
        hours = config.slaTarget + r2 * config.slaTarget * 1.5; // SLATarget to 2.5× SLATarget
      }
      hours = Math.round(hours * 10) / 10;

      // CreatedDate — spread over the last 30 days
      const daysAgo = Math.floor(r3 * 30);
      const createdDate = new Date(now);
      createdDate.setDate(createdDate.getDate() - daysAgo);

      // Staff assignment
      const pool = staffForQueue.length > 0 ? staffForQueue : STAFF;
      const assignedStaff = pool[Math.floor(r4 * pool.length)];

      // Descriptions
      const taskName = namePool[Math.floor(r3 * namePool.length)];
      const clientName = CLIENT_NAMES[Math.floor(r5 * CLIENT_NAMES.length)];

      // Status: 85% Active, 10% Completed, 5% On Hold
      let taskStatusId = 1;
      if (r5 > 0.95) taskStatusId = 3;       // On Hold
      else if (r5 > 0.85) taskStatusId = 2;  // Completed

      // Priority
      const priority = r4 > 0.7 ? 'High' : r4 > 0.4 ? 'Medium' : 'Low';

      tasks.push({
        // ── Columns matching real Tasks table ─────────────────────────────
        TaskID:              taskId++,
        ConfigTaskId:        Math.floor(r1 * 10) + 1,
        TaskName:            taskName,
        ShortDescription:    `${taskName} — ${clientName}`,
        AssignedTo:          assignedStaff ? assignedStaff.StaffID : null,
        Priority:            priority,
        TaskStatusID:        taskStatusId,
        SLAInHours:          config.slaTarget,
        SoEzySLA:            config.slaTarget,
        SoEzySLA_BH:         config.slaTarget,
        TotalHoursOnTask:    hours,
        TotalHoursOnTask_BH: Math.round(hours * 0.75 * 10) / 10,
        SLARemaining:        Math.max(0, Math.round((config.slaTarget - hours) * 10) / 10),
        CreatedDate:         createdDate.toISOString(),
        // ── Joined columns (from ConfigQueue, Staff, ConfigTaskStatus) ─────
        QueueId:             qid,
        QueueName:           queueRow.QueueName,
        AssignedToName:      assignedStaff ? assignedStaff.FirstName : null,
        TaskStatus:          CONFIG_TASK_STATUS.find(s => s.ConfigTaskStatusID === taskStatusId).TaskStatus,
        // ── Computed for API consumers ────────────────────────────────────
        status:              getTaskStatus(hours, config.slaTarget),
        ClientName:          clientName,
      });
    }
  }
  return tasks;
}

// ── History (generated) ───────────────────────────────────────────────────────
// Mirrors: daily SLA % aggregated from Tasks GROUP BY date, QueueName
// Shape: { 'Data Entry': [{ Date, QueueId, QueueName, SlaPct }, ...], ... }
function generateHistory(days = 90) {
  const baselines = {
    'Data Entry':       { baseline: 93, volatility: 3 },
    'Valuations':       { baseline: 87, volatility: 4 },
    'Assessments':      { baseline: 68, volatility: 5 },
    'QA':               { baseline: 95, volatility: 2 },
    'Funder Submission':{ baseline: 82, volatility: 4 },
    'Settlements':      { baseline: 72, volatility: 4 },
  };

  const teamHistory = {};
  const now = new Date();

  for (const queue of CONFIG_QUEUE) {
    const cfg = baselines[queue.QueueName];
    if (!cfg) continue;

    const history = [];
    let v = cfg.baseline;
    const seedBase = queue.QueueId * 17;

    for (let i = 0; i < days; i++) {
      const r  = seededRand(seedBase + i * 7);
      const r2 = seededRand(seedBase * 3 + i);

      v = v + (cfg.baseline - v) * 0.12 + (r - 0.5) * cfg.volatility * 2;
      if (r2 < 0.04) v -= cfg.volatility * 2.5;   // occasional incident dip
      v = Math.max(55, Math.min(100, v));

      const date = new Date(now);
      date.setDate(date.getDate() - (days - 1 - i));

      history.push({
        Date:      date.toISOString().split('T')[0],
        QueueId:   queue.QueueId,
        QueueName: queue.QueueName,
        SlaPct:    Math.round(v),
      });
    }
    teamHistory[queue.QueueName] = history;
  }
  return teamHistory;
}

// ── Exports ───────────────────────────────────────────────────────────────────
const TASKS   = generateTasks();
const HISTORY = generateHistory(90);

module.exports = {
  CONFIG_QUEUE,
  CONFIG_TASK_STATUS,
  DEPARTMENTS,
  STAFF,
  TEAM_CONFIG,
  TASKS,
  HISTORY,
  getTaskStatus,
};
