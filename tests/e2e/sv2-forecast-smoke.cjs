// Browser smoke test of Sentiment V2 > V2 Forecast (SV2F-1). Read-only: GET /api/sv2-forecast is answered from
// tests/fixtures/sv2-forecast-synthetic-h24|h12.json (SYNTHETIC data, test-only); scenarios 404 (route not deployed) and 500.
// Run: [SMOKE_OUT=dir] NODE_PATH=/opt/node-tools/node_modules node tests/e2e/sv2-forecast-smoke.cjs [page-url]   (serve the repo root: python3 -m http.server 8765)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/index.html').split('#')[0];
const OUT = process.env.SMOKE_OUT || '/tmp/claude-0/shots';
fs.mkdirSync(OUT, { recursive: true });
const FX = { 24: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sv2-forecast-synthetic-h24.json'), 'utf8')), 12: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sv2-forecast-synthetic-h12.json'), 'utf8')) };
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const json = (r, status, body) => r.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function mock(ctx, scenario, seen) {
  await ctx.route(/\/api\/sv2-forecast/, (r) => {
    const u = new URL(r.request().url()); seen.push(r.request().method() + ' ' + u.pathname + u.search);
    if (scenario === '404') return json(r, 404, { error: 'not found' });
    if (scenario === '500') return json(r, 500, { ok: false, error: 'D1 query failed' });
    return json(r, 200, FX[u.searchParams.get('horizon')] || { ok: false, error: 'bad horizon' });
  });
}
const text = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ');
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts, shot] of [['desktop', { viewport: { width: 1280, height: 900 } }, 'sv2f-desktop'], ['phone', { ...devices['iPhone 13'] }, 'sv2f-phone']]) {
    for (const scenario of ['ok', '404', '500']) {
      const tag = `${name}/${scenario}`; const ctx = await browser.newContext(opts); const seen = []; await mock(ctx, scenario, seen);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '#sentiment-v2/v2forecast'); await p.waitForFunction(() => !/^Loading/.test(document.getElementById('sv2fStatus').textContent), null, { timeout: 15000 }); await p.waitForTimeout(500);
      ok(await p.isVisible('#view-v2forecast') && !(await p.isVisible('#view-sentiment')), `${tag}: V2 Forecast view visible`);
      ok((await p.$$eval('#areaTabs [role="tab"]', (b) => b.map((x) => x.textContent.trim()).join('|'))) === 'Overview|V2 Forecast|Price models|Evidence / GLM', `${tag}: tabs Overview|V2 Forecast|Price models|Evidence / GLM`);
      ok((await p.$eval('#sv2fHorizon [aria-pressed="true"]', (b) => b.textContent.trim())) === '24h', `${tag}: horizon defaults to 24h`);
      ok(seen.every((s) => s.startsWith('GET ')) && seen.some((s) => /horizon=24/.test(s)), `${tag}: GET only, 24h requested (${seen.join(', ')})`);
      for (const id of ['sv2fNow', 'sv2fTrack', 'sv2fH2h', 'sv2fBands', 'sv2fRecords', 'sv2fHowBody']) ok(!/^Loading…$/.test(await text(p, '#' + id)), `${tag}: ${id} resolved`);
      if (scenario === 'ok') {
        const T = await text(p, '#view-v2forecast');
        ok(/Forecasts from the Sentiment V2 score/.test(T) && /BTC/.test(T) && /read-only evaluation/.test(T) && /SV2F-1/.test(T) && /not production logic/.test(T), `${tag}: title and note`);
        ok(await p.$eval('#view-v2forecast button[onclick*="sentiment-v1/forecast"]', (b) => !!b), `${tag}: link to the V1 forecast`);
        const now = await text(p, '#sv2fNow');
        ok(/43\.4/.test(now) && /PROPOSED/.test(now) && /62%/.test(now) && /trained on 60 known outcomes, k=8/.test(now) && /candidate, unvalidated \(built into each V2 reading\)/.test(now) && /UTC/.test(now) && /target/.test(now), `${tag}: Now cards`);
        ok((await p.$$eval('#sv2fTrack tbody tr', (r) => r.length)) === 4 && /V1 sentiment \(baseline\)/.test(await text(p, '#sv2fTrack')) && /Readings 70/.test(await text(p, '#sv2fTrack')) && /Resolved 60/.test(await text(p, '#sv2fTrack')), `${tag}: track record 4 rows + counts`);
        const h2h = await text(p, '#sv2fH2h');
        ok(/No supported difference/.test(h2h) && /Not enough resolved pairs yet \(27 of 30 needed\)/.test(h2h), `${tag}: head-to-head sentences from claim`);
        ok((await p.$$eval('#sv2fBands tbody tr', (r) => r.length)) === 3 && /PROPOSED/.test(await text(p, '#sv2fBands')), `${tag}: bands table`);
        ok((await p.$$eval('#sv2fPresets button', (b) => b.map((x) => x.textContent.trim()).join('|'))) === '24H|7D|1M|All' && (await p.$eval('#sv2fPresets [aria-pressed="true"]', (b) => b.textContent.trim())) === 'All', `${tag}: presets default All`);
        const hasChart = await p.evaluate(() => { const c = Chart.getChart('sv2fChart'); return !!c && c.data.datasets.length === 4 && c.data.datasets[1].data.some((d) => d.y === null) && c.data.datasets[1].data.some((d) => d.y !== null); });
        ok(hasChart && await p.isVisible('#sv2fChart') && !!(await p.$('#sv2fChartFsBtn')), `${tag}: chart exists (score, k-NN with gaps, 45/55) + fullscreen button`);
        ok((await p.$$eval('#sv2fRecords tbody tr', (r) => r.length)) === 50 && !!(await p.$('#sv2fMore')), `${tag}: 50 record rows + show more`);
        await p.click('#sv2fMore'); ok((await p.$$eval('#sv2fRecords tbody tr', (r) => r.length)) === 70 && !(await p.$('#sv2fMore')), `${tag}: show more reveals all 70`);
        ok(/✓/.test(await text(p, '#sv2fRecords')) && /✗/.test(await text(p, '#sv2fRecords')) && /pending/.test(await text(p, '#sv2fRecords')), `${tag}: correctness marks and pending`);
        ok(!(await p.$eval('#sv2fHow', (d) => d.open)) && /overlap, so the effective sample is smaller than n/.test(await text(p, '#sv2fHowBody')), `${tag}: methodology collapsed with overlap caveat`);
        await p.click('#sv2fPresets [data-k="7D"]'); await p.waitForTimeout(200);
        ok((await p.$eval('#sv2fPresets [aria-pressed="true"]', (b) => b.textContent.trim())) === '7D', `${tag}: preset switch works`);
        await p.click('#sv2fPresets [data-k="ALL"]');
        const c1 = await p.evaluate(() => Chart.getChart('sv2fChart').id);
        // horizon toggle: 12h
        await p.click('#sv2fHorizon [data-h="12"]'); await p.waitForFunction(() => /12h horizon/.test(document.getElementById('sv2fStatus').textContent), null, { timeout: 8000 }); await p.waitForTimeout(300);
        ok((await p.$eval('#sv2fHorizon [aria-pressed="true"]', (b) => b.textContent.trim())) === '12h' && seen.some((s) => /horizon=12/.test(s)), `${tag}: horizon toggle requests 12h`);
        ok(/24h only/.test(await text(p, '#sv2fNow')) && /48\.1%|48%/.test(await text(p, '#sv2fNow')) , `${tag}: 12h now: analogue "24h only", k-NN 48%`);
        ok(/—/.test(await text(p, '#sv2fTrack')) && (await p.evaluate(() => Chart.getChart('sv2fChart').id)) === c1, `${tag}: 12h track record has analogue "—"; chart updated, not recreated`);
        await p.click('#sv2fHorizon [data-h="24"]'); await p.waitForFunction(() => /24h horizon/.test(document.getElementById('sv2fStatus').textContent), null, { timeout: 8000 }); await p.waitForTimeout(300);
        await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, shot + '.png'), fullPage: true });
      } else {
        const st = await text(p, '#sv2fStatus');
        if (scenario === '404') ok(/NOT AVAILABLE YET/.test(st) && /Not available yet/.test(await text(p, '#sv2fNow')) && !(await p.isVisible('#sv2fChart')), `${tag}: clean "Not available yet" state, no chart`);
        else ok(/ERROR/.test(st) && /D1 query failed/.test(st) && /error above/.test(await text(p, '#sv2fTrack')) && !(await p.isVisible('#sv2fChart')), `${tag}: error state with reason`);
        ok(!/\d+\.\d%/.test(await text(p, '#view-v2forecast')), `${tag}: no numbers shown`);
      }
      ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${tag}: no horizontal page overflow`);
      ok(errs.length === 0, `${tag}: no page errors ${errs.join(' | ')}`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(res.join('\n')); const f = res.filter((x) => x.startsWith('FAIL')).length;
  console.log(`\n${res.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
