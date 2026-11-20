// Unit tests for the pure view-model helpers embedded in index.html, plus static checks on the page source.
// Run: node --test tests/*.test.mjs*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = SRC.indexOf('// ---- BEGIN view-model helpers'), b = SRC.indexOf('// ---- END view-model helpers ----');
assert.ok(a > 0 && b > a, 'helper block markers present');
const ctx = vm.createContext({});
vm.runInContext(SRC.slice(a, b) + '\nthis.api = { headlineOf, glmHeadlineNote, forecastTileModel, predictionRunsModel, eventDetectionModel, collectorModel, variantCycleRows, nextTickTs, d1UsageModel, alertModel, sentimentV2Model, SV2_PERIODS, sv2LineBreakMs, sv2SeriesStyle, sv2AiAnnotationModel, sv2EvidenceModel, flTimesfmRows, flChronosRows, flWilson, flPairs, flDirectionStats, flErrorStats, flScatterPoints, flWindowStats, flCumulative, flAgreement, flModelCard, flPev1Model, flLedgerFilter, FL_SEAL_END, FL_PROSPECTIVE_START, sv2StatusModel, glmStatusModel, glmSignalModel, glmAdjustmentRows, glmEvidenceGroups, glmReasonText, apiBaseFor, GLM_CLASS_ORDER, CHART_PRESETS, CHART_DEFAULT_PRESET, chartPreset, clipSeries, coverageNote, AREAS, LEGACY_ROUTES, MOBILE_PRIMARY_AREAS, resolveRoute, allAreaViews, cmpSentimentSummary, flCoverage, glmEvalModel, GLM_PE1_MIN_APPLIED, foufiModel, V1_WORKER_URL, pfValidateTx, pfCompute, pfDryPowder, pfScenario, pfParseCsv, pfCsvRowsToTxs, pfToCsv, pfFromV1Backup, pfDedupKey, PF_TYPES, v1AlertsModel, cmpSummaryModel, cmpRecordRows, CMP_CLAIM_TEXT, traderTechnicals, traderPayloadV2, techRsi, techSma, normCDF, beRealizedVol, beSigma, beProba, breakEvenTable, BE_COIN_PARAMS, BE_HORIZONS, pfParseEcbCsv, pfFxLookup, pfStmtNum, pfStmtDate, pfRowObjects, pfDetectStatement, pfFromRevolut, pfFromNeverless, pfStmtMatchKey, pfHasV1NeverlessSeed, pfXlsxSheetRows, PF_NEVERLESS_V1_SEED_DATE, pfParseV1Embedded, pfV1InterestAt, pfDailyHistory, pfV1RepairPlan, pfV1Compare, pfCandlesToDaily };', ctx);
const H = ctx.api;
const plain = (v) => JSON.parse(JSON.stringify(v));
const NOW = Date.UTC(2026, 10, 13, 14, 0, 0);
const HOUR = 3600000;

const predict = (over = {}) => ({ ok: true, status: 'ok', ts: NOW - 2 * HOUR, p_up: 0.867, calibrated_p_up: 0.515, served_from: 'snapshot',
  experimental: { p_up: 0.73 },
  challenger: { ok: true, p_up_flat: 0.59, p_up_tilted: 0.69, calibrated_p_up_flat: 0.55, p_up_momentum: 0.52, momentum_triggered: true },
  selection: { ok: true, chosen_variant: 'original', chosen_p_up: 0.6, cleared_gate: false, cycle_p_up: 0.867,
    scores: [{ variant: 'original', p_up: 0.6, lca: 0.769, n_matched: 13 }, { variant: 'experimental', p_up: 0.487, lca: 0.167, n_matched: 6 }] }, ...over });
const freshCoin = (status = 'FRESH') => ({ horizons: { 24: { core: { status, cron_rows_24h: 8, latest_cron_ts: NOW - 2 * HOUR, latest_git_commit_sha: 'e0a174e0000' }, challenger: { status, cron_rows_24h: 8, latest_cron_ts: NOW - 2 * HOUR, latest_git_commit_sha: 'e0a174e0000' } } } });

test('headline: original model uses p_up; a chosen variant uses its value for this cycle', () => {
  assert.equal(H.headlineOf(predict()).pUp, 0.867);
  const v = H.headlineOf(predict({ selection: { ok: true, chosen_variant: 'calibrated', chosen_p_up: 0.4, cycle_p_up: 0.57 } }));
  assert.deepEqual([v.pUp, v.usingNonOriginal, v.hasCycleValue, v.variant], [0.57, true, true, 'calibrated']);
  const old = H.headlineOf(predict({ selection: { ok: true, chosen_variant: 'calibrated', chosen_p_up: 0.4 } }));
  assert.deepEqual([old.pUp, old.hasCycleValue], [0.4, false]);
});

test('forecast tile: fresh logged prediction', () => {
  const m = H.forecastTileModel('BTC', 24, { ok: true, data: predict() }, freshCoin(), NOW);
  assert.deepEqual([m.state, m.pct, m.direction, m.freshness, m.tone, m.variant, m.note], ['ok', 87, 'UP', 'FRESH', 'good', null, '']);
  assert.equal(H.forecastTileModel('BTC', 24, { ok: true, data: predict({ p_up: 0.33 }) }, freshCoin(), NOW).direction, 'DOWN');
});

test('forecast tile: unknown freshness is never shown as healthy', () => {
  const m = H.forecastTileModel('BTC', 24, { ok: true, data: predict() }, null, NOW);
  assert.deepEqual([m.freshness, m.tone], ['UNKNOWN', 'neutral']);
});

test('forecast tile: an old forecast is stale even when the report says fresh; stale report is bad', () => {
  const old = H.forecastTileModel('BTC', 24, { ok: true, data: predict({ ts: NOW - 7 * HOUR }) }, freshCoin(), NOW);
  assert.deepEqual([old.freshness, old.tone], ['STALE', 'bad']);
  assert.equal(H.forecastTileModel('BTC', 24, { ok: true, data: predict() }, freshCoin('STALE'), NOW).tone, 'bad');
});

test('forecast tile: loading, request failure, model unavailable, live read', () => {
  assert.equal(H.forecastTileModel('ETH', 12, null, null, NOW).state, 'loading');
  assert.equal(H.forecastTileModel('ETH', 12, { ok: false, error: 'request failed' }, null, NOW).state, 'error');
  const u = H.forecastTileModel('ETH', 12, { ok: false, data: { ok: false, status: 'insufficient_data' } }, null, NOW);
  assert.deepEqual([u.state, u.note, u.pct], ['unavailable', 'not enough history yet', null]);
  assert.equal(H.forecastTileModel('ETH', 12, { ok: true, data: predict({ p_up: null }) }, null, NOW).state, 'unavailable');
  assert.match(H.forecastTileModel('ETH', 12, { ok: true, data: predict({ served_from: 'live', persisted: false }) }, freshCoin(), NOW).note, /live read/);
});

test('scheduled predictions: on schedule, missed runs, stale, unknown, outdated report', () => {
  const report = (coins, gen = NOW) => ({ ok: true, data: { generated_ts: gen, expected_cron_ticks_24h: 8, coins } });
  const ok = H.predictionRunsModel(report({ BTC: freshCoin(), ETH: freshCoin() }), NOW);
  // Production series only (challenger series removed 2026-11-17): 2 coins x 1 horizon x core = 2.
  assert.deepEqual([ok.label, ok.tone, ok.total, ok.fresh, ok.onSchedule, plain(ok.versions)], ['ON SCHEDULE', 'good', 2, 2, 2, ['e0a174e']]);
  const chStale = freshCoin(); chStale.horizons[24].challenger.status = 'STALE';   // a stale (paused) challenger no longer turns production red
  assert.equal(H.predictionRunsModel(report({ BTC: chStale }), NOW).label, 'ON SCHEDULE');
  assert.equal(ok.nextDue, Date.UTC(2026, 10, 13, 15, 0, 0));
  const missed = freshCoin(); missed.horizons[24].core.cron_rows_24h = 6;
  assert.deepEqual([H.predictionRunsModel(report({ BTC: missed }), NOW).label, H.predictionRunsModel(report({ BTC: missed }), NOW).tone], ['MISSED RUNS', 'warn']);
  assert.equal(H.predictionRunsModel(report({ BTC: freshCoin('STALE') }), NOW).tone, 'bad');
  assert.deepEqual([H.predictionRunsModel({ ok: false, error: 'request failed' }, NOW).label, H.predictionRunsModel(null, NOW).tone], ['UNKNOWN', 'neutral']);
  assert.equal(H.predictionRunsModel(report({ BTC: freshCoin() }, NOW - 4 * HOUR), NOW).label, 'REPORT OUTDATED');
  assert.equal(H.predictionRunsModel(report({}), NOW).label, 'UNKNOWN');
});

test('event detection: running, degraded, stale, disabled, unknown', () => {
  const det = (status, enabled = true, stale = false) => ({ status, enabled, stale });
  const health = (over = {}) => ({ ok: true, data: { available: true, enabled: true, last_run: { finished_ts: NOW - HOUR, trigger: 'cron' },
    detectors: [det('OK'), det('OK'), det('DISABLED', false), det('NOT_CONFIGURED')], ...over } });
  const ok = H.eventDetectionModel(health(), NOW);
  assert.deepEqual([ok.label, ok.tone, ok.main], ['RUNNING', 'good', '2 of 2 active detectors OK · 2 not active']);
  assert.equal(H.eventDetectionModel(health({ detectors: [det('OK'), det('ERROR')] }), NOW).label, 'DEGRADED');
  assert.equal(H.eventDetectionModel(health({ detectors: [det('OK'), det('OK', true, true)] }), NOW).label, 'DEGRADED');
  assert.deepEqual([H.eventDetectionModel(health({ last_run: { finished_ts: NOW - 3 * HOUR } }), NOW).label], ['STALE']);
  assert.equal(H.eventDetectionModel(health({ last_run: null }), NOW).tone, 'neutral');
  assert.equal(H.eventDetectionModel(health({ enabled: false }), NOW).label, 'DISABLED');
  assert.equal(H.eventDetectionModel({ ok: false, error: 'HTTP 500' }, NOW).label, 'UNKNOWN');
});

test('funding collector: running, failures, stale, unknown', () => {
  const run = (minsAgo, conclusion = 'success', status = 'completed') => ({ status, conclusion, event: 'workflow_dispatch', updated_at: new Date(NOW - minsAgo * 60000).toISOString() });
  const list = (runs) => ({ ok: true, data: { workflow_runs: runs } });
  assert.deepEqual([H.collectorModel(list([run(30), run(90)]), NOW).label, H.collectorModel(list([run(30), run(90)]), NOW).tone], ['RUNNING', 'good']);
  assert.equal(H.collectorModel(list([run(5, null, 'in_progress'), run(30)]), NOW).label, 'RUNNING');
  assert.equal(H.collectorModel(list([run(30), run(90, 'failure')]), NOW).label, 'RECENT FAILURES');
  assert.equal(H.collectorModel(list([run(30, 'failure')]), NOW).label, 'LAST RUN FAILED');
  assert.equal(H.collectorModel(list([run(200)]), NOW).label, 'STALE');
  assert.equal(H.collectorModel(list([]), NOW).label, 'UNKNOWN');
  assert.equal(H.collectorModel({ ok: false, error: 'HTTP 403' }, NOW).tone, 'neutral');
});

test('variant rows: this cycle\'s own values, roles, low-n flag, shadow row', () => {
  const rows = plain(H.variantCycleRows(predict()));
  // EXP-003 momentum shadow row removed 2026-11-17; challenger variants stay while they are live selection candidates.
  assert.deepEqual(rows.map((r) => r.variant), ['original', 'experimental', 'calibrated', 'challenger_flat', 'challenger_tilted', 'challenger_calibrated']);
  const by = Object.fromEntries(rows.map((r) => [r.variant, r]));
  assert.deepEqual([by.original.pUp, by.original.role, by.original.localN, by.original.lowN], [0.867, 'SERVED_FALLBACK', 13, false]);
  assert.deepEqual([by.experimental.pUp, by.experimental.role, by.experimental.lowN], [0.73, 'CANDIDATE', true]); // 0.73 is the cycle value, not scores[].p_up (0.487)
  assert.deepEqual([by.calibrated.pUp, by.calibrated.scored], [0.515, false]);
  assert.equal(by.challenger_calibrated.pUp, 0.55);
  // Once the backend reports the challenger paused (PulseWorkerV2 #166), its variants are no longer candidates: not listed.
  assert.deepEqual(plain(H.variantCycleRows(predict({ challenger: { ok: true, status: 'paused' } }))).map((r) => r.variant), ['original', 'experimental', 'calibrated']);
  const sel = plain(H.variantCycleRows(predict({ selection: { ok: true, chosen_variant: 'calibrated', cleared_gate: true, scores: [] } })));
  assert.equal(sel.find((r) => r.variant === 'calibrated').role, 'SELECTED');
  assert.equal(sel.filter((r) => r.role === 'SELECTED' || r.role === 'SERVED_FALLBACK').length, 1); // exactly one production row
  assert.ok(plain(H.variantCycleRows(predict({ selection: null }))).every((r) => r.role === 'UNKNOWN'));
  assert.equal(H.variantCycleRows({ ok: false }).length, 0);
  assert.equal(plain(H.variantCycleRows(predict({ challenger: null }))).find((r) => r.variant === 'challenger_flat').pUp, null);
});

