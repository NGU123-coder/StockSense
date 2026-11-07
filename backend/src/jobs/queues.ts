/**
 * Background jobs with BullMQ (Redis-backed).
 *
 * - "forecasts": recalculates demand forecasts + reorder points. Runs every night
 *   at 02:00 IST and on demand from the dashboard.
 * - "notifications": sends alert emails, with retries, outside the request cycle.
 *
 * When ENABLE_JOBS=false (tests) or Redis is unreachable, work runs inline instead,
 * so the app never depends on Redis to function.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env';
import { sendMail } from '../lib/mailer';

const connection: ConnectionOptions = { url: env.REDIS_URL, maxRetriesPerRequest: null };

let forecastQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
const workers: Worker[] = [];

export const jobsEnabled = () => env.ENABLE_JOBS && forecastQueue !== null;

export async function startJobs(runForecasts: () => Promise<unknown>) {
  if (!env.ENABLE_JOBS) return;
  try {
    forecastQueue = new Queue('forecasts', { connection });
    notificationQueue = new Queue('notifications', { connection });
    await forecastQueue.waitUntilReady();

    // Nightly schedule (idempotent: re-registering the same scheduler id just updates it).
    await forecastQueue.upsertJobScheduler(
      'nightly-forecast',
      { pattern: '0 2 * * *', tz: 'Asia/Kolkata' },
      { name: 'run-forecasts', opts: { removeOnComplete: 20, removeOnFail: 50 } },
    );

    workers.push(
      new Worker('forecasts', async () => runForecasts(), { connection, concurrency: 1 }),
      new Worker(
        'notifications',
        async (job) => {
          const { to, subject, text } = job.data as { to: string; subject: string; text: string };
          await sendMail({ to, subject, text });
        },
        { connection, concurrency: 5 },
      ),
    );
    for (const w of workers) w.on('failed', (job, err) => console.error(`Job ${job?.name} failed:`, err.message));
    console.log('✓ Background jobs started (BullMQ)');
  } catch (err) {
    console.warn('⚠ Redis unavailable, background jobs disabled:', (err as Error).message);
    forecastQueue = null;
    notificationQueue = null;
  }
}

/** Queue a forecast run. Returns the job id, or null if queues are off (caller runs inline). */
export async function enqueueForecastRun(): Promise<string | null> {
  if (!forecastQueue) return null;
  const job = await forecastQueue.add('run-forecasts', {}, { removeOnComplete: 20, removeOnFail: 50 });
  return job.id ?? null;
}

export async function enqueueAlertEmail(msg: { subject: string; text: string }) {
  if (!env.ALERT_EMAIL_TO) return;
  const data = { to: env.ALERT_EMAIL_TO, ...msg };
  if (notificationQueue) {
    await notificationQueue.add('alert-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
    });
  } else {
    sendMail(data).catch((e) => console.error('Alert email failed:', e.message));
  }
}

export async function stopJobs() {
  await Promise.all(workers.map((w) => w.close()));
  await forecastQueue?.close();
  await notificationQueue?.close();
}
