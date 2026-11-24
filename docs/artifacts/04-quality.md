# Quality: tests, performance, evals

Every number on this page is measured, with its date and the command that produced it. The generated sections are rewritten by `npm run artifacts:build` ([server/scripts/artifacts-build.js](../../server/scripts/artifacts-build.js)); the raw data is in [quality.json](quality.json).

## Automated tests (generated)
- **Server unit:** test files that don't touch a database.
- **Server integration:** test files that run against the real MySQL test database (`orange_invest_test`).
- **Client:** the React app's tests, run from the frontend checkout.

<!-- generated:tests -->
_Measured 2026-11-25 01:00 IST by `npm run artifacts:build`. Wall time (whole run, including startup and database reset): server 2.6 s, client 2.6 s._

| layer | files | tests | passed | failed | time in tests |
|---|---|---|---|---|---|
| server unit | 7 | 184 | 184 | 0 | 0.13 s |
| server integration (MySQL) | 17 | 261 | 261 | 0 | 5.05 s |
| client | 9 | 72 | 71 | 1 | 2.38 s |
<!-- /generated:tests -->

## Tests that matter
| test | the failure it prevents |
|---|---|
| [The agent's read-only session pool can't INSERT, UPDATE, DELETE or CREATE, even on a fresh connection](../../server/test/db-readonly.test.js) | a buggy tool or a prompt injection changing data |
| [User B can't see user A's upload or transactions](../../server/test/uploads.test.js), and [B's tools return only B's rows](../../server/test/agent-tools.test.js) | one user's finances leaking to another |
| [Money parsing: `4.35` is 435 paise, Indian grouping, Dr/Cr](../../server/test/ingest-parsing.test.js) | floating-point rounding errors in totals |
| [Every golden question's tool result equals hand-written SQL](../../server/test/agent-tools.test.js) | the agent quoting a wrong number with confidence |
| [Recording fails closed](../../server/test/ai-traces.test.js) | an AI answer with no trace to audit it |

## Performance (generated)
Main queries on the seeded dev data (user `a@test.local`, 616 transactions), each run 50 times through the real tool code on the read-only pool. `EXPLAIN` shows the index MySQL chose and how many rows it expects to read.

<!-- generated:perf -->
_Measured 2026-11-25 01:00 IST by `npm run artifacts:build` on orange_invest_dev: 616 transactions for a@test.local, 83 traces in total. Local Docker MySQL on a laptop, so treat these as relative, not production, numbers._

| query | p50 ms | p95 ms | EXPLAIN: index used per table (access type, estimated rows) |
|---|---|---|---|
| spend_summary by category, this year | 1.71 | 2.42 | transactions: idx_txn_user_date (range, ~488 rows) |
| list_transactions, last 30 days | 0.96 | 1.74 | transactions: idx_txn_user_date (range, ~49 rows) |
| top_merchants, this year | 0.81 | 1.11 | transactions: idx_txn_user_date (range, ~488 rows) |
| uploads list (GET /api/uploads) | 1 | 2.38 | uploads: idx_uploads_user_created (ref, ~1 rows) |
| trace summary (GET /api/admin/ai/summary?window=7d) | 3.54 | 5.17 | t: idx_trace_status_created (index, ~83 rows); c: **none** (ALL, ~73 rows); r: **none** (ALL, ~1 rows) |
<!-- /generated:perf -->

## AI evaluation (generated)
The eval runner asks the live agent a fixed corpus ([server/eval/corpus.json](../../server/eval/corpus.json)) and grades each answer with hard pass/fail gates against independent SQL ([server/eval/oracle.js](../../server/eval/oracle.js)). The latest run per prompt version:

<!-- generated:evals -->
_Read 2026-11-25 01:00 IST from orange_invest_dev by `npm run artifacts:build`._

| prompt | run | status | model | passed | failed | blocked | of | started |
|---|---|---|---|---|---|---|---|---|
| v1 | 1 | BLOCKED | gpt-4.1-mini | 0 | 0 | 1 | 21 | 2026-11-24 23:22 IST |
| v2 | 2 | FINISHED | gpt-4.1-mini | 20 | 1 | 0 | 21 | 2026-11-25 00:43 IST |
<!-- /generated:evals -->
