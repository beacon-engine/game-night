# Racing: what the racing games share

Stock Cars, Grand Prix and Rally (and Street Racing, Go-Karts and Superbikes next) import what they have in
common from here, never from each other's folders. What isn't about racing (the weather, the sky,
particles, the split screen) is one level up, in [`web/world/`](../world/README.md). A game imports these as `@racing/<file>.ts` (the
alias is in `tsconfig.json`; the bundler follows it into each game's `main.js`). The car models are
served at `/racing/models/`.

| File | |
|---|---|
| `cars.ts` | Loads the car models and repaints each in its driver's colour, with their number on the doors; their finishes (clear-coated paint, glass, metal rims) and lights; wheels that spin and steer; and their tyres: slicks (the kit's own, smooth), or a band of tread for wets, gravel or snow tyres. |
| `tyres.ts` | The tyres (`Tyre`: slick, wet, gravel, snow), the grip each has in the weather, and when the pit wall would change them (named thresholds, not a chain of conditions). No graphics. |
| `race.ts` | Racing on a track (`track.ts`): the handling, the tow, contact, laps and the computer drivers. Stock Cars races with it as it is; Grand Prix adds health, fuel and pit stops on top. The grip comes from the car, its tyres and the weather. No graphics. |
| `track.ts` | A track as numbers, from its description: an oval or a road course, everything measured along it (`s`) and across it (`d`). |
| `sound.ts` | A synthesised engine for each person driving, tyres, wind, squeals and the wall; the pack going by; the rain, and tyres hissing on a wet road. |
| `scenery.ts` | The land round a track by its theme (countryside, desert, harbour, city). |
| `venue.ts` | Building a venue from a track: ribbons along the lap, cars placed on the banked surface, kerbs and the crowd. |
| `models/` | The cars, from [Kenney's Car Kit](https://kenney.nl/assets/car-kit) (CC0), with the originals and their licence in [`source/`](source/README.md). A game's own model goes in its own `models/` folder (`"model": "models/<name>"` in its `cars.json`). |

The weather itself, the sky, particles and the split screen aren't racing things: they're in
[`web/world/`](../world/README.md), for any game played outdoors.

What stays in a game's folder is what only that game does: its venue and cameras (`scene.ts`), its flow
and screens (`main.ts`), its data (`cars.json`, tracks), and its own rules (Grand Prix's damage and pit
lane, Rally's physics and stages). When a second game needs one of those, it moves here.

## Weather

| | Rain | Snow |
|---|---|---|
| Rally | Showers or rain: gravel hardly minds, dirt turns to mud, tarmac gets slippery. Rally tyres always have tread. | Packed snow on every surface, studded tyres. |
| Grand Prix | Showers or rain. Slicks in the dry, wets in the wet: box when it changes. | No (circuits stop for snow). |
| Stock Cars | On the road course: showers or rain, slicks or wets chosen before the start (no pit stops). Ovals only in the dry. | No. |

That follows the real sports: rallies run in anything (the winter rounds are on snow and ice), circuit
racing runs wet on grooved tyres, and oval racing stops for rain.

| Tyre | Dry road | Soaked road |
|---|---|---|
| Slicks | 100% grip | 50% |
| Wets | 88% (and in Grand Prix they wear 3× faster on a dry road) | 78% |
| Studs (Rally) | on packed snow: 50 to 62% of the same surface dry | |

In between, the grip is in between: wets overtake slicks once the road is about a third wet. Braking
grip falls with it, and the computer drivers brake earlier to match.
