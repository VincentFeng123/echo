# Echo

A daily word game from [White Rabbit](https://whiterabbt.com). Each day there are five tapes. Each tape is a real rabbit hole whose headline is missing a word, like *"ketchup used to be ____"*. You have six tries to guess it.

- A warm guess gets back Wikipedia's own sentence that ties your guess to the answer, with the answer blanked out.
- On the left you see the rabbit hole so far. **Reveal next page** opens the next page down the hole, and costs one try.
- After four tries the letter count shows, and after five the first letter.
- Each tape scores 7 minus the tries you used, or 0 if the blank wins. Thirty points is a perfect day, and **Share today** copies your five rows.

The whole thing plays on an old CRT: a three.js wheel of VHS tapes, everything drawn through a curved-glass shader, and one pixel type family (Handjet) throughout.

## Run it

Needs Node 18 or newer, and nothing to install.

```bash
npm start
```

Then open http://localhost:4747. A phone on the same Wi-Fi can open the address the server prints. Add `?reset` to the address to clear this device's progress and play the day again.

## Files

| File | What it is |
|---|---|
| `game.html` | The game: page, styles, the referee, the tape wheel and the CRT shader |
| `serve.mjs` | A tiny server that inlines today's rounds and the cover photo into `game.html` on every load |
| `rounds-today.json` | Today's five rounds, in play order |
| `rounds/round-*.json` | Each round as built: headline, accepted answers, the hole's pages, and the precomputed Wikipedia sentences that grade guesses |
| `img/vega.jpg` | The cover photo for the Suzanne Vega tape |

Nothing calls an AI or Wikipedia while you play. Every round is precomputed.

## Credits

- Sentences shown in the game come from English Wikipedia and are used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each one is credited on screen.
- Cover photo: Suzanne Vega, by Michal Maňas, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Wikimedia Commons.
- The rabbit holes are from the White Rabbit Library.
- Type: [Handjet](https://fonts.google.com/specimen/Handjet), SIL Open Font License, loaded from Google Fonts.
- 3D: [three.js](https://threejs.org) r128, MIT, loaded from cdnjs.
