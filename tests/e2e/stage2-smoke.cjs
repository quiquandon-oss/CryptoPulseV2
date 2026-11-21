// Browser smoke test for the nine-area navigation and the global chart standard (OD-08).
// Read-only: the page only issues GET requests to the API it is pointed at. Not run in CI (needs Chromium + network).
// Run: node tests/e2e/stage2-smoke.cjs <page-url>   e.g. http://127.0.0.1:8765/index.html or https://quiquandon-oss.github.io/CryptoPulseV2/index.html
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const OUT = process.env.SMOKE_OUT || require('os').tmpdir();
const results = []; const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const browser = await chromium.launch();
  // ---------- desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|CORS|raw\.githubusercontent|api\.github\.com|fonts\./i.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const labels = await page.$$eval('#areaNavDesktop [data-area]', bs => bs.map(b => b.textContent.trim()));
  ok(labels.join('|') === 'Portfolio|Sentiment V1|Sentiment V2|Model Comparison|Research|Alerts|Settings', 'desktop nav has the seven areas: ' + labels.join(', '));
  ok(!(await page.content()).includes('>Forecasting Lab<'), 'no "Forecasting Lab" label anywhere');
  ok(page.url().endsWith('#portfolio/holdings'), 'default route: Portfolio (' + page.url().split('#')[1] + ')');
  ok(await page.isVisible('#view-portfolio'), 'Portfolio visible on landing');
  await page.goto(BASE.split('#')[0] + '#sentiment-v1/forecast', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
  ok(await page.isVisible('#view-dashboard') && !(await page.isVisible('#view-sentiment')), 'Sentiment V1 > Forecast shows the k-NN forecast engine (V1-sentiment inputs)');
  ok((await page.getAttribute('#rangeTabs [data-range="24H"]', 'aria-pressed')) === 'true', 'price chart: 24H selected by default');
  ok((await page.$$eval('#rangeTabs [data-range]', bs => bs.map(b => b.textContent.trim()).join('|'))) === '24H|7D|1M|All', 'price chart presets 24H|7D|1M|All');
  await page.click('#fullscreenBtn'); await page.waitForTimeout(300);
  ok(await page.$eval('#chartSection', e => e.classList.contains('fixed')), 'price chart enters full screen');
  ok((await page.getAttribute('#fullscreenBtn', 'aria-label')) === 'Exit full screen', 'exit label shown');
  await page.screenshot({ path: OUT + '/d-overview-fullscreen.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok(!(await page.$eval('#chartSection', e => e.classList.contains('fixed'))), 'Esc exits full screen');
  ok((await page.getAttribute('#rangeTabs [data-range="24H"]', 'aria-pressed')) === 'true', 'range preserved after full screen');
  await page.click('#rangeTabs [data-range="7D"]'); await page.waitForTimeout(200);
  ok((await page.getAttribute('#rangeTabs [data-range="7D"]', 'aria-pressed')) === 'true', 'switch to 7D stays selected');
  // each area
  const areaViews = { portfolio: ['portfolio'], 'sentiment-v1': ['sentiment-v1'], 'sentiment-v2': ['sentiment'], comparison: ['comparison'], research: ['experiments'], alerts: ['alerts'], settings: ['settings'] };
  for (const [a, v] of Object.entries(areaViews)) {
    await page.click(`#areaNavDesktop [data-area="${a}"]`); await page.waitForTimeout(a === 'sentiment-v1' || a === 'comparison' || a === 'sentiment-v2' ? 3500 : 1200);
    let vis = true; for (const x of v) vis = vis && await page.isVisible('#view-' + x);
    const others = await page.$$eval('[id^="view-"]', (els, v) => els.filter(e => !v.includes(e.id.slice(5)) && !e.classList.contains('hidden') && e.offsetParent !== null).map(e => e.id), v);
    ok(vis && others.length === 0, `area ${a}: #view-${v.join('+')} visible, others hidden ${others.length ? '(also: ' + others.join(',') + ')' : ''}`);
    await page.screenshot({ path: OUT + `/d-${a}.png`, fullPage: false });
  }
  ok(await page.$('#areaNavDesktop [data-area="learning"]') === null && await page.$('#view-learningblock') === null, 'Learning & Audit is not a frontend destination any more');
  // Sentiment V2 tabs
  await page.click('#areaNavDesktop [data-area="sentiment-v2"]'); await page.waitForTimeout(2500);
  ok((await page.$$eval('#areaTabs [role="tab"]', bs => bs.map(b => b.textContent.trim()).join('|'))) === 'Overview|Price models|Evidence / GLM', 'Sentiment V2 tabs Overview|Price models|Evidence / GLM');
  ok((await page.$eval('#sv2Periods [aria-pressed="true"]', b => b.textContent.trim())) === '24H', 'SV2 chart default 24H');
  ok((await page.$$eval('#sv2Periods button', bs => bs.map(b => b.textContent.trim()).join('|'))) === '24H|7D|1M|All', 'SV2 presets 24H|7D|1M|All');
  ok(await page.$('#sv2Chart ~ .chart-fs-btn, #sv2Chart + .chart-fs-btn') !== null, 'SV2 chart has a full-screen control');
  await page.click('#areaTabs [data-route="sentiment-v2/forecast"]'); await page.waitForTimeout(6000);
  ok(page.url().endsWith('#sentiment-v2/forecast') && await page.isVisible('#view-forecast'), 'Forecast tab inside Sentiment V2');
  ok((await page.$eval('#flPeriods [aria-pressed="true"]', b => b.textContent.trim())) === '24H', 'Forecast default 24H');
  ok((await page.$$eval('#flPeriods button', bs => bs.map(b => b.textContent.trim()).join('|'))) === '24H|7D|1M|All', 'Forecast presets 24H|7D|1M|All');
  const fsBtns = await page.$$eval('#view-forecast .chart-fs-btn', bs => bs.length);
  ok(fsBtns >= 5, 'Forecast charts have full-screen controls: ' + fsBtns);
  await page.screenshot({ path: OUT + '/d-forecast.png' });
  if (fsBtns) { await page.click('#flMainChartFsBtn'); await page.waitForTimeout(300); ok(await page.$eval('#flMainChartFsBtn', b => b.getAttribute('aria-pressed') === 'true'), 'forecast main chart full screen'); await page.screenshot({ path: OUT + '/d-forecast-fs.png' }); await page.click('#flMainChartFsBtn'); await page.waitForTimeout(200); ok(await page.$eval('#flMainChartFsBtn', b => b.getAttribute('aria-pressed') === 'false'), 'forecast main chart exit via button'); }
  await page.click('#areaTabs [data-route="sentiment-v2/evidence"]'); await page.waitForTimeout(4000);
  ok(await page.isVisible('#glmPanel') && await page.isVisible('#prospectiveCard'), 'Evidence / GLM tab: GLM panel and the frozen protocols (GLM-PE-1, PEV-1P)');
  await page.click('#areaNavDesktop [data-area="sentiment-v1"]'); await page.waitForTimeout(1500);
  ok((await page.$$eval('#areaTabs [role="tab"]', bs => bs.map(b => b.textContent.trim()).join('|'))) === 'Overview|Forecast|History & model|Trader Analysis', 'Sentiment V1 tabs Overview|Forecast|History & model|Trader Analysis');
  await page.click('#areaTabs [data-route="sentiment-v1/history"]'); await page.waitForTimeout(3500);
  ok(await page.isVisible('#view-lab') && await page.isVisible('#view-history'), 'V1 > History & model: prediction history and the model challenger (Lab)');
  await page.click('#areaTabs [data-route="sentiment-v1/trader"]'); await page.waitForTimeout(800);
  ok(await page.isVisible('#traderCard') && !(await page.isVisible('#view-sentiment')), 'Trader Analysis under Sentiment V1');
  // legacy links
  for (const [h, want] of [['#forecast', 'sentiment-v2/forecast'], ['#lab', 'sentiment-v1/history'], ['#dashboard', 'sentiment-v1/forecast'], ['#overview', 'sentiment-v1/forecast'], ['#experiments', 'research'], ['#history', 'sentiment-v1/history'], ['#learning', 'sentiment-v1/history']]) {
    await page.goto(BASE + h, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(800);
    ok(page.url().endsWith('#' + want), `legacy ${h} -> #${want}`);
  }
  await page.goto(BASE + '#sentiment-v1', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4500);
  ok((await page.$eval('#v1Presets [aria-pressed="true"]', b => b.textContent.trim())) === '24H', 'V1 chart default 24H');
  ok(!/Loading/.test(await page.textContent('#v1Status')), 'V1 status resolved: ' + (await page.textContent('#v1Status')).slice(0, 90));
  ok(await page.$('#v1Chart') && await page.$eval('#v1Summary', e => e.children.length) === 4, 'V1 summary rendered');
  await page.screenshot({ path: OUT + '/d-sentiment-v1.png' });
  await page.goto(BASE + '#comparison', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4500);
  const cmp = await page.textContent('#cmpSummary');
  ok(!/^Loading/.test(cmp), 'comparison resolved: ' + cmp.replace(/\s+/g, ' ').slice(0, 140));
  await page.screenshot({ path: OUT + '/d-comparison.png' });
  await page.goto(BASE + '#sentiment-v2/overview', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(800);
  // refresh button works (no error)
  await page.click('#refreshBtn'); await page.waitForTimeout(1500);
  ok(true, 'refresh button clicked without page error');
  ok(errors.length === 0, 'no page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''));
  // ---------- phone ----------
  const pctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await pctx.newPage();
  const perr = []; p.on('pageerror', e => perr.push(e.message));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  ok(!(await p.isVisible('#areaNavDesktop')), 'phone: desktop nav hidden');
  const mob = await p.$$eval('#areaNavMobile button', bs => bs.map(b => b.textContent.trim()));
  ok(mob.length === 5, 'phone bar has 5 items: ' + mob.join(','));
  await p.click('#moreBtn'); await p.waitForTimeout(300);
  ok(await p.isVisible('#moreSheet'), 'phone: More sheet opens');
  await p.screenshot({ path: OUT + '/m-more.png' });
  await p.click('#moreSheet [data-area="settings"]'); await p.waitForTimeout(500);
  ok(p.url().endsWith('#settings') && await p.isVisible('#view-settings') && !(await p.isVisible('#moreSheet')), 'phone: More → Settings');
  await p.goto(BASE + '#sentiment-v2/forecast', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(6000);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, 'phone: no horizontal page overflow on Forecast (' + overflow + 'px)');
  await p.screenshot({ path: OUT + '/m-forecast.png' });
  const b = await p.$('#flMainChartFsBtn');
  if (b) { await b.click(); await p.waitForTimeout(300); const box = await p.$eval('#flMainChartFsBtn', e => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: innerHeight }; }); ok(box.t >= 0 && box.b <= box.h, 'phone: exit control visible in full screen'); await p.screenshot({ path: OUT + '/m-forecast-fs.png' }); await p.click('#flMainChartFsBtn'); }
  await p.goto(BASE + '#sentiment-v1/forecast', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ov2 <= 1, 'phone: no horizontal overflow on Sentiment V1 Forecast (' + ov2 + 'px)');
  await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
  ok(p.url().endsWith('#portfolio/holdings') && (await p.$$eval('#areaNavMobile [data-area]', bs => bs.map(b => b.dataset.area).join('|'))) === 'portfolio|sentiment-v1|sentiment-v2|comparison', 'phone: lands on Portfolio; bar Portfolio|V1|V2|Compare + More');
  await p.screenshot({ path: OUT + '/m-overview.png' });
  ok(perr.length === 0, 'phone: no page errors' + (perr.length ? ': ' + perr.join(' | ') : ''));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${results.filter(r => r.startsWith('FAIL')).length} failed`);
})().catch(e => { console.error(e); process.exit(1); });
