# Phase 0 closure — CryptoPulse V2 (2026-11-20)

Closes `docs/phase-0/PHASE_0_READINESS_2026-11-20.md` (commit `3428da5`) against the owner's Phase 0/Phase 1 prompt of
20 Nov 2026. Refreshed at about 10:25 UTC with read-only checks only (bounded D1 `SELECT`s, public GET routes, git, the GitHub
API). No production mutation.

**Verdict: Phase 0 CLOSED — READY WITH LIMITATIONS.** The limitations are backend push/API access (B-1) and owner-only
measurements (Cloudflare plan, Observability volume, Worker CPU, V1 Neurons). Portfolio is **no longer blocked**:
owner decision OD-06 (temporary V1-equivalent security) applies.

## 1. Evidence table

| # | Finding | Readiness-report statement | Evidence source | Current status | Confidence | Required action | Owner approval? |
|---|---|---|---|---|---|---|---|
| F1 | GitHub API | Connector authenticated as `quiquandon-oss` | `get_me`; Actions API on CryptoPulseV2 | Confirmed | High | none | No |
| F2 | Frontend repo access | Read + push | Branch `ccr-d1cb07a9-8kjw4j` pushed (`3428da5`) | Confirmed | High | none | No |
| F3 | Backend repo access | Git read only; attach for push blocked by the automatic safety check | `add_repo` (push) denied; supported path per session documentation: a session started with PulseWorkerV2 selected, or the owner allows `add_repo` | **Open blocker B-1** | High | Owner starts a session with PulseWorkerV2 attached (or adds an allow rule for `add_repo`). Not bypassed | Yes (access) |
| F4 | `gh` CLI | Token invalid | `gh auth status` | Confirmed; not needed (the GitHub connector is the supported path) | High | none | No |
| F5 | Cloudflare connector | 5 Workers, 4 D1; production D1 queryable; write-capable | `workers_list`, `d1_databases_list` | Confirmed. **SELECT only** unless a production action is authorised | High | none | No |
| F6 | Injected Cloudflare credential | Fails authentication; rate-limited | REST 10000/9109/1000 | Confirmed; **no further probing** | High | Owner may later fix or remove the stored secret | No |
| F7 | Backend deployed | `b640e3c` (#180) live since 09:24 UTC | Script `modified_on` 09:24:19; `/api/glm/status` reports #180-only flags (`mode: active`, `inference_enabled: true`) | Confirmed as **configuration** evidence. **Run-level evidence pending:** the newest `predictions.git_commit_sha` is `54792ea` (09:01 tick, pre-deploy); the 12:00 UTC tick is the first that can stamp `b640e3c` | Medium-high | Re-check after 12:00 UTC | No |
| F8 | Frontend deployed | `bef750d` (#34) | Pages run [44708025160](https://github.com/quiquandon-oss/CryptoPulseV2/actions/runs/44708025160) success; live `index.html` 347,867 B = repo | Confirmed | High | none | No |
| F9 | First GLM-influenced run | Tomorrow 07:00 UTC | `glm_runs` newest = `…_1795158000000` (2026-11-20 07:00 cutoff) `status: model_disabled`; `/api/glm/adjustments` → `[]`; `sv2_ai_neurons` empty | **Has not occurred.** No production decision has been GLM-influenced. Earliest possible: 2026-11-21 07:00 UTC run; earliest applied adjustment needs `ELIGIBLE`, i.e. 2 consecutive same-direction daily runs, so **not before 2026-11-22** | High | Verify from `glm_runs`/`glm_adjustments`, not from config | No |
| F10 | Test baseline | FE 54/54, vitest 1,634/1,634, pytest 1,120 + 2 skipped | Local runs on `bef750d` / `b640e3c`; FE CI [44708025136](https://github.com/quiquandon-oss/CryptoPulseV2/actions/runs/44708025136) | Confirmed (code unchanged since). Backend CI links **not retrievable** (B-1) | High (local) | Add backend CI links once B-1 is resolved | No |
| F11 | D1 usage figures | "0.3–0.67M/day" and "0.67–0.72M/day" | `d1_usage_daily`, kinds `scheduled` + `fetch` (`stmt` attribution rows excluded) | **Reconciled (§3)**: no conflict. 0.34M was a partial day (11-20, 00:00–10:00 UTC); 0.67M and 0.72M are full days 11-19 and 11-18 | High | Use full days only | No |
| F12 | Gemini in V1 | Narrative, Trader Analysis (Gemini), Foufi Daily | V1 `worker.js@fb30da1` lines 393–512, 2092, 3203–3376, 3377–3510; V1 UI `index.html@9a5810c` | Confirmed. Foufi operational: latest digest `9_VAprbct5Y` published 2026-11-20 07:13 UTC, `transcript_status ok`. Narrative and Trader-Gemini are user-triggered and not logged, so their live status is unverifiable without calling Gemini | High / Medium | Contract in Phase 1 §6 | No |
| F13 | V1 `X-App-Secret` | (not in report) | V1 sends it from the public page; V1 worker only lists it in CORS `Allow-Headers` and never checks it (V1 `worker.js:1392, 2118`) | V2 parity needs **no credential**; V2 will not copy that value | High | none | No |
| F14 | V1 portfolio exposure | Open `GET /txs-backup`, open `/portfolio-history`, CORS `*`, real transactions in the public repo | V1 `worker.js:2596–2730`, V1 `index.html:137–143` | Confirmed; **recorded in the deferred security register**; not a blocker (OD-06) | High | Post-production review | Deferred |
| F15 | Portfolio boundary | "Blocked, needs decision" | Owner decision 2026-11-20 | **Superseded**: proceed under V1-equivalent security | — | none | Decided |
| F16 | Comparison 55/45 | "Default applied unless you object" | Owner prompt §4.7 | **Corrected**: a *proposed comparison convention*, never production logic; sensitivity reported (Phase 1 §7) | — | Owner may confirm or change the convention | Optional |
| F17 | Account plan / Observability | "Repo comments say Workers Free" | Comments in `wrangler.toml`/`wrangler.staging.toml` only | **Unverified. Not assumed.** No authorised access to billing or analytics | — | Owner verifies on the dashboard before 1 Dec | Verification |
| F18 | TimesFM 2.5 | D1 `experiment_4_timesfm`, `/research/timesfm-recent`, 07:30 UTC workflow | Workflow file; D1 max rowid 158 | Confirmed; stays on GitHub Actions | High | none | No |
| F19 | Chronos-2 | Branch `research-data/exp008-chronos` (`ledger.json`), 21:40 UTC workflow, **no D1 table, no Worker route** | `git ls-remote` (`9ae2aad`); frontend reads `raw.githubusercontent.com/…/derived/ledger.json` | Confirmed; no API or table is invented | High | none | No |
| F20 | PEV-1P | Window from 2026-11-01, counts-only weekly (Mon 07:17) + candle archive (Mon 07:41); confirmatory analysis 2027-05-01 | Workflow files; `research-data/pev1p-candles` `a5c2868` | Confirmed frozen | High | Do not touch | Changes need approval |
| F21 | GLM-PE-1 | Frozen protocol (#175); `/api/glm/evaluation` | Commit `77c2bfb` | Confirmed frozen | High | Do not touch | Changes need approval |
| F22 | Research / Learning APIs | `/api/research-lab/*` (17 routes), `/api/learning/*` (12), `/research/*` (5) | `worker.js@b640e3c` route scan | Confirmed | High | Reuse | No |

## 2. Deployed versions (actual)

| Component | Commit | Evidence | Run metadata |
|---|---|---|---|
| `pulseworker-v2` | `b640e3c` (#180) | config fingerprint via `/api/glm/status`; script modified 2026-11-20 09:24:19 UTC | last stamped prediction tick 09:01:14 UTC = `54792ea` (#179); next tick 12:00 UTC |
| CryptoPulseV2 (Pages) | `bef750d` (#34) | Pages run 44708025160, 09:07:53 UTC | Test run 44708025136 success |
| `sentiment-ff75` (V1) | `fb30da1` | script modified 2026-11-16 19:13 UTC = merge time of PulseWorker #7 | V1 `history` newest row 2026-11-20 09:02 UTC |
| GLM | `glm-input-3 / glm-prompt-3 / glm-signal-2 / glm-qual-0.4`, model `@cf/zai-org/glm-4.7-flash` | `/api/glm/status` | 2 runs, 4 signals, **0 adjustments, 0 Neurons** |
| Sentiment V2 | `sv2-1.1.0` | `sentiment_v2_results` newest decision 2026-11-20 08:00 UTC | 62 rows |

## 3. Resource baseline (best available)

| Resource | Baseline | Source and meaning | Status |
|---|---|---|---|
| D1 rows read: **V2 Worker** | **≈0.67–0.72M/day** (11-19: 666k; 11-18: 717k). Partial 11-20 to 10:00 UTC: 336k | `d1_usage_daily`, `scheduled` + `fetch`, full UTC days; V2 Worker invocations only. Before migration 0030 (11-13 to 11-16): 1.7–2.1M/day | Verified |
| D1 rows written: V2 Worker | ≈2.2–2.4k/day | same | Verified |
| D1: account-wide | Limit 5M reads / 100k writes per day (Workers Free figures; plan unverified). V1 (`sentiment-ff75`), `cryptopulse-v4`, `photoduel-db` and GitHub-Actions writers are **not measured** | — | **Unverified** |
| D1 storage | `sentiment-history` 30.2 MB; staging 0.7 MB; `cryptopulse-v4` 5.1 MB | `d1_databases_list` | Verified |
| Worker CPU / wall time | Not measurable (dashboard/GraphQL only) | — | **Unverified** (owner-accepted for GLM 2026-11-20) |
| Workers AI | GLM: 0 Neurons used; cap 300/day. V1 Llama use unmeasured | `sv2_ai_neurons`, `/api/glm/status` | Partly verified |
| Cron Triggers | 5 of 5 used (V1 3, V2 2) | `wrangler.toml` of both repos | Verified (config) |
| GitHub Actions | Public repos, so standard runners carry no charge; minutes not measured | repo visibility | Cost verified; usage unmeasured |
| Observability | `pulseworker-v2`: logs on, `head_sampling_rate = 1`, invocation logs on, traces off. Code: 14 `console.log` (10 JSON payloads), 43 `error/warn`. Ingestion and retention not measurable | `wrangler.toml@b640e3c` | **Volume and plan unverified** |

### 3.1 No-cost logging recommendation (for the first backend batch, not yet applied)

Business records and audit trails (`glm_runs`, `glm_signals`, `glm_adjustments`, `predictions`, `selection_provenance`,
`d1_usage_daily`, `sv2_collection_runs`) live in **D1, not in logs**. Logs are diagnostic only, so reducing them removes no
audit evidence. Proposed changes, each a reversible `wrangler.toml` or code change:

1. Keep `[observability.logs] enabled = true, persist = true` (incident diagnosis).
2. Set `invocation_logs = false` (per-request metadata is the dominant volume for public GET traffic).
3. Set `head_sampling_rate = 0.1` for fetch traffic. Scheduled runs log through explicit `console.error/warn` and a single
   bounded summary line each.
4. Truncate any logged payload to ≤ 512 bytes; never log evidence text, prompts, model output or portfolio data. Use IDs,
   hashes and reason codes.
5. Keep traces disabled. Enable no new datasets.
6. App behaviour never depends on logs, so an ingestion pause degrades diagnosis only.

**Outstanding owner verification:** the account plan (Workers Free vs Paid), whether an Observability Paid subscription exists,
and the current daily ingestion (dashboard → Workers & Pages → Observability). Until verified, treat the account as
*unknown*: change nothing that raises volume.

## 4. Remaining access blockers

- **B-1 (backend):** no push and no GitHub API on PulseWorkerV2, so no backend PRs, backend CI links or deploy approvals from this
  session. Blocked tasks: Comparison API, Observability config, Portfolio server backup (optional), any new read endpoint.
  Backend work in this session is limited to **reading code and preparing patches**; it is never reported as implemented.
- **B-2 (Cloudflare analytics):** plan, Observability, CPU and V1 Neurons need the owner's dashboard.

## 5. Owner decisions recorded

See `docs/governance/OWNER_DECISIONS.md` (OD-01 … OD-12), including the temporary V1-equivalent security acceptance (OD-06)
and the deferred post-production security review (OD-07, `docs/security/POST_PRODUCTION_SECURITY_REVIEW.md`).

## 6. Remaining risks

| Risk | Note |
|---|---|
| GLM first live run untested in production | Observe 2026-11-21 07:00 run and the 09:00 tick before any UI claims "influenced" |
| Backend blocked (B-1) | Frontend proceeds; backend items listed in the roadmap as BLOCKED |
| Account-wide D1 headroom unknown | All new reads bounded and cached; none added to tick paths |
| Observability plan unknown before 1 Dec | Recommendation ready; needs B-1 to ship |
| V1 portfolio exposure | Pre-existing, accepted temporarily, in the security register |
| Single 348 KB `index.html` | Additive edits with unit tests and browser smoke tests |
