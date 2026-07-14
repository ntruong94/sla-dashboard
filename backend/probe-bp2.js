const sql = require('mssql');
require('dotenv').config();
const cfg = {
  server: process.env.DB_SERVER, port: +process.env.DB_PORT,
  database: process.env.DB_DATABASE, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }
};
const today = '2026-05-28', todayNext = '2026-05-29';

sql.connect(cfg).then(async pool => {
  // Departments with tasks today — same query as refreshTeams
  const res = await pool.request().query(
    "SELECT DISTINCT s.DepartmentId, d.Name AS DepartmentName " +
    "FROM Tasks t " +
    "INNER JOIN Staff s ON t.AssignedTo = s.StaffID " +
    "INNER JOIN Department d ON s.DepartmentId = d.DepartmentId " +
    "WHERE t.DateCreated >= '" + today + "' AND t.DateCreated < '" + todayNext + "' " +
    "AND s.EmployeeStatus = 1 AND s.DepartmentId IS NOT NULL AND d.Name IS NOT NULL " +
    "ORDER BY d.Name"
  );
  console.log('Depts with tasks today:');
  res.recordset.forEach(r => console.log(`  ${r.DepartmentId}: ${r.DepartmentName}`));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
