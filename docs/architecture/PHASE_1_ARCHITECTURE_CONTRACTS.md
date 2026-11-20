# Phase 1 — architecture and implementation contracts (2026-11-20)

Controlling: Implementation Plan v2 (20 Nov 2026) and owner decisions `docs/governance/OWNER_DECISIONS.md` (OD-01…OD-12).
Built on the verified state in `docs/phase-0/PHASE_0_CLOSURE_2026-11-20.md`. **Names marked *proposed* are designs, not
existing code.** Everything else is cited from the repositories at PulseWorkerV2 `b640e3c` / CryptoPulseV2 `bef750d` / V1
PulseWorker `fb30da1` / V1 CryptoPulse `9a5810c`.

## 1. Target architecture and boundaries

```
                  ┌──────────── read-only ────────────┐
V1 sentiment-ff75 (OD-01, immutable) ──► shared D1 sentiment-history ◄── pulseworker-v2 (V2 engine, OD-02)
   │ public V1 routes (CORS *)                                      │   sv2-1.1.0 · k-NN/selection · GLM (OD-03)
   ▼                                                                ▼
CryptoPulseV2 (GitHub Pages, single index.html) ◄── V2 public read API ── GitHub Actions research (TimesFM, Chronos, PEV-1P)
   areas: Overview · Portfolio · Sentiment V1 · Sentiment V2 · Comparison · Research · Learning & Audit · Alerts · Settings
```

| Boundary | Rule | Enforcement |
|---|---|---|
| V1 | Immutable. V2 reads V1 tables (backend) or calls V1 *read* routes (frontend). V1 POST routes are called only for the Gemini parity user actions (§6), exactly as the V1 UI calls them | Code review + V1 regression check (§10) |
| V2 engine | Preserved. New code is additive: new routes, new UI. No change to `sv2Compute`, `runPrediction`, selection, calibration, the collector or GLM | Backend tests unchanged and green |
| GLM | Bounded influence into V2 BTC 24h only (as deployed). UI shows baseline, signal, adjustment and final as separate fields | UI reads `/api/glm/*` and `/predict`; it never derives GLM values itself |
| Comparison | Read-only. No write route, button or workflow; never fed back to V1/V2 | Backend: GET only; static test that no `INSERT/UPDATE/DELETE` exists in the comparison module |
| Research | Isolated; no production influence by default | Separate nav area; data only from research routes and artifacts |
| Portfolio | Separate accounting domain; never touches sentiment, predictions, weights or outcomes | Separate storage (browser ledger; optional dedicated D1 tables later) |
| Learning & Audit | Evaluates past decisions with resolved outcomes; preserves decision-time vs resolution-time facts | Reads existing ledgers only |
| Security | Temporary V1-equivalent model (OD-06); deferred review (OD-07) | `docs/security/POST_PRODUCTION_SECURITY_REVIEW.md` |

## 2. Navigation contract

Hash routing keeps the existing pattern (`#<area>` or `#<area>/<tab>`). Legacy hashes redirect, so old links keep working.

| Area (key) | Tabs | Content source (existing → destination) | Stage |
|---|---|---|---|
| Overview (`overview`) | — | current **Dashboard** (`view-dashboard`): headline forecast with GLM final/baseline, evidence, data quality, system status, price vs predictions chart | 2 |
| Portfolio (`portfolio`) | Holdings · Transactions · Planning | **new** (§8) | 7 |
| Sentiment V1 (`sentiment-v1`) | — | **new** read-only view: V1 series as stored (from `/api/sentiment-v2/comparison` `v1` field) + V1 Foufi Daily (§6) | 2 (series), 3 (Foufi) |
| Sentiment V2 (`sentiment-v2`) | Overview · Forecast · Model | Overview ← current **Sentiment V2** view (chart, AI annotation, evidence, sources). Forecast ← current **Forecasting Lab** (incl. GLM evidence layer). Model ← current **Lab** (variants, calibration, selected model, model health; production prediction internals) | 2 |
| Comparison (`comparison`) | — | Stage 2: the existing *sentiment-level* V1/V2/BTC comparison, clearly labelled. Stage 6: outcome-based comparison (§7) | 2 → 6 |
| Research (`research`) | — | current **Experiments** minus AI Learning: early detection, experiment register, offline backtests | 2 |
| Learning & Audit (`learning`) | — | current **History** (prediction ledger with resolved outcomes, technical-by-regime) + **AI Learning** block + PEV-1 report link + GLM-PE-1 evaluation | 2 |
| Alerts (`alerts`) | — | Stage 2: existing operational alert model (`alertModel`, freshness, staleness). Stage 8: V1 alert configs/log, read-only (§9) | 2 → 8 |
| Settings (`settings`) | — | Stage 2: API target (production/staging, existing `apiBaseFor`), time display, reset local preferences. No model/weight editing | 2 |

