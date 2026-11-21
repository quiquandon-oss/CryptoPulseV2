// Unit tests for the Portfolio › Projection helpers (OD-15, docs/PORTFOLIO_PROJECTION.md). Synthetic data only.
// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = SRC.indexOf('// ---- BEGIN view-model helpers'), b = SRC.indexOf('// ---- END view-model helpers ----');
const ctx = vm.createContext({});
vm.runInContext(SRC.slice(a, b) + '\nthis.api = { pjDayAdd, pjCloses, pjSignalDaily, pjSignalsFrom, pjPairs, pjConditional, pjMarket, pjSimulate, pjEvaluate, pjVerdict, pjMakeCopy, pjValidCopy, pjModel, pjQuantile, PJ_LINES, PJ_HORIZONS, PJ_K, PJ_MIN_EVAL_NEFF, pfCompute, resolveRoute, AREAS };', ctx);
const H = ctx.api;
const plain = (v) => JSON.parse(JSON.stringify(v));
const DAY = 86400000, T0 = Date.UTC(2026, 6, 1);
const day = (i) => new Date(T0 + i * DAY).toISOString().slice(0, 10);
// deterministic pseudo-random walk
const walk = (n, seed, vol = 0.02, start = 100) => { let x = seed >>> 0, p = start; const o = {};
  for(let i = 0; i < n; i++){ x = (x * 1664525 + 1013904223) >>> 0; p *= Math.exp(vol * ((x / 4294967296) - 0.5) * 3.4); o[day(i)] = p; } return o; };

test('lines and horizons: Neutral, V1, V2, V2 research; 1 and 7 days', () => {
  assert.deepEqual(plain(H.PJ_LINES.map((l) => l.key)), ['neutral', 'v1', 'v2', 'v2r']);
  assert.deepEqual(plain(H.PJ_HORIZONS), [1, 7]);
});

test('Projection is a Portfolio tab and old routes still resolve', () => {
  assert.equal(H.resolveRoute('#portfolio/projection').canonical, 'portfolio/projection');
  assert.equal(H.resolveRoute('#portfolio/projection').view, 'portfolio');
  assert.equal(H.resolveRoute('#portfolio').canonical, 'portfolio/holdings');
});

test('closes: the open (today) candle is dropped', () => {
  assert.deepEqual(plain(H.pjCloses({ '2026-11-19': 1, '2026-11-20': 2, '2026-11-21': 3 }, '2026-11-21')), { '2026-11-19': 1, '2026-11-20': 2 });
});

test('signal daily: last reading of each UTC day; nulls ignored', () => {
  const d = H.pjSignalDaily([{ ts: T0 + 1000, v: 40 }, { ts: T0 + 5000, v: 45 }, { ts: T0 + 6000, v: null }, { ts: T0 + DAY, v: 60 }]);
  assert.deepEqual(plain(d), { [day(0)]: { ts: T0 + 5000, v: 45 }, [day(1)]: { ts: T0 + DAY, v: 60 } });
});

test('signals from the comparison and forecast-research payloads', () => {
  const s = H.pjSignalsFrom([{ ts: 1, v1: 40, v2: null }, { ts: 2, v1: 41, v2: 35 }], [{ decision_ts: 3, research: { enhanced_score: 47 } }, { decision_ts: 4, research: null }]);
  assert.deepEqual(plain(s), { v1: [{ ts: 1, v: 40 }, { ts: 2, v: 41 }], v2: [{ ts: 2, v: 35 }], v2r: [{ ts: 3, v: 47 }] });
});

test('pairs: forward log return over H days, resolved on day + H', () => {
  const closes = { [day(0)]: 100, [day(1)]: 110, [day(7)]: 121 };
  const p = H.pjPairs({ [day(0)]: { v: 30 }, [day(1)]: { v: 70 } }, closes, 1);
  assert.equal(p.length, 1); assert.equal(p[0].resolved, day(1)); assert.ok(Math.abs(p[0].r - Math.log(1.1)) < 1e-12);
  assert.equal(H.pjPairs({ [day(0)]: { v: 30 } }, closes, 7)[0].resolved, day(7));
});

