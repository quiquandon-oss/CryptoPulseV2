// Browser test of the Comparison dashboard (contracts §7, PulseWorkerV2 cmp-v1-v2-1; sections A-F).
//   default : /api/comparison/v1-v2* is answered from tests/fixtures/comparison-*-btc24-2026-11-20.json (real production data) for BTC.
//             Scenario "btc-only": ETH and LINK answer HTTP 400 {error:'unsupported asset (supported: BTC)'} like production before the
//             multi-asset deploy. Scenario "all-assets": ETH, LINK (and BTC 12 h) are served from MOCKED copies of the fixture records
//             (asset renamed, timestamps shifted, repeated to 130 rows so "show more" is exercised). Mock data is test-only.
//   LIVE=1  : uses whatever the production Worker serves (ETH/LINK show "not available yet" until deployed).
// Run: [LIVE=1] [SMOKE_OUT=dir] node tests/e2e/comparison-smoke.cjs <page-url>   (serve the repo root: python3 -m http.server 8765)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const OUT = process.env.SMOKE_OUT || '/tmp/claude-0/shots';
fs.mkdirSync(OUT, { recursive: true });
const SUM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'comparison-summary-btc24-2026-11-20.json'), 'utf8'));
const REC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'comparison-records-btc24-2026-11-20.json'), 'utf8'));
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
const pct = (v) => (v * 100).toFixed(1) + '%';
const WEEK = 7 * 86400000;
function mockRecords(asset, horizon, n) {
  const out = [];
  for (let k = 0; out.length < n; k++) for (const r of REC.records) {
    if (out.length >= n) break;
    const sh = k * WEEK + (asset === 'ETH' ? 3600000 : asset === 'LINK' ? 7200000 : 0);
    const c = JSON.parse(JSON.stringify(r)); c.asset = asset; c.horizon_hours = horizon; c.decision_ts -= sh; c.target_ts -= sh;
    if (asset !== 'BTC') { c.v2_final.glm_applied = false; c.v2_final.reason = 'glm_out_of_scope'; c.v2_final.adjustment = 0; }
    if (c.outcome.resolved_ts) c.outcome.resolved_ts -= sh; out.push(c);
  }
  return out;
}
const json = (r, status, body) => r.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function mockRoutes(ctx, scenario, seen) {
  await ctx.route(/\/api\/comparison\/v1-v2/, (r) => {
    const u = new URL(r.request().url()); seen.push(u.pathname + u.search);
    const asset = u.searchParams.get('asset'), h = Number(u.searchParams.get('horizon'));
    if (asset !== 'BTC' && scenario === 'btc-only') return json(r, 400, { ok: false, error: 'unsupported asset (supported: BTC)' });
    if (u.pathname.endsWith('/summary')) return json(r, 200, { ...SUM, asset, horizon_hours: h });
    const lim = Number(u.searchParams.get('limit') || 200);
    const recs = scenario === 'all-assets' ? mockRecords(asset, h, 130) : (h === 24 ? REC.records : []);
    return json(r, 200, { ...REC, asset, horizon_hours: h, records: recs.slice(0, lim), count: Math.min(lim, recs.length) });
  });
}
const text = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ');
const rows = (p) => p.$$eval('#cmpTable tbody tr', (t) => t.map((x) => x.children[0].textContent.trim()));
async function common(p, name, errs) {
  ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${name}: no horizontal page overflow`);
  ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
}
(async () => {
  const browser = await chromium.launch();
  // 1) btc-only: production behaviour before ETH / LINK are deployed
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const scenarios = process.env.LIVE ? ['live'] : ['btc-only', 'all-assets'];
    for (const scenario of scenarios) {
      const tag = `${name}/${scenario}`;
      const ctx = await browser.newContext(opts); const seen = [];
      if (!process.env.LIVE) await mockRoutes(ctx, scenario, seen);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '#comparison'); await p.waitForSelector('#cmpExec .font-mono-data, #cmpExec .rounded-full, #cmpExec span', { timeout: 15000 }); await p.waitForTimeout(1500);
      // controls
      ok((await p.$$eval('#cmpPresets button', (b) => b.map((x) => x.textContent.trim()).join('|'))) === '24H|7D|1M|All', `${tag}: windows 24H|7D|1M|All`);
      ok((await p.$eval('#cmpPresets [aria-pressed="true"]', (b) => b.textContent.trim())) === 'All', `${tag}: window defaults to All`);
      ok((await p.$$eval('#cmpAssets button', (b) => b.map((x) => x.textContent.trim()).join('|'))) === 'All|BTC|ETH|LINK', `${tag}: assets All|BTC|ETH|LINK`);
      ok((await p.$eval('#cmpAssets [aria-pressed="true"]', (b) => b.textContent.trim())) === 'All', `${tag}: asset defaults to All`);
      ok((await p.$$eval('#cmpHorizons button', (b) => b.map((x) => x.textContent.trim()).join('|'))) === '12 h|24 h', `${tag}: horizons 12 h|24 h`);
      ok(!/^Loading/.test(await text(p, '#cmpHeadline')), `${tag}: headline resolved`);
      // all six sections resolved (no indefinite spinner)
      for (const id of ['cmpExec', 'cmpTrendState', 'cmpAgreeState', 'cmpDState', 'cmpGlm', 'cmpTable', 'cmpSummary']) ok(!/^Loading…$/.test(await text(p, '#' + id)), `${tag}: ${id} resolved`);
      const exec = await text(p, '#cmpExec'), head = await text(p, '#cmpHeadline');
      if (!process.env.LIVE) {
        const s = SUM.summary;
        if (scenario === 'btc-only') {
          ok(exec.includes(pct(s.accuracy.v1.rate)) && exec.includes(pct(s.accuracy.v2_final.rate)), `${tag}: A shows the backend V1 / V2 accuracy`);
          ok(/Forecast \(/.test(exec) && /95% CI/.test(exec) && new RegExp('n=' + s.accuracy.v1.n).test(exec), `${tag}: A shows baseline, CI and n`);
        } else ok(/V1 sentiment/.test(exec) && /Forecast \+ GLM/.test(exec) && /Forecast \(/.test(exec) && /95% CI \d/.test(exec) && /n=\d+/.test(exec), `${tag}: A shows pooled V1 / V2 / baseline with CI and n`);
        ok(/Resolved comparable predictions/.test(exec) && /V1 coverage \/ missing/.test(exec) && /Agreement \/ disagreement/.test(exec), `${tag}: A coverage, missing, agreement`);
        ok(/V1 higher/.test(exec) && /\+?-?\d+(\.\d)? pp/.test(exec), `${tag}: difference shown because the backend claim supports it (${s.claim})`);
        ok(/^BTC: No: V1 was right more often|^No: V1 was right more often/.test(head), `${tag}: headline follows the backend claim`);
      }
      ok(/proposed/i.test(await text(p, '#view-comparison')) && /market-wide/.test(await text(p, '#view-comparison')), `${tag}: V1 proposed 45/55 and market-wide stated`);
      // charts
      const ch = await p.evaluate(() => ['cmpTrendChart', 'cmpAgreeChart', 'cmpAssetChart', 'cmpHorizonChart'].map((id) => { const c = Chart.getChart(id); return c ? c.data.datasets.length : 0; }));
      ok(ch.every((n) => n > 0), `${tag}: four charts created (${ch})`);
      ok(await p.$$eval('.chart-fs-btn', (b) => b.length) >= 4, `${tag}: fullscreen buttons on charts`);
      const trend = await p.evaluate(() => { const c = Chart.getChart('cmpTrendChart'); return { labels: c.data.labels.length, hasPending: c.data.datasets.some((d) => /Pending/.test(d.label)), n: c.data.datasets[0].$n }; });
      ok(trend.labels > 0 && trend.hasPending && trend.n.length === trend.labels, `${tag}: B weekly buckets with n and a pending series (${trend.labels} weeks)`);
      ok(/Opposite-direction/.test(await text(p, '#cmpOpposite')) && /V1 right/.test(await text(p, '#cmpOpposite')), `${tag}: C who-was-right table`);
      ok(/GLM applies to BTC 24 h only/.test(await text(p, '#cmpGlm')) && /Calls changed by GLM/.test(await text(p, '#cmpGlm')), `${tag}: E GLM block`);
      ok(await p.$eval('#cmpSecE button', (b) => /goRoute\('sentiment-v2\/evidence'\)/.test(b.getAttribute('onclick'))), `${tag}: E links to the GLM evidence page`);
      ok(await p.$eval('#view-comparison details', (d) => !d.open), `${tag}: Sentiment levels collapsed`);
      const avail = await text(p, '#cmpAvail');
      const tb = await rows(p);
      if (scenario === 'btc-only') {
        ok(/ETH/.test(avail) && /LINK/.test(avail) && /NOT AVAILABLE YET/.test(avail), `${tag}: D lists ETH and LINK as not available yet`);
        ok(/ETH · NOT AVAILABLE YET/.test(head) && /LINK · NOT AVAILABLE YET/.test(head), `${tag}: unavailable chips next to the answer`);
        ok(tb.length > 0 && tb.every((a) => a === 'BTC'), `${tag}: table only has BTC rows (${tb.length})`);
        ok(await p.evaluate(() => Chart.getChart('cmpAssetChart').data.labels.join()) === 'BTC', `${tag}: asset chart draws BTC only, nothing invented`);
        await p.click('#cmpAssets button:has-text("ETH")'); await p.waitForTimeout(1200);
        const e = (await text(p, '#cmpExec')) + (await text(p, '#cmpTable')) + (await text(p, '#cmpTrendState'));
        ok(/NOT AVAILABLE YET/.test(e) && !/\d+\.\d%/.test(await text(p, '#cmpExec')) && (await rows(p)).length === 0, `${tag}: ETH alone shows an explicit not-available state, no figures`);
        ok(/not available yet/i.test(await text(p, '#cmpHeadline')) || /NOT AVAILABLE YET/.test(await text(p, '#cmpHeadline')), `${tag}: ETH headline says not available`);
        ok(/not available yet|NOT AVAILABLE/i.test(await text(p, '#cmpGlm')), `${tag}: ETH GLM block is a state, not an error`);
        await p.click('#cmpAssets button:has-text("BTC")'); await p.waitForTimeout(1200);
        ok((await rows(p)).length > 0 && (await rows(p)).every((a) => a === 'BTC'), `${tag}: switching back to BTC restores the table`);
      } else if (scenario === 'all-assets') {
        ok(!/NOT AVAILABLE YET/.test(await text(p, '#cmpHeadline')), `${tag}: no unavailable chips when all assets are served`);
        ok(tb.length === 100, `${tag}: table shows the newest 100 (${tb.length})`);
        await p.click('#cmpMore'); await p.waitForTimeout(300);
        ok((await rows(p)).length === 200, `${tag}: show more adds 100 rows (${(await rows(p)).length})`);
        ok(await p.evaluate(() => Chart.getChart('cmpAssetChart').data.labels.join()) === 'BTC,ETH,LINK', `${tag}: asset chart has BTC, ETH, LINK`);
        ok(/pooled|Pools/.test(await text(p, '#cmpExec')), `${tag}: All pools records and says the claim is per asset`);
        await p.click('#cmpAssets button:has-text("LINK")'); await p.waitForTimeout(1200);
        const l = await rows(p);
        ok(l.length === 100 && l.every((a) => a === 'LINK'), `${tag}: table filter LINK shows only LINK rows (${l.length})`);
        ok(/not in scope|only/i.test(await text(p, '#cmpGlm')), `${tag}: GLM says out of scope for LINK`);
        await p.click('#cmpAssets button:has-text("All")'); await p.waitForTimeout(1200);
        await p.click('#cmpHorizons button:has-text("12 h")'); await p.waitForTimeout(1200);
        ok(seen.some((q) => /horizon=12/.test(q)) && (await rows(p)).length > 0, `${tag}: horizon drives the API and the table`);
        ok(/GLM is evaluated on BTC 24 h only|not in scope/i.test(await text(p, '#cmpGlm')), `${tag}: GLM scope message at 12 h`);
        await p.click('#cmpHorizons button:has-text("24 h")'); await p.waitForTimeout(800);
        await p.click('#cmpPresets button:has-text("7D")'); await p.waitForTimeout(1200);
        ok(seen.some((q) => /period=7d/.test(q)), `${tag}: window drives the API period`);
        await p.click('#cmpPresets button:has-text("All")'); await p.waitForTimeout(800);
      } else {
        ok(true, `${tag}: live page rendered (ETH/LINK state depends on the deployed Worker)`);
      }
      await common(p, tag, errs);
      if (scenario === (process.env.LIVE ? 'live' : 'all-assets')) await p.screenshot({ path: `${OUT}/cmp-dash-${name}${process.env.LIVE ? '-live' : ''}.png`, fullPage: true });
      await ctx.close();
    }
  }
  // 2) error state: every comparison request fails with HTTP 500; the page must say so and not spin or throw
  if (!process.env.LIVE) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/\/api\/comparison\/v1-v2/, (r) => json(r, 500, { ok: false, error: 'boom' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#comparison'); await p.waitForTimeout(4000);
    ok(/UNAVAILABLE/.test(await text(p, '#cmpExec')) && !/Loading…$/.test(await text(p, '#cmpTable')), 'error: 500 shows an explicit error state');
    await common(p, 'error', errs); await ctx.close();
  }
  await browser.close();
  console.log(res.join('\n')); const f = res.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${f} failed`); if (f) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
