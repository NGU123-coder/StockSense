import Redis from 'ioredis';
import { env } from '../config/env';

let client: Redis | null = null;

/** Shared Redis connection (lazy). The app keeps working if Redis is down — caching just turns off. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // In tests (no Redis) give up immediately instead of reconnecting forever.
      retryStrategy: (times) => (env.NODE_ENV === 'test' ? null : Math.min(times * 500, 5000)),
    });
    client.on('error', () => {
      /* logged once by cache helpers; avoid noisy stack traces */
    });
    client.connect().catch(() => undefined);
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
