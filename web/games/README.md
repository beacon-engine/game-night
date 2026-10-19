# Games

Every folder here is a game. There is no list to register it in: a folder with a `game.json` is on
the game select page, and deleting the folder takes it off again. Each planned game has its own
README with the idea, a first plan for the pad controls, and what it needs to become playable.
Pick one and go.

## Roadmap

| | Game | Players | Status |
|---|---|---|---|
| ⚽ | [Football](football) | 1–8 | **playable** |
| 🏀 | [Basketball](basketball) | 1–6 | coming soon (sports) |
| ⚾ | [Baseball](baseball) | 1–2 (teams) | coming soon (sports) |
| 🏏 | [Cricket](cricket) | 1–4 | coming soon (sports) |
| 🎾 | [Long Tennis](long-tennis) | 1–4 | coming soon (sports) |
| 🏓 | [Table Tennis](table-tennis) | 1–4 | coming soon (sports) |
| 🎱 | [Pool](pool) | 1–2 | coming soon (sports) |
| 🏎️ | [Racing](racing) | 1–4 | coming soon (sports) |
| 🏐 | [Beach Volleyball](volleyball) | 1–4 | coming soon (sports) |
| 🥊 | [Boxing](boxing) | 1–2 | coming soon (sports) |
| ⛳ | [Crazy Golf](golf) | 1–8 | coming soon (sports) |
| 🏒 | [Air Hockey](air-hockey) | 1–2 | coming soon (sports) |
| 🤾 | [Dodgeball](dodgeball) | 2–8 | coming soon (sports) |
| 🥋 | [Fighters](fighters) | 1–2 | coming soon (action) |
| 👊 | [Street Brawler](brawler) | 1–4 | coming soon (action) |
| 🪖 | [Tanks](tanks) | 2–8 | coming soon (action) |
| ⚡ | [Laser Tag](laser-tag) | 2–8 | coming soon (action) |
| 💣 | [Blast Zone](blast-zone) | 2–8 | coming soon (action) |
| 🤼 | [Sumo Push](sumo) | 2–8 | coming soon (action) |
| ✈️ | [Dogfight](dogfight) | 1–8 | coming soon (action) |
| 🧟 | [Last Stand](last-stand) | 1–4 | coming soon (action) |
| 🚩 | [Capture the Flag](capture-the-flag) | 2–8 | coming soon (action) |
| 🏙️ | [Rooftop Brawl](rooftop-brawl) | 2–4 | coming soon (action) |
| 🚌 | [Danfo Rush](danfo-rush) | 1–4 | coming soon (action) |
| 🕵️ | [Heist](heist) | 2–4 | coming soon (action) |

Want a game that isn't here? Add a folder with a `game.json` and a README in the same shape.

## Building a game

```
web/games/my-game/
  game.json       name, icon, tagline, players, order on the page
  README.md       the plan (not served)
  index.html      the page; loads main.js
  main.ts         the game; bundled to main.js
  controls.json   which pad button does which action, per situation
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

- ○ in the lobby (and Esc on the keyboard) goes back to the games with `backToHub()`.
- The pad's ❚❚ button arrives as `input.onPause`; pause the game.
- Run the simulation at a fixed 60 steps a second and draw at up to 60 fps (see the loop at the bottom of
  football's `main.ts`); TVs and laptops vary a lot.
- Keep everything a game needs inside its folder.
