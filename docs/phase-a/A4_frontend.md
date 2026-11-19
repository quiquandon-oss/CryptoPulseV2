# A4 Frontend audit (CryptoPulseV2) - read-only
All refs are /home/user/CryptoPulseV2/index.html unless stated (single 4313-line file, 327 KB).

## 1. Structure
- Static site, no build, no package.json. Tailwind via CDN (:16), Chart.js, Google Fonts. All JS inline in index.html.
- Views (NAV :2267-2274, hash routed): dashboard (:96), lab (:262), forecast = "Forecasting Lab" (:662), experiments (:398), history (:564), sentiment = Sentiment V2 (:628). Desktop top nav (:75), mobile bottom nav (body pb-24).
- Pure view-model helpers delimited by `// ---- BEGIN view-model helpers` ... `END` (:~800-1380) are unit-tested by extracting that block into a node vm.
- Tests: tests/view-models.test.mjs (618 lines), `node --test tests/*.test.mjs` (Node 22, built-in runner). No DOM/e2e tests.
- CI: .github/workflows/test.yml (PR + push main, runs node --test), deploy.yml (push main -> GitHub Pages, uploads whole repo root).
- Other: manifest.json, assets/ (icons), docs/ (SENTIMENT_V2_*), .ai/ (collab docs incl. GEMINI_MARKET_INTELLIGENCE.md), README.md.

## 2. Backend calls
Base host: WORKER_URL = https://pulseworker-v2.quiquandon.workers.dev (:1554), hardcoded production. No staging host/switch exists in the frontend. Cache: apiFetch 60 s memo (:1380-1395); getJson returns {ok,data|error}.

| Route | Lines | View | Class |
|---|---|---|---|
| /predict, /link-predict, /eth-predict ?horizon=12/24 | 1410,1522,1659,2865,2911-14 | Dashboard tiles, prediction card, system status | PRODUCTION |
| /calibration, /link-calibration, /eth-calibration | 1750,2963 | Dashboard/Lab | PRODUCTION |
| /calibration-history (+link/eth) | 2968,3102,3317 | Lab/History | PRODUCTION |
| /chart-data (+link/eth) | 2135, FL main chart 2503 | Dashboard chart; also Forecasting Lab BTC price | PRODUCTION (reused by lab) |
| /variant-calibration, /select-variant, /selection-history | 1738,3274,3474,3483 | Lab (model selection) | PRODUCTION |
| /prediction-freshness | 2171 | Dashboard data quality, tiles | PRODUCTION |
| /d1-usage?days=2 | 1461 | System status | ops |
| /api/events/health, /api/events?limit | 1459,4116-17 | System status / Experiments | research/ops |
| /backtest-history, /backtest-regime-split-history | 2790,2813 | History | PRODUCTION-eval |
| /api/sentiment-v2/comparison?period, /evidence?hours=24&limit=12, /status | 2385-97, FL 2504 | Sentiment V2 tab; comparison also in FL sentiment chart | RESEARCH |
| /research/timesfm-recent?horizon=12\|24&limit=500 | 2502 | Forecasting Lab | RESEARCH |
| /api/research-lab/registry | 4115 | Experiments | RESEARCH |
| /api/learning/daily, /api/learning/chatgpt | 3456,3465 | Experiments | RESEARCH (Gemini/ChatGPT era, see 4) |
| /analyst-relay/prompt (GET), /analyst-relay/submit (POST, only write) | 3835,3902 | Experiments | RESEARCH |
| External: raw.githubusercontent.com .../research-data/exp008-chronos/.../ledger.json (FL_LEDGER_URL :2474) | 2503 | Forecasting Lab (Chronos-2) | RESEARCH, NOT a Worker route |
| External: raw.githubusercontent .../research/evaluations/2026-11-01-pev1-report.json (:2475) | 2503 | FL PEV-1 sentiment panel | RESEARCH |
| External: api.github.com workflow runs / issues (:1449-51) | system status | ops |

