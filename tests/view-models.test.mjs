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
vm.runInContext(SRC.slice(a, b) + '\nthis.api = { headlineOf, forecastTileModel, predictionRunsModel, eventDetectionModel, collectorModel, variantCycleRows, exp002Model, nextTickTs, d1UsageModel, alertModel, sentimentV2Model, SV2_PERIODS, sv2LineBreakMs, sv2SeriesStyle, sv2AiAnnotationModel, sv2EvidenceModel, sv2StatusModel };', ctx);
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
  assert.deepEqual([ok.label, ok.tone, ok.total, ok.fresh, ok.onSchedule, plain(ok.versions)], ['ON SCHEDULE', 'good', 4, 4, 4, ['e0a174e']]);
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
  assert.deepEqual(rows.map((r) => r.variant), ['original', 'experimental', 'calibrated', 'challenger_flat', 'challenger_tilted', 'challenger_calibrated', 'challenger_momentum']);
  const by = Object.fromEntries(rows.map((r) => [r.variant, r]));
  assert.deepEqual([by.original.pUp, by.original.role, by.original.localN, by.original.lowN], [0.867, 'SERVED_FALLBACK', 13, false]);
  assert.deepEqual([by.experimental.pUp, by.experimental.role, by.experimental.lowN], [0.73, 'CANDIDATE', true]); // 0.73 is the cycle value, not scores[].p_up (0.487)
  assert.deepEqual([by.calibrated.pUp, by.calibrated.scored], [0.515, false]);
  assert.deepEqual([by.challenger_calibrated.pUp, by.challenger_momentum.role, by.challenger_momentum.localAccuracy], [0.55, 'SHADOW', null]);
  const sel = plain(H.variantCycleRows(predict({ selection: { ok: true, chosen_variant: 'calibrated', cleared_gate: true, scores: [] } })));
  assert.equal(sel.find((r) => r.variant === 'calibrated').role, 'SELECTED');
  assert.equal(sel.filter((r) => r.role === 'SELECTED' || r.role === 'SERVED_FALLBACK').length, 1); // exactly one production row
  assert.ok(plain(H.variantCycleRows(predict({ selection: null }))).every((r) => r.role === 'UNKNOWN' || r.role === 'SHADOW'));
  assert.equal(H.variantCycleRows({ ok: false }).length, 0);
  assert.equal(plain(H.variantCycleRows(predict({ challenger: null }))).find((r) => r.variant === 'challenger_flat').pUp, null);
});

test('EXP-002: counts and plan facts only', () => {
  const e = { status: 'ACCUMULATING', confidence_evidence_maturity: 'INSUFFICIENT_SAMPLE', current_sample_size: 110,
    current_measured_result: { logged_rows: 110, latest_row_ts: 123 },
    standalone_evaluations: [{ evaluation_version: 'exp002-standalone-v1', evaluation_status: 'BLOCKED' },
      { evaluation_version: 'exp002-prospective-v1', evaluation_status: 'NOT_RUN', spec_ref: 'plan.md', reason: 'frozen', limitations: ['x'],
        metrics: { accuracy: 0.9 }, sample: { count: null, required: 111, meaning: 'pairs' } }] };
  const m = plain(H.exp002Model(e));
  assert.deepEqual([m.loggedRows, m.plan.required, m.plan.count, m.plan.evaluationStatus], [110, 111, null, 'NOT_RUN']);
  assert.ok(!JSON.stringify(m).includes('accuracy'), 'no performance field is carried into the view model');
  assert.equal(H.exp002Model(null), null);
  assert.equal(plain(H.exp002Model({ status: 'X' })).plan, null);
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
  const posts = SRC.match(/method:\s*['"]POST['"]/g) || [];
  assert.equal(posts.length, 1, 'exactly one POST (analyst relay submit)');
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
  assert.deepEqual(plain(H.SV2_PERIODS).map((p) => p[0]), ['24h', '7d', '30d', '90d', 'all']);
  assert.deepEqual(plain(H.SV2_PERIODS).map((p) => p[1]), ['24H', '7D', '30D', '90D', 'ALL']);
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
  assert.ok(/data-view="sentiment"/.test(SRC) && /id="view-sentiment"/.test(SRC), 'tab and view present');
  assert.equal((SRC.match(/data-view="sentiment"/g) || []).length, 2, 'desktop and mobile nav');
  assert.ok(/\{ key: 'sentiment', label: 'Sentiment V2'/.test(SRC));
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
