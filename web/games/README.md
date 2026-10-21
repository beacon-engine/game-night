# Games

Every folder here is a game. There is no list to register it in: a folder with a `game.json` is on
the game select page, and deleting the folder takes it off again. Each planned game has its own
README with the idea, a first plan for the pad controls, and what it needs to become playable.
Pick one and go.

## Roadmap

| | Game | Players | Competition | Status |
|---|---|---|---|---|
| ⚽ | [Football](football) | 1–8 | Exhibition (League, Cup next) | **playable** |
| ⚡ | [Neon Trails](neon-trails) | 1–8 | First to 3/5/7, saved records | **playable** |
| 🚗 | [Stock Cars](stock-cars) | 1–4 | Exhibition, saved records (Race weekend, Championship next) | **playable** |
| ♟️ | [Chess](chess) | 1–2 | Saved records (Ladder next) | **playable** |
| | **Sports** | | | |
| 🏀 | [Basketball](basketball) | 1–6 | Exhibition, League, Cup, Groups + knockout | coming soon |
| ⚾ | [Baseball](baseball) | 1–2 (teams) | Exhibition, League, Series | coming soon |
| 🏏 | [Cricket](cricket) | 1–4 | Exhibition, League, Groups + knockout | coming soon |
| 🎾 | [Long Tennis](long-tennis) | 1–4 | Exhibition, Cup, Tour | coming soon |
| 🏓 | [Table Tennis](table-tennis) | 1–4 | Exhibition, Cup, Groups + knockout | coming soon |
| 🎱 | [Pool](pool) | 1–2 | Exhibition, Cup, Ladder | coming soon |
| 🏐 | [Beach Volleyball](volleyball) | 1–4 | Exhibition, Cup, Tour | coming soon |
| 🥊 | [Boxing](boxing) | 1–2 | Exhibition, Title fight, Tournament, Career | coming soon |
| ⛳ | [Crazy Golf](golf) | 1–8 | Exhibition, Tournament | coming soon |
| 🏒 | [Puck Duel](puck-duel) | 1–2 | Exhibition, Cup, Ladder | coming soon |
| 🤾 | [Dodgeball](dodgeball) | 2–8 | Exhibition, League, Cup | coming soon |
| | **Racing** | | | |
| 🏍️ | [Superbikes](superbikes) | 1–4 | Exhibition, Race weekend, Championship, Career | coming soon |
| 🏎️ | [Grand Prix](grand-prix) | 1–4 | Exhibition, Race weekend, Championship, Career | coming soon |
| 🏁 | [Go-Karts](go-karts) | 1–4 | Exhibition, Cup, Battle | coming soon |
| 🏙️ | [Street Racing](street-racing) | 1–4 | Exhibition, Cup, Career | coming soon |
| ⛰️ | [Rally](rally) | 1–4 | Race (rallycross), stage records (Stage, Rally next) | **playable** (in progress) |
| | **Action** | | | |
| 🥋 | [Fighters](fighters) | 1–2 | Arcade ladder, Tournament, Ranked | coming soon |
| 👊 | [Brawlers](brawler) | 1–4 | Story, Score attack | coming soon |
| 🪖 | [Tanks](tanks) | 2–8 | Exhibition, League, Party | coming soon |
| ⚡ | [Laser Arena](laser-arena) | 2–8 | Exhibition, League, Cup | coming soon |
| 💣 | [Bomb Maze](bomb-maze) | 2–8 | Exhibition, Party, Cup | coming soon |
| 🤼 | [Sumo Push](sumo) | 2–8 | Exhibition, Basho | coming soon |
| ✈️ | [Dogfight](dogfight) | 1–8 | Exhibition, League, Campaign | coming soon |
| 🧟 | [Last Stand](last-stand) | 1–4 | Survival, Score attack | coming soon |
| 🚩 | [Capture the Flag](capture-the-flag) | 2–8 | Exhibition, League, Cup | coming soon |
| 🏙️ | [Rooftop Brawl](rooftop-brawl) | 2–4 | Exhibition, Tournament, Ranked | coming soon |
| 🕵️ | [Heist](heist) | 2–4 | Campaign, Score attack | coming soon |
| | **Arcade** | | | |
| 👾 | [Space Shooter](space-shooter) | 1–4 | Arcade, Score attack | coming soon |
| 🧱 | [Bricks](bricks) | 1–4 | Arcade, Versus | coming soon |
| 🐍 | [Snake Battle](snake-battle) | 2–8 | Party, Cup | coming soon |
| 👻 | [Cat and Mouse](cat-and-mouse) | 1–5 | Party, Score attack | coming soon |
| ☄️ | [Space Rocks](space-rocks) | 1–4 | Arcade, Versus | coming soon |
| 🎰 | [Pinball](pinball) | 1–4 | Arcade, Tournament | coming soon |
| 🐸 | [Road Hopper](road-hopper) | 1–8 | Party, Score attack | coming soon |
| | **Board** | | | |
| ⛀ | [Checkers](checkers) | 1–2 | Ladder | coming soon |
| 🔴 | [Four in a Row](four-in-a-row) | 1–2 | Ladder | coming soon |
| ⚫ | [Reversi](reversi) | 1–2 | Ladder | coming soon |
| 🎲 | [Backgammon](backgammon) | 1–2 | Match to N points | coming soon |
| 🟡 | [Ludo](ludo) | 2–4 | Party | coming soon |
| 🐍 | [Snakes and Ladders](snakes-and-ladders) | 2–4 | Party | coming soon |
| 🁫 | [Dominoes](dominoes) | 2–4 | Match to N points | coming soon |
| 🫘 | [Mancala](mancala) | 1–2 | Ladder | coming soon |

