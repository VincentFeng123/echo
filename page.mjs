// Builds the playable pages: game.html (No Clicking) with today's tapes inlined, and desk.html (Archive)
// with its case file inlined. Used by serve.mjs (on every load) and build.mjs (once, for static hosting).
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
  // pages too general to be a step (noclick/broad.json, from build_tapes.py --broad)
  const broadFile = new URL('noclick/broad.json', dir);
  const broad = fs.existsSync(broadFile) ? JSON.stringify(JSON.parse(fs.readFileSync(broadFile, 'utf8')).titles) : '[]';
  const json = (`{"day":${JSON.stringify(today.day)},"date":${JSON.stringify(today.date)},"broad":${broad},"tapes":[` + tapes.join(',') + ']}').replace(/<\//g, '<\\/');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    tpl.replace('__PUZZLES__', () => json).replace('__SHARE_URL__', () => shareUrl)
      .replace('__API__', () => '/api').replace('__ARCHIVE_HREF__', () => '/desk') // serve.mjs's routes; whiterabbt.com's /games route has its own
      .replace('__HOME__', () => 'https://www.whiterabbt.com')
      .replace('__ARCHIVE__', () => (fs.existsSync(new URL('desk.html', dir)) ? 'on' : 'off')) + '\n</html>'; // ARCHIVE tab only where the desk game is
}
/* The case goes into the page sealed, so View Source shows no answers. Every report blank's "accept" list becomes
   "acceptH": salted hashes of the accepted note ids (or choices), and the page hashes whatever is put in a blank and
   compares. The walkthrough ("solution") and the notes on wrong answers ("lures") are left out: only the tests read
   them, from the plain file on disk. What is left is XORed with a keystream from the salt and sent as base64, so the
   story's later twists aren't in plain sight either. It hides the answers from a curious reader, not from someone
   who runs the code. desk.html carries the same h53 and keystream (and still reads a plain, unsealed case). */
export function h53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function keystream(salt, n) {
  let s = 0; for (let i = 0; i < salt.length; i++) s = (Math.imul(s, 31) + salt.charCodeAt(i)) | 0;
  if (!s) s = 0x9e3779b9;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; out[i] = s & 255; }
  return out;
}
// one blank's answer, as the page will hash it: a note id as it is, a choice in lower case
export function answerHash(salt, pid, bid, value, choice) { return h53(salt + '|' + pid + '.' + bid + '|' + (choice ? String(value).toLowerCase() : String(value))); }
export function sealCase(raw) {
  const c = JSON.parse(raw);
  // per case: the salt changes whenever the case file does
  const salt = h53('desk|' + (c.id || '') + '|' + raw);
  delete c.solution; delete c.lures;
  ((c.report && c.report.parts) || []).forEach(p => {
    delete p.wrong_but_expected;
    Object.entries(p.blanks || {}).forEach(([bid, bl]) => {
      if (!Array.isArray(bl.accept)) return;
      bl.acceptH = bl.accept.map(a => answerHash(salt, p.id, bid, a, !!bl.choices));
      delete bl.accept;
    });
  });
  const bytes = Buffer.from(JSON.stringify(c), 'utf8'), ks = keystream(salt, bytes.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks[i];
  return JSON.stringify({ sealed: 1, salt, data: bytes.toString('base64') });
}
// caseName picks desk-case.<caseName>.json (letters, digits and dashes only), e.g. /desk?case=stub; without it the
// real case is served: the plain desk-case.json where it exists (here, never committed), else desk-case.sealed.json (the
// only form of the case that may be committed, written by seal-case.mjs, as on Vercel), else the stub
export function buildDesk({ caseName = '' } = {}) {
  const tpl = fs.readFileSync(new URL('desk.html', dir), 'utf8');
  const pick = /^[a-z0-9-]{1,40}$/.test(caseName) && fs.existsSync(new URL(`desk-case.${caseName}.json`, dir)) ? `desk-case.${caseName}.json` : '';
  const name = pick || ['desk-case.json', 'desk-case.sealed.json', 'desk-case.stub.json'].find(n => fs.existsSync(new URL(n, dir)));
  const raw = fs.readFileSync(new URL(name, dir), 'utf8').trim();
  const parsed = JSON.parse(raw); // fail loudly on a half-written case file
  // a case already sealed goes in as it is
  const json = (parsed && parsed.sealed === 1 && parsed.salt && parsed.data ? raw : sealCase(raw)).replace(/<\//g, '<\\/');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    tpl.replace('__CASE__', () => json) + '\n</html>';
}
