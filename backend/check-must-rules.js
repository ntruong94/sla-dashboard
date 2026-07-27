/**
 * check-must-rules.js
 *
 * CI guardrail: verifies that the MUST Rule (CLAUDE.md Section 0) structural
 * invariants are present in the codebase.
 *
 * Rule: when an admin saves settings, ALL connected sessions must receive the
 * change immediately via SSE — no manual page refresh required.
 *
 * Checks performed (static analysis — no server required):
 *   [server.js]
 *     1. broadcastSettingsChanged function is defined.
 *     2. broadcastSettingsChanged() is called inside the admin settings handler.
 *     3. The SSE event payload uses the 'settings-changed' event name.
 *   [App.jsx]
 *     4. An SSE listener for 'settings-changed' exists.
 *     5. applyGlobalConfig is called inside that listener block.
 *     6. refreshData() is called after applyGlobalConfig in that listener block.
 *
 * Run:  node check-must-rules.js   (from backend/)
 *        npm run check-must         (alias in package.json)
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SERVER  = path.join(__dirname,  'server.js');
const APPJSX  = path.join(ROOT, 'frontend/src/App.jsx');

let failures = 0;

function check(label, content, pattern) {
  const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  if (!re.test(content)) {
    console.error(`[must-rule] FAIL  ${label}`);
    failures++;
  } else {
    console.log( `[must-rule] ok    ${label}`);
  }
}

// ── server.js checks ─────────────────────────────────────────────────────────
const server = fs.readFileSync(SERVER, 'utf8');

check(
  'server.js defines broadcastSettingsChanged()',
  server,
  /function broadcastSettingsChanged\s*\(/
);

check(
  'server.js PUT /api/admin/settings calls broadcastSettingsChanged()',
  server,
  /app\.put\s*\(\s*['"]\/api\/admin\/settings['"][\s\S]{0,2000}?broadcastSettingsChanged\s*\(\s*\)/
);

check(
  "server.js SSE payload uses event: 'settings-changed'",
  server,
  /event:\s*settings-changed/
);

// ── App.jsx checks ────────────────────────────────────────────────────────────
const app = fs.readFileSync(APPJSX, 'utf8');

check(
  "App.jsx registers SSE listener for 'settings-changed'",
  app,
  /addEventListener\s*\(\s*['"]settings-changed['"]/
);

check(
  'App.jsx calls applyGlobalConfig inside settings-changed listener',
  app,
  /settings-changed[\s\S]{0,500}?applyGlobalConfig\s*\(/
);

check(
  'App.jsx calls refreshData() inside settings-changed listener',
  app,
  /settings-changed[\s\S]{0,800}?refreshData\s*\(\s*\)/
);

// ── Result ────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(
    `\n\u274C  ${failures} MUST Rule invariant(s) missing.\n` +
    '    Admin settings must propagate instantly to all sessions via SSE.\n' +
    '    See CLAUDE.md Section 0 for the authoritative requirement.'
  );
  process.exit(1);
} else {
  console.log('\n\u2705  All MUST Rule invariants verified.');
}
