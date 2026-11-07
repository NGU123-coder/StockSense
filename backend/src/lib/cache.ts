import { getRedis } from './redis';

/**
 * Read-through cache: return the cached JSON if present, otherwise compute,
 * store with a TTL, and return. Any Redis failure falls back to computing.
 */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  try {
    if (redis.status === 'ready') {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit) as T;
    }
  } catch {
    /* cache miss on error */
  }
  const value = await compute();
  try {
    if (redis.status === 'ready') await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
  return value;
}

/** Delete every key starting with a prefix, e.g. invalidate('dashboard:'). */
export async function invalidate(prefix: string) {
  const redis = getRedis();
  if (redis.status !== 'ready') return;
  try {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  } catch {
    /* ignore */
  }
}
