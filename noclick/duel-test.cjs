// noclick/duel-test.cjs: a 1v1 race end to end in headless Chromium: two players (two browsers, one on a phone) join
// the queue under their names, get matched on the same disk, see the countdown, and race; one plays a route that works
// (from the disk's .check.json), the other leaves, giving the race away. Checks the result on both sides, the ratings
// and the 1V1 RATING board, cancelling the queue, and that nothing the page's policy forbids was blocked. Against this
// repo's server (in-memory races) or the app with its database.
//   node noclick/duel-test.cjs [url]      LIVE=1: players "Test A" and "Test B", the disk's own rabbit route (a live disk
//                                         has no .check.json), and finishing isn't required (Bob leaving wins it for Amy)
const { chromium } = require('/Users/vincentfeng/whiterabbit/video/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const URL0 = (process.argv[2] || 'http://localhost:4747/').replace(/\/?$/, '/');
const PUZ = path.join(__dirname, 'puzzles');
const checks = {};
for (const f of fs.readdirSync(PUZ)) if (f.endsWith('.check.json')) { const p = JSON.parse(fs.readFileSync(path.join(PUZ, f.replace('.check', '')), 'utf8')); checks[p.start] = JSON.parse(fs.readFileSync(path.join(PUZ, f), 'utf8')).route; }

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const LIVE = !!process.env.LIVE;
  const player = async (name, mobile) => {
    const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
    await page.addInitScript(n => { try { localStorage.removeItem('white-rabbit-no-clicking-name'); localStorage.setItem('white-rabbit-no-clicking-help', '1'); } catch (e) {} }, name);
    await page.goto(URL0);
    await page.waitForFunction(() => window.__noclick && window.__noclick.view() === 'shelf', null, { timeout: 60000 });
    const btn = label => page.locator(`#hits [aria-label^="${label}"]:not([hidden])`).first();
    return { name, page, ctx, btn, duel: () => page.evaluate(() => window.__noclick.duel()), view: () => page.evaluate(() => window.__noclick.view()) };
  };
  const until = async (p, fn, what, ms = 30000) => { for (let t = 0; t < ms; t += 250) { if (await fn()) return true; await p.page.waitForTimeout(250); } errors.push(`${p.name}: ${what}`); return false; };
  const shot = (p, step) => p.page.screenshot({ path: path.join(__dirname, '..', 'shots', `duel-${p.name.toLowerCase()}-${step}.png`) });
  try {
    const amy = await player(LIVE ? 'Test A' : 'Amy', false), bob = await player(LIVE ? 'Test B' : 'Bob', true);
    // into the queue: a name first, then waiting
    for (const p of [amy, bob]) {
      await p.btn('1v1: race someone else').click({ force: true });
      await until(p, async () => (await p.page.evaluate(() => window.__noclick.queue() && window.__noclick.queue().state)) === 'name', 'never asked for a name');
      await p.page.locator('#hits input[data-id="duel-name"]').fill(p.name);
      await p.btn('Find an opponent').click({ force: true });
      if (p === amy) { await until(amy, async () => (await amy.page.evaluate(() => window.__noclick.queue() && window.__noclick.queue().state)) === 'waiting', 'never waited'); await amy.page.waitForTimeout(600); await shot(amy, '1-waiting'); }
    }
    // matched, the countdown, then the same disk for both
    for (const p of [amy, bob]) await until(p, async () => !!(await p.duel()), 'never matched', 20000);
    await shot(bob, '2-countdown');
    for (const p of [amy, bob]) await until(p, async () => (await p.duel()).started && (await p.view()) === 'play', 'the race never started', 20000);
    const da = await amy.duel(), db = await bob.duel();
    if (da.id !== db.id || da.start !== db.start || da.target !== db.target) errors.push(`not the same race: ${JSON.stringify([da, db])}`);
    if (da.them.name !== bob.name || db.them.name !== amy.name) errors.push(`names: ${da.them.name} / ${db.them.name}`);
    console.log(`racing on ${da.start} -> ${da.target}`);
    // Bob takes a stroke; Amy plays the route
    const route = LIVE ? da.route.slice(1) : checks[da.start];
    if (!route) errors.push(`no check route for ${da.start}`);
    const type = async (p, g) => { const inp = p.page.locator('#hits input[data-id="guess"]'); await inp.fill(g); await inp.press('Enter'); await p.page.waitForTimeout(200); for (let i = 0; i < 120 && await p.page.evaluate(() => window.__noclick.busy()); i++) await p.page.waitForTimeout(250); };
    await type(bob, 'Xyzzy plugh gadget');
    for (const g of route || []) await type(amy, g);
    const after = await amy.duel();
    if (!LIVE && (!after.done || after.path[after.path.length - 1] !== da.target)) errors.push(`Amy didn't finish: ${JSON.stringify(after)}`);
    console.log(`Amy: ${after.path.join(' > ')} in ${after.strokes}${after.done ? ', done' : ''}`);
    await amy.page.waitForTimeout(2000); await shot(amy, '3-waiting-for-bob');
    // Bob sees Amy finished, then leaves (twice: it asks)
    if (after.done) await until(bob, async () => ((await bob.duel()).them || {}).done, "Bob never saw Amy finish", 10000);
    await bob.btn('Leave the race').click({ force: true }); await bob.page.waitForTimeout(300);
    await bob.btn('Leave the race').click({ force: true });
    await until(bob, async () => (await bob.view()) === 'shelf', 'leaving never went back to the disks', 10000);
    await until(amy, async () => (await amy.duel()).over, "Amy's race never ended", 15000);
    const end = await amy.duel();
    if (end.result !== 'win') errors.push(`Amy: ${end.result}, expected win`);
    await amy.page.waitForTimeout(800); await shot(amy, '4-won');
    // the boards: Amy at the top of the 1v1 rating
    await amy.btn('Leaderboards').click({ force: true });
    await until(amy, async () => (await amy.page.evaluate(() => window.__noclick.ranks())).rating === 'ok', 'the rating board never came', 15000);
    const ranks = await amy.page.evaluate(() => window.__noclick.ranks());
    const me = ranks.entries.find(e => e.mine);
    if (!me || me.name !== amy.name || !(me.rating > 1200)) errors.push(`rating board: ${JSON.stringify(ranks)}`);
    await amy.page.waitForTimeout(600); await shot(amy, '5-ranks');
    if (await amy.view() !== 'scores') errors.push('Leaderboards should open the scores screen');
    await amy.btn('1v1 this week leaderboard').click({ force: true });
    await until(amy, async () => (await amy.page.evaluate(() => window.__noclick.ranks())).week === 'ok', 'the week board never came', 15000);
    // a queue can be left: Bob looks again and cancels
    await bob.btn('1v1: race someone else').click({ force: true });
    await until(bob, async () => (await bob.page.evaluate(() => window.__noclick.queue() && window.__noclick.queue().state)) === 'waiting', 'Bob, with his name kept, never waited');
    await bob.btn('Stop looking').click({ force: true });
    await until(bob, async () => (await bob.view()) === 'shelf', 'cancel never went back');
    // daily progress is untouched by a race: still medium/any mode as before, no strokes on today's disks
    const daily = await amy.page.evaluate(() => window.__noclick.tapes());
    if (daily.some(t => t.strokes)) errors.push('a race touched the daily disks');
    for (const p of [amy, bob]) await p.ctx.close();
  } catch (e) { errors.push('crashed: ' + (e.stack || e)); }
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'no errors');
  process.exit(errors.length ? 1 : 0);
})();
