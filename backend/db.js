const sql = require('mssql');
require('dotenv').config();

// Connection strategy:
//   1. If DB_PORT is set → connect directly via host + port (no Browser service needed).
//      Works for the default instance (MSSQLSERVER) and any named instance with a static port.
//   2. If DB_PORT is not set but DB_SERVER contains a backslash (e.g. HOST\INSTANCE) →
//      use instanceName resolution via SQL Server Browser (UDP 1434).
const rawServer = process.env.DB_SERVER || '';
const explicitPort = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : null;
const [serverHost, instanceName] = rawServer.split('\\');

// Use Windows Authentication when DB_USER is blank (recommended for local dev).
// Use SQL Server auth when DB_USER is set (requires Mixed Mode to be enabled).
const useWindowsAuth = !process.env.DB_USER;

const config = {
  ...(useWindowsAuth ? {} : { user: process.env.DB_USER, password: process.env.DB_PASSWORD }),
  server:   serverHost,
  database: process.env.DB_DATABASE,
  ...(explicitPort
    ? { port: explicitPort }
    : {}),
  requestTimeout: 180000, // 180s — handles cold disk I/O on first start (warm queries: ~165ms)
  options: {
    encrypt: false,
    trustServerCertificate: true,
    trustedConnection: useWindowsAuth,
    ...(!explicitPort && instanceName ? { instanceName } : {}),
  },
};

// Singleton pool — created once, reused for all requests.
let _pool = null;

async function connectDB() {
  if (_pool) return _pool;
  try {
    _pool = await sql.connect(config);
    // Attach an error listener so pool-level errors (e.g. timeout during cache warm-up)
    // don't propagate as unhandled EventEmitter 'error' events and crash the process.
    _pool.on('error', err => console.error('[pool error]', err.message));
    console.log('Connected to SQL Server');
    return _pool;
  } catch (err) {
    console.error('Database connection failed:', err);
    throw err;
  }
}

module.exports = { sql, connectDB };
