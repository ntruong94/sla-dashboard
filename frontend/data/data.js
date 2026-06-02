// Mortgage Ezy — SLA Dashboard sample data
// Plausible Australian loan-ops data. All values are illustrative.

const TEAM_COLORS = {
  'data-entry': 'var(--t1)',
  'valuations': 'var(--t2)',
  'assessments': 'var(--t3)',
  'qa': 'var(--t4)',
  'funder-submission': 'var(--t5)',
  'settlements': 'var(--t6)',
};

const TEAMS_BASE = [
  {
    id: 'data-entry',
    name: 'Data Entry',
    dept: 'Origination',
    target: 4,        // hours
    volume: 62,
    sla: 94,
    avgTat: 3.2,
    overdue: 0,
  },
  {
    id: 'valuations',
    name: 'Valuations',
    dept: 'Origination',
    target: 4,
    volume: 38,
    sla: 87,
    avgTat: 3.8,
    overdue: 3,
  },
  {
    id: 'assessments',
    name: 'Assessments',
    dept: 'Credit',
    target: 4,
    volume: 54,
    sla: 68,
    avgTat: 5.1,
    overdue: 12,
  },
  {
    id: 'qa',
    name: 'QA',
    dept: 'Credit',
    target: 4,
    volume: 29,
    sla: 96,
    avgTat: 2.9,
    overdue: 0,
  },
  {
    id: 'funder-submission',
    name: 'Funder Submission',
    dept: 'Lodgement',
    target: 4,
    volume: 41,
    sla: 82,
    avgTat: 4.2,
    overdue: 2,
  },
  {
    id: 'settlements',
    name: 'Settlements',
    dept: 'Settlement',
    target: 4,
    volume: 33,
    sla: 72,
    avgTat: 4.7,
    overdue: 6,
  },
];

// 7-day trend (Mon–Sun) — SLA % per team per day
const TREND_DATA = {
  'data-entry':         [91, 93, 90, 88, 92, 95, 94],
  'valuations':         [84, 86, 89, 91, 88, 85, 87],
  'assessments':        [78, 74, 72, 70, 66, 69, 68],
  'qa':                 [94, 95, 96, 97, 95, 96, 96],
  'funder-submission':  [88, 86, 83, 81, 79, 82, 82],
  'settlements':        [80, 78, 75, 73, 71, 73, 72],
};

const DAY_LABELS = ['Mon 14', 'Tue 15', 'Wed 16', 'Thu 17', 'Fri 18', 'Sat 19', 'Sun 20'];

// Alerts feed
const ALERTS = [
  {
    id: 'a1',
    severity: 'critical',
    title: 'Assessments breach threshold',
    desc: 'SLA dropped below 75% for 3 consecutive days. 12 files overdue.',
    time: '18m ago',
  },
  {
    id: 'a2',
    severity: 'critical',
    title: 'Settlement backlog — VIC',
    desc: '6 Victorian settlements past SLA. Check conveyancer availability.',
    time: '47m ago',
  },
  {
    id: 'a3',
    severity: 'warning',
    title: 'Valuation queue building',
    desc: 'Valuer response times up 34% vs 7-day average.',
    time: '2h ago',
  },
  {
    id: 'a4',
    severity: 'warning',
    title: 'QLD funder SLA at risk',
    desc: 'Funder Submission approaching amber on QLD files.',
    time: '3h ago',
  },
  {
    id: 'a5',
    severity: 'warning',
    title: 'Data Entry approaching cap',
    desc: 'Volume up 18% vs Monday baseline — monitor capacity.',
    time: '5h ago',
  },
];

