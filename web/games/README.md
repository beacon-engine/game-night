# Games

Every folder here is a game. There is no list to register it in: a folder with a `game.json` is on
the game select page, and deleting the folder takes it off again. Each planned game has its own
README with the idea, a first plan for the pad controls, and what it needs to become playable.
Pick one and go.

## Roadmap

| | Game | Players | Competition | Status |
|---|---|---|---|---|
| ⚽ | [Football](football) | 1–8 | Exhibition (League, Cup next) | **playable** |
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
| 🏒 | [Air Hockey](air-hockey) | 1–2 | Exhibition, Cup, Ladder | coming soon |
| 🤾 | [Dodgeball](dodgeball) | 2–8 | Exhibition, League, Cup | coming soon |
| | **Racing** | | | |
| 🚌 | [Danfo Rush](danfo-rush) | 1–4 | Score attack, Championship | coming soon |
| 🏍️ | [Superbikes](superbikes) | 1–4 | Exhibition, Race weekend, Championship, Career | coming soon |
| 🏎️ | [Grand Prix](grand-prix) | 1–4 | Exhibition, Race weekend, Championship, Career | coming soon |
| 🚗 | [Stock Cars](stock-cars) | 1–4 | Exhibition, Race weekend, Championship, Playoffs | coming soon |
| 🏁 | [Kart Rush](kart-rush) | 1–4 | Exhibition, Cup, Battle | coming soon |
| | **Action** | | | |
| 🥋 | [Fighters](fighters) | 1–2 | Arcade ladder, Tournament, Ranked | coming soon |
| 👊 | [Street Brawler](brawler) | 1–4 | Story, Score attack | coming soon |
| 🪖 | [Tanks](tanks) | 2–8 | Exhibition, League, Party | coming soon |
| ⚡ | [Laser Tag](laser-tag) | 2–8 | Exhibition, League, Cup | coming soon |
| 💣 | [Blast Zone](blast-zone) | 2–8 | Exhibition, Party, Cup | coming soon |
| 🤼 | [Sumo Push](sumo) | 2–8 | Exhibition, Basho | coming soon |
| ✈️ | [Dogfight](dogfight) | 1–8 | Exhibition, League, Campaign | coming soon |
| 🧟 | [Last Stand](last-stand) | 1–4 | Survival, Score attack | coming soon |
| 🚩 | [Capture the Flag](capture-the-flag) | 2–8 | Exhibition, League, Cup | coming soon |
| 🏙️ | [Rooftop Brawl](rooftop-brawl) | 2–4 | Exhibition, Tournament, Ranked | coming soon |
| 🕵️ | [Heist](heist) | 2–4 | Campaign, Score attack | coming soon |
| | **Arcade** | | | |
| 👾 | [Space Raiders](space-raiders) | 1–4 | Arcade, Score attack | coming soon |
| 🧱 | [Brick Breaker](brick-breaker) | 1–4 | Arcade, Versus | coming soon |
| 🐍 | [Snake Battle](snake-battle) | 2–8 | Party, Cup | coming soon |
| ⚡ | [Light Cycles](light-cycles) | 2–8 | Party, Cup | coming soon |
| 👻 | [Maze Chase](maze-chase) | 1–5 | Party, Score attack | coming soon |
| ☄️ | [Asteroid Storm](asteroid-storm) | 1–4 | Arcade, Versus | coming soon |
| 🎰 | [Pinball](pinball) | 1–4 | Arcade, Tournament | coming soon |
| 🐸 | [Road Hopper](road-hopper) | 1–8 | Party, Score attack | coming soon |

Every game also gets competitions (leagues, cups, race weekends, championships, title fights...):
see [COMPETITIONS.md](COMPETITIONS.md) for the shared plan.

Want a game that isn't here? Add a folder with a `game.json` and a README in the same shape.

## Building a game

```
web/games/my-game/
  game.json       name, tagline, players, category, order on the page
  icon.svg        a line icon (see ../brand/README.md)
  README.md       the plan (not served)
  index.html      the page; loads main.js
  main.ts         the game; bundled to main.js
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
| `c.x`, `c.y` | The stick, -1..1 (up is +1). `c.held(BIT.sprint)`: pushed past its ring. |
| `c.drain()` | Button presses and releases since last time: `{ bit, down }`. |
| `c.flickX()`, `c.flickY()` | -1/+1 once per flick, for menus. |
| `c.tag`, `c.color`, `c.label` | 'P1', their colour, their name. The same in every game. |
| `input.show(c, screen)` | What their phone shows: title, hint, and a label per button (unlabelled buttons are dimmed). Only sent when it changes, so call it every frame. |
| `input.buzz(c, ms)` | Vibrate their phone. |
| `loadControls(contexts, actions)` | Reads your `controls.json`; typos are reported in the console and skipped. Then `controls.action(ctx, bit)`, `controls.labels(ctx)`. |
| `backToHub()` | Back to the game select page (the phones stay connected). |

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
{ "play": { "cross": "jump", "circle": "duck" }, "labels": { "jump": "Jump", "duck": "Duck" } }
```

Buttons are `cross`, `circle`, `square`, `triangle`, `l1`, `r1`; `"triangle+swipe"` is a swipe across △.

[Football](football) is the full example: `actions.ts` lists its actions, `main.ts` is the menus and HUD,
`match.ts` the simulation. three.js is available (`import * as THREE from 'three'`) and bundled
into each game that uses it.

### Conventions

- Use the brand: link `/brand/brand.css` and follow [`../brand/README.md`](../brand/README.md) for menus and
  HUD (colours, type, the selection frame, `glyph()` for pad buttons). Football's `index.html` is the example.
- ○ in the lobby (and Esc on the keyboard) goes back to the games with `backToHub()`.
- The pad's ❚❚ button arrives as `input.onPause`; pause the game.
- Run the simulation at a fixed 60 steps a second and draw at up to 60 fps (see the loop at the bottom of
  football's `main.ts`); TVs and laptops vary a lot.
- Keep everything a game needs inside its folder.