Legacy redirects: `#dashboard→#overview`, `#lab→#sentiment-v2/model`, `#forecast→#sentiment-v2/forecast`,
`#sentiment→#sentiment-v2`, `#experiments→#research`, `#history→#learning`, `#learning` (old AI Learning) `→#learning`.
**There is no "Forecasting Lab" label anywhere in navigation.** Desktop: top tab row (scrolls horizontally on narrow
screens). Mobile: bottom bar with 5 primary items (Overview, Portfolio, Sentiment V2, Comparison, More) and a "More" sheet
holding the rest. Every area has loading, empty, stale, unavailable and error states; no indefinite spinner.

## 3. Component reuse

| Existing component | Reused for |
|---|---|
| `NAV`, `renderNav`, lazy `load*IfNeeded` guards | 9-area navigation; tabs within Sentiment V2 |
| `wireFullscreenToggle` | Shared full-screen for every chart (extended per §5) |
| `buildRangeTabs` / `buildLabRangeTabs` / `clipToLabRange` | Replaced by one shared range builder (§5); the old names become thin wrappers or are removed |
| `chip`, freshness/stale helpers, `apiFetch`, `apiBaseFor` | All areas |
| View-model helpers block (`// ---- BEGIN view-model helpers`) | All new pure logic goes inside it so `tests/view-models.test.mjs` can test it |
| `sentimentV2Model`, `sv2SeriesStyle`, `sv2LineBreakMs` | Sentiment V1 view and the Stage 2 Comparison view |
| `flTimesfmRows`, `flChronosRows`, `flPairs`, `flAgreement`, `flWilson` | Forecast tab, unchanged |
| `glmStatusModel`, `glmSignalModel`, `glmAdjustmentRows`, `headlineOf`, `glmHeadlineNote` | Forecast tab and Overview, unchanged |

## 4. API boundaries and compatibility

Existing routes stay unchanged in path, parameters and response meaning. Frontend consumers today: `/predict`
family via `COIN_CONFIG`, `/chart-data`, `/select-variant`, `/selection-history`, `/variant-calibration`, `/backtest-*`,
`/prediction-freshness`, `/d1-usage`, `/api/events/health`, `/api/learning/{daily,chatgpt}`, `/api/sentiment-v2/{comparison,status,evidence}`,
`/api/glm/{status,signals,adjustments,run}`, `/research/timesfm-recent`, `/analyst-relay/*`, plus artifacts on
`raw.githubusercontent.com` (Chronos `ledger.json`, PEV-1 report).

**Additive backend routes (*proposed*; blocked by B-1 until backend access exists):**

| Route | Purpose | Bounds |
|---|---|---|
| `GET /api/comparison/v1-v2?asset=BTC&horizon=24&period=24h\|7d\|30d\|all&limit≤500` | Aligned V1 / V2-baseline / V2-final records with outcomes (§7) | Indexed newest-first reads; ≤ 3 queries; ≤ 5k rows per uncached request; Cache API 5 min; `truncated` flag |
| `GET /api/comparison/v1-v2/summary` | Metrics per slice with n, coverage, Wilson CI and sensitivity bands | Derived from the route above; cached |
| *(optional)* `GET/POST /api/portfolio/backup` | Server copy of the browser ledger (V1-equivalent, OD-06) | New additive table; migration needs owner application. **Not required for Stage 7** |

V1 routes consumed (read, or user-triggered parity only): `/foufi-latest`, `/foufi-list`, `/foufi-recent`, `/history`,
`/server-composite/readings`, `/alert-configs` (GET), `/alert-log` (GET), `/gemini-outlook` (POST, user click),
`/trader-analysis-gemini` (POST, user click), `/txs-backup` (GET, explicit user import only).
**Never called by V2:** `/foufi-check`, `/foufi-backfill-rss`, any V1 write route except the two Gemini parity POSTs.

## 5. Chart and visualisation contract (OD-08)

**Shared module (*proposed*, in the view-model helpers block so it is unit-tested):**

