import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const testAppConfig = { ...loadConfig({}), clientOrigin: 'http://localhost:5181' };

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp({ config: testAppConfig, db: null });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('allows CORS from the configured client origin', async () => {
    const app = createApp({ config: testAppConfig, db: null });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5181');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5181');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow CORS from other origins', async () => {
    const app = createApp({ config: testAppConfig, db: null });

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('unknown routes', () => {
  it('returns 404 JSON', async () => {
    const app = createApp({ config: testAppConfig, db: null });

    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
