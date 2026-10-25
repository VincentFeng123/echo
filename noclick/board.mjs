// No Clicking's daily leaderboard. GET /api/board?date=YYYY-MM-DD lists the day; POST /api/board posts (or updates)
// one device's finished day: { date, device, name, tapes: [{ slug, par, strokes, solved }] }. The score is worked out
// here from the tapes (an ejected tape counts as par + 6), and the board is sorted by score, then strokes, then time.
// Storage: Supabase when NOCLICK_SUPABASE_URL and NOCLICK_SUPABASE_SERVICE_KEY are set (the table is in
// noclick/leaderboard.sql; the key stays on the server). Otherwise a JSON file per day in NOCLICK_BOARD_DIR (default:
// the research work folder, outside this repo), which suits the local server; a serverless deploy without Supabase
// answers { setup: true }, since it has no disk that lasts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.NOCLICK_BOARD_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../no-clicking-2026-10-22/work/noclick-board');
const EJECT = 5;
const recent = new Map();

const SB_URL = (process.env.NOCLICK_SUPABASE_URL || '').replace(/\/$/, ''), SB_KEY = process.env.NOCLICK_SUPABASE_SERVICE_KEY || '';
const TABLE = 'noclick_scores';

// rows everywhere: { id, name, par, strokes, score, tapes: [strokes per tape], at: ms }
const fileStore = {
  file: date => path.join(DIR, date + '.json'),
  async list(date) { try { return JSON.parse(fs.readFileSync(this.file(date), 'utf8')); } catch { return []; } },
  async put(date, row) {
    const rows = (await this.list(date)).filter(r => r.id !== row.id).concat([row]);
    fs.writeFileSync(this.file(date) + '.tmp', JSON.stringify(rows));
    fs.renameSync(this.file(date) + '.tmp', this.file(date));
    return rows;
  },
};
const supabaseStore = {
  headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, 'content-type': 'application/json' },
  async list(date) {
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?day=eq.${date}&select=device_hash,name,par,strokes,score,tapes,updated_at&order=score.asc,strokes.asc,updated_at.asc&limit=500`,
      { headers: this.headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('supabase ' + r.status);
    return (await r.json()).map(x => ({ id: x.device_hash, name: x.name, par: x.par, strokes: x.strokes, score: x.score, tapes: x.tapes, at: Date.parse(x.updated_at) }));
  },
  async put(date, row) {
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=day,device_hash`, {
      method: 'POST', headers: { ...this.headers, prefer: 'resolution=merge-duplicates,return=minimal' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ day: date, device_hash: row.id, name: row.name, par: row.par, strokes: row.strokes, score: row.score, tapes: row.tapes, updated_at: new Date(row.at).toISOString() }),
    });
    if (!r.ok) throw new Error('supabase ' + r.status);
    return this.list(date);
  },
};
function store() {
  if (SB_URL && SB_KEY) return supabaseStore;
  if (process.env.VERCEL && !process.env.NOCLICK_BOARD_DIR) return null;
  try { fs.mkdirSync(DIR, { recursive: true }); return fileStore; } catch { return null; }
}
function ranked(rows) {
  return rows.slice().sort((a, b) => a.score - b.score || a.strokes - b.strokes || a.at - b.at)
    .map((r, i) => ({ rank: i + 1, name: r.name, strokes: r.strokes, par: r.par, score: r.score, tapes: r.tapes, mine: false, id: r.id }));
}
function answer(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function handleBoard(req, res) {
  const url = new URL(req.url, 'http://x');
  const db = store();
  if (!db) return answer(res, 200, { setup: true, entries: [] }); // no store on this deploy yet: the game says so quietly
  if (req.method === 'GET') {
    const date = url.searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return answer(res, 400, { error: 'date' });
    const device = url.searchParams.get('device') || '';
    let rows;
    try { rows = await db.list(date); } catch (e) { return answer(res, 502, { error: String(e.message || e) }); }
    return answer(res, 200, { date, entries: ranked(rows).map(r => ({ ...r, mine: !!device && r.id === hash(device), id: undefined })) });
  }
  if (req.method !== 'POST') return answer(res, 405, { error: 'GET or POST' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), times = (recent.get(ip) || []).filter(t => now - t < 60000);
  if (times.length >= 20) return answer(res, 429, { error: 'slow down' });
  times.push(now); recent.set(ip, times);
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 8000) break; }
  let q;
  try { q = JSON.parse(body); } catch { return answer(res, 400, { error: 'json' }); }
  const date = String(q.date || ''), device = String(q.device || '').slice(0, 64);
  const name = String(q.name || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const tapes = Array.isArray(q.tapes) ? q.tapes.slice(0, 5) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || device.length < 8 || name.length < 2 || !tapes.length) return answer(res, 400, { error: 'A name of 2 to 16 letters, and a finished day.' });
  const clean = [];
  for (const t of tapes) {
    const par = Math.round(Number(t.par)), strokes = Math.round(Number(t.strokes)), solved = !!t.solved;
    if (!(par >= 1 && par <= 12) || !(strokes >= 1 && strokes <= par + EJECT + 1)) return answer(res, 400, { error: 'tape' });
    clean.push({ slug: String(t.slug || '').slice(0, 40), par, strokes: solved ? strokes : par + EJECT + 1, solved });
  }
  const par = clean.reduce((a, t) => a + t.par, 0), strokes = clean.reduce((a, t) => a + t.strokes, 0);
  let rows;
  try { rows = await db.put(date, { id: hash(device), name, par, strokes, score: strokes - par, tapes: clean.map(t => t.strokes), at: now }); }
  catch (e) { return answer(res, 502, { error: String(e.message || e) }); }
  const list = ranked(rows).map(r => ({ ...r, mine: r.id === hash(device), id: undefined }));
  return answer(res, 200, { date, entries: list, you: list.find(r => r.mine) });
}

// a device id never leaves the server as itself
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h.toString(36); }
