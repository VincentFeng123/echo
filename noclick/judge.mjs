// The AI backup referee: when Wikipedia doesn't tie two pages together (no link either way, neither names the
// other), or Wikipedia can't be reached, a light model says whether a person would see a clear connection.
// Used by serve.mjs (POST /api/judge, local) and api/judge.js (Vercel). Same provider and cheapest model as the
// White Rabbit app: OpenAI's Responses API, WHITE_RABBIT_OPENAI_MODEL or gpt-6-luna, no thinking, a tiny answer.
// The key comes from OPENAI_API_KEY; locally, when the server wasn't started with it, from the app's .env.local.
import fs from 'node:fs';

const APP_ENV = new URL('../../../../.env.local', import.meta.url);
function setting(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = fs.readFileSync(APP_ENV, 'utf8').split('\n').find(l => l.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

const SYSTEM = `You referee a word-association game played with Wikipedia pages. The player is on page A and names page B as the next step. Say whether B is directly related to A: would a typical person see a clear, specific connection between the two (one is part of, a kind of, made of, made by, used for, found in, famous for, named after the other; a person, place, event or thing closely tied to it)? Common-sense associations count, like nuts and squirrels, or pigeons and New York. Links that could join almost anything don't (both are foods, both are from the same country, both are old). Answer in JSON: related, and why in at most 12 plain words.`;
// Medium mode adds this: specific connections only
const STRICT = ` Be strict about specificity: say no when either page is a broad field or umbrella category (music, film, food, science, technology, animals, a country), or when the only link is that one belongs to the other's broad category (a theme tune and "music").`;
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['related', 'why'],
  properties: { related: { type: 'boolean' }, why: { type: 'string' } },
};

const cache = new Map();
const recent = new Map(); // ip -> [timestamps], a light cap so a public deploy can't be used as a free model
export async function judgeStep({ a, b, aDesc = '', bDesc = '', mode = 'medium' }, ip = '') {
  const clip = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  a = clip(a); b = clip(b); aDesc = clip(aDesc); bDesc = clip(bDesc);
  if (!a || !b) return { error: 'missing pages', status: 400 };
  const strict = mode !== 'easy';
  const key = (strict ? 's|' : 'e|') + (a + '|' + b).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const now = Date.now(), times = (recent.get(ip) || []).filter(t => now - t < 60000);
  if (times.length >= 40) return { error: 'slow down', status: 429 };
  times.push(now); recent.set(ip, times);
  const apiKey = setting('OPENAI_API_KEY');
  if (!apiKey) return { off: true }; // no key on this deploy: the game carries on with Wikipedia alone
  const model = setting('WHITE_RABBIT_OPENAI_MODEL') || 'gpt-6-luna';
  const user = `A: ${a}${aDesc ? ' (' + aDesc + ')' : ''}\nB: ${b}${bDesc ? ' (' + bDesc + ')' : ''}`;
  const ask = effort => fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model, instructions: SYSTEM + (strict ? STRICT : ''), input: user, max_output_tokens: 300, reasoning: { effort },
      text: { format: { type: 'json_schema', name: 'step', strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(12000),
  });
  let r = await ask('none');
  if (r.status === 400) r = await ask('low'); // a model that won't skip thinking
  if (!r.ok) return { error: 'model ' + r.status, status: 502 };
  const j = await r.json();
  const text = (j.output || []).flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text;
  let out;
  try { out = JSON.parse(text); } catch { return { error: 'no answer', status: 502 }; }
  const answer = { related: !!out.related, why: clip(out.why).slice(0, 120), model };
  cache.set(key, answer);
  return answer;
}

// The reader: which English Wikipedia article a player most likely means by words that aren't a page's name, from the
// page they're on (never the target). The app's src/lib/games/no-clicking/judge.ts readGuess, for the local server.
const READ_SYSTEM = `You help a word-association game played with English Wikipedia pages. The player is on page A and typed some words meaning the next page. Say which English Wikipedia article they most likely mean, by its exact title as it is on English Wikipedia. Typing mistakes, nicknames, plurals and other languages' names mean the article they point to. A description means the article it describes; when it could mean several, prefer the one most closely tied to page A, but never page A itself: the player is looking for the next page. If the words don't point to any article other than A, answer an empty title. Never explain. Answer in JSON: title.`;
const readCache = new Map();
export async function readGuess({ at, atDesc = '', text }, ip = '') {
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  at = clip(at, 160); atDesc = clip(atDesc, 160); text = clip(text, 120);
  if (!at || !text) return { error: 'missing words', status: 400 };
  const key = JSON.stringify([at, atDesc, text.toLowerCase()]);
  if (readCache.has(key)) return { title: readCache.get(key) };
  const now = Date.now(), times = (recent.get(ip) || []).filter(t => now - t < 60000);
  if (times.length >= 40) return { error: 'slow down', status: 429 };
  times.push(now); recent.set(ip, times);
  const apiKey = setting('OPENAI_API_KEY');
  if (!apiKey) return { off: true };
  const model = setting('WHITE_RABBIT_OPENAI_MODEL') || 'gpt-6-luna';
  const ask = effort => fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model, instructions: READ_SYSTEM, input: `A: ${at}${atDesc ? ' (' + atDesc + ')' : ''}\nTyped: ${text}`, max_output_tokens: 200, reasoning: { effort },
      text: { format: { type: 'json_schema', name: 'reading', strict: true, schema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } } } },
    }),
    signal: AbortSignal.timeout(10000),
  });
  let r = await ask('none');
  if (r.status === 400) r = await ask('low');
  if (!r.ok) return { error: 'model ' + r.status, status: 502 };
  const j = await r.json();
  let out;
  try { out = JSON.parse((j.output || []).flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text); } catch { return { error: 'no answer', status: 502 }; }
  const title = clip(out.title, 255).replace(/^["'“”]+|["'“”.]+$/g, '');
  readCache.set(key, title);
  return { title };
}

// Node http glue shared by serve.mjs and api/judge.js
async function handlePost(req, res, work) {
  if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }); res.end('{"error":"POST"}'); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4000) break; }
  let q = {};
  try { q = JSON.parse(body || '{}'); } catch {}
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  let out;
  try { out = await work(q, ip); } catch (e) { out = { error: String(e.message || e), status: 502 }; }
  res.writeHead(out.status || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(out));
}
export function handleRead(req, res) { return handlePost(req, res, readGuess); }
export async function handleJudge(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }); res.end('{"error":"POST"}'); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4000) break; }
  let q = {};
  try { q = JSON.parse(body || '{}'); } catch {}
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  let out;
  try { out = await judgeStep(q, ip); } catch (e) { out = { error: String(e.message || e), status: 502 }; }
  res.writeHead(out.status || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(out));
}
