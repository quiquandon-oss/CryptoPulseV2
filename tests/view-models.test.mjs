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
vm.runInContext(SRC.slice(a, b) + '\nthis.api = { headlineOf, forecastTileModel, predictionRunsModel, eventDetectionModel, collectorModel, variantCycleRows, exp002Model, nextTickTs };', ctx);
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
