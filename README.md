# No Clicking

A daily Wikipedia game from [White Rabbit](https://whiterabbt.com). Each day there are three tapes, easy to hard. Each tape is a start page and a target page from a real rabbit hole, like *Pretzel → Caramelization*. Nothing on screen is clickable: you make your own trail by typing anything connected to where you are, one step at a time (*nutmeg → nuts → squirrel → animal → pigeons → New York → Manhattan*).

- **MOVE** (1 stroke): a step counts when either Wikipedia page links the other, or one names the other in its text. When Wikipedia doesn't tie them, or can't be reached, a light AI referee (OpenAI's cheapest model, the one White Rabbit's app uses) decides whether most people would see a clear connection (Werther's Original → Caramelization: yes; Germany → Basketball: no). Any capitalisation, redirects, plurals and loose names work ("werthers candy" finds Werther's Original through Wikipedia's search); an ambiguous name ("nuts", "new york") takes the sense that connects.
- **STATIC** (1 stroke): the pages don't link or name each other and the referee sees no connection. **TOO BROAD** (free): years, dates and lists. **NOT FOUND** and **WHICH ONE?** (free): no page goes by that name, or none of its senses connects.
- **TRACKING** (1 stroke) names a page the current one links that's one step from the target. **REWIND** is free.
- Two lamps: **END** lights on a page that connects to the target, **RABBIT** on a page of the real rabbit hole.
- **How to play** opens as a box the first time you play (close it with the X; **? HOW TO PLAY** brings it back). Words of the game (par, stroke, static, referee, TRACKING, the lamps…) and every Wikipedia page on screen have a dotted underline: hover or tap for a definition. A page's definition is its Wikipedia short description and first sentence, written into the tape for the tape's own pages and looked up live for pages you type.
- **The day's score** adds up the three tapes like a round of golf. **TODAY'S SCORE** (from the shelf's running total, or any end screen) shows it as a table, par, strokes and score per tape and the day's total, next to **today's leaderboard**: finish all three tapes, type a name, and post (posting again updates your row). Share copies the day's total and one line per tape.
- Par is the number of steps the real rabbit hole took, so the game is "beat the rabbit". Run out at par + 5 and the tape ejects. At the end the TV plays the rabbit's route next to yours (each of your steps says how it connected), then you can share a spoiler-free result, find more rabbit holes, or open this one on whiterabbt.com.

The whole thing plays on an old CRT: a three.js wheel of VHS tapes, everything drawn through a curved-glass shader (flat on phones), and one pixel type family (Handjet) throughout. Archive, the research-desk game, is the other tab at `/desk` wherever its files are present (the tab hides itself otherwise).

## Run it

Needs Node 18 or newer, and nothing to install.

```bash
npm start
```

Then open http://localhost:4747. A phone on the same Wi-Fi can open the address the server prints. Add `?reset` to the address to clear this device's progress and play the day again.

## Making tapes

The game checks each step live against Wikipedia's API from the browser (a few small requests per guess, cached, with an `Api-User-Agent`). The AI referee runs server side in `noclick/judge.mjs`: `serve.mjs` serves it at `POST /api/judge` (it reads `OPENAI_API_KEY` and `WHITE_RABBIT_OPENAI_MODEL` from the environment, or from the White Rabbit app's `.env.local`), and `api/judge.js` is the same thing as a Vercel function, which needs `OPENAI_API_KEY` set in the Vercel project. Without a key the game still works on Wikipedia alone. A tape is a small file `noclick/build_tapes.py` writes ahead of time (Python 3, no packages; polite, cached requests):

```bash
cd noclick && python3 build_tapes.py pretzel oramics domesday
```

It checks the start and target aren't already one step apart, takes par from the real hole, labels each hop of the rabbit's route the way the game would, and lists the target's neighbours for TRACKING, into `noclick/puzzles/<slug>.json`. `noclick/today.json` picks the day's three, and `node noclick/test.cjs` plays all three in headless Chromium on a phone and a desktop. `noclick/strict/` keeps the earlier strict mode (only links in the article count, frozen offline), for a possible hard mode.

## The leaderboard

`noclick/board.mjs` serves `GET/POST /api/board` (locally through `serve.mjs`; `api/board.js` on Vercel). It ranks a day by score, then strokes, then who posted first, one row per device. With `NOCLICK_SUPABASE_URL` and `NOCLICK_SUPABASE_SERVICE_KEY` set it uses Supabase: run `noclick/leaderboard.sql` in the project first (the table has row level security on and no public policies; only the server's key reads and writes it). Without them the local server keeps a JSON file per day outside this folder, and a deploy answers "not switched on yet".

## Files

| File | What it is |
|---|---|
| `game.html` | No Clicking: page, styles, the referee, the tape wheel and the CRT shader |
| `noclick/` | The tape builder, today's list, the tapes and the end-to-end test (`strict/`: the earlier strict mode) |
| `echo-legacy.html` | Echo, the earlier guess-the-missing-word game, kept so it can come back (it reads `rounds-today.json` and `img/vega.jpg`) |
| `serve.mjs`, `page.mjs`, `build.mjs` | The local server and the static build (`npm run build` writes `dist/`) |
| `api/judge.js`, `api/board.js` | The AI referee and the leaderboard as Vercel functions |

## Credits

- Page titles and sentences shown in the game come from English Wikipedia (live, through its API) and are used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The rabbit holes are from the White Rabbit Library.
- Type: [Handjet](https://fonts.google.com/specimen/Handjet), SIL Open Font License, loaded from Google Fonts.
- 3D: [three.js](https://threejs.org) r128, MIT, loaded from cdnjs.
