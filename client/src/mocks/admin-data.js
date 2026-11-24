// Synthetic admin data for the MSW mocks (API-CONTRACT v1.4 "Admin AI", v1.5 "Admin evals").
// Fixed timestamps so tests are deterministic. Not real traces.

const t = (hh, mm, ss = 0) => `2026-11-24T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+05:30`

function row(over) {
  return {
    finished_at: null,
    status: 'SUCCEEDED',
    error_stage: null,
    error_class: null,
    provider_http_status: null,
    model: 'gpt-4.1-mini',
    prompt_version: 'v1',
    rounds: 2,
    tokens_in: 3120,
    tokens_out: 210,
    latency_ms: 2841,
    user_id: 2,
    user_email: 'a@test.local',
    conversation_id: 12,
    tool_names: ['spend_summary'],
    tool_call_count: 1,
    review_verdict: null,
    ...over,
  }
}

export function seedAdminData() {
  const traces = [
    {
      row: row({ id: 41, created_at: t(23, 10, 2), finished_at: t(23, 10, 5), review_verdict: 'good' }),
      user_message: { id: 87, content: 'How much did I spend in October?', created_at: t(23, 10, 2) },
      assistant_message: { id: 88, content: 'You spent **₹1,25,078.73** in October 2026.', created_at: t(23, 10, 5) },
      timeline: [
        { type: 'model_call', seq: 1, model: 'gpt-4.1-mini', status: 'SUCCEEDED', finish_reason: 'tool_calls', requested_tools: 1, tokens_in: 1480, tokens_out: 40, latency_ms: 980 },
        { type: 'tool_call', seq: 2, round: 1, name: 'spend_summary', status: 'SUCCEEDED', validation_status: 'OK', args: { period: 'month_name:october' }, result: { total: { paise: 12507873, inr: '₹1,25,078.73' } }, error: null, latency_ms: 12 },
        { type: 'model_call', seq: 3, model: 'gpt-4.1-mini', status: 'SUCCEEDED', finish_reason: 'stop', requested_tools: 0, tokens_in: 1640, tokens_out: 170, latency_ms: 1810 },
      ],
      prev_trace_id: null,
      next_trace_id: 42,
      review: { verdict: 'good', note: 'Correct.', reviewer_id: 1, version: 1, updated_at: t(23, 20) },
    },
    {
      row: row({
        id: 42, created_at: t(23, 12, 0), finished_at: t(23, 12, 1), status: 'FAILED', error_stage: 'model',
        error_class: 'RateLimitError', provider_http_status: 429, rounds: 1, tokens_in: 0, tokens_out: 0,
        latency_ms: 640, tool_names: [], tool_call_count: 0,
      }),
      user_message: { id: 89, content: 'Top 5 merchants this year', created_at: t(23, 12, 0) },
      assistant_message: null,
      timeline: [
        { type: 'model_call', seq: 1, model: 'gpt-4.1-mini', status: 'FAILED', finish_reason: null, requested_tools: 0, tokens_in: 0, tokens_out: 0, latency_ms: 640 },
      ],
      prev_trace_id: 41,
      next_trace_id: 43,
      review: null,
    },
    {
      row: row({
        id: 43, created_at: t(23, 14, 0), finished_at: t(23, 14, 6), rounds: 3, tokens_in: 5200, tokens_out: 380,
        latency_ms: 6120, user_id: 3, user_email: 'b@test.local', conversation_id: 15,
        tool_names: ['top_merchants', 'list_transactions'], tool_call_count: 3, review_verdict: 'needs_fix',
      }),
      user_message: { id: 95, content: 'Show all transactions above ₹5,000 in the last 30 days', created_at: t(23, 14, 0) },
      assistant_message: { id: 96, content: 'Here are 4 transactions above ₹5,000 …', created_at: t(23, 14, 6) },
      timeline: [
        { type: 'model_call', seq: 1, model: 'gpt-4.1-mini', status: 'SUCCEEDED', finish_reason: 'tool_calls', requested_tools: 1, tokens_in: 1500, tokens_out: 60, latency_ms: 1100 },
        { type: 'tool_call', seq: 2, round: 1, name: 'list_transactions', status: 'REJECTED', validation_status: 'INVALID_ARGS', args: { min_amount: 'five thousand' }, result: null, error: 'min_amount_paise must be an integer', latency_ms: 2 },
        { type: 'model_call', seq: 3, model: 'gpt-4.1-mini', status: 'SUCCEEDED', finish_reason: 'tool_calls', requested_tools: 2, tokens_in: 1700, tokens_out: 80, latency_ms: 1300 },
        { type: 'tool_call', seq: 4, round: 2, name: 'list_transactions', status: 'SUCCEEDED', validation_status: 'OK', args: { min_amount_paise: 500000, period: 'last_30_days' }, result: { truncated: true, preview: '[{"id":1041,…' }, error: null, latency_ms: 18 },
        { type: 'tool_call', seq: 5, round: 2, name: 'top_merchants', status: 'SUCCEEDED', validation_status: 'OK', args: { period: 'this_year', n: 5 }, result: { merchants: ['Swiggy', 'IRCTC'] }, error: null, latency_ms: 9 },
        { type: 'model_call', seq: 6, model: 'gpt-4.1-mini', status: 'SUCCEEDED', finish_reason: 'stop', requested_tools: 0, tokens_in: 2000, tokens_out: 240, latency_ms: 2600 },
      ],
      prev_trace_id: null,
      next_trace_id: null,
      review: { verdict: 'needs_fix', note: "Used last_30_days for 'last month'.", reviewer_id: 1, version: 2, updated_at: t(23, 30) },
    },
  ]

  const evalRuns = [
    {
      run: {
        id: 3, label: 'after prompt tweak', model: 'gpt-4.1-mini', prompt_version: 'v1', status: 'FINISHED',
        started_at: t(23, 40), finished_at: t(23, 43, 10), cases_total: 2, cases_passed: 1, cases_failed: 1, cases_blocked: 0,
      },
      cases: [
        {
          case_id: 'golden-01-october', risk: 'normal', persona: 'a@test.local', verdict: 'pass',
          attempts: 1, passed_attempts: 1, pass_rate: 1,
          results: [
            {
              attempt: 1, verdict: 'pass', latency_ms: 2310, trace_id: 41, answer_text: 'You spent ₹1,25,078.73 in October 2026.',
              gates: {
                numbers_exact: { pass: true, detail: 'expected ₹1,25,078.73: found' },
                isolation: { pass: true }, no_tool_leak: { pass: true }, tool_validity: { pass: true }, trace_complete: { pass: true },
              },
            },
          ],
        },
        {
          case_id: 'golden-06-above-5000', risk: 'high', persona: 'b@test.local', verdict: 'fail',
          attempts: 3, passed_attempts: 2, pass_rate: 0.6667,
          results: [1, 2, 3].map((n) => ({
            attempt: n, verdict: n === 2 ? 'fail' : 'pass', latency_ms: 5000 + n * 100, trace_id: n === 2 ? 43 : null,
            answer_text: n === 2 ? 'Here are 3 transactions above ₹5,000 …' : 'Here are 4 transactions above ₹5,000 …',
            gates: {
              numbers_exact: n === 2 ? { pass: false, detail: 'expected 4 rows: found 3' } : { pass: true },
              isolation: { pass: true },
            },
          })),
        },
      ],
    },
    {
      run: {
        id: 2, label: 'no key', model: 'gpt-4.1-mini', prompt_version: 'v1', status: 'BLOCKED',
        started_at: t(22, 0), finished_at: t(22, 0, 3), cases_total: 22, cases_passed: 0, cases_failed: 0, cases_blocked: 22,
      },
      cases: [],
    },
  ]

  return { traces, evalRuns }
}