test('conditional: shift = n/(n+k) × (band mean − overall mean); low readings followed by falls give a negative shift', () => {
  const pairs = [];
  for(let i = 0; i < 30; i++) pairs.push({ day: day(i), s: i % 3 === 0 ? 20 : i % 3 === 1 ? 50 : 80, r: i % 3 === 0 ? -0.02 : i % 3 === 1 ? 0 : 0.02, resolved: day(i + 1) });
  const c = H.pjConditional(pairs, day(40), 15, 1);
  assert.equal(c.state, 'ok'); assert.equal(c.band, 'low'); assert.equal(c.nBand, 10); assert.equal(c.neffBand, 10);
  assert.ok(Math.abs(c.weight - 10 / 20) < 1e-12);
  assert.ok(Math.abs(c.shift - 0.5 * (-0.02 - 0)) < 1e-12);
  assert.ok(H.pjConditional(pairs, day(40), 90, 1).shift > 0);
});

test('conditional is point-in-time: outcomes resolved after the as-of day are never used', () => {
  const pairs = []; for(let i = 0; i < 30; i++) pairs.push({ day: day(i), s: i % 3 === 0 ? 20 : 60 + i, r: i % 3 === 0 ? -0.05 : 0.01, resolved: day(i + 7) });
  const early = H.pjConditional(pairs, day(10), 15, 7);
  assert.equal(early.n, 4); assert.equal(early.state, 'insufficient'); assert.equal(early.shift, 0);
  const later = H.pjConditional(pairs, day(36), 15, 7);
  assert.equal(later.n, 30);
  // overlapping 7-day windows count once per independent window
  assert.ok(later.neffBand < later.nBand);
});

test('conditional: no reading, too little history or a thin band means no shift', () => {
  assert.equal(H.pjConditional([], day(5), NaN, 1).state, 'no_reading');
  assert.equal(H.pjConditional([{ day: day(0), s: 1, r: 0.1, resolved: day(1) }], day(5), 1, 1).state, 'insufficient');
});

test('market: beta of an asset that moves twice as much as BTC is 2', () => {
  const btc = walk(200, 7), alt = {}; const ks = Object.keys(btc);
  ks.forEach((d, i) => { alt[d] = 50 * Math.pow(btc[d] / btc[ks[0]], 2); });
  const m = H.pjMarket({ BTC: btc, ALT: alt }, day(199));
  assert.ok(m.sigma > 0); assert.equal(m.assets.ALT.state, 'ok');
  assert.ok(Math.abs(m.assets.ALT.beta - 2) < 1e-9); assert.ok(m.assets.ALT.residSigma < 1e-9);
  assert.equal(H.pjMarket({ BTC: walk(10, 1) }, day(9)).sigma, null, 'under 30 returns: not estimated');
});

test('simulate: zero shift has the median at today\'s value; a positive shift raises it; cash is constant; lines share draws', () => {
  const btc = walk(200, 11), m = H.pjMarket({ BTC: btc }, day(199));
  const r = H.pjSimulate([{ asset: 'BTC', qty: 1, price: 100 }, { asset: 'XYZ', qty: 2, price: 5 }], 50, m, 7, { neutral: 0, up: 0.05, down: -0.05 }, 4000);
  assert.deepEqual(plain(r.fixedAssets), ['XYZ']); assert.equal(r.nowValue, 160);
  assert.ok(Math.abs(r.lines.neutral.p50 - 160) / 160 < 0.01);
  assert.ok(r.lines.up.p50 > r.lines.neutral.p50 && r.lines.down.p50 < r.lines.neutral.p50);
  assert.ok(r.lines.neutral.p10 < r.lines.neutral.p50 && r.lines.neutral.p50 < r.lines.neutral.p90);
  assert.ok(r.lines.neutral.p10 > 60, 'cash and the unmodelled asset never move');
  const again = H.pjSimulate([{ asset: 'BTC', qty: 1, price: 100 }], 0, m, 7, { neutral: 0 }, 4000);
  assert.equal(again.lines.neutral.p50, H.pjSimulate([{ asset: 'BTC', qty: 1, price: 100 }], 0, m, 7, { neutral: 0 }, 4000).lines.neutral.p50, 'deterministic');
});

