const { connectDB } = require('./db');
(async () => {
  try {
    const p = await connectDB();
    const cols = await p.request().query(
      "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Loans' ORDER BY ORDINAL_POSITION"
    );
    console.log('Loans columns:', JSON.stringify(cols.recordset, null, 2));
    const sample = await p.request().query('SELECT TOP 1 * FROM Loans WITH (NOLOCK)');
    console.log('Sample row keys:', Object.keys(sample.recordset[0] || {}));
  } catch (e) { console.error(e.message); }
  process.exit(0);
})();
