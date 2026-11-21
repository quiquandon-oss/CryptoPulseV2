// Browser smoke test: Forecast coverage, Research / Learning & Audit split, V1 Foufi Daily.
// Read-only. V1's /foufi-latest is answered from a fixture shaped like V1's formatDigestRow (PulseWorker fb30da1),
// because the V1 host may be unreachable from CI/sandboxes; pass LIVE_V1=1 to use the real route instead.
// Run: node tests/e2e/stage3-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const NOW = Date.now();
const FIXTURE = { latest: [
  { videoId: 'fixture1', title: 'Fixture video', url: 'https://www.youtube.com/watch?v=fixture1', publishedTs: NOW - 3 * 3600e3, status: 'ok', overallLean: 'bearish', videoType: 'morning', specialEdition: null, fetchedTs: NOW - 2 * 3600e3,
    summary: { market_summary: 'Fixture summary.', macro: { lean: 'bearish', text: 'x' }, micro: { lean: 'neutral', text: 'y' }, tradfi: { lean: 'bullish', text: 'z' }, coins: { BTC: { score: -1, note: 'n' } }, dominant_driver: 'macro' } },
  { videoId: 'fixture0', title: 'Older', url: 'https://youtu.be/fixture0', publishedTs: NOW - 15 * 3600e3, status: 'unstructured', summary: { raw: 'text' }, fetchedTs: NOW - 14 * 3600e3 }] };
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await browser.newContext(opts);
    if (!process.env.LIVE_V1) await ctx.route('https://sentiment-ff75.quiquandon.workers.dev/**', (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() !== 'GET' || u.pathname !== '/foufi-latest') { ok(false, `${name}: unexpected V1 call ${r.request().method()} ${u.pathname}`); return r.abort(); }
      return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(FIXTURE) });
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#sentiment-v2/forecast'); await p.waitForTimeout(7000);
    const covRows = await p.$$eval('#flCovBody tr', (t) => t.length);
    ok(covRows === 6, `${name}: forecast coverage table has 6 rows (2 models + both, × 2 horizons): ${covRows}`);
    await p.click('#flPeriods button:has-text("All")'); await p.waitForTimeout(800);
    const tfm24 = await p.$eval('#flCovBody', (b) => b.textContent);
    ok(/TimesFM 2\.5/.test(tfm24) && /Chronos-2/.test(tfm24), `${name}: coverage names both models`);
    ok(await p.$$eval('#flLedgerBody tr', (t) => t.length) > 0 || await p.$$eval('#flLedgerCards li', (t) => t.length) > 0, `${name}: ledger rows rendered`);
    if (name === 'desktop') ok(/issued/.test(await p.$eval('#flLedgerBody', (b) => b.textContent)), 'ledger shows issued/target per forecast');
    await p.goto(BASE + '#research'); await p.waitForTimeout(2500);
    ok(await p.isVisible('#historyBacktestTitle') && await p.isVisible('#regimeSplitTitle'), `${name}: backtests are in Research`);
    await p.goto(BASE + '#sentiment-v2/evidence'); await p.waitForTimeout(5000);
    ok(await p.isVisible('#prospectiveCard') && !(await p.isVisible('#historyBacktestTitle')), `${name}: V2 > Evidence / GLM shows the prospective evaluations, no backtests`);
    const ge = (await p.textContent('#glmEvalBody')).replace(/\s+/g, ' ');
    ok(!/^Loading/.test(ge) && /(NO APPLIED ADJUSTMENT YET|INSUFFICIENT SAMPLE|SAMPLE SUFFICIENT|UNAVAILABLE)/.test(ge), `${name}: GLM-PE-1 rendered: ${ge.slice(0, 90)}`);
    await p.goto(BASE + '#sentiment-v1'); await p.waitForTimeout(4000);
    const fb = (await p.textContent('#foufiBody')).replace(/\s+/g, ' ');
    if (!process.env.LIVE_V1) {
      ok(/Fixture video/.test(fb) && /BTC -1/.test(fb), `${name}: Foufi digest rendered from V1 shape`);
      ok(/No structured summary stored/.test(fb), `${name}: unstructured digest not invented`);
    } else ok(!/^Loading/.test(fb), `${name}: live Foufi rendered: ${fb.slice(0, 100)}`);
    await p.screenshot({ path: (process.env.SMOKE_OUT || require('os').tmpdir()) + `/s3-${name}-v1.png`, fullPage: true });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ov <= 1, `${name}: no horizontal overflow (${ov}px)`);
    ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(res.join('\n')); console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${res.filter((r) => r.startsWith('FAIL')).length} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
