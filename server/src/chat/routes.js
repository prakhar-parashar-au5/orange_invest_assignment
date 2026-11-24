// Conversation endpoints (API-CONTRACT.md v1). Every query is scoped by req.userId. tool_calls_json
// is written for tracing and never selected into a response.
import { Router } from 'express';
import { HttpError, badRequest, notFound } from '../http/errors.js';
import { requireUser } from '../auth/session.js';
import { createTools } from '../agent/tools.js';
import { MAX_HISTORY_MESSAGES } from '../agent/agent.js';
import { toIstIso } from '../util/time.js';
import { describeError } from '../util/log-error.js';
import { createRecorder, traceHooks } from '../agent/recorder.js';

const unavailable = () => new HttpError(502, 'AGENT_UNAVAILABLE', 'The assistant could not answer right now. Please try again.');

const MAX_TEXT = 2000;
const TITLE_LENGTH = 60;

const toConversationJson = (c) => ({
  id: c.id,
  title: c.title,
  created_at: toIstIso(c.created_at),
  updated_at: toIstIso(c.updated_at),
});
const toMessageJson = (m) => ({ id: m.id, role: m.role, content: m.content, created_at: toIstIso(m.created_at) });
const MESSAGE_COLUMNS = 'id, role, content, created_at';

function pathId(value) {
  if (!/^\d{1,15}$/.test(value) || Number(value) <= 0) throw notFound('Conversation not found');
  return Number(value);
}

/**
 * @param {{ config: object, db: import('mysql2/promise').Pool, dbReadonly: import('mysql2/promise').Pool,
 *           agent: ReturnType<typeof import('../agent/agent.js').createAgent> | null, logger?: { warn: Function } }} deps
 */
export function chatRouter({ config, db, dbReadonly, agent, recorder = createRecorder({ db }), chatLimit = (_q, _s, next) => next(), logger = console }) {
  const router = Router();
  const auth = requireUser(config);

  async function ownedConversation(userId, id) {
    const [rows] = await db.query('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) throw notFound('Conversation not found');
    return rows[0];
  }

  async function message(userId, id) {
    const [[row]] = await db.query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ? AND user_id = ?`, [id, userId]);
    return toMessageJson(row);
  }

  router.post('/conversations', auth, async (req, res) => {
    const [r] = await db.query('INSERT INTO conversations (user_id) VALUES (?)', [req.userId]);
    res.status(201).json({ conversation: toConversationJson(await ownedConversation(req.userId, r.insertId)) });
  });

  router.get('/conversations', auth, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [req.userId]);
    res.json({ conversations: rows.map(toConversationJson) });
  });

  router.get('/conversations/:id/messages', auth, async (req, res) => {
    const conv = await ownedConversation(req.userId, pathId(req.params.id));
    const [rows] = await db.query(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id ASC`,
      [conv.id, req.userId],
    );
    res.json({ messages: rows.map(toMessageJson) });
  });

  router.post('/conversations/:id/messages', auth, chatLimit, async (req, res) => {
    const id = pathId(req.params.id);
    const raw = req.body?.text;
    if (typeof raw !== 'string' || raw.trim().length === 0) throw badRequest('text is required');
    const text = raw.trim();
    if (text.length > MAX_TEXT) throw badRequest(`text must be at most ${MAX_TEXT} characters`);
    const conv = await ownedConversation(req.userId, id);

    // History is this conversation only, read before the new message goes in.
    const [past] = await db.query(
      `SELECT role, content FROM (
         SELECT id, role, content FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?
       ) recent ORDER BY id ASC`,
      [conv.id, req.userId, MAX_HISTORY_MESSAGES],
    );

    const [ins] = await db.query("INSERT INTO messages (conversation_id, user_id, role, content) VALUES (?, ?, 'user', ?)", [
      conv.id,
      req.userId,
      text,
    ]);
    await db.query(
      'UPDATE conversations SET title = COALESCE(title, ?), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?',
      [text.slice(0, TITLE_LENGTH), conv.id, req.userId],
    );

    if (!agent) {
      logger.warn('chat: OPENAI_API_KEY not set; the assistant is unavailable');
      throw new HttpError(502, 'AGENT_UNAVAILABLE', 'The assistant is not available right now. Please try again later.');
    }

    // Fail closed: no trace row, no AI call.
    const startedAt = Date.now();
    let traceId;
    try {
      traceId = await recorder.startTrace({ userId: req.userId, conversationId: conv.id, userMessageId: ins.insertId, model: agent.model ?? config.openaiModel });
    } catch (err) {
      logger.warn(`chat: could not start the AI trace (${describeError(err)})`);
      throw unavailable();
    }

    let reply;
    try {
      // The tools get the session user and the read-only pool. Nothing from the request or the
      // model can change either.
      const tools = createTools({ db: dbReadonly, userId: req.userId });
      reply = await agent.reply({ tools, history: past, userText: text, hooks: traceHooks(recorder, traceId) });
    } catch (err) {
      logger.warn(`chat: agent failed at ${err.stage ?? 'internal'} (${describeError(err)})`);
      await recorder
        .finishTrace(traceId, { status: 'FAILED', errorStage: err.stage ?? 'internal', err, latencyMs: Date.now() - startedAt })
        .catch((e) => logger.warn(`chat: could not finish the failed trace (${describeError(e)})`));
      throw unavailable();
    }

    // The answer and the finished trace commit together. If the trace can't be written, the user
    // gets 502 and no answer is stored.
    const conn = await db.getConnection();
    let assistantId;
    try {
      await conn.beginTransaction();
      const [out] = await conn.query(
        "INSERT INTO messages (conversation_id, user_id, role, content, tool_calls_json) VALUES (?, ?, 'assistant', ?, ?)",
        [conv.id, req.userId, reply.content, JSON.stringify(reply.toolCalls)],
      );
      assistantId = out.insertId;
      await recorder.finishTrace(
        traceId,
        {
          status: 'SUCCEEDED',
          rounds: reply.rounds,
          tokensIn: reply.tokensIn ?? 0,
          tokensOut: reply.tokensOut ?? 0,
          latencyMs: Date.now() - startedAt,
          assistantMessageId: assistantId,
        },
        conn,
      );
      await conn.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?', [conv.id, req.userId]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.warn(`chat: could not record the answer (${describeError(err)})`);
      await recorder
        .finishTrace(traceId, { status: 'FAILED', errorStage: 'record', err, latencyMs: Date.now() - startedAt })
        .catch(() => {});
      throw unavailable();
    } finally {
      conn.release();
    }

    res.status(201).json({ user_message: await message(req.userId, ins.insertId), assistant_message: await message(req.userId, assistantId) });
  });

  return router;
}
