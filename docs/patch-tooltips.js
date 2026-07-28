/**
 * patch-tooltips.js — one-time script
 * Reads tooltip text from Column D of SLA_Dashboard_Tooltips.xlsx
 * and writes it into frontend/src/constants.js (TOOLTIPS object).
 * Run from project root: node docs/patch-tooltips.js
 */
'use strict';
const fs   = require('fs');
const XLSX = require('../backend/node_modules/xlsx');
const path = require('path');

// ── 1. Read xlsx Column D ─────────────────────────────────────────────────────
const wb   = XLSX.readFile('./docs/SLA_Dashboard_Tooltips.xlsx');
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const tip = {};
rows.slice(1).forEach(r => {
  const key  = r[1];
  const text = String(r[3]).replace(/\r\n/g, '\n'); // normalise to \n
  tip[key] = text;
});

// ── 2. Helper: value → JS single-quoted string literal ───────────────────────
const jsStr = s =>
  "'" +
  s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
  + "'";

// ── 3. Build replacement TOOLTIPS block (CRLF for code lines) ────────────────
const NL = '\r\n';   // code-structure line endings match the existing file

const newBlock =
  NL + 'export const TOOLTIPS = {' + NL +
  '  kpi: {' + NL +
  '    totalTasks:' + NL +
  '      ' + jsStr(tip['kpi.totalTasks']) + ',' + NL +
  NL +
  '    overallSla:' + NL +
  '      ' + jsStr(tip['kpi.overallSla']) + ',' + NL +
  NL +
  '    avgTat:' + NL +
  '      ' + jsStr(tip['kpi.avgTat']) + ',' + NL +
  NL +
  '    totalOverdue:' + NL +
  '      ' + jsStr(tip['kpi.totalOverdue']) + ',' + NL +
  '  },' + NL +
  '  team: {' + NL +
  '    volume:' + NL +
  '      ' + jsStr(tip['team.volume']) + ',' + NL +
  NL +
  '    avgTat:' + NL +
  '      ' + jsStr(tip['team.avgTat']) + ',' + NL +
  NL +
  '    overdue:' + NL +
  '      ' + jsStr(tip['team.overdue']) + ',' + NL +
  NL +
  '    sla:' + NL +
  '      ' + jsStr(tip['team.sla']) + ',' + NL +
  '  },' + NL +
  '  chart: {' + NL +
  '    trend:' + NL +
  '      ' + jsStr(tip['chart.trend']) + ',' + NL +
  NL +
  '    history:' + NL +
  '      ' + jsStr(tip['chart.history']) + ',' + NL +
  '  },' + NL +
  '  teams: {' + NL +
  '    status: ' + jsStr(tip['teams.status']) + ',' + NL +
  '  },' + NL +
  '  modal: {' + NL +
  '    sla:' + NL +
  '      ' + jsStr(tip['modal.sla']) + ',' + NL +
  NL +
  '    volume:' + NL +
  '      ' + jsStr(tip['modal.volume']) + ',' + NL +
  NL +
  '    avgTat:' + NL +
  '      ' + jsStr(tip['modal.avgTat']) + ',' + NL +
  NL +
  '    avgTatCompleted:' + NL +
  '      ' + jsStr(tip['modal.avgTatCompleted']) + ',' + NL +
  NL +
  '    overdue:' + NL +
  '      ' + jsStr(tip['modal.overdue']) + ',' + NL +
  NL +
  '    overdueCompleted:' + NL +
  '      ' + jsStr(tip['modal.overdueCompleted']) + ',' + NL +
  '  },' + NL +
  '  alerts: {' + NL +
  '    panel:' + NL +
  '      ' + jsStr(tip['alerts.panel']) + ',' + NL +
  '  },' + NL +
  '  loan: {' + NL +
  '    received:' + NL +
  '      ' + jsStr(tip['loan.received']) + ',' + NL +
  NL +
  '    approved:' + NL +
  '      ' + jsStr(tip['loan.approved']) + ',' + NL +
  NL +
  '    settled:' + NL +
  '      ' + jsStr(tip['loan.settled']) + ',' + NL +
  '  },' + NL +
  '};' + NL;

// ── 4. Splice into constants.js ───────────────────────────────────────────────
const filePath = path.join(__dirname, '../frontend/src/constants.js');
const content  = fs.readFileSync(filePath, 'utf8');

const MARKER = '\r\nexport const TOOLTIPS = {';
const markerIdx = content.indexOf(MARKER);
if (markerIdx === -1) throw new Error('TOOLTIPS block not found in constants.js');

// Find closing }; — last occurrence of \r\n}; in the file
const closingIdx = content.lastIndexOf('\r\n};');
if (closingIdx === -1) throw new Error('Closing }; not found in constants.js');

const before = content.slice(0, markerIdx);
const after  = content.slice(closingIdx + 4); // skip past \r\n};

const newContent = before + newBlock + after;
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('\u2705  constants.js TOOLTIPS updated from xlsx Column D');

// ── 5. Verify round-trip ──────────────────────────────────────────────────────
const verify = fs.readFileSync(filePath, 'utf8');
const checkIdx = verify.indexOf('export const TOOLTIPS = {');
console.log('  TOOLTIPS section found at char', checkIdx);
console.log('  First 120 chars of section:', JSON.stringify(verify.slice(checkIdx, checkIdx + 120)));
