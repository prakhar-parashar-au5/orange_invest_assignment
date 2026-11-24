# Requirements and decisions

## Requirements
*Written before implementation (2026-11-24).* The full text is in [docs/requirements.md](../requirements.md). In short:

- **What:** a chat assistant over your own bank statement. Upload a CSV, see the transactions, ask questions, get correct numbers.
- **Judged on:** functionality, mostly the backend. Smallest thing that works end to end and is correct.
- **Acceptance:** 10 "golden questions" (spend in October, food delivery last month, top 5 merchants, recurring payments, why last month was higher, transactions above ₹5,000, Swiggy + Zomato, average monthly spend, biggest expense, salary this year), each answer checked against SQL, plus user A never seeing user B's data.
- **In scope:** bank CSV, INR, a fixed category list with `Unidentified`, self-transfers and investments not counted as spend, dummy email login, OpenAI, a read-only DB user for the AI, no `.env` file.

## Decisions
Each card: what we chose, the options, why, and what it costs us.

### 1. Typed tools, not text-to-SQL
- **Options:** let the LLM write SQL (text-to-SQL), or give it a fixed set of typed tools (functions with checked parameters) that run our SQL.
- **Chose:** typed tools ([server/src/agent/tools.js](../../server/src/agent/tools.js)).
- **Why:** isolation (the model can't choose whose rows it reads: `user_id` comes from the session, never a parameter), correctness (dates and sums are computed by us, not the model), and testability (each tool is checked against hand-written SQL in [server/test/agent-tools.test.js](../../server/test/agent-tools.test.js)).
- **Cost:** a question no tool covers can't be answered. Mitigated by decision 2.

### 2. Seven presets plus one `aggregate`, over one query builder
- **Options:** one tool per question type; only a generic tool; or presets plus a generic fallback.
- **Chose:** 7 presets that map to common questions, plus `aggregate` (any metric, group and filter, all validated) for the rest. Every tool goes through one query builder ([server/src/agent/query.js](../../server/src/agent/query.js)), the only place that writes SQL and adds `user_id = ?`.
- **Why:** models pick a named tool more reliably than they assemble a query; the builder keeps isolation and the spend rule in one place. Tests prove presets and `aggregate` give identical numbers.
- **Cost:** two ways to ask some questions; the prompt tells the model to prefer presets.

### 3. Categorisation: rules → cache → one batched LLM call, per merchant
- **Options:** send every transaction to the LLM; rules only; or rules first with an LLM fallback.
- **Chose:** keyword rules first ([server/src/categorise/rules.js](../../server/src/categorise/rules.js)), then a shared cache, then one batched OpenAI call with structured output restricted to the category list, keyed on the **cleaned merchant name**, not the transaction ([server/src/categorise/index.js](../../server/src/categorise/index.js)).
- **Why:** each merchant is classified once; amounts and descriptions never leave the server; payments to people (P2P) never reach the LLM or the cache.
- **Cost:** quality depends on merchant extraction. The tester measured the LLM step at 39% because it received junk names; fixed in BE-012 (see the "Built with AI" page).

### 4. Money as integer paise, dates as IST calendar dates
- **Chose:** amounts stored as whole paise in `BIGINT` with a separate direction; parsed with string and integer maths only ([server/src/ingest/money.js](../../server/src/ingest/money.js)). Dates are the bank's calendar date in IST, never shifted through a JS `Date` ([server/src/ingest/dates.js](../../server/src/ingest/dates.js)).
- **Why:** `₹4.35` is exactly 435 paise, never 434.999; "October" means October in India, not UTC.
- **Cost:** every display path formats paise to ₹.

### 5. A read-only database user for the AI
- **Chose:** the agent's tools connect as `orange_agent_ro`, which has only SELECT ([server/scripts/db-up.sh](../../server/scripts/db-up.sh), and [server/scripts/db-create.js](../../server/scripts/db-create.js) in production).
- **Why:** even a buggy tool or a prompt injection can't change data; the database itself refuses. Tested in [server/test/db-readonly.test.js](../../server/test/db-readonly.test.js).
- **Cost:** a second pool and a second set of credentials.

### 6. Dummy email login
- **Chose:** log in with an email only; a new email creates the user; a JWT in an httpOnly cookie ([server/src/auth/routes.js](../../server/src/auth/routes.js)).
- **Why:** the spec said sign-up can be dummy; every query is still scoped by `user_id`.
- **Cost:** anyone can type any email. On the public deploy, admin accounts also need an `ADMIN_LOGIN_CODE`.

### 7. One Railway service, same origin
- **Options:** client and API as two Railway services, or one.
- **Chose:** Express serves the built React app and the API from one service ([server/src/http/static-client.js](../../server/src/http/static-client.js)), next to Railway MySQL.
- **Why:** two `*.up.railway.app` domains are different sites (the domain is on the Public Suffix List), which breaks the `SameSite=Lax` cookie. One origin also means no CORS and one deploy.
- **Cost:** client and server deploy together.

### 8. No `.env` file
- **Chose:** locally every setting defaults to the disposable Docker database; the OpenAI key is passed on the start command or set in Railway variables. Production refuses to start if a secret is missing ([server/src/config.js](../../server/src/config.js)).
- **Why:** no secrets file to leak, copy or commit; agents never handle secrets.
- **Cost:** a longer start command when using the key locally.

## Deliberately left out
| feature | why not in v1 |
|---|---|
| PDF statements | hard to parse reliably; CSV covers the flow |
| XLSX and Paytm exports | the spec narrowed v1 to bank CSV |
| Budgets and alerts | outside the "ask about your spending" flow |
| Correcting a category by hand | stretch goal; `recategorise` covers re-running the categoriser |
| Text-to-SQL | isolation and correctness risk; see decision 1 |
| Embeddings or a trained classifier | no real labels yet; rules + LLM fallback are enough to measure first |
| MCP and OAuth | not needed for one app with dummy auth |
| LLM-as-judge for answers | hard pass/fail gates against SQL are stricter; quality beyond them is a human review |
| Trace retention jobs | demo-sized data |
