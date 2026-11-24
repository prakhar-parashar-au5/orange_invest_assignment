# TE-003 — Response: categoriser accuracy with OpenAI

- **From:** orange-tester-ag · **Date:** 2026-11-24 23:30 IST · **Status:** done
- User `te003@test.local` (id 63), fresh. `merchant_categories` was empty before the run. Evidence: `work/orange-tester-ag/evidence/TE-003/` (`labelled-sample.csv`, `distribution.txt`, `upload-*.json`).

| sheet | upload | rows ins/dup/rej | Unidentified now | TE-001 no key | sample accuracy |
|---|---|---|---|---|---|
| indian-12-month | 25 | 2393/0/0 | 78 (3.3%) | 481 (20%) | 59/60 (98%) |
| astra | 26 | 10/0/0 | 6 (60%) | 6 (60%) | 4/10 (40%) |
| planted-anomalies | 27 | 13/0/2 | 2 (15%) | — | 10/13 (77%) |
| settlement (converted) | 28 | 100/0/0 | 66 (66%) | rejected | 6/20 (30%) |

**Overall 79/103 (77%).** By step: **rule 58/58 (100%)**, **p2p 7/7**, **llm 14/36 (39%)**, unidentified 0/2. OpenAI classified **91 merchants** (all `source='llm'`).
Method: the step comes from the builder's `ruleCategory` and `merchantKey`, imported read-only, plus the cache. I hand-labelled every row. Dominos counts as correct as either Dining or Food delivery.

**The LLM step isn't the weak part. The merchant name it receives is.** Of the 91 keys, 70 are payment-app × city variants of brands the rules already know, and 8 are junk tokens or person names (SQL-checked).

## 10 worst mistakes (all → orange-backend-builder-ag)
| # | description | merchant | given | correct | step | fix |
|---|---|---|---|---|---|---|
| 1 | `IMPS/P2A/957698/Priya Sharma` (69 rows in 12-month) | P2a | Unidentified | Transfers (others) | llm | narration: for `IMPS/P2A/<ref>/<name>` take the name and mark P2P. This is 69 of the 78 Unidentified rows |
| 2 | `UPI/DR/FRESHMART INDIRANAGAR VPA …` | Dr | Unidentified | Groceries | llm | skip `DR`/`CR` tokens when extracting the merchant (18 rows have merchant `Dr`/`Cr`) |
| 3 | `IMPS/DR/CITYCAB MOBILITY …` | Dr | Unidentified | Travel | llm | same as #2 |
| 4 | `UPI/DR/BLUEBOTTLE COFFEE VPA …` | Dr | Unidentified | Dining | llm | same as #2 |
| 5 | `NEFT/CR/KKBK…/RAZORPAY/JKJLD0` | Cr | Unidentified | Transfers (others) | llm | same as #2. `DR`/`CR`/`P2A` are now cached as Unidentified **forever**, so the cache also needs a stop-list |
| 6 | `NEFT RAZORPAY SOFTWARE PVT LTD UTIB… 46JMV4` (14 of 20 sampled) | Razorpay Software | Unidentified | Transfers (others) | llm | rule: credit + `RAZORPAY` → Transfers (others). The LLM gave "Transfer From Razorpay…" Transfers but "RAZORPAY SOFTWARE" Unidentified |
| 7 | `UPI-Rahul@ybl` / `UPI/rahul@paytm` | NULL | Unidentified | Transfers (others) | — | take the VPA handle before `@` as a P2P name |
| 8 | `UPI PAY Rahul`, `UPI-Rahul` | Pay Rahul / Rahul | Transfers (others) | (correct) | llm | **privacy:** P2P detection missed single first names, so they went to OpenAI and are cached |
| 9 | `ECS RETURN BOUNCE DISHONOURED` (debit) | — | Refunds | bank charge, not a refund | llm | rule: `ECS RETURN`/`BOUNCE` debit → Bills & utilities (or a charges category) |
| 10 | `GPAY*DOMINOSBLR` vs `POS DOMINOS` | — | Food delivery vs Dining | one of them | llm vs rule | merchant: strip the `GPAY/PHONEPE/PAYTM/BHIM` prefix and the `BLR` suffix. 70 of the 91 LLM keys are app × city variants such as `PHONEPE SWIGGYBLR`. Rules already know these brands, and the LLM calls are wasted on them |

Also: `NEFT-ICIC…-RAZORPAY SOFTWAR` was flagged as a person (P2P false positive, right category by luck), and so was `NEFT-VENDOR PAYMENT`.

## Privacy check (step 5)
Cache keys that are a person or a non-merchant: `RAHUL`, `PAY RAHUL` (P2P misses: a name reached OpenAI), plus `P2A`, `DR`, `CR`, `IFT`, `CLIENT` and `SETTLEMENT` (extraction junk). The names in `IMPS/P2A/<name>` rows didn't leak, because only `P2A` was sent.

## Not tested / notes
The planted sheet rejected 2 rows, the same as TE-001 (planted bad rows). No product code touched. The only writes were uploads through the API.
