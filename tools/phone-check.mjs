// Opens the hosted voice test as a phone would and times each engine.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('shots', { recursive: true });
const URL = process.env.URL;
const runs = [
  { name: 'phone, slowed 4x, speed boost on', throttle: 4, q: '' },
  { name: 'phone, slowed 4x, speed boost off', throttle: 4, q: '?nocoi' },
];
const all = [];
for (const run of runs) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('console', m => console.log('  console:', m.type(), m.text().slice(0, 300)));
  page.on('requestfailed', r => console.log('  failed:', r.url().slice(0, 150), r.failure()?.errorText));
  page.on('pageerror', e => console.log('  pageerror:', e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL + run.q, { waitUntil: 'load' });
  await page.waitForTimeout(4000); // speed boost reloads the page once
  try { await page.waitForFunction(() => window.__voiceReady === true, null, { timeout: 60000 }); }
  catch (e) { console.log('NOT READY. url=', page.url(), '\n', (await page.content()).slice(0, 1500)); throw e; }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: run.throttle });
  const info = await page.evaluate(() => ({ isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency }));
  const wait = (key, n) => page.waitForFunction(([k, n]) => window.__voiceTest[k].length >= n || window.__voiceTest.errors.length, [key, n], { timeout: 900000 });
  // Cold: first ever play (downloads the engine)
  await page.click('#kPlay'); await wait('kokoro', 1);
  // Warm: another voice, engine already loaded
  await page.click('#kVoices .chip:nth-child(6)'); await page.click('#kPlay'); await wait('kokoro', 2);
  await page.screenshot({ path: `shots/${all.length}-kokoro.png`, fullPage: true });
  // Piper Spanish
  await page.click('#lPlay'); await wait('piper', 1);
  await page.screenshot({ path: `shots/${all.length}-piper.png`, fullPage: true });
  const res = await page.evaluate(() => window.__voiceTest);
  // Reload: engine comes from the device's storage
  await page.reload(); await page.waitForFunction(() => window.__voiceReady === true);
  await page.click('#kPlay'); await wait('kokoro', 1);
  const again = await page.evaluate(() => window.__voiceTest);
  const out = { run: run.name, ...info, cold: res.kokoro[0], warm: res.kokoro[1], piper: res.piper[0], afterReload: again.kokoro[0], errors: [...res.errors, ...again.errors] };
  console.log(JSON.stringify(out, null, 1));
  all.push(out);
  await browser.close();
}
fs.writeFileSync('shots/results.json', JSON.stringify(all, null, 1));
if (all.some(a => a.errors.length || !a.cold || !a.piper)) process.exit(1);
