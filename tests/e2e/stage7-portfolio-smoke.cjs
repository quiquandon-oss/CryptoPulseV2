// Browser test of the Portfolio flows with synthetic data only. External calls are answered from fixtures:
// Hyperliquid prices, Frankfurter EUR/USD and the two V1 routes the page may call (GET /txs-backup on the import
// click, POST /gemini-outlook on the Narrative click), so no real Gemini quota is used and nothing reaches V1.
// Run: node tests/e2e/stage7-portfolio-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const v1Calls = [];
async function mock(ctx){
  await ctx.route('https://api.hyperliquid.xyz/**', (r) => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ BTC: '70000', ETH: '3000', SOL: '100' }) }));
  await ctx.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-11-20', base: 'EUR', quote: 'USD', rate: 1.1 }) }));
  await ctx.route('https://sentiment-ff75.quiquandon.workers.dev/**', (r) => {
    const q = r.request(), u = new URL(q.url()); v1Calls.push(q.method() + ' ' + u.pathname);
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
    if (q.method() === 'GET' && u.pathname === '/txs-backup') return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ ok: true, found: true, ts: 1, n_txs: 2, txs: [
      { date: '2026-03-01', asset: 'SOL', acct: 'SyntheticV1', type: 'buy', qty: 2, price: 90, ccy: 'USD' }, { date: '2026-03-02', asset: 'ETH', acct: 'SyntheticV1', type: 'buy', qty: 0.5, price: 1800, ccy: 'EUR' }] }) });
    if (q.method() === 'POST' && u.pathname === '/gemini-outlook') { const b = JSON.parse(q.postData() || '{}');
      return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ analysis: 'FIXTURE NARRATIVE for ' + (b.portfolio || []).map((p) => p.sym + ' ' + p.weight + '%').join(', '), narrativeScores: {}, ts: Date.now() }) }); }
    if (q.method() === 'GET' && u.pathname === '/foufi-latest') return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ latest: [] }) });
    return r.fulfill({ status: 404, headers: h, body: '{}' });
  });
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await mock(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '#portfolio'); await p.waitForTimeout(2500);
  ok(p.url().endsWith('#portfolio/holdings'), 'Portfolio opens on Holdings');
  ok((await p.$$eval('#areaTabs [role=tab]', (b) => b.map((x) => x.textContent.trim()).join('|'))) === 'Holdings|Transactions|Planning', 'Portfolio tabs');
  ok(/No transactions yet/.test(await p.textContent('#pfPositions')), 'empty state, nothing invented');
  await p.click('#areaTabs [data-route="portfolio/transactions"]'); await p.waitForTimeout(400);
  for (const [n, k] of [['Exchange', 'exchange'], ['Wallet', 'wallet']]) { await p.fill('#pfAccName', n); await p.selectOption('#pfAccKind', k); await p.click('#pfAccAdd'); await p.waitForTimeout(150); }
  ok((await p.textContent('#pfAccountsList')).includes('Wallet'), 'two accounts added');
  const tx = async (o) => { await p.selectOption('#pfTxAccount', { label: o.acct }); await p.selectOption('#pfTxType', o.type); await p.fill('#pfTxDate', o.date); await p.fill('#pfTxAsset', o.asset); await p.fill('#pfTxQty', String(o.qty));
    if (o.price !== undefined) { await p.fill('#pfTxPrice', String(o.price)); await p.selectOption('#pfTxPriceCcy', o.ccy || 'USD'); }
    if (o.fee !== undefined) { await p.fill('#pfTxFee', String(o.fee)); await p.fill('#pfTxFeeCcy', o.feeCcy || 'USD'); }
    await p.click('#pfTxAdd'); await p.waitForTimeout(200); return (await p.textContent('#pfTxMsg')).trim(); };
  ok(/SAVED/.test(await tx({ acct: 'Exchange', type: 'deposit', date: '2026-01-01T00:00', asset: 'USD', qty: 10000 })), 'deposit saved');
  ok(/SAVED/.test(await tx({ acct: 'Exchange', type: 'buy', date: '2026-01-02T00:00', asset: 'BTC', qty: 0.1, price: 50000, fee: 10 })), 'buy with fee saved');
  ok(/NOT SAVED.*quantity/.test(await tx({ acct: 'Exchange', type: 'buy', date: '2026-01-03T00:00', asset: 'BTC', qty: 0, price: 1 })), 'invalid row rejected with a reason');
  ok(/SAVED/.test(await tx({ acct: 'Exchange', type: 'buy', date: '2026-01-04T00:00', asset: 'ETH', qty: 1, price: 999 })), 'mistaken buy saved');
  await p.selectOption('#pfTrFrom', { label: 'Exchange' }); await p.selectOption('#pfTrTo', { label: 'Wallet' }); await p.fill('#pfTrAsset', 'BTC'); await p.fill('#pfTrSent', '0.05'); await p.fill('#pfTrRecv', '0.0499'); await p.fill('#pfTrDate', '2026-01-05T00:00'); await p.click('#pfTrAdd'); await p.waitForTimeout(200);
  ok(/matched pair/.test(await p.textContent('#pfTrMsg')), 'transfer recorded as a matched pair');
  // reverse the mistaken ETH buy (newest-first ledger: find the row with 999)
  const rowIdx = await p.$$eval('#pfLedger tr', (rs) => rs.findIndex((r) => r.textContent.includes('999 USD')));
  await (await p.$$('#pfLedger tr'))[rowIdx].$eval('[data-rev]', (b) => b.click()); await p.waitForTimeout(250);
  ok(/REVERSED/.test(await p.textContent('#pfLedger')) && /Reversal/.test(await p.textContent('#pfLedger')), 'reversal row added; original kept and marked');
  // CSV import (with one duplicate of the deposit and one bad row)
  const csv = path.join(os.tmpdir(), 'pf-import.csv');
  fs.writeFileSync(csv, 'date,account,type,asset,qty,price,price_ccy,fee,fee_ccy,fx_to_usd,transfer_id,note\n2026-01-01T00:00:00Z,Exchange,deposit,USD,10000,,,,,,,dup\n2026-01-06,Wallet,reward,BTC,0.001,65000,USD,,,,,staking\n2026-01-07,Exchange,sell,BTC,-1,1,USD,,,,,bad\n');
  await p.setInputFiles('#pfImportFile', csv); await p.waitForTimeout(500);
  const im = (await p.textContent('#pfImportMsg')).replace(/\s+/g, ' ');
  ok(/1 added · 1 duplicate skipped · 1 rejected/.test(im), 'CSV import: added / duplicate / rejected reported: ' + im.slice(0, 120));
  // V1 import (fixture)
  // UX layer: the entry forms fold to their titles; the ledger stays open
  ok(await p.evaluate(() => document.querySelector('[aria-labelledby="pfIoTitle"]').classList.contains('ux-folded') && !document.querySelector('[aria-labelledby="pfLedgerTitle"]').classList.contains('ux-folded')), 'transactions: forms folded, ledger open');
  await p.evaluate(() => document.querySelectorAll('#pf-transactions .ux-card.ux-folded > .ux-fold-btn').forEach((b) => b.click())); await p.waitForTimeout(200);
  await p.click('#pfImportV1'); await p.waitForTimeout(600);
  ok(/2 added/.test(await p.textContent('#pfImportMsg')), 'V1 backup imported (2 synthetic rows)');
  // Historical FX from the real ECB API (not mocked): the V1 EUR buy of 2026-03-02 gets that day's ECB rate.
  await p.click('#pfFxFetch');
  await p.waitForFunction(() => !/Fetching ECB/.test(document.getElementById('pfFxMsg').textContent), null, { timeout: 75000 }).catch(() => {});
  const fxm = (await p.textContent('#pfFxMsg')).replace(/\s+/g, ' ');
  ok(/ECB rates stored: \d+ business days/.test(fxm), 'real ECB reference rates fetched and stored: ' + fxm.slice(0, 110));
  // export CSV
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pfExportCsv')]);
  const out = fs.readFileSync(await dl.path(), 'utf8');
  ok(out.split('\n')[0].startsWith('date,account,type,asset,qty') && out.includes('transfer_out') && out.includes('reversal'), 'CSV export contains the full ledger incl. transfers and reversal');
  // holdings
  await p.click('#areaTabs [data-route="portfolio/holdings"]'); await p.waitForTimeout(800);
  const pos = (await p.textContent('#pfPositions')).replace(/\s+/g, ' ');
  ok(/BTC\s*0\.1009/.test(pos), 'BTC consolidated qty 0.1 − 0.0001 network fee + 0.001 reward = 0.1009: ' + pos.slice(0, 80));
  const ethCost = /ETH\s*0\.5 \$3,000\.00\$1,500\.00 \$([\d,.]+)/.exec(pos);
  ok(ethCost && !/FX missing/.test(pos), 'V1 EUR buy now costed in USD with the ECB rate of 2026-03-02 (avg $' + (ethCost && ethCost[1]) + ')');
  ok(/1 with the ECB reference rate/.test(await p.textContent('#pfPriceNote')) && /1 with your own rate|0 with your own rate/.test(await p.textContent('#pfPriceNote')), 'FX provenance counted (own / ECB / missing)');
  ok(!/999/.test(pos), 'reversed buy not counted');
  ok(!/FX MISSING/.test(await p.textContent('#pfIssues')), 'no FX issue left once ECB rates are stored');
  ok((await p.$eval('#pfValuePresets [aria-pressed="true"]', (b) => b.textContent.trim())) === 'All', 'value chart presets default All (owner exception to OD-08, 2026-11-20)');
  ok(await p.$('#pfValueChartFsBtn') && await p.$('#pfAllocChartFsBtn'), 'value and allocation charts have full screen');
  await p.click('#pfAllocChartFsBtn'); await p.waitForTimeout(250); ok((await p.getAttribute('#pfAllocChartFsBtn', 'aria-pressed')) === 'true', 'allocation full screen'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.screenshot({ path: (process.env.SMOKE_OUT || os.tmpdir()) + '/pf-holdings.png', fullPage: true });
  // planning
  await p.click('#areaTabs [data-route="portfolio/planning"]'); await p.waitForTimeout(400);
  await p.selectOption('#pfDryAsset', 'BTC'); await p.fill('#pfDryAmount', '1000'); await p.waitForTimeout(150);
  ok(/Average cost .* → .*\(\+/.test(await p.textContent('#pfDryOut')), 'dry powder planner computes new average');
  ok((await p.$$eval('#pfScenarios tr', (t) => t.length)) === 8, 'scenario table');
  await p.waitForTimeout(1500);
  const be = (await p.textContent('#pfBeProb')).replace(/\s+/g, ' ');
  ok(/6M.*9M.*1Y.*2Y.*5Y/.test(be) && /BTC → \$/.test(be) && /\d+%/.test(be), 'break-even probability table (V1 model) rendered: ' + be.slice(0, 90));
  ok(/ETH\s*→ \$/.test(be), 'ETH break-even probability available once its cost is known in USD');
  await p.click('#pfNarrativeBtn'); await p.waitForTimeout(600);
  const nar = await p.textContent('#pfNarrativeOut');
  ok(/FIXTURE NARRATIVE for BTC/.test(nar) && /Gemini \(gemini-3\.6-flash\) via V1/.test(nar), 'narrative via V1 rendered and labelled');
  await p.screenshot({ path: (process.env.SMOKE_OUT || os.tmpdir()) + '/pf-planning.png', fullPage: true });
  // persistence
  await p.reload(); await p.waitForTimeout(1500);
  ok(/BTC/.test(await p.textContent('#pfDryAsset')), 'ledger persists across reload (browser storage)');
  ok(JSON.stringify(v1Calls.filter((c) => !c.startsWith('OPTIONS') && c !== 'GET /foufi-latest')) === JSON.stringify(['GET /txs-backup', 'POST /gemini-outlook']), 'V1 called exactly twice, both on clicks: ' + v1Calls.join(', '));
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  // phone layout
  const ph = await browser.newContext({ ...devices['iPhone 13'] }); await mock(ph);
  const q = await ph.newPage(); await q.goto(BASE + '#portfolio/transactions'); await q.waitForTimeout(1500);
  ok(await q.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, 'phone: no horizontal overflow on Transactions');
  await browser.close();
  console.log(res.join('\n')); console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${res.filter((r) => r.startsWith('FAIL')).length} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
