import request from 'supertest';
import { pool } from '../src/db/client';
import { closeRedis } from '../src/lib/redis';
import { app, auth, PASSWORD, resetDb, tokenFor } from './helpers';

beforeAll(resetDb);
afterAll(async () => {
  await closeRedis();
  await pool.end();
});

describe('authentication', () => {
  it('logs in, returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'manager@test.in', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'manager@test.in', role: 'MANAGER' });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/ss_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'manager@test.in', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect email or password');
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('email');
  });

  it('rotates refresh tokens: an old token cannot be reused', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.in', password: PASSWORD });
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toEqual(expect.any(String));

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('protects API routes', async () => {
    expect((await request(app).get('/api/products')).status).toBe(401);
    expect((await request(app).get('/api/products').set(auth('garbage'))).status).toBe(401);
  });

  it('enforces roles: only admins manage users', async () => {
    const viewer = await tokenFor('VIEWER');
    const admin = await tokenFor('ADMIN');
    expect((await request(app).get('/api/users').set(auth(viewer))).status).toBe(403);
    const ok = await request(app).get('/api/users').set(auth(admin));
    expect(ok.status).toBe(200);
    expect(ok.body[0]).not.toHaveProperty('passwordHash');
  });
});
