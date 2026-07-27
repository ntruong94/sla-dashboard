/**
 * check-hardcoded-dates.js
 *
 * CI guardrail: exits 1 if any hardcoded YYYY-MM-DD date literal is found on
 * a non-comment line in the production files listed in TARGETS.
 *
 * Run:  node check-hardcoded-dates.js   (from backend/)
 *        npm run check-dates            (alias in package.json)
 *
 * Add to CI pipeline as a blocking step before deployment.
 * The rule: all "today/current" logic must come from systemTodayLocal() or
 * GETDATE() — never a literal date string in production code.
 * See CLAUDE.md Section 7 for the Global Date/Time Rule.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Production files to scan (backend + frontend).
const TARGETS = [
  // Backend
  path.join(__dirname, 'server.js'),
  // Frontend
  path.join(ROOT, 'frontend/src/App.jsx'),
  path.join(ROOT, 'frontend/src/api.js'),
  path.join(ROOT, 'frontend/src/components/components.jsx'),
  path.join(ROOT, 'frontend/src/components/views.jsx'),
  path.join(ROOT, 'frontend/src/constants.js'),
];

// Matches SQL/JS date literals like '2026-05-28' or "2026-05-28".
const DATE_LITERAL_RE = /(['"])\d{4}-\d{2}-\d{2}\1/g;

// Lines whose trimmed content starts with a comment marker are exempt.
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;

let violations = 0;

for (const file of TARGETS) {
  if (!fs.existsSync(file)) {
    console.warn(`[check-hardcoded-dates] SKIP (not found): ${file}`);
    continue;
  }
  const rel   = path.relative(process.cwd(), file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, idx) => {
    if (COMMENT_LINE_RE.test(line)) return;           // skip comment-only lines
    const matches = [...line.matchAll(DATE_LITERAL_RE)];
    if (matches.length === 0) return;
    console.error(`[hardcoded-date] ${rel}:${idx + 1}  →  ${line.trim()}`);
    violations++;
  });
}

if (violations > 0) {
  console.error(
    `\n\u274C  ${violations} hardcoded date literal(s) found in production code.\n` +
    '    Backend: use systemTodayLocal() for date-range params, GETDATE() for SQL comparisons.\n' +
    '    Frontend: do not embed literal YYYY-MM-DD strings in source; fetch from backend or use runtime Date.\n' +
    '    See CLAUDE.md Section 7 for the Global Date/Time Rule.'
  );
  process.exit(1);
} else {
  console.log('\u2705  No hardcoded date literals found in production code.');
}
