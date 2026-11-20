// Browser test of the outcome-based Comparison (contracts §7, PulseWorkerV2 #182, cmp-v1-v2-1).
//   LIVE=1   : uses whatever the production Worker serves (after the #182 deploy: real figures; before: "NOT LIVE YET").
//   default  : the comparison route is answered with tests/fixtures/comparison-*-btc24-2026-11-20.json, which are real
//              production data produced by #182's own SQL and functions (see _provenance); everything else is live.
// Run: [LIVE=1] node tests/e2e/comparison-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const SUM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'comparison-summary-btc24-2026-11-20.json'), 'utf8'));
const REC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'comparison-records-btc24-2026-11-20.json'), 'utf8'));
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const pct = (v) => (v * 100).toFixed(1) + '%';
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await browser.newContext(opts); const seen = [];
    if (!process.env.LIVE) await ctx.route(/\/api\/comparison\/v1-v2/, (r) => { const u = new URL(r.request().url()); seen.push(u.pathname + u.search);
      const body = u.pathname.endsWith('/summary') ? SUM : REC;
      return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#comparison'); await p.waitForTimeout(5000);
    const out = (await p.textContent('#cmpOutcome')).replace(/\s+/g, ' ');
    if (process.env.LIVE && /NOT LIVE YET/.test(out)) {
      ok(!/\d+\.\d%/.test(out), `${name}: route not deployed → explicit NOT LIVE YET, no figures shown`);
      ok(/not live|pending/i.test(await p.textContent('#cmpRecords')), `${name}: records state explicit`);
    } else {
      const s = process.env.LIVE ? null : SUM.summary;
      ok(/V1 production/.test(out) && /V2 baseline/.test(out) && /V2 final/.test(out), `${name}: three series shown`);
      if (s) {
        ok(out.includes(pct(s.accuracy.v1.rate)) && out.includes(pct(s.accuracy.v2_final.rate)), `${name}: accuracy matches the API (${pct(s.accuracy.v1.rate)} / ${pct(s.accuracy.v2_final.rate)})`);
        ok(out.includes(s.brier.v2_baseline.score.toFixed(4)), `${name}: Brier ${s.brier.v2_baseline.score}`);
        ok(out.includes(`${s.accuracy.v1.correct} of ${s.accuracy.v1.n} calls`), `${name}: sample size beside the metric`);
        ok(/PROPOSED/.test(out) && /50\/50/.test(out) && /40\/60/.test(out), `${name}: V1 threshold sensitivity bands`);
        ok(/Adjusted by GLM\s*\d+/.test(out), `${name}: GLM attribution shown`);
        if (/_observational$/.test(s.claim)) ok(/Observational, not pre-registered/.test(out), `${name}: observational caveat shown with the claim`);
      } else ok(/\[\d+\.\d%–\d+\.\d%\]/.test(out), `${name}: live figures with intervals`);
      const recRows = await p.$$eval('#cmpRecords tbody tr', (t) => t.length);
      ok(recRows > 0 && recRows <= 50, `${name}: recent decisions table (${recRows} rows)`);
      ok(/PENDING|UP|DOWN/.test(await p.textContent('#cmpRecords')), `${name}: outcomes or pending shown`);
    }
    ok((await p.$$eval('#cmpPresets button', (b) => b.map((x) => x.textContent.trim()).join('|'))) === '24H|7D|1M|All', `${name}: presets 24H|7D|1M|All`);
    ok((await p.$eval('#cmpPresets [aria-pressed="true"]', (b) => b.textContent.trim())) === '24H', `${name}: 24H default`);
    if (!process.env.LIVE) {
      await p.click('#cmpPresets button:has-text("All")'); await p.waitForTimeout(800);
      ok(seen.some((q) => /period=all/.test(q)) && seen.every((q) => /asset=BTC/.test(q)), `${name}: range drives the API period`);
      await p.click('#cmpHorizons button:has-text("12 h")'); await p.waitForTimeout(800);
      ok(seen.some((q) => /horizon=12/.test(q)), `${name}: horizon drives the API`);
    }
    ok(!/^Loading/.test((await p.textContent('#cmpSummary')).trim()), `${name}: descriptive sentiment panel resolved`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${name}: no horizontal overflow`);
    ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
    await p.screenshot({ path: (process.env.SMOKE_OUT || require('os').tmpdir()) + `/cmp-${name}${process.env.LIVE ? '-live' : ''}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log(res.join('\n')); console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${res.filter((r) => r.startsWith('FAIL')).length} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
