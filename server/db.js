import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env.server') });

const mssqlConfig = {
  server: process.env.MSSQL_HOST || 'localhost',
  port: parseInt(process.env.MSSQL_PORT || '1433'),
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE || 'BusyFY2026',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

export async function getPool() {
  if (!pool) {
    pool = await sql.connect(mssqlConfig);
    console.log('[db] Connected to BusyFY2026 on', mssqlConfig.server);
  }
  return pool;
}

export { sql };
