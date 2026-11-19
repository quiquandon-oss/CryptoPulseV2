# A3: Forecast challengers (TimesFM, Chronos-2) and PEV-1P audit (read-only)
Repo: /home/user/quiquandon-oss/pulseworkerv2 @ e7e10f4. Chronos data: /home/user/pw2-chronos (b3d7d6f, single shallow commit 2026-11-19 02:48Z). PEV-1P candles: origin/research-data/pev1p-candles (a5c2868). Paths below are repo-relative.

## 1. TimesFM 2.5 (EXP-004)
| Item | Finding | Ref |
|---|---|---|
| Schedule | cron `30 7 * * *` daily plus workflow_dispatch. Needs `CLOUDFLARE_API_TOKEN` (reads and writes prod D1 via wrangler) | .github/workflows/exp004-timesfm.yml:22-25,60 |
| Observed run times | Not 07:30. Latest TimesFM rows (anchor `timesfm_ts`) land 14:17-17:44Z (e.g. 2026-11-18 16:39:57Z). The nominal cron and the real run times disagree (delayed schedule or manual dispatch; cannot tell locally) | ledger.json `timesfm_ts` |
| Model | `google/timesfm-2.5-200m-pytorch`, MODEL_VERSION `timesfm-2.5-200m`, pip `timesfm[torch]==3.0.2`, torch 2.15.0 CPU | exp004-timesfm/run_experiment.py:51-53; workflow:50-56 |
| Series | BTC only. `btc_data(ts, btc_price)` from prod D1, full history, sorted, deduped (60 s tolerance, keep first of cluster) | run_experiment.py:46,106-160 |
| Context | last 128 deduped ticks (`CONTEXT_LENGTH`), univariate, no covariates. Cadence = median delta of last 60 ticks (~3 h), so horizon_steps = round(h*3600000/step_ms) = 4 (12h) and 8 (24h) | :54-79,171-188,217 |
| Cutoff | `input_end_ts` = ts of the last tick fed to the model. `ts` = wall clock when the row was made. `target_ts = input_end_ts + h*3600000` (not now+h) | :212,235 |
| Horizons | 12 and 24 h, one row per horizon per run | :50,216 |
| Forecast | Point only: `forecast_price` = last step of the point forecast. `use_continuous_quantile_head=False`, and the quantile output is discarded (`point_forecast, _`). **No quantiles or uncertainty stored.** | :197-205,218-219 |
| Derived | `predicted_return_pct = (forecast_price - price_at_prediction)/price_at_prediction*100`. `direction = UP if >0 else DOWN`. No probability | :222-223 |
| D1 table | `experiment_4_timesfm`: id, coin, horizon_hours, ts, target_ts, input_end_ts, price_at_prediction, forecast_price, predicted_return_pct, direction, model_version, checkpoint, inference_backend, context_length, forecast_horizon_steps, features_used, production_chosen_variant (from `selection_decisions`, read only), then at resolution actual_return_pct, actual_direction, correct, absolute_error, signed_error, resolved_ts | .ai/migrations/0002, 0003 (adds forecast_horizon_steps), 0004 (deletes early rows: ids 1,2 and unresolved) |
| Resolution | Same script, after forecasting. `SELECT btc_price FROM btc_data WHERE ts >= target_ts AND typeof(ts) IN ('integer','real') AND btc_price IS NOT NULL ORDER BY ts ASC LIMIT 1`. `actual_return_pct = (actual - price_at_prediction)/price_at_prediction*100`. `actual_direction = UP if >0`. `correct = direction == actual_direction`. Resolution price ts is NOT stored in D1 (Chronos stores `resolution_price_ts`) | :254-306 |
| Failure | Forecast failure: exit 1 and write nothing. Resolve failure: exit 1 | :309-320 |
| API | `GET /research/timesfm-recent?horizon=12\|24&limit=` (default 20, max 500). Returns `{summary:{total,resolved,unresolved}, forecasts:[SELECT * rows]}`, ordered ts DESC. Also `computeExperiment4TimesFmLiveFields` (per-horizon counts, correct/resolved) for the registry | worker.js:4698-4720,11008-11018,7337-7380 |
| Pinned? | Yes, versions pinned 2026-11-14 | workflow:50 |

