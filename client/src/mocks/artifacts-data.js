// Mock artifacts for MSW, API-CONTRACT v1.7. Same shapes as the server's docs/artifacts/*.json,
// cut down. Content is placeholder text, not the real pages.

const FENCE = '```'

export const ARTIFACT_LIST = [
  { name: 'requirements', title: 'Requirements and decisions' },
  { name: 'architecture', title: 'Architecture' },
  { name: 'built-with-ai', title: 'How it was built with AI agents' },
  { name: 'quality', title: 'Quality: tests, performance, evals' },
]

const requirements = `# Requirements and decisions

(mock) The flow that must work: log in → upload a bank CSV → see its transactions → ask in chat.

| decision | why |
|---|---|
| Typed SQL tools, no text-to-SQL | correctness and data isolation |
| Money in integer paise | no float drift |

Spec: [SPEC](../../docs/spec.md). External: [Vite](https://vite.dev).
`

const architecture = `# Architecture

| layer | tech | where |
|---|---|---|
| Server | Express 5 | [server/src/app.js](../../server/src/app.js) |

${FENCE}mermaid
flowchart LR
  Client --> API --> MySQL
${FENCE}

Full detail: [schema.json](schema.json).
`

const builtWithAi = `# How it was built with AI agents

(mock) An orchestrator plus a backend builder, a frontend builder and a tester, coordinated through task files.
`

const quality = `# Quality: tests, performance, evals

## Tests that matter
| test | the failure it prevents |
|---|---|
| data isolation suite | one user seeing another user's rows |
`

const schema = {
  generated_at: '2026-11-25 00:03 IST',
  command: 'npm run artifacts:build',
  source: 'information_schema',
  tables: [
    {
      name: 'transactions',
      columns: [
        { name: 'id', type: 'bigint unsigned', nullable: false, key: 'PRI' },
        { name: 'user_id', type: 'bigint unsigned', nullable: false, key: 'MUL' },
        { name: 'upload_id', type: 'bigint unsigned', nullable: false, key: 'MUL' },
        { name: 'amount_paise', type: 'bigint unsigned', nullable: false, key: null },
        { name: 'merchant', type: 'varchar(128)', nullable: true, key: null },
      ],
      indexes: [{ name: 'idx_txn_user_date', unique: false, columns: ['user_id', 'txn_date'] }],
      foreign_keys: [
        { column: 'upload_id', references: 'uploads.id' },
        { column: 'user_id', references: 'users.id' },
      ],
    },
    {
      name: 'users',
      columns: [
        { name: 'id', type: 'bigint unsigned', nullable: false, key: 'PRI' },
        { name: 'email', type: 'varchar(254)', nullable: false, key: 'UNI' },
      ],
      indexes: [],
      foreign_keys: [],
    },
  ],
}

const requestFlow = {
  title: 'One chat message, from the Send button to the rendered answer',
  steps: [
    { label: 'User presses Send', repo: 'client', file: 'client/src/features/chat/ChatThread.jsx', symbol: 'async function send(' },
    { label: 'API client posts the text', repo: 'client', file: 'client/src/api/endpoints.js', symbol: 'export const sendMessage' },
    { label: 'Express route checks auth and ownership', repo: 'server', file: 'server/src/chat/routes.js', symbol: "router.post('/conversations/:id/messages'" },
  ],
  tables_read: ['conversations', 'messages', 'transactions'],
  tables_written: ['messages', 'ai_traces'],
}

const qualityData = {
  generated_at: '2026-11-25 00:03 IST',
  command: 'npm run artifacts:build',
  tests: {
    layers: [
      { layer: 'server unit', command: 'cd server && npx vitest run', files: 7, tests: 184, passed: 184, failed: 0, test_time_ms: 110 },
      { layer: 'client', command: 'cd client && npx vitest run', files: 7, tests: 57, passed: 57, failed: 0, test_time_ms: 1442 },
    ],
    wall_ms: { server: 2247, client: 2009 },
  },
  performance: {
    user_transactions: 616,
    traces: 33,
    results: [
      {
        query: 'list_transactions, last 30 days',
        runs: 50,
        p50_ms: 0.9,
        p95_ms: 1.2,
        explain: [{ table: 'transactions', type: 'range', key: 'idx_txn_user_date', rows: 49 }],
      },
      {
        query: 'trace summary (7d)',
        runs: 50,
        p50_ms: 3.27,
        p95_ms: 3.98,
        explain: [
          { table: 't', type: 'index', key: 'idx_trace_status_created', rows: 33 },
          { table: 'c', type: 'ALL', key: null, rows: 30 },
        ],
      },
    ],
  },
  evals: [
    {
      id: 1, prompt_version: 'v1', model: 'gpt-4.1-mini', status: 'BLOCKED', label: 'blocked-path check (no key)',
      started_at: '2026-11-24 23:22 IST', cases_total: 21, cases_passed: 0, cases_failed: 0, cases_blocked: 1,
    },
  ],
  request_flow: { steps: 13, found: 13 },
}

export const ARTIFACTS = {
  requirements: { markdown: requirements, data: null },
  architecture: { markdown: architecture, data: { schema, request_flow: requestFlow } },
  'built-with-ai': { markdown: builtWithAi, data: null },
  quality: { markdown: quality, data: { quality: qualityData } },
}
