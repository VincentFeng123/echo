// Copies the games into the White Rabbit app, which serves them at whiterabbt.com/games (No Clicking) and
// /games/archive (Archive): game.html, noclick/broad.json, desk.html and the sealed case. The app fills the pages
// itself (src/lib/games/page.ts): the day's disks from its database, its own referee and leaderboard routes, and
// a nonce on every script for its Content-Security-Policy. Run it after changing a game here, then commit the
// copies in the app. Only the sealed case goes: run seal-case.mjs first.
//   node export-to-app.mjs [path to the app checkout, default ../../..]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(process.argv[2] || path.join(here, '../../..'));
if (!fs.existsSync(path.join(app, 'src/lib/games'))) throw new Error(`no src/lib/games in ${app}: is that the White Rabbit app?`);
const sealed = JSON.parse(fs.readFileSync(path.join(here, 'desk-case.sealed.json'), 'utf8'));
if (sealed.sealed !== 1) throw new Error('desk-case.sealed.json is not sealed: run node seal-case.mjs');
const copies = [
  ['game.html', 'src/lib/games/no-clicking/game.html'],
  ['noclick/broad.json', 'src/lib/games/no-clicking/broad.json'],
  ['desk.html', 'src/lib/games/archive/desk.html'],
  ['desk-case.sealed.json', 'src/lib/games/archive/case.json'],
];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(app, to)), { recursive: true });
  fs.copyFileSync(path.join(here, from), path.join(app, to));
  console.log(`${from} -> ${to} (${fs.statSync(path.join(app, to)).size.toLocaleString()} bytes)`);
}
