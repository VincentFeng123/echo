// Builds the playable page: game.html (No Clicking) with today's tapes inlined.
// Used by serve.mjs (on every load) and build.mjs (once, for static hosting).
import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
export function buildPage({ shareUrl = 'auto' } = {}) {
  const tpl = fs.readFileSync(new URL('game.html', dir), 'utf8');
  // today's tapes, easy to hard: noclick/today.json names them, noclick/puzzles/<slug>.json holds each one
  const today = JSON.parse(fs.readFileSync(new URL('noclick/today.json', dir), 'utf8'));
  const tapes = today.tapes.map(slug => {
    const raw = fs.readFileSync(new URL(`noclick/puzzles/${slug}.json`, dir), 'utf8').trim();
    JSON.parse(raw); // fail loudly on a half-written tape
    return raw;
  });
  const json = (`{"day":${JSON.stringify(today.day)},"date":${JSON.stringify(today.date)},"tapes":[` + tapes.join(',') + ']}').replace(/<\//g, '<\\/');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    tpl.replace('__PUZZLES__', () => json).replace('__SHARE_URL__', () => shareUrl)
      .replace('__ARCHIVE__', () => (fs.existsSync(new URL('desk.html', dir)) ? 'on' : 'off')) + '\n</html>'; // ARCHIVE tab only where the desk game is
}
