# CryptoPulse V2 — Phase 0 discovery and implementation readiness (2026-11-20)

Controlling document: *CryptoPulseV2 Full Implementation Plan for Claude v2* (owner-approved, 20 Nov 2026), read in
full. Every fact below was checked in source, deployed systems or production data during this session (≈10:00 UTC),
unless it is marked **unverified**. No production mutation: 0 D1 rows written, no deploy, no merge, no schedule or
configuration change, no Workers AI or Gemini call. The production D1 queries were bounded `SELECT`s that read about 4,600 rows in total.

## 1. Overall readiness: **READY WITH LIMITATIONS**

Frontend work can start now. Backend PRs are blocked by session access (§2). Portfolio is blocked by a missing
private-access boundary, which the plan itself makes a second-review stop (§10, plan §10.4).

## 2. Access and environment

| Access | Status | Evidence |
|---|---|---|
| GitHub MCP (API) | **Verified**, user `quiquandon-oss` | `get_me`; PR list and Actions runs for CryptoPulseV2 |
| CryptoPulseV2 repo | **Verified read + push** (branch `ccr-d1cb07a9-8kjw4j`) | attached to session |
| PulseWorkerV2 repo | **Read only** (anonymous git clone of public repo). **No push, no PR/Actions API** | `add_repo` with push was **denied by the auto-mode classifier** (same as audit gap G-18 on 11-19) |
| V1 repos `PulseWorker`, `CryptoPulse` | **Read only** (public clone) | used only for inspection |
| `gh` CLI | **Unavailable**: `GH_TOKEN` invalid; the session routes GitHub through MCP | `gh auth status` |
| Cloudflare MCP connector | **Verified**: lists Workers and D1, runs SQL on production D1 | used for `SELECT` only. **Note:** it can also write to production D1, so it is used under a strict read-only discipline. It is marked deprecated by Cloudflare |
| Proxy-injected Cloudflare credential ("D1 staging access") | **Not working**: `Authentication error` / `Invalid API Token` on account, D1 and Workers GETs | probing stopped after Cloudflare's auth-failure rate limit |
| Proxy-injected staging admin credential | Available, **not yet tested** (staging GET `/` works without it) | — |
| Cloudflare account plan, Observability, Workers AI usage, CPU | **Unavailable**: no account-read or analytics access | need the dashboard or a read-only Account Analytics token |
| Wrangler CLI | Not installed. Deploys run in GitHub Actions with repo secrets | — |
| Network | Allowlisted: production and staging Worker hosts, GitHub Pages, `api.cloudflare.com`, `huggingface.co`, market-data hosts. `developers.cloudflare.com` is **not** allowlisted | environment config |
| Tooling | Node 22.23, npm 10.9, Python 3.13, vitest, pytest, Playwright + Chromium (preinstalled) | — |

## 3. Repository and deployment baseline (protected baseline = today's finalised V2)

