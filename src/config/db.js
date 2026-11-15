import pg from 'pg';
import { config } from './env.js';

let pool;

/** Lazily created shared pool so importing the app never requires a database (e.g. /health). */
export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('Database URL is not configured');
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

/** Runs fn(client) inside one transaction; commits on success, rolls back on any error. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