Every game also gets competitions (leagues, cups, race weekends, championships, title fights...):
see [COMPETITIONS.md](COMPETITIONS.md) for the shared plan.

Want a game that isn't here? Add a folder with a `game.json` and a README in the same shape.

## Building a game

```
web/games/my-game/
  game.json       name, tagline, players, category, order on the page, and "needs" (below)
  icon.svg        a line icon (see ../brand/README.md)
  README.md       the plan (not served)
  index.html      the page; loads main.js
  main.ts         the game; bundled to main.js
  manual.json     "How to play": intro, goal, steps, tips (shown from the game select page and the lobby)
  controls.json   which pad button does which action, per situation
  competitions.json  which competition formats it offers, points, tie-breakers (see COMPETITIONS.md)
  source/         the original art (zips unpacked, Blender files...): in git, never shipped
  ...             anything else (models, sounds, data) is served next to it
```

A game shows as *coming soon* until it has an `index.html`; drop `"status": "soon"` from `game.json`
when it's ready to play.

Run it while you work: `make dev` from the repo root, open http://localhost:10000 and pick your game.
TypeScript changes rebuild on save; reload the page. `make check` type-checks everything.

### The platform

Games build on `@platform` ([`../platform/`](../platform)). The parts you'll use:

| | |
|---|---|
| `new Input({ state })` | Every connected phone (and keyboard player) as a `Controller` with your own typed `state` on it. `input.list` is who's playing. |
| `c.x`, `c.y` | The stick (or steering, in the racing layout), -1..1 (up is +1). `c.held(BIT.sprint)`: pushed past its ring. |
| `c.dpad` | The d-pad as `{ x, y }`, each -1, 0 or 1 (y down is +1). Each press also arrives in `drain()` as `BIT.up/down/left/right`. |
| `c.drain()` | Button presses and releases since last time: `{ bit, down }`. |
| `c.flickX()`, `c.flickY()` | -1/+1 once per flick, for menus. |
| `c.tag`, `c.color`, `c.label` | 'P1', their colour, their name. The same in every game. |
| `input.show(c, screen)` | What their phone shows: the `layout`, title, hint, and a label per button (unlabelled buttons are dimmed). Only sent when it changes, so call it every frame. |
| `input.buzz(c, ms)` | Vibrate their phone. |
| `loadControls(contexts, actions)` | Reads your `controls.json`; typos are reported in the console and skipped. Then `controls.action(ctx, bit)`, `controls.labels(ctx)`. |
| `backToHub()` | Back to the game select page (the phones stay connected). |
| `gameSaves()`, `playerKey(c)` | Saved progress: `saves.get(key)` / `saves.set(key, value)`, kept on the machine running Beacon Arcade. `playerKey(c)` is that player's own (it follows their phone). |
| `earnStars(c, ['played', 'won'])` | Stars for a player at the end of a game. Say what happened (`played`, `won`, `podium`, `record`, `champion`); the server decides what it's worth, caps it per day and tells their phone. Returns `{ earned, balance, lines }` to show on your results. |
| `ownedItems(c)`, `shopItems()` | What a player has bought for your game, and what's on sale. Your game sells looks with a `shop.json`: `{"items": [{"id", "name", "price", "about", ...your own fields}]}`. Only looks, never an advantage. |
| `showManual('', name)`, `manualPadInput(c)` | Open this game's manual (Star in the lobby); while it's open, `manualPadInput` lets the phones scroll and close it. |

