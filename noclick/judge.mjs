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
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['related', 'why'],
  properties: { related: { type: 'boolean' }, why: { type: 'string' } },
};

const cache = new Map();
const recent = new Map(); // ip -> [timestamps], a light cap so a public deploy can't be used as a free model
export async function judgeStep({ a, b, aDesc = '', bDesc = '' }, ip = '') {
  const clip = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  a = clip(a); b = clip(b); aDesc = clip(aDesc); bDesc = clip(bDesc);
  if (!a || !b) return { error: 'missing pages', status: 400 };
  const key = (a + '|' + b).toLowerCase();
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
      model, instructions: SYSTEM, input: user, max_output_tokens: 300, reasoning: { effort },
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

// Node http glue shared by serve.mjs and api/judge.js
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
