# Phase A audit — GLM evidence-intelligence mandate (2026-11-19)

**Verdict: PASS WITH LIMITATIONS.** All five input groups, the serving path, the cost baseline and the GLM eligibility
were audited read-only. Three items stay open until the owner supplies evidence or access (see §7): V1 Workers AI Neuron
use, Worker CPU (dashboard-only), and push/API access to PulseWorkerV2.

No production mutation. No code, configuration, schedule or migration was changed. No GLM inference was run.

| Item | Value |
|---|---|
| PulseWorkerV2 audited at | `main` @ `e7e10f4` (read-only public clone); handoff on `claude/handoff-glm-mandate` @ `e42cebd` |
| Deployed Worker commit | `267f1a6`, verified from `predictions.git_commit_sha` of the 4 newest rows (2026-11-19 00:01 and 03:01 UTC) |
| CryptoPulseV2 audited at | `main` @ `fa8e9b5` |
| V1 (`sentiment-ff75`, repo PulseWorker) | `fb30da1`, read-only clone, nothing changed |
| Chronos artifacts | `research-data/exp008-chronos` @ `b3d7d6f` (2026-11-19 02:48 UTC) |
| Production D1 rows read by this audit | **396** in 7 queries; every non-trivial query had `EXPLAIN QUERY PLAN` first; 0 rows written |
| Subagents | 4 code-reading subagents (no D1, no network). Their detail reports are in `A1`–`A4` next to this file |

---

## 1. Architecture and data-lineage map (actual, not assumed)

```
V1 sentiment-ff75 (PulseWorker, read-only)                 Public feeds (RSS/Atom/EDGAR)
  history.sources_json  (per-source 0-100, ts only, ≤500 rows)     │
  server_composite_readings.provenance_json (hourly)               ▼
  foufi_digest  ← Gemini-generated: EXCLUDE                 sentiment-v2/collector.js (8 sources, 7 enabled)
        │                                                     sv2_evidence / sv2_source_state / sv2_collection_runs
        ▼ syncV1ArchiveFromHistory (hourly, V2)                    │
  research_sentiment_archive (V2 copy, content_hash)               │
        └──────────────► runSentimentV2Cycle ◄─────────────────────┘
                          sentiment_v2_results (V2 only; NOT read by the prediction path)
                          sv2RunAi (GLM, annotation-only, OFF in prod) → sv2_ai_neurons ledger

btc_data / eth / link prices ─► runPrediction (k-NN) ─► predictions, *_predictions, challenger_predictions
                                 selectBestVariant ─► selection_decisions*, selection_provenance
                                 savePredictionSnapshot ─► prediction_snapshots ─► GET /predict (12h, 24h)

GitHub Actions: exp004-timesfm.yml ─► D1 experiment_4_timesfm ─► GET /research/timesfm-recent
                exp008-chronos.yml ─► branch research-data/exp008-chronos (JSON; ledger.json; no Worker route)
                pev1p-*.yml        ─► branch research-data/pev1p-candles + counts-only job summaries

CryptoPulseV2 (static index.html) ─► production Worker only; Chronos/PEV read from raw.githubusercontent.com
```

### Input groups — what actually exists

