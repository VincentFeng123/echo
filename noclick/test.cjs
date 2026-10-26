// noclick/test.cjs: plays today's No Clicking disks end to end in headless Chromium, on a 390px phone and a desktop,
// against live Wikipedia and the AI referee (/api/judge), in Medium mode, then checks Easy and Hard. Tape 1 runs TOO BROAD (a year, "movies", a country), WHICH ONE,
// NOT FOUND, HINT, a name found through search ("werthers candy"), MOVE and UNDO, then finishes; tape 2 finishes on the rabbit's own route;
// tape 3 takes STATIC until it ejects.
// It also checks the end screen's links, share, today's score and the leaderboard (posting as "Test bot", removed after),
// reload, ?reset and the ARCHIVE tab, and fails on console errors or
// horizontal overflow. Screenshots go to shots/noclick-<phone|desk>-<step>.png.
//   node noclick/test.cjs [url]          ONLY=phone|desk to run one device (the app: http://127.0.0.1:<port>/games/; with no
//                                        database there its leaderboard says "not switched on", so posting is reported, not tested)
const { chromium } = require('/Users/vincentfeng/whiterabbit/video/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..'), SHOTS = path.join(DIR, 'shots');
const URL0 = (process.argv[2] || 'http://localhost:4747/').replace(/\/?$/, '/');
const today = JSON.parse(fs.readFileSync(path.join(__dirname, 'today.json'), 'utf8'));
const TAPES = today.tapes.map(s => JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzles', s + '.json'), 'utf8')));
// the builder writes a chain that works for each tape (puzzles/<slug>.check.json, not shipped in the page)
const CHECKS = today.tapes.map(s => JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzles', s + '.check.json'), 'utf8')));
fs.mkdirSync(SHOTS, { recursive: true });

async function run(name, vp, mobile, browser, errors) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  // whiterabbt.com serves the game under a strict, nonce-based Content-Security-Policy: anything it blocks is an error
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  const shot = async step => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `noclick-${name}-${step}.png`) }); };
  const overflow = async where => { const ow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth); if (ow) errors.push(`${name}: horizontal overflow at ${where}`); };
  const state = () => page.evaluate(() => window.__noclick.tapes());
  const view = () => page.evaluate(() => window.__noclick && window.__noclick.view());
  const waitView = async v => { for (let i = 0; i < 120; i++) { if (await view().catch(() => null) === v) return; await page.waitForTimeout(250); } throw new Error(`${name}: never reached view ${v}`); };
  const settle = async () => { await page.waitForTimeout(150); for (let i = 0; i < 120 && await page.evaluate(() => window.__noclick.busy()); i++) await page.waitForTimeout(250); };
  const btn = label => page.locator(`#hits [aria-label^="${label}"]:not([hidden])`).first();
  const type = async g => { const inp = page.locator('#hits input[data-id="guess"]'); await inp.fill(g); await inp.press('Enter'); await settle(); };
  const last = async ri => { const s = (await state())[ri]; return s.log[s.log.length - 1]; };
  const expect = async (ri, g, kind) => {
    const before = (await state())[ri].log.length; await type(g);
    const s = (await state())[ri], k = s.log.length > before ? s.log[s.log.length - 1] : 'free';
    if (!(Array.isArray(kind) ? kind.indexOf(k) >= 0 : k === kind)) errors.push(`${name}: "${g}" gave ${k}, expected ${kind}` + (k === 'free' ? ` (${await page.evaluate(() => window.__noclick.free())})` : ''));
  };

  await page.goto(URL0 + '?reset', { timeout: 120000 });
  await waitView('shelf');
  await page.waitForTimeout(1500);
  await shot('1-shelf'); await overflow('shelf');

  // tape 1: every reply, then finish on a chain that works
  await btn('Play disk 1').click({ force: true }); await waitView('play'); await page.waitForTimeout(400);
  // first time on this device: how to play, as a box with an X; its underlined words explain themselves
  const xBtn = page.locator('#hits [aria-label="Close how to play"]');
  await xBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => errors.push(`${name}: how-to-play box didn't show`));
  await shot('2-tape1-howto'); await overflow('how to play');
  const ref = page.locator('#hits [aria-label="What\'s referee?"]:not([hidden])').first();
  if (mobile) await ref.tap({ force: true }); else await ref.hover({ force: true });
  await page.waitForTimeout(500); await shot('2b-tape1-term');
  await xBtn.click({ force: true }); await page.waitForTimeout(800);
  if (await xBtn.isVisible()) errors.push(`${name}: the X didn't close how to play`);
  await shot('2c-tape1-start'); await overflow('tape 1 start');
  await expect(0, CHECKS[0].broad, 'broad');
  // a name with many senses, none connecting: WHICH ONE?, or (when the AI reader picks the planet) TOO BROAD; free either way
  await expect(0, 'Mercury', ['dym', 'broad']);
  await expect(0, 'Zqxjv wkqp', 'dym'); // no such page: free
  await btn('Hint').click({ force: true }); await settle();
  if (await last(0) !== 'track') errors.push(`${name}: HINT didn't take`);
  await shot('3-tape1-tracking');
  // umbrella topics are too broad, whatever they're typed as ("movies" is Film)
  await expect(0, 'movies', 'broad');
  await expect(0, 'Germany', 'broad');
  // a name that's neither a title nor a redirect is found through Wikipedia's search
  await expect(0, 'Baking', 'move');
  await shot('4-tape1-moved');
  const before = (await state())[0].log.length;
  await type('werthers candy');
  const s1 = (await state())[0];
  if (s1.lastTo !== "Werther's Original") errors.push(`${name}: "werthers candy" read as ${s1.lastTo}`);
  for (let i = 0; i < s1.path.length - 1; i++) { await btn('Undo').click({ force: true }); await page.waitForTimeout(200); }
  if ((await state())[0].path.length !== 1) errors.push(`${name}: UNDO didn't take`);
  for (const g of CHECKS[0].route) await expect(0, g.toLowerCase(), 'move');
  let s = (await state())[0];
  if (!s.solved) errors.push(`${name}: tape 1 not solved: ${JSON.stringify(s)}`);
  await page.waitForTimeout(4000);
  await shot('5-tape1-end'); await overflow('tape 1 end');
  const holeHref = await page.locator('#hits a[aria-label^="Open this rabbit hole"]').getAttribute('href');
  // the app links its own rabbit holes by path (/r/<id>/<title>), this repo's disks by full address
  if (holeHref !== TAPES[0].hole.url && holeHref !== new URL(TAPES[0].hole.url).pathname) errors.push(`${name}: hole link ${holeHref}`);
  if (!/whiterabbt\.com\/daily/.test(await page.locator('#hits a[aria-label^="More rabbit holes"]').getAttribute('href'))) errors.push(`${name}: more-holes link`);

  // tape 2: the rabbit's own route
  await btn('Next disk').click({ force: true }); await page.waitForTimeout(400);
  for (const g of CHECKS[1].route) await expect(1, g, 'move');
  s = (await state())[1];
  if (!s.solved || s.strokes !== TAPES[1].par) errors.push(`${name}: tape 2 ${JSON.stringify(s)}`);
  await page.waitForTimeout(4000);
  await shot('6-tape2-end');

  // tape 3: run out of strokes and eject
  await btn('Next disk').click({ force: true }); await page.waitForTimeout(400);
  await shot('7-tape3-start'); await overflow('tape 3');
  // real pages with nothing to do with the start (Wikipedia doesn't tie them, and neither does the referee)
  const far = ['Platypus', 'Saturn V', 'Sourdough', 'Tango', 'Velociraptor', 'Tuba', 'Origami', 'Mount Kilimanjaro', 'Sumo', 'Okapi', 'Paella', 'Narwhal', 'Didgeridoo', 'Haiku', 'Kimchi', 'Flamenco'];
  await expect(2, far[0], 'static');
  for (let i = 1; i < far.length && !(await state())[2].done; i++) await type(far[i]);
  s = (await state())[2];
  if (!s.ejected) errors.push(`${name}: tape 3 didn't eject: ${JSON.stringify(s)}`);
  await page.waitForTimeout(4500);
  await shot('8-tape3-ejected'); await overflow('tape 3 end');
  await btn('Copy today').click({ force: true }); await page.waitForTimeout(300);
  await shot('9-shared');
  await page.evaluate(() => { const ta = document.querySelector('textarea.sharebox'); if (ta) ta.blur(); }); await page.waitForTimeout(300);

  // today's score and the leaderboard: post under a name, see yourself on the board (the test's row is removed after)
  await btn("Today's score and leaderboard").click({ force: true });
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__noclick.board().state)) !== 'ok'; i++) await page.waitForTimeout(250);
  if (await view() !== 'scores') errors.push(`${name}: today's score didn't open`);
  await shot('9b-scores'); await overflow('scores');
  if (mobile) { for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(150); } await page.waitForTimeout(600); }
  const boardOn = (await page.evaluate(() => window.__noclick.board().state)) !== 'setup';
  if (!boardOn) console.log(`${name}: the leaderboard isn't switched on here (no database): posting not tested`);
  if (boardOn) {
  await page.locator('#hits input[data-id="name"]').fill('Test bot');
  await btn('Post my score').click({ force: true });
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__noclick.board().entries.some(e => e.mine))); i++) await page.waitForTimeout(250);
  const mine = (await page.evaluate(() => window.__noclick.board().entries)).find(e => e.mine);
  if (!mine || mine.name !== 'Test bot') errors.push(`${name}: not on the leaderboard: ${JSON.stringify(await page.evaluate(() => window.__noclick.board()))}`);
  await shot('9c-posted');
  }

  // progress survives a reload, ?reset clears it
  await page.goto(URL0); await waitView('shelf');
  s = await state();
  if (!s.every(t => t.done)) errors.push(`${name}: progress lost on reload`);
  await page.waitForTimeout(800); await shot('10-shelf-done');
  await page.goto(URL0 + '?reset'); await waitView('shelf');
  if ((await state()).some(t => t.done || t.strokes)) errors.push(`${name}: ?reset didn't clear`);

  // modes: Easy lets a country through, Hard charges a stroke for it; each mode keeps its own progress
  const playIn = async (mode, g) => {
    await btn(mode[0].toUpperCase() + mode.slice(1) + ' mode').click({ force: true }); await page.waitForTimeout(500);
    await btn('Play disk 1').click({ force: true }); await waitView('play'); await page.waitForTimeout(800);
    const x = btn('Close how to play'); if (await x.isVisible().catch(() => false)) { await x.click({ force: true }); await page.waitForTimeout(500); }
    const before = (await state())[0].log.length; await type(g);
    const s = (await state())[0];
    await btn('Back to the disks').click({ force: true }); await waitView('shelf'); await page.waitForTimeout(400);
    return { kind: s.log.length > before ? s.log[s.log.length - 1] : 'free', strokes: s.strokes };
  };
  const easy = await playIn('easy', 'Germany');
  if (easy.kind === 'broad') errors.push(`${name}: Easy mode called Germany too broad`);
  const hard = await playIn('hard', 'Germany');
  if (hard.kind !== 'broad' || hard.strokes !== 1) errors.push(`${name}: Hard mode Germany gave ${JSON.stringify(hard)}`);
  await btn('Medium mode').click({ force: true }); await page.waitForTimeout(400);
  if ((await state()).some(t => t.strokes)) errors.push(`${name}: Medium mode didn't keep its own (empty) progress`);
  await shot('11-modes');

  // ◀ WHITE RABBIT goes back to the site's page the game was opened from (here the game's own page, which opens it
  // again at another address), and to White Rabbit's home when it was opened from nowhere (the app's "/", this repo's whiterabbt.com)
  const openedAt = page.url();
  await page.evaluate(u => { location.href = u; }, URL0 + '?from=test'); await waitView('shelf');
  await btn('Back to White Rabbit').click({ force: true });
  await page.waitForURL(u => u.href === openedAt, { timeout: 15000, waitUntil: 'commit' }).catch(() => errors.push(`${name}: ◀ WHITE RABBIT didn't go back to ${openedAt} (at ${page.url()})`));
  const home = /\/games\/?$/.test(new URL(URL0).pathname) ? new URL('/', URL0).href : 'https://www.whiterabbt.com/';
  const fresh = await ctx.newPage();
  await fresh.route(u => u.href === home, r => r.fulfill({ contentType: 'text/html', body: 'home' }));
  await fresh.goto(URL0); await fresh.waitForFunction(() => window.__noclick && window.__noclick.view() === 'shelf', null, { timeout: 60000 });
  await fresh.locator('#hits [aria-label="Close how to play"]:not([hidden])').first().click({ force: true }).catch(() => {});
  await fresh.locator('#hits [aria-label="Back to White Rabbit"]:not([hidden])').first().click({ force: true });
  await fresh.waitForURL(u => u.href === home, { timeout: 15000, waitUntil: 'commit' }).catch(() => errors.push(`${name}: ◀ WHITE RABBIT opened from nowhere didn't go to ${home} (at ${fresh.url()})`));
  await fresh.close();
  await page.goto(URL0); await waitView('shelf');

  // the ARCHIVE tab switches to /desk (where the desk game is served; elsewhere the tab hides itself)
  await page.waitForTimeout(800);
  if (!(await btn('Switch to Archive').isVisible().catch(() => false))) { console.log(`${name}: no ARCHIVE tab here (desk.html absent), skipped`); await ctx.close(); return; }
  await btn('Switch to Archive').click({ force: true });
  // the switch is what's tested, not how long the desk game takes to load
  await page.waitForURL(/\/desk|\/games\/archive/, { timeout: 30000, waitUntil: 'commit' }).catch(() => errors.push(`${name}: ARCHIVE tab didn't reach the desk game`));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  for (const [name, vp, mobile] of [['phone', { width: 390, height: 844 }, true], ['desk', { width: 1280, height: 800 }, false]]) {
    if (process.env.ONLY && process.env.ONLY !== name) continue;
    try { await run(name, vp, mobile, browser, errors); } catch (e) { errors.push(name + ' crashed: ' + (e.stack || e)); }
  }
  await browser.close();
  // take the test's rows back off today's local board
  const boardFile = path.join(DIR, '../../no-clicking-2026-10-22/work/noclick-board', today.date + '.json');
  try { const rows = JSON.parse(fs.readFileSync(boardFile, 'utf8')).filter(r => r.name !== 'Test bot'); if (rows.length) fs.writeFileSync(boardFile, JSON.stringify(rows)); else fs.unlinkSync(boardFile); } catch (e) {}
  console.log(errors.length ? errors.join('\n') : 'no errors');
  process.exit(errors.length ? 1 : 0);
})();
