# Handoff: backend session for CryptoPulse V2 (2026-11-20)

## 1. Session setup (owner)

Start a new Claude Code session in the **Oliver4Green** environment with these repositories selected:

| Repository | Access needed | Why |
|---|---|---|
| `quiquandon-oss/PulseWorkerV2` | **push** (attached at start) | Backend work: Observability change, Comparison API, backend CI links, PRs through the `production` gate |
| `quiquandon-oss/CryptoPulseV2` | push | Docs (this file, roadmap), Comparison UI after the API exists |

Not needed as attached repos: `quiquandon-oss/PulseWorker` and `quiquandon-oss/CryptoPulse` (V1). They are public and are only ever **read** (`git clone --depth 1`); V1 is immutable (OD-01).

## 2. Read first (in CryptoPulseV2)

1. The controlling plan: *CryptoPulseV2 Full Implementation Plan for Claude v2* (owner attaches it again, or see the summary in the docs below).
2. `docs/governance/OWNER_DECISIONS.md` (OD-01…OD-12). Do not reopen these.
3. `docs/phase-0/PHASE_0_CLOSURE_2026-11-20.md`: verified baseline, resource figures, logging recommendation (§3.1).
4. `docs/architecture/PHASE_1_ARCHITECTURE_CONTRACTS.md`: especially §4 (API), §7 (Comparison), §10 (budgets), §11 (release).
5. `docs/implementation/IMPLEMENTATION_ROADMAP.md`: status and order.
6. `docs/security/POST_PRODUCTION_SECURITY_REVIEW.md`: deferred; not a blocker.

## 3. Verified state at handoff

| Item | Value |
|---|---|
| Backend `main` / deployed | `b640e3c` (#180), deployed 2026-11-20 09:24 UTC (config evidence). **To confirm:** `predictions.git_commit_sha` of the 12:00 UTC tick onward should be `b640e3c` (09:01 rows still `54792ea`) |
| Frontend `main` / deployed | `14f72ab` (#35), Pages run 44722137466, live page byte-identical, live smoke 51/51 |
| GLM | Contract `glm-input-3 / glm-prompt-3 / glm-signal-2 / glm-qual-0.4`, cap 0.03, no-flip, 3 kill switches. **No GLM-influenced decision yet.** First live inference: 2026-11-21 07:00 UTC; first possible applied adjustment ≥ 2026-11-22. Verify from `glm_runs` / `glm_adjustments`, never from config |
| Tests (local, at `b640e3c`) | vitest 1,634/1,634 (72 files); pytest 1,120 passed, 2 skipped (`exp004-timesfm/ exp008-chronos/ research/ ops/`). Frontend 61/61 |
| D1 (V2 Worker, `d1_usage_daily`, scheduled + fetch) | ≈0.67–0.72M rows read/day; ≈2.2–2.4k written/day. Account-wide unknown |
| Cron Triggers | 5/5 used (V1 3, V2 2). **Add none** |

## 4. Backend tasks, in order

### B1. Observability volume reduction (deadline: before 2026-12-01)
- Change `wrangler.toml` `[observability.logs]` to `invocation_logs = false` and `head_sampling_rate = 0.1`; keep `enabled = true`, `persist = true`, traces off.
- Cap logged payloads at ≤ 512 bytes; never log evidence text, prompts, model output or portfolio data (14 `console.log` calls, 10 of them JSON).
- Audit records stay in D1 (unchanged). Update the config snapshot test (`tests/sv2-production-config.test.js`).
- The owner still has to verify the account plan and ingestion on the dashboard; record what they report. Do not change plans, subscriptions or datasets.

### B2. Read-only Comparison API (contract §7)
- `GET /api/comparison/v1-v2?asset=BTC&horizon=24&period=24h|7d|30d|all&limit<=500` and `GET /api/comparison/v1-v2/summary`.
- V1 = `server_composite_readings` (fallback `history`), latest reading ≤ decision_ts and ≤ 3 h old, else missing. V2 baseline = the served headline (`headlineOf` semantics). V2 final = `glm_adjustments.final`, else baseline with reason `glm_out_of_scope` / `no_adjustment`. Outcome = the existing resolution rule, used only after `resolved_ts`.
- Metrics: n, coverage, no-call rate, agreement, accuracy with Wilson 95% CI, Brier for V2 only. V1 bands 50/50, 45/55 (proposed, OD-12), 40/60. Below 30 resolved pairs: `insufficient_sample`.
- Bounds: indexed newest-first reads, ≤ 3 queries, ≤ 5k rows per uncached request, Cache API 5 min, `truncated` flag; 0 reads added to tick/cron paths. Run `EXPLAIN QUERY PLAN` on staging.
- Tests: bounds, alignment, no look-ahead, missing V1, out-of-scope GLM, read-only proof (recording fake DB / static no-write check).

### B3. Record backend CI links for the baseline in the Phase 0 closure (ci-tests.yml / test.yml runs for `b640e3c`).

Then frontend: Comparison UI on B2 (roadmap #6). Other frontend stages (Forecast details, Research/Learning, V1 view + Foufi, Gemini parity, Portfolio, Alerts/Settings) do not depend on the backend.

## 5. Release path (backend)
PR → `ci-tests.yml` + `test.yml` green → staging (`deploy-sv2-staging.yml`, Worker `pulseworker-v2-staging`) → merge → `deploy.yml` waits for **owner approval** of the `production` environment → verify `git_commit_sha` on new rows and the live route output → V1 regression check (`sentiment-ff75` modified time unchanged since 2026-11-16 19:13 UTC; V1 `history` and `server_composite_readings` still advancing hourly). Rollback: revert + approved redeploy. No D1 migration is needed for B1/B2.

## 6. Rules that apply
- Never modify V1, `cryptopulse-v4`, PEV-1P, GLM-PE-1, the V2 engine (`sv2Compute`, prediction/selection/calibration, collector) or the GLM contract.
- Zero additional spend; no new cron, credential, dataset or provider.
- Production D1 through the Cloudflare connector: **SELECT only**, bounded. Do not use the environment's injected Cloudflare credential (it fails authentication; probing triggers rate limits).
- Escalate only for: spend, V1 change, V2-engine change, new credentials/access, destructive data change, schedule change, frozen protocol change, irreversible action, material ambiguity.

## 7. Open owner items (not blockers for B1/B2 code)
1. Confirm or replace the 55/45 V1 comparison threshold (OD-12).
2. Cloudflare plan, Observability ingestion, Worker CPU, V1 Workers AI usage (dashboard).
3. Whether V2 Alerts may ever edit V1 alert configs (default: read-only).