## 2. Chronos-2 (EXP-008)
| Item | Finding | Ref |
|---|---|---|
| Triggers | `workflow_run` after EXP-004 completes, plus cron `40 21 * * *` and dispatch. Concurrency group `exp008-chronos`. Pushes only to branch `research-data/exp008-chronos`, only under `exp008_chronos/` | .github/workflows/exp008-chronos.yml:15-21,26,121-125 |
| Model | `amazon/chronos-2` via `chronos-forecasting==2.3.2`, CPU. Revision pinned via `CHRONOS_REVISION=29ec3766d36d6f73f0696f85560a422f50e8498c` (env set 2026-11-14ish). Earlier files say `model_revision: "main (unpinned)"` but `model_revision_resolved` is the same sha | workflow:32; run_experiment.py:42-44,137-161 |
| Origin | Not self-chosen. Reads newest `experiment_4_timesfm` row per horizon (read-only) and forecasts from its `input_end_ts`. Refuses if the last context point differs from TimesFM `price_at_prediction`. Skips origins older than 48 h (no backfill). Only the NEWEST TimesFM row per horizon is seen, so a missed run drops that origin | run_experiment.py:102-106,222-256 |
| Inputs | `btc_data` with `ts <= input_end_ts`, same dedupe, 128-point context, cadence rule as TimesFM. Univariate | :92-99,253-255 |
| Horizons | 12, 24 h (4 and 8 steps) | :41,255 |
| Quantiles | YES: levels [0.1, 0.5, 0.9]. Point forecast = median (q50). Stored as `forecast_q10`, `forecast_median`, `forecast_q90` (final step only) | :48,174-185 |
| Resolution | Same frozen rule: first `btc_data` price with `ts >= target_ts`. One resolution file per forecast, immutable | :190-219 |
| Failure | Run record lists `errors`. The 2026-11-17T17:01Z run failed on `wrangler d1 execute` (CalledProcessError, both anchor read and resolve) and was not retried until the next run | runs/2026-11-17T170128Z.json |

### Store layout (branch research-data/exp008-chronos)
```
exp008_chronos/forecasts/BTC/{12h|24h}/<YYYY-MM-DDTHHMMSSZ of input_end_ts>.json
exp008_chronos/resolutions/BTC/{12h|24h}/<same name>.json
exp008_chronos/runs/<YYYY-MM-DDTHHMMSSZ of run_ts>.json     (41 files)
exp008_chronos/derived/ledger.json                           (rebuilt every run, format exp008-chronos-ledger-v1)
```
Files are written with `open(...,"xb")`, so they are immutable and never overwritten (run_experiment.py:123-132). JSON is `indent=1, sort_keys=True`.

### Forecast file schema (`format: "exp008-chronos-store-v1"`; example 12h 2026-11-02T150100Z)
| Field | Type | Example |
|---|---|---|
| format | str | "exp008-chronos-store-v1" |
| id | str | "BTC_12h_2026-11-02T150100Z" |
| coin | str | "BTC" |
| horizon_hours | int | 12 |
| issued_ts | int ms | 1793640202940 |
| input_end_ts | int ms (origin) | 1793631660301 |
| target_ts | int ms (= input_end_ts + h*3600000) | 1793674860301 |
| price_at_prediction | float | 77878.0 |
| forecast_median | float | 78173.625 |
| forecast_q10 | float | 77624.109375 |
| forecast_q90 | float | 78776.984375 |
| predicted_return_pct | float | 0.3796001438146845 |
| direction | "UP"/"DOWN" | "UP" |
| last_tick_return_pct | float | 0.014897311292169434 |
| persistence_direction | "UP"/"DOWN" | "UP" |
| persistence_rule | str | "last deduplicated tick (...)" |
| model_id / model_version | str | "amazon/chronos-2" / "chronos-2" |
| model_revision | str | "main (unpinned)" or a sha |
| model_revision_resolved | str\|null | "29ec3766d36d6f73f0696f85560a422f50e8498c" (null in 2 files) |
| inference_backend | str | "torch-cpu" |
| runtime | {chronos,torch,transformers: str} | {"chronos":"2.3.2","torch":"2.15.0+cpu","transformers":"5.22.1"} |
| quantile_levels | [float] | [0.1,0.5,0.9] |
| context_length | int | 128 |
| forecast_horizon_steps | int | 4 |
| step_ms | int | 10800731 |
| context_sha256 | str | "ab35b997..." |
| features_used | str | "univariate: btc_price only, no covariates" |
| anchor | {source:"experiment_4_timesfm", timesfm_ts:int, timesfm_target_ts:int} | timesfm_target_ts == own target_ts in all 19 pairs checked |
| code_sha | str\|null | "ce0e701d..." |

