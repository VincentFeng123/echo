// Writes dist/index.html (No Clicking), a single self-contained page any static host can serve.
import fs from 'node:fs';
import { buildPage } from './page.mjs';
fs.mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
const out = new URL('./dist/index.html', import.meta.url);
fs.writeFileSync(out, buildPage());
console.log('wrote dist/index.html', fs.statSync(out).size, 'bytes');
