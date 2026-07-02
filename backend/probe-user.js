// Diagnostic: check DashboardAccess columns + find user
const sql  = require('mssql');
require('dotenv').config();

const email = process.argv[2] || 'tvu@mezy.com.au';
const cfg = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
};

sql.connect(cfg).then(async pool => {
  // 1. Check Staff table email column
  const staffCols = await pool.request().query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Staff' AND COLUMN_NAME LIKE '%mail%' OR TABLE_NAME='Staff' AND COLUMN_NAME LIKE '%email%'`
  );
  console.log('Staff email columns:', staffCols.recordset.map(r => r.COLUMN_NAME));

  // 2. Search Staff by email (try EmailAddress and Email)
  const staffRes = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT StaffID, FirstName, Surname, EmailAddress FROM Staff WHERE EmailAddress = @email OR EmailAddress LIKE @email`);
  console.log('Staff rows:', staffRes.recordset);

  // 3. Check ConfigReportUsers
  const cruRes = await pool.request().query(
    `SELECT cru.UserId, cru.StaffId, s.EmailAddress, da.Role, da.IsActive
     FROM ConfigReportUsers cru
     LEFT JOIN Staff s ON s.StaffID = cru.StaffId
     LEFT JOIN DashboardAccess da ON da.UserId = cru.UserId`
  );
  console.log('\nAll ConfigReportUsers + DashboardAccess:');
  cruRes.recordset.forEach(r => console.log(' ', r));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
