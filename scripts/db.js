#!/usr/bin/env node
/**
 * Minimal, dependency-free migration runner.
 *   node scripts/db.js migrate   apply pending db/migrations/*.sql (each in a transaction)
 *   node scripts/db.js seed      apply db/seed/seed_reference.sql
 *   node scripts/db.js reset     DROP everything, migrate, seed (refused in production)
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/env.js';
import { getPool, closePool } from '../src/config/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(root, 'db', 'migrations');
const SEED = path.join(root, 'db', 'seed', 'seed_reference.sql');
const checksum = (s) => createHash('sha256').update(s).digest('hex');

async function migrate() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)'); // one runner at a time
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Map(
      (await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [
        r.filename,
        r.checksum,
      ]),
    );
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');
      const sum = checksum(sql);
      if (applied.has(file)) {
        if (applied.get(file) !== sum)
          throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file,
          sum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      console.log(`applied  ${file}`);
      count += 1;
    }
    console.log(count ? `${count} migration(s) applied` : 'database is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

async function seed() {
  await getPool().query(await readFile(SEED, 'utf8'));
  console.log('reference data seeded');
}

async function reset() {
  if (config.NODE_ENV === 'production')
    throw new Error('db:reset is refused when NODE_ENV=production');
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped and recreated');
  await migrate();
  await seed();
}

const commands = { migrate, seed, reset };
const cmd = process.argv[2];
try {
  if (!commands[cmd])
    throw new Error(`Usage: node scripts/db.js <${Object.keys(commands).join('|')}>`);
  if (!config.databaseUrl)
    throw new Error('No database URL set (DATABASE_URL, or DATABASE_URL_TEST when NODE_ENV=test)');
  await commands[cmd]();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
