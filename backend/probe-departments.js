// Diagnostic: verify Data Entry / Valuations / Packaging & QA exist as
// Department names, and count today's tasks assigned to their active staff
// (regardless of UsedForKPI). Confirms the user's "volume = 22" expectation.
const { connectDB } = require('./db');

(async () => {
  const pool = await connectDB();

  // Effective reporting date (matches server.js resolveEffectiveDate).
  const dateRes = await pool.request().query(`
    SELECT CONVERT(varchar(10), MAX(DateCreated), 120) AS today FROM Tasks WITH (NOLOCK)
  `);
  const today = dateRes.recordset[0].today;
  const next  = new Date(today); next.setDate(next.getDate() + 1);
  const nextStr = next.toISOString().slice(0, 10);
  console.log(`Reporting date: ${today} .. ${nextStr}\n`);

  // 1. Do the department names exist?
  const wanted = ['Data Entry', 'Valuations', 'Packaging & QA', 'BP Help Desk',
                  'Packaging', 'QA', 'Valuation'];
  for (const w of wanted) {
    const r = await pool.request().query(`
      SELECT DepartmentId, Name
      FROM Department WITH (NOLOCK)
      WHERE Name LIKE N'%${w}%'
      ORDER BY Name
    `);
    console.log(`Department LIKE "${w}": ${r.recordset.length} match(es)`);
    if (r.recordset.length) console.table(r.recordset);
  }

  // 2. For each of the 4 named departments (best-effort by exact name),
  //    count today's tasks assigned to their active staff — ANY UsedForKPI.
  const namesExact = ['Data Entry', 'Valuations', 'Packaging & QA', 'BP Help Desk'];
  console.log('\n=== Today\'s task counts per Department (any UsedForKPI, any status IN (1,2,4,5,6)) ===');
  for (const name of namesExact) {
    const r = await pool.request().query(`
      SELECT
        d.DepartmentId,
        d.Name AS DeptName,
        COUNT(*) AS totalTasksToday,
        SUM(CASE WHEN t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS activeTasks,
        SUM(CASE WHEN ct.UsedForKPI = 1 AND LTRIM(RTRIM(ISNULL(ct.SpecifiedKPIGrp,N''))) = N'${name.replace(/'/g,"''")}' THEN 1 ELSE 0 END) AS kpiTagged
      FROM Tasks t WITH (NOLOCK)
      INNER JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
      LEFT  JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId
      INNER JOIN Department d WITH (NOLOCK) ON s.DepartmentId = d.DepartmentId
      WHERE t.DateCreated >= '${today}' AND t.DateCreated < '${nextStr}'
        AND s.EmployeeStatus = 1
        AND d.Name = N'${name.replace(/'/g,"''")}'
      GROUP BY d.DepartmentId, d.Name
    `);
    if (r.recordset.length === 0) {
      console.log(`  "${name}": no department with that exact name has active tasks today`);
    } else {
      console.table(r.recordset);
    }
  }

  // 3. All departments with active tasks today (top 20 by volume) — helps see
  //    what the true dept names look like in the DB.
  const all = await pool.request().query(`
    SELECT TOP 30
      d.DepartmentId,
      d.Name AS DeptName,
      COUNT(*) AS totalTasksToday,
      SUM(CASE WHEN t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS activeTasks
    FROM Tasks t WITH (NOLOCK)
    INNER JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
    INNER JOIN Department d WITH (NOLOCK) ON s.DepartmentId = d.DepartmentId
    WHERE t.DateCreated >= '${today}' AND t.DateCreated < '${nextStr}'
      AND s.EmployeeStatus = 1
    GROUP BY d.DepartmentId, d.Name
    ORDER BY totalTasksToday DESC
  `);
  console.log('\n=== ALL departments with active-staff tasks today (top 30 by volume) ===');
  console.table(all.recordset);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
