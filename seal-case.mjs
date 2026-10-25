// Writes desk-case.sealed.json: the desk's case exactly as the page serves it (accept lists hashed, no walkthrough, no
// notes on wrong answers, the rest XORed), so a deploy can commit it instead of the plain desk-case.json. page.mjs
// serves it whenever desk-case.json is missing.
//   node seal-case.mjs [desk-case.<name>.json]     (default: desk-case.json)
import fs from 'node:fs';
import { sealCase } from './page.mjs';
const src = process.argv[2] || 'desk-case.json';
const raw = fs.readFileSync(new URL(src, import.meta.url), 'utf8').trim();
const parsed = JSON.parse(raw);
if (parsed.sealed) { console.error(src + ' is sealed already'); process.exit(1); }
const out = new URL('desk-case.sealed.json', import.meta.url);
fs.writeFileSync(out, sealCase(raw) + '\n');
const back = fs.readFileSync(out, 'utf8');
// nothing a reader could take the answers from may show in plain text
for (const bit of ['"accept"', '"solution"', '"lures"', String(parsed.title || '')].filter(Boolean)) if (back.includes(bit)) { console.error('the sealed file still shows ' + bit); fs.unlinkSync(out); process.exit(1); }
console.log('wrote desk-case.sealed.json from ' + src, back.length, 'bytes');
