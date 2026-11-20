# Post-production security review — deferred register

Status: **DEFERRED** under owner decision OD-06/OD-07 (2026-11-20). This is a follow-up workstream to run after V2 production
readiness. **It does not block implementation.** Every V2 change that relies on the temporary V1-equivalent access model adds
a row here.

## 1. Accepted temporary exposure (known at 2026-11-20)

| ID | Exposure | Where | Evidence | Origin | Accepted under |
|---|---|---|---|---|---|
| S-01 | `GET /txs-backup` returns the latest full transaction ledger without authentication | V1 `sentiment-ff75` | V1 `worker.js@fb30da1:2655–2664` (verified from code; the route was **not** called) | V1, pre-existing | OD-06 (V1 untouched, OD-01) |
| S-02 | `POST /txs-backup`, `POST /portfolio-log` accept writes without authentication | V1 | V1 `worker.js:2596–2652` | V1, pre-existing | OD-06 |
| S-03 | `GET /portfolio-history?hours≤168` returns portfolio value snapshots without authentication | V1 | V1 `worker.js:2721–2735` | V1, pre-existing | OD-06 |
| S-04 | `Access-Control-Allow-Origin: *` on V1 routes | V1 | V1 `worker.js:2116–2118` | V1, pre-existing | OD-06 |
| S-05 | Real personal transactions (`SEED_TXS`, Revolut/Neverless) embedded in the public V1 frontend repository and page | V1 CryptoPulse `index.html@9a5810c:137–143` | public repo | V1, pre-existing | OD-06. V2 must never copy them |
| S-06 | `X-App-Secret` value embedded in the public V1 page; the V1 Worker does not enforce it | V1 `index.html:3125`, `worker.js:1392` | code | V1, pre-existing | OD-06. V2 does not reuse it |
| S-07 | `GET /foufi-check?force=1` can trigger a Gemini call without authentication (quota exhaustion vector) | V1 | V1 `worker.js:3503–3510` | V1, pre-existing | OD-06. V2 never calls it |
| S-08 | V1 `POST /gemini-outlook`, `/trader-analysis-gemini` can be called by anyone (Gemini quota) | V1 | V1 `worker.js:3203–3376` | V1, pre-existing | OD-06. V2 parity calls them only on an explicit user action |
| S-09 | V2 Portfolio stores the ledger in the browser (`localStorage`), the same model as V1; no server-side authorisation | V2 frontend (**implemented** 2026-11-20, key `cpv2_portfolio_v1`) | Phase 1 contracts §8 | V2, new, **V1-equivalent** | OD-06 |
| S-10 | V2 "Import from V1" reads V1 `GET /txs-backup` on an explicit user click | V2 frontend (**implemented**: one GET after a confirmation dialog) | Phase 1 contracts §8.5 | V2, new, uses S-01 | OD-06 |
| S-13 | V2 Narrative button POSTs holding weights (symbols and percentages only) to V1 `/gemini-outlook` | V2 frontend (implemented, click only) | contracts §6 | V2, new, uses S-08 | OD-04, OD-06 |
| S-14 | Portfolio prices from Hyperliquid `allMids` and EUR/USD from Frankfurter are fetched from the browser (public, keyless; same providers as V1) | V2 frontend | — | V2, new | OD-06, OD-09 |
| S-15 | V2 Alerts reads V1 `GET /alert-configs` and `GET /alert-log` (unauthenticated V1 routes; alert parameters and messages are shown) | V2 frontend (implemented, while Alerts is open) | contracts §9 | V2, new, uses an open V1 route | OD-06 |
| S-16 | V2 Trader Analysis POSTs a market snapshot (price, technicals, V2 sentiment, public headlines; no personal data) to V1 `/trader-analysis-gemini` | V2 frontend (implemented, click only) | contracts §6 | V2, new, uses S-08 | OD-04, OD-06 |
| S-11 | V2 public read routes (predictions, sentiment, GLM, research) are unauthenticated; operational routes use an admin token | PulseWorkerV2 | `worker.js@b640e3c` | V2, pre-existing | OD-06 |
| S-12 | The Cloudflare connector in Claude sessions can write to production D1 | session tooling | Phase 0 F5 | tooling | Operating rule: SELECT-only unless authorised |

## 2. Review scope (to run after production readiness)

1. Private-access boundary for Portfolio and V1 personal data. Options to evaluate: Cloudflare Access (Zero Trust free tier),
   signed per-device token, browser-only storage with encrypted export. Must be $0 (OD-09).
2. V1 route hardening (S-01…S-08). **Requires an explicit owner exception to OD-01**, as a separate V1 change.
3. Removal of personal data from public repository history (S-05), and whether the V1 repo should become private.
4. CORS narrowing for V1 and V2 to the Pages origin.
5. Gemini quota abuse protections on V1 POST routes (S-07, S-08).
6. Secrets inventory: repository secrets, Worker secrets, the environment-injected credential that fails authentication (Phase 0 F6).
7. Logging review: no portfolio, evidence text or prompts in logs.
8. Dependency and CDN review (Tailwind/Chart.js from CDNs; versions are pinned).

## 3. Rules that still apply now (not deferred)

- No new secrets, keys, tokens or passwords in any repository; no real personal transactions in V2 source, tests or fixtures.
- No invented credentials; no use of a credential outside its authorised purpose.
- No change to V1. No unrelated security changes.
