// Runs the eval corpus against a live server through its HTTP API, then grades each answer with
// hard gates against the oracle (independent SQL) and the recorded trace.
//
// `client` hides HTTP: client.session(email) → { newConversation(), send(conversationId, text) }.
// `db` writes eval_runs/eval_results; `readDb` (read-only is enough) reads users, traces and the
// oracle's data.
import moment from 'moment-timezone';
import { computeTruth, allAmounts } from './oracle.js';
import {
  numbersGate,
  mentionsGate,
  isolationGate,
  toolLeakGate,
  toolValidityGate,
  traceCompleteGate,
  refusalGate,
  noDataGate,
} from './gates.js';

async function traceFacts(readDb, assistantMessageId) {
  if (!assistantMessageId) return { trace: null, toolCalls: [], modelCalls: 0 };
  const [[trace]] = await readDb.query('SELECT id, status FROM ai_traces WHERE assistant_message_id = ?', [assistantMessageId]);
  if (!trace) return { trace: null, toolCalls: [], modelCalls: 0 };
  const [toolCalls] = await readDb.query('SELECT name, status FROM ai_tool_calls WHERE trace_id = ? ORDER BY seq', [trace.id]);
  const [[{ n }]] = await readDb.query('SELECT COUNT(*) AS n FROM ai_model_calls WHERE trace_id = ?', [trace.id]);
  return { trace, toolCalls, modelCalls: Number(n) };
}

function gradeAnswer(expect, answer, facts, own, otherUnique) {
  const gates = {};
  if (expect.type === 'numbers') gates.numbers_exact = numbersGate(answer, own[expect.oracle]);
  if (expect.type === 'mentions') gates.mentions = mentionsGate(answer, own[expect.oracle]);
  if (expect.mentions) gates.mentions = mentionsGate(answer, expect.mentions);
  if (expect.type === 'refusal') gates.refusal_correct = refusalGate(answer);
  if (expect.type === 'no_data') gates.no_invented_numbers = noDataGate(answer);
  gates.isolation = isolationGate(answer, otherUnique);
  gates.no_tool_leak = toolLeakGate(answer);
  gates.tool_validity = toolValidityGate(facts.toolCalls);
  gates.trace_complete = traceCompleteGate(facts.trace, facts.modelCalls);
  return gates;
}

/**
 * @returns {Promise<{ runId: number, status: 'FINISHED'|'BLOCKED', cases: object[] }>}
 */
export async function runEval({ corpus, client, db, readDb, model, promptVersion, label = null, repeatHigh = 3, now = moment(), log = () => {} }) {
  const [run] = await db.query("INSERT INTO eval_runs (label, model, prompt_version, status) VALUES (?, ?, ?, 'RUNNING')", [
    label,
    model,
    promptVersion,
  ]);
  const runId = run.insertId;

  // Log in first (login creates the persona if needed), then compute each persona's truth.
  const personas = [...new Set(corpus.cases.map((c) => c.persona))];
  const sessions = {};
  const truth = {};
  for (const email of personas) {
    sessions[email] = await client.session(email);
    const [[u]] = await readDb.query('SELECT id FROM users WHERE email = ?', [email]);
    truth[email] = await computeTruth(readDb, u.id, now);
  }
  const amounts = Object.fromEntries(personas.map((p) => [p, allAmounts(truth[p])]));
  const otherUnique = (p) => {
    const own = new Set(amounts[p]);
    return personas.filter((q) => q !== p).flatMap((q) => amounts[q].filter((v) => !own.has(v)));
  };

  const summaries = [];
  let blocked = false;
  let firstSend = true;
  for (const c of corpus.cases) {
    if (blocked) break;
    const attempts = c.risk === 'high' ? repeatHigh : 1;
    const results = [];
    for (let attempt = 1; attempt <= attempts && !blocked; attempt += 1) {
      const s = sessions[c.persona];
      const conversationId = await s.newConversation();
      const started = Date.now();
      let res;
      for (const turn of c.turns) {
        res = await s.send(conversationId, turn);
        if (res.status !== 201) break;
      }
      const latency = Date.now() - started;
      let verdict;
      let gates;
      let answer = null;
      let traceId = null;
      if (res.status !== 201) {
        const code = res.body?.error?.code ?? `HTTP_${res.status}`;
        if (firstSend && code === 'AGENT_UNAVAILABLE') {
          blocked = true;
          verdict = 'blocked';
          gates = { agent_available: { pass: false, detail: 'AGENT_UNAVAILABLE on the first question; run stopped' } };
        } else {
          verdict = 'fail';
          gates = { trace_complete: { pass: false, detail: `HTTP ${res.status} ${code}` } };
        }
      } else {
        answer = res.body.assistant_message.content;
        const facts = await traceFacts(readDb, res.body.assistant_message.id);
        traceId = facts.trace?.id ?? null;
        gates = gradeAnswer(c.expect, answer, facts, truth[c.persona], otherUnique(c.persona));
        verdict = Object.values(gates).every((g) => g.pass) ? 'pass' : 'fail';
      }
      firstSend = false;
      await db.query(
        `INSERT INTO eval_results (run_id, case_id, risk, persona, attempt, verdict, gates_json, answer_text, trace_id, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, c.id, c.risk, c.persona, attempt, verdict, JSON.stringify(gates), answer, traceId, latency],
      );
      results.push({ attempt, verdict, gates });
    }
    const passed = results.filter((r) => r.verdict === 'pass').length;
    const caseVerdict = results.some((r) => r.verdict === 'blocked') ? 'blocked' : passed === results.length ? 'pass' : 'fail';
    summaries.push({ case_id: c.id, risk: c.risk, verdict: caseVerdict, attempts: results.length, passed, failedGates: failedGateNames(results) });
  }

  const count = (v) => summaries.filter((s) => s.verdict === v).length;
  const status = blocked ? 'BLOCKED' : 'FINISHED';
  await db.query(
    'UPDATE eval_runs SET status = ?, cases_total = ?, cases_passed = ?, cases_failed = ?, cases_blocked = ?, finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [status, corpus.cases.length, count('pass'), count('fail'), count('blocked'), runId],
  );
  printTable(log, runId, status, summaries, corpus.cases.length);
  return { runId, status, cases: summaries };
}

function failedGateNames(results) {
  const names = new Set();
  for (const r of results) for (const [k, g] of Object.entries(r.gates)) if (!g.pass) names.add(k);
  return [...names];
}

function printTable(log, runId, status, summaries, total) {
  log(`eval run ${runId}: ${status}`);
  log('case                                   risk    verdict  pass/attempts  failed gates');
  for (const s of summaries) {
    log(`${s.case_id.padEnd(38)} ${s.risk.padEnd(7)} ${s.verdict.padEnd(8)} ${`${s.passed}/${s.attempts}`.padEnd(14)} ${s.failedGates.join(', ')}`);
  }
  const passed = summaries.filter((s) => s.verdict === 'pass').length;
  log(`passed ${passed}/${total} cases${summaries.length < total ? ` (${total - summaries.length} not run)` : ''}`);
}
