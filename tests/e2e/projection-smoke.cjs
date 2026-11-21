// Browser test of Portfolio › Projection (OD-15) with synthetic data only. Every external call is answered from
// generated fixtures (Hyperliquid prices and candles, PulseWorkerV2 comparison + forecast-research); V1 gets 404.
// Run: node tests/e2e/projection-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const DAY = 86400000, NOW = Date.now(), seed = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
function candles(coin){ const r = seed(coin.length * 977 + coin.charCodeAt(0)), out = []; let p = { BTC: 70000, ETH: 3000, SOL: 150 }[coin] || 10;
  for(let i = 400; i >= 0; i--){ const t = Math.floor((NOW - i * DAY) / DAY) * DAY; p *= Math.exp(0.03 * (r() - 0.5)); out.push({ t, T: t + DAY - 1, s: coin, i: '1d', o: String(p), c: String(p), h: String(p), l: String(p), v: '1', n: 1 }); }
  return out; }
function comparison(){ const r = seed(5), pts = []; for(let i = 120; i >= 0; i--){ const ts = NOW - i * DAY + 3600000 - DAY; pts.push({ ts, v1: Math.round(20 + 60 * r()), btc: 70000, v2: i < 10 ? 30 + 40 * r() : null, v2_status: null, v1_origin: 'server', btc_ts: ts }); }
  pts.push({ ts: NOW - 2 * 3600000, v1: 25, btc: 70000, v2: 70, v1_origin: 'server', btc_ts: NOW }); return { ok: true, period: 'all', points: pts, series_status: {} }; }
const research = { ok: true, stage: 'research', points: [{ decision_ts: NOW - 3 * 3600000, status: 'OK', baseline_score: 40, research: { enhanced_score: 44 } }] };
const store = { version: 1, accounts: [{ id: 'a1', name: 'Exchange', kind: 'exchange' }], txs: [
  { id: 't1', account_id: 'a1', ts: NOW - 30 * DAY, type: 'deposit', asset: 'USD', qty: 100000 },
  { id: 't2', account_id: 'a1', ts: NOW - 29 * DAY, type: 'buy', asset: 'BTC', qty: 0.5, price: 60000, price_ccy: 'USD' },
  { id: 't3', account_id: 'a1', ts: NOW - 29 * DAY, type: 'buy', asset: 'ETH', qty: 4, price: 2500, price_ccy: 'USD' }], importRuns: [], snapshots: [] };
async function mock(ctx){
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  await ctx.route('https://api.hyperliquid.xyz/**', (r) => { const b = JSON.parse(r.request().postData() || '{}');
    if(b.type === 'allMids') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ BTC: '70000', ETH: '3000' }) });
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(candles(b.req.coin)) }); });
  await ctx.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ date: '2026-11-20', rate: 1.1 }) }));
  await ctx.route(/pulseworker-v2[^/]*\.workers\.dev/, (r) => { const u = new URL(r.request().url());
    if(u.pathname === '/api/sentiment-v2/comparison') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(comparison()) });
    if(u.pathname === '/api/sentiment-v2/forecast-research') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(research) });
    return r.fulfill({ status: 404, headers: cors, body: '{"ok":false,"error":"fixture"}' }); });
  await ctx.route('https://sentiment-ff75.quiquandon.workers.dev/**', (r) => r.fulfill({ status: 404, headers: cors, body: '{}' }));
  await ctx.addInitScript((s) => { if(!localStorage.getItem('cpv2_portfolio_v1')) localStorage.setItem('cpv2_portfolio_v1', s); }, JSON.stringify(store));
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await mock(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());   // the "Refresh copy" confirmation
  await p.goto(BASE + '#portfolio/projection'); await p.waitForTimeout(1500);
  ok((await p.$$eval('#areaTabs [role=tab]', (b) => b.map((x) => x.textContent.trim()).join('|'))) === 'Holdings|Transactions|Planning|Projection', 'Projection tab present');
  ok(/No copy yet/.test(await p.textContent('#pjCopyNote')), 'no copy: explained, nothing projected');
  ok(await p.evaluate(() => localStorage.getItem('cpv2_portfolio_projection_v1') === null), 'no copy stored before the click');
  const before = await p.evaluate(() => localStorage.getItem('cpv2_portfolio_v1'));
  await p.click('#pjCopyBtn'); await p.waitForTimeout(3000);
  ok(/Copy made .* from 3 ledger rows/.test(await p.textContent('#pjCopyNote')), 'copy made from 3 rows');
  ok(await p.evaluate((b) => localStorage.getItem('cpv2_portfolio_v1') === b, before), 'accounting ledger unchanged');
  ok(/projected between/.test(await p.textContent('#pjAnswer')), 'answer sentence: ' + (await p.textContent('#pjAnswer')).slice(0, 160));
  const rows = await p.$$eval('#pjTable tbody tr', (t) => t.map((r) => r.children[0].textContent.trim()));
  ok(rows.join('|') === 'Neutral|Sentiment V1|Sentiment V2|Sentiment V2 research', 'four lines: ' + rows.join('|'));
  ok((await p.$$eval('#pjEval tbody tr', (t) => t.length)) === 6, 'evaluation: 3 lines × 2 horizons');
  ok(/As of the \d{4}-\d{2}-\d{2} close/.test(await p.textContent('#pjNotes')), 'as-of note');
  await p.click('#pjHorizonBtns button[data-h="1"]'); await p.waitForTimeout(300);
  ok(/In 1 day/.test(await p.textContent('#pjAnswer')), '1-day horizon');
  // the ledger grows -> the copy is flagged out of date; "Refresh copy" replaces it
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cpv2_portfolio_v1')); s.txs.push({ id: 't4', account_id: 'a1', ts: Date.now() - 86400000, type: 'buy', asset: 'BTC', qty: 0.1, price: 65000, price_ccy: 'USD' }); localStorage.setItem('cpv2_portfolio_v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(2500);
  ok(/refresh the copy/.test(await p.textContent('#pjCopyNote')), 'stale copy flagged');
  await p.click('#pjCopyBtn'); await p.waitForTimeout(2500);
  ok(/from 4 ledger rows/.test(await p.textContent('#pjCopyNote')), 'copy refreshed');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  const phone = await browser.newContext({ ...devices['iPhone 13'] }); await mock(phone);
  const q = await phone.newPage(); await q.goto(BASE + '#portfolio/projection'); await q.waitForTimeout(1500);
  await q.evaluate((s) => localStorage.setItem('cpv2_portfolio_projection_v1', JSON.stringify({ version: 1, kind: 'projection_copy', copied_at: Date.now(), source_rows: 3, accounts: s.accounts, txs: s.txs, fxRates: null })), store);
  await q.reload(); await q.waitForTimeout(3000);
  ok(/projected between/.test(await q.textContent('#pjAnswer')), 'phone: projection shown');
  ok(await q.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'phone: no horizontal page overflow');
  if(process.env.SHOT) await q.screenshot({ path: process.env.SHOT, fullPage: true });
  await browser.close();
  console.log(res.join('\n')); process.exit(res.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
