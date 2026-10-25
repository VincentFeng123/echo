// Writes dist/index.html (No Clicking) and dist/desk/index.html (Archive), self-contained pages any static host can serve.
import fs from 'node:fs';
import { buildPage, buildDesk } from './page.mjs';
fs.mkdirSync(new URL('./dist/desk/', import.meta.url), { recursive: true });
const out = new URL('./dist/index.html', import.meta.url);
fs.writeFileSync(out, buildPage());
console.log('wrote dist/index.html', fs.statSync(out).size, 'bytes');
const desk = new URL('./dist/desk/index.html', import.meta.url);
fs.writeFileSync(desk, buildDesk());
console.log('wrote dist/desk/index.html', fs.statSync(desk).size, 'bytes');
