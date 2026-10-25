# No Clicking

A daily Wikipedia game from [White Rabbit](https://whiterabbt.com). Each day there are three floppy disks. Each disk is a start page and a target page from a real rabbit hole, like *Pretzel → Caramelization*. Nothing on screen is clickable: you make your own trail by typing anything connected to where you are, one step at a time (*nutmeg → nuts → squirrel → animal → pigeons → New York → Manhattan*).

- **Modes.** Pick Easy, Medium (the default) or Hard on the shelf; the mode applies to all three disks and keeps its own progress and leaderboard. Easy lets big topics through and reads names loosely; Medium is the rules below; Hard counts only real links (no names, no AI referee), charges a stroke for a too-broad guess, and ejects at par + 3.
- **MOVE** (1 stroke): a step counts when either Wikipedia page links the other, or one names the other in its text. When Wikipedia doesn't tie them, or can't be reached, a light AI referee (OpenAI's cheapest model, the one White Rabbit's app uses) decides whether most people would see a clear connection (Werther's Original → Caramelization: yes; Germany → Basketball: no). Any capitalisation, redirects, plurals and loose names work ("werthers candy" finds Werther's Original through Wikipedia's search); an ambiguous name ("nuts", "new york") takes the sense that connects.
- **Be specific.** **TOO BROAD** (free, no progress): umbrella topics that connect to everything, Wikipedia's ~1,000 core subjects ("Vital articles, level 3": Music, Film, Food, Science...) minus its famous people, plus every country, continent, year, date and list (`noclick/broad.json`, from `build_tapes.py --broad`). A one-word name only counts as "named" when written as a name (Germany), not as an ordinary word (music). The last step into the target must be a real Wikipedia link or name; the referee can't award it.
- **Descriptions work** ("german snack", "iron tower"). When what you type isn't a page's exact name, or is a name that doesn't connect, the game reads it through Wikipedia's search, preferring a result that links (or is linked from) the page you're on, then one with all your words, then one with your first word, and says what it read ("Read as Brotzeit"). A guess it had to make that doesn't connect is free (NOT SURE), and so is a name it can't find (NOT FOUND): only an exact page name that doesn't connect costs a stroke.
- **STATIC** (1 stroke): the pages don't link or name each other and the referee sees no clear, specific connection. **NOT FOUND** and **WHICH ONE?** (free): no page goes by that name, or none of its senses connects.
- **HINT** (1 stroke) names a page the current one links that's one step from the target. **UNDO** steps back a page for free.
- Two lamps: **END** lights on a page that connects to the target, **RABBIT** on a page of the real rabbit hole.
- **How to play** opens as a box the first time you play (close it with the X; **? HOW TO PLAY** brings it back). Words of the game (par, stroke, static, referee, HINT, the lamps…) and every Wikipedia page on screen have a dotted underline: hover or tap for a definition. A page's definition is its Wikipedia short description and first sentence, written into the disk for the disk's own pages and looked up live for pages you type.
- **The day's score** adds up the three disks like a round of golf. **TODAY'S SCORE** (from the shelf's running total, or any end screen) shows it as a table, par, strokes and score per disk and the day's total, next to **today's leaderboard**: finish all three disks, type a name, and post (posting again updates your row). Share copies the day's total and one line per tape.
- Par is the number of steps the real rabbit hole took, so the game is "beat the rabbit". Run out at par + 5 and the disk ejects. At the end the TV plays the rabbit's route next to yours (each of your steps says how it connected), then you can share a spoiler-free result, find more rabbit holes, or open this one on whiterabbt.com.

The whole thing plays on an old CRT: a three.js wheel of 3.5" floppy disks (a sliding brushed-metal shutter, and masking-tape labels written by hand in Caveat, the one font besides Handjet), everything drawn through a curved-glass shader (flat on phones), and one pixel type family (Handjet) throughout. Archive, the research-desk game, is the other tab at `/desk` wherever its files are present (the tab hides itself otherwise).

## Run it

Needs Node 18 or newer, and nothing to install.

```bash
npm start
```

Then open http://localhost:4747. A phone on the same Wi-Fi can open the address the server prints. Add `?reset` to the address to clear this device's progress and play the day again.

## Making disks

The game checks each step live against Wikipedia's API from the browser (a few small requests per guess, cached, with an `Api-User-Agent`). The AI referee runs server side in `noclick/judge.mjs`: `serve.mjs` serves it at `POST /api/judge` (it reads `OPENAI_API_KEY` and `WHITE_RABBIT_OPENAI_MODEL` from the environment, or from the White Rabbit app's `.env.local`), and `api/judge.js` is the same thing as a Vercel function, which needs `OPENAI_API_KEY` set in the Vercel project. Without a key the game still works on Wikipedia alone. A disk is a small file `noclick/build_tapes.py` writes ahead of time (Python 3, no packages; polite, cached requests):

```bash
cd noclick && python3 build_tapes.py pretzel oramics domesday
```

It checks the start and target aren't already one step apart, takes par from the real hole, labels each hop of the rabbit's route the way the game would, and lists the target's neighbours for HINT, into `noclick/puzzles/<slug>.json`. `noclick/today.json` picks the day's three, and `node noclick/test.cjs` plays all three in headless Chromium on a phone and a desktop. `noclick/strict/` keeps the earlier strict mode (only links in the article count, frozen offline), for a possible hard mode.

## The leaderboard

`noclick/board.mjs` serves `GET/POST /api/board` (locally through `serve.mjs`; `api/board.js` on Vercel). It ranks a day by score, then strokes, then who posted first, one row per device. With `NOCLICK_SUPABASE_URL` and `NOCLICK_SUPABASE_SERVICE_KEY` set it uses Supabase: run `noclick/leaderboard.sql` in the project first (the table has row level security on and no public policies; only the server's key reads and writes it). Without them the local server keeps a JSON file per day outside this folder, and a deploy answers "not switched on yet".

## Files

| File | What it is |
|---|---|
| `game.html` | No Clicking: page, styles, the referee, the floppy-disk wheel and the CRT shader |
| `noclick/` | The disk builder (`build_tapes.py`), today's list, the disks and the end-to-end test (`strict/`: the earlier strict mode) |
| `echo-legacy.html` | Echo, the earlier guess-the-missing-word game, kept so it can come back (it reads `rounds-today.json` and `img/vega.jpg`) |
| `serve.mjs`, `page.mjs`, `build.mjs` | The local server and the static build (`npm run build` writes `dist/`) |
| `api/judge.js`, `api/board.js` | The AI referee and the leaderboard as Vercel functions |

## Credits

- Page titles and sentences shown in the game come from English Wikipedia (live, through its API) and are used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- The rabbit holes are from the White Rabbit Library.
- Type: [Handjet](https://fonts.google.com/specimen/Handjet), SIL Open Font License, loaded from Google Fonts.
- 3D: [three.js](https://threejs.org) r128, MIT, loaded from cdnjs.
