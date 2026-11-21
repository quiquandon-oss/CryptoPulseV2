// Browser test: Alerts (V2 operational checks + V1 alerts read-only) and Settings. V1 routes answered from fixtures;
// the test fails if the page calls V1 with anything but the two alert GETs while on Alerts.
// Run: node tests/e2e/stage8-alerts-smoke.cjs <page-url>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const res = []; const ok = (c, m) => res.push((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['iPhone 13'] }]]) {
    const ctx = await browser.newContext(opts); const calls = [];
    await ctx.route('https://sentiment-ff75.quiquandon.workers.dev/**', (r) => { const q = r.request(), u = new URL(q.url()); calls.push(q.method() + ' ' + u.pathname);
      const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
      if (u.pathname === '/alert-configs') return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ configs: [{ id: 7, type: 'price', enabled: 1, params_json: '{"coin":"BTC","below":60000}', cooldown_minutes: 120, last_fired_ts: Date.now() - 7200e3, created_ts: 1, fire_count: 4 }] }) });
      if (u.pathname === '/alert-log') return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ log: [{ id: 1, ts: Date.now() - 7200e3, config_id: 7, type: 'price', message: 'FIXTURE BTC below 60000' }] }) });
      return r.fulfill({ status: 404, headers: h, body: '{}' }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#alerts'); await p.waitForTimeout(3500);
    ok(/1 of 1 enabled/.test(await p.textContent('#v1AlConfigs')) && /coin BTC · below 60000/.test(await p.textContent('#v1AlConfigs')), `${name}: V1 alert configs shown read-only`);
    ok(/FIXTURE BTC below 60000/.test(await p.textContent('#v1AlLog')), `${name}: V1 alert log shown`);
    ok(!/Loading/.test(await p.textContent('#alertsStatusBody')), `${name}: operational checks rendered`);
    ok(JSON.stringify(calls.sort()) === JSON.stringify(['GET /alert-configs', 'GET /alert-log']), `${name}: only the two alert GETs reach V1: ${calls.join(', ')}`);
    // the only buttons allowed are the display-only "More"/"Show" toggles of the UX layer (no handler reaches the network)
    ok((await p.$$('#view-alerts button:not(.ux-more):not(.ux-fold-btn):not(.ux-rows-btn), #view-alerts input, #view-alerts select')).length === 0, `${name}: no control that could change V1 alerts`);
    await p.goto(BASE + '#settings'); await p.waitForTimeout(800);
    const st = await p.textContent('#settingsBody');
    ok(/PRODUCTION/.test(st) && /Portfolio data/.test(st) && /stored only in this browser/.test(st) && /cannot be changed from this page/.test(st), `${name}: settings show data source, portfolio storage, no model controls`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `${name}: no horizontal overflow`);
    ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(res.join('\n')); console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} passed, ${res.filter((r) => r.startsWith('FAIL')).length} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