| Group | Exists | Granularity | Time fields available | Main limits |
|---|---|---|---|---|
| A. V1 sources | `history.sources_json`, `server_composite_readings.provenance_json.sources`, archive copy | Per-source **scores** (derived). No text, URL or publisher | Reading time. Per-source `observed_at` = **fetch time** for funding/longshort/onchain/headlines and **publication time** only for fng/global (verified in V1 `worker.js:1792-1852`) | No raw documents; no first-available time; no family field (V2 assigns families by hand) |
| B. Collector | `sv2_evidence` live since 2026-11-15: **243 items**, 7 sources | Title + summary, canonical URL, `content_hash`, `title_hash`, `dup_of` | `published_ts` (nullable), `retrieved_ts` | No asset tag, no per-item reliability, dedup = same title across sources within 7 days. Separate research collector (GitHub Actions, V1's 5 feeds) and `event_ledger` (EDGAR) are unlinked |
| C. Market / V2 | Prices, `predictions` (+ETH/LINK), challenger, selection, calibration, `sentiment_v2_results` | Row-level, versioned (`model_version`, `git_commit_sha`) | `ts`, `target_ts`, `resolved_ts`, realized fields | DDL for core V2 tables is not in the repo (pre-migration tables); `selection_provenance` only since 2026-11-12 |
| D. TimesFM 2.5 | D1 `experiment_4_timesfm`, BTC only, 12h/24h | **Point forecast only** (quantiles are discarded at `run_experiment.py:218`) | `ts` (created), `input_end_ts`, `target_ts = input_end_ts + h`, `resolved_ts` | Run times are 14:00–18:00 UTC, not the 07:30 cron. 2026-11-17 missing (D1 limit day); 2026-11-18 present (row 156) |
| E. Chronos-2 | JSON on a branch, 38 forecasts / 36 resolutions, BTC 12h/24h | Median plus q10/q90 (final step) | `issued_ts`, `input_end_ts`, `target_ts`, `resolved_ts`, `anchor.timesfm_*` | Origin = newest TimesFM row, so a TimesFM skip loses the pair. 30/38 files record the model revision as "main (unpinned)" (resolved sha identical) |

TimesFM ↔ Chronos join key is `(horizon_hours, input_end_ts)`, with the same price, target and resolution rule
("first `btc_data` price ≥ target_ts"). PEV-1P is a different protocol: it uses Hyperliquid hourly candle closes, its
window started 2026-11-01, and it is counts-only until the single confirmatory analysis at 2027-05-01.

---

## 2. Cost and query baseline (production, measured)

V2 Worker D1 usage (`d1_usage_daily`, V2 Worker only; V1 usage is not recorded there):

| Day (UTC) | Scheduled rows read | Fetch rows read | Largest single invocation |
|---|---|---|---|
| 2026-11-15 | 1,476,355 | 358,817 | 177,957 |
| 2026-11-16 | 1,494,049 | 285,135 | 179,865 |
| 2026-11-17 (limit day) | 372,101 | 20,065 | 180,280 |
| 2026-11-18 | 632,775 | 84,518 | 180,349 |
| 2026-11-19 (to ~06:00) | 142,345 | 29,868 | **65,291** |

- Migration 0030 lowered the largest invocation from about 180k to about 65k rows. Rows written stay small (about 2.4k/day).
- The account-wide 5M/day limit is shared with V1, V4 and research workflows. **V1 and V4 consumption is not visible**
  to this session, so free headroom can only be stated for V2.
- Pre-existing unbounded reads in the tick and uncached `/predict`: full scans of `btc_data` and V1 `history`, the
  ETH/LINK equivalents, `fetchVariantRowsByTable`, and calibration and daily-report reads. Not introduced by this
  mandate. Any GLM work must add zero reads to these paths.
- Workers AI: `sv2_ai_neurons` is empty since 2026-11-01, so GLM has never run in production.
- Worker CPU (10 ms per invocation on Workers Free): **not measurable** from this session (dashboard only).

---

## 3. GLM eligibility (mandate §3)

| Check | Result | Evidence |
|---|---|---|
| Exact model id | `@cf/zai-org/glm-4.7-flash` | `SV2_AI_PRICING` in `worker.js:12786`; staging `wrangler.staging.toml:49` |
| In current catalogue | Yes. Context 131,072 tokens, JSON `response_format`, `chat_template_kwargs`, `max_completion_tokens` | Cloudflare model page (docs search, 2026-11-19) |
| Free-plan eligible | **Yes.** Named explicitly as remaining on Workers Free | Changelog 2026-07-28 "Select models now require the Workers Paid plan" |
| Deprecation risk | **Not** on the 2026-11-20 deprecation list (which does include `glm-5.2` and `glm-5.3-flash`) | Changelog 2026-11-05 |
| Price | 5,500 / 36,400 Neurons per M in/out tokens, equal to `SV2_AI_PRICING`. About 70 Neurons per call at ~6k in / 1k out | Pricing page |
| Free allocation | 10,000 Neurons/day **account-wide**, reset 00:00 UTC. Above it on Free, calls fail (error 3036), not billed | Pricing page |
| Rate limit | 300 requests/min (text generation, non-paid models) | Limits page |
| Licence / terms | **Not verified.** The model page shows no "Terms and License" row (other models do) | Gap G-03 |
| V1 Neuron use (decision 5) | **Not measurable from code.** `sentiment-ff75` calls `@cf/meta/llama-3.1-8b-instruct-fast` at 5 sites: 2 cron-driven (technical eval 2×/day, catalysts every 15 min when an anomaly fires) and 3 user-triggered POST routes (`/whale-analysis`, `/liquidation-analysis`, `/trader-analysis`) | V1 `worker.js:114, 736, 2484, 2820, 3148` |

**Conclusion:** the model is eligible. Inference **stays disabled** under owner decision 5 until V1's real daily Neuron use
is read from the Workers AI dashboard and reserved. Rough upper bound of V1's cron share, at the `-fp8-fast` rate:
≤ about 2,200 Neurons/day worst case. The user-triggered routes are unbounded by code.

---

## 4. Serving path and where the GLM adjustment can attach

- `runPrediction` (`worker.js:487`) computes `p_up` (k-NN) and its calibrated variants. `selectBestVariant` (`1236`)
  picks among 6 variants. `/predict` serves `prediction_snapshots` (≤6h old) or recomputes on a miss.
- The frontend headline is `selection.cycle_p_up` for a non-original variant, else `p_up` (`headlineOf`, CryptoPulseV2).
  **So "the served V2 prediction" is the headline value, not always `p_up`** (decision D-1).
- Cleanest hook: `runCoinHorizonChain` (`~6265`), after selection and before `savePredictionSnapshot` (`~6350`). Read
  the GLM adjustment from its own table and add **new** response fields (baseline, adjustment, final). Never write
  into stored `p_up*` fields: `fetchVariantRowsByTable` reads them for selection and calibration, which would create
  the feedback loop the owner excluded.
- `/predict` fields the UI depends on: `ok, status, n_available, min_required, n_resolved, ts, served_from, persisted,
  p_up, calibrated_p_up, median_analog_return_pct, return_range_pct, n_analogs, trend_strength, top_analogs,
  selection{ok, chosen_variant, chosen_p_up, cycle_p_up, cleared_gate, scores[]}`. All of these must keep their meaning.

---

## 5. Existing GLM code (reusable)

`sv2AiPackage` → `sv2RunAi` → `sv2ValidateAiOutput`, with an atomic Neuron reservation (`SV2_AI_RESERVE_SQL`) and
fail-closed gates in this order: disabled → unpriced → no binding → account limited today → reservation refused.
It makes no retries and has no fallback provider. Ungrounded-number rejection is already implemented. The output
schema (`cited_ids, contradictions, event_relevance, entities, figures`) is annotation-only and rejects any score
field. It runs inside the hourly non-tick sentiment-v2 chain, not the 07:00 cron. `sentiment_v2_ai_calls` (0027)
appears unused.

---

## 6. Gap register

| ID | Gap | Severity | Owner / next step |
|---|---|---|---|
| G-01 | V1 Workers AI Neuron use unknown, so the GLM budget cannot be set | **Blocker for inference** | Owner reads the Workers AI dashboard (7–30 days) |
| G-02 | Worker CPU per invocation unknown (10 ms Free limit); a GLM step adds CPU (prompt build, validation) | **Blocker for prod enablement** | Owner reads CPU time / `exceededCpu` after the shadow deploy |
| G-03 | GLM-4.7-flash licence/terms row absent on the model page | Medium | Owner or legal check of the upstream licence before production influence |
| G-04 | **Timing conflict with decision 4:** at 07:00 UTC the newest TimesFM/Chronos 12h forecast (input cutoff ~15:00 the previous day) has already reached its target (~03:00). Only the 24h forecast is live (target ~15:00). A 07:00 GLM run has no live 12h model forecast | High | Owner decision D-2 |
| G-05 | Account-wide D1 usage (V1, V4, research) not visible; headroom known only for V2 | High | GLM adds 0 reads to hot paths and keeps its own reads ≤ a few hundred rows/day |
| G-06 | No first-available timestamp anywhere; `retrieved_ts` is the proxy (polling every 3–12 h) | Medium | Phase C: record it explicitly, mark it as a proxy |
| G-07 | V1 per-source `observed_at` has mixed meaning (fetch time vs publication time) | Medium | Phase C adapter labels it per source; never treated as publication time |
| G-08 | Collector evidence has no asset tag; only 243 items so far | Medium | Phase C asset relevance in the adapter (no collector change) |
| G-09 | No ID/URL/hash link between V1 sources and collector evidence; two RSS systems plus EDGAR in `event_ledger` are unlinked | Medium | Phase C event linking by normalized URL/title/time; report overlap, don't merge stores |
| G-10 | TimesFM stores no quantiles; Chronos only q10/q90 at the final step | Low | GLM uses what exists and states "no uncertainty supplied" for TimesFM |
| G-11 | Chronos loses an origin when TimesFM skips; 30/38 files record "main (unpinned)" | Low | Report it; pairing in the GLM adapter tolerates missing pairs |
| G-12 | Small prospective sample (about 16–19 resolved origins per horizon) | Inherent | Shadow mode (cap 0) until about 30 qualifying signals, per decision 2 |
| G-13 | **Gemini contamination paths:** V1 `foufi_digest` is Gemini-generated (V1 `worker.js:397-458`) and V2 challenger records `foufi_digest_video_id` as a driver. V2 backend still has `/gemini-analysis` routes (cron off). CryptoPulseV2 has live Gemini relay UI/copy | High (scope) | GLM input allow-list excludes `foufi_digest` and challenger driver fields. Removing the existing Gemini UI/routes is decision D-4 |
| G-14 | Pre-existing unbounded tick reads (full `btc_data`/`history` scans) | Medium, pre-existing | Out of mandate scope; flagged only |
| G-15 | No information-cutoff column on `sentiment_v2_results`; evidence links capped at 20 ids | Medium | New GLM tables carry explicit cutoffs |
| G-16 | Frontend calls production only (no staging base URL); Forecasting Lab never fetches `/predict`; Chronos read from raw GitHub | Medium | Phase E: API-base override for tests; bounded `/research/chronos-recent` or a ledger read |
| G-17 | Core V2 table DDL (`predictions`, `calibration_curve`, …) absent from migrations; migrations 0001 and 0017–0020 missing | Low | Read schema via `PRAGMA table_info` (0 rows read) in Phase B |
| G-18 | **Session access:** no push or GitHub API on PulseWorkerV2 (auto-mode classifier denied `add_repo` push); `developers.cloudflare.com` not on the network allowlist; only CryptoPulseV2 attached (handoff expects 7 repos) | **Blocker for Phases C–G backend PRs** | Owner attaches PulseWorkerV2 with push access, or allows `add_repo` |

---

## 7. Decisions needed before Phase B design is final

- **D-1: which value GLM adjusts.**
  - Recommendation: the headline value the UI shows (`cycle_p_up` for a non-original variant, else `p_up`). Expose it
    as new fields: `p_up_baseline` (= that headline), `glm_adjustment`, `p_up_final`, plus `glm_signal`.
  - The existing fields stay unchanged.
- **D-2: 12h horizon versus the 07:00 run.**
  - Option a (recommended): GLM at 07:00 emits for 24h only. 12h stays `NO_SIGNAL` (reason `no_live_model_forecast`)
    until a later-day run is approved.
  - Option b: run GLM in the existing hourly chain at a non-tick hour after the TimesFM/Chronos runs, for example 19:00
    UTC. This uses an existing cron with no new schedule, but changes where decision 4 put it.
- **D-3: Neurons.** Provide V1's measured Workers AI daily Neurons. Until then GLM inference stays off (shadow
  plumbing can still ship with inference disabled).
- **D-4: Gemini cleanup.** Removing the existing Gemini relay UI and backend routes is not GLM work. Do it as a
  separate small PR, or leave it?

## 8. What was not done

No Phase B design, no code, no PR, no deployment, no GLM call. No GitHub Actions run history or PR status for
PulseWorkerV2 (no API access). No CPU measurement. No V4 or research-workflow D1 consumption. The `dispatcher/` worker
was not audited.
