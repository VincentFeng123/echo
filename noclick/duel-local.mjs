// 1v1 for the local server: the White Rabbit app's races (its 0072 migration settles them in Postgres) kept in this
// process's memory instead, with the same answers, so the game's 1v1 can be tried and tested here. Disks come from
// noclick/puzzles/. Not for a deploy: one process, forgotten on restart.
import fs from 'node:fs';

const dir = new URL('./puzzles/', import.meta.url);
const disks = () => fs.readdirSync(dir).filter(f => /^[a-z0-9-]+\.json$/.test(f) && !f.endsWith('.check.json')).map(f => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')));
const players = new Map(), queue = new Map(), duels = new Map();
const now = () => Date.now();
const iso = t => new Date(t).toISOString();

function settle(d) {
  if (d.finished) return;
  const t = now();
  for (const p of d.sides) {
    if (t > d.starts && !p.done && t - p.seen > 30000) { p.left = true; p.done = t; }
    if (t >= d.ends && !p.done) p.done = d.ends;
  }
  const [a, b] = d.sides;
  let over = false, win = null;
  if (a.done && b.done) {
    over = true;
    if (a.solved && b.solved) win = a.strokes < b.strokes ? a : b.strokes < a.strokes ? b : a.done < b.done ? a : b.done < a.done ? b : null;
    else win = a.solved ? a : b.solved ? b : null;
  } else for (const [x, y] of [[a, b], [b, a]]) {
    if (!x.done || y.done) continue;
    if (x.left) { over = true; win = y; } else if (x.solved && y.strokes + 1 >= x.strokes) { over = true; win = x; }
  }
  if (!over) return;
  const ea = 1 / (1 + 10 ** ((b.ratingBefore - a.ratingBefore) / 400)), sa = win === a ? 1 : win === b ? 0 : 0.5, da = Math.round(32 * (sa - ea));
  d.finished = t; d.winner = win ? win.device : null;
  a.ratingAfter = a.ratingBefore + da; b.ratingAfter = b.ratingBefore - da;
  for (const p of d.sides) {
    const pl = players.get(p.device);
    pl.rating += p === a ? da : -da;
    if (!win) pl.draws++; else if (win === p) pl.wins++; else pl.losses++;
  }
}
function view(d, device) {
  const me = d.sides.find(p => p.device === device), them = d.sides.find(p => p.device !== device);
  if (!me) return null;
  me.seen = now(); settle(d);
  const side = (p, path) => ({ name: p.name, rating: p.ratingBefore, rating_after: p.ratingAfter ?? null, strokes: p.strokes, moves: p.path.length - 1, solved: p.solved, done: !!p.done, left: p.left, path });
  return { id: d.id, now: iso(now()), starts_at: iso(d.starts), ends_at: iso(d.ends), finished: !!d.finished,
    result: !d.finished ? null : d.winner === null ? 'draw' : d.winner === device ? 'win' : 'loss',
    disk: now() >= d.starts ? d.disk : null, me: side(me, me.path), them: side(them, d.finished ? them.path : null) };
}
function join({ device, name, played = [] }) {
  if (!device || String(device).length < 8 || String(name || '').trim().length < 2) return [400, { error: 'A name of 2 to 16 letters, please.' }];
  name = String(name).trim().slice(0, 16);
  const pl = players.get(device) || { name, rating: 1200, wins: 0, losses: 0, draws: 0 }; pl.name = name; players.set(device, pl);
  const live = [...duels.values()].find(d => !d.finished && d.sides.some(p => p.device === device && !p.done));
  if (live) { queue.delete(device); return [200, { state: 'matched', duel: live.id }]; }
  queue.set(device, { device, played, joined: queue.get(device)?.joined ?? now(), seen: now() });
  for (const [k, q] of queue) if (now() - q.seen > 12000) queue.delete(k);
  const opp = [...queue.values()].filter(q => q.device !== device).sort((x, y) => x.joined - y.joined)[0];
  if (!opp) return [200, { state: 'waiting', racing: [...duels.values()].filter(d => !d.finished).length * 2 }];
  const pool = disks(), disk = pool[Math.floor(Math.random() * pool.length)];
  const id = crypto.randomUUID(), starts = now() + 5000;
  const side = dev => ({ device: dev, name: players.get(dev).name, ratingBefore: players.get(dev).rating, path: [disk.start], strokes: 0, solved: false, left: false, done: 0, seen: now() });
  duels.set(id, { id, disk, starts, ends: starts + 6 * 60000, finished: 0, winner: null, sides: [side(device), side(opp.device)] });
  queue.delete(device); queue.delete(opp.device);
  return [200, { state: 'matched', duel: id }];
}
function move({ duel, device, path, strokes, solved, left }) {
  const d = duels.get(duel), me = d && d.sides.find(p => p.device === device);
  if (!me) return [400, { error: 'Not your race.' }];
  if (!d.finished && !me.done) {
    if (now() < d.starts && !left) return [400, { error: "The race hasn't started." }];
    if (left) { me.left = true; me.done = now(); }
    else {
      const moves = (path || []).length - 1;
      if (moves < 0 || path[0] !== d.disk.start) return [400, { error: "That isn't a route on this disk." }];
      if (strokes < me.strokes || strokes < moves || strokes > 60) return [400, { error: "Those strokes can't be." }];
      if (solved && (path[path.length - 1] !== d.disk.target || moves < 2)) return [400, { error: "That isn't a finish." }];
      Object.assign(me, { path, strokes, solved: !!solved, seen: now() });
      if (solved || strokes >= d.disk.par + 5) me.done = now();
    }
  }
  return [200, view(d, device)];
}
function ranks(board, device) {
  const rows = board === 'week'
    ? [...players].map(([dev, p]) => ({ dev, name: p.name, wins: p.wins, played: p.wins + p.losses + p.draws })).filter(r => r.wins > 0).sort((x, y) => y.wins - x.wins || x.played - y.played)
    : [...players].map(([dev, p]) => ({ dev, ...p })).filter(r => r.wins + r.losses + r.draws > 0).sort((x, y) => y.rating - x.rating);
  return { board, entries: rows.slice(0, 50).map((r, i) => ({ rank: i + 1, name: r.name, rating: r.rating ?? null, wins: r.wins, losses: r.losses ?? null, draws: r.draws ?? null, played: r.played ?? r.wins + r.losses + r.draws, mine: r.dev === device })) };
}

function answer(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
export async function handleDuel(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET') {
    const d = duels.get(url.searchParams.get('duel') || ''), v = d && view(d, url.searchParams.get('device') || '');
    return v ? answer(res, 200, v) : answer(res, 404, { error: 'Not your race.' });
  }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20000) break; }
  let q = {};
  try { q = JSON.parse(body || '{}'); } catch {}
  if (q.action === 'join') return answer(res, ...join(q));
  if (q.action === 'leave') { queue.delete(q.device); return answer(res, 200, {}); }
  if (q.action === 'move') return answer(res, ...move(q));
  return answer(res, 400, { error: 'Join, leave or move.' });
}
export function handleRanks(req, res) {
  const url = new URL(req.url, 'http://x');
  answer(res, 200, ranks(url.searchParams.get('board') === 'week' ? 'week' : 'rating', url.searchParams.get('device') || ''));
}
