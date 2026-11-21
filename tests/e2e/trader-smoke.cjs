// Browser test of Trader Analysis (Gemini) parity. Real inputs: Hyperliquid BTC daily candles and the V2 Worker's
// sentiment and evidence. Only V1's POST /trader-analysis-gemini is answered by a fixture (no Gemini quota used); the
// test checks the body the page would send against V1's contract (buildTraderAnalysisDataBlock fields).
// Run: node tests/e2e/trader-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await browser.newContext(opts); let sent = null; const v1 = [];
    await ctx.route('https://sentiment-ff75.quiquandon.workers.dev/**', (r) => { const q = r.request(), u = new URL(q.url()); v1.push(q.method() + ' ' + u.pathname);
      const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
      if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
      if (q.method() === 'POST' && u.pathname === '/trader-analysis-gemini') { sent = JSON.parse(q.postData() || 'null'); return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ analysis: 'FIXTURE TRADER READ', ts: Date.now() }) }); }
      return r.fulfill({ status: 404, headers: h, body: '{}' }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#sentiment-v1/trader'); await p.waitForTimeout(2500);
    ok((await p.textContent('#traderOut')).trim() === '', `${name}: nothing is called before the click`);
    await p.click('#traderBtn'); await p.waitForTimeout(8000);
    const out = await p.textContent('#traderOut'), inp = (await p.textContent('#traderInputs')).replace(/\s+/g, ' ');
    ok(/FIXTURE TRADER READ/.test(out) && /Gemini \(gemini-3\.6-flash\) via V1/.test(out), `${name}: result rendered with provenance label`);
    ok(/price, technicals.*Hyperliquid BTC daily candles \(\d+ closes/.test(inp) && /sentiment · V2 sentiment sv2-/.test(inp) && /probabilityModel/.test(inp) && /not sent/.test(inp), `${name}: per-input provenance shown`);
    const t = sent && sent.technicals;
    ok(sent && typeof sent.price === 'number' && sent.price > 1000, `${name}: real BTC price sent (${sent && Math.round(sent.price)})`);
    ok(t && ['tenkan', 'kijun', 'ma50', 'ma100', 'ma200', 'rsi14'].every((k) => typeof t[k] === 'number') && t.cloud && typeof t.cloud.position === 'string' && t.volume && typeof t.volume.trend === 'string' && 'maCrossover' in t && 'divergence' in t,
      `${name}: technicals in V1's field layout (RSI ${t && t.rsi14 && t.rsi14.toFixed(1)}, cloud ${t && t.cloud && t.cloud.position})`);
    ok(sent && sent.sentiment && typeof sent.sentiment.composite === 'number' && Object.keys(sent.sentiment.sources).every((k) => /^V2 /.test(k)), `${name}: V2 sentiment ${sent && sent.sentiment && sent.sentiment.composite} with V2-labelled sources`);
    ok(sent && Array.isArray(sent.topHeadlines) && sent.topHeadlines.every((h) => typeof h.title === 'string' && typeof h.score === 'number'), `${name}: ${sent && sent.topHeadlines.length} real V2 headlines`);
    ok(sent && sent.probabilityModel && sent.probabilityModel.insufficient === true, `${name}: V1-only probability model sent as insufficient`);
    ok(sent && !('whaleActivity' in sent) && !('liquidationClusters' in sent) && !('regimeScorecard' in sent), `${name}: V1-only signals not invented`);
    ok(JSON.stringify(v1.filter((c) => !c.startsWith('OPTIONS'))) === JSON.stringify(['POST /trader-analysis-gemini']), `${name}: exactly one V1 call, on the click`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${name}: no horizontal overflow`);
    ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(res.join('\n')); console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${res.filter((r) => r.startsWith('FAIL')).length} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
