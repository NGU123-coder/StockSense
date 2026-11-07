/** Applies pending SQL migrations from ./drizzle. Run: npm run db:migrate */
import 'dotenv/config';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

async function main() {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  console.log('✓ Migrations applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
