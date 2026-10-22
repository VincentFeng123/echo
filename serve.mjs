// Local server for Echo. Rebuilds the page from game.html + rounds-today.json on every load,
// so edits show up on refresh. Binds to all interfaces so a phone on the same Wi-Fi can open it too.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
const dir = new URL('./', import.meta.url);
const PORT = Number(process.env.PORT || 4747);
function page() {
  const tpl = fs.readFileSync(new URL('game.html', dir), 'utf8');
  const json = fs.readFileSync(new URL('rounds-today.json', dir), 'utf8').trim().replace(/<\//g, '<\\/');
  const photo = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('img/vega.jpg', dir)).toString('base64');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    tpl.replace('__ROUND__', () => json).replace('__SHARE_URL__', () => 'auto').replace('__PHOTO__', () => photo) + '\n</html>';
}
http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/#') || req.url === '/index.html') {
    try { const body = page(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e.stack || e)); }
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log(`Echo prototype on http://localhost:${PORT}` + (lan.length ? `  (phone on same Wi-Fi: http://${lan[0]}:${PORT})` : ''));
});
