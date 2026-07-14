const sql = require('mssql');
require('dotenv').config();
const cfg = {
  server: process.env.DB_SERVER, port: +process.env.DB_PORT,
  database: process.env.DB_DATABASE, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(async pool => {
  // 1. Find BP Helpdesk department
  // List ALL active departments so we can find the real name for BP Helpdesk
  const depts = await pool.request().query(
    "SELECT DISTINCT d.DepartmentId, d.Name FROM Department d INNER JOIN Staff s ON s.DepartmentId = d.DepartmentId WHERE s.EmployeeStatus = 1 AND d.DepartmentId IS NOT NULL ORDER BY d.Name"
  );
  console.log('All active departments:', JSON.stringify(depts.recordset, null, 2));

  // Also check today's tasks (2026-05-28) - same as refreshTeams
  const today = '2026-05-28', todayNext = '2026-05-29';
  const todayDepts = await pool.request().query(
    "SELECT DISTINCT s.DepartmentId, d.Name AS DepartmentName FROM Tasks t INNER JOIN Staff s ON t.AssignedTo = s.StaffID INNER JOIN Department d ON s.DepartmentId = d.DepartmentId WHERE t.DateCreated >= '" + today + "' AND t.DateCreated < '" + todayNext + "' AND s.EmployeeStatus = 1 AND s.DepartmentId IS NOT NULL AND d.Name IS NOT NULL ORDER BY d.Name"
  );
  console.log('Departments with tasks today:', JSON.stringify(todayDepts.recordset, null, 2));

  // 2. Volume for BP Helpdesk today (2026-05-28)
  const today = '2026-05-28', todayNext = '2026-05-29';
  if (depts.recordset.length > 0) {
    const deptId = depts.recordset[0].DepartmentId;
    const vol = await pool.request().query(`
      SELECT COUNT(*) AS volume
      FROM Tasks t
      LEFT JOIN Staff s ON t.AssignedTo = s.StaffID
      LEFT JOIN ConfigTasks ct ON t.ConfigTaskId = ct.ConfigTaskId
      WHERE t.TaskStatusID IN (1, 4, 5, 6)
        AND s.DepartmentId = ${deptId}
        AND s.EmployeeStatus = 1
        AND t.DateCreated >= '${today}' AND t.DateCreated < '${todayNext}'
    `);
    console.log('Volume for deptId', deptId, ':', JSON.stringify(vol.recordset));
  }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
