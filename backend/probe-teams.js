// One-shot diagnostic: shows which SpecifiedKPIGrp values exist and how many
// UsedForKPI-flagged task codes each holds.
const { connectDB } = require('./db');

(async () => {
  const pool = await connectDB();

  const grp = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(ISNULL(SpecifiedKPIGrp, N''))) AS grp,
      ISNULL(UsedForKPI, 0) AS usedForKPI,
      COUNT(*)              AS codeCount
    FROM ConfigTasks WITH (NOLOCK)
    GROUP BY LTRIM(RTRIM(ISNULL(SpecifiedKPIGrp, N''))), ISNULL(UsedForKPI, 0)
    ORDER BY usedForKPI DESC, grp
  `);

  console.log('\n=== ConfigTasks grouped by (SpecifiedKPIGrp, UsedForKPI) ===');
  console.table(grp.recordset);

  const wanted = ['Data Entry', 'Valuations', 'Packaging & QA', 'BP Help Desk',
                  'Valuation', 'Packaging', 'QA', 'Data%Entry'];
  console.log('\n=== LIKE-search for the names the user is expecting ===');
  for (const w of wanted) {
    const r = await pool.request().query(`
      SELECT TaskCode, TaskName, UsedForKPI, SpecifiedKPIGrp
      FROM ConfigTasks WITH (NOLOCK)
      WHERE SpecifiedKPIGrp LIKE N'%${w}%'
    `);
    console.log(`  "${w}": ${r.recordset.length} row(s)`);
    if (r.recordset.length) console.table(r.recordset);
  }

  // Rule 2 check: any UsedForKPI=1 tasks with NULL/empty kpiGrp assigned
  // to an active staff member with a real department? That would spawn a
  // dept-based team but the log shows 0 dept teams.
  const rule2 = await pool.request().query(`
    SELECT TOP 20
      s.DepartmentId, d.Name AS DeptName, COUNT(*) AS taskCount
    FROM Tasks t WITH (NOLOCK)
    INNER JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
    INNER JOIN ConfigTasks ct WITH (NOLOCK) ON t.ConfigTaskId = ct.ConfigTaskId
    LEFT JOIN Department d WITH (NOLOCK) ON s.DepartmentId = d.DepartmentId
    WHERE ct.UsedForKPI = 1
      AND (ct.SpecifiedKPIGrp IS NULL OR LTRIM(RTRIM(ct.SpecifiedKPIGrp)) = N'')
      AND s.EmployeeStatus = 1
      AND s.DepartmentId IS NOT NULL
      AND d.Name IS NOT NULL
    GROUP BY s.DepartmentId, d.Name
    ORDER BY taskCount DESC
  `);
  console.log('\n=== Rule 2 (dept fallback) candidates ===');
  if (rule2.recordset.length === 0) {
    console.log('  none — no UsedForKPI=1 tasks with an empty SpecifiedKPIGrp are');
    console.log('  currently assigned to an active staff member with a real Department.');
  } else {
    console.table(rule2.recordset);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
