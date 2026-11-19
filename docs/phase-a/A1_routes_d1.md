# A1 - PulseWorkerV2 routes, crons, D1 schema, serving path, GLM code, unbounded queries
Repo: /home/user/quiquandon-oss/pulseworkerv2, main @ e7e10f4. READ-ONLY audit (no D1/network/modification).
All line refs are worker.js unless a path is given. Migrations live in `.ai/migrations/` (NOT `migrations/`).

## 0. File layout
- worker.js (13,677 lines; single module). Imports: learning/{learning-core,learning-api,learning-ui,learning-session,learning-candidates}.js, events/event-api.js, sentiment-v2/{collector,evidence-score}.js (worker.js:2-10).
- Real entrypoint: `export default { fetch, scheduled }` at 13627-13677 (wraps D1 usage accounting, route cache, tick read memo) -> delegates to `pulseWorkerHandlers.fetch` (10498) / `.scheduled` (11655).
- Other workers: dispatcher/ (own wrangler.toml), not covered.

## 1. HTTP routes (fetch handler, 10498-11650)
Global: CORS `*` (10499-10504). Admin gate `v2OpsAuth` (10484-10495) applies ONLY to `V2_OPS_ROUTES` (10472-10481): `Authorization: Bearer ${OPS_ADMIN_TOKEN || STAGE7_ADMIN_TOKEN}`, 503 if neither set, 401 if wrong. Everything else is public unless its own handler gates it. Read-route cache `ROUTE_CACHE_PATHS` (11997-12004, 1 h epoch bucket + MAX(prediction_snapshots.computed_ts)) fronts the paths marked [RC].
Legend: Class = V1 (V1-facing/read of V1 data), V2P (V2 production prediction cycle: the 3h tick or serves its output), SV2 (Sentiment V2), RES (research/experiments), OPS (ops/admin/maintenance). "cycle" = used by the prediction cycle / serving.