### Resolution file schema
format, id, horizon_hours (int), input_end_ts, target_ts, resolution_price_ts (int ms, actual btc_data ts used), actual_price (float), actual_return_pct, actual_direction, correct (0/1), persistence_correct (0/1/null), absolute_error, signed_error (predicted - actual, pct points), resolved_ts. Example: actual_price 76652.0, actual_return_pct -1.574, correct 0, persistence_correct 0, resolution_price_ts 1793674864793.

### ledger.json (`exp008-chronos-ledger-v1`)
Top-level: format, derived, generated_ts, source, seal_end_ts (1791579600000 = 2026-10-09T21:00Z), prospective_start_ts (1793491200000 = 2026-11-01T00:00Z), excluded_sealed (0), skipped ([]), recent_runs (last 20), forecasts[]. Each row copies forecast fields (no persistence_rule, runtime, features_used, step_ms, anchor) and adds `timesfm_ts`, `forecast_file`, `population` ("prospective" if input_end_ts >= 2026-11-01 else "post_seal_descriptive"), `status` (resolved/pending), and the resolution fields (actual_price, actual_return_pct, actual_direction, correct, persistence_correct, absolute_error, signed_error, resolution_price_ts, resolved_ts, resolution_file). Source: exp008-chronos/build_ledger.py:25-37,46-84.

### Counts and range (local files)
| Item | Value |
|---|---|
| Forecast files | 38 (19 per horizon), origins 2026-10-30T12:00Z to 2026-11-18T15:01Z |
| Resolution files | 36 (18 per horizon), latest resolved_ts 2026-11-18T03:07:56Z |
| Ledger populations | prospective resolved 16+16, prospective pending 1+1, post_seal_descriptive resolved 2+2 (pilot 10-30, 10-31) |
| Missing origin days | 2026-11-08 and 2026-11-17 (11-08 has a btc_data gap 11-08 00:01 to 11-09 00:01; 11-17 coincides with the failed wrangler run). Extra origins 11-15 12:00 and 18:00 |
| Origin time of day | 12:00, 15:00 or 18:00Z ticks (varies by when TimesFM ran) |
| Quantiles | yes (q10/q50/q90, final step only) |
| Worker-readable path | Yes. worker.js already reads data branches with `fetch('https://raw.githubusercontent.com/quiquandon-oss/PulseWorkerV2/<path>', {cf:{cacheTtl:1800}})` (worker.js:7709-7714, used for exp23). Stable URL: `https://raw.githubusercontent.com/quiquandon-oss/PulseWorkerV2/research-data/exp008-chronos/exp008_chronos/derived/ledger.json` (single request, all 38 rows). Per-file: `.../exp008_chronos/forecasts/BTC/12h/<stamp>.json`. Not fetched here. |

