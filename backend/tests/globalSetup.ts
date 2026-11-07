import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Runs once before the whole suite: bring the test database schema up to date. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://stocksense:stocksense@localhost:5432/stocksense_test';
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../drizzle') });
  await pool.end();
}
