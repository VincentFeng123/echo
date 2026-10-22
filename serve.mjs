// Local server for Echo. Rebuilds the page from game.html + rounds-today.json on every load,
// so edits show up on refresh. Binds to all interfaces so a phone on the same Wi-Fi can open it too.
import http from 'node:http';
import os from 'node:os';
import { buildPage } from './page.mjs';
const PORT = Number(process.env.PORT || 4747);
http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/#') || req.url === '/index.html') {
    try { const body = buildPage(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e.stack || e)); }
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log(`Echo on http://localhost:${PORT}` + (lan.length ? `  (phone on same Wi-Fi: http://${lan[0]}:${PORT})` : ''));
});
