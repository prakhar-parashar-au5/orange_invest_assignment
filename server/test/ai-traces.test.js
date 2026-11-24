// BE-009: trace recording in the agent loop, fail-closed behaviour, the admin role and the admin AI API.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { testApp, loggedInAgent } from './helpers.js';
import { createAgent } from '../src/agent/agent.js';
import { createRecorder, scrub, PROMPT_VERSION } from '../src/agent/recorder.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const usage = (i, o) => ({ prompt_tokens: i, completion_tokens: o });

let script;
let ctx;
beforeAll(() => {
  const openai = { chat: { completions: { create: vi.fn(async (req) => script(req)) } } };
  ctx = testApp({ agent: createAgent({ openai, model: 'gpt-4.1-mini' }) });
});
afterAll(() => ctx.close());

async function chatUser(label) {
  const { agent, user } = await loggedInAgent(ctx.app, label);
  await agent.post('/api/uploads').attach('file', fixture('hdfc-basic.csv'), { filename: 's.csv', contentType: 'text/csv' });
  const conv = await agent.post('/api/conversations').send({});
  return { agent, user, conversationId: conv.body.conversation.id };
}
const send = (u, text) => u.agent.post(`/api/conversations/${u.conversationId}/messages`).send({ text });
async function adminAgent() {
  const a = await loggedInAgent(ctx.app, 'admin');
  await ctx.db.query("UPDATE users SET role = 'admin' WHERE id = ?", [a.user.id]);
  return a.agent;
}
const lastTrace = async (userId) => {
  const [[t]] = await ctx.db.query('SELECT * FROM ai_traces WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
  return t;
};

describe('recording', () => {
  it('a successful turn records the trace and its model and tool calls in order, with token totals', async () => {
    const u = await chatUser('rec-ok');
    script = (req) =>
      req.messages.some((m) => m.role === 'tool')
        ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'You spent ₹34,551.50.' } }], usage: usage(200, 20) }
        : {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    toolCall('a', 'spend_summary', { period: 'month:2026-10', api_token: 'sk-should-not-be-stored' }),
                    toolCall('b', 'spend_summary', { period: 'next_month' }),
                  ],
                },
              },
            ],
            usage: usage(100, 10),
          };

    const res = await send(u, 'How much in October?');

    expect(res.status).toBe(201);
    const t = await lastTrace(u.user.id);
    expect(t).toMatchObject({
      status: 'SUCCEEDED',
      model: 'gpt-4.1-mini',
      prompt_version: PROMPT_VERSION,
      rounds: 1,
      tokens_in: 300,
      tokens_out: 30,
      user_message_id: res.body.user_message.id,
      assistant_message_id: res.body.assistant_message.id,
    });
    expect(t.latency_ms).toBeGreaterThanOrEqual(0);
    expect(t.finished_at).not.toBeNull();

    const admin = await adminAgent();
    const detail = await admin.get(`/api/admin/ai/traces/${t.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.timeline.map((e) => [e.seq, e.type, e.status])).toEqual([
      [1, 'model_call', 'SUCCEEDED'],
      [2, 'tool_call', 'SUCCEEDED'],
      [3, 'tool_call', 'REJECTED'],
      [4, 'model_call', 'SUCCEEDED'],
    ]);
    expect(detail.body.timeline[0]).toMatchObject({ requested_tools: 2, tokens_in: 100, finish_reason: 'tool_calls' });
    expect(detail.body.timeline[1].args).toEqual({ period: 'month:2026-10' }); // api_token scrubbed
    expect(detail.body.timeline[1].result.total.paise).toBe(3455150);
    expect(detail.body.timeline[2]).toMatchObject({ validation_status: 'REJECTED', error: expect.stringMatching(/period/) });
    expect(detail.body.user_message.content).toBe('How much in October?');
    expect(detail.body.tokens).toEqual({ in: 300, out: 30 });
  });

  it('a failed provider call records FAILED with the HTTP status and no message text', async () => {
    const u = await chatUser('rec-401');
    script = () => {
      throw Object.assign(new Error('401 Incorrect API key provided: sk-ab...wxyz'), { name: 'AuthenticationError', status: 401 });
    };

    const res = await send(u, 'hello');

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AGENT_UNAVAILABLE');
    const t = await lastTrace(u.user.id);
    expect(t).toMatchObject({ status: 'FAILED', error_stage: 'model', error_class: 'AuthenticationError', provider_http_status: 401 });
    const [calls] = await ctx.db.query('SELECT * FROM ai_model_calls WHERE trace_id = ?', [t.id]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'FAILED', provider_http_status: 401 });
    const everything = JSON.stringify({ t, calls });
    expect(everything).not.toContain('sk-ab');
    expect(everything).not.toMatch(/Incorrect API key/);
  });

  it('fails closed: if recording fails, the user gets 502 and no answer is stored', async () => {
    const real = createRecorder({ db: ctx.db });
    const broken = {
      ...real,
      finishToolCall: async () => {
        throw new Error('disk full');
      },
    };
    const brokenCtx = testApp({ agent: createAgent({ openai: { chat: { completions: { create: async (req) => script(req) } } }, model: 'm' }), recorder: broken });
    try {
      const { agent, user } = await loggedInAgent(brokenCtx.app, 'rec-broken');
      const conv = await agent.post('/api/conversations').send({});
      script = (req) =>
        req.messages.some((m) => m.role === 'tool')
          ? { choices: [{ message: { content: 'answer' } }] }
          : { choices: [{ message: { content: null, tool_calls: [toolCall('x', 'spend_summary', { period: 'all_time' })] } }] };

      const res = await agent.post(`/api/conversations/${conv.body.conversation.id}/messages`).send({ text: 'q' });

      expect(res.status).toBe(502);
      const [msgs] = await brokenCtx.db.query('SELECT role FROM messages WHERE conversation_id = ?', [conv.body.conversation.id]);
      expect(msgs.map((m) => m.role)).toEqual(['user']);
      const [[t]] = await brokenCtx.db.query('SELECT status, error_stage FROM ai_traces WHERE user_id = ?', [user.id]);
      expect(t).toEqual({ status: 'FAILED', error_stage: 'record' });
    } finally {
      await brokenCtx.close();
    }
  });

  it('the scrubber drops secret-looking keys at any depth, and keeps the rest', () => {
    expect(
      scrub({ period: 'x', token: 't', nested: [{ Authorization: 'a', apiKey: 'k', keep: 1 }], password_hint: 'p', cookieJar: 'c' }),
    ).toEqual({ period: 'x', nested: [{ keep: 1 }] });
  });
});

describe('admin API', () => {
  it('401 without login; reads are open to any logged-in user (BE-016); /me returns role', async () => {
    const plain = await loggedInAgent(ctx.app, 'not-admin');
    const admin = await adminAgent();
    const { default: request } = await import('supertest');

    const anon = await request(ctx.app).get('/api/admin/ai/summary');
    const userRead = await plain.agent.get('/api/admin/ai/traces');
    const ok = await admin.get('/api/admin/ai/summary?window=7d');
    const me = await admin.get('/api/auth/me');

    expect(anon.status).toBe(401);
    expect(userRead.status).toBe(200);
    expect(ok.status).toBe(200);
    expect(ok.body.series).toHaveLength(7);
    expect(ok.body.traces.total).toBeGreaterThan(0);
    expect(me.body.user.role).toBe('admin');
    expect(plain.user.role).toBe('user');
  });

  it('review: create, update, then a stale version gets 409 STALE_REVIEW; the list has no message text', async () => {
    const u = await chatUser('review');
    script = () => ({ choices: [{ message: { content: 'Hi there, unique-answer-text.' } }], usage: usage(5, 5) });
    await send(u, 'unique-question-text');
    const t = await lastTrace(u.user.id);
    const admin = await adminAgent();

    const first = await admin.put(`/api/admin/ai/traces/${t.id}/review`).send({ verdict: 'good', note: 'ok', expectedVersion: 0 });
    const second = await admin.put(`/api/admin/ai/traces/${t.id}/review`).send({ verdict: 'needs_fix', expectedVersion: 1 });
    const stale = await admin.put(`/api/admin/ai/traces/${t.id}/review`).send({ verdict: 'bad', expectedVersion: 1 });
    const list = await admin.get(`/api/admin/ai/traces?user_id=${u.user.id}`);
    const noConfirm = await admin.delete(`/api/admin/ai/traces/${t.id}`);
    const del = await admin.delete(`/api/admin/ai/traces/${t.id}?confirm=true`);

    expect(first.body.review).toMatchObject({ verdict: 'good', version: 1 });
    expect(second.body.review).toMatchObject({ verdict: 'needs_fix', version: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVIEW');
    expect(list.body.traces).toHaveLength(1);
    expect(list.body.traces[0]).toMatchObject({ id: t.id, review_verdict: 'needs_fix', status: 'SUCCEEDED' });
    expect(JSON.stringify(list.body)).not.toMatch(/unique-(question|answer)-text/);
    expect(noConfirm.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(del.status).toBe(204);
  });
});