test('evaluate: a signal that really leads returns gets positive skill; an unrelated one does not; few windows are insufficient', () => {
  const n = 260, closes = {}, sig = {}; let p = 100, x = 9;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const reading = []; for(let i = 0; i < n; i++) reading.push(rnd() < 0.5 ? 20 : 80);
  for(let i = 0; i < n; i++){ closes[day(i)] = p; p *= Math.exp((reading[i] === 80 ? 0.01 : -0.01) + 0.02 * (rnd() - 0.5)); sig[day(i)] = { v: reading[i] }; }
  const good = H.pjEvaluate(H.pjPairs(sig, closes, 1), closes, 1);
  assert.ok(good.sufficient); assert.ok(good.skill > 0.02, 'skill ' + good.skill); assert.equal(H.pjVerdict(good).code, 'beats');
  const noise = {}; for(let i = 0; i < n; i++) noise[day(i)] = { v: rnd() * 100 };
  const bad = H.pjEvaluate(H.pjPairs(noise, closes, 1), closes, 1);
  assert.ok(bad.skill < 0.02); assert.equal(H.pjVerdict(bad).code, 'no_gain');
  const wk = H.pjEvaluate(H.pjPairs(sig, closes, 7), closes, 7);
  assert.ok(wk.neff < wk.n); assert.equal(H.pjVerdict({ n: 5, neff: 5, sufficient: false }).code, 'insufficient');
  assert.equal(H.pjVerdict({ n: 0 }).code, 'no_data');
});

test('copy: a separate projection copy holds accounts, transactions and FX only, and computes like the ledger', () => {
  const store = { version: 1, accounts: [{ id: 'a1', name: 'Ex', kind: 'exchange' }],
    txs: [{ id: 't1', account_id: 'a1', ts: T0, type: 'buy', asset: 'BTC', qty: 0.5, price: 60000, price_ccy: 'USD' }],
    importRuns: [{ x: 1 }], snapshots: [{ ts: 1, totalUsd: 1 }], v1InterestEur: { '2026-01-01': 5 } };
  const c = H.pjMakeCopy(store, 123);
  assert.ok(H.pjValidCopy(c)); assert.equal(c.copied_at, 123); assert.equal(c.source_rows, 1);
  assert.equal(c.snapshots, undefined); assert.equal(c.v1InterestEur, undefined);
  c.txs[0].qty = 9; assert.equal(store.txs[0].qty, 0.5, 'deep copy: editing the copy never touches the ledger');
  const m = H.pfCompute(H.pjMakeCopy(store, 1), { BTC: 70000 }, null);
  assert.equal(m.totals.valueUsd.value, 35000);
  assert.equal(H.pjValidCopy({ version: 1, accounts: [], txs: [] }), false, 'the accounting ledger is not a projection copy');
});

test('model: four lines, stale or missing readings fall back to Neutral, disagreement flag', () => {
  const now = Date.parse(day(200)) + 12 * 3600000, btc = walk(201, 3), eth = walk(201, 4, 0.03, 10);
  const pts = (fn) => { const o = []; for(let i = 0; i < 199; i++) o.push({ ts: Date.parse(day(i)) + 3600000, v: fn(i) }); return o; };
  const v1 = pts((i) => (i % 3) * 30 + 10), v2 = pts((i) => 90 - (i % 3) * 30);
  v1.push({ ts: now - 3600000, v: 5 }); v2.push({ ts: now - 3600000, v: 95 });
  const m = H.pjModel({ positions: [{ asset: 'BTC', qty: 1, price: 100 }, { asset: 'ETH', qty: 3, price: 10 }], cashUsd: 20, dailyByAsset: { BTC: btc, ETH: eth },
    signals: { v1, v2, v2r: [{ ts: now - 40 * 3600000, v: 50 }] }, now, H: 7 });
  assert.deepEqual(plain(m.lines.map((l) => [l.key, l.state])), [['neutral', 'ok'], ['v1', 'ok'], ['v2', 'ok'], ['v2r', 'stale']]);
  assert.equal(m.shifts.v2r, 0); assert.equal(m.shifts.neutral, 0);
  assert.equal(m.bands.v1, 'low'); assert.equal(m.bands.v2, 'high'); assert.equal(m.disagree, true);
  assert.equal(m.asOfDay, day(199)); assert.equal(m.sim.nowValue, 150);
  for(const k of ['neutral', 'v1', 'v2', 'v2r']) assert.ok(m.sim.lines[k].p10 < m.sim.lines[k].p90);
  assert.equal(m.sim.lines.v2r.p50, m.sim.lines.neutral.p50);
  const none = H.pjModel({ positions: [], cashUsd: 0, dailyByAsset: { BTC: btc }, signals: {}, now, H: 1 });
  assert.equal(none.sim, null); assert.equal(none.lines[1].state, 'no_reading');
});
