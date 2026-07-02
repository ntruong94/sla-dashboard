// One-shot script to apply SLA Dashboard performance indexes.
// Usage: node apply-perf-indexes.js
// Reads sql/create_perf_indexes.sql and executes it against the configured DB.
// Safe to re-run (each CREATE INDEX is guarded by IF NOT EXISTS).

const fs   = require('fs');
const path = require('path');
const { connectDB } = require('./db');

(async () => {
  const sqlPath = path.resolve(__dirname, '..', 'sql', 'create_perf_indexes.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('SQL file not found:', sqlPath);
    process.exit(1);
  }
  const sqlText = fs.readFileSync(sqlPath, 'utf8');
  console.log('Connecting to SQL Server...');
  try {
    const pool = await connectDB();
    console.log('Applying indexes (this may take several minutes on the first run)...');
    const start = Date.now();
    const result = await pool.request().query(sqlText);
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nCompleted in ${secs}s.`);
    if (result && Array.isArray(result.output)) {
      for (const line of result.output) console.log(line);
    }
    console.log('\nAll requested indexes are in place.');
    process.exit(0);
  } catch (err) {
    console.error('\nFailed to apply indexes:', err.message);
    console.error('\nIf this is a permissions error, open sql/create_perf_indexes.sql in SSMS');
    console.error('and run it manually as a user with CREATE INDEX rights on the DB.');
    process.exit(2);
  }
})();
