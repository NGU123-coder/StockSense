import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/client';
import { startJobs, stopJobs } from './jobs/queues';
import { closeRedis, getRedis } from './lib/redis';
import { initSocket } from './lib/socket';
import { runForecasts } from './modules/forecasts/forecast.service';

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  getRedis();
  await startJobs(runForecasts);

  server.listen(env.PORT, () => {
    console.log(`✓ StockSense API listening on http://localhost:${env.PORT}`);
  });

  // Graceful shutdown: finish in-flight requests, then close connections.
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`);
    server.close();
    await stopJobs();
    await closeRedis();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