## 3. TimesFM vs Chronos-2 comparability
Same asset (BTC), horizons (12, 24), context rule, cadence rule, `input_end_ts`, `target_ts`, `price_at_prediction`, and resolution rule (Chronos is built to reproduce TimesFM's). Join key: (horizon_hours, input_end_ts). Chronos `anchor.timesfm_target_ts` equals its own `target_ts` in all 19 pairs checked, and `anchor.timesfm_ts` equals the TimesFM row `ts` (ledger: `timesfm_ts`).
| Concept | TimesFM (D1 experiment_4_timesfm) | Chronos-2 (JSON) |
|---|---|---|
| forecast creation time | ts | issued_ts |
| input cutoff / origin | input_end_ts | input_end_ts |
| target time | target_ts | target_ts |
| price at origin | price_at_prediction | price_at_prediction |
| point forecast (price) | forecast_price | forecast_median |
| predicted return % | predicted_return_pct | predicted_return_pct |
| direction | direction | direction |
| quantiles | none | forecast_q10, forecast_q90 (q50 = median) |
| steps | forecast_horizon_steps | forecast_horizon_steps (+ step_ms) |
| model id | checkpoint / model_version | model_id / model_version (+ model_revision_resolved) |
| resolved actuals | actual_return_pct, actual_direction, correct, absolute_error, signed_error, resolved_ts | same names, plus actual_price, resolution_price_ts, persistence_correct |
| persistence baseline | not stored (taken from the Chronos file at the same origin, per plan) | persistence_direction, last_tick_return_pct |
| production k-NN reference | production_chosen_variant (name only) | none (matched from `predictions`, window [-3h,+10min]) |
Caveats: (a) Chronos exists only for origins where TimesFM produced the newest row and Chronos then ran. (b) TimesFM D1 rows are only readable by D1/API (`/research/timesfm-recent`, limit <= 500), not through git. (c) Chronos has the earlier pilot with unpinned revision. (d) Resolution price is picked by the "first ts >= target_ts" rule. The tick for the target can be written a few seconds BEFORE target_ts, so the rule then skips to the next tick about 3 h later (research/plans/2026-11-17-resolution-slot-amendment-PROPOSED.md; sensitivity file 2026-11-17-resolution-sensitivity.md: 9 of 15 12h observations differ). Both models share this effect.

## 4. PEV-1P
| Item | Finding | Ref |
|---|---|---|
| Nature | Offline re-run of the PEV-1 models on an unseen window. Registers nothing, changes no production | research/plans/2026-11-02-pev1p-protocol.md:3-8,54-57 |
| Prices | Hyperliquid hourly candles, NOT D1 `btc_data` | protocol:22 |
| Sentiment | V1 composite archive `/api/research-lab/experiment5-sentiment` | protocol:23-24 |
| Models | A, B, C, P4-LR (logistic, lambda=10), P4-KNN-SHRINK (m=30); baselines always-up, always-down, climatology, persistence. 3 coins x 2 horizons (12, 24) x 5 models | protocol:26-31,51-52; research/prospective_pev.py:35-64 |

Quoted frozen rules:
- "**Test window:** decision times from **2026-11-01T00:00Z**. Units are the PEV-1 non-overlapping units: 00:00 UTC for 24 h; 00:00 and 12:00 UTC for 12 h. A unit counts once its label time has passed." (protocol:14-15)
- "**Hyperparameters frozen** to PEV-1's VAL choices ... **P4-LR λ = 10**, **P4-KNN-SHRINK m = 30**." (protocol:29-30)
- "**PREDICTIVE IMPROVEMENT DEMONSTRATED,** for a model, coin and horizon, requires: the paired CI for balanced accuracy versus the best naive baseline to be entirely above 0; **and** the paired CI for Brier versus climatology to be entirely below 0." (protocol:35-37)
- "**NOT EVALUABLE** below 20 eligible units." (protocol:38)
- "**One confirmatory analysis, at 2027-05-01T00:00Z.** About 181 daily units at 24 h and 362 at 12 h per coin" (protocol:42-43). `final` mode refuses before that time.
- "**Before the checkpoint,** only `counts` mode runs: units elapsed, resolved, with features, with as-of sentiment, and eligible for all models; no label value, metric or prediction is computed or reported; a test checks that the counts are identical when every outcome in the window is reversed." (protocol:47-50)
- Multiplicity: reported uncorrected; a single passing cell is weak evidence (protocol:51-52). "Changes after this commit: only by a new versioned protocol committed before the checkpoint" (protocol:7).

Constants: TEST_START_TS 1793491200000 (2026-11-01T00:00Z), CHECKPOINT_TS 1809129600000 (2027-05-01T00:00Z) (research/pev1p_window.py:38-39). Guard raises `PrematurePEV1PEvaluation` on any window label, prediction, or final run before the wall-clock checkpoint (pev1p_window.py:96-163).

**Resolution rule correction:** "first btc_data price >= target_ts" is the EXP-004/EXP-008 rule (plans doc:14-15), NOT PEV-1P. PEV-1P labels use hourly candle closes at ts+h (`resolved = u["ts"] + h*H in closes`, prospective_pev.py:66-82). No `btc_data` is involved.

| Workflow | Schedule and effect | Output |
|---|---|---|
| pev1p-counts.yml | Mon 07:17Z. Fetches public Hyperliquid candles and the sentiment archive over the network; counts only | Job summary table plus artifact `pev1p-counts.json` (90 days retention). Not committed to any branch (no persistent record in git) |
| pev1p-candle-archive.yml | Mon 07:41Z. Appends closed post-seal candles | Branch research-data/pev1p-candles |

Candle branch (7 files): `candles_post_seal/{BTC,ETH,LINK}/observations.jsonl` (908 lines each; first open_ts 1791579600000 = 2026-10-09T21:00Z, last open_ts 1794844800000 = 2026-11-16T16:00Z; the 3 run manifests have requested_to 1793614489121, 1794246465507, 1794849927666), `runs/run-*.json` (3 manifests: appended 565, 175, 168; gaps 0; revisions 0). Record fields: record_id, asset, open_ts, close_ts, available_at, o, h, l, c, v, n (prices as strings), retrieved_at, source "hyperliquid", collector_version. Raw prices only; no labels, predictions or metrics stored. Latest branch commit a5c2868 on 2026-11-16 17:25Z. Next run is expected Monday 2026-11-23.
What is evaluated: nothing outcome-bearing until 2027-05-01. Counts (units elapsed / resolved / with price features / with as-of sentiment / eligible for all models, per coin and horizon) are the only output now.

## 5. V2 outcome resolution and evaluation records
| Source | Resolution columns and mechanism | Usable for prospective model-vs-baseline |
|---|---|---|
| `predictions` (BTC), `eth_predictions`, `link_predictions` | `realized_btc_price` (or eth/link), `realized_return`, `realized_up`, `resolved_ts`, set by `UPDATE ... WHERE id=?` for rows with `realized_up IS NULL AND target_ts <= now` (worker.js:913-922, 936-945). Row also holds ts, target_ts, price_at_prediction, p_up, p_up_experimental, calibrated_p_up, calibrated_conditional_p_up (BTC), model_version, git_commit_sha, n_analogs, k_used, is_regime_anomaly, trend_strength | Yes: probability plus a binary outcome, so Brier and accuracy can be computed. `p_up >= 0.5` is the call |
| `challenger_predictions` | coin, ts, target_ts, horizon_hours, price_at_prediction, p_up_flat, p_up_tilted, calibrated_p_up_flat, p_up_momentum, realized_price, realized_return, realized_up, resolved_ts (data-exports header) | Yes |
| `selection_decisions` + `selection_provenance` | chosen_variant, chosen_p_up, prediction_ts, scores_json; provenance (from 2026-11-12) gives `chosen_p_up_source_ts` / `cycle_p_up` | The served probability is the chosen variant's p_up on its LATEST RESOLVED prediction, not the current cycle (sel-v1 semantics). Match via provenance for rows from 2026-11-12 only |
| Calibration routes | `/calibration`, `/eth-calibration`, `/challenger-calibration`, `/variant-calibration`, `/calibration-history`, `/calibration-curve`, etc. (worker.js:10734-11300). Brier, accuracy, always-base-rate Brier are computed on the fly (worker.js:1755-1780, 1862-1936) | Descriptive only, in-sample over all resolved rows |
| data-exports CSVs | Daily 08:00Z export. STATUS.md says last export 2026-11-18T16:46Z, latest prediction ts 2026-11-18T15:01Z. btc_predictions.csv 1783 rows; btc_data.csv 3126 rows | Local copy of all of the above, no D1 needed |
| learning/ | Documentation and UI/API code (learning-api.js, learning-core.js, HANDOFF, LEAKAGE_AUDIT); results/ and experiments/ hold only TEMPLATE.md. No outcome records here | No |
| Challenger-style D1 records for TimesFM | see section 1: correct, absolute_error, signed_error, actual_*, resolved_ts | Direction only |

Fields that would allow a prospective GLM-vs-baseline comparison:
- Candidate (GLM) must be logged at decision time with: coin, horizon, decision `ts`, `target_ts`, `price_at_prediction`, a probability (`p_up_glm`), model/code version, and feature snapshot or hash. Nothing named GLM exists in this repo (only the PEV-1P P4-LR logistic regression in research/prediction_eval.py:247-304, offline and sealed until 2027-05-01).
- Baselines available with the same keys: k-NN `p_up` (+ variants) in `predictions`/`challenger_predictions` (resolved `realized_up`, `realized_return`); always-UP and climatology (derivable); last-tick persistence (`persistence_direction` in Chronos files only; reconstructable from `btc_data`).
- Join: (coin, horizon_hours, ts or input_end_ts). Production k-NN matching rule used by the plans: nearest prediction within [-3 h, +10 min] of the origin (plans doc:37; EVALUATION_PLAN:12).
- Metrics supported: hit rate with exact McNemar (frozen plans), Brier (needs probabilities, which TimesFM and Chronos lack but k-NN and P4-LR have).

## 6. Did the latest runs succeed? (local evidence only)
| Run | Evidence | Verdict |
|---|---|---|
| TimesFM latest | Chronos 2026-11-18 forecasts anchor to `timesfm_ts` 2026-11-18T16:39:57Z (12h). Chronos only forecasts when the TimesFM row exists and its tail matches. A Chronos run was triggered via `workflow_run` at 16:41 | TimesFM wrote a row for origin 2026-11-18 15:01Z. Succeeded. Whether it also resolved rows cannot be read locally (D1 only). No TimesFM run evidence after 11-18 16:40 (as of 11-19 02:48). Not determinable beyond that. The 2026-11-17 origin has no Chronos pair. TimesFM may have run on 11-17 (D1 not checked) |
| Chronos latest | runs/2026-11-19T024813Z.json: errors [], resolved 0, pending 2, notes "origin 2026-11-18T150100Z already forecast". 2026-11-18T164128Z: made 2 forecasts, errors [] | Succeeded (no new work needed). One failed run: 2026-11-17T170128Z (wrangler D1 error), self-recovered |
| Resolutions | 2 forecasts pending (origin 11-18 15:01; 12h target 11-19 03:01, 24h 11-19 15:01). The last 11-19 02:48 run was before the 12h target (so legitimately pending) | Fine |
| btc_data feed | data-exports latest btc_data ts 2026-11-18T15:01:01Z (export 16:46Z) | Fresh as of export |
| PEV-1P candles | last archive run 2026-11-16 17:25Z (weekly, next 11-23) | OK, no evidence of failure |
| PEV-1P counts | Output is an artifact only, nothing in git | Undeterminable locally |

## Gap list
1. TimesFM stores no quantiles or uncertainty and discards them at run_experiment.py:218; there is no probability for Brier or calibration, only direction and a return.
2. TimesFM D1 rows are not in data-exports or git, so the TimesFM side of any join needs D1 or `/research/timesfm-recent` (limit 500). TimesFM `resolution_price_ts` is not stored.
3. TimesFM's workflow cron (07:30Z) does not match observed run times (14-18Z); schedule slippage or dispatch is unexplained. Origins drift between 12:00, 15:00 and 18:00Z.
4. Chronos reads only the newest TimesFM row per horizon: any skipped or double TimesFM run loses a pair (2026-11-17 and 2026-11-08 missing). Wrangler errors are not retried within the run.
5. Frozen resolution rule skips ticks written milliseconds early (slot issue); amendment is PROPOSED, not adopted. Both models are scored under frozen-v1; no slot-v2 records are stored yet.
6. Chronos model revision was "main (unpinned)" for the first 30 forecast files (pinned from 2026-11-14/15, 8 files); 2 files lack `model_revision_resolved`. Treat the pilot and early rows as slightly non-identical model snapshots (resolved sha was the same in 36 of 36 files that have one).
7. Only 16 prospective resolved origins per horizon (plan checkpoint 100), so no inferential comparison is possible until about the end of Feb 2027.
8. No GLM exists in the repo. The closest is PEV-1P P4-LR, which is offline, sealed, uses Hyperliquid candles rather than `btc_data`, and the protocol forbids any outcome or prediction before 2027-05-01. A prospective GLM comparison needs its own pre-registered logging (probability, ts, target_ts, version) on the same keys.
9. PEV-1P counts are not persisted anywhere except a 90-day Actions artifact.
10. Production k-NN match window [-3h,+10min] and the 3-hourly tick structure mean a k-NN prediction is not at an identical timestamp to the forecast origin, so the "paired" comparison is approximate.