| Method Path (line) | Auth | Class | D1 reads | D1 writes | Notes |
|---|---|---|---|---|---|
| GET / (10519) | public | OPS | - | - | health |
| GET /db-check (10527) | public | V1/OPS | history (COUNT/MIN/MAX) | - | |
| GET /predict?horizon=12\|24 (10614) | public | **V2P serving** | prediction_snapshots (PK read, 6h max age) else full runPrediction path: btc_data, history, predictions, calibration_curve, stale_refresh_claim, challenger_*, selection_decisions | on snapshot miss: UPDATE predictions (backfill), UPDATE challenger_predictions, UPDATE gemini_daily_analysis (bias backfill), stale_refresh_claim; INSERT btc_data/predictions/challenger_predictions/selection_decisions/selection_provenance ONLY if cron stalled (claim fencing, resolveWriteAuthorization 474) | main served path; BTC |
| GET /eth-predict (10671), /link-predict (11258) | public | V2P serving | same pattern, eth_data/eth_predictions, link_data/link_predictions (+history for LINK) | same pattern | |
| GET /select-variant?coin&horizon (10642) [RC] | public | V2P | selection_decisions (latest) | - | read-only getLatestSelection (1734) |
| GET /selection-history (10657) [RC] | public | V2P | selection_decisions LIMIT<=50 | - | |
| GET /chart-data, /eth-chart-data, /link-chart-data (10706,10722,11294) [RC] | public | V2P/V1 UI | btc_data FULL, predictions FULL (per horizon) (and eth/link analogues) | - | UNBOUNDED (see s6) |
| GET /calibration, /eth-calibration, /link-calibration (10734,10750,11276) [RC] | public | V2P | predictions/eth_/link_predictions (resolved, per horizon, no LIMIT) | - | |
| GET /calibration-history, /eth-..., /link-... (11033,11044,11285) [RC] | public | V2P | same tables | - | |
| GET /challenger-calibration(+history), /variant-calibration (10761,10778,11022) [RC] | public | V2P | challenger_predictions, core table | - | |
| GET /calibration-curve (11082) [RC] | public | V2P | calibration_curve (latest computed_ts) | - | |
| GET /challenger-recent (10991) [RC] | public | V2P | challenger_predictions | - | limit<=100 |
| GET /prediction-freshness (10981) | public | OPS | challenger_predictions, core tables, price tables (MAX ts) | - | 5-min style memo (getPredictionFreshnessCached 4669); used by prediction-freshness-check workflow |
| GET /d1-usage?days (10894) | public | OPS | d1_usage_daily | - | |
| GET /research/regime-directional, /research/anomaly-conditioned-audit, /research/anomaly-gate, /research/momentum (10794-10872) | public | RES | core + challenger tables, price tables, selection_decisions(_anomaly/_momentum) | - | read-only, heavy (full scans) |
| GET /research/timesfm-recent (11008) | public | RES | experiment_4_timesfm | - | |
| GET /api/learning/daily, /api/learning/chatgpt (10549,10574) | public | RES | daily_report_cache (else buildDailyReport: core+challenger tables, coin_catalyst_log) | daily_report_cache on cache miss | |
| GET /api/sentiment-v2/status (10930) | public (edge cache 5 min) | SV2 | sqlite_master, sv2_source_state, sv2_evidence, sv2_collection_runs, sv2_ai_neurons | - | getSentimentV2Status 13517 |
| GET /api/sentiment-v2/evidence?hours&limit (10930) | public | SV2 | sv2_evidence | - | limit<=100 |
| GET /api/sentiment-v2/comparison?period (10954) | public (edge+in-isolate cache 5 min) | SV2 | research_sentiment_archive, server_composite_readings (V1), sentiment_v2_results, history (1 row), btc_data | - | LIMIT 2000/6000 bounded |
| POST /api/sentiment-v2/run {steps:[sync,v2,collect,glm_probe]} (10907) | **admin** | SV2/OPS | history, research_sentiment_archive, btc_data, event_ledger, sv2_*, d1_usage_daily, server_composite_readings | research_sentiment_archive, sentiment_v2_results, sv2_evidence/_source_state/_collection_runs, sv2_ai_neurons | on-demand copy of the hourly non-tick chain (uses sv2CountingDb); only way to run glm_probe |
| GET /recalibrate-refresh, /recalibrate-refresh-challenger (11055,11070) | **admin** | OPS (V2P data) | resolved predictions | calibration_curve / challenger_calibration_curve | |
| GET /btc-backfill(-hourly), /link-backfill(-hourly), /eth-backfill-history (11172,11181,11240,11249,10694) | **admin** | OPS | btc_data/link_data/eth_data; external Hyperliquid | same tables | |
| GET /backtest-technical, -feature, -combined, -regime-split (11190-11224) | **admin** | RES | history, (Yahoo fetch) | backtest_results, regime_split_results | |
| GET /backtest-history, /backtest-regime-split-history (11216,11232) [RC] | public | RES | backtest_results, regime_split_results | - | |
| GET /run-analysis (11152), /run-link-analysis (11312) | **admin** | RES (Gemini) | btc_data, history / link_data, gemini_quota_ledger | gemini_daily_analysis / link_gemini_analysis, gemini_quota_ledger, gemini_provider_calls | spends Gemini quota |
| GET /gemini-analysis, /link-gemini-analysis (11134,11303) | public | RES | gemini_daily_analysis / link_gemini_analysis | - | |
| GET /analyst-relay/prompt (11095) | public | RES | catalyst/investigation inputs | - | |
| POST /analyst-relay/submit (11107) | **admin** | RES | coin_catalyst_log | analyst_relay_log, coin_catalyst_log | 200 KiB cap |
| GET /research-lab, /research-lab/advanced (11326,11350); GET/POST /research-lab/signin, GET/POST /research-lab/signout (11330-11348) | public pages; signin = credential -> signed cookie | RES | - | - | HTML only |
| GET /api/learning/market, /case, /candidates, /candidate, /versions, /session (11361-11394) | public | RES | research_events, stage7_*, learning_candidates, v1_methodology_versions, history, btc_data | - | |
| POST /api/learning/parse (11370) | public | RES | - | - | pure parse |
| POST /api/learning/findings, /candidates, /candidate/update, /candidate/decide (11383-11430) | `authorizeWrite` (signed session cookie + same Origin + header, or Bearer) then STAGE7_ADMIN_TOKEN server-side | RES | learning/stage7 tables | stage7_research_requests/responses, learning_candidates, v1_methodology_versions | |
| GET /api/research-lab/{dashboard,events,event,sources,source-effectiveness,pipeline-health,registry,stage7-overview,experiment5-overview,experiment5-decisions,experiment5-results,experiment5-sentiment,experiment5-source-intelligence,timeline} (11433-11632) | public | RES | research_*, stage7_*, history, btc_data, research_sentiment_archive, research_experiment_registry, research_standalone/pool_evaluations | - | |
| POST /api/research-lab/stage7-register-response (11530) | Bearer STAGE7_ADMIN_TOKEN (stage7AuthorizeWrite 7153) | RES | stage7_research_requests/responses | stage7_research_responses (+requests status) | only writer of responses |
| GET /api/events, /api/events/health, /api/event?id= (events/event-api.js:94-102) | public | RES/OPS (Event Detection) | event_ledger, event_observations, event_source_health, event_runs, event_documents | - | |
| POST /api/events/run (event-api.js:103) | Bearer EVENT_RUN_TOKEN or STAGE7_ADMIN_TOKEN (>=16 chars) | OPS | same event_* | event_* | `X-Event-Trigger: schedule` path used by event-detection-schedule.yml (GitHub, hourly :23) |
| any other | - | - | - | - | 404 `not_found` (11641) |

