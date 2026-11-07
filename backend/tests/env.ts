// Loaded before every test file: point the app at the test database and turn off background jobs.
process.env.NODE_ENV = 'test';
process.env.ENABLE_JOBS = 'false';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://stocksense:stocksense@localhost:5432/stocksense_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-16';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-16';
process.env.INTERNAL_API_KEY ??= 'test-key';
process.env.FORECAST_SERVICE_URL = 'http://127.0.0.1:1'; // unreachable on purpose
process.env.REDIS_URL = 'redis://127.0.0.1:1';
