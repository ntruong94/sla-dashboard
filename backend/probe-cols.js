// Diagnostic: check DashboardAccess columns
const sql  = require('mssql');
require('dotenv').config();

const cfg = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: false, trustServerCertificate: true },
};

sql.connect(cfg).then(async pool => {
  const res = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DashboardAccess' ORDER BY ORDINAL_POSITION"
  );
  console.log('DashboardAccess columns:', res.recordset.map(r => r.COLUMN_NAME));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