| Item | Reference |
|---|---|
| **PulseWorkerV2 `main`** | `b640e3c` — #180 "GLM production influence: real inference, bounded no-flip adjustment…" (merged 2026-11-20 09:07 UTC) |
| **Deployed `pulseworker-v2`** | Script modified 2026-11-20 09:24:19 UTC. `/api/glm/status` reports the #180-only config (`inference_enabled: true`, `mode: active`, cap 0.03, budget 300), so **#180 is live**. The newest `predictions.git_commit_sha` is still `54792ea` (09:01 tick, before the deploy); the 12:00 UTC tick will confirm `b640e3c` |
| **CryptoPulseV2 `main`** | `bef750d` — #34 "GLM influence on the headline" |
| **Deployed frontend** | Pages run 44708025160 (success, 09:07 UTC) for `bef750d`; the live `index.html` is byte-identical in size (347,867 B) |
| **V1 `sentiment-ff75`** | Script modified 2026-11-16 19:13 UTC, matching PulseWorker `fb30da1` (merged 19:13 UTC). Frontend: CryptoPulse `9a5810c` |
| Other Workers on the account | `pulseworker-v2-staging`, `cryptopulse-research-dispatcher`, `cryptopulse-v4` (**separate project, out of scope, untouched**) |
| Working tree | Clean in both repos |
| Open PRs | CryptoPulseV2: none open (#27–#34 merged). PulseWorkerV2: **not listable** (no API access); 105 `claude/`/`ccr-` branches exist |
| GLM first live inference | **Tomorrow 07:00 UTC**. Today's 07:00 run predates the deploy (`status: model_disabled`); `glm_adjustments` is empty and `sv2_ai_neurons` is empty |

**Test baseline (run locally on these commits):** frontend `node --test` **54/54**; backend vitest **1,634/1,634**
(72 files); backend pytest **1,120 passed, 2 skipped**. All green.

## 4. Architecture: verified current state

```
V1 (immutable)  sentiment-ff75 ── crons 0 6,18 * * * | */15 * * * * | 0 * * * *  (3 of the account's 5)
                Workers AI llama-3.1-8b-instruct-fast (5 call sites) · Gemini gemini-3.6-flash (3 capabilities)
                writes history, btc_data, foufi_digest, alert_*, portfolio_snapshots, txs_backup, server_composite_* …
                         │ shared D1 "sentiment-history" (30.2 MB, 70 tables) — read-only for V2
V2 backend      pulseworker-v2 ── crons 0 * * * * (tick every 3 h / sentiment-v2 chain otherwise) | 0 7 * * * (GLM daily)
                k-NN predictions (BTC/ETH/LINK × 12h/24h) → selection → prediction_snapshots → /predict
                Sentiment V2 sv2-1.1.0 (hourly, sentiment_v2_results) ← V1 archive + V1 server readings + collector
                Collector (sv2_evidence, 7 of 8 RSS/Atom sources enabled)
                GLM (glm/*.js): 07:00 BTC-24h signal → tick hook → glm_adjustments; cap 0.03, no-flip, 300 Neurons/day
GitHub Actions  TimesFM 2.5 (07:30 UTC → D1 experiment_4_timesfm) · Chronos-2 (21:40 UTC → branch research-data/exp008-chronos)
                PEV-1P counts (Mon 07:17) + candle archive (Mon 07:41) · learning export 08:00 · staleness/health/audit jobs
V2 frontend     single index.html (GitHub Pages) → production Worker; Chronos and PEV-1 JSON from raw.githubusercontent.com
```

All 5 Cron Triggers on the account are in use (Workers Free limit), so **no new Cloudflare cron is possible**.

## 5. Implementation status by workstream

| Workstream | Exists (reuse) | Partial | Missing |
|---|---|---|---|
| Navigation | Desktop and mobile nav driven by a `NAV` array | Views: Dashboard · Lab · **Forecasting Lab** · Experiments · History · Sentiment V2 | Target: Overview, Portfolio, Sentiment V1, Sentiment V2 (Overview/Forecast/Evidence-GLM/History), Comparison, Research, Learning & Audit, Alerts, Settings |
| Sentiment V1 (read-only) | V1 public GET routes (`/history`, `/server-composite/readings`, `/foufi-latest` …); the V1 series inside the SV2 chart | — | A dedicated read-only V1 view |
| Sentiment V2 engine | sv2-1.1.0, families, collector evidence, regime, analogues; `/api/sentiment-v2/{comparison,status,evidence}` | — | **Nothing to rebuild.** Preserve |
| GLM bounded influence | **Deployed today**: versioned contract (`glm-signal-2`, `glm-input-3`, `glm-prompt-3`, `glm-qual-0.4`), atomic Neuron ledger, three independent kill switches, baseline kept in `predictions`, final in `glm_adjustments`; `/api/glm/{status,signals,adjustments,evaluation,run}`; GLM-PE-1 frozen prospective protocol | Scope BTC 24h only (12h/ETH/LINK = NO_SIGNAL by design) | Check the contract against the plan §5.5 field list (gap check only) |
| Forecast tab | "Forecasting Lab" view: TimesFM vs Chronos vs actual BTC, GLM evidence panel, Gemini assessment, verification status | Lives as a separate top-level "Lab" (**prohibited by the plan**) | Move it into Sentiment V2 as the Forecast tab; add a side-by-side matrix, coverage/missingness, agreement, and baseline vs GLM vs final with cap/reason |
| Comparison V1 vs V2 | `/api/sentiment-v2/comparison` (V1 vs V2 sentiment vs BTC, aligned at V1 timestamps, bounded, cached); `/api/glm/evaluation` | Sentiment-level only | Outcome-based, aligned, read-only evaluation; V1 vs V2-baseline **and** V1 vs V2-final; sample sizes; slices |
| Research | `/api/research-lab/*`, `research_experiment_registry`, Experiments view; paused experiments already removed from the UI (#31) | No state classification | One isolated Research area with an actual-state inventory and a production-use check |
| Learning & Audit | `/api/learning/*`, History view, `/d1-usage`, `/prediction-freshness`, PEV-1 report | Spread across views | A consolidated area |
| Portfolio | V1 only: browser `localStorage` ledger (`cp2_txs`), D1 `txs_backup` (last 10 snapshots), `portfolio_snapshots` (≈5.9k rows), DCA/Average Cost/Dry Powder/Scenarios/Break-even | — | **Everything in V2**, blocked on the security boundary (§10) |
| Alerts | V1 `alert_configs`/`alert_log`, Telegram (`/test-telegram`, V1 secret) | — | V2 Alerts area (credential/security audit needed) |
| Settings | V1 `cp2_ccy` USD/EUR, theme | — | V2 Settings |
| Chart standard | 6 Chart.js charts; **shared** `wireFullscreenToggle` and range-tab builders exist | Presets are `1D/1W/1M/ALL` (main) and `1W/1M/3M` (Lab); default not 24H; not every chart has full screen | One shared ChartFrame: **24H (default) / 7D / 1M / All** plus full screen/exit, applied to every chart |

### Gemini — V1 parity verdict (plan §0, §2.1, §9)

**V1 uses Gemini** (`sentiment-ff75` at `fb30da1`, model `gemini-3.6-flash`, secret `GEMINI_API_KEY`):

1. **Narrative tab**: `POST /gemini-outlook` (user-triggered).
2. **Trader Analysis (Gemini)**: `POST /trader-analysis-gemini` (user-triggered).
3. **Foufi Daily**: hourly cron `checkFoufiDigest` summarises new videos into `foufi_digest`; read via `/foufi-latest|list|recent`. It also feeds V1's composite (weight 6, confidence 0.4).

**Parity approach, decided from the plan and needing no owner input:** V2 consumes these **through V1's existing
routes** (read endpoints, plus the same user-triggered POSTs the V1 UI already makes). That adds no new Gemini
consumer, key, cron or role. V2's own Gemini daily cron stays paused (`GEMINI_DAILY_CRON_ENABLED=0`; it is not a V1
capability). The existing GLM handling of stored Gemini outputs as *labelled, assessed AI evidence* is already in the
deployed baseline and is preserved. **The 11-19 audit's G-13/D-4 ("remove Gemini") is superseded.**

## 6. Data, operations and resources

- **Production D1 `sentiment-history`** (shared with V1): migrations 0002–0031 in `.ai/migrations/` (0001 and 0017–0020
  absent; core V2 tables predate migrations). Rollback scripts exist only for 0029 and 0031. Migrations are applied
  **manually outside CI**.
- **V2 D1 reads** (`d1_usage_daily`, V2 Worker only): 11-18 0.72M · 11-19 0.67M · 11-20 (to 10:00) 0.34M per day.
  Before migration 0030 it was 1.7–2.1M per day. Writes are ≈2.2k/day. The limit is **5M/day account-wide**, but V1, `cryptopulse-v4` and
  research consumption are **not visible**, so only V2's headroom is known.
- **Workers AI:** GLM is capped at 300 Neurons/day (3% of 10k). V1's Llama use is **unmeasured**; the owner accepted this on 11-20 and I am not re-asking.
  On Workers Free, overrun fails with error 3036 and is not billed.
- **GitHub Actions:** all repos are public, so standard runners are free. Schedules are unchanged by this phase.
- **Observability:** production `[observability.logs]` is enabled with `head_sampling_rate = 1` and invocation logs; traces are off.
  **Ingestion volume, account plan and subscription are unverified.** Repo comments say "Workers Free (owner-confirmed)";
  if that holds, there is no billing exposure from 1 Dec, but ingestion pauses at the daily limit.
- **Deploy/rollback paths:**
  - Frontend: push to `main` → Pages deploys immediately with no approval; rollback = revert.
  - Backend: push to `main` (worker paths) → CI → approval-gate → `production` environment (**required reviewer = owner**) → wrangler deploy.
    Rollback = revert and redeploy. GLM kill switches are `wrangler.toml` vars, so they also need a deploy and therefore approval.
  - Staging: `pulseworker-v2-staging` Worker and D1, deployed by `deploy-sv2-staging.yml`; the frontend has a staging API switch (#32).

## 7. Protected — must not be touched

- V1: `sentiment-ff75`, PulseWorker and CryptoPulse repos, its 3 crons, its secrets, its tables (`history`, `btc_data`,
  `foufi_digest`, `alert_*`, `portfolio_snapshots`, `txs_backup`, `server_composite_*` …) — read only.
- V2 engine at `b640e3c`: `runSentimentV2Cycle`/`sv2Compute` (sv2-1.1.0), the collector and its registry, the k-NN/selection/
  calibration path, `predictions` baseline fields, the GLM contract and its kill switches.
- TimesFM/Chronos workflows and the `research-data/*` branches; PEV-1P frozen window and counts-only jobs; the GLM-PE-1 protocol.
- `cryptopulse-v4` Worker/D1 and `photoduel-db` (other projects).

## 8. Risks and blockers

| # | Risk | Type | Handling |
|---|---|---|---|
| R1 | No push/API on PulseWorkerV2 | Access, **blocker** | Owner attaches it with push, or allows `add_repo` |
| R2 | **V1 `GET /txs-backup` returns the full personal transaction ledger with no auth and CORS `*`**; `GET /portfolio-history` is open; the public V1 repo embeds real Revolut/Neverless transactions (`SEED_TXS`) | Security, **pre-existing** | Fixing it is a V1 change, so it needs second review. Not touched. Verified from code only; route not called |
| R3 | No private-access boundary in V2 (public Pages, public Worker, admin token only) | Security, **Portfolio blocker** | §10 decision |
| R4 | Account plan / Observability volume unverifiable before 1 Dec | Cost | Owner confirms on the dashboard; I reduce log volume in the first backend PR |
| R5 | Cloudflare MCP connector can write to production D1 | Governance | `SELECT` only; every non-trivial query bounded |
| R6 | Account-wide D1 headroom unknown | Cost | New endpoints use indexed, `LIMIT`-bounded reads, cached; 0 reads added to tick paths |
| R7 | Each backend deploy waits for manual approval | Schedule | Batch backend PRs |
| R8 | GLM's first active run is tomorrow; cap 0.03 is provisional | Data integrity | Observe the 07:00 and 09:00/12:00 runs before any UI claims |
| R9 | Single 348 KB `index.html` | Delivery | Additive edits with view-model tests; no framework rewrite |
| R10 | Forecast pairing loses an origin when TimesFM skips; Chronos 30/38 artifacts "unpinned" | Data | Show as missing; never pair-fill |

## 9. Proposed implementation sequence

1. **Phase 1 — contracts (docs PR, frontend repo):** target nav and route map with legacy redirects; ChartFrame spec;
   Comparison method; Forecast tab content; Gemini-parity wiring; API additions (backend, read-only, bounded).
2. **Phase 2 — frontend foundation** (can start now): nav restructure (Forecasting Lab → Sentiment V2 › Forecast;
   Lab/Experiments → Research; History → Learning & Audit); shared ChartFrame (24H default / 7D / 1M / All plus full screen) applied
   to all 6 charts; uniform loading/stale/error states. Browser tests on desktop and phone.
3. **Phase 6 — Forecast tab** (frontend over the existing `/api/glm/*`, `/research/timesfm-recent` and the Chronos ledger): 7 visually
   separate layers, coverage/missingness, agreement, baseline → GLM → final with cap and reason.
4. **Phase 4 (part) — V1 capability views that need no private data:** Sentiment V1 read-only view; Gemini parity
   (Narrative, Trader Analysis Gemini, Foufi Daily) via V1 routes; market context (Bottom Signal, Regime Scorecard,
   cycles) after a formula audit.
5. **Phase 8 — Research / Learning & Audit** consolidation over the existing routes.
6. **Backend batch** (needs R1): bounded read-only Comparison endpoint; an Observability log-volume reduction (sampling and
   verbose-log trimming, keeping audit records) **before 1 Dec**; any Forecast/Comparison API additions. Staging first,
   then one approved production deploy. V1 regression check after the deploy.
7. **Phase 7 — Comparison UI** on that endpoint.
8. **Phase 3 — Portfolio** after the §10 decision; then Alerts/Settings.
9. **Phase 9:** hardening, cost check, deployment evidence pack, then the ChatGPT audit.

## 10. Owner decisions genuinely required

1. **Backend access:** attach `quiquandon-oss/PulseWorkerV2` to the session with push (or add an allow rule for
   `mcp__claude-code-remote__add_repo`). Without it, backend work can only be prepared as patches.
2. **Portfolio access boundary** (plan §10.4 hard stop). Options:
   - (a) **Cloudflare Access** (Zero Trust Free, $0, ≤50 users) in front of a private portfolio API on the V2 Worker;
   - (b) a browser-only ledger like V1 (no server copy) plus manual encrypted export;
   - (c) defer Portfolio.

   Recommendation: (a). It is a security-architecture change, so it needs ChatGPT and owner review.
3. **V1 privacy exposure (R2):** the open `/txs-backup` route and the transactions committed to the public repo are V1 changes I may not make. Decide
   whether to handle them separately (outside this programme), and whether the V1 repo should be made private.
4. **Comparison semantics:** V1 outputs a 0–100 sentiment composite, not a horizon direction or probability. Proposed default
   (applied unless you object): V1 direction = UP above 55, DOWN below 45, NEUTRAL in between. It is compared with V2 baseline `p_up` and
   V2 final (GLM) on BTC 24h, resolved by the existing outcome rule, with neutral counted as abstention.
5. **Observability evidence before 1 Dec:** confirm the account plan (Workers Free vs Paid) and today's Observability
   ingestion on the Cloudflare dashboard, or provide a read-only Account Analytics token through the environment's secure form.
