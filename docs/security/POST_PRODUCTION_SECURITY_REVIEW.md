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
| S-17 | Portfolio fetches ECB euro reference rates from the browser (`data-api.ecb.europa.eu`, public, keyless, CORS open) when the user clicks; the request reveals only the date range and currencies used, not amounts | V2 frontend (implemented, click only) | contracts §8.4 | V2, new | OD-06, OD-09 |
| S-18 | Sandbox network allowlist extended 2026-11-20 (owner-approved prompt) with `api.frankfurter.dev` and `data-api.ecb.europa.eu` to verify FX sources | session environment | — | tooling | Owner-approved |

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

## 2b. Findings and recommendations (documented 2026-11-20; nothing implemented, nothing required now)

Ordered by impact. Each is a recommendation for the post-production review, not a blocker (OD-06/OD-07). Costs are $0 unless stated.

| # | Finding | Evidence | Recommendation | Touches V1? |
|---|---|---|---|---|
| R1 | The full personal transaction ledger is readable by anyone who knows the V1 URL (S-01), and real transactions are in the public V1 repository (S-05) | V1 code; public repo | Highest priority. (a) Make the V1 repository private or purge `SEED_TXS` from history; (b) gate `/txs-backup` and `/portfolio-*` with a secret header checked server-side, or remove the server copy and rely on V2's browser ledger and exports | Yes: needs an OD-01 exception |
| R2 | V1 Gemini routes can be called by anyone, spending the free quota (S-07, S-08, S-13, S-16) | V1 code | Enforce the already-sent `X-App-Secret`, or a per-day call cap in D1 like V2's `gemini_quota_ledger`; V2's own buttons already call only on a click | Yes |
| R3 | No private-access boundary for V2 Portfolio (S-09) | design | Cloudflare Access (Zero Trust free tier, ≤ 50 users) in front of a private route if a server copy is ever wanted; otherwise keep the browser-only ledger and add optional passphrase-encrypted JSON export (WebCrypto, no server) | No |
| R4 | Wildcard CORS on V1 and V2 (S-04, S-11) | headers | Restrict to `https://quiquandon-oss.github.io` for write and personal-data routes; keep public read routes open | V1: yes; V2: no |
| R5 | Third-party calls from the browser (Hyperliquid, Frankfurter, ECB; S-14, S-17) | code | Acceptable (public data, no personal amounts); add Subresource Integrity to the Chart.js/Tailwind CDN tags and a Content-Security-Policy `connect-src` allow-list | No |
| R6 | The environment-injected Cloudflare credential fails authentication (Phase 0 F6) | REST 10000/9109 | Remove or rotate it in the environment settings | No |
| R7 | The session's Cloudflare connector can write to production D1 (S-12) | tooling | Prefer a read-only D1 token for audit sessions | No |
| R8 | Local data in the browser can be lost (clearing site data) | design | Keep the export reminder; consider a periodic export prompt | No |

## 3. Rules that still apply now (not deferred)

- No new secrets, keys, tokens or passwords in any repository; no real personal transactions in V2 source, tests or fixtures.
- No invented credentials; no use of a credential outside its authorised purpose.
- No change to V1. No unrelated security changes.
