// BE-013: the artifacts API, and the pages' honesty checks (links resolve, the request flow exists in code).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { testApp, loggedInAgent } from './helpers.js';
import { ARTIFACTS } from '../src/artifacts/routes.js';
import { resolveFlowFile } from '../scripts/artifacts-build.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = path.join(REPO, 'docs', 'artifacts');

let ctx;
let agent;
beforeAll(async () => {
  ctx = testApp();
  ({ agent } = await loggedInAgent(ctx.app, 'artifacts'));
});
afterAll(() => ctx.close());

describe('artifacts API', () => {
  it('needs a login', async () => {
    expect((await request(ctx.app).get('/api/artifacts')).status).toBe(401);
    expect((await request(ctx.app).get('/api/artifacts/architecture')).status).toBe(401);
  });

  it('lists the four pages and serves one with its data, with no-store and nosniff', async () => {
    const list = await agent.get('/api/artifacts');
    const page = await agent.get('/api/artifacts/architecture');

    expect(list.body.artifacts.map((a) => a.name)).toEqual(['requirements', 'architecture', 'built-with-ai', 'quality']);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.body.markdown).toMatch(/^# Architecture/);
    expect(Object.keys(page.body.data)).toEqual(['schema', 'request_flow']);
    expect(page.body.data.request_flow.steps.length).toBeGreaterThan(5);
    expect((await agent.get('/api/artifacts/requirements')).body.data).toBeNull();
  });

  it.each([['nope'], ['..%2F..%2Fpackage.json'], ['%2e%2e%2fschema.sql'], ['01-requirements-and-decisions.md'], ['architecture.json'], ['constructor'], ['__proto__']])(
    'returns 404 for %s',
    async (name) => {
      const res = await agent.get(`/api/artifacts/${name}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );
});

describe('the pages are honest', () => {
  const pages = [...ARTIFACTS.map((a) => path.join(DOCS, a.file)), path.join(REPO, 'docs', 'requirements.md')];

  it.each(pages.map((p) => [path.relative(REPO, p), p]))('every link in %s points to a file that exists', (_name, page) => {
    const md = readFileSync(page, 'utf8');
    const links = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:|#)/.test(l));
    const missing = links.filter((l) => !existsSync(path.resolve(path.dirname(page), decodeURIComponent(l.split('#')[0]))));

    expect(links.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('every step in request-flow.json exists in code (client steps whenever client/ is present)', () => {
    const flow = JSON.parse(readFileSync(path.join(DOCS, 'request-flow.json'), 'utf8'));
    const clientDir = path.join(REPO, 'client');
    const checkable = flow.steps.filter((s) => s.repo === 'server' || existsSync(clientDir));
    const missing = checkable.filter((s) => {
      const file = resolveFlowFile(s, { repo: REPO, client: clientDir });
      return !existsSync(file) || !readFileSync(file, 'utf8').includes(s.symbol);
    });

    expect(flow.steps.filter((s) => s.repo === 'server').length).toBeGreaterThanOrEqual(8);
    expect(missing.map((s) => s.label)).toEqual([]);
  });

  it('pages contain no secret-looking strings', () => {
    for (const p of pages) expect(readFileSync(p, 'utf8')).not.toMatch(/sk-[A-Za-z0-9]{8,}|BEGIN PRIVATE KEY|password\s*[:=]\s*\S+/i);
  });
});