**Used by the V2 prediction cycle (cron-internal, not HTTP):** runCoinCronTick -> predictAndLog/linkPredictAndLog/ethPredictAndLog (core + challenger + backfills), selectBestVariant, recordSelectionProvenance, savePredictionSnapshot, refreshDailyReportCache. HTTP routes that serve its output: /predict, /eth-predict, /link-predict, /select-variant, /selection-history, /calibration*, /challenger*, /variant-calibration, /calibration-curve, /chart-data*, /prediction-freshness.
**Research-only (no effect on production serving):** /research/*, /api/learning/*, /api/research-lab/*, gemini routes, backtests, analyst-relay, sentiment-v2 routes (SV2 does not feed predictions; see s4).
**Note:** public GET /predict etc. CAN write (backfill UPDATEs always; INSERTs when cron stale) - not read-only despite GET.

## 2. Scheduled handlers, config, vars
### 2.1 Crons (wrangler.toml [triggers], identical comment-stale text mentions "3h" but code is hourly)
`crons = ["0 * * * *", "0 7 * * *"]`. wrangler.staging.toml has NO [triggers] (staging runs only via POST /api/sentiment-v2/run and GitHub sv2-staging-run.yml).
Entry: 13647-13677 (opens usage accounting `withD1Usage`, optional `makeTickReadMemo` unless TICK_READ_MEMO=0, records `recordD1UsageDaily(... 'scheduled', cron)` after all waitUntil settle) -> `pulseWorkerHandlers.scheduled` 11655. Unrecognised cron = no-op.

### 2.2 `0 * * * *` (hourly) in order
Pre-branch (13655-13658), every hour, fire-and-forget:
1. if RESEARCH_FUNDING_DISPATCH_ENABLED != "0" -> dispatchResearchCollection (GitHub workflow_dispatch research-funding-intraday-schedule.yml). **Prod = "0" -> skipped.**
2. if hour%3==1 (stalenessAlertDue 12184) -> dispatchStalenessAlert (prediction-staleness-alert.yml). Needs secret RESEARCH_DISPATCH_TOKEN else `no_token` no-op.
Branch (11697-11745) on `hour = UTC hour of scheduledTime`:
- **hour%3==0 (8 invocations/day: 00,03,...,21): production tick** `runCoinCronTick` (6390) = sequential batches BTC_BATCH, LINK_BATCH, ETH_BATCH (6264-6266); each batch runs 12h+24h chains concurrently (runCoinBatch 6366). Each chain `runCoinHorizonChain` (6265): predictFn(allowWrite:true) [backfills -> logXData -> runXPrediction -> runChallengerPrediction unless CHALLENGER_ENABLED="0"] -> selectBestVariant -> recordSelectionProvenance('cron') -> savePredictionSnapshot. Then `refreshDailyReportCache` (3200). **No SV2 / event detection in this invocation.**
- **hour%3!=0 (16 invocations/day): SV2 chain**, one shared D1 call counter `sv2Q` via `sv2CountingDb` (13137-13147; counts every prepare().first/all/run/raw, each db.batch() and exec as 1). Strictly sequential `.then` chain (11712-11742):
  1. `runAutomaticDetection` (events/event-api.js:28) - only if env.EVENT_DETECTION_ENABLED === '1' (**not set in wrangler.toml; dashboard/secret-only - unverifiable here**); skip if a run started recently.
  2. `syncV1ArchiveFromHistory` (13008) - if V1_ARCHIVE_SYNC_ENABLED != "0" (prod "1"). 2 reads (history LIMIT 100 last 48h; archive LIMIT 200) + 1 batch INSERT OR IGNORE. queryBudget = 50 - 3 (SV2_D1_QUERY_RESERVE) - 31 (SV2_CYCLE_QUERY_HEADROOM = 16 + 3*5) - sv2Q.n.
  3. `runSentimentV2Cycle` (13150) - if SENTIMENT_V2_ENABLED=="1" (prod "1"). queryBudget = 50 - 3 - sv2Q.n. Defers whole cycle if budget < 21 (FIXED 16 + 5). Per pending reading 5 queries (AI reserve, slot, settle, limit check, insert); maxCatchUp 3; `fitReadings=floor((budget-16)/5)`.
  4. `sv2CollectGuarded` (11865) - evidence collector, only if SV2_COLLECTOR_ENABLED=="1" (prod "1"; if "0" falls through to sv2CollectEvidence which no-ops); needs budget >=6; reads d1_usage_daily (SUM today, MAX last_ts) fail-closed: usage_recording_off (D1_USAGE_TABLE=0), usage_unreadable, usage_stale (>2h old unless SV2_USAGE_GUARD_REQUIRE_FRESH="0", staging), d1_daily_budget stop at 2.5M rows read / 50k written (50% of 5M/100k; env SV2_COLLECTOR_D1_READ_STOP/WRITE_STOP can only lower). Collector limits (sentiment-v2/collector.js:35-): 3 sources, 8 subrequests, 256 KiB/response, 768 KiB/run. Writes sv2_evidence, sv2_source_state, sv2_collection_runs.
  Budget arithmetic: 50 D1 queries/invocation (SV2_D1_QUERIES_PER_INVOCATION 13128), 3 reserved for d1_usage_daily recording (upsert + <=12 'stmt' batch rows). Event detection consumes first (counted since env.DB is wrapped before step 1). Caveat: counter wraps the memo/usage proxies, so memo hits are still counted (over-count, conservative).

### 2.3 `0 7 * * *` (daily) (11655-11696)
All via `ctx.waitUntil` (concurrent, not ordered):
1. if GEMINI_DAILY_CRON_ENABLED != "0": runGeminiDailyAnalysis + runLinkGeminiAnalysis. **Prod "0" -> skipped.**
2. For coin in [BTC, LINK, ETH] x h in [12, 24]: `refreshCalibrationCurve` (1967, always; writes calibration_curve); `refreshChallengerCalibrationCurve` (286) if challengerEnabled; `logAnomalyGateExperiment` (1448, EXP002_CRON_ENABLED; BTC only in code; prod "0" skipped); `logMomentumSelectionExperiment` (1611, EXP003_CRON_ENABLED; BTC only; prod "0" skipped).
No SV2 steps in the daily cron.

### 2.4 Vars (wrangler.toml production / wrangler.staging.toml)
| Var | Prod (wrangler.toml) | Staging | Read at |
|---|---|---|---|
| GIT_COMMIT_SHA | "unknown" (overridden by deploy.yml) | "staging" | currentGitSha 46 |
| SENTIMENT_V2_ENABLED | "1" | "1" | runSentimentV2Cycle 13151 |
| SENTIMENT_V2_AI_MODEL | "" (OFF) | "@cf/zai-org/glm-4.7-flash" | sv2RunAi 12854 |
| SV2_GLM_DAILY_NEURONS | "0" (OFF) | "200" | sv2AiBudget 12794 |
| GEMINI_DAILY_CRON_ENABLED | "0" | unset (=> enabled, but no cron) | scheduledResearchEnabled 12182 (unset = enabled) |
| EXP002_CRON_ENABLED | "0" | unset | same |
| EXP003_CRON_ENABLED | "0" | unset | same |
| SV2_COLLECTOR_ENABLED | "1" | "1" | sv2CollectGuarded, runSentimentV2Cycle |
| SV2_SOURCES_DISABLED | "bitcoinmagazine" | "bitcoinmagazine" | collector |
| CHALLENGER_ENABLED | "1" | unset (=> enabled; default `?? '1'`, 1005) | challengerEnabled |
| SV2_V1_SERVER_INPUT | "1" | unset (=> '0' default, 13071; also table absent on staging) | sv2ServerInputEnabled |
| V1_ARCHIVE_SYNC_ENABLED | "1" | unset (=> enabled) | 13009 |
| RESEARCH_FUNDING_DISPATCH_ENABLED | "0" | unset | researchFundingDispatchEnabled 12195 |
| SV2_USAGE_GUARD_REQUIRE_FRESH | unset (=> required) | "0" | 10918, collector guard |
| [ai] binding | AI | AI | env.AI.run (12889) |
| D1 binding DB | sentiment-history f91ca980-b886-423a-bd6f-f3baea46d181 (SHARED with V1 sentiment-ff75) | pulseworker-v2-staging 5458d504-2778-49ae-bd25-7751f1c49d50 | |
| observability | logs enabled, 100% sampling, persist; traces off | - | |
Code-read env names NOT in toml (secrets/dashboard, unverifiable): OPS_ADMIN_TOKEN, STAGE7_ADMIN_TOKEN, EVENT_RUN_TOKEN, EVENT_DETECTION_ENABLED, RESEARCH_DISPATCH_TOKEN, GEMINI key(s), D1_USAGE_LOG, D1_USAGE_TABLE, ROUTE_CACHE, TICK_READ_MEMO, PREDICT_SNAPSHOTS, SELECTION_PROVENANCE, SV2_COLLECTOR_D1_READ_STOP/WRITE_STOP.

## 3. D1 schema (from `.ai/migrations/*.sql`)
Migrations present: 0002-0016, 0021-0030. **Missing from repo: 0001 and 0017-0020** (and 0021 comment region). Rollback only for 0029 (`.ai/rollback/0029_...down.sql`). Staging DB is separate and lacks V1 tables.

### 3.1 Tables CREATED by migrations here
| Table | Mig | Columns (abridged) | Indexes | Writer |
|---|---|---|---|---|
| experiment_4_timesfm | 0002 (+0003 ALTER, 0004 data) | id PK, coin, horizon_hours, ts, target_ts, input_end_ts, price_at_prediction, forecast_price, predicted_return_pct, direction, model_version, checkpoint, inference_backend, context_length, forecast_horizon_steps, features_used, production_chosen_variant, actual_return_pct, actual_direction, correct, absolute_error, signed_error, resolved_ts | idx_..._unresolved(target_ts) WHERE resolved_ts IS NULL; idx_..._coin_horizon_ts(coin,horizon_hours,ts) | Workflow exp004-timesfm.yml (exp004-timesfm/run_experiment.py, daily 07:30). Worker reads only (/research/timesfm-recent). |
| research_observations_v1 (VIEW) | 0005 | ts, btc_price, score AS v1_composite, technical_score, bottom_score, regime_mag, gold_regime, sources_json FROM history | - | n/a |
| research_events | 0005 (+0006 trigger_metric/threshold/version) | event_id PK, fingerprint, event_ts, detection_ts, category, direction, intensity, available_before_prediction, is_post_event_analysis | UNIQUE fingerprint; event_ts | workflows (research/live_evidence_pipeline.py, exp009, stage7) |
| research_analyses | 0005 | analysis_id PK, analysis_ts, window_start_ts, window_end_ts, sample_size, subject, metric_json, multiple_testing_correction, validation_status | analysis_ts | workflows exp005/009/010 |
| research_event_evidence | 0007 | evidence_id PK, event_id FK, feed_url, article_url, publisher, publication_ts, collection_ts, headline, keyword_score, evidence_relation, content_hash | UNIQUE(event_id,content_hash); event_id; content_hash | workflows (evidence_collector, live-evidence-collection.yml) |
| research_hypotheses | 0008 | hypothesis_id PK, created_ts, last_updated_ts, subject, statement, source_analysis_ids, status, evidence_summary_json, out_of_sample_status | status; subject | workflows (experiment5) |
| (index on predictions) | 0009 | idx_predictions_ts ON predictions(ts) | | |
| research_experiment_registry | 0010 (+0011-0014 data) | experiment_id PK, title, research_question, purpose, experiment_type, expected_result, success_criterion, start_date, target_date, status, baseline, required_sample, conclusion, next_action, github_refs, data_source_table, created_ts, updated_ts | - | migrations/manual (seed EXP-004..010) |
| research_sentiment_archive | 0015 | archive_id PK, observation_ts, sources_json, score, technical_score, btc_price, gold_regime, source_weights_version, schema_version, written_by, content_hash, archived_ts | UNIQUE observation_ts; archived_ts | **Worker** syncV1ArchiveFromHistory (written_by 'pulseworker-v2-archive-sync', INSERT OR IGNORE, btc_price NULL) AND workflow research/experiment5_pipeline.py (live-evidence-collection.yml `0 */6`); source data = V1 `history` |
| stage7_research_requests / _responses / stage7_event_sentiment | 0016 | see file (request_id PK, event_id FK, status, ...; response_id PK; sentiment calc rows) | partial UNIQUE active-per-event; event_id; status; calculation_ts | requests: learning-api.js:246 + stage7 python; responses: Worker POST stage7-register-response only; sentiment: stage7-research-pipeline |
| learning_candidates, v1_methodology_versions | 0021 | candidate_id PK ... ; version_id PK ... | unique response_id; event_id | Worker learning-candidates.js |
| research_standalone_evaluations, research_pool_evaluations | 0022 | CHECK-constrained evaluation records | experiment/recorded_ts; unique idempotency indexes | scripts/manual (not written by worker.js; read by getUnifiedResearchRegistry 8087) |
| event_ledger | 0023 | event_id TEXT PK, dedup_key UNIQUE, event_type, asset, market, scope, source, source_url, source_ts, detected_ts, direction, severity, confidence, rule_id, rule_version, observed/baseline/threshold_value, unit, evidence_json, explanation, freshness_ms, source_health, status, expires_ts, correlation_key, created_ts | detected_ts; (event_type,detected_ts); correlation_key | Worker events/event-store.js (hourly SV2-chain step 1 + POST /api/events/run) |
| event_observations (PK source,series,bucket_ts), event_source_health (PK source), event_runs (PK run_id), event_documents (PK source,doc_id) | 0023 | | | Worker events/ |
| prediction_snapshots | 0024 | PK(coin,horizon_hours): computed_ts, prediction_ts, body_json | PK only | Worker (runCoinHorizonChain -> savePredictionSnapshot 6209, UPSERT) |
| selection_provenance | 0025 | id PK, selection_table, selection_row_id, recorded_ts, coin, horizon_hours, prediction_ts, chosen_variant, chosen_p_up_source_ts, cycle_p_up, cycle_p_up_ts, selection_trigger, semantics_version | (selection_table,selection_row_id); (coin,horizon_hours,prediction_ts) | Worker recordSelectionProvenance 1201 |
| d1_usage_daily | 0026 | PK(day,kind,key): invocations, statements, rows_read, rows_written, max_rows_read, last_ts (kind in fetch/scheduled/'stmt') | PK | Worker recordD1UsageDaily 11897; read by /d1-usage, sv2CollectGuarded, ops/d1_usage_alert.py |
| sentiment_v2_results | 0027 | result_id PK, asset, decision_ts, calc_version, status(OK/DEGRADED/FAILED), degraded_reason, sentiment_score(0-100), sentiment_class, confidence, evidence_coverage, market_regime, regime_json, event_intensity, event_json, predictive_json, family_json, supporting_ids_json, contradicting_ids_json, missing_json, ai_model, ai_status, ai_json, usage_json, created_ts | UNIQUE(asset,calc_version,decision_ts) | Worker runSentimentV2Cycle (INSERT OR IGNORE, 12946) - V2 only |
| sentiment_v2_ai_calls | 0027 | PK(day,slot), reserved_ts | PK | legacy 0027 ledger; no code reference found in worker.js (superseded by sv2_ai_neurons) |
| btc_data index | 0028 | idx_btc_data_ts ON btc_data(ts) ("optional") | | |
| sv2_evidence | 0029 | evidence_id PK, source_id, family, canonical_url, title, summary, published_ts, retrieved_ts, title_hash, content_hash, dup_of, collector_version | retrieved_ts; (source_id,retrieved_ts); (title_hash,retrieved_ts) | Worker sentiment-v2/collector.js:455 |
| sv2_source_state | 0029 | source_id PK, last_attempt_ts, last_success_ts, last_status, last_error, consecutive_failures, ok_count, fail_count, last_new_items, etag, last_modified | PK | Worker collector.js:462 |
| sv2_collection_runs | 0029 | run_ts PK, collector_version, sources_json, items_seen/new/duplicate, subrequests, bytes, errors_json | PK | Worker collector.js:504 |
| sv2_ai_neurons | 0029 | PK(day,slot): reserved_ts, model, reserved_neurons, input_tokens, output_tokens, actual_neurons, status | PK | Worker (SV2_AI_RESERVE_SQL 12790 + recordNeurons UPDATE) |
| calibration_curve / challenger_calibration_curve indexes | 0030 | idx_calibration_curve_coin_h_ts(coin,horizon_hours,computed_ts); idx_challenger_calibration_curve_coin_h_ts(same) | | tables themselves NOT created here |

### 3.2 Tables referenced in code but NOT created by any migration in this repo (pre-existing: V1-owned or created out-of-band; schema inferred from INSERTs)
| Table | Owner (inferred) | Columns evidenced by worker.js |
|---|---|---|
| **history** | **V1 sentiment-ff75** (browser-driven writes; "only updates when someone opens V1") | id, ts, score, sources_json, technical_score, regime_mag, bottom_score, gold_regime, btc_price (research_observations_v1 view, Python fixtures: id, ts, score INTEGER, sources_json, technical_score, gold_regime). Worker reads only (never writes). |
| **server_composite_readings** | **V1 sentiment-ff75 (scomp-v1, hourly server cron)** | slot_ts PK, computed_ts, version, weights_version, composite, composite_exact, completeness, below_floor, n_ok, n_missing, provenance_json (schema from tests/sv2-server-v1-input.test.js:27; append-only trigger). Worker reads only (sv2ServerV1Rows 13098). |
| btc_data / link_data / eth_data | V1 created btc_data; V2 Worker inserts every tick (logBtcData 5629 etc.) | ts, btc_price/link_price/eth_price, technical_score (+funding_adj for link) |
| **predictions** | V2 Worker (idx added by 0009) | id, ts, target_ts, btc_price_at_prediction, p_up, n_analogs, median_analog_return, return_p25/p75, features_json, k_used, volatility_percentile, closest_analog_dist, is_regime_anomaly, p_up_experimental, median_return_experimental, horizon_hours, trend_strength, calibrated_p_up, calibrated_conditional_p_up, model_version, git_commit_sha, realized_btc_price, realized_return, realized_up, resolved_ts (insert 668-690; resolve 922) |
| eth_predictions / link_predictions | V2 Worker | same minus calibrated_conditional_p_up; eth_price_at_prediction / link_price_at_prediction (860, 5846) |
| challenger_predictions | V2 Worker | id, coin, ts, target_ts, horizon_hours, price_at_prediction, is_regime_anomaly, trailing_return_pct, p_up_flat, p_up_tilted, driver_used, driver_agreement, foufi_digest_video_id, trend_strength, calibrated_p_up_flat, p_up_momentum, momentum_triggered, model_version, git_commit_sha, realized_price, realized_return, realized_up, resolved_ts (3463) |
| calibration_curve, challenger_calibration_curve | V2 Worker | coin, horizon_hours, decile, predicted_p_up_mid, empirical_up_rate, n_samples, computed_ts (1982, 297) |
| selection_decisions | V2 Worker | ts, coin, horizon_hours, chosen_variant, chosen_p_up, lca_score, comparison_count, corrected_alpha, cleared_gate, k_sel, neighborhood_json, reason, prediction_ts, scores_json (1335) |
| selection_decisions_anomaly / _momentum | V2 Worker (research) | 1536 / 1709 |
| stale_refresh_claim | V2 Worker | coin PK, claimed_ts, claim_token (450) |
| foufi_digest | V1 (read-only by challenger, 3347+72) | video_id, published_ts, transcript_status, summary_json |
| gemini_daily_analysis, link_gemini_analysis, gemini_quota_ledger, gemini_provider_calls, analyst_relay_log, coin_catalyst_log, backtest_results, regime_split_results, daily_report_cache | V2 Worker (research/ops) | |
| research_analyses_exp005_*/exp009_*/exp010_* (named as data_source_table in registry) | workflows | not tables referenced via SQL in worker (computeExp0xxLiveFields read research_analyses) |
**Not found anywhere**: any table named `history.sources_json`-derived beyond view; `event_*` created in 0023 only; no migration creates `predictions` etc. (likely migration 0001, absent).

## 4. V2 /predict serving path and adjustment hook points
### 4.1 How served p_up is produced (BTC; LINK/ETH analogous)
1. Tick (hour%3==0): `runCoinHorizonChain` (6265) -> `predictAndLog` (4725): backfillPredictions (908, UPDATE resolved), backfillGeminiBiasShort, backfillChallengerPredictions; `resolveWriteAuthorization` (474; cron => persist unconditionally); `logBtcData` (5629); `runPrediction` (487-738).
2. runPrediction: loads ALL btc_data + ALL history (unbounded), k-NN on FEATURE_KEYS [score, technical_score, regime_mag, bottom_score] (22) z-score distances, K=min(15,max(5,n/3)); `p_up` = fraction of resolved analog forward returns >0; `p_up_experimental` (adaptive K + distance-weighted); `calibrated_p_up` = applyCalibratedProbability(p_up, latest calibration_curve decile) (241); `calibrated_conditional_p_up` = computeConditionalCalibration over last 300 resolved rows (336, null if <20 neighbours). INSERT INTO predictions (668). **It does not read sentiment_v2_results; V2 sentiment has no input into predictions** (grep of runPrediction/runLink/runEth shows only btc_data/history/predictions/stale_refresh_claim).
3. `runChallengerPrediction` (3347): challenger_predictions row (p_up_flat, p_up_tilted, calibrated_p_up_flat, p_up_momentum) from recent price rows (LIMIT 200) + trend + coreResult.
4. `selectBestVariant` (1236): 6 variants per coin (SELECTION_VARIANTS 1013-1045: original=p_up, experimental, calibrated, challenger_flat/tilted/calibrated); eligibility (>=50 resolved each), condition-matched neighbourhood from core table's last 300 resolved rows, LCA score per variant, Bonferroni-gated `decideSelection` (1073). Persists selection_decisions (1335); `chosen_p_up` = chosen variant's p_up on **its latest RESOLVED prediction** (semantics 'sel-v1', 1167-1182), NOT the current cycle; current-cycle value added as `cycle_p_up` by recordSelectionProvenance (1201) / cycleValueForVariant (1188).
5. `savePredictionSnapshot` (6209) UPSERTs `prediction_snapshots(coin,horizon)` body_json = {...predictResult, selection}.
6. Serving: `GET /predict` (10614): `readFreshPredictionSnapshot` (6227; PK read, <=6h old; adds served_from/snapshot_computed_ts) else predictAndLog + `selectionForServedPrediction` (6246; runs selectBestVariant only if that request persisted, else `getLatestSelection` 1734). Served p_up fields in body: `p_up`, `calibrated_p_up`, `calibrated_conditional_p_up`, `experimental.p_up`, `challenger.*`, and `selection.chosen_variant/chosen_p_up/cycle_p_up`. Horizons 12 and 24 only.

### 4.2 Where a bounded additive adjustment could hook without touching predictions/calibration/selection tables or logic
Candidate points (none require changing runPrediction, selectBestVariant, calibration or selection_*):
- **A (cleanest, persisted & cached): `runCoinHorizonChain` (6265-6361), between the selectBestVariant/recordSelectionProvenance block and `savePredictionSnapshot` (6350).** Compute `adjustment` from latest `sentiment_v2_results` (+ new table for audit) and attach as an extra, separately named field (e.g. `selection.adjusted_p_up` / `adjustment{...}`) to the object passed to savePredictionSnapshot. Only changes snapshot body_json; predictions/selection_decisions rows untouched.
- **B (serve-time for non-snapshot path): `GET /predict`, /eth-predict, /link-predict handlers after `selectionForServedPrediction` (10630; 10682; 11268)** - same decoration so cache-miss responses match.
- **C (read-time on snapshots): `readFreshPredictionSnapshot` (6227-6243)** - could merge a fresh adjustment into the parsed body at serve time (one extra PK/latest read) so adjustment is not frozen at tick time.
- Pure helper location: next to `getLatestSelection` (1734) or `computeMomentumBlend` (213) style (pure function, unit-testable).
Do NOT use: `applyCalibratedProbability` (241)/`computeConditionalCalibration` (336) (feed calibration_curve/predictions columns), `decideSelection`/`computeLcaScore` (selection), `fetchVariantRowsByTable` (1136) (reads only `p_up` fields of stored rows - an adjustment stored in those columns would corrupt selection eligibility/LCA).
Cache note: route cache epoch keys on MAX(prediction_snapshots.computed_ts) (12018-12027) so a snapshot-body change invalidates cached chart/calibration routes (only matters if those are changed).

## 5. Existing GLM code (OFF in prod)
| Item | Location | What it does |
|---|---|---|
| SV2_AI_PRICING | 12786-12788 | Only priced model: `@cf/zai-org/glm-4.7-flash` = 5500 Neurons/M input, 36400 Neurons/M output. Unpriced model => refused (`unpriced_model`). |
| SV2_AI_MAX_OUTPUT_TOKENS=1200, SV2_AI_TEMPLATE_TOKENS=256 | 12789, 12806 | hard output cap; input estimate = UTF-8 bytes + 256 |
| sv2AiBudget | 12794 | env.SV2_GLM_DAILY_NEURONS as number, <=0 / NaN => 0 |
| sv2AiEstimateNeurons | 12807 | ceil((inTok*5500 + 1200*36400)/1e6*100)/100 ~ 43.7 + 0.0055*bytes (a ~6 KB package ~ 78 Neurons) |
| SV2_AI_RESERVE_SQL | 12790-12792 | Atomic conditional INSERT INTO sv2_ai_neurons (day,reserved_ts,model,reserved_neurons,slot,status='reserved') SELECT ... slot = COALESCE(MAX(slot) for day,0)+1 WHERE SUM(MAX(reserved_neurons, COALESCE(actual_neurons,0))) for day + estimate <= budget. `meta.changes==0` => budget refused. Second query reads slot by rowid (13252-13257). Correlated MAX(slot) is bounded by PK(day,slot) (<=few rows/day). |
| sv2AiPackage | 12690 | builds `{decision_ts, regime, citable_ids, families{score,sources[ids]}, events[<=10], evidence[<=12 titles], stale, missing}`; ids `v1:<key>@ts`, `ev:<src>@ts`, `event:<id>`, `evidence:<id>`; returns allowedIds. Titles only, no bodies. |
| sv2RunAi | 12853-12922 | Gate order: model empty or budget 0 => `disabled`; model unpriced => `unpriced_model`; no env.AI => `unavailable`; ledger.accountLimitedToday (any status 'account_limited' today) => `quota_guard`; reserve fails/exceeds => `quota_guard`; env.AI.run(model, {system+user JSON, max_completion_tokens 1200, temperature 0, chat_template_kwargs.enable_thinking=false, response_format json_object}); error mapped to `account_limited` (3036/neurons), `rate_limited` (3040/429/capacity), `error`; empty/non-JSON/invalid => `invalid_output`; else `ok`. No retries, no fallback provider. Records tokens/actual neurons via recordNeurons UPDATE; carries trace {prompt_version 'sv2-ai-prompt-6', prompt_sha256, package_sha256}. |
| sv2ValidateAiOutput | 12727-12780 | STRICT schema, allowed keys only: `cited_ids` (non-empty, each in package ids), `contradictions` [{ids: >=2 distinct package ids}], `event_relevance` [{id event:*, relevance low\|medium\|high, overlap none\|partial\|full}], `entities` (<=20, {id evidence:*, name (whole-term substring of that title), kind asset\|organization\|regulator\|person\|instrument\|other}), `figures` (<=20, {id, value: single numeric literal grounded in the title, sv2UngroundedNumbers 12806-ish}). Extra keys (summary, score, uncertainty) => rejected. Output rebuilt from validated fields only. **No numeric score field exists in the schema.** |
| sv2GlmProbe | 13441-13478 | /api/sentiment-v2/run step `glm_probe`: builds package from 6 newest stored sv2_evidence rows, same ledger/reservation/validation. |
| Call site | 13304-13306 | after `sv2Compute`, `if (result.sentiment_score !== null)` sv2AiPackage -> sv2RunAi; the AI result is passed to `sv2Row` ONLY (12928). |
| Storage | 12928-12945; 13307-13311 | sentiment_v2_results.ai_model, ai_status, ai_json (reason, output (validated), reserved/actual neurons, tokens, prompt_version, prompt_sha256, package_sha256); plus sv2_ai_neurons ledger rows. |
| Status/health | 13582-13590 | status route reports model, priced, budget, today's calls/reserved/actual/committed/remaining; account free allocation constant 10,000. |
**Fail-closed**: prod `SENTIMENT_V2_AI_MODEL=""` and `SV2_GLM_DAILY_NEURONS="0"` (either disables; both off). Budget stop / unpriced / disabled are designed no-ops that leave the deterministic result untouched; only `error|invalid_output|unavailable|rate_limited` downgrade an `OK` result to `DEGRADED` (`ai_<status>`, sv2Row 12928-12931).
**Does anything set a score?** No. `sentiment_score` is computed deterministically in sv2Compute (12586-12660: equal-weight family mean + capped event adjustment `eventMaxAdjust` 10 (12504)) BEFORE the AI call; the AI output is annotation only and the validator forbids a score key. Nothing in the prediction path reads sentiment_v2_results.
Staging config (200 Neurons/day => ~2 calls/day at ~78 est.) is the only place the model is set.

## 6. Unbounded / heavy query patterns in hot paths
| Location | Query | Why it matters |
|---|---|---|
| 490-493 (runPrediction, every tick x2 horizons x BTC + every /predict cache miss) | `SELECT ts, btc_price, technical_score FROM btc_data ORDER BY ts ASC` | full-table scan, whole table into memory; idx_btc_data_ts exists (0028 "optional") |
| 502-505 | `SELECT ts, score, regime_mag, bottom_score FROM history ORDER BY ts ASC` | full scan of V1 table (shared with V1) every BTC run; no WHERE/LIMIT |
| 757-760 (ETH), 5685+ (LINK: link_data full + `history WHERE regime_mag IS NOT NULL ORDER BY ts ASC` full) | same pattern | per tick x 2 horizons each |
| 908-930, 931-960, 5895 (backfill*Predictions) | `SELECT ts, price FROM <price table> ORDER BY ts ASC` (full) + unresolved predictions | runs inside predictAndLog on every tick AND every uncached /predict |
| 1136-1160 fetchVariantRowsByTable | `SELECT ts, fields, realized_up FROM <pred/challenger table> WHERE [coin=] AND horizon_hours=? AND realized_up IS NOT NULL ORDER BY ts ASC` | all resolved history per variant table, per selectBestVariant (and again by EXP002/003 daily) |
| 1115 fetchEligibilityCounts | 6 correlated COUNT(*) subselects, one query | full counts on predictions/challenger tables |
| 1967 refreshCalibrationCurve, 286 refreshChallengerCalibrationCurve (daily x 6) | `SELECT p_up, realized_up FROM <table> WHERE realized_up IS NOT NULL AND horizon_hours=?` no LIMIT | daily |
| 1753-1900 getCalibration/History (+eth/link) | all resolved rows per horizon | public routes (mitigated by ROUTE_CACHE) |
| 4776-4800 getChartData/getEthChartData/getLinkChartData | FULL price table + FULL predictions per horizon | public; cached 1 h epoch |
| 3133 fetchResolvedRows (buildDailyReport, run after every 3h tick via refreshDailyReportCache) | `... FROM <table> WHERE ... ORDER BY ts ASC` no LIMIT, over 4 tables | every tick |
| 3508 backfillChallengerPredictions | `SELECT * FROM challenger_predictions WHERE resolved_ts IS NULL AND target_ts <= ?` + per-row price lookup + per-row UPDATE (N queries) | per tick x 6 |
| 1081 getLatestCalibrationCurve / 276 | correlated `computed_ts = (SELECT MAX(computed_ts) ... WHERE coin,horizon)` | now served by index from 0030 (coin,horizon_hours,computed_ts); flagged as correlated-MAX but bounded |
| 12791 SV2_AI_RESERVE_SQL | correlated MAX(slot)/SUM per day | bounded by PK(day,slot); tiny |
| 6471 getResearchLabDashboard | `btc_data WHERE ts >= (SELECT MAX(ts) FROM btc_data) - window` | bounded window, correlated MAX |
| 7040 getResearchLabStage7Overview | `MAX(id) ... GROUP BY event_id` | scans stage7_event_sentiment |
| Bounded (good): SV2 paths use LIMIT/windows (13170-13200: PRICE_CAP 20000, EVENT_CAP 2000, EVIDENCE_CAP 3000; comparison 2000/6000); sync LIMIT 100/200; collector LIMIT 100; d1 guard LIMIT 1. |
Mitigations in place: route cache (11997), tick read memo (12094; dedups identical SELECTs within a scheduled invocation), snapshots (PK serve), d1_usage_daily 'stmt' attribution (11935-11960; top 12 statements >=500 rows read per scheduled run). Migration 0030 header says the 2026-11-08 daily rows-read exhaustion drove this work.

## 7. Gaps / uncertainties
- Migrations 0001 and 0017-0020 are absent; DDL for predictions, *_predictions, challenger_*, calibration_curve*, selection_decisions*, btc_data/link_data/eth_data, stale_refresh_claim, gemini_*, analyst_relay_log, coin_catalyst_log, backtest_results, regime_split_results, daily_report_cache, foufi_digest, history, server_composite_readings is not in the repo. Columns above are inferred from INSERT/SELECT text and Python/JS test fixtures; types/indexes/constraints unknown (only idx_predictions_ts 0009, idx_btc_data_ts 0028, 0030 calibration indexes known).
- No way to verify here which secrets/vars exist in the dashboard (EVENT_DETECTION_ENABLED, tokens, D1_USAGE_*). wrangler.toml defines none of them; so event detection may be disabled in prod (then SV2 chain step 1 returns 409-style `disabled` and chain continues).
- wrangler.toml comments still describe "3h trigger"; code is the source of truth (hourly, hour%3).
- `sentiment_v2_ai_calls` (0027) appears unused; `sv2_ai_neurons` is the live ledger.
- sv2CountingDb counter sits above the memo proxy so may over-count memo hits; real Cloudflare 50-query limit is on actual subrequests.
- Deployed worker may differ from main @ e7e10f4 (deploy.yml path filters; not inspected).
- Routes served by dispatcher/ worker not audited. Frontend (CryptoPulse) field consumption of /predict body (which p_up it actually displays) not verified; only `selection.chosen_p_up/cycle_p_up` and `p_up/calibrated_*` are available in the body.
- Python/workflow writers to history/btc_data/predictions in repo are in-memory sqlite test fixtures (not production writers); real V1 writers (sentiment-ff75) are outside this repo.