```ts
import { Input, loadControls, backToHub } from '@platform';

const input = new Input({ state: () => ({ score: 0 }) });
const controls = await loadControls(['play'] as const, ['jump', 'duck'] as const);

function tick() {
  for (const p of input.list) {
    for (const ev of p.drain()) {
      if (ev.down && controls.action('play', ev.bit) === 'jump') p.score++;
    }
    input.show(p, { label: p.tag, color: p.color, title: 'My Game', accent: '#0ea5e9', hint: '', labels: controls.labels('play') });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

`controls.json` for that:

```json
{ "play": { "bolt": "jump", "drop": "duck" }, "labels": { "jump": "Jump", "duck": "Duck" } }
```

Buttons are `bolt`, `drop`, `leaf`, `star`, `l1`, `r1`; `"star+swipe"` is a swipe across Star.

### Pad layouts

Each screen picks how the phone lets you steer, with `layout` in `input.show`:

| Layout | The phone shows | Use it for |
|---|---|---|
| `'dpad'` | four arrow buttons and the face buttons | **every menu** (lobbies, pause, picking a club), and grid games (snake, blast zone, maze chase) |
| `'stick'` | a floating analog stick (past its ring = sprint) and the face buttons | moving freely: football, brawlers, twin-stick shooters |
| `'racing'` | slide sideways to steer (analog `c.x`, springs back), a throttle (Bolt) and brake (Drop) pedal, and Leaf Star L1 R1 | anything you drive or ride |

Menus read `c.flickX()` / `c.flickY()`: one step per d-pad tap (taps can't be missed) or per flick of the stick.

[Football](football) is the full example: `actions.ts` lists its actions, `main.ts` is the menus and HUD,
`match.ts` the simulation. three.js is available (`import * as THREE from 'three'`) and bundled
into each game that uses it.

### What a game needs from the device

Say it in `game.json` as `"needs"`: `"light"` (2D canvas), `"standard"` (simple 3D) or `"heavy"` (big 3D
scenes: many animated characters, shadows, large textures). The game select page only offers a game on a
screen that can run it, and tells players in plain words when it can't (a 1 GB TV runs `light` games). Be honest: if in doubt,
test on a weak device.

In the game itself:

```ts
import { requireDevice, PerformanceGuard } from '@platform';

const device = await requireDevice(); // before loading anything big: stops here if this screen can't run it
const guard = new PerformanceGuard({ targetFps: device.tv ? 30 : 60, onStruggle: (level) => lowerDetail(level) });
guard.watchCanvas(renderer.domElement); // out of graphics memory: end the game cleanly
// in the render loop: guard.frame(now)
```

If the game can't hold its target, `onStruggle(1)`, `onStruggle(2)`… ask it to lower its detail; after
that, Beacon Arcade stops the game and goes back to the games. Football is the example. To see your game as a
weak screen would, open it with `?device=light` (in a browser; the TV app ignores it).

## Originality

Game ideas and rules are free for anyone to use. What belongs to their makers is the **expression**: names,
logos, characters, art, sounds, music, level layouts, and a game's overall look and feel. Courts have found
infringement when a game copied too much of that (*Atari v. Philips*, 1982, a maze game too close to Pac-Man;
*Tetris v. Xio*, 2012, a game that copied Tetris's look). So:

- **Take the idea, never the look.** Our own art, colours, sounds, characters and level layouts. If a screenshot
  of ours could be mistaken for the original, change it.
- **Names**: search the web and app stores before naming a game. No names that are close to a known game or
  brand (we renamed Kart Rush, Blast Zone, Space Raiders and others for this reason). Plain, descriptive names
  (Bricks, Space Rocks, Go-Karts) are the safe default.
- **No real people**: no real players', drivers' or boxers' names or faces. Fictional teams and riders.
- **No real brands** on billboards, kits or cars, unless it's ours or we have written permission.
- **No other platforms' symbols**, like a console's controller button shapes.
- **Say where an idea comes from**, plainly, in the manual's `inspiredBy` ("Trail games like this go back to…"),
  without using the original's name as ours.
- **Assets**: only ones we made, or with a licence that allows it (CC0, CC-BY with credit, OFL for fonts, MIT
  for code). Record the licence next to them (see `football/source/README.md`).

This is good practice, not legal advice. Before a big public launch, have a trademark lawyer check the names.

### Conventions

- Use the brand: link `/brand/brand.css` and follow [`../brand/README.md`](../brand/README.md) for menus and
  HUD (colours, type, the selection frame, `glyph()` for pad buttons). Football's `index.html` is the example.
- Drop in the lobby (and Esc on the keyboard) goes back to the games with `backToHub()`.
- Every game has a manual (`manual.json`), offered on Star in its lobby. Plain words: what it is, how you win,
  how to play in a few steps. If it's based on an existing game, say so (`inspiredBy`).
- Menus use the `'dpad'` layout; switch to `'stick'` or `'racing'` only while actually playing.
- The pad's ❚❚ button arrives as `input.onPause`; pause the game.
- Run the simulation at a fixed 60 steps a second and draw at up to 60 fps (see the loop at the bottom of
  football's `main.ts`); TVs and laptops vary a lot.
- Keep everything a game needs inside its folder.