// Task lists — 10 per team, plausible AU data
const TASKS = {
  'data-entry': [
    { id: 'DE-2487', desc: 'New loan application — PPOR',       client: 'Hayden Bellamy',         status: 'ok',   tatHours: 1.2, priority: 'low' },
    { id: 'DE-2486', desc: 'Refinance application intake',      client: 'Meridian Trust Pty Ltd', status: 'ok',   tatHours: 2.4, priority: 'med' },
    { id: 'DE-2485', desc: 'Investment loan — dual applicant',  client: 'Chen & Nakamura',        status: 'ok',   tatHours: 0.8, priority: 'low' },
    { id: 'DE-2484', desc: 'Top-up application',                client: 'Sarah O\u2019Donnell',    status: 'ok',   tatHours: 2.1, priority: 'low' },
    { id: 'DE-2483', desc: 'Construction loan intake',          client: 'Nguyen Family Trust',    status: 'warn', tatHours: 3.6, priority: 'high' },
    { id: 'DE-2482', desc: 'Owner-occupier switch',             client: 'James Whitfield',        status: 'ok',   tatHours: 1.7, priority: 'med' },
    { id: 'DE-2481', desc: 'Bridging loan application',         client: 'Prakash Holdings',       status: 'ok',   tatHours: 2.9, priority: 'med' },
    { id: 'DE-2480', desc: 'SMSF loan — 12-field update',       client: 'Ironbark Super Fund',    status: 'ok',   tatHours: 3.1, priority: 'low' },
    { id: 'DE-2479', desc: 'Pre-approval extension',            client: 'Mira Kowalski',          status: 'ok',   tatHours: 1.4, priority: 'low' },
    { id: 'DE-2478', desc: 'Commercial IO loan',                client: 'Rockpool Ventures',      status: 'warn', tatHours: 3.5, priority: 'med' },
  ],
  'valuations': [
    { id: 'VAL-5129', desc: 'Full valuation — Brisbane QLD',    client: 'Darren Ellis',           status: 'bad',  tatHours: 5.4, priority: 'high' },
    { id: 'VAL-5128', desc: 'Kerbside val — Footscray VIC',     client: 'Aisha Rahimi',           status: 'ok',   tatHours: 2.1, priority: 'med' },
    { id: 'VAL-5127', desc: 'Desktop val — Parramatta NSW',     client: 'Yao Lin',                status: 'ok',   tatHours: 1.8, priority: 'low' },
    { id: 'VAL-5126', desc: 'Full val — Gold Coast QLD',        client: 'Matthew Bryce',          status: 'warn', tatHours: 3.7, priority: 'med' },
    { id: 'VAL-5125', desc: 'Commercial val — Hobart TAS',      client: 'Tasman Coast Pty Ltd',   status: 'bad',  tatHours: 6.2, priority: 'high' },
    { id: 'VAL-5124', desc: 'Full val — Adelaide Hills',        client: 'Priya & Anil Deshmukh',  status: 'ok',   tatHours: 2.9, priority: 'low' },
    { id: 'VAL-5123', desc: 'Desktop val — Mandurah WA',        client: 'Ellie Marsh',            status: 'ok',   tatHours: 1.2, priority: 'low' },
    { id: 'VAL-5122', desc: 'Full val — Newcastle NSW',         client: 'Hollis Family',          status: 'bad',  tatHours: 5.9, priority: 'med' },
    { id: 'VAL-5121', desc: 'Kerbside val — Cairns QLD',        client: 'Ravi Sundaram',          status: 'warn', tatHours: 3.5, priority: 'med' },
    { id: 'VAL-5120', desc: 'Full val — Canberra ACT',          client: 'Farrah Goodwin',         status: 'ok',   tatHours: 2.6, priority: 'low' },
  ],
  'assessments': [
    { id: 'ASS-8814', desc: 'PPOR 80% LVR — servicing review',  client: 'Daniel & Elena Korkmaz', status: 'bad',  tatHours: 7.1, priority: 'high' },
    { id: 'ASS-8813', desc: 'Investor LoDoc assessment',        client: 'Halcyon Property Group', status: 'bad',  tatHours: 8.4, priority: 'high' },
    { id: 'ASS-8812', desc: 'Refinance assessment — cashout',   client: 'Jonah Teague',           status: 'bad',  tatHours: 6.3, priority: 'med' },
    { id: 'ASS-8811', desc: 'Construction staged release',      client: 'Yvette & Cameron Fox',   status: 'warn', tatHours: 3.8, priority: 'high' },
    { id: 'ASS-8810', desc: 'SMSF loan — credit review',        client: 'Ironbark Super Fund',    status: 'bad',  tatHours: 9.2, priority: 'high' },
    { id: 'ASS-8809', desc: 'Pre-approval assessment',          client: 'Luisa Herrera',          status: 'warn', tatHours: 3.5, priority: 'med' },
    { id: 'ASS-8808', desc: 'Guarantor servicing check',        client: 'Whitford & Sons',        status: 'ok',   tatHours: 2.4, priority: 'low' },
    { id: 'ASS-8807', desc: 'Variation — interest-only ext.',   client: 'Sienna Balakrishnan',    status: 'ok',   tatHours: 2.1, priority: 'low' },
    { id: 'ASS-8806', desc: 'Full doc refinance',               client: 'Patrick Henare',         status: 'warn', tatHours: 3.7, priority: 'med' },
    { id: 'ASS-8805', desc: 'Bridging finance — residual debt', client: 'Moreton Bay Partners',   status: 'bad',  tatHours: 5.8, priority: 'high' },
  ],
  'qa': [
    { id: 'QA-4412', desc: 'File quality check — full doc',     client: 'Elena Markov',           status: 'ok',   tatHours: 1.4, priority: 'med' },
    { id: 'QA-4411', desc: 'QA review — SMSF package',          client: 'Ironbark Super Fund',    status: 'ok',   tatHours: 2.2, priority: 'med' },
    { id: 'QA-4410', desc: 'Pre-settle QA check',               client: 'Dmitri Volkov',          status: 'ok',   tatHours: 1.1, priority: 'low' },
    { id: 'QA-4409', desc: 'Document completeness review',      client: 'Hana Kobayashi',         status: 'ok',   tatHours: 2.8, priority: 'low' },
    { id: 'QA-4408', desc: 'Commercial file QA',                client: 'Rockpool Ventures',      status: 'ok',   tatHours: 2.5, priority: 'med' },
    { id: 'QA-4407', desc: 'QA — post-assessment',              client: 'Finn Harrington',        status: 'ok',   tatHours: 1.7, priority: 'low' },
    { id: 'QA-4406', desc: 'Compliance spot-check',             client: 'Ayaan Farooqi',          status: 'warn', tatHours: 3.4, priority: 'med' },
    { id: 'QA-4405', desc: 'Broker-submitted file review',      client: 'Laurel Quinn',           status: 'ok',   tatHours: 2.1, priority: 'low' },
    { id: 'QA-4404', desc: 'Final QA — investor refi',          client: 'Halcyon Property Group', status: 'ok',   tatHours: 2.6, priority: 'med' },
    { id: 'QA-4403', desc: 'QA — construction loan',            client: 'Yvette & Cameron Fox',   status: 'ok',   tatHours: 1.9, priority: 'low' },
  ],
  'funder-submission': [
    { id: 'FS-7731', desc: 'Lodgement — Pepper Money',          client: 'Thompson Family Trust',  status: 'ok',   tatHours: 2.3, priority: 'med' },
    { id: 'FS-7730', desc: 'Lodgement — Resimac',               client: 'Georgia Whitlock',       status: 'warn', tatHours: 3.6, priority: 'high' },
    { id: 'FS-7729', desc: 'Lodgement — Bluestone',             client: 'Aaron Jefferies',        status: 'bad',  tatHours: 5.2, priority: 'high' },
    { id: 'FS-7728', desc: 'Lodgement — Liberty Financial',     client: 'Rohan & Priya Gupta',    status: 'ok',   tatHours: 2.7, priority: 'med' },
    { id: 'FS-7727', desc: 'Lodgement — ING',                   client: 'Christopher Yates',      status: 'ok',   tatHours: 1.8, priority: 'low' },
    { id: 'FS-7726', desc: 'Lodgement — La Trobe',              client: 'Moreton Bay Partners',   status: 'warn', tatHours: 3.9, priority: 'med' },
    { id: 'FS-7725', desc: 'Lodgement — Firstmac',              client: 'Ines Escalante',         status: 'ok',   tatHours: 2.4, priority: 'low' },
    { id: 'FS-7724', desc: 'Lodgement — Bankwest',              client: 'Dylan O\u2019Farrell',   status: 'bad',  tatHours: 4.9, priority: 'high' },
    { id: 'FS-7723', desc: 'Lodgement — MyState',               client: 'Tasman Coast Pty Ltd',   status: 'ok',   tatHours: 2.1, priority: 'low' },
    { id: 'FS-7722', desc: 'Lodgement — Macquarie',             client: 'Rebecca Salinas',        status: 'warn', tatHours: 3.7, priority: 'med' },
  ],
  'settlements': [
    { id: 'SET-3309', desc: 'Settlement booking — VIC',         client: 'Bastian Weller',         status: 'bad',  tatHours: 6.1, priority: 'high' },
    { id: 'SET-3308', desc: 'PEXA workspace — NSW',             client: 'Harriet Kasumba',        status: 'warn', tatHours: 3.7, priority: 'high' },
    { id: 'SET-3307', desc: 'Discharge authority — QLD',        client: 'Matthew Bryce',          status: 'bad',  tatHours: 5.8, priority: 'high' },
    { id: 'SET-3306', desc: 'Settlement docs — WA',             client: 'Camille Versteeg',       status: 'ok',   tatHours: 2.8, priority: 'med' },
    { id: 'SET-3305', desc: 'Funder confirmation — SA',         client: 'Priya & Anil Deshmukh',  status: 'warn', tatHours: 3.6, priority: 'med' },
    { id: 'SET-3304', desc: 'Settlement booking — VIC',         client: 'Lachlan Pemberton',      status: 'bad',  tatHours: 5.4, priority: 'high' },
    { id: 'SET-3303', desc: 'Cert of title follow-up — NSW',    client: 'Omar Siddiqui',          status: 'warn', tatHours: 3.8, priority: 'med' },
    { id: 'SET-3302', desc: 'Discharge pending — VIC',          client: 'Isla Donoghue',          status: 'bad',  tatHours: 6.4, priority: 'high' },
    { id: 'SET-3301', desc: 'Settlement booking — QLD',         client: 'Ravi Sundaram',          status: 'ok',   tatHours: 2.2, priority: 'low' },
    { id: 'SET-3300', desc: 'Title production — VIC',           client: 'Oscar Trevino',          status: 'bad',  tatHours: 5.9, priority: 'high' },
  ],
};

Object.assign(window, { TEAMS_BASE, TREND_DATA, DAY_LABELS, ALERTS, TASKS, TEAM_COLORS });
