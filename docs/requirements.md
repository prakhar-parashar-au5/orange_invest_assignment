# Requirements (v1)

*Written before implementation (2026-11-24), from the answered spec questionnaire and the "v1 decisions" it produced. Kept as written; what changed later is recorded in the decision cards in [docs/artifacts/01-requirements-and-decisions.md](artifacts/01-requirements-and-decisions.md).*

## What it is
A chat assistant over a person's own bank statement. You upload a bank-statement CSV, see its transactions, and ask questions in plain English ("how much did I spend on food last month?"). The answers must be correct, every number traceable to real rows.

## Context
- A take-home assignment, due now. It's judged on **functionality, mostly the backend**. Build the smallest thing that works end to end and is correct. No stretch goals.
- Testers: another AI agent session, and a Codex session with computer use for the UI.

## The flow that must work
Log in (dummy, email only) → upload a bank CSV → see its transactions → ask in chat → get correct numbers.

## Acceptance: the 10 golden questions
Answered correctly on the synthetic data, each number checked against SQL by the tester:
1. How much did I spend in October?
2. How much on food delivery last month?
3. Top 5 merchants this year
4. What are my recurring payments / subscriptions?
5. Why was last month higher than the month before?
6. Show all transactions above ₹5,000 in the last 30 days
7. How much did I pay Swiggy and Zomato combined?
8. What's my average monthly spend?
9. What was my biggest single expense?
10. How much salary came in this year?

Also checked, because it's cheap and it's backend: user A can never see user B's data.

## Scope
- **In:** bank-statement CSV only, INR only. A fixed category list, with `Unidentified` when neither rules nor the LLM can tell. Self-transfers and investments are their own categories and are **not spend**. Rules first, then an LLM fallback, cached per merchant.
- **Out:** agents with write access, other currencies, PDF/XLSX/Paytm, budgets, charts, stretch goals.
- **Answers:** the AI's tool calls are logged for tracing but never shown to the user.

## Constraints
- LLM: OpenAI. The key goes only in the server start command or Railway variables, nowhere else. **No `.env` file at all.**
- The agent's tools use a database user that can only SELECT.
- No migration tool: one idempotent `schema.sql`.
- Local MySQL 8 in Docker. UI: Tailwind + shadcn/ui, orange accent, desktop first and usable on mobile. Screens: login, uploads, chat.
- Local git only at first; Railway deploy at the end, run by the owner.
