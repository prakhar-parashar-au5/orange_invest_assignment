# How it was built with AI agents

One human (Prakhar) and several AI agent sessions built this in a day. The agents couldn't talk to each other; Prakhar relayed every hand-off. This page describes the setup and shows one real loop, with the files it produced.

## Roles
| who | job |
|---|---|
| **orchy** (orchestrator) | Planned the work, wrote every task file, reviewed responses, kept the decisions log. Never wrote product code. |
| **Backend builder** | Express API, MySQL schema, ingestion, categoriser, AI agent and tools, traces, evals, deploy prep. Everything under [server/](../../server/). |
| **Frontend builder** | The React client: login, uploads, chat, admin dashboard. |
| **Tester** | Tested what the builders built: API cases, browser runs, accuracy checks against hand-written SQL. Never edited product code. |
| **Codex** (separate sessions) | Downloaded third-party synthetic sample statements, did research, and clicked through the UI with computer use. |

## Isolation
- **Git worktrees** (separate checkouts of one repo): the backend on branch `feat/backend`, the frontend on `feat/frontend`. They meet only when Prakhar merges them.
- **Separate local databases:** `orange_invest_dev` for running the app, `orange_invest_test` for the automated tests (wiped on every run).
- **Separate ports** per agent, so nobody stopped someone else's server.

## Workflow
1. orchy writes a **task file** (goal, steps, "done when").
2. Prakhar tells the agent "check your tasks".
3. The agent works it and writes a **response file** (what changed, evidence, risks), or a **blocker file** if it can't continue.
4. Prakhar tells orchy "check responses". orchy reviews, answers blockers, and routes the next step: a builder's "done" becomes a tester task, and a tester's bug becomes a builder task.

## Safety rules every agent followed
- No commits or pushes by agents; Prakhar commits.
- No `.env` file, ever. Agents never read, print or handle secrets; for the OpenAI key they only checked whether it was present.
- Synthetic data only: our own generator ([server/scripts/gen-statement.js](../../server/scripts/gen-statement.js)) and third-party synthetic samples. No real statements.
- Writes only to the two disposable local databases. Railway is touched only by Prakhar.
- Every database query is parameterised and scoped by `user_id`.

## A real loop: the categoriser was 39% accurate
The files below are copied unedited from the coordination folder (which isn't part of the repo) into [docs/ai-workflow/](../ai-workflow/).

1. **The tester measured it.** With OpenAI on, rules were 58/58 correct, but the LLM step only 14/36 (**39%**). The cause wasn't the LLM: it was being sent junk merchant names (`DR`, `CR`, `P2A`, `PHONEPE SWIGGYBLR`), and 70 of its 91 calls were spent on brands the rules already knew. Two first names had also reached OpenAI. See [2-TE-003-response-categoriser-accuracy.md](../ai-workflow/2-TE-003-response-categoriser-accuracy.md).
2. **orchy turned it into a task** with exact fixes and tests: [3-BE-012-task.md](../ai-workflow/3-BE-012-task.md).
3. **The backend builder fixed it:** better merchant extraction, a privacy-first P2P rule, new rules, and cache hygiene (no `Unidentified` answers or junk tokens cached). See [4-BE-012-response.md](../ai-workflow/4-BE-012-response.md) and [server/src/ingest/narration.js](../../server/src/ingest/narration.js).
4. **Re-measured.** Rows still `Unidentified` on the tester's four uploads, before and after, from `npm run recategorise -- --email te003@test.local` on 2026-11-24 (rules and cache only, no OpenAI calls):

| upload | before | after |
|---|---|---|
| indian-12-month (2,393 rows) | 78 | 9 |
| astra (10 rows) | 6 | 5 |
| planted-anomalies (13 rows) | 2 | 0 |
| settlement (100 rows) | 66 | 1 |
| **total** | **152** | **15** |

5. **The tester re-checked accuracy** (TE-004, 2026-11-25): a fresh user, the same four statements and the same 103-row hand-labelled random sample as before, with OpenAI on. See [5-TE-004-response.md](../ai-workflow/5-TE-004-response.md).

| | before (TE-003) | after (TE-004) |
|---|---|---|
| accuracy, whole sample | 79/103 (77%) | **98/103 (95%)** |
| by step: rules · person-to-person · LLM · unidentified | 58/58 · 7/7 · 14/36 · 0/2 | 80/80 · 10/13 · 8/9 · 0/1 |
| per statement: 12-month · astra · planted · settlement | 98% · 40% · 77% · 30% | 97% · 80% · 92% · 100% |
| rows still `Unidentified`: 12-month · astra · planted · settlement | 78 · 6 · 2 · 66 | 9 · 0 · 1 · 2 |
| merchants sent to OpenAI | 91 | 7 (all businesses; no person's name) |

**What the re-check found next (open):** the "when in doubt, it's a person" rule now over-reaches. `UPI-MOBILERECHARGE` and `UPI-INTERNET` payments (76 rows) and `Bluebottle` coffee were treated as people, so they got Transfers (others) instead of Bills & utilities or Dining. Spend totals are unaffected, because both categories count as spend, but per-category answers are off. That's the next loop.

### A shorter loop: golden question 6
The tester found that "Show all transactions above ₹5,000 in the last 30 days" left out the salary credit, a self-transfer and a SIP, because the model filtered to spend only ([1-TE-002-response-q6-bug.md](../ai-workflow/1-TE-002-response-q6-bug.md)). The fix: the tool description and the system prompt now say that "transactions" means every direction and category, and that `spend_only` is only for spend questions. The prompt version went to `v2` ([server/src/agent/recorder.js](../../server/src/agent/recorder.js)), and the eval oracle was updated to match ([server/eval/oracle.js](../../server/eval/oracle.js)). **Re-checked with the live model (TE-004):** Q6 now lists all 8 rows, including the salary credit, the self-transfer and the SIP, and so do three rephrasings. **But the fix over-corrected:** question 9, "What was my biggest single expense?", now fails 4 times out of 4. The model drops `spend_only`, gets the ₹1,25,000 salary credit as the biggest transaction, and says it can't find an expense. ("The largest amount I've ever spent in one go" still works.) Golden questions are at **9/10, so acceptance isn't met yet.** The fix and a 5-attempt re-test are the next loop. The eval also showed that one attempt per golden question can hide flaky behaviour like this: golden-09 passed its single attempt.