```
CHART_PRESETS = [ {key:'24H', ms:24h}, {key:'7D', ms:7d}, {key:'1M', ms:30d}, {key:'ALL', ms:Infinity} ]   // fixed order
DEFAULT_PRESET = '24H'
chartRangeState[chartKey]                 // independent per chart; default '24H'
rangeWindow(presetKey, nowMs)             → {fromMs|null, toMs}
clipSeries(points, tsField, presetKey, nowMs) → {points, coverage:{firstTs,lastTs,n}, limited:boolean}
coverageNote(coverage, presetKey)         → '' | 'Data starts <date> — shorter than 7D' | 'No data in the last 24H (latest <date>)'
buildPresetTabs(hostId, chartKey, onChange)   // one renderer; same labels, order, styling, aria-pressed, keyboard
wireFullscreen(btnId, sectionId, containerId, getChart, normalHeight)  // existing helper, extended
```

- **Applies to:** price vs predictions (Overview); calibration/combined history, model health, variant compare (Model);
  V1/V2/BTC (Sentiment V2 Overview, Sentiment V1, Comparison); forecast vs actual and cumulative (Forecast); portfolio value
  history (Portfolio).
- **Server-period charts:** the SV2 chart requests `period` from `/api/sentiment-v2/comparison`. The mapping is 24H→`24h`, 7D→`7d`,
  1M→`30d`, All→`all`. `90d` is no longer offered (OD-08 fixes the preset set); the backend still supports it.
- **Non-time visuals** (forecast scatter, variant score bars, allocation donut): full screen only, no presets.
- **Full screen:** a visible button with `aria-label` "Expand chart" / "Exit full screen"; `Esc` exits; body scroll locked; the
  chart resizes; range, asset, horizon and filters persist across enter/exit because the state lives outside the DOM; the
  close control stays reachable on mobile (safe-area padding).
- **Honesty rules:** All = all available valid history. A preset longer than the coverage shows the coverage note; no padding,
  interpolation across gaps longer than the existing `sv2LineBreakMs` rule, or extrapolation. Axes show units and the timezone
  label (local time, with UTC in the tooltip).
- **The display range never changes** backend retention, horizons, model calculations or accounting periods.

## 6. Gemini parity contract (OD-04)

| | Narrative | Trader Analysis (Gemini) | Foufi Daily |
|---|---|---|---|
| V1 purpose | Gemini's own synthesis of 2–3 medium/long-term market themes for the user's holdings | Gemini's independent BTC read from the same snapshot the Llama trader analysis uses | Summary of each new @CryptoFoufi video: market summary, macro/micro/TradFi reads, per-coin −2…+2 scores |
| V1 invocation | `POST /gemini-outlook` (V1 `worker.js:3245`), user click in the Narrative tab | `POST /trader-analysis-gemini` (`:3203`), user click | Hourly cron `checkFoufiDigest` (`:393`, `:2092`) writes `foufi_digest`; read via `GET /foufi-latest` (2 newest), `/foufi-list`, `/foufi-recent?days≤120` |
| Request | `{portfolio:[{sym, weight}], …}` (V1 `index.html:6437`) | `{sentiment, technicals, probabilityModel, whaleActivity, liquidationClusters, sourceCorrelations, buyTheNews}` (V1 `buildTraderAnalysisDataBlock`) | none (GET) |
| Response | `{analysis, narrativeScores, ts}`; 502 `{error}` | `{analysis, ts}`; 500 `{error}` | `{latest:[digest]}`; `{days, count, rows}` |
| Model / quota | `gemini-3.6-flash`, V1 `GEMINI_API_KEY`, free tier, **no V1 quota ledger** | same | same; deduplicated per `video_id` |
| V2 destination | Portfolio › Planning ("Narrative") | Sentiment V2 › Overview (on-demand panel) | Sentiment V1 (V1 input) and as labelled context in Sentiment V2 Evidence |
| V2 behaviour | Button sends the V2 portfolio's weights (no amounts, no transactions) | Button sends the V2 snapshot with **only fields V2 actually has**; absent fields are sent as `null` (V1 prints "N/A") and listed in the UI | Read-only display |
| Error / degraded | Show V1's error text; no retry loop; one request per click; disabled while in flight | same | `UNAVAILABLE` with last-success time; stale after 36 h |
| Provenance | "Gemini (via V1), model gemini-3.6-flash, generated <ts>"; labelled interpretation, never a V2 score | same, plus the list of input fields sent | video id/link, `published_ts`, `transcript_status`; "Gemini summary of a video" |
| Must not change in V1 | route, prompt, model, key, cron, tables | same | same; V2 never calls `/foufi-check` |
| Not done | No V2 Gemini key or call; V2 `GEMINI_DAILY_CRON_ENABLED` stays `0`; no Gemini in GLM as provider or fallback | | |

