// One-off script: create or update a user account to admin role.
// Usage: node set-admin-role.js <email> [tempPassword]
// Example: node set-admin-role.js tvu@mezy.com.au
// Default temp password: @dmin (user should change after first login)
const sql    = require('mssql');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const email       = process.argv[2];
const tempPass    = process.argv[3] || '@dmin';
const DASH_ID     = 1; // SLA_DASHBOARD_ID

if (!email) { console.error('Usage: node set-admin-role.js <email> [tempPassword]'); process.exit(1); }

const cfg = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
};

(async () => {
  const pool = await sql.connect(cfg);

  // 1. Find the Staff record (prefer lowest StaffID for duplicate emails)
  const staffRes = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT TOP 1 StaffID, FirstName, Surname FROM Staff WHERE EmailAddress = @email ORDER BY StaffID`);

  if (!staffRes.recordset.length) {
    console.error('No Staff record found for email:', email);
    process.exit(1);
  }
  const staff = staffRes.recordset[0];
  console.log(`Staff found: ${staff.FirstName} ${staff.Surname} (StaffID=${staff.StaffID})`);

  // 2. Check if ConfigReportUsers row exists
  const cruRes = await pool.request()
    .input('staffId', sql.Int, staff.StaffID)
    .query(`SELECT UserId FROM ConfigReportUsers WHERE StaffId = @staffId`);

  let userId;
  if (cruRes.recordset.length) {
    userId = cruRes.recordset[0].UserId;
    console.log(`Existing ConfigReportUsers row — UserId=${userId}`);
  } else {
    // Create new user
    const hash = await bcrypt.hash(tempPass, 12);
    const insRes = await pool.request()
      .input('staffId', sql.Int,    staff.StaffID)
      .input('hash',    sql.NVarChar, hash)
      .query(`INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt) OUTPUT INSERTED.UserId VALUES (@staffId, @hash, GETDATE())`);
    userId = insRes.recordset[0].UserId;
    console.log(`Created ConfigReportUsers row — UserId=${userId}, tempPassword="${tempPass}"`);
  }

  // 3. Upsert DashboardAccess with role='admin'
  const daRes = await pool.request()
    .input('userId', sql.Int, userId)
    .input('dashId', sql.Int, DASH_ID)
    .query(`SELECT DashboardAccessID FROM DashboardAccess WHERE UserId = @userId AND ConfigDashboardId = @dashId`);

  if (daRes.recordset.length) {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('dashId', sql.Int, DASH_ID)
      .query(`UPDATE DashboardAccess SET Role='admin', IsActive=1 WHERE UserId=@userId AND ConfigDashboardId=@dashId`);
    console.log(`Updated DashboardAccess → role='admin'`);
  } else {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('dashId', sql.Int, DASH_ID)
      .query(`INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive) VALUES (@dashId, @userId, 'admin', 1)`);
    console.log(`Inserted DashboardAccess → role='admin'`);
  }

  console.log(`\nDone. ${email} is now admin. Temp password: "${tempPass}" (change after first login).`);
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