Backend check (worker.js): /predict at :10614 returns snapshot body or predictAndLog result + `selection`. /research/timesfm-recent at :11008 (BTC only, horizon 12|24 else 400). There is NO Worker route for Chronos, GLM or evidence-adjusted predictions; GLM exists only as Sentiment V2 scoring model (@cf/zai-org/glm-4.7-flash, worker.js:12787) and a /api/sentiment-v2/run glm_probe step.

## 3. Forecasting Lab today (view-forecast, :659-730; model :1185-1380; render :2473-~2780)
Shows: header + horizon toggle (12/24h) and period toggle (24H..ALL); two model cards (TimesFM 2.5 = EXP-004 from D1, Chronos-2 = EXP-008 from GitHub ledger.json) with status chip (PRODUCING / STALE >36h / LAST RUN FAILED / NO PERSISTED RESULTS), latest call, q10-q90 (Chronos), latest resolved, progress to 100-origin checkpoint; BTC actual vs forecast chart (origin->target dashed segments, Chronos q bars); performance (direction accuracy with Wilson CI vs always-UP and persistence, MAE/RMSE/MAPE, predicted-vs-realised scatter, cumulative hit rate, 7/30d windows); model agreement panel; sentiment V1/V2 vs forecasts chart + PEV-1 report (k-NN B vs C); filterable ledger (table >=sm, cards on mobile).
- Frozen-plan rules enforced: sealed period < 2026-10-09T21Z dropped (FL_SEAL_END :1195); prospective from 2026-11-01 vs post-seal descriptive (:1196, flPopulation :1201); no verdict until checkpoint (:1197).
- NOT shown: any V2 production prediction (/predict p_up), any evidence drill-down, any GLM interpretation, any baseline/adjusted/final p_up. Page explicitly says research only, never a production input (:667). Separation today is by omission: the lab never fetches /predict. Only shared route is /chart-data for prices.
- Mobile: viewport meta, grid-cols-1 -> md:2, chart heights 300px sm:400px, ledger switches to cards under sm, table min-w-760 in overflow-x scroll, bottom nav. Charts have aria-label roles.
- Stale/missing/error: per-source failure text in #flStatus (:2528-30) ("could not be loaded"/"ledger not available"), card-level load-failed state, STALE chip, empty chart message #flMainEmpty, windows with n<10 show "insufficient", pending vs resolved vs unreadable statuses. Gap: no per-row freshness of Chronos vs TimesFM origin mismatch other than "missing" agreement; Chronos depends on a raw.githubusercontent branch (cache/availability risk, no staleness of ledger itself beyond generated_ts display).
- Tests cover fl* helpers (tests/view-models.test.mjs imports flTimesfmRows, flChronosRows, flPairs, flDirectionStats, flAgreement, flModelCard, flPev1Model, flLedgerFilter...).

## 4. Gemini remnants (mandate: exclude Gemini entirely)
index.html: :21 (comment), :385 (comment), :514 (UI copy "paste prompt into free Gemini app"), :1564, :1578 (comments), :3430-3433, :3825, :3855 ("same evidence Gemini receives"), :3861-3862 (UI "Paste the Gemini app's response", textarea placeholder), :3955 (GEMINI role card body), :3971 (human card mentions Gemini/ChatGPT/Claude), :3978 (roleCard 'GEMINI'), :4084. Live code: Analyst Relay UI + /analyst-relay/prompt|submit calls (:3835,:3902), /api/learning/daily|chatgpt (:3456,:3465) in the Experiments view. Last commit fdd4033 already removed "Gemini daily" and paused experiments, but the Analyst Relay and role cards remain.
README.md: "Gemini (free tier)" design principle, /gemini-outlook, Free-tier section. .ai/GEMINI_MARKET_INTELLIGENCE.md (whole file), .ai/MARKET_CATALYST.md / AI_COLLABORATION.md likely (not exhaustively read). Backend routes still exist (/gemini-analysis, /link-gemini-analysis) though the frontend does not call them (not grepped in index.html fetches).