test('paused experiments taken out of the page (2026-11-17): no EXP-002/EXP-023 cards, no challenger requests, registry hides them', () => {
  for (const id of ['exp002Card', 'exp002Body', 'goalBCard', 'goalBBody', 'challengerLiveCard', 'challengerCalibCard', 'challengerRecapCard'])
    assert.ok(!SRC.includes(`id="${id}"`), id + ' removed');
  for (const route of ['/challenger-recent', '/challenger-calibration?', '/challenger-calibration-history', '/gemini-analysis', '/link-gemini-analysis'])
    assert.ok(!SRC.includes(`'${route}`) && !SRC.includes(`+ '${route}`), route + ' no longer requested');
  assert.ok(!/renderGoalB\(|renderExp002\(|loadChallenger\(\)/.test(SRC.replace(/\/\/.*$/gm, '')), 'no call to removed renderers');
  const m = SRC.match(/var REGISTRY_HIDDEN_IDS = (\[[^\]]*\]);/);
  assert.deepEqual(JSON.parse(m[1].replace(/'/g, '"')), ['EXP-002', 'EXP-003', 'EXP-012', 'EXP-023']);
  assert.match(SRC, /const list = registryVisibleEntries\(_registry\.data\.experiments\);/);
});

const hourly = (runs, lastTs) => ({ kind: 'scheduled', key: '0 * * * *', invocations: runs, last_ts: lastTs });
const usage = (over = {}, dayOver = {}) => ({ ok: true, data: { ok: true, recording: true, daily_read_limit: 5000000,
  days: [{ day: '2026-11-13', rows_read: 1000000, rows_written: 200, entries: [hourly(14, NOW - 20 * 60000), { kind: 'fetch', key: 'GET /chart-data', invocations: 9, last_ts: NOW - 50 * 60000 }], ...dayOver },
    { day: '2026-11-12', rows_read: 1500000, entries: [] }], ...over } });

test('database usage: healthy figures, remaining, reliable projection, previous day', () => {
  const m = H.d1UsageModel(usage(), NOW); // 14:00 UTC, 14 hourly runs recorded, 1.0M read
  assert.deepEqual([m.label, m.tone, m.read, m.limit, m.remaining, m.pct, m.lastTs], ['HEALTHY', 'good', 1000000, 5000000, 4000000, 20, NOW - 20 * 60000]);
  assert.deepEqual([Math.round(m.projected), m.projectedPct, m.projectionQuality, m.coverageComplete, m.coveredHours], [1714286, 34.3, 'reliable', true, 14]);
  assert.equal(m.prev.day, '2026-11-12');
  assert.match(m.main, /1,000,000 of 5,000,000 rows read today \(20%\)/);
});

test('database usage: partial-day recording gives a provisional projection that never changes the status', () => {
  const part = (read) => H.d1UsageModel(usage({}, { rows_read: read, entries: [hourly(5, NOW - 10 * 60000)] }), NOW);
  const m = part(1500000);                                      // 5 h measured of 14 h: 300,000 rows/h -> 7.2M per day
  assert.deepEqual([m.label, m.projectionQuality, m.coverageComplete, m.coveredHours, Math.round(m.projected), m.projectionOverThreshold],
    ['HEALTHY', 'provisional', false, 5, 7200000, true]);
  assert.equal(part(3100000).label, 'WARNING');                 // the measured share still warns
  const none = H.d1UsageModel(usage({}, { entries: [{ kind: 'fetch', key: 'GET /x', invocations: 3, last_ts: NOW - 60000 }] }), NOW);
  assert.deepEqual([none.label, none.projected, none.projectionQuality], ['HEALTHY', null, 'none']);
});

test('database usage: warning by share used, warning by reliable projection, critical at the limit', () => {
  assert.equal(H.d1UsageModel(usage({}, { rows_read: 3100000 }), NOW).label, 'WARNING');             // 62% used
  const proj = H.d1UsageModel(usage({}, { rows_read: 2600000 }), NOW);                                 // 52% used, 89% projected
  assert.deepEqual([proj.label, proj.tone], ['WARNING', 'warn']);
  assert.equal(H.d1UsageModel(usage({}, { rows_read: 2400000 }), NOW).label, 'HEALTHY');               // 48% used, 82% projected
  const crit = H.d1UsageModel(usage({}, { rows_read: 5200000 }), NOW);
  assert.deepEqual([crit.label, crit.tone, crit.remaining], ['CRITICAL', 'bad', 0]);
  const early = Date.UTC(2026, 10, 13, 1, 0, 0);
  const e = H.d1UsageModel(usage({}, { rows_read: 600000, entries: [hourly(2, early - 60000)] }), early);
  assert.deepEqual([e.label, e.projected, e.projectionQuality], ['HEALTHY', null, 'none']);            // too early to project
});

test('database usage: stale, missing, failed and partial responses are never healthy', () => {
  assert.equal(H.d1UsageModel(usage({}, { entries: [hourly(11, NOW - 3 * HOUR)] }), NOW).label, 'STALE');
  const none = H.d1UsageModel(usage({ days: [{ day: '2026-11-12', rows_read: 5, entries: [] }] }), NOW);
  assert.deepEqual([none.label, none.tone], ['STALE', 'bad']);
  assert.equal(H.d1UsageModel(usage({ days: [] }), Date.UTC(2026, 10, 13, 0, 30, 0)).label, 'UNKNOWN');
  for (const bad of [null, { ok: false, error: 'HTTP 404' }, { ok: false, error: 'request failed' }, usage({ recording: false }),
    usage({ daily_read_limit: undefined }), usage({}, { rows_read: undefined }), usage({}, { entries: [] }), usage({}, { entries: undefined })]) {
    const m = H.d1UsageModel(bad, NOW);
    assert.deepEqual([m.label, m.tone], ['UNKNOWN', 'neutral']);
  }
});

test('alerts: an open alert issue is an active alert whatever the latest run says', () => {
  const run = (minsAgo, conclusion = 'success', status = 'completed') => ({ status, conclusion, event: 'workflow_dispatch', updated_at: new Date(NOW - minsAgo * 60000).toISOString() });
  const runs = (list) => ({ ok: true, data: { workflow_runs: list } });
  const issues = (list) => ({ ok: true, data: list });
  const issue = { number: 7, state: 'open', title: 'Operations alert: 1 problem found by the scheduled checks', created_at: new Date(NOW - 5 * HOUR).toISOString(), html_url: 'https://github.com/o/r/issues/7' };
  const m = H.alertModel(runs([run(60)]), issues([issue]), NOW);      // deduplicated run is green, alert still active
  assert.deepEqual([m.label, m.tone, m.number, m.link, m.since], ['ALERT ACTIVE', 'bad', 7, 'https://github.com/o/r/issues/7', NOW - 5 * HOUR]);
  assert.equal(H.alertModel({ ok: false, error: 'HTTP 403' }, issues([issue]), NOW).label, 'ALERT ACTIVE');
  assert.equal(H.alertModel(runs([run(60)]), issues([{ ...issue, html_url: 'javascript:alert(1)' }]), NOW).link, null);
  assert.equal(H.alertModel(runs([run(60)]), issues([{ ...issue, pull_request: {} }]), NOW).label, 'PASSING');
});

test('alerts: passing needs no open alert and a recent successful run; unreadable sources are unknown', () => {
  const run = (minsAgo, conclusion = 'success', status = 'completed') => ({ status, conclusion, event: 'schedule', updated_at: new Date(NOW - minsAgo * 60000).toISOString() });
  const runs = (list) => ({ ok: true, data: { workflow_runs: list } });
  const none = { ok: true, data: [] };
  assert.deepEqual([H.alertModel(runs([run(60)]), none, NOW).label, H.alertModel(runs([run(60)]), none, NOW).tone], ['PASSING', 'good']);
  assert.equal(H.alertModel(runs([run(5, null, 'in_progress'), run(60)]), none, NOW).label, 'PASSING');
  assert.deepEqual([H.alertModel(runs([run(60, 'failure')]), none, NOW).label, H.alertModel(runs([run(60, 'failure')]), none, NOW).tone], ['CHECK FAILED', 'bad']);
  assert.equal(H.alertModel(runs([run(300)]), none, NOW).label, 'STALE');
  for (const m of [H.alertModel(runs([run(60)]), { ok: false, error: 'HTTP 403' }, NOW), H.alertModel(runs([run(60)]), null, NOW),
    H.alertModel({ ok: false, error: 'HTTP 403' }, none, NOW), H.alertModel(runs([]), none, NOW), H.alertModel(runs([run(60, 'cancelled')]), none, NOW)]) {
    assert.deepEqual([m.label, m.tone], ['UNKNOWN', 'neutral']);
  }
});

test('page source: one write request, user-entered key only, no embedded secrets', () => {
  // Exactly three POSTs, each named: the analyst relay (pre-existing), Hyperliquid allMids (a read-only market-data
  // query that the API only offers as POST) and V1's /gemini-outlook (Narrative parity, only on an explicit click).
  const posts = SRC.match(/method:\s*['"]POST['"]/g) || [];
  assert.equal(posts.length, 7, 'seven POSTs: analyst relay, Hyperliquid allMids + 3 candleSnapshot reads (read-only market data; one is the portfolio value history), V1 Narrative and Trader Analysis (clicks)');
  assert.match(SRC, /type: 'candleSnapshot', req: \{ coin: a, interval: '1d'/);
  const tr = SRC.slice(SRC.indexOf('async function runTraderAnalysis()'), SRC.indexOf('// ---- Settings:'));
  assert.match(tr, /fetch\(V1_WORKER_URL \+ '\/trader-analysis-gemini', \{ method: 'POST'/);
  assert.match(SRC, /fetch\('https:\/\/api\.hyperliquid\.xyz\/info', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \}, body: JSON\.stringify\(\{ type: 'allMids' \}\) \}\)/);
  const nar = SRC.slice(SRC.indexOf('async function pfRunNarrative()'), SRC.indexOf('// ---- Settings:'));
  assert.match(nar, /fetch\(V1_WORKER_URL \+ '\/gemini-outlook', \{ method: 'POST'/);
  assert.match(nar, /portfolio: m\.allocation\.map\(a => \(\{ sym: a\.asset, weight:/, 'only symbols and weights are sent');
  assert.ok(/fetch\(WORKER_URL \+ '\/analyst-relay\/submit'/.test(SRC), 'the POST bypasses the GET memo');
  assert.equal((SRC.match(/[^a-zA-Z]fetch\(WORKER_URL/g) || []).length, 1, 'every other Worker request goes through apiFetch');
  assert.ok(!/(ghp_|github_pat_|sk-[A-Za-z0-9]{20}|Bearer [A-Za-z0-9_\-]{20,})/.test(SRC), 'no token-like literal');
  assert.ok(!/(OPS_ADMIN_TOKEN|STAGE7_ADMIN_TOKEN|RESEARCH_DISPATCH_TOKEN)\s*[:=]/.test(SRC), 'no admin secret assignment');
  for (const route of ['/btc-backfill', '/recalibrate-refresh', '/run-analysis', '/backtest-technical']) {
    assert.ok(!new RegExp("fetch\\(WORKER_URL \\+ '" + route).test(SRC), 'maintenance route ' + route + ' is not called');
  }
});

test('page source: inline scripts parse', () => {
  const scripts = [...SRC.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const s of scripts) new vm.Script(s);
});

// ---- Sentiment V2 tab ----
const sv2 = (over = {}, ss = {}) => ({ ok: true, data: { ok: true, period: '7d', points: [
  { ts: NOW - 5 * HOUR, v1: 35, btc: 68856, v2: null, v2_status: null },
  { ts: NOW - 3 * HOUR, v1: 33, btc: 66989, v2: 41, v2_status: 'OK' },
  { ts: NOW - 1 * HOUR, v1: 30, btc: 66500, v2: 44.5, v2_status: 'DEGRADED' },
], downsampled: false, truncated: false, btc_truncated: false, v2_error: null,
  series_status: { v1: { last_ts: NOW - HOUR, stale: false }, btc: { last_ts: NOW - HOUR, stale: false },
    v2: { first_ts: NOW - 3 * HOUR, last_ts: NOW - HOUR, points_in_period: 2, available: true, stale: false, insufficient_history: false }, ...ss }, ...over } });
const texts = (m) => m.notices.map((n) => n.text).join(' | ');

test('sentiment v2: periods match the Worker route and the spec', () => {
  // Server keys the Worker accepts, labelled with the global chart presets (OD-08): 24H first.
  assert.deepEqual(plain(H.SV2_PERIODS).map((p) => p[0]), ['24h', '7d', '30d', 'all']);
  assert.deepEqual(plain(H.SV2_PERIODS).map((p) => p[1]), ['24H', '7D', '1M', 'All']);
});

test('sentiment v2: values pass through unchanged and stay aligned per timestamp', () => {
  const m = H.sentimentV2Model(sv2(), NOW);
  assert.equal(m.state, 'ok');
  assert.deepEqual(plain(m.rows.map((r) => [r.v1, r.v2, r.btc])), [[35, null, 68856], [33, 41, 66989], [30, 44.5, 66500]]);
  assert.match(m.status, /Last V1 update 1 h ago · V2 available, last 1 h ago/);
  assert.match(texts(m), /1 V2 point was computed with incomplete inputs/);
  assert.doesNotMatch(texts(m), /Missing points/, 'V1 points before V2 started are not counted as missing V2');
  assert.deepEqual(m.rows.map((r) => r.v2Pre), [true, false, false], 'before V2 started is not "missing"');
});

test('sentiment v2: no V2 yet, and too little V2 history, are stated', () => {
  const none = H.sentimentV2Model(sv2({ points: [{ ts: NOW - HOUR, v1: 30, btc: 66500, v2: null }] },
    { v2: { first_ts: null, last_ts: null, points_in_period: 0, available: false, stale: true, insufficient_history: true } }), NOW);
  assert.match(texts(none), /V2 has no results yet/);
  assert.match(none.status, /V2 not started/);
  assert.doesNotMatch(texts(none), /V2 sentiment is stale/, 'a series that never started is not called stale');
  const one = H.sentimentV2Model(sv2({}, { v2: { first_ts: NOW - HOUR, last_ts: NOW - HOUR, points_in_period: 1, available: true, stale: false, insufficient_history: true } }), NOW);
  assert.match(texts(one), /insufficient history in this period to draw a line \(1 point\)/);
});

test('sentiment v2: stale series and missing points are flagged', () => {
  const m = H.sentimentV2Model(sv2({ points: [
    { ts: NOW - 9 * HOUR, v1: 35, btc: null, v2: 40, v2_status: 'OK' },
    { ts: NOW - 8 * HOUR, v1: null, btc: 66000, v2: null, v2_status: null },
  ] }, { v1: { last_ts: NOW - 9 * HOUR, stale: true }, btc: { last_ts: NOW - 8 * HOUR, stale: true },
    v2: { first_ts: NOW - 9 * HOUR, last_ts: NOW - 9 * HOUR, points_in_period: 1, available: true, stale: true, insufficient_history: true } }), NOW);
  const t = texts(m);
  assert.match(t, /V1 sentiment is stale: last value 9 h ago/);
  assert.match(t, /BTC price is stale: last value 8 h ago/);
  assert.match(t, /V2 sentiment is stale/);
  assert.match(t, /Missing points: 1 V1, 1 V2, 1 BTC/);
  assert.ok(m.notices.filter((n) => /stale/.test(n.text)).every((n) => n.tone === 'warn'));
});

test('sentiment v2: errors and empty periods never draw invented data', () => {
  for (const r of [{ ok: false, error: 'HTTP 500' }, null, { ok: true, data: { ok: true } }]) {
    const m = H.sentimentV2Model(r, NOW);
    assert.deepEqual([m.state, m.rows.length, m.notices[0].tone], ['error', 0, 'bad']);
  }
  assert.match(texts(H.sentimentV2Model({ ok: false, error: 'HTTP 500' }, NOW)), /HTTP 500/);
  assert.equal(H.sentimentV2Model(sv2({ points: [] }), NOW).state, 'empty');
  const e = H.sentimentV2Model(sv2({ v2_error: 'D1_ERROR' }), NOW);
  assert.match(texts(e), /V2 results could not be read/);
  assert.match(e.status, /V2 unavailable/);
});

test('page source: Sentiment V2 tab, colours, axes and route', () => {
  assert.ok(/id="view-sentiment"/.test(SRC), 'view present');
  assert.ok(/\{ key: 'sentiment-v2', label: 'Sentiment V2'/.test(SRC), 'area in navigation');
  assert.ok(/'V1 sentiment', 'v1', '#3B82F6'/.test(SRC), 'V1 blue');
  assert.ok(/'V2 sentiment', 'v2', '#22C55E'/.test(SRC), 'V2 green');
  assert.ok(/'BTC price', 'btc', '#F59E0B'/.test(SRC), 'BTC orange');
  assert.ok(/ys: \{ position: 'left', min: 0, max: 100/.test(SRC), 'sentiment left axis 0-100');
  assert.ok(/yp: \{ position: 'right'/.test(SRC), 'BTC right axis');
  assert.ok(/apiFetch|getJson\(WORKER_URL \+ '\/api\/sentiment-v2\/comparison\?period='/.test(SRC), 'read through the GET memo');
});

test('sentiment v2: a V1 reading not yet processed is reported, not hidden behind "stale"', () => {
  const lag = H.sentimentV2Model(sv2({ v1_history_last_ts: NOW - 30 * 60000 }, { v1: { last_ts: NOW - 9 * HOUR, stale: true } }), NOW);
  assert.match(texts(lag), /Newer V1 reading from 30 min ago is waiting to be processed/);
  assert.match(texts(lag), /V1 sentiment is stale: last value 9 h ago/);
  assert.doesNotMatch(texts(H.sentimentV2Model(sv2({ v1_history_last_ts: NOW - HOUR }), NOW)), /waiting to be processed/, 'caught up');
  assert.doesNotMatch(texts(H.sentimentV2Model(sv2(), NOW)), /waiting to be processed/, 'older Worker without the field');
});

test('sentiment v2: the line breaks across gaps longer than max(6 h, 3x median spacing); values are untouched', () => {
  const pts = (hours) => hours.map((h, i) => ({ ts: NOW - h * HOUR, v1: 30 + i, btc: 66000 + i, v2: null }));
  // Spacing 1-2 h with one 9 h overnight gap: limit stays at 6 h, one break, values unchanged.
  const m = H.sentimentV2Model(sv2({ points: pts([20, 19, 17, 16, 7, 6, 5]) }), NOW);
  assert.equal(m.breakMs, 6 * HOUR);
  assert.match(texts(m), /Lines break where readings are more than 6 h apart \(1 gap\)/);
  assert.deepEqual(plain(m.rows.map((r) => r.v1)), [30, 31, 32, 33, 34, 35, 36]);
  // Evenly spaced readings never break.
  const even = H.sentimentV2Model(sv2({ points: pts([5, 4, 3, 2, 1]) }), NOW);
  assert.doesNotMatch(texts(even), /Lines break/);
  // Sparse (downsampled) series: the limit follows 3x the median spacing so ordinary spacing is not broken.
  assert.equal(H.sv2LineBreakMs([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((h) => ({ ts: h * HOUR }))), 12 * HOUR);
  assert.equal(H.sv2LineBreakMs([{ ts: 0 }]), 6 * HOUR);
  // Codex P2: a tiny sample cannot inflate the limit (2 readings 10 h apart; 3 readings 1 h and 10 h apart).
  assert.equal(H.sv2LineBreakMs([0, 10].map((h) => ({ ts: h * HOUR }))), 6 * HOUR);
  assert.equal(H.sv2LineBreakMs([0, 1, 11].map((h) => ({ ts: h * HOUR }))), 6 * HOUR);
  const tiny = H.sentimentV2Model(sv2({ points: pts([12, 11, 1]) }), NOW);
  assert.match(texts(tiny), /more than 6 h apart \(1 gap\)/);
});

test('sentiment v2: the chart draws no segment across a break (static check of renderSentimentV2)', () => {
  assert.match(SRC, /segment: \{ borderColor: c => \(c\.p1\.parsed\.x - c\.p0\.parsed\.x > breakMs \? 'transparent' : undefined\) \}/);
  assert.match(SRC, /spanGaps: st\.spanGaps,\s*\n\s*segment:/, 'missing values still show as gaps');
  assert.equal(H.sv2SeriesStyle(10).spanGaps, false);
});

// ---- Sentiment V2 evidence, sources and AI budget (scope lock 2026-11-14) ----
test('sentiment v2 evidence: https links only, lexicon tone, honest empty/unavailable/error states', () => {
  const m = H.sv2EvidenceModel({ ok: true, data: { items: [
    { evidence_id: 'ev_a', title: 'Bitcoin rally', source_name: 'Decrypt', canonical_url: 'https://decrypt.co/x', published_ts: NOW - HOUR, retrieved_ts: NOW, lexicon_score: 2, lexicon_hits: 1 },
    { evidence_id: 'ev_b', title: 'x', source_id: 'fed_press', canonical_url: 'javascript:alert(1)', retrieved_ts: NOW, lexicon_score: 0, lexicon_hits: 0 },
    { evidence_id: 'ev_c', title: 'Exchange hack', source_name: 'CryptoSlate', canonical_url: 'http://x.org', retrieved_ts: NOW, lexicon_score: -2, lexicon_hits: 1 },
  ] } }, NOW);
  assert.equal(m.state, 'ok');
  assert.deepEqual(plain(m.items.map((x) => [x.url, x.tone, x.label])), [['https://decrypt.co/x', 'good', '+2'], [null, 'neutral', '·'], [null, 'bad', '-2']]);
  assert.equal(m.items[0].ts, NOW - HOUR, 'publication time preferred');
  assert.equal(H.sv2EvidenceModel({ ok: true, data: { items: [] } }, NOW).state, 'empty');
  assert.equal(H.sv2EvidenceModel({ ok: true, data: { available: false, items: [] } }, NOW).state, 'unavailable');
  assert.equal(H.sv2EvidenceModel({ ok: false, error: 'HTTP 500' }, NOW).state, 'error');
});

test('sentiment v2 status: source tones, reliability, and the AI budget line says when inference stopped', () => {
  const base = { calc_version: 'sv2-1.1.0', collector: { enabled: true }, sources: [
    { id: 'a', name: 'A', family: 'market_sentiment_news', last_status: 'OK', fresh: true, reliability: 0.95, attempts: 20 },
    { id: 'b', name: 'B', family: 'macroeconomic', last_status: 'HTTP_ERROR', fresh: false, reliability: 0.5, attempts: 4, last_error: 'HTTP 500' },
    { id: 'c', name: 'C', family: 'regulation_geopolitics', last_status: 'NOT_CONFIGURED', fresh: false, reliability: null, attempts: 0 },
    { id: 'd', name: 'D', family: 'macroeconomic', last_status: 'NOT_MODIFIED', fresh: false, reliability: 1, attempts: 3 },
  ] };
  const ai = (o) => ({ ok: true, data: { ...base, ai: { enabled: true, model: '@cf/zai-org/glm-4.7-flash', daily_neuron_budget: 1000, committed_neurons: 120, calls: 3, remaining_neurons: 880, account_limited_today: false, ...o } } });
  const m = H.sv2StatusModel(ai({}), NOW);
  assert.deepEqual(plain(m.sources.map((x) => [x.tone, x.reliability])), [['good', '95%'], ['bad', '50%'], ['neutral', '—'], ['warn', '100%']]);
  assert.equal(m.collector.label, 'collector on');
  assert.deepEqual([m.ai.tone, /120 of 1000 Neurons today · 3 calls/.test(m.ai.line)], ['good', true]);
  const used = H.sv2StatusModel(ai({ remaining_neurons: 0, committed_neurons: 1000 }), NOW).ai;
  assert.deepEqual([used.tone, /daily budget used: stopped for today/.test(used.line)], ['warn', true]);
  const lim = H.sv2StatusModel(ai({ account_limited_today: true }), NOW).ai;
  assert.deepEqual([lim.tone, /account free allocation reached/.test(lim.line)], ['bad', true]);
  assert.equal(H.sv2StatusModel({ ok: true, data: { ...base, ai: { enabled: false } } }, NOW).ai.line, 'AI annotation off · no model configured, daily budget 0 Neurons · no calls');
  assert.equal(H.sv2StatusModel(null, NOW).state, 'error');
  // Worker before migration 0029 (PulseWorkerV2 #141): ok:false with health 'schema_missing' is a setup state, not an error.
  const pending = H.sv2StatusModel({ ok: false, error: 'HTTP 200', data: { ok: false, health: 'schema_missing', calc_version: 'sv2-1.1.0', collector: { enabled: false } } }, NOW);
  assert.equal(pending.state, 'pending');
  assert.match(pending.note, /not set up yet/);
  assert.equal(pending.collector.label, 'collector off');
  // Any other failure is still an error.
  assert.equal(H.sv2StatusModel({ ok: false, error: 'HTTP 500', data: { ok: false, health: 'error' } }, NOW).state, 'error');
});

test('sentiment v2: points carry their calc version and the status line names the current method', () => {
  const m = H.sentimentV2Model(sv2({ current_calc_version: 'sv2-1.1.0', current_version_since: NOW - 3 * HOUR,
    points: [{ ts: NOW - 5 * HOUR, v1: 35, btc: 1, v2: 30, v2_status: 'OK', v2_version: 'sv2-1.0.0' }, { ts: NOW - HOUR, v1: 30, btc: 1, v2: 31, v2_status: 'OK', v2_version: 'sv2-1.1.0' }] }), NOW);
  assert.deepEqual(plain(m.rows.map((r) => r.v2Version)), ['sv2-1.0.0', 'sv2-1.1.0']);
  assert.match(m.status, /method sv2-1\.1\.0 since 3 h ago/);
});

test('page source: evidence panel is collapsed below the graph and loads only when opened', () => {
  const graph = SRC.indexOf('id="sv2Chart"'), details = SRC.indexOf('id="sv2Details"');
  assert.ok(graph > 0 && details > graph, 'details after the graph');
  assert.ok(!/<details id="sv2Details"[^>]*\bopen\b/.test(SRC), 'collapsed by default');
  assert.ok(/addEventListener\('toggle', \(\) => loadSv2DetailsIfOpen\(\)\)/.test(SRC));
  assert.ok(/rel="noopener noreferrer nofollow"/.test(SRC), 'external evidence links are isolated');
  assert.ok(/if\(!res \|\| !res\.ok \|\| !res\.data\)\{ host\.innerHTML = '<p class="text-\[#BAC9CD\]">V2 data is unavailable right now/.test(SRC), 'a failed load is not shown as "no V2 result yet"');
});

test('sentiment v2 chart: straight trend lines, a marker on every reading, no line across missing values', () => {
  for (const n of [5, 60, 61, 500]) {
    const st = plain(H.sv2SeriesStyle(n));
    assert.equal(st.tension, 0, 'no curve smoothing that could overshoot a reading');
    assert.equal(st.spanGaps, false, 'missing values are gaps, never bridged');
    for (const k of ['v1Radius', 'v2Radius', 'btcRadius']) assert.ok(st[k] > 0, k + ' keeps a visible marker at n=' + n);
  }
  assert.ok(/tension: st\.tension, spanGaps: st\.spanGaps/.test(SRC), 'the chart uses the tested style');
  assert.ok(!/tension: 0\.2, spanGaps: false/.test(SRC), 'the old smoothed style is gone');
  // Long gaps still break the line (V1 is recorded only while the V1 app is open).
  const rows = [0, 1, 2, 3, 30].map((h) => ({ ts: NOW + h * HOUR }));
  const br = H.sv2LineBreakMs(rows);
  assert.ok(br < 27 * HOUR, 'a 27 h gap is not bridged');
});

test('sentiment v2 chart: on longer ranges short gaps keep the trend line; gaps over a day always break it', () => {
  const D = 24 * HOUR;
  // 7D window: the limit is 14 h, so 8-12 h overnight gaps (V1 app closed) are connected; a 30 h gap is not.
  const r7 = [0, 2, 4, 14, 16, 18, 30, 32, 34, 36, 66, 68].map((h) => ({ ts: h * HOUR }));
  assert.equal(H.sv2LineBreakMs(r7, 7 * D), 14 * HOUR);
  // Without a window the old rule applies unchanged (6 h floor, 3x median).
  assert.equal(H.sv2LineBreakMs(r7), 6 * HOUR);
  // The window term is capped at 24 h on 90D/ALL, so multi-day outages still break the line.
  assert.equal(H.sv2LineBreakMs(r7, 90 * D), 24 * HOUR);
  assert.equal(H.sv2LineBreakMs([{ ts: 0 }], 365 * D), 24 * HOUR);
  // The model passes the requested window from the API (from_ts..to_ts), and the notice reports the breaks.
  const pts = r7.map((r, i) => ({ ts: NOW - 7 * D + r.ts, v1: 40 + i, btc: 66000, v2: null }));
  const m = H.sentimentV2Model(sv2({ from_ts: NOW - 7 * D, to_ts: NOW, points: pts }), NOW);
  assert.equal(m.breakMs, 14 * HOUR);
  assert.match(texts(m), /more than 14 h apart \(1 gap\)/);
  assert.deepEqual(plain(m.rows.map((r) => r.v1)), pts.map((p) => p.v1), 'values are unchanged');
});

test('sentiment v2 sources: a source disabled in config shows DISABLED (not NEVER_RUN); AI off states why', () => {
  const res = { ok: true, data: { ok: true, health: 'ok', calc_version: 'sv2-1.1.0',
    collector: { enabled: true, disabled_sources: ['bitcoinmagazine'] },
    sources: [{ id: 'bitcoinmagazine', name: 'Bitcoin Magazine', family: 'market_sentiment_news', last_status: 'NEVER_RUN', fresh: false },
      { id: 'decrypt', name: 'Decrypt', family: 'market_sentiment_news', last_status: 'OK', fresh: true, reliability: 1 },
      { id: 'sec_press', name: 'SEC press releases', family: 'regulation_geopolitics', last_status: 'NOT_CONFIGURED', fresh: false }],
    ai: { model: null, enabled: false, daily_neuron_budget: 0, calls: 0 } } };
  const m = H.sv2StatusModel(res, NOW);
  assert.deepEqual(plain(m.sources.map((s) => [s.id, s.status, s.tone, s.fresh])),
    [['bitcoinmagazine', 'DISABLED', 'neutral', false], ['decrypt', 'OK', 'good', true], ['sec_press', 'NOT_CONFIGURED', 'neutral', false]]);
  assert.equal(m.ai.line, 'AI annotation off · no model configured, daily budget 0 Neurons · no calls');
  // A model in config with no budget is still off, and says so.
  const cfg = H.sv2StatusModel({ ok: true, data: { ...res.data, ai: { model: '@cf/zai-org/glm-4.7-flash', enabled: false, daily_neuron_budget: 0, calls: 0 } } }, NOW);
  assert.equal(cfg.ai.line, 'AI annotation off · @cf/zai-org/glm-4.7-flash configured but daily budget 0 Neurons · no calls');
  assert.equal(cfg.ai.tone, 'neutral');
});

test('sentiment v2 chart: the break limit never exceeds 24 h, even when sparse downsampled data has a long median (Codex P2)', () => {
  // 12 h median spacing (3x = 36 h) with a 30 h outage: the outage must still break the line.
  const hours = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 150, 162];
  const rows = hours.map((h) => ({ ts: h * HOUR }));
  assert.equal(H.sv2LineBreakMs(rows), 24 * HOUR);
  assert.equal(H.sv2LineBreakMs(rows, 365 * 24 * HOUR), 24 * HOUR);
  let breaks = 0; const br = H.sv2LineBreakMs(rows);
  for (let i = 1; i < rows.length; i++) if (rows[i].ts - rows[i - 1].ts > br) breaks++;
  assert.equal(breaks, 1, 'only the 30 h outage breaks; the regular 12 h spacing is connected');
});

test('sentiment v2 AI panel: structured fields only; no summary, uncertainty, confidence or notes are shown', () => {
  assert.equal(H.sv2AiAnnotationModel(null), null);
  assert.equal(H.sv2AiAnnotationModel({ ai_annotation: null }), null);
  const legacy = { ai_model: '@cf/zai-org/glm-4.7-flash', ai_annotation: { summary: 'Losses associated with Ethereum mining.', uncertainty: 'low', confidence: 0.9,
    cited_ids: ['evidence:e1', 'evidence:e2'], entities: [{ id: 'evidence:e1', name: 'BitMine', kind: 'organization' }],
    figures: [{ id: 'evidence:e1', value: '8.83' }], contradictions: [{ ids: ['evidence:e1', 'evidence:e2'], note: 'they disagree' }, { ids: ['evidence:e1'] }],
    event_relevance: [{ id: 'event:x', relevance: 'low', overlap: 'none' }] } };
  const m = plain(H.sv2AiAnnotationModel(legacy));
  assert.deepEqual(m, { cited: ['evidence:e1', 'evidence:e2'], entities: [{ id: 'evidence:e1', name: 'BitMine', kind: 'organization' }],
    figures: [{ id: 'evidence:e1', value: '8.83' }], contradictions: [['evidence:e1', 'evidence:e2']],
    relevance: [{ id: 'event:x', relevance: 'low', overlap: 'none' }], model: '@cf/zai-org/glm-4.7-flash' });
  assert.doesNotMatch(JSON.stringify(m), /Ethereum mining|uncertainty|confidence|they disagree/);
  // The renderer never reads free-text fields.
  const a = SRC.indexOf('function renderSv2Ai'), b = SRC.indexOf('function renderSentimentV2', a);
  const body = SRC.slice(a, b);
  assert.doesNotMatch(body, /\.summary|\.uncertainty|\.confidence|\.note\b|Uncertainty:/);
  assert.match(body, /sv2AiAnnotationModel\(l\)/);
});

// ---- Forecasting Lab (TimesFM EXP-004, Chronos-2 EXP-008) ----
const NOV = Date.UTC(2026, 10, 5, 12), OCT = Date.UTC(2026, 9, 20, 12), SEALED = Date.UTC(2026, 8, 7, 12);
const tfmRow = (origin, h, over = {}) => ({ id: origin % 1000 + h, coin: 'BTC', horizon_hours: h, ts: origin + 300000, target_ts: origin + h * HOUR, input_end_ts: origin,
  price_at_prediction: 100000, forecast_price: 101000, predicted_return_pct: 1, direction: 'UP', model_version: 'timesfm-2.5-200m',
  actual_return_pct: -2, actual_direction: 'DOWN', correct: 0, resolved_ts: origin + h * HOUR + 60000, ...over });
const chrRow = (origin, h, over = {}) => ({ id: `BTC_${h}h_${origin}`, coin: 'BTC', horizon_hours: h, issued_ts: origin + 60000, input_end_ts: origin, target_ts: origin + h * HOUR,
  price_at_prediction: 100000, forecast_median: 99000, forecast_q10: 97000, forecast_q90: 101000, predicted_return_pct: -1, direction: 'DOWN',
  persistence_direction: 'DOWN', model_version: 'chronos-2', forecast_file: `forecasts/BTC/${h}h/x.json`, resolution_file: `resolutions/BTC/${h}h/x.json`,
  status: 'resolved', actual_price: 98000, actual_return_pct: -2, actual_direction: 'DOWN', correct: 1, persistence_correct: 1, resolved_ts: origin + h * HOUR + 60000, ...over });
const T = (rows) => H.flTimesfmRows({ ok: true, data: { forecasts: rows } });
const C = (rows) => H.flChronosRows({ ok: true, data: { forecasts: rows } });

test('forecasting lab: sealed origins are never read; populations follow the frozen plan; values are the stored ones', () => {
  assert.equal(H.FL_SEAL_END, Date.UTC(2026, 9, 9, 21));
  assert.equal(H.FL_PROSPECTIVE_START, Date.UTC(2026, 10, 1));
  const t = T([tfmRow(SEALED, 24), tfmRow(OCT, 24), tfmRow(NOV, 24), tfmRow(NOV + 6 * HOUR, 24, { actual_return_pct: null, actual_direction: null, correct: null, resolved_ts: null })]);
  assert.deepEqual(plain(t.map(r => [r.originTs, r.population, r.status])), [[OCT, 'post_seal_descriptive', 'resolved'], [NOV, 'prospective', 'resolved'], [NOV + 6 * HOUR, 'prospective', 'pending']]);
  assert.equal(t[1].actualPrice, 98000);                       // 100000 x (1 - 2%) from the stored realised return
  assert.equal(t[2].actualPrice, null);
  assert.equal(t[1].q10, null);                                // TimesFM persists no quantiles: no band is drawn
  const c = C([chrRow(SEALED, 12), chrRow(NOV, 12), chrRow(NOV + HOUR, 12, { status: 'pending', actual_price: undefined, actual_return_pct: undefined })]);
  assert.deepEqual(plain(c.map(r => [r.originTs, r.status, r.q10, r.q90])), [[NOV, 'resolved', 97000, 101000], [NOV + HOUR, 'pending', 97000, 101000]]);
  assert.match(c[0].source, /forecasts\/BTC\/12h\/x\.json \+ resolutions/);
  assert.deepEqual(plain(H.flTimesfmRows({ ok: false })), []);
  assert.deepEqual(plain(H.flChronosRows(null)), []);
});

test('forecasting lab: pairs share origin and horizon; disagreeing outcomes are excluded and counted; stats use one n', () => {
  const origins = Array.from({ length: 13 }, (_, i) => NOV + i * 12 * HOUR);
  const t = T(origins.map((o, i) => tfmRow(o, 24, { direction: i < 4 ? 'DOWN' : 'UP', predicted_return_pct: i < 4 ? -1 : 1 })));
  const c = C(origins.map((o, i) => chrRow(o, 24, { direction: i < 4 ? 'DOWN' : 'UP', persistence_correct: i < 7 ? 1 : 0, actual_direction: 'DOWN' })));
  const P = H.flPairs(t, c, 24, 'prospective');
  assert.equal(P.pairs.length, 13);
  const s = H.flDirectionStats(P);
  assert.deepEqual(plain(s.rows.map(r => [r.key, r.k, r.n])), [['timesfm', 4, 13], ['chronos', 4, 13], ['always_up', 0, 13], ['persistence', 7, 13]]);
  const ci = s.rows[0].ci;
  assert.ok(Math.abs(ci[0] - 0.1268) < 0.001 && Math.abs(ci[1] - 0.5765) < 0.001, 'Wilson 95% as in evaluate.py');
  // A pair whose two stored outcomes disagree is excluded; a Chronos row without a resolved TimesFM partner is unpaired.
  const c2 = C([chrRow(origins[0], 24, { actual_direction: 'UP' }), chrRow(origins[1], 24), chrRow(NOV + 999 * HOUR, 24)]);
  const P2 = H.flPairs(T([tfmRow(origins[0], 24), tfmRow(origins[1], 24)]), c2, 24, null);
  assert.deepEqual([P2.pairs.length, P2.excludedDisagreeing, P2.unpaired], [1, 1, 1]);
  // Other horizon and descriptive population stay out of the prospective sample.
  assert.equal(H.flPairs(T([tfmRow(OCT, 24)]), C([chrRow(OCT, 24)]), 24, 'prospective').pairs.length, 0);
  assert.equal(H.flPairs(T([tfmRow(NOV, 12)]), C([chrRow(NOV, 12)]), 24, null).pairs.length, 0);
  // Persistence is reported only when recorded for every pair.
  const P3 = H.flPairs(T([tfmRow(NOV, 24)]), C([chrRow(NOV, 24, { persistence_correct: null })]), 24, null);
  assert.equal(H.flDirectionStats(P3).rows[3].rate, null);
});

test('forecasting lab: error metrics, scatter classes, windows and cumulative hit rate', () => {
  const P = H.flPairs(T([tfmRow(NOV, 24, { predicted_return_pct: 1, forecast_price: 101000 }), tfmRow(NOV + 24 * HOUR, 24, { predicted_return_pct: -3, forecast_price: 97000, direction: 'DOWN' })]),
    C([chrRow(NOV, 24), chrRow(NOV + 24 * HOUR, 24)]), 24, null);
  const e = H.flErrorStats(P, 'timesfm');
  assert.equal(e.n, 2);
  assert.equal(e.mae, (3 + 1) / 2);                            // |1 - (-2)| and |-3 - (-2)|
  assert.equal(e.rmse, Math.sqrt((9 + 1) / 2));
  assert.equal(e.bias, (3 - 1) / 2);
  assert.ok(Math.abs(e.mape - ((3000 / 98000 + 1000 / 98000) / 2 * 100)) < 1e-9);
  assert.deepEqual(plain(H.flErrorStats({ pairs: [] }, 'chronos')), { model: 'chronos', n: 0, mae: null, rmse: null, mape: null, bias: null });
  const sc = H.flScatterPoints(P.pairs.map(p => p.timesfm));
  assert.deepEqual(plain(sc.map(p => p.kind)), ['wrong direction', 'right direction, overestimated']);
  assert.deepEqual(plain(H.flScatterPoints(C([chrRow(NOV, 24, { predicted_return_pct: -1 })]))).map(p => p.kind), ['right direction, underestimated']);
  assert.deepEqual(plain(H.flWindowStats(P, 7 * 24 * HOUR, NOV + 2 * 24 * HOUR)), { n: 2, sufficient: false });
  const many = Array.from({ length: 10 }, (_, i) => NOV + i * 24 * HOUR);
  const PM = H.flPairs(T(many.map(o => tfmRow(o, 24, { direction: 'DOWN' }))), C(many.map(o => chrRow(o, 24))), 24, null);
  assert.deepEqual(plain(H.flWindowStats(PM, Infinity, NOV)), { n: 10, sufficient: true, timesfm: 1, chronos: 1 });
  assert.deepEqual(plain(H.flCumulative(P).map(c => [c.n, c.timesfm, c.chronos])), [[1, 0, 1], [2, 0.5, 1]]);
});

test('forecasting lab: agreement only at a shared origin and horizon; missing is never a consensus', () => {
  const a = H.flAgreement(T([tfmRow(NOV, 12, { direction: 'UP' })]), C([chrRow(NOV, 12, { direction: 'DOWN' })]), 12);
  assert.deepEqual([a.state, a.shared, a.agreed, a.persistence], ['disagree', 1, 0, 'DOWN']);
  const b = H.flAgreement(T([tfmRow(NOV, 12, { direction: 'DOWN' })]), C([chrRow(NOV, 12)]), 12);
  assert.equal(b.state, 'agree');
  const m = H.flAgreement(T([tfmRow(NOV + 12 * HOUR, 12)]), C([chrRow(NOV, 12)]), 12);
  assert.deepEqual([m.state, m.shared, m.chronos], ['missing', 0, null]);
  assert.equal(H.flAgreement([], [], 24).state, 'missing');
});

test('forecasting lab: model status comes from persisted rows, never from a workflow existing', () => {
  assert.equal(H.flModelCard('timesfm', [], NOV, null).status, 'NO PERSISTED RESULTS');
  const rows = T([tfmRow(NOV, 12), tfmRow(NOV, 24), tfmRow(OCT, 12), tfmRow(NOV + 12 * HOUR, 12, { actual_return_pct: null, resolved_ts: null })]);
  const fresh = H.flModelCard('timesfm', rows, NOV + 13 * HOUR, null);
  assert.deepEqual([fresh.status, fresh.tone, fresh.pending, fresh.progress[12], fresh.progress[24], fresh.evaluated], ['PRODUCING FORECASTS', 'good', 1, 1, 1, false]);
  assert.equal(H.flModelCard('timesfm', rows, NOV + 60 * HOUR, null).status, 'STALE');
  const failed = H.flModelCard('chronos', C([chrRow(NOV, 12)]), NOV + HOUR, [{ run_ts: NOV + HOUR, errors: 1 }]);
  assert.deepEqual([failed.status, failed.tone], ['LAST RUN FAILED', 'bad']);
});

test('forecasting lab: PEV-1 sentiment evaluation is read from the frozen report, decisions passed through', () => {
  const rep = { protocol: 'PEV-1', generated_at: 1793503668639, coins: { BTC: { '12h': { test: { n_units: 21, excluded: { unresolved: 1 },
    models: { always_up: { balanced_accuracy: 0.5, ba_ci95: [0.5, 0.5], brier: 0.5714, brier_ci95: [0.381, 0.7619] }, B: { balanced_accuracy: 0.4444, ba_ci95: [0.24, 0.67], brier: 0.316 }, C: { balanced_accuracy: 0.3889, ba_ci95: [0.1786, 0.6058], brier: 0.2861 } },
    paired: { 'C-B': { d_brier: -0.03, d_brier_ci95: [-0.13, 0.07], d_balanced_accuracy: -0.056, d_ba_ci95: [-0.34, 0.23] } }, decision: { C: 'NOT DEMONSTRATED' } } } } } };
  const m = H.flPev1Model(rep, 'BTC');
  assert.equal(m.horizons.length, 1);
  const h = m.horizons[0];
  assert.deepEqual([h.horizon, h.n, h.decision.C], ['12h', 21, 'NOT DEMONSTRATED']);
  assert.deepEqual(plain(h.models.map(x => x.key)), ['always_up', 'B', 'C']);   // only what the report holds
  assert.deepEqual(plain(h.cMinusB), { dBrier: -0.03, dBrierCi: [-0.13, 0.07], dBa: -0.056, dBaCi: [-0.34, 0.23] });
  assert.equal(H.flPev1Model(rep, 'ETH'), null);
  assert.equal(H.flPev1Model(null, 'BTC'), null);
});

test('forecasting lab: ledger filters by model, horizon, status, sample, date and text', () => {
  const rows = [...T([tfmRow(NOV, 12), tfmRow(OCT, 24)]), ...C([chrRow(NOV, 24, { status: 'pending', actual_return_pct: undefined })])];
  const f = (o) => H.flLedgerFilter(rows, { model: '', horizon: '', status: '', population: '', from: null, to: null, text: '', ...o }).map(r => r.model + r.horizon);
  assert.deepEqual(plain(f({})), ['timesfm24', 'timesfm12', 'chronos24']);   // TimesFM rows sorted by origin (OCT before NOV)
  assert.deepEqual(plain(f({ model: 'chronos' })), ['chronos24']);
  assert.deepEqual(plain(f({ horizon: '24' })), ['timesfm24', 'chronos24']);
  assert.deepEqual(plain(f({ status: 'pending' })), ['chronos24']);
  assert.deepEqual(plain(f({ population: 'post_seal_descriptive' })), ['timesfm24']);
  assert.deepEqual(plain(f({ from: NOV - HOUR })), ['timesfm12', 'chronos24']);
  assert.deepEqual(plain(f({ text: 'forecasts/btc/24h' })), ['chronos24']);
});

test('page source: Forecasting Lab reads persisted research results only', () => {
  assert.match(SRC, /FL_LEDGER_URL = 'https:\/\/raw\.githubusercontent\.com\/quiquandon-oss\/PulseWorkerV2\/refs\/heads\/research-data\/exp008-chronos\/exp008_chronos\/derived\/ledger\.json'/);
  assert.match(SRC, /\/research\/timesfm-recent\?horizon=12&limit=500/);
  const a = SRC.indexOf('// ---- Forecasting Lab: loading and rendering'), b = SRC.indexOf('buildSv2Periods();', a);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(SRC.slice(a, b), /Math\.random|\.fill\(|interpolat/i, 'no generated values');
  assert.match(SRC, /id="view-forecast"/);
  // Every report-derived string in the PEV-1 table is escaped (review finding).
  assert.match(SRC, /\$\{esc\(v\)\} excluded \(\$\{esc\(String\(k\)/);
});

test('sentiment v2: hourly V1 server readings are labelled per point and announced; the app-only line note goes away', () => {
  const pts = [
    { ts: NOW - 3 * HOUR, v1: 35, btc: 68856, v2: null, v1_origin: 'browser' },
    { ts: NOW - 2 * HOUR, v1: 37, btc: 66989, v2: 40, v2_status: 'OK', v1_origin: 'server' },
    { ts: NOW - HOUR, v1: 38, btc: 66500, v2: 41, v2_status: 'OK', v1_origin: 'server' },
  ];
  const m = H.sentimentV2Model(sv2({ points: pts, v1_server_input: { enabled: true, collector: 'scomp-v1', readings_in_period: 2, error: null } }), NOW);
  assert.deepEqual(plain(m.rows.map((r) => r.v1Origin)), ['browser', 'server', 'server']);
  assert.match(texts(m), /2 V1 points are hourly server readings .* drawn hollow/);
  assert.doesNotMatch(texts(m), /only recorded while the V1 app is open/);
  const err = H.sentimentV2Model(sv2({ points: pts.slice(0, 1), v1_server_input: { enabled: true, readings_in_period: 0, error: 'no such table' } }), NOW);
  assert.match(texts(err), /server readings could not be read/);
  const legacy = H.sentimentV2Model(sv2(), NOW);                    // Worker before the change: no origin, no notice
  assert.deepEqual(plain(legacy.rows.map((r) => r.v1Origin)), [null, null, null]);
  assert.doesNotMatch(texts(legacy), /server reading/);
});

test('sentiment v2: unscored hourly server points are not "missing V2"; V2 gets its own line-break scale', () => {
  const pts = [];
  for (let k = 12; k >= 1; k--) pts.push({ ts: NOW - k * HOUR, v1: 36, btc: 66000, v2: k % 4 === 0 ? 45 : null, v2_status: k % 4 === 0 ? 'OK' : null, v1_origin: 'server' });
  pts.push({ ts: NOW - 30 * 60000, v1: 35, btc: 66000, v2: null, v1_origin: 'browser' });
  const m = H.sentimentV2Model(sv2({ points: pts, v1_server_input: { enabled: true, readings_in_period: 12, error: null } },
    { v2: { first_ts: NOW - 12 * HOUR, last_ts: NOW - 4 * HOUR, points_in_period: 3, available: true, stale: false, insufficient_history: false } }), NOW);
  assert.match(texts(m), /Missing points: 1 V2/);            // only the app reading counts
  assert.ok(m.v2BreakMs >= 4 * HOUR, 'V2 readings 4 h apart stay connected');
});


// ---- GLM evidence layer ----
const glmStatusRes = (over = {}) => ({ ok: true, data: { ok: true, flags: { signal_enabled: true, inference_enabled: false, tick_hook_enabled: false, influence_cap: 0, mode: 'shadow' },
  blockers: ['inference disabled'], adjustment: { thresholds: 'provisional, not calibrated' },
  last_run: { run_id: 'glm_abc_1', decision_cutoff_ts: NOW - 7 * HOUR, finished_ts: NOW - 7 * HOUR + 3000, status: 'model_disabled', n_items: 61, n_excluded: 4, package_bytes: 22000, model: null },
  counts: { NO_SIGNAL: 3 }, ...over } });

test('GLM status: shadow by default, blockers and last run surfaced; failure is UNAVAILABLE, never OK', () => {
  const m = H.glmStatusModel(glmStatusRes());
  assert.deepEqual([m.state, m.mode, m.label, m.inferenceEnabled, m.tickHook], ['ok', 'shadow', 'SHADOW', false, false]);
  assert.equal(m.lastRun.statusText, 'GLM inference is switched off (no model call)');
  assert.deepEqual(plain(m.blockers), ['inference disabled']);
  assert.equal(H.glmStatusModel({ ok: false, error: 'HTTP 404' }).label, 'UNAVAILABLE');
  assert.equal(H.glmStatusModel(null).state, 'unavailable');
  const act = H.glmStatusModel({ ok: true, data: { ...glmStatusRes().data, flags: { mode: 'active', influence_cap: 0.05 } } });
  assert.equal(act.label, 'ACTIVE (cap 0.05)');
});

test('GLM signal: NO_SIGNAL is never shown as a direction; validity window and expiry; reasons in words', () => {
  const none = H.glmSignalModel(null, NOW);
  assert.deepEqual([none.direction, none.label], ['NO_SIGNAL', 'NO SIGNAL']);
  const sig = { signal_id: 's', run_id: 'r', horizon_hours: 24, direction: 'DOWN', strength: 'moderate', eligibility: 'CANDIDATE', decision_cutoff_ts: NOW - 7 * HOUR,
    valid_from_ts: NOW - 7 * HOUR, valid_until_ts: NOW + 17 * HOUR, reasons: ['first_day_candidate'], supporting_families: ['model_forecast', 'news'], would_apply: -0.0333, models_live: 1 };
  const m = H.glmSignalModel(sig, NOW);
  assert.deepEqual([m.direction, m.label, m.valid, m.expired], ['DOWN', 'DOWN · CANDIDATE', true, false]);
  assert.deepEqual(plain(m.reasons), ['first day in this direction (needs 2 consecutive days)']);
  assert.equal(H.glmSignalModel({ ...sig, valid_until_ts: NOW - 1 }, NOW).label, 'DOWN · CANDIDATE · EXPIRED');
  const ns = H.glmSignalModel({ ...sig, direction: 'NO_SIGNAL', eligibility: 'NO_SIGNAL', reasons: ['model_disabled'] }, NOW);
  assert.deepEqual([ns.label, ns.tone], ['NO SIGNAL', 'neutral']);
  assert.equal(H.glmReasonText('unknown_code'), 'unknown_code');
});

test('GLM adjustments: baseline, shadow and final kept apart; hits computed only for resolved rows', () => {
  const res = { ok: true, data: { adjustments: [
    { prediction_ts: NOW - 30 * HOUR, baseline_p_up: 0.52, baseline_source: 'cycle_p_up', would_apply: -0.05, applied: 0, final_p_up: 0.52, mode: 'shadow', signal_status: 'ELIGIBLE', reason: 'shadow_cap_0', realized_up: 0 },
    { prediction_ts: NOW - 3 * HOUR, baseline_p_up: 0.6, baseline_source: 'p_up', would_apply: 0, applied: 0, final_p_up: 0.6, mode: 'shadow', signal_status: 'NO_SIGNAL', reason: 'no_signal', realized_up: null },
  ] } };
  const rows = H.glmAdjustmentRows(res);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].base, rows[0].final, rows[0].shadow, rows[0].hitBase, rows[0].hitShadow], [0.52, 0.52, 0.47, false, true]);
  assert.deepEqual([rows[1].resolved, rows[1].hitBase, rows[1].reason], [false, null, 'no signal']);
  assert.equal(H.glmAdjustmentRows({ ok: false }), null);
});

test('GLM evidence drill-down: grouped by class in fixed order; Gemini marked as interpretation; shared story keys flagged', () => {
  const run = { input_refs: [
    { ref: 'ev:1', class: 'collector_evidence', table: 'sv2_evidence', id: '1', family: 'news', key: 'url:https://a.com/x', fa: NOW - 5 * HOUR, basis: 'retrieved_ts' },
    { ref: 'cat:2', class: 'gemini_interpretation', table: 'coin_catalyst_log', id: '2', family: 'news', key: 'url:https://a.com/x', fa: NOW - 6 * HOUR, basis: 'created_ts', derived_from: ['src:url:2'], verification: 'original_linked' },
    { ref: 'tfm:9', class: 'forecast_timesfm', table: 'experiment_4_timesfm', id: '9', family: 'model_forecast', key: 'model:timesfm', fa: NOW - 14 * HOUR, basis: 'created_ts' },
  ] };
  const g = H.glmEvidenceGroups(run);
  assert.deepEqual(plain(g.map(x => x.cls)), ['forecast_timesfm', 'gemini_interpretation', 'collector_evidence']);
  assert.equal(g[1].interpretation, true);
  assert.equal(g[1].label, 'Existing Gemini interpretation (stored)');
  assert.deepEqual(plain(g[1].items[0].derivedFrom), ['src:url:2']);
  assert.equal(g[1].items[0].verification, 'original_linked');
  assert.equal(g[0].items[0].verification, null);
  assert.equal(g[1].items[0].sharedKey, true);
  assert.equal(g[0].items[0].sharedKey, false);
  assert.deepEqual(plain(H.glmEvidenceGroups(null)), []);
});

test('API base: production by default, staging only with ?api=staging', () => {
  assert.equal(H.apiBaseFor(''), 'https://pulseworker-v2.quiquandon.workers.dev');
  assert.equal(H.apiBaseFor('?view=forecast&api=staging'), 'https://pulseworker-v2-staging.quiquandon.workers.dev');
  assert.equal(H.apiBaseFor('?api=stagingx'), 'https://pulseworker-v2.quiquandon.workers.dev');
});

test('GLM panel: three separate blocks; GLM labelled as not a forecast; escaped output; no Gemini API call added', () => {
  for (const id of ['glmForecasts', 'glmSignal', 'glmAdjust', 'glmEvidence', 'glmHistory']) assert.ok(SRC.includes(`id="${id}"`), id);
  assert.match(SRC, /1 · Numerical forecasts/);
  assert.match(SRC, /2 · GLM interpretation &amp; signal/);
  assert.match(SRC, /3 · V2 production: baseline → adjustment → final/);
  assert.match(SRC, /it is not a price forecast/);
  const panel = SRC.slice(SRC.indexOf('function renderGlmPanel('), SRC.indexOf('function renderFlCards('));
  assert.ok(panel.length > 1000);
  assert.ok(!/generativelanguage|gemini-[0-9]/i.test(panel), 'no Gemini endpoint in the GLM panel');
  // every interpolated API string in the panel goes through esc() or a numeric formatter
  for (const m of panel.matchAll(/\$\{(it|g|x|f|r)\.(ref|table|claim|relation|label|gemini_ref|original_ref|run_status|baseSource)\b/g)) assert.fail('unescaped ' + m[0]);
});

test('GLM influence: active + non-zero adjustment headlines final_p_up, keeps the baseline, explains why', () => {
  const g = { mode: 'active', baseline_p_up: 0.6, final_p_up: 0.58, adjustment: -0.02, cap: 0.03, direction: 'DOWN', strength: 'moderate',
    explanation: { rationale: 'Fed release and both models point down', findings: [{ claim: 'TimesFM and Chronos forecast DOWN' }] } };
  const h = H.headlineOf({ status: 'ok', p_up: 0.6, glm: g });
  assert.equal(h.pUp, 0.58); assert.equal(h.basePUp, 0.6); assert.equal(h.glmApplied, true);
  const n = H.glmHeadlineNote(h);
  assert.match(n.text, /model 60% → 58% \(-2 pts, down moderate signal, capped at 3 pts\)/);
  assert.equal(n.why, 'Fed release and both models point down');
  assert.deepEqual(n.findings, ['TimesFM and Chronos forecast DOWN']);
});
test('GLM influence: shadow mode or zero adjustment never changes the headline', () => {
  for (const g of [{ mode: 'shadow', final_p_up: 0.58, adjustment: 0 }, { mode: 'active', final_p_up: 0.6, adjustment: 0 }, { mode: 'active', final_p_up: 'x', adjustment: -0.02 }]) {
    const h = H.headlineOf({ status: 'ok', p_up: 0.6, glm: g });
    assert.equal(h.pUp, 0.6); assert.equal(H.glmHeadlineNote(h), null);
  }
});

// ---- Stage 2 frontend foundation: navigation, global chart standard, Comparison (descriptive) ----
test('navigation: nine areas in the contract order; Forecast is a Sentiment V2 tab; no Forecasting Lab', () => {
  assert.deepEqual(plain(H.AREAS.map((a) => a.label)), ['Overview', 'Portfolio', 'Sentiment V1', 'Sentiment V2', 'Comparison', 'Research', 'Learning & Audit', 'Alerts', 'Settings']);
  const v2 = H.AREAS.find((a) => a.key === 'sentiment-v2');
  assert.deepEqual(plain(v2.tabs.map((t) => t.key)), ['overview', 'forecast', 'model']);
  assert.ok(!H.AREAS.some((a) => /lab/i.test(a.label)), 'no Lab area');
  assert.doesNotMatch(SRC, />Forecasting Lab</, 'no Forecasting Lab heading or nav label');
  assert.equal(H.MOBILE_PRIMARY_AREAS.length, 4, 'four primary phone items plus More');
  for (const v of H.allAreaViews()) assert.match(SRC, new RegExp('id="view-' + v + '"'), 'container for ' + v);
});

test('navigation: routes resolve, unknown falls back to Overview, legacy links redirect', () => {
  const r = (h) => plain(H.resolveRoute(h));
  assert.deepEqual([r('').area, r('').view, r('').canonical], ['overview', 'dashboard', 'overview']);
  assert.deepEqual([r('#nonsense').canonical], ['overview']);
  assert.deepEqual([r('#sentiment-v2').canonical, r('#sentiment-v2').view], ['sentiment-v2/overview', 'sentiment']);
  assert.deepEqual([r('#sentiment-v2/forecast').view, r('#sentiment-v2/bogus').tab], ['forecast', 'overview']);
  assert.deepEqual([r('#forecast').canonical, r('#lab').canonical, r('#dashboard').canonical, r('#sentiment').canonical], ['sentiment-v2/forecast', 'sentiment-v2/model', 'overview', 'sentiment-v2/overview']);
  assert.deepEqual([r('#experiments').canonical, r('#history').canonical], ['research', 'learning']);
  assert.deepEqual([r('#learning').canonical, r('#learning').openLearning, r('#history').openLearning], ['learning', true, false]);
  assert.deepEqual(r('#learning').views, ['history', 'learningblock']);
  assert.equal(r('#SETTINGS').area, 'settings', 'case-insensitive');
});

test('chart standard: 24H / 7D / 1M / All in that order, 24H default', () => {
  assert.deepEqual(plain(H.CHART_PRESETS.map((p) => p.label)), ['24H', '7D', '1M', 'All']);
  assert.equal(H.CHART_DEFAULT_PRESET, '24H');
  assert.equal(H.chartPreset('nope').key, '24H');
  assert.match(SRC, /const RANGES = CHART_PRESETS;/);
  assert.match(SRC, /let activeRange = CHART_DEFAULT_PRESET;/);
  assert.match(SRC, /const LAB_RANGES = CHART_PRESETS;/);
  assert.match(SRC, /labChartRangeState\[stateKey\] = CHART_DEFAULT_PRESET;/);
  assert.match(SRC, /var FL_PERIODS = CHART_PRESETS\.map/);
  assert.match(SRC, /var _fl = \{ horizon: 24, period: CHART_DEFAULT_PRESET,/);
  assert.match(SRC, /var _sv2Period = '24h';/);
  assert.doesNotMatch(SRC, /key: '3M'|'90D'\]|\['90d'/, 'no off-standard presets left');
});

test('chart standard: clipping keeps real points only and reports coverage honestly', () => {
  const pts = [{ ts: NOW - 40 * 24 * HOUR }, { ts: NOW - 3 * 24 * HOUR }, { ts: NOW - 2 * HOUR }, { ts: 'bad' }, null];
  const d = plain(H.clipSeries(pts, 'ts', '24H', NOW));
  assert.deepEqual([d.points.length, d.coverage.n, d.coverage.nAll, d.limited], [1, 1, 3, false]);
  assert.equal(plain(H.clipSeries(pts, 'ts', '7D', NOW)).points.length, 2);
  assert.equal(plain(H.clipSeries(pts, 'ts', 'ALL', NOW)).points.length, 3, 'All = every valid point');
  const short = [{ ts: NOW - 3 * HOUR }, { ts: NOW - HOUR }];
  const s7 = H.clipSeries(short, 'ts', '7D', NOW);
  assert.equal(s7.limited, true);
  assert.match(H.coverageNote(s7.coverage, '7D', NOW), /^Data starts .* shorter than 7D\.$/);
  assert.match(H.coverageNote(H.clipSeries(short, 'ts', '24H', NOW).coverage, '24H', NOW), /shorter than 24H/, 'history really is shorter');
  assert.equal(H.coverageNote(H.clipSeries(pts, 'ts', '24H', NOW).coverage, '24H', NOW), '', 'long history: no note even if the window is sparse');
  assert.match(H.coverageNote(H.clipSeries([{ ts: NOW - 5 * 24 * HOUR }], 'ts', '24H', NOW).coverage, '24H', NOW), /^No data in the last 24H/);
  assert.equal(H.coverageNote(H.clipSeries([], 'ts', '24H', NOW).coverage, '24H', NOW), 'No data available yet.');
});

test('chart standard: one shared full-screen implementation with Esc and an exit label', () => {
  assert.match(SRC, /function chartFsEnter\(f\)/);
  assert.match(SRC, /ev\.key === 'Escape' && _fsActive/);
  assert.match(SRC, /'Exit full screen' : 'Expand chart to full screen'/);
  assert.match(SRC, /wireFullscreenToggle\('fullscreenBtn', 'chartSection', 'chartContainer'/);
  assert.match(SRC, /enableChartFullscreen\(id, \(\) => _fl\.charts\[id\]\)/, 'every Forecast chart');
  assert.match(SRC, /enableChartFullscreen\('sv2Chart'/);
  assert.match(SRC, /enableChartFullscreen\('v1Chart'/);
  assert.doesNotMatch(SRC, /let isFullscreen = false/, 'old one-off handler removed');
});

test('comparison (descriptive): counts only aligned pairs, never invents values', () => {
  const rows = [{ ts: 1, v1: 60, v2: 55 }, { ts: 2, v1: 40, v2: 52 }, { ts: 3, v1: 50, v2: 70 }, { ts: 4, v1: 61, v2: null }, { ts: 5, v1: null, v2: 48 }];
  const c = plain(H.cmpSentimentSummary(rows));
  assert.deepEqual([c.n, c.nRows, c.meanDiff, c.meanAbsDiff], [3, 5, 9, 12.3]);
  assert.deepEqual([c.sameSide, c.decided], [1, 2], 'a neutral V1 (50) is not counted as a side');
  assert.deepEqual(c.last, { ts: 3, v1: 50, v2: 70 });
  assert.deepEqual(plain(H.cmpSentimentSummary([{ ts: 1, v1: 50, v2: null }])), { n: 0, nRows: 1 });
  assert.deepEqual(plain(H.cmpSentimentSummary(null)), { n: 0, nRows: 0 });
});

test('comparison and V1 pages are read-only: no write call, no V1 write route', () => {
  const a = SRC.indexOf('// ---- Sentiment V1 (read-only) and Comparison'), b = SRC.indexOf('// ---- Learning & Audit: GLM-PE-1', a);
  assert.ok(a > 0 && b > a);
  const block = SRC.slice(a, b);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|DELETE)'|sentiment-ff75|txs-backup|foufi-check/);
  assert.match(block, /getJson\(WORKER_URL \+ '\/api\/sentiment-v2\/comparison\?period='/);
});

// ---- Stage 3/4: Forecast coverage, Research / Learning & Audit, V1 Foufi Daily ----
test('forecast coverage: counts per model/horizon and origins only one model covers; window respected', () => {
  const t = (o, h, st = 'resolved') => ({ model: 'timesfm', horizon: h, originTs: o, issuedTs: o + 10, status: st });
  const c = (o, h, st = 'resolved') => ({ model: 'chronos', horizon: h, originTs: o, issuedTs: o + 20, status: st });
  const T = [t(100, 24), t(200, 24, 'pending'), t(300, 24), t(100, 12)], C = [c(100, 24), c(300, 24, 'unreadable'), c(400, 24, 'pending')];
  const cov = plain(H.flCoverage(T, C, null));
  const get = (m, h) => cov.find((r) => r.model === m && r.horizon === h);
  assert.deepEqual([get('timesfm', 24).n, get('timesfm', 24).resolved, get('timesfm', 24).pending, get('timesfm', 24).onlyThis], [3, 2, 1, 1]);
  assert.deepEqual([get('chronos', 24).n, get('chronos', 24).unreadable, get('chronos', 24).onlyThis, get('chronos', 24).lastOrigin, get('chronos', 24).lastIssued], [3, 1, 1, 400, 420]);
  assert.equal(get('both', 24).n, 2);
  assert.deepEqual([get('chronos', 12).n, get('chronos', 12).lastOrigin, get('timesfm', 12).onlyThis], [0, null, 1], 'missing stays missing');
  assert.equal(plain(H.flCoverage(T, C, 250)).find((r) => r.model === 'timesfm' && r.horizon === 24).n, 1, 'window by input cutoff');
});

test('GLM-PE-1: no claim before 30 applied ticks, whatever the Worker flag says; errors are explicit', () => {
  const ev = (o, suff = false) => ({ ok: true, data: { ok: true, evaluation: { overall: o, sufficient_for_claims: suff, note: 'n' } } });
  const zero = H.glmEvalModel(ev({ ticks: 0, resolved: 0, applied_ticks: 0, directional_accuracy: { baseline: null, final: null }, brier: {} }));
  assert.deepEqual([zero.state, zero.verdict, zero.sufficient, zero.accFinal], ['ok', 'NO APPLIED ADJUSTMENT YET', false, null]);
  const few = H.glmEvalModel(ev({ ticks: 40, resolved: 35, applied_ticks: 12, directional_accuracy: { baseline: 0.5, final: 0.55 } }, true));
  assert.deepEqual([few.verdict, few.sufficient], ['INSUFFICIENT SAMPLE', false], 'Worker flag alone is not enough');
  assert.equal(H.glmEvalModel(ev({ applied_ticks: H.GLM_PE1_MIN_APPLIED }, true)).sufficient, true);
  assert.equal(H.glmEvalModel({ ok: false, error: 'HTTP 500' }).state, 'error');
});

test('Foufi Daily: V1 values as stored, invalid scores dropped, unstructured summaries not invented, stale flagged', () => {
  const NOW2 = NOW;
  const row = (over = {}) => ({ videoId: 'abc', title: 'T', url: 'https://www.youtube.com/watch?v=abc', publishedTs: NOW2 - 5 * HOUR, status: 'ok',
    summary: { market_summary: 'BTC fell.', macro: { lean: 'bearish', text: 'x' }, micro: { lean: 'weird', text: '' }, coins: { BTC: { score: -1, note: 'n' }, ETH: { score: 7 }, SOL: null }, dominant_driver: 'macro' }, ...over });
  const m = plain(H.foufiModel({ ok: true, data: { latest: [row(), row({ videoId: 'old', publishedTs: NOW2 - 20 * HOUR, summary: { raw: 'text' }, status: 'unstructured' })] } }, NOW2));
  assert.deepEqual([m.state, m.stale, m.items.length, m.items[0].videoId], ['ok', false, 2, 'abc']);
  assert.deepEqual(m.items[0].coins, [{ coin: 'BTC', score: -1, note: 'n' }], 'out-of-range and empty scores dropped');
  assert.deepEqual([m.items[0].macro.lean, m.items[0].micro.lean, m.items[0].driver], ['bearish', null, 'macro']);
  assert.deepEqual([m.items[1].structured, m.items[1].summaryText, m.items[1].coins.length], [false, null, 0]);
  assert.equal(plain(H.foufiModel({ ok: true, data: { latest: [row({ url: 'javascript:alert(1)' })] } }, NOW2)).items[0].url, null, 'only YouTube links');
  assert.equal(H.foufiModel({ ok: true, data: { latest: [row({ publishedTs: NOW2 - 40 * HOUR })] } }, NOW2).stale, true);
  assert.equal(H.foufiModel({ ok: true, data: { latest: [] } }, NOW2).state, 'empty');
  assert.equal(H.foufiModel({ ok: false, error: 'CORS' }, NOW2).state, 'error');
});

test('page structure: backtests live in Research; Learning & Audit holds prospective evaluations; V1 is read with GET only', () => {
  const sec = (id) => { const a = SRC.indexOf('<div id="' + id + '"'); const b = SRC.indexOf('\n  </div>\n', a); return SRC.slice(a, b); };
  assert.match(sec('view-experiments'), /historyBacktestTitle/);
  assert.match(sec('view-experiments'), /regimeSplitTitle/);
  assert.doesNotMatch(sec('view-history'), /historyBacktestTitle|regimeSplitTitle/);
  assert.match(SRC, /id="prospectiveCard"/);
  assert.equal(H.V1_WORKER_URL, 'https://sentiment-ff75.quiquandon.workers.dev');
  // V1 is called on exactly three routes (contracts §4/§6/§8): the digest (GET), the user's own backup (GET, explicit
  // click with confirmation, security register S-10) and the Narrative (POST, explicit click). Nothing else.
  const v1Calls = (SRC.match(/V1_WORKER_URL \+ '[^']+'/g) || []).sort();
  assert.deepEqual(v1Calls, ["V1_WORKER_URL + '/alert-configs'", "V1_WORKER_URL + '/alert-log?limit=50'", "V1_WORKER_URL + '/foufi-latest'", "V1_WORKER_URL + '/gemini-outlook'", "V1_WORKER_URL + '/trader-analysis-gemini'", "V1_WORKER_URL + '/txs-backup'", "V1_WORKER_URL + '/txs-backup'"]);   // backup: import + "Check against V1" (both GET, explicit clicks)
  assert.doesNotMatch(SRC, /test-telegram|alert-configs\/toggle|alert-configs\/delete/, 'V2 never changes or tests V1 alerts');
  const imp = SRC.slice(SRC.indexOf('async function pfImportFromV1()'), SRC.indexOf('function pfDownload'));
  assert.match(imp, /if\(!confirm\(/, 'V1 backup read only after confirmation');
  assert.match(imp, /getJson\(V1_WORKER_URL \+ '\/txs-backup'\)/, 'GET only');
  assert.doesNotMatch(SRC, /foufi-check|foufi-backfill|X-App-Secret|portfolio-log/);
});

// ---- Stage 7: Portfolio accounting (contracts §8.4/§8.6). Synthetic data only. ----
const PD = (d) => Date.parse(d + 'T00:00:00Z');
const pfStore = () => ({ accounts: [{ id: 'a', name: 'Exchange', kind: 'exchange' }, { id: 'b', name: 'Wallet', kind: 'wallet' }], txs: [
  { id: '1', account_id: 'a', ts: PD('2026-01-01'), type: 'deposit', asset: 'USD', qty: 10000 },
  { id: '2', account_id: 'a', ts: PD('2026-01-02'), type: 'buy', asset: 'BTC', qty: 0.1, price: 50000, price_ccy: 'USD', fee: 10, fee_ccy: 'USD' },
  { id: '3', account_id: 'a', ts: PD('2026-01-03'), type: 'buy', asset: 'BTC', qty: 0.1, price: 60000, price_ccy: 'USD' },
  { id: '4', account_id: 'a', ts: PD('2026-01-04'), type: 'sell', asset: 'BTC', qty: 0.05, price: 70000, price_ccy: 'USD', fee: 5, fee_ccy: 'USD' },
  { id: '5', account_id: 'a', ts: PD('2026-01-05'), type: 'transfer_out', asset: 'BTC', qty: 0.1, transfer_id: 'T1' },
  { id: '6', account_id: 'b', ts: PD('2026-01-05'), type: 'transfer_in', asset: 'BTC', qty: 0.0999, transfer_id: 'T1' },
  { id: '7', account_id: 'a', ts: PD('2026-01-06'), type: 'buy', asset: 'ETH', qty: 1, price: 2000, price_ccy: 'EUR' },
  { id: '8', account_id: 'b', ts: PD('2026-01-07'), type: 'reward', asset: 'BTC', qty: 0.001, price: 65000, price_ccy: 'USD' },
  { id: '9', account_id: 'a', ts: PD('2026-01-08'), type: 'buy', asset: 'LINK', qty: 100, price: 10, price_ccy: 'USD' },
  { id: '10', type: 'reversal', reverses_id: '9', ts: PD('2026-01-09') }] });
const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

test('portfolio: average cost with fees, realised P&L on a partial sell, unrealised at current price', () => {
  const m = H.pfCompute(pfStore(), { BTC: 70000, ETH: 3000 }, 1.1);
  const btc = m.positions.find((p) => p.asset === 'BTC');
  // buys 5,010 (incl. fee) + 6,000; sell 0.05 removes 25% of 11,010 = 2,752.50; proceeds 3,500 − 5 = 3,495 → realised 742.50
  assert.deepEqual([+btc.qty.toFixed(6), r2(btc.costUsd), r2(btc.realizedUsd)], [0.1509, 8322.5, 742.5]);
  assert.deepEqual([r2(btc.valueUsd), r2(btc.unrealizedUsd)], [10563, 2240.5]);
});

test('portfolio: own-account transfer moves quantity and cost, no buy/sell, no double count; network fee raises the average', () => {
  const m = H.pfCompute(pfStore(), { BTC: 70000 }, null);
  const ex = m.accounts.find((a) => a.id === 'a').positions.find((p) => p.asset === 'BTC'), w = m.accounts.find((a) => a.id === 'b').positions.find((p) => p.asset === 'BTC');
  assert.deepEqual([+ex.qty.toFixed(6), r2(ex.costUsd)], [0.05, 2752.5]);
  assert.deepEqual([+w.qty.toFixed(6), r2(w.costUsd)], [0.1009, 5570], 'transferred cost 5,505 + reward 65');
  assert.ok(w.avgCostUsd > ex.avgCostUsd, '0.0001 BTC network fee keeps the cost, so the average rises');
  assert.equal(r2(ex.costUsd + w.costUsd), r2(m.positions.find((p) => p.asset === 'BTC').costUsd), 'consolidated = sum of accounts');
  assert.equal(r2(w.realizedUsd), 0, 'a transfer realises nothing');
});

test('portfolio: missing FX is reported, never guessed; reversal removes the row without deleting it', () => {
  const st = pfStore(), m = H.pfCompute(st, { BTC: 70000, ETH: 3000 }, 1.1);
  const eth = m.positions.find((p) => p.asset === 'ETH');
  assert.deepEqual([eth.costUsd, eth.unrealizedUsd, eth.avgCostUsd, eth.costByCcy.EUR], [null, null, null, 2000]);
  assert.deepEqual(plain(m.issues.map((i) => i.code)), ['fx_missing']);
  assert.equal(m.totals.unrealizedUsd.complete, false);
  assert.equal(m.positions.some((p) => p.asset === 'LINK'), false, 'reversed buy has no effect');
  assert.equal(st.txs.length, 10, 'both rows stay in the ledger');
  st.txs[6] = { ...st.txs[6], fx_to_usd: 1.1 };
  assert.equal(r2(H.pfCompute(st, { ETH: 3000 }, 1.1).positions.find((p) => p.asset === 'ETH').costUsd), 2200, 'with an FX rate the USD cost is known');
});

test('portfolio: cash/dry powder from deposits, buys and sells; EUR cash converted only with a current rate', () => {
  const m = H.pfCompute(pfStore(), {}, 1.1);
  assert.deepEqual(plain(m.totals.cash), { USD: 2485, EUR: -2000 });
  assert.deepEqual([r2(m.totals.cashUsd.usd), m.totals.cashUsd.complete], [285, true]);
  assert.equal(H.pfCompute(pfStore(), {}, null).totals.cashUsd.complete, false);
});

test('portfolio: oversell, unmatched and in-transit transfers, reward without price are flagged', () => {
  const st = { accounts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], txs: [
    { id: '1', account_id: 'a', ts: 1, type: 'buy', asset: 'SOL', qty: 2, price: 100, price_ccy: 'USD' },
    { id: '2', account_id: 'a', ts: 2, type: 'sell', asset: 'SOL', qty: 3, price: 150, price_ccy: 'USD' },
    { id: '3', account_id: 'b', ts: 3, type: 'transfer_in', asset: 'ETH', qty: 1, transfer_id: 'X' },
    { id: '4', account_id: 'a', ts: 4, type: 'reward', asset: 'HYPE', qty: 5 },
    { id: '5', account_id: 'a', ts: 5, type: 'buy', asset: 'LINK', qty: 10, price: 10, price_ccy: 'USD' },
    { id: '6', account_id: 'a', ts: 6, type: 'transfer_out', asset: 'LINK', qty: 4, transfer_id: 'Y' }] };
  const m = H.pfCompute(st, {}, null);
  assert.deepEqual(plain(m.issues.map((i) => i.code)).sort(), ['in_transit', 'oversell', 'reward_no_price', 'unmatched_transfer_in']);
  const sol = m.positions.find((p) => p.asset === 'SOL');
  assert.deepEqual([sol.qty, r2(sol.realizedUsd)], [0, 100], 'only the 2 held are sold: 2×150 − 200');
  assert.equal(m.positions.find((p) => p.asset === 'HYPE').costUsd, 0, 'reward without a value counts at zero cost (flagged)');
  assert.equal(m.positions.find((p) => p.asset === 'LINK').qty, 6, 'in-transit LINK is in no account');
});

test('portfolio: validation of new rows', () => {
  const st = pfStore(), now = PD('2026-06-01');
  const v = (t) => plain(H.pfValidateTx({ id: 'n', account_id: 'a', ts: PD('2026-02-01'), ...t }, st, now));
  assert.deepEqual(v({ type: 'buy', asset: 'BTC', qty: 0.1, price: 1, price_ccy: 'USD' }), []);
  assert.ok(v({ type: 'buy', asset: 'BTC', qty: 0, price: 1, price_ccy: 'USD' }).includes('quantity must be above 0'));
  assert.ok(v({ type: 'buy', asset: 'EUR', qty: 1, price: 1, price_ccy: 'USD' }).some((e) => /use deposit/.test(e)));
  assert.ok(v({ type: 'buy', asset: 'BTC', qty: 1, price: 1, price_ccy: 'JPY' }).some((e) => /price currency/.test(e)));
  assert.ok(v({ type: 'deposit', asset: 'BTC', qty: 1 }).some((e) => /cash currency/.test(e)));
  assert.ok(v({ type: 'transfer_out', asset: 'BTC', qty: 1 }).includes('transfer id required'));
  assert.ok(v({ type: 'buy', asset: 'BTC', qty: 1, price: 1, price_ccy: 'USD', ts: PD('2026-07-01') }).includes('date is in the future'));
  assert.ok(v({ type: 'buy', asset: 'BTC', qty: 1, price: 1, price_ccy: 'USD', account_id: 'zz' }).includes('unknown account'));
  assert.ok(v({ id: '2', type: 'buy', asset: 'BTC', qty: 1, price: 1, price_ccy: 'USD' }).includes('duplicate id'));
  assert.ok(v({ type: 'reversal', reverses_id: '9' }).includes('already reversed'));
  assert.ok(v({ type: 'reversal', reverses_id: '10' }).some((e) => /cannot be reversed/.test(e)));
  assert.ok(v({ type: 'reversal', reverses_id: 'nope' }).some((e) => /existing transaction/.test(e)));
  assert.deepEqual(plain(H.PF_TYPES).sort(), ['buy', 'deposit', 'fee', 'reversal', 'reward', 'sell', 'transfer_in', 'transfer_out', 'withdrawal']);
});

test('portfolio: CSV parse/validate, export round-trip, duplicate key, V1 backup mapping', () => {
  const rows = H.pfParseCsv('﻿date,account,type,asset,qty,price,price_ccy,note\r\n2026-02-01,Exchange,buy,btc,0.01,50000,USD,"say ""hi"", ok"\n\n2026-02-02T10:30:00,Exchange,sell,BTC,0.005,52000,,\n');
  const p = plain(H.pfCsvRowsToTxs(rows));
  assert.deepEqual([p.items.length, p.items[0].tx.asset, p.items[0].tx.note, p.items[1].tx.ts, p.items[1].tx.price_ccy], [2, 'BTC', 'say "hi", ok', Date.parse('2026-02-02T10:30:00Z'), 'USD']);
  assert.deepEqual(plain(H.pfCsvRowsToTxs(H.pfParseCsv('foo,bar\n1,2'))).errors, ['missing columns: date, account, type, asset, qty']);
  const st = pfStore(), csv = H.pfToCsv(st), back = plain(H.pfCsvRowsToTxs(H.pfParseCsv(csv)));
  assert.equal(back.items.length, st.txs.length);
  assert.deepEqual([back.items[1].accountName, back.items[1].tx.type, back.items[1].tx.qty, back.items[1].tx.fee], ['Exchange', 'buy', 0.1, 10]);
  assert.equal(H.pfDedupKey(st.txs[1], 'Exchange'), H.pfDedupKey({ ...back.items[1].tx }, 'Exchange'), 'a re-import is recognised as a duplicate');
  const v1 = plain(H.pfFromV1Backup({ txs: [{ date: '2026-04-11', asset: 'BTC', acct: 'Neverless', type: 'buy', qty: 0.019, price: 84715.15, ccy: 'EUR' }] }));
  assert.deepEqual([v1.items[0].accountName, v1.items[0].tx.type, v1.items[0].tx.price_ccy, v1.items[0].tx.fx_to_usd, v1.items[0].tx.ts], ['Neverless', 'buy', 'EUR', null, PD('2026-04-11')]);
  assert.deepEqual(plain(H.pfFromV1Backup({ found: false })).errors, ['not a V1 backup (no txs list)']);
});

test('portfolio: dry powder follows the V1 rule; scenarios are partial when a price or cost is missing', () => {
  const r = plain(H.pfDryPowder({ qty: 1, avgCostUsd: 100 }, 100, 50));
  assert.deepEqual([r.newAvg, r.oldCost, r.newCost, r.addQty, r.shiftPct], [200 / 3, 100, 200, 2, (200 / 3 - 100)]);
  assert.equal(H.pfDryPowder({ qty: 1, avgCostUsd: null }, 100, 50).unknown, true);
  assert.equal(H.pfDryPowder({ qty: 1, avgCostUsd: 10 }, 100, null), null);
  const pos = [{ qty: 2, price: 100, costUsd: 150 }, { qty: 1, price: null, costUsd: 10 }];
  const s = plain(H.pfScenario(pos, 50));
  assert.deepEqual([s.valueUsd, s.pnlUsd, s.complete], [300, null, false]);
  assert.deepEqual(plain(H.pfScenario([{ qty: 2, price: 100, costUsd: 150 }], -10)), { pct: -10, valueUsd: 180, pnlUsd: 30, complete: true });
});

test('portfolio: no real personal transactions and no portfolio data in source; storage key is V2-only', () => {
  // V1's embedded portfolio data is read from V1's page at runtime ("Import V1 embedded data"); its literals must never be in V2.
  assert.doesNotMatch(SRC, /SEED_TXS\s*=\s*\[|INTEREST_EUR\s*=\s*\{|PRICE_HISTORY\s*=\s*\{|84715\.15|"acct":"(Revolut|Neverless)"/);
  assert.match(SRC, /var PF_STORE_KEY = 'cpv2_portfolio_v1';/);
  assert.doesNotMatch(SRC, /localStorage\.setItem\('cp2_/, 'never writes V1 keys');
  const pfBlock = SRC.slice(SRC.indexOf('// ---- Portfolio accounting'), SRC.indexOf('// ---- END view-model helpers ----')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(pfBlock, /predictions|sentiment_v2|glm_|WORKER_URL/, 'accounting never touches the prediction domain');
});

test('V1 alerts: read-only model; enabled first; bad params and errors explicit', () => {
  const cfg = { ok: true, data: { configs: [
    { id: 1, type: 'price', enabled: 0, params_json: '{"coin":"BTC","above":70000}', cooldown_minutes: 60, last_fired_ts: NOW - HOUR, fire_count: 3 },
    { id: 2, type: 'funding_spike', enabled: 1, params_json: 'not json', cooldown_minutes: null, last_fired_ts: null, fire_count: 0 }] } };
  const log = { ok: true, data: { log: [{ id: 1, ts: NOW - 2 * HOUR, config_id: 1, type: 'price', message: 'BTC above 70000' }, { id: 2, ts: 'bad' }] } };
  const m = plain(H.v1AlertsModel(cfg, log, NOW));
  assert.deepEqual([m.configsState, m.logState, m.enabledCount, m.configs[0].id, m.configs[0].params, m.configs[1].params], ['ok', 'ok', 1, 2, 'unreadable parameters', 'coin BTC · above 70000']);
  assert.deepEqual([m.log.length, m.lastFired], [1, NOW - 2 * HOUR]);
  const e = plain(H.v1AlertsModel({ ok: false, error: 'HTTP 500' }, { ok: true, data: { log: [] } }, NOW));
  assert.deepEqual([e.configsState, e.configsError, e.logState], ['error', 'HTTP 500', 'empty']);
});

// ---- Comparison (outcome-based) on the backend contract cmp-v1-v2-1. The fixtures are real: production D1 read
// 2026-11-20 with PulseWorkerV2 d061409's own SQL and functions (see _provenance in each file). ----
const CMP_SUM = JSON.parse(readFileSync(new URL('./fixtures/comparison-summary-btc24-2026-11-20.json', import.meta.url), 'utf8'));
const CMP_REC = JSON.parse(readFileSync(new URL('./fixtures/comparison-records-btc24-2026-11-20.json', import.meta.url), 'utf8'));
test('comparison: real production summary maps field by field, nothing recomputed', () => {
  const m = plain(H.cmpSummaryModel({ ok: true, data: CMP_SUM })), s = CMP_SUM.summary;
  assert.equal(m.state, 'ok');
  assert.deepEqual([m.nAligned, m.nResolved, m.nResolvedPairs, m.v1Coverage], [s.n_aligned, s.n_resolved, s.n_resolved_pairs, s.v1_coverage]);
  assert.deepEqual([m.accV1.rate, m.accV1.n, m.accV1.ci, m.accV2b.rate, m.accV2f.rate], [s.accuracy.v1.rate, s.accuracy.v1.n, s.accuracy.v1.ci95, s.accuracy.v2_baseline.rate, s.accuracy.v2_final.rate]);
  assert.deepEqual([m.brierV2b.score, m.brierV2f.score], [s.brier.v2_baseline.score, s.brier.v2_final.score]);
  assert.equal(m.bands.length, 3);
  assert.equal(m.bands.filter((b) => b.proposed).map((b) => b.band)[0], '45/55');
  assert.deepEqual([m.glm.adjusted, m.glm.changed_calls], [s.glm.adjusted, s.glm.changed_calls]);
  assert.equal(m.claim, s.claim);
  assert.equal(m.observational, /_observational$/.test(s.claim));
  for (const k of Object.keys(H.CMP_CLAIM_TEXT)) assert.ok(H.CMP_CLAIM_TEXT[k].length > 20);
});
test('comparison: not-deployed, missing-table and empty states are explicit; no figures', () => {
  assert.equal(H.cmpSummaryModel({ ok: false, error: 'not_found', data: { ok: false, error: 'not_found' } }).state, 'not_deployed');
  const e = H.cmpSummaryModel({ ok: false, error: 'comparison data unavailable', data: { reason: 'missing_table' } });
  assert.deepEqual([e.state, /missing_table/.test(e.note)], ['error', true]);
  assert.equal(H.cmpSummaryModel({ ok: true, data: { summary: { n_aligned: 0 } } }).state, 'empty');
  assert.equal(H.cmpSummaryModel({ ok: true, data: {} }).state, 'error');
});
test('comparison: real records keep decision time, V1 provenance and pending outcomes', () => {
  const rows = plain(H.cmpRecordRows({ ok: true, data: CMP_REC }, 50));
  assert.equal(rows.length, 50);
  for (const r of rows) {
    if (r.v1) { assert.ok(['server_composite_readings', 'history'].includes(r.v1.source)); assert.ok(r.v1.ageMin >= 0 && r.v1.ageMin <= 180, 'V1 at most 3 h before'); }
    if (r.outcome.status === 'resolved') assert.ok(r.outcome.resolved_ts >= r.ts, 'no outcome before the decision');
    assert.ok(r.target > r.ts);
  }
  assert.equal(H.cmpRecordRows({ ok: false }, 5), null);
});

// ---- Trader Analysis (Gemini) parity ----
import { createHash } from 'node:crypto';
test('trader parity: indicator functions are byte-identical to V1 (CryptoPulse index.html@9a5810c)', () => {
  const fnText = (name) => { const i = SRC.indexOf('function ' + name + '('); let j = SRC.indexOf('{', i), d = 0; for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } } };
  const pinned = { techSma: 'aaf9276f5a5a', techIchimoku: '4f034743a0e9', techRsi: 'c5103373e8ba', findLocalExtrema: '763e54dfe328', techIchimokuCloud: 'fc395ee4409c',
    techMaCrossoverEvent: 'a2fb750140be', techSwingStructure: '41ce0e4b3455', techRsiDivergence: '3fb844115936' };
  for (const [n, h] of Object.entries(pinned)) assert.equal(createHash('sha256').update(fnText(n)).digest('hex').slice(0, 12), h, n + ' differs from V1');
});
test('trader parity: technicals need 200 closes; known values on a synthetic series', () => {
  assert.equal(H.traderTechnicals(Array.from({ length: 150 }, (_, i) => ({ t: i, c: 100, v: 1 }))).ok, false);
  const up = Array.from({ length: 260 }, (_, i) => ({ t: i * 86400000, c: 100 + i, v: i === 259 ? 5 : 1 }));
  const t = plain(H.traderTechnicals(up));
  assert.deepEqual([t.ok, t.price, t.ma50, t.rsi14, t.cloud.position, t.volumeTrend, t.closeCount], [true, 359, 334.5, 100, 'above', 'above 20d average', 260]);
  assert.equal(t.tenkan, (359 + 351) / 2);
});
test('trader parity: payload only carries V2 data available at the snapshot; the rest is left to V1 as unavailable', () => {
  const SNAP = NOW;
  const tech = { ok: true, asOfTs: SNAP - 3 * HOUR, closeCount: 400, price: 61000, tenkan: 1, kijun: 2, ma50: 3, ma100: 4, ma200: 5, rsi14: 30, cloud: { position: 'below' }, crossover: { type: null }, swing: { structure: 'Mixed' }, divergence: { type: 'none' }, volume: 9, volumeTrend: 'N/A' };
  const sv = { decision_ts: SNAP - HOUR, calc_version: 'sv2-1.1.0', sentiment_score: 38, evidence: { 'ev:decrypt': { state: 'fresh', value: 37 }, 'ev:x': { state: 'stale', value: 50 } } };
  const ev = [{ title: 'Old news', retrieved_ts: SNAP - HOUR, lexicon_score: -2, family: 'market_sentiment_news' }, { title: 'From the future', retrieved_ts: SNAP + HOUR, lexicon_score: 3, family: 'x' }, { title: 'No score', retrieved_ts: SNAP - HOUR }];
  const p = plain(H.traderPayloadV2(tech, sv, ev, SNAP));
  assert.deepEqual(Object.keys(p.body).sort(), ['price', 'probabilityModel', 'sentiment', 'technicals', 'topHeadlines']);
  assert.deepEqual(p.body.sentiment, { composite: 38, sources: { 'V2 decrypt': 37 } }, 'only fresh sources');
  assert.deepEqual(p.body.topHeadlines.map((h) => h.title), ['Old news'], 'nothing retrieved after the snapshot');
  assert.deepEqual(p.body.probabilityModel, { insufficient: true, n: 0 });
  for (const k of ['liquidationClusters', 'whaleActivity', 'buyTheNews', 'regimeScorecard', 'nineMagFlags', 'sourceCorrelations']) assert.ok(!(k in p.body), k + ' not sent');
  const late = plain(H.traderPayloadV2({ ok: false, reason: 'x' }, { ...sv, decision_ts: SNAP + 1 }, [], SNAP));
  assert.ok(!('sentiment' in late.body) && !('price' in late.body), 'a V2 result newer than the snapshot is not used');
  assert.ok(late.provenance.every((r) => typeof r.status === 'string' && r.status.length > 3));
});

// ---- Break-even probability: validated against V1's own outputs (fixture produced by executing V1's code) ----
const BE_REF = JSON.parse(readFileSync(new URL('./fixtures/breakeven-v1-reference.json', import.meta.url), 'utf8'));
test('break-even: normCDF and realised volatility reproduce V1 exactly', () => {
  for (const { x, v } of BE_REF.norm) assert.equal(H.normCDF(x), v, 'normCDF(' + x + ')');
  for (const v of BE_REF.vols) assert.equal(H.beRealizedVol(v.prices), v.sigma, v.coin + ' sigma');
  assert.equal(H.beRealizedVol([1, 2, 3]), null, 'under 30 prices: V1 falls back');
  assert.deepEqual(plain(H.beSigma('BTC', [1, 2])), { sigma: 0.65, isLive: false });
  for (const [c, p] of Object.entries(BE_REF.coinParams)) assert.deepEqual([H.BE_COIN_PARAMS[c].mu, H.BE_COIN_PARAMS[c].sigma], [p.mu, p.sigma], c + ' calibration');
});
test('break-even: all 75 V1 reference probabilities reproduced exactly (5 coins × 3 targets × 5 horizons)', () => {
  assert.equal(BE_REF.cases.length, 75);
  for (const c of BE_REF.cases) assert.equal(H.beProba(c.S, c.target, c.T, c.mu, c.sigma), c.p, `${c.coin} K=${c.target} T=${c.T}`);
  assert.deepEqual(plain(H.BE_HORIZONS).map((h) => h[1]), [0.5, 0.75, 1, 2, 5]);
});
test('break-even table: unknown cost not computed; portfolio row only when cost exceeds value, as in V1', () => {
  const hist = { BTC: Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.01 * Math.sin(i))) };
  const pos = [{ asset: 'BTC', qty: 1, price: 90, avgCostUsd: 100, costUsd: 100, valueUsd: 90 }, { asset: 'ZZZ', qty: 1, price: 10, avgCostUsd: null, costUsd: null, valueUsd: 10 }];
  const t = plain(H.breakEvenTable(pos, hist));
  assert.equal(t.rows[0].isLive, true);
  assert.equal(t.rows[0].probs[2].p, H.beProba(90, 100, 1, 0.5, H.beRealizedVol(hist.BTC)));
  assert.deepEqual([t.rows[1].breakEven, t.portfolio, t.portfolioNote], [null, null, 'cost basis incomplete (FX missing)']);
  const t2 = plain(H.breakEvenTable([pos[0]], hist));
  assert.ok(t2.portfolio && t2.portfolio.ratio > 1);
  assert.equal(plain(H.breakEvenTable([{ ...pos[0], price: 120, valueUsd: 120 }], hist)).portfolioNote, 'portfolio is at or above break-even');
});

// ---- Historical FX: ECB euro reference rates (real ECB response saved 2026-11-20 from data-api.ecb.europa.eu) ----
const ECB_CSV = readFileSync(new URL('./fixtures/ecb-exr-usd-gbp-chf-2026-04.csv', import.meta.url), 'utf8');
test('ECB FX: parses the official CSV; USD per EUR as published, GBP/CHF as cross rates via EUR', () => {
  const r = plain(H.pfParseEcbCsv(ECB_CSV));
  assert.equal(r.EUR['2026-04-10'], 1.1711, 'ECB published 1.1711 USD per EUR on 10 Apr 2026');
  assert.equal(r.EUR['2026-04-14'], 1.1793);
  assert.equal(r.EUR['2026-04-11'], undefined, 'no ECB fixing on a Saturday');
  const gbp = ECB_CSV.split('\n').find((l) => l.includes('D.GBP.EUR') && l.includes(',2026-04-10,'));
  assert.ok(Math.abs(r.GBP['2026-04-10'] - 1.1711 / Number(gbp.split(',')[7])) < 1e-12);
  assert.equal(H.pfParseEcbCsv('foo,bar\n1,2'), null);
});
test('ECB FX: rate of the date or the last business day before it, never a later one, at most 10 days back', () => {
  const t = { rates: H.pfParseEcbCsv(ECB_CSV) };
  const at = (d) => plain(H.pfFxLookup(t, 'EUR', Date.parse(d)));
  assert.deepEqual(at('2026-04-11T15:00:00Z'), { rate: 1.1711, date: '2026-04-10', cross: false }, 'Saturday -> Friday');
  assert.deepEqual(at('2026-04-13T23:59:00Z'), { rate: 1.1684, date: '2026-04-13', cross: false });
  assert.equal(H.pfFxLookup(t, 'EUR', Date.parse('2026-03-01T00:00:00Z')), null, 'before the table: missing, not the first later rate');
  assert.equal(H.pfFxLookup(t, 'EUR', Date.parse('2026-05-15T00:00:00Z')), null, 'more than 10 days after the last rate: missing');
  assert.equal(H.pfFxLookup(t, 'JPY', Date.parse('2026-04-10T00:00:00Z')), null);
});
test('ECB FX in the accounting: manual rate wins, ECB fills the rest, the ledger is not modified', () => {
  const st = { accounts: [{ id: 'a', name: 'A' }], fxRates: { source: 'ECB', fetched_at: 1, rates: H.pfParseEcbCsv(ECB_CSV) }, txs: [
    { id: '1', account_id: 'a', ts: Date.parse('2026-04-11T10:00:00Z'), type: 'buy', asset: 'BTC', qty: 1, price: 60000, price_ccy: 'EUR' },
    { id: '2', account_id: 'a', ts: Date.parse('2026-04-14T10:00:00Z'), type: 'buy', asset: 'ETH', qty: 1, price: 2000, price_ccy: 'EUR', fx_to_usd: 1.2 },
    { id: '3', account_id: 'a', ts: Date.parse('2026-02-01T10:00:00Z'), type: 'buy', asset: 'SOL', qty: 1, price: 100, price_ccy: 'EUR' }] };
  const before = JSON.stringify(st.txs);
  const m = H.pfCompute(st, { BTC: 80000, ETH: 3000, SOL: 100 }, null);
  const pos = (a) => m.positions.find((p) => p.asset === a);
  assert.equal(pos('BTC').costUsd, 60000 * 1.1711, 'Saturday buy at Friday\'s ECB rate');
  assert.equal(pos('ETH').costUsd, 2400, 'own rate wins over ECB');
  assert.equal(pos('SOL').costUsd, null, 'no ECB rate on or before the date: still missing');
  assert.deepEqual(plain(m.fxUse), { manual: 1, ecb: 1, missing: 1 });
  assert.equal(JSON.stringify(st.txs), before, 'transactions unchanged');
});

// ---- Revolut / Neverless statements (V1 parity). Synthetic rows only, shaped like the V1-supported exports. ----
const REV_HEAD = ['Symbol', 'Type', 'Quantity', 'Price', 'Value', 'Fees', 'Date'];
const revRows = [REV_HEAD,
  ['ETH', 'Buy', '0.00100000', '€1,900.00', '€1.90', '€0.00', 'Apr 10, 2026, 3:41:03 PM'],
  ['LINK', 'Buy - Revolut X', '2', '$8.50', '$17.00', '$0.00', 'May 7, 2026, 9:00:00 AM'],
  ['ETH', 'Staking reward', '0.00000343', '', '', '', 'May 8, 2026, 1:00:00 AM'],
  ['BTC', 'Buy', '0.00001', '1,500,000,000.00 IDR', '15.00 IDR', '', 'Jun 1, 2026, 2:00:00 PM'],
  ['LINK', 'Sell', '1', '€9,10', '€9,10', '', '2026-06-02'],
  ['XRP', 'Buy', '10', '€0.50', '€5.00', '', 'Jun 3, 2026'],
  ['EUR', 'Top-up', '100', '', '', '', 'Jun 3, 2026'],
  ['ETH', 'Buy', '', '€1,900.00', '', '', 'Jun 4, 2026']];

test('statement numbers and dates follow V1 (last separator is the decimal mark; Revolut, ISO, dd/mm/yyyy, Excel serial)', () => {
  assert.deepEqual([H.pfStmtNum('€1,908.30'), H.pfStmtNum('1.908,30'), H.pfStmtNum('7,75'), H.pfStmtNum('1,908'), H.pfStmtNum('$8.50'), H.pfStmtNum('138,920.02 IDR')], [1908.3, 1908.3, 7.75, 1908, 8.5, 138920.02]);
  assert.deepEqual([H.pfStmtDate('Apr 10, 2026, 3:41:03 PM'), H.pfStmtDate('2026-06-02T10:00:00Z'), H.pfStmtDate('02/06/2026'), H.pfStmtDate('46175'), H.pfStmtDate('junk')], ['2026-04-10', '2026-06-02', '2026-06-02', '2026-06-02', null]);
});
test('Revolut statement: buys in EUR, Revolut X in USD, staking reward at zero cost, IDR converted with V1 rate and ×1000 fix, sell kept', () => {
  assert.equal(H.pfDetectStatement(revRows), 'revolut');
  const m = H.pfFromRevolut(H.pfRowObjects(revRows));
  assert.deepEqual(plain(m.items.map((i) => [i.accountName, i.tx.type, i.tx.asset, i.tx.qty, +i.tx.price.toFixed(6), i.tx.price_ccy, new Date(i.tx.ts).toISOString().slice(0, 10)])), [
    ['Revolut', 'buy', 'ETH', 0.001, 1900, 'EUR', '2026-04-10'],
    ['Revolut', 'buy', 'LINK', 2, 8.5, 'USD', '2026-05-07'],
    ['Revolut', 'reward', 'ETH', 0.00000343, 0, 'USD', '2026-05-08'],
    ['Revolut', 'buy', 'BTC', 0.01, +(1500000000 / 17800).toFixed(6), 'EUR', '2026-06-01'],
    ['Revolut', 'sell', 'LINK', 1, 9.1, 'EUR', '2026-06-02']]);
  assert.equal(m.flags.length, 1);
  assert.match(m.items[3].tx.note, /17800 IDR\/EUR.*×1000/);
  assert.equal(m.items[0].tx.src_id, 'rev:ETH:Apr 10, 2026, 3:41:03 PM:0.00100000');
  assert.deepEqual(plain(m.skipped), { 'asset not tracked by V1 (XRP)': 1, 'not a buy, sell or staking reward': 1, 'missing quantity or date': 1 });
});
const NLV_HEAD = ['ID', 'Date', 'Type', 'Asset sent', 'Amount sent', 'Asset received', 'Amount received', 'USD price of asset received'];
const nlvRows = [NLV_HEAD,
  ['n1', '2026-03-01 10:00:00', 'Trade', 'USDT', '100', 'BTC', '0.001', '90000'],
  ['n2', '2026-04-11 09:00:00', 'Trade', 'EURC', '50', 'LINK', '3', '17'],
  ['n3', '2026-05-01 09:00:00', 'Trade', 'EURC', '45', 'LINK', '5', '9.5'],
  ['n4', '2026-05-02 00:05:00', 'Deposit', '', '', 'BTC', '0.0000012', '95000'],
  ['n5', '2026-05-03 12:00:00', 'Trade', 'LINK', '2', 'USDT', '19', '1'],
  ['n6', '2026-05-04 12:00:00', 'Trade', 'BTC', '0.0001', 'ETH', '0.003', '2000'],
  ['n7', '2026-05-05 12:00:00', 'Withdrawal', 'BTC', '0.001', '', '', '']];
test('Neverless statement: stable/fiat trades are USD buys, deposits are zero-cost rewards, V1 seed cutoff applies only when asked', () => {
  assert.equal(H.pfDetectStatement(nlvRows), 'neverless');
  const objs = H.pfRowObjects(nlvRows);
  const withSeed = H.pfFromNeverless(objs, H.PF_NEVERLESS_V1_SEED_DATE);
  assert.deepEqual(plain(withSeed.items.map((i) => [i.tx.type, i.tx.asset, i.tx.qty, i.tx.price, i.tx.price_ccy, i.tx.src_id])), [
    ['buy', 'LINK', 5, 9.5, 'USD', 'nlv:n3'], ['reward', 'BTC', 0.0000012, 0, 'USD', 'nlv:n4']]);
  assert.equal(withSeed.skipped['on or before the V1 seed date 2026-04-11 (already in the V1 balance)'], 2);
  assert.equal(Object.values(withSeed.skipped).reduce((a, b) => a + b, 0), 5);   // n1,n2 seed; n5 sell; n6 crypto-for-crypto; n7 withdrawal
  const full = H.pfFromNeverless(objs, null);
  assert.deepEqual(plain(full.items.map((i) => i.tx.src_id)), ['nlv:n1', 'nlv:n2', 'nlv:n3', 'nlv:n4']);
});
test('V1 duplicate rule: same account, day, asset and quantity; buy and reward match (V1 stores rewards as zero-price buys)', () => {
  const t = (type, qty, hour) => ({ type, asset: 'ETH', qty, ts: Date.UTC(2026, 4, 8, hour) });
  assert.equal(H.pfStmtMatchKey(t('reward', 0.00000343, 0), 'Revolut'), H.pfStmtMatchKey(t('buy', 0.00000343, 15), 'revolut'));
  assert.notEqual(H.pfStmtMatchKey(t('buy', 0.001, 0), 'Revolut'), H.pfStmtMatchKey(t('buy', 0.001, 0), 'Neverless'));
  assert.notEqual(H.pfStmtMatchKey(t('buy', 0.001, 0), 'Revolut'), H.pfStmtMatchKey(t('sell', 0.001, 0), 'Revolut'));
});
test('V1 backup: zero-price / isReward buys become zero-cost rewards (previously rejected), source ids kept', () => {
  const v = H.pfFromV1Backup({ txs: [{ date: '2026-04-11', asset: 'LINK', acct: 'Neverless', type: 'buy', qty: 65.9, price: 16.9, ccy: 'EUR' },
    { date: '2026-05-08', asset: 'ETH', acct: 'Revolut', type: 'buy', qty: 0.00000343, price: 0, ccy: 'EUR', isReward: true, srcId: 'rev:ETH:x:0.00000343' }] });
  assert.deepEqual(plain(v.items.map((i) => [i.tx.type, i.tx.price, i.tx.price_ccy, i.tx.src_id])), [['buy', 16.9, 'EUR', null], ['reward', 0, 'USD', 'rev:ETH:x:0.00000343']]);
  const store = { accounts: [{ id: 'a1', name: 'Neverless' }], txs: [] };
  assert.equal(H.pfValidateTx({ id: 'x', account_id: 'a1', ...v.items[1].tx }, store, NOW + 400 * 86400000).length, 0);
  assert.equal(H.pfHasV1NeverlessSeed(store), false);
  store.txs.push({ id: 's', account_id: 'a1', ...v.items[0].tx });
  assert.equal(H.pfHasV1NeverlessSeed(store), true);
});
test('XLSX sheet rows: shared strings, inline strings, numbers and empty cells keep their columns', () => {
  const shared = '<sst><si><t>Symbol</t></si><si><t>Type</t></si><si><r><t>Buy</t></r><r><t xml:space="preserve"> - Revolut X</t></r></si><si><t>$8.50</t></si></sst>';
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Price</t></is></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>LINK</t></is></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>2</v></c><c r="D2" t="s"><v>3</v></c></row><row r="3"/></sheetData></worksheet>';
  assert.deepEqual(plain(H.pfXlsxSheetRows(sheet, shared)), [['Symbol', 'Type', '', 'Price'], ['LINK', 'Buy - Revolut X', '2', '$8.50']]);
});
test('portfolio import UI: accepts XLSX, explains the V1 order (backup, then statements), statement path before generic CSV', () => {
  assert.match(SRC, /id="pfImportFile" type="file" accept="[^"]*\.xlsx/);
  assert.match(SRC, /Same portfolio as V1/);
  assert.ok(SRC.indexOf('if(pfImportStatement(csvRows, h)) return;') < SRC.indexOf('const parsed = pfCsvRowsToTxs(csvRows);'));
  assert.match(SRC, /pfImportCandidates\(v1\.items, 'v1_backup_route', null, \{ v1Match: true \}\)/);
});

// ---- V1 embedded data (synthetic page shaped like V1's embedded block) ----
const V1_PAGE = '<script>\n// ====== EMBEDDED ======\nconst PRICE_HISTORY={"BTC":{"2026-04-10":70000,"2026-04-11":72000,"2026-04-12":73000},"LINK":{"2026-04-11":10,"2026-04-12":11}};\n'
  + '// interest\nconst INTEREST_EUR={"2026-04-11":0.0,"2026-04-30":3.5,"2026-05-15":5.0,"2026-05-31":6.25,"2026-06-10":7.0};\n'
  + '// seed\nconst SEED_TXS=[{"date":"2026-04-11","asset":"BTC","acct":"Neverless","type":"buy","qty":0.02,"price":84000,"ccy":"EUR"},{"date":"2026-04-12","asset":"LINK","acct":"Revolut","type":"buy","qty":3,"price":9,"ccy":"EUR"}];\n</script>';
test('V1 embedded data: the three constants are read as JSON; missing ones are reported, not guessed', () => {
  const e = H.pfParseV1Embedded(V1_PAGE);
  assert.deepEqual(plain([e.seedTxs.length, Object.keys(e.interestEur).length, Object.keys(e.priceHistory), e.errors]), [2, 5, ['BTC', 'LINK'], []]);
  const bad = H.pfParseV1Embedded('<script>\nconst SEED_TXS=[{"a":1}];\n</script>');
  assert.deepEqual(plain(bad.errors), ['INTEREST_EUR not found in the V1 page', 'PRICE_HISTORY not found in the V1 page']);
  assert.deepEqual(H.pfParseV1Embedded('const SEED_TXS=foo();').errors[0], 'SEED_TXS is not plain JSON');
});
test('V1 Neverless interest (V1 interestEUR): series value on or before the day, then extended at the last 5 days’ average', () => {
  const series = { '2026-04-11': 0, '2026-06-20': 14.43, '2026-06-21': 14.64, '2026-06-22': 14.84, '2026-06-23': 15.05, '2026-06-24': 15.26, '2026-06-26': 15.67 };
  assert.equal(H.pfV1InterestAt(series, '2026-04-10'), 0);
  assert.equal(H.pfV1InterestAt(series, '2026-06-25'), 15.26);
  const inc = (15.67 - 14.43) / 5;   // V1: (last entry − entry 5 before it) / 5, per calendar day after the last entry (as V1)
  assert.ok(Math.abs(H.pfV1InterestAt(series, '2026-11-20') - (15.67 + inc * 147)) < 1e-9);
  assert.equal(H.pfV1InterestAt({}, '2026-11-20'), 0);
});
test('Align plan also reverses the monthly interest deposits of earlier V2 imports (V1 values interest by accrual)', () => {
  const store = { accounts: [{ id: 'n', name: 'Neverless' }], txs: [{ id: 'd1', account_id: 'n', type: 'deposit', asset: 'EUR', qty: 3.5, ts: Date.UTC(2026, 3, 30), src_id: 'v1int:2026-04' },
    { id: 'd2', account_id: 'n', type: 'deposit', asset: 'EUR', qty: 100, ts: Date.UTC(2026, 3, 30) }] };
  assert.deepEqual(plain(H.pfV1RepairPlan(store)), ['d1']);
});
test('daily value history: holdings at the end of each UTC day × that day’s price; a reversal voids its row on every day', () => {
  const e = H.pfParseV1Embedded(V1_PAGE);
  const seed = H.pfFromV1Backup({ txs: e.seedTxs }, 'V1 embedded data');
  assert.match(seed.items[0].tx.note, /V1 embedded data/);
  const store = { accounts: [{ id: 'n', name: 'Neverless' }, { id: 'r', name: 'Revolut' }], snapshots: [],
    txs: seed.items.map((it, k) => ({ id: 's' + k, account_id: it.accountName === 'Neverless' ? 'n' : 'r', ...it.tx })) };
  assert.equal(H.pfHasV1NeverlessSeed(store), true);
  const h = H.pfDailyHistory(store, e.priceHistory, '2026-04-13');
  assert.deepEqual(plain(h.map((x) => [new Date(x.ts).toISOString().slice(0, 10), x.totalUsd, x.complete])), [
    ['2026-04-11', 1440, true], ['2026-04-12', 0.02 * 73000 + 3 * 11, true], ['2026-04-13', 0, false]]);   // no price on 04-13: partial
  store.txs.push({ id: 'rv', type: 'reversal', reverses_id: 's1', ts: Date.UTC(2026, 10, 20) });
  assert.equal(H.pfDailyHistory(store, e.priceHistory, '2026-04-12')[1].totalUsd, 0.02 * 73000);
  assert.deepEqual(plain(H.pfCandlesToDaily([{ t: Date.UTC(2026, 6, 1), c: '61000.5' }, { t: 'x', c: 1 }, { t: Date.UTC(2026, 6, 2), c: '0' }])), { '2026-07-01': 61000.5 });
});
test('V1 alignment: Neverless statement rows on or before the seed date are planned for reversal only when V1’s seed is in the ledger', () => {
  const day = (d) => Date.parse(d + 'T00:00:00Z');
  const store = { accounts: [{ id: 'n', name: 'Neverless' }, { id: 'r', name: 'Revolut' }], txs: [
    { id: 'seed', account_id: 'n', type: 'buy', asset: 'LINK', qty: 65.9, price: 16.9, price_ccy: 'EUR', ts: day('2026-04-11'), note: 'imported from V1 embedded data' },
    { id: 'old1', account_id: 'n', type: 'buy', asset: 'LINK', qty: 600, price: 15, price_ccy: 'USD', ts: day('2025-10-01'), src_id: 'nlv:a' },
    { id: 'old2', account_id: 'n', type: 'buy', asset: 'BTC', qty: 0.1, price: 90000, price_ccy: 'USD', ts: day('2026-04-11'), src_id: 'nlv:b' },
    { id: 'new', account_id: 'n', type: 'buy', asset: 'LINK', qty: 2, price: 11, price_ccy: 'USD', ts: day('2026-08-23'), src_id: 'nlv:c' },
    { id: 'rev', account_id: 'r', type: 'buy', asset: 'LINK', qty: 1, price: 8, price_ccy: 'EUR', ts: day('2026-01-01'), src_id: 'rev:x' }] };
  assert.deepEqual(plain(H.pfV1RepairPlan(store)), ['old1', 'old2']);
  store.txs.push({ id: 'r1', type: 'reversal', reverses_id: 'old1', ts: day('2026-11-20') });
  assert.deepEqual(plain(H.pfV1RepairPlan(store)), ['old2']);
  assert.deepEqual(plain(H.pfV1RepairPlan({ ...store, txs: store.txs.filter((t) => t.id !== 'seed') })), []);
  const c = H.pfV1Compare([{ acct: 'Neverless', asset: 'LINK', type: 'buy', qty: 65.9 }, { acct: 'Neverless', asset: 'LINK', type: 'buy', qty: 2 },
    { acct: 'Revolut', asset: 'LINK', type: 'buy', qty: 1 }], store);
  assert.deepEqual(plain(c.rows.map((r) => [r.account, r.asset, r.match])), [['Neverless', 'BTC', false], ['Neverless', 'LINK', true], ['Revolut', 'LINK', true]]);
  assert.equal(c.allMatch, false);
});
test('Neverless statements always skip rows up to V1’s starting balance (V1 rule), whatever the import order', () => {
  assert.match(SRC, /const cutoff = fmt === 'neverless' \? PF_NEVERLESS_V1_SEED_DATE : null;/);
  assert.match(SRC, /id="pfV1Check"/);
});
test('portfolio import UI: "Import V1 embedded data" reads V1’s public page; the data is not in V2’s source', () => {
  assert.match(SRC, /id="pfImportV1Embedded"/);
  assert.match(SRC, /PF_V1_PAGE_URL = 'https:\/\/raw\.githubusercontent\.com\/quiquandon-oss\/CryptoPulse\/main\/index\.html'/);
  assert.doesNotMatch(SRC, /^const (SEED_TXS|INTEREST_EUR|PRICE_HISTORY)=/m);
});

test('V1 backup: prices come from V1’s converted fields (IDR rows keep the raw IDR number in price)', () => {
  const v = H.pfFromV1Backup({ txs: [
    { date: '2026-07-19', asset: 'LINK', acct: 'Revolut', type: 'buy', qty: 0.05, price: 151539.49, ccy: 'EUR', eur: 8.5134, usd: 9.75, srcId: 'rev:LINK:a:0.05000000' },
    { date: '2026-07-02', asset: 'LINK', acct: 'Revolut', type: 'buy', qty: 2, price: 7.75, ccy: 'USD', eur: 6.77, usd: 7.75 },
    { date: '2026-05-03', asset: 'LINK', acct: 'Revolut', type: 'buy', qty: 1, price: 7.93, ccy: 'EUR' }] });
  assert.deepEqual(plain(v.items.map((i) => [i.tx.price, i.tx.price_ccy])), [[8.5134, 'EUR'], [7.75, 'USD'], [7.93, 'EUR']]);
  assert.match(v.items[0].tx.note, /151539\.49 was not in EUR/);
});
test('V1 check: compared up to V1’s last day per account; newer statement movements shown apart; reversed rows ignored', () => {
  const day = (d) => Date.parse(d + 'T00:00:00Z');
  const store = { accounts: [{ id: 'r', name: 'Revolut' }], txs: [
    { id: 'a', account_id: 'r', type: 'buy', asset: 'BTC', qty: 0.0007, ts: day('2026-10-01') },
    { id: 'b', account_id: 'r', type: 'buy', asset: 'BTC', qty: 0.0001, ts: day('2026-11-02') },
    { id: 'c', account_id: 'r', type: 'buy', asset: 'BTC', qty: 5, ts: day('2026-09-01') }, { id: 'x', type: 'reversal', reverses_id: 'c', ts: day('2026-11-20') },
    { id: 'd', account_id: 'r', type: 'sell', asset: 'BTC', qty: 0.0002, fee: 0.00001, fee_ccy: 'BTC', ts: day('2026-10-10') }] };
  const c = H.pfV1Compare([{ acct: 'Revolut', asset: 'BTC', type: 'buy', qty: 0.0007, date: '2026-10-01' }, { acct: 'Revolut', asset: 'BTC', type: 'sell', qty: 0.0002, date: '2026-10-23' }], store);
  assert.deepEqual(plain(c.rows.map((r) => [r.account, r.asset, +r.v1.toFixed(8), +r.v2.toFixed(8), r.match, +r.newer.toFixed(8), r.lastV1Day])), [['Revolut', 'BTC', 0.0005, 0.0005, true, 0.0001, '2026-10-23']]);
  assert.equal(c.allMatch, true);
});

