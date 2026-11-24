# BE-012 — response

- **From:** orange-backend-builder-ag
- **Date:** 2026-11-24
- **Result:** done
- **Needs Prakhar:** no. The tester re-measures accuracy (TE-004), ideally with the key so the remaining 15 rows go through the LLM.

## What I did
1. **Q6 and prompt v2:**
   - `list_transactions` now says that "Transactions" means every direction and category, with self-transfers and investments included. It says to set `spend_only=true` only when the user asks about spend, spending, expenses or cost. The `spend_only` parameter has its own description saying the same.
   - The system prompt has the same rule, plus the example: "show all transactions above ₹5,000" is not a spend question.
   - `PROMPT_VERSION` is now **`v2`**, so new traces and eval runs are tagged v2.
   - I also fixed BE-010's oracle to match: Q6 is now `transactions_above_5000_last_30_days`, counting every direction.
2. **Merchant extraction** (`server/src/ingest/narration.js`):
   - The tokens `DR`, `CR`, `P2A`, `P2M`, `IFT`, `MB` and the filler `VPA`, `UTR`, `RRN`, `AUTH` are skipped when choosing the merchant.
   - `IMPS/P2A/<ref>/<name>` gives the name, marked P2P.
   - The `GPAY*`, `PHONEPE`, `PAYTM` and `BHIM` prefixes mean UPI and are stripped. After an app prefix, glued city suffixes are stripped too (`SWIGGYBLR` → Swiggy, `DOMINOSBLR` → Dominos). `POS <digits>` was already handled.
   - When a VPA handle spells the first words of the name, the name is trimmed to it (`FRESHMART INDIRANAGAR` + `freshmart@…` → Freshmart).
   - UPI with no name takes the VPA handle as the payee (`rahul@paytm` → Rahul).
   - **Privacy:** P2P now errs towards "person". On UPI, IMPS, NEFT or RTGS, 1–4 plain words with no business word, no business stem (MART, CAFE, COFFEE, CAB…) and no brand the rules know count as a person, **including a single first name**. So `UPI PAY Rahul` → Rahul (P2P), while `NEFT-VENDOR PAYMENT` and `RAZORPAY SOFTWAR` are no longer people.
3. **Rules** (`server/src/categorise/rules.js`):
   - a credit with `RAZORPAY` or `SETTLEMENT` → Transfers (others), checked after Refunds, so "Razorpay refund" stays a refund
   - a debit with `ECS RETURN`, `BOUNCE` or `DISHONOUR` → Bills & utilities
   - **`DOMINOS` → Food delivery on UPI, Dining on POS**
4. **Cache hygiene** (`server/src/categorise/index.js`):
   - an `Unidentified` LLM answer is never cached, and old cached `Unidentified` rows are ignored on lookup
   - a stop-list (`DR`, `CR`, `P2A`, `P2M`, `IFT`, `MB`, `UPI`, `IMPS`, `NEFT`, `RTGS`, `PAY`, `CLIENT`, `SETTLEMENT`, `VPA`, `UTR`, `TRANSFER`) plus any bare 1–2 letter key means the key is never sent and never cached
   - **The cleanup on `orange_invest_dev`:** I deleted 8 `merchant_categories` rows: `RAHUL`, `PAY RAHUL`, `P2A`, `DR`, `CR`, `IFT`, `CLIENT` and `SETTLEMENT`. 91 rows became 83.
5. **Recategorise** now re-reads each narration with the current parser before categorising. Rows stored with a junk merchant (`Dr`) get the corrected name for categorisation, but the stored merchant isn't rewritten.

## Re-measure: `npm run recategorise -- --email te003@test.local` (no key in my shell, so rules and cache only)
| upload | sheet | Unidentified before | after |
|---|---|---|---|
| 25 | indian-12-month (2,393 rows) | 78 | **9** |
| 26 | astra (10) | 6 | **5** |
| 27 | planted-anomalies (13) | 2 | **0** |
| 28 | settlement (100) | 66 | **1** |
| | **total** | **152** | **15** (137 changed, 0 OpenAI calls) |

The 15 left are 9 `INTERNET*ORDER…` / `MOBILERECHARGE*ORDER…` rows with no merchant at all, plus businesses only the LLM can place (Freshmart, Citycab Mobility, The Reading Room…). Those now reach the LLM with clean names instead of `Dr`. Accuracy (right vs wrong, not just identified) is for the tester to measure in TE-004.

## Evidence
- `npm test` in `server/`: **Test Files 23 passed (23), Tests 426 passed (426).**
- New tests (`server/test/be012.test.js`):
  - **the Q6 rule** is in the tool description, the `spend_only` description and the prompt; `PROMPT_VERSION` is `v2`
  - extraction: **`IMPS/P2A/957698/Priya Sharma` → P2P "Priya Sharma"**, **`UPI/DR/FRESHMART…` → Freshmart**, **`PHONEPE SWIGGYBLR` → Swiggy**, `GPAY*DOMINOSBLR` → Dominos, `IMPS/DR/CITYCAB…`, `NEFT/CR/…/RAZORPAY`, `PHONEPE*DMART`, `POS 9104 BLINKIT`, `UPI PAY Rahul`, and the two former false positives, along with unchanged cases
  - the new rules: Razorpay or settlement credit, Razorpay refund, ECS bounce, Dominos on UPI vs POS
  - **`rahul@paytm` → P2P, never sent to the LLM, never cached**
  - **an `Unidentified` LLM answer isn't cached** (the classifier is asked twice)
  - 8 stop-listed keys are never sent

## Risk / blast radius
- The privacy-first P2P rule turns an unknown **single-word shop** on UPI ("Kalyani") into Transfers (others) instead of asking the LLM. That's the price of never sending a first name. The rules' brand list keeps known brands out of it.
- Dominos is split by channel. If a reviewer counts both as one category, it's a one-line change in `rules.js`.
- Rows ingested before this change keep their stored merchant names (for example `P2a`, `Dr` in te003's uploads), so `top_merchants` on those uploads still shows them. Re-ingesting fixes that; recategorise only fixes categories.

## Files changed (uncommitted, worktree `feat/backend`)
- `server/src/ingest/narration.js` (rewritten), `server/src/categorise/rules.js`, `server/src/categorise/index.js`, `server/src/categorise/recategorise.js`
- `server/src/agent/tools.js`, `server/src/agent/agent.js`, `server/src/agent/recorder.js` (`PROMPT_VERSION` v2)
- `server/eval/oracle.js`, `server/eval/corpus.json` (Q6 counts all directions)
- new: `server/test/be012.test.js`; `server/test/ai-traces.test.js` (uses `PROMPT_VERSION`)

Suggested commit message: `fix(server): Q6 transactions rule (prompt v2), merchant extraction and P2P privacy fixes, cache hygiene`
