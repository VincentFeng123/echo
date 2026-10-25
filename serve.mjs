// Local server for No Clicking. Rebuilds the page from game.html + today's tapes on every load,
// so edits show up on refresh. Binds to all interfaces so a phone on the same Wi-Fi can open it too.
// /desk serves Archive, the night-desk detective game: desk.html with desk-case.json (or the stub) inlined;
// /desk?case=<name> serves desk-case.<name>.json instead (e.g. ?case=stub).
import http from 'node:http';
import os from 'node:os';
import { buildPage, buildDesk } from './page.mjs';
import { handleJudge } from './noclick/judge.mjs';
import { handleBoard } from './noclick/board.mjs';
const PORT = Number(process.env.PORT || 4747);
http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/#') || req.url === '/index.html') {
    try { const body = buildPage(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e.stack || e)); }
    return;
  }
  if (req.url === '/desk' || req.url.startsWith('/desk?') || req.url.startsWith('/desk#') || req.url === '/desk/') {
    try { const q = new URL(req.url, 'http://x').searchParams; const body = buildDesk({ caseName: q.get('case') || '' }); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(String(e.stack || e)); }
    return;
  }
  // No Clicking's AI backup referee (the same function api/judge.js runs on Vercel)
  if (req.url === '/api/judge') { handleJudge(req, res).catch(e => { res.writeHead(500); res.end(String(e)); }); return; }
  // and its daily leaderboard
  if (req.url === '/api/board' || req.url.startsWith('/api/board?')) { handleBoard(req, res).catch(e => { res.writeHead(500); res.end(String(e)); }); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log(`No Clicking on http://localhost:${PORT}` + (lan.length ? `  (phone on same Wi-Fi: http://${lan[0]}:${PORT})` : ''));
});
