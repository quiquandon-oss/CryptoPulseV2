# Implementation roadmap — CryptoPulse V2 (from 2026-11-20)

Contracts: `docs/architecture/PHASE_1_ARCHITECTURE_CONTRACTS.md`. Decisions: `docs/governance/OWNER_DECISIONS.md`.
Status key: **READY** (can start now), **BLOCKED** (named dependency), **DONE** (merged, deployed and verified live only).
FE = CryptoPulseV2 (`index.html`, `tests/`), BE = PulseWorkerV2.

| # | Workstream | Current state | Target state | Owner | Dependencies | Likely files / routes | Tests | Acceptance | Risks | Deploy | Rollback | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Docs and contracts | Phase 0 report | Closure, decisions, contracts, roadmap, security register | FE repo docs | — | `docs/**` | — | Documents committed | — | none | revert | **DONE** (#35, `14f72ab`) |
| 2a | Nine-area navigation | 6 views incl. "Forecasting Lab" | 9 areas, SV2 tabs, legacy redirects, mobile "More" | FE | 1 | `index.html` `NAV`, `renderNav`, view containers, mobile bar | unit (route resolver), Playwright | All 9 areas; no Lab entry; old hashes work | Breaking deep links | PR → Test → merge → Pages | revert merge | **DONE**: #35 merged `14f72ab`, Pages run 44722137466, live page byte-identical, live smoke 51/51 |
| 2b | Chart standard | `1D/1W/1M/ALL` (default 1M), Lab `1W/1M/3M/ALL` (default ALL), SV2 server periods | Shared presets 24H/7D/1M/All, default 24H, full screen on all charts | FE | 2a | helpers block, every `new Chart(` site, `wireFullscreenToggle` | unit (`clipSeries`, `coverageNote`, `rangeWindow`), Playwright | Every applicable chart conforms | Sparse data in 24H, so coverage notes are needed | same | revert | **DONE**: #35 merged `14f72ab`, Pages run 44722137466, live page byte-identical, live smoke 51/51 |
| 2c | Loading, freshness and responsive states | Mostly present | Uniform states in new areas | FE | 2a | new area renderers | unit + Playwright phone | No indefinite spinner | — | same | revert | **DONE**: #35 merged `14f72ab`, Pages run 44722137466, live page byte-identical, live smoke 51/51 |
| 3a | Forecast tab | Forecasting Lab view | Sentiment V2 › Forecast with metadata (model, asset, horizon, created, cutoff, artifact/run id, coverage, outcome) | FE | 2a | `view-forecast`, `fl*` helpers | unit (row metadata), Playwright | Missing forecasts shown as missing | Chronos origin loss on TimesFM skip | same | revert | DONE in PR (Stage 3/4): coverage & missingness panel, asset / input cutoff / issued / target per forecast |
| 3b | Sentiment V1 view | V1 line inside the SV2 chart only | Read-only V1 area: V1 series as stored + Foufi Daily | FE | 2a, 2b | new `view-sentiment-v1`; V1 `/foufi-latest` | unit, Playwright with mocked V1 route | No V1 write; values unaltered | V1 host not reachable from CI, so mocks are needed | same | revert | DONE in PR (Stage 3/4): V1 series (#35) + Foufi Daily via GET /foufi-latest |
| 3c | Gemini parity | Not in V2 UI | Narrative, Trader-Gemini, Foufi per contract §6 | FE | 3b; Narrative needs 7 | new panels | unit (payload builders), mocked-route tests | Contract match; user-triggered only | Spends V1 Gemini quota; live check only on owner request | same | revert | Foufi + Narrative DONE in PRs; **Trader Analysis (Gemini) open**: needs V1's market snapshot fields mapped to V2 data |
| 4 | Research and Learning & Audit | Experiments + History views | Research (unintegrated only) and Learning & Audit areas | FE | 2a | `view-experiments`, `view-history`, `view-learning` | Playwright | Research shows experiment state; PEV-1P/GLM-PE-1 untouched | Misclassifying production items | same | revert | DONE in PR (Stage 3/4): backtests → Research; GLM-PE-1 + PEV-1P panel in Learning & Audit |
| 5a | Comparison API | none | `/api/comparison/v1-v2` (+ summary), read-only, bounded | BE | **B-1** | `worker.js` (new route), new module, tests | vitest (bounds, alignment, read-only fake DB, look-ahead) | Contract §7 | D1 reads | PR → CI → staging → `production` approval | revert + redeploy | **BLOCKED (B-1)** |
| 5b | Observability reduction | logs at 100%, invocation logs on | Contract closure §3.1 | BE | **B-1**; owner plan check | `wrangler.toml`, log lines | config snapshot test | Lower volume; audit tables unchanged | Less diagnosis | same | revert | **BLOCKED (B-1)**; due before 1 Dec |
| 6 | Comparison UI | Sentiment-level V1/V2/BTC chart | Outcome-based comparison (§7) | FE | 5a | new `view-comparison` | unit (metrics, Wilson, bands) | n, coverage and CI beside every metric | Small samples | same | revert | Stage 2 interim READY; full BLOCKED by 5a |
| 7 | Portfolio | none in V2 | Browser ledger, accounting, import/export, snapshots, planning | FE | 2a, 2b | new `view-portfolio`, helpers | unit (accounting suite §8.6), Playwright | Arithmetic and reconciliation tests pass | Personal data in browser storage (OD-06) | same | revert; data stays in the user's browser | DONE in PR (Stage 7): ledger, accounts, transfers, reversals, average cost, P&L, cash, allocation, value history, CSV/JSON import-export, V1 import, Dry Powder, break-even prices, scenarios, Narrative. **Open:** V1 break-even *probability* model; historical FX lookup |
| 8 | Alerts and Settings | operational alert model only | V1 alerts read-only + V2 ops alerts; Settings | FE | 2a | `view-alerts`, `view-settings` | unit, Playwright | No credentials in frontend | — | same | revert | READY |
| 9 | Hardening and evidence | — | Full tests, smoke, cost check, evidence pack, ChatGPT audit | FE+BE | all | — | all suites | Plan §22 | — | — | — | After 2–8 |

## Sequence

1. **Now (FE, READY):** 1 → 2a+2b+2c (one PR, "frontend foundation") → 3a → 4 → 3b/3c → 7 → 8 → 6-interim.
2. **When B-1 is resolved (BE):** 5b first (1 Dec deadline), then 5a; staging, then one approved production deploy; V1 regression check.
3. **Then:** 6 full → 9.

**Not reported as done until:** merged, deployed, and the live page or route verified. Backend items stay BLOCKED until a backend PR is
merged and deployed through the `production` gate.

## Progress log

- 2026-11-20 10:47 UTC: #35 (Stage 1 docs + Stage 2 frontend foundation) merged as `14f72ab` and deployed to GitHub Pages (run 44722137466). Verified: the live `index.html` is byte-identical to `14f72ab`; `tests/e2e/stage2-smoke.cjs` passed 51/51 against the live site (desktop + iPhone 13); unit tests 61/61; CI Test run 44721967251 success. No backend, V1 or data change.
