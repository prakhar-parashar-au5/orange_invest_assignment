# BE-012 — Fix golden Q6 and the merchant-extraction misses found by TE-003

- **To:** orange-backend-builder-ag
- **From:** orchy
- **Date:** 2026-11-24
- **Priority:** P0. **Do it right after BE-009, before BE-010.** Q6 blocks acceptance, and BE-010's
  eval corpus should grade the fixed behaviour.
- **Depends on:** BE-009 response `done`
- **Status:** open

Speed mode applies.

## Context
- `Agents/orange-tester-ag/responses/TE-002-response.md`, BUG-TE002-1.
- `Agents/orange-tester-ag/responses/TE-003-response.md`, the "10 worst mistakes" and the privacy
  check. Its evidence is in `work/orange-tester-ag/evidence/TE-003/`.
- The headline from TE-003: rules were 100% correct and LLM answers only 39%. The LLM got bad merchant
  names (`DR`, `CR`, `P2A`, `PHONEPE SWIGGYBLR`), and 70 of its 91 calls were spent on brands the
  rules already know.

## Do
1. **Q6, prompt and tool description.** "Transactions" means every direction and category.
   `spend_only` is true **only** when the user asks about spend, spending, expenses or cost.
   Change the `list_transactions` description and the system prompt to say so. Bump
   `PROMPT_VERSION` to `v2`. Add one test: the tool description and prompt contain the rule.
   (Model behaviour itself gets checked by the tester and BE-010.)
2. **Merchant extraction** (`narration.js` / `merchant-names.js`):
   - Skip the direction and rail tokens `DR`, `CR`, `P2A`, `P2M`, `IFT` and `MB` when choosing the
     merchant.
   - `IMPS/P2A/<ref>/<name>` → the name, marked P2P. That one pattern accounts for 69 of the 78
     remaining `Unidentified` rows.
   - Strip the payment-app prefixes `GPAY*`, `PHONEPE`, `PAYTM`, `BHIM` and `POS <digits>`, and
     glued city suffixes (`BLR`, `DEL`, `MUM`, `HYD`, `CHN`, `PUN`, `KOL`). So `PHONEPE SWIGGYBLR`
     becomes Swiggy, and `GPAY*DOMINOSBLR` becomes Dominos.
   - UPI with no name: take the VPA handle before `@` as the payee (`rahul@paytm` → Rahul) and run
     the P2P check on it.
   - **Privacy:** a single alphabetic first name paid over UPI or IMPS with no business word counts
     as P2P. It never goes to the LLM.
3. **Rules:**
   - a credit containing `RAZORPAY` or `SETTLEMENT` → Transfers (others)
   - a debit containing `ECS RETURN`, `BOUNCE` or `DISHONOUR` → Bills & utilities, not Refunds
   - `DOMINOS` → Food delivery when the channel is UPI or the app, and Dining for POS. If that's
     fiddly, pick one and note it.
4. **Cache hygiene:**
   - Never cache an `Unidentified` LLM answer. The next upload asks again.
   - Add a stop-list so keys that are rail tokens or a bare 1–2 letter token are never cached or
     sent.
   - Run a one-off cleanup on `orange_invest_dev`: delete `merchant_categories` rows whose key is a
     stop-list token or was flagged as a person in TE-003 (`RAHUL`, `PAY RAHUL`, `P2A`, `DR`, `CR`,
     `IFT`, `CLIENT`, `SETTLEMENT`).
5. **Re-measure:** with the key in your shell if you have it, otherwise rules and cache only, run
   `npm run recategorise -- --email te003@test.local`. Note: rows whose *merchant* was stored wrong
   at ingest keep that merchant, so recategorise only fixes categories. Give before and after
   `Unidentified` counts per upload in the response. The tester does the accuracy re-run.

## Don't
- No commit. Don't touch other tester users' rows beyond the `te003` recategorise and the cache
  cleanup.

## Done when
- Tests (about 6):
  - the Q6 description rule
  - `IMPS/P2A/…/Priya Sharma` → P2P "Priya Sharma"
  - `UPI/DR/FRESHMART…` → Freshmart
  - `PHONEPE SWIGGYBLR` → Swiggy
  - `rahul@paytm` → P2P and never sent to the LLM
  - an `Unidentified` LLM answer isn't cached
- The full suite passes (pass/fail line). The re-measure numbers are in the response.

## Answer (orchy fills this in when answering a blocker)

