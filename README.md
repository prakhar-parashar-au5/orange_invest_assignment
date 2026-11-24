# orange-invest

A chat assistant over your own bank statements. You upload a bank-statement CSV, and the app turns it
into clean, categorised transactions. An AI agent then answers questions like "how much did I spend
on food in October?" by calling read-only tools that run real SQL on your data.

Test data is synthetic only. Never add a real statement to this repo.

## Layout

- `server/`: Node + Express API, MySQL 8.
- `client/`: React (Vite) app.

Each app has its own `package.json`.

## Server

Requires Node 22+ and Docker Desktop (for the local MySQL).

```sh
cd server
npm install
npm run db:up       # start local MySQL 8 in Docker (idempotent)
npm run db:init     # apply db/schema.sql to orange_invest_dev (idempotent)
npm test            # resets and uses orange_invest_test only
npm run dev         # http://localhost:4101
```

To use the agent, pass the key on the command line. There is no `.env` file:

```sh
OPENAI_API_KEY=... npm run dev                                          # builder port 4101
OPENAI_API_KEY=... PORT=4100 CLIENT_ORIGIN=http://localhost:5180 npm run dev   # tester ports
```

Without a key, everything works except chat, which returns 502 `AGENT_UNAVAILABLE`, and the LLM
fallback for unknown merchants, which leaves them `Unidentified`. Set `LOG_LEVEL=debug` to log the
agent's tool names and timings; the full tool calls are stored in `messages.tool_calls_json`.

Health check: `curl http://localhost:4101/api/health` → `{"status":"ok"}`

### Database

| script | what it does |
|---|---|
| `npm run db:up` | Starts container `orange-mysql` (`mysql:8.0`) on `127.0.0.1:3306` with volume `orange-mysql-data`. Creates `orange_invest_dev`, `orange_invest_test` and the app user `orange_app`. Safe to re-run. |
| `npm run db:down` | Stops the container. Data stays in the volume. |
| `npm run db:init` | Applies `db/schema.sql` to `DATABASE_URL` (default `orange_invest_dev`). Every statement is `IF NOT EXISTS`. |
| `npm run db:reset:test` | Drops and recreates `orange_invest_test`, then applies the schema. `npm test` does this itself before and after the run. |

To wipe everything: `docker rm -f orange-mysql && docker volume rm orange-mysql-data`.

### Synthetic data

All test data is generated; none of it is real.

| script | what it does |
|---|---|
| `npm run gen:statement -- --seed 1 --months 14 --out statement.csv [--end YYYY-MM-DD]` | Writes a synthetic bank-statement CSV in the HDFC-like layout. The output is the same for the same seed and end date; the end date defaults to today in IST. It prints a sha256 of the file. |
| `npm run seed:dev` | Creates `a@test.local` (seed 1) and `b@test.local` (seed 2) in `orange_invest_dev`, each with a 14-month statement ending today. Safe to re-run: an identical file is skipped. Unknown merchants go to OpenAI only if `OPENAI_API_KEY` is set. |
| `OPENAI_API_KEY=… npm run recategorise -- --email <e>` (or `--user-id <id>`, `--all`) | Re-runs categorisation on rows stored as `Unidentified`, e.g. ones uploaded without a key, and updates only rows whose category changed. It prints before and after counts and the number of OpenAI calls. It only runs on `orange_invest_dev` unless you pass `--allow-db <name>`. |

The generated data is built for the golden questions: monthly salary, rent, EMI, SIP, Netflix and
Spotify; food delivery, groceries, fuel and IRCTC; a travel spike last month; one clear largest
expense; and several spends above ₹5,000 in the last 30 days.

Bank CSV column names live in one file, `src/ingest/formats.js`. To support a new bank layout,
add its header aliases there.

The DB passwords in `scripts/db-up.sh` and `src/config.js` are fixed and dev-only. The port is bound
to localhost.

### Environment variables

All of them are optional locally. The names are listed in `server/.env.example`.

| name | default (local) | required in production |
|---|---|---|
| `NODE_ENV` | `development` | set to `production` |
| `PORT` | `4101` | |
| `CLIENT_ORIGIN` | `http://localhost:5181` | set it to the deployed client URL (for CORS) |
| `DATABASE_URL` | local `orange_app` → `orange_invest_dev` (`_test` under `NODE_ENV=test`) | yes |
| `JWT_SECRET` | a fixed dev string | yes |
| `OPENAI_API_KEY` | none | yes |
| `OPENAI_MODEL` | `gpt-4.1-mini` | |
| `LOG_LEVEL` | `info` (`debug` adds agent traces) | |

The API contract for the client is kept outside the repo, in the coordination folder.

## Agent design

The chat agent answers by calling **typed tools**. It never writes SQL.

```
question → LLM (with tool definitions) → tool call {name, args} → server validates args, resolves the period
         → query builder adds user_id = ? and runs parameterised SQL on a read-only session pool
         → small JSON result (money as paise + ₹ string) → LLM writes the answer → stored with its tool trace
```

