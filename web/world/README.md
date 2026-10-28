# World: what the 3D games share

Anything a 3D game needs that isn't about one sport: the weather, the sky, particles, textures drawn
in code and the split screen. Football, the racing games and City Runners import it as
`@world/<file>.ts` (the alias is in `tsconfig.json`), never from each other's folders. Racing-only
code is in [`web/racing/`](../racing/README.md).

| File | |
|---|---|
| `weather.ts` | The weather over a match or a race: `Forecast` (dry, showers, rain, snow), how hard it's raining now, how wet the ground is (it soaks over half a minute and dries over a couple), and the `Conditions` in a word. No graphics and no rules: each game decides what the wet does to it. |
| `precipitation.ts` | The weather, drawn: rain or snow falling round every camera (moved on the graphics card, so it costs the CPU nothing), the sky clouding over, a road or pitch that darkens and shines when wet, and spray. `WeatherLook` does all of it for one scene. |
| `sky.ts` | The sky dome, the stars, and what shiny things (car paint) reflect, for any time of day. |
| `particles.ts` | Sparks, flames, smoke and spray: a fixed pool of points that fly and fade. |
| `screen.ts` | Splitting the screen for 1 to 4 people. |
| `draw.ts` | Small helpers for textures drawn in code, seeded random numbers, and the noise hills are made from. |
| `trees/` | [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT, see `trees/LICENSE`), a generator of trees from presets (oaks, ashes, aspens, pines, bushes), vendored with one change: it has no textures of its own, so a game hands it bark and leaves first (`setTreeTextures()`). Import `@world/trees/index.js`. Fireteam grows its trees with it. |

## Adding weather to a game

```ts
import { Forecast, Weather } from '@world/weather.ts';
import { WeatherLook } from '@world/precipitation.ts';

const look = new WeatherLook(scene);
look.venue(groundMaterial);                       // after building (or relighting) the venue
const weather = new Weather(Forecast.Showers, 600); // about how long the game lasts, in seconds

// each step of the game
weather.step(t, dt);                              // then use weather.rain, weather.wet, weather.snow
// each frame
look.update(dt, weather);
```

What the wet does is the game's own: the racing games' tyres lose grip (`racing/tyres.ts`), a football
pitch gets quicker and players lose footing (`games/football/match.ts`, `setPitch`).
