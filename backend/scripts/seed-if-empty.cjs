// First-run demo bootstrap: hold a session lock and never replace existing data.
const { Pool } = require('pg');
const { execFileSync } = require('node:child_process');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('stocksense-demo-bootstrap'))");
    const { rows } = await client.query(`SELECT EXISTS (
      SELECT 1 FROM users UNION ALL SELECT 1 FROM warehouses
      UNION ALL SELECT 1 FROM suppliers UNION ALL SELECT 1 FROM products
      UNION ALL SELECT 1 FROM stock_levels UNION ALL SELECT 1 FROM stock_movements
      UNION ALL SELECT 1 FROM purchase_orders UNION ALL SELECT 1 FROM purchase_order_items
      UNION ALL SELECT 1 FROM alerts UNION ALL SELECT 1 FROM forecasts
      UNION ALL SELECT 1 FROM refresh_tokens
    ) AS populated`);
    if (rows[0].populated) {
      console.log('Demo bootstrap skipped: database already contains application data.');
      return;
    }
    execFileSync(process.execPath, ['dist-seed/scripts/seed.js'], { stdio: 'inherit' });
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('stocksense-demo-bootstrap'))");
    client.release();
    await pool.end();
  }
}
main().catch(err => { console.error('Demo bootstrap failed:', err.message); process.exitCode = 1; });