Verification gate before release: one live call of each POST from a browser, with the response shape checked against the
table, **on explicit owner request only** (each call spends V1's free Gemini quota). Until then the panels are built against
recorded V1 contracts and tested with mocked routes.

## 7. Comparison methodology (Stage 6; OD-12)

**Three series per aligned decision:**
1. **V1 production**: V1 server composite reading (`server_composite_readings`, hourly since 2026-11-16; `scomp-v1`), or the V1
   `history` reading as fallback. The value is passed through exactly as stored.
2. **V2 baseline**: the served headline before GLM (`headlineOf` semantics: `cycle_p_up` for a non-original variant, else `p_up`), from `predictions`/`selection_*` at the tick.
3. **V2 final**: `glm_adjustments.final` where a row exists (BTC 24h only); elsewhere final = baseline with the reason
   `glm_out_of_scope` or `no_adjustment`, never shown as "GLM agreed".

**Alignment:** key = (asset, horizon, decision_ts = V2 tick time). V1 reading = latest V1 reading with `ts ≤ decision_ts` and
age ≤ 3 h, else V1 = missing (recorded, not compared). V1 has no horizon: the same V1 reading is the V1 view for 12h and 24h,
labelled as such.

**Direction:** V2 UP if p > 0.5, DOWN if p < 0.5. V1 (proposed convention, OD-12): score > 55 UP, < 45 DOWN, 45–55 no call.

**Outcome:** the existing V2 resolution rule (first price ≥ target_ts; realised direction); unresolved stays pending. Outcomes are
used only after `resolved_ts`.

**Metrics per slice** (asset, horizon, regime, period, evidence coverage): n aligned, coverage %, no-call %, agreement rate
(V1↔V2b, V1↔V2f, V2b↔V2f), directional accuracy with Wilson 95% CI, Brier score for V2 only (V1 is not probabilistic), GLM
changed-call count (expected 0: no-flip) and mean |adjustment|.

**Sensitivity:** the summary reports V1 accuracy and coverage for the bands 50/50 (no neutral zone), 45/55 (proposed) and 40/60.
A narrow band raises coverage and adds near-neutral calls; a wide band lowers coverage. Results are shown side by side so the
convention cannot hide an effect.

**Claims rule:** below 30 resolved aligned pairs per slice → "insufficient sample", no ranking. No superiority claim unless the
Wilson intervals do not overlap **and** n ≥ 100; even then labelled "observational, not pre-registered". Negative results are shown.

## 8. Portfolio design (Stage 7; OD-06)

**8.1 V1 behaviour (verified):** ledger in browser `localStorage['cp2_txs']`; transaction `{date, asset, acct, type:'buy'|'sell',
qty, price, ccy}`; accounts Revolut and Neverless; cash interest held as a separate embedded series; server backup `POST
/txs-backup` (last 10 copies) and `GET /txs-backup`; portfolio value snapshots via `POST /portfolio-log` → `portfolio_snapshots`;
FX via `api.frankfurter.dev`; views DCA/Average Cost, Dry Powder Planner, Scenarios, Break-even, Capital.

**8.2 V2 storage (V1-equivalent, OD-06):** browser-local ledger under new keys `cpv2_portfolio_*` (no collision with V1's `cp2_*`),
plus JSON and CSV export/import. A server backup is optional and later (§4). No exchange API sync. No real transactions in source,
tests or fixtures (synthetic fixtures only).

**8.3 Data model (*proposed*):**

| Entity | Fields |
|---|---|
| account | `id, name, kind (exchange\|wallet\|bank), base_ccy, created_at, archived` |
| transaction (append-only) | `id (uuid), account_id, ts (ISO date-time), type, asset, qty, price, price_ccy, fee_amount, fee_ccy, fx_to_usd, fx_source (user\|frankfurter\|none), transfer_id, reverses_id, note, created_at, import_run_id` |
| types | `buy, sell, deposit, withdrawal, transfer_out, transfer_in, reward, fee, adjustment` |
| import_run | `id, source (csv\|v1_backup\|json), file_hash, rows_total, rows_accepted, rows_rejected, duplicates, created_at` |
| snapshot | `ts, total_usd, by_asset[{asset, qty, price_usd, value_usd}], price_source` (computed on visit, kept locally) |
| settings | `reporting_ccy = USD` (fixed), `display_ccy (USD\|EUR)`, `dry_powder_target`, `scenario_assumptions` |

**8.4 Accounting rules:**
- Average-cost method per asset (V1 uses average cost); cost in USD at the transaction-date FX rate.
- Fees in the quote currency raise buy cost and reduce sell proceeds. A fee in the asset reduces quantity.
- Realised P&L = proceeds − avg_cost × qty − fees. Unrealised = qty × price − remaining cost.
- `transfer_out`/`transfer_in` pairs (same `transfer_id`) move quantity and cost between accounts with no P&L and no investment.
- `reward` adds quantity at the user-entered USD fair value (counted as income); if no price is given, cost basis is 0 and the row is flagged.
- `deposit`/`withdrawal` move cash (dry powder).
- Corrections are new `adjustment` or reversal rows (`reverses_id`); rows are never edited or deleted.
- A missing FX rate gives `fx_status: missing`; the row is excluded from USD totals and listed. It is never guessed.
- Market movement (price change) is shown separately from investment performance (cash flows).

**8.5 Import:** CSV with a strict header and per-row validation report; a duplicate is the same (account, ts, type, asset, qty, price);
"Import from V1" is user-initiated and reads `GET /txs-backup` once (S-10), mapping `buy/sell` 1:1 with `acct` → account.

**8.6 Tests:** ledger arithmetic, transfer no-double-count, fees/rewards, FX missing, average cost after partial sells, realised and unrealised P&L,
reversal, import validation and duplicates, export round-trip, and "no mutation" (the ledger array is append-only).

## 9. Alerts and Settings

- **Alerts (Stage 8):** V1 alert configs and log read-only (`GET /alert-configs`, `/alert-log`); V1 Telegram delivery stays in V1. V2
  operational alerts (prediction staleness, workflow health, GLM degraded, collector failures) come from existing V2 routes.
  **Creating or editing V1 alert configs from V2 is not in scope** (it would write V1 data that changes V1 Telegram behaviour; OD-01).
- **Settings:** API target (production/staging), display currency for Portfolio (reporting stays USD), time display (local/UTC),
  reset local preferences, about/build (deployed commit, API version). No model, weight, calibration or GLM controls.

## 10. Resource budgets

| Resource | Budget for new work |
|---|---|
| D1 (V2) | New comparison routes ≤ 5k rows per uncached request, cached 5 min; **0 rows added to tick or cron paths**; daily total stays < 1M rows (V2 Worker) |
| Workers AI | No new use. GLM stays ≤ 300 Neurons/day as deployed |
| Gemini | No V2 calls; parity uses V1 user-triggered routes only |
| Cron Triggers | 0 new (5/5 used) |
| GitHub Actions | No new schedules; CI only on PRs and pushes |
| Observability | No new datasets; apply the §3.1 reduction (closure report) when backend access exists |
| Frontend | No new paid CDN or service; Chart.js and Tailwind stay as already loaded |

## 11. Testing and release requirements

- **Frontend:** `node --test tests/*.test.mjs` (existing 54 + new); new pure helpers unit-tested. Playwright smoke (desktop 1280×800 and
  phone) against the production API (read-only GETs only): all 9 areas render; no "Forecasting Lab" in navigation; Forecast tab inside
  Sentiment V2; presets 24H/7D/1M/All, 24H selected by default; full screen enter/exit (button and `Esc`); legacy hash redirects; no
  console errors.
- **Backend (when B-1 is resolved):** vitest + pytest green; new route tests for bounds, read-only behaviour (recording fake DB), alignment,
  no look-ahead and degraded states; staging deploy first.
- **Release:** frontend PR → `Test` workflow green → merge → Pages deploy → verify the live `index.html` matches the merge commit and run the
  smoke test on the live site. Backend: PR → CI → `production` approval → deploy → verify `git_commit_sha` on new rows and the route
  output. **V1 regression check after any shared-infrastructure deploy:** `sentiment-ff75` modified time unchanged, V1 `history` and
  `server_composite_readings` still advancing hourly.
- **Rollback:** frontend = revert the merge (Pages redeploys); backend = revert + approved redeploy, or env kill switches; no
  migration without a tested down-script.