## 5. Compatibility constraints (fields UI depends on; do not remove/rename/retype)
/predict (+link/eth): ok, status ('ok'|'insufficient_data'|'insufficient_resolved_analogs'), n_available, min_required, n_resolved, ts, served_from ('snapshot'), persisted, p_up (0-1, also headline fallback, tests assert 0.867 etc), calibrated_p_up, median_analog_return_pct, return_range_pct[2], n_analogs, trend_strength, top_analogs[] (map), note, selection{ok, chosen_variant, chosen_p_up, cycle_p_up, cleared_gate, scores[{variant,p_up,lca,n_matched}]}; also experimental{p_up}, challenger{...} touched by tests/tile models (paused UI now removed but fixtures remain). headlineOf (:826) picks selection.cycle_p_up for non-original variants else p_up. => Adding baseline_p_up / glm_adjusted_p_up / final_p_up must be ADDITIVE; keep p_up semantics (or keep p_up = final and add baseline separately, but then calibBadge(p_up, calibrated_p_up) and the tile tests change meaning, so decide explicitly).
/research/timesfm-recent: forecasts[] with id, input_end_ts, ts, target_ts, price_at_prediction, forecast_price, predicted_return_pct, direction, actual_return_pct, actual_direction, correct, resolved_ts, horizon_hours, coin, model_version.
ledger.json (Chronos): forecasts[] (id, forecast_file, resolution_file, input_end_ts, issued_ts, target_ts, price_at_prediction, forecast_median/q10/q90, predicted_return_pct, direction, persistence_direction/correct, status, actual_*), generated_ts, recent_runs[{run_ts,errors}].
/chart-data: prices[{ts, btc_price}] (+ per coin price fields). /prediction-freshness: per coin horizons{h:{core,challenger:{status,cron_rows_24h,latest_cron_ts,latest_git_commit_sha}}}. /api/sentiment-v2/comparison: points[{ts,v1,v2,btc,v2_status,v2_version,v1_origin}], series_status, from_ts,to_ts,v2_error,v1_history_last_ts,truncated.
Error convention: getJson treats `ok:false` in body as failure.

## 6. Git log (-20)
Latest: PR #31 removes paused experiments UI (challenger, EXP-002/003/023, Stage 7, Gemini daily). #27/#28 add Forecasting Lab (TimesFM 2.5 + Chronos-2 vs actual BTC, persisted results only; 500 rows/horizon). #24-#26, #29-#30 Sentiment V2 evidence/status/budget panels and chart fixes. #19-#20 system status/DB usage. #21-#22 V1 vs V2 vs BTC chart. #23 Sentiment V2 technical report. Pattern: small PRs from claude/* branches, merged to main, auto-deployed.

## Gap list for the Forecasting Lab mandate
1. Side-by-side TimesFM/Chronos: exists as two cards + agreement + overlaid chart, but per-origin side-by-side (same origin, both forecasts, q10-q90, agreement) is only in ledger rows; add a single paired "latest origin" comparison panel at fixed horizons and a 3-row per-origin view.
2. Chronos data source is a raw GitHub file, not a Worker API; no staging/prod switch; add Worker route (e.g. /research/chronos-recent) or document the dependency; no ledger staleness indicator beyond generated_ts.
3. Evidence drill-down: nothing in Forecasting Lab. Sentiment V2 tab has evidence (/api/sentiment-v2/evidence) but not linked to a forecast origin. Needs backend route keyed by origin/prediction id plus a drawer/expand UI.
4. GLM interpretation: no UI and no backend route exposing GLM output per prediction (only sentiment scoring + probe). Need route and panel (with Gemini-free copy).
5. Baseline vs GLM-adjusted vs final V2: no such fields in /predict; lab never fetches /predict. Need three distinct labelled series/cards (baseline, adjusted, final) with distinct color/shape, and a hard visual/text separation of numerical research forecasts (TimesFM/Chronos) from production V2 predictions; add frontend view-model + tests; keep /predict fields additive.
6. Separation: currently by omission; must be explicit sections/badges once V2 predictions appear.
7. Tests: only pure view-model tests; add fixtures for new fields; add a static check no "Gemini" string in index.html.
8. Remove Gemini remnants (list in section 4) and README/.ai doc mentions.
9. Mobile: ledger cards exist; new side-by-side/evidence panels need single-column stacking and drawer pattern; charts at 220-400px fixed heights.
10. Staging: add API base override (e.g. ?api= or hash) to test against staging worker without editing production constant.
