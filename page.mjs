// Builds the playable page: game.html with today's rounds and the cover photo inlined.
// Used by serve.mjs (on every load) and build.mjs (once, for static hosting).
import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
export function buildPage({ shareUrl = 'auto' } = {}) {
  const tpl = fs.readFileSync(new URL('game.html', dir), 'utf8');
  const json = fs.readFileSync(new URL('rounds-today.json', dir), 'utf8').trim().replace(/<\//g, '<\\/');
  const photo = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('img/vega.jpg', dir)).toString('base64');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    tpl.replace('__ROUND__', () => json).replace('__SHARE_URL__', () => shareUrl).replace('__PHOTO__', () => photo) + '\n</html>';
}