**Why typed tools instead of text-to-SQL**
- **Isolation.** The model can't choose whose data it reads. `user_id` comes from the session cookie and is bound inside the query builder (`server/src/agent/query.js`). It isn't a tool parameter, so a prompt injection or a confused model still can't reach another user's rows. The tools also run on a separate pool whose every MySQL session is `READ ONLY` (`server/src/db.js`), so even a bug can't write.
- **Correctness.** Periods ("last month", "October") are resolved on the server in IST. Sums, deltas and averages are computed in SQL. "Spend" has one definition (`spendFilterSql`). The model copies numbers from tool results instead of doing arithmetic or inventing date ranges.
- **Testability.** Each tool is a pure function of (user, arguments, now). The tests compare every golden question's tool result with a hand-written SQL query on a seeded dataset, and run the agent loop against a mocked OpenAI client.

**Why presets plus one generic tool**
- Seven presets (`spend_summary`, `list_transactions`, `top_merchants`, `compare_periods`, `recurring_payments`, `income_summary`, `monthly_average`) map directly onto common questions. A model picks the right one more reliably than it assembles a query from parts.
- `aggregate` exposes the same builder with every option (metric, period, filters, group_by, order, limit), all validated enums. It covers question types the presets miss. Combinations that can't mean anything, such as adding credits and debits together, are rejected with a message the model can act on.
- Every tool is a thin preset over **one query builder**, the only place that writes SQL, so isolation and the spend rule are enforced in one place. Tests check that presets and the equivalent `aggregate` calls return identical numbers.

**Observability (admin)**
- Every chat turn writes an `ai_traces` row, plus one row per model call (`ai_model_calls`) and per tool call (`ai_tool_calls`). Each call is written before it runs and updated with its outcome, so a crash leaves an `IN_PROGRESS` row instead of nothing.
- Recording **fails closed**: if it can't be written, the user gets 502 and no unrecorded answer.
- Stored arguments and results are scrubbed of secret-looking keys. Provider errors are kept as the error class plus HTTP status, never the message.
- Admins (`users.role`, set with `npm run make-admin -- --email <e>`) see a summary (status, latency percentiles, tokens, estimated cost, per-tool failures, review verdicts), a trace list, a per-turn timeline, and can review a turn as good, bad or needs_fix.
- `npm run fixtures:traces -- --write` writes one trace of each shape for the dashboard.
- Left out on purpose (future work): MCP tables, OAuth and scope snapshots, raw and formatted payload views, retention jobs, and query plans at scale (EXPLAIN on 10k+ traces).

**Evals**
- `npm run eval -- --base-url <url> [--repeat-high 3] [--label <text>]` asks the running server a fixed corpus (`server/eval/corpus.json`, 21 cases) as the seeded personas. The cases are: the 10 golden questions, rephrasings, a multi-turn follow-up, a no-data period, isolation and prompt-injection attempts, and refusals.
- Each answer is graded with **hard pass/fail gates**, never averaged: exact ₹ amounts, no other persona's values, no tool names or JSON in the text, every tool call valid (or corrected after a rejection), a complete trace, and a correct refusal where one is expected. High-risk cases run 3 times, and a case passes only if every attempt passes.
- The expected numbers come from `server/eval/oracle.js`: hand-written SQL with literal dates that shares no code with the agent's tools. Grading the agent against its own tool output would prove nothing.
- Runs and per-attempt results (answer, gates, trace id) are stored and shown at `GET /api/admin/evals`. If the server has no key, the run stops as `BLOCKED`. There's no LLM-as-judge: answer quality beyond the gates is reviewed by hand on the trace.

**Future work**
- **Text-to-SQL fallback** for questions no tool can express. It would run behind a per-user read-only view (or row-level filtering) on a read-only session, with a statement allow-list, a row and time limit, and the generated SQL logged for review.
- **Better categorisation**, in steps:
  1. user corrections
  2. per-user rules learnt from those corrections
  3. embedding nearest-neighbour over already-labelled merchants
  4. a trained classifier once there are enough real labels

## Artifacts

Four pages for reviewers, also served in the app's Artifacts tab (`GET /api/artifacts`): [requirements and decisions](docs/artifacts/01-requirements-and-decisions.md), [architecture](docs/artifacts/02-architecture.md), [built with AI](docs/artifacts/03-built-with-ai.md) and [quality](docs/artifacts/04-quality.md). The schema diagram, request-flow check, test counts, query timings and eval results are generated from the code and databases: run `npm run artifacts:build` in `server/` (add `-- --client-dir <path to client>` to include the client tests).

## Deploy

Production is one Railway service plus Railway MySQL. Express serves the API and the built client
from one origin. From the repo root: `npm run build`, then `npm start`. Pre-deploy runs
`npm run db:create --prefix server && npm run db:init --prefix server`. Follow
[`docs/deploy/railway-runbook.md`](docs/deploy/railway-runbook.md) step by step: dashboard settings,
variables, demo data, smoke checklist, rollback and known traps.

## Client

_To be written by the frontend._
