# Rally

Gravel, dirt and jumps, everyone on the stage at once · 1–4 players · Racing · **playable** (in progress)

Rugged terrain: forest gravel and canyon dirt over rough hills, crests that throw you into the air, dips
that bottom you out and a ford to splash through. Cars slide on the loose stuff, so you steer with the
throttle and the handbrake as much as the wheel.

Everyone races the stage at once (rallycross style): with 1 to 4 people sharing one screen, nobody waits
for a turn, and the screen splits for 2 to 4 like [Stock Cars](../stock-cars). Up to 5 computer drivers fill
the field. A stage is a loop of 2 to 2.6 km; races are 1, 2, 3 or 5 laps.

## Controls

The racing pad, like Stock Cars.

| Phone / keyboard | Driving |
|---|---|
| Steering slider, stick, or arrows / A D | Steer |
| Bolt | Gas (hold) |
| Drop | Brake (hold); held when stopped, reverse |
| Leaf | Handbrake: locks the rear wheels, swings the back round |
| L1 | Back on the road (stuck, upside down, or lost) |
| R1 | Look back |

In the air, the gas lifts the nose and the brake drops it (the spinning wheels' inertia), so you can
level the car for the landing.

## How it works

| File | |
|---|---|
| `stages.json` | The stages: a seed, the look (forest or canyon), time of day, size, how hilly, road width, how many jumps and dips, a ford. Add one and it's in the lobby. |
| `stage.ts` | A stage from its description: the land (noise), the road's loop (a lopsided oval with waves along it, so it has hairpins and esses but never kinks), its height (smoothed, not too steep, then the crests, dips and ford), all baked into one grid of heights and surfaces 2.5 m apart. Trees and rocks, and the posts the cars hit. The co-driver's calls. |
| `physics.ts` | The cars: rigid bodies on four raycast wheels with springs and dampers, tyres that grip as much as the surface lets them (turning comes first, the engine and brakes get what's left), flight, landings, the body hitting the ground, car against car (three spheres each, impulses with spin), cars against trees and rocks. 180 steps a second, nothing allocated. |
| `race.ts` | Laps, positions, the computer drivers (aim ahead on the road, slow for the bends and jumps ahead, level the car in the air, back out when stuck), and putting cars back on the road. Only driving counts: cutting across the land doesn't move you on. |
| `chassis.ts` | A car's numbers from `cars.json` and its model (size, where the wheels are). |
| `scene.ts` | The world in three.js: the land in pieces, finer near the camera; the road; the ford, trees, rocks, chevron boards; the cars with their wheels steering, spinning and riding their springs, and their shadows on the ground; dust and spray; the chase camera (level through the jumps), a TV camera, turntables. |
| `main.ts` | Lobby, picking cars, countdown, race, results, saved records, what the phones show. |

It builds on Stock Cars: the car models, their paint, finishes and lights (`../stock-cars/cars.ts`), the
drawing helpers (`../stock-cars/draw.ts`) and the engine sound (`../stock-cars/sound.ts`) are imported from
there (the bundler follows the imports), not copied. The models are Kenney's Car Kit (CC0), kept in
`../stock-cars/models` with their licence in `../stock-cars/source/`.

The kit's cars are toys, their wheels tucked well in under tall bodies; on those a real car would tip over
in an ordinary bend. The physics puts the tyres out near the body's edges (they're drawn where the model
has them), so a car rolls from a bad landing or a hard hit, not from cornering.

Saved: each driver's races, wins, podiums, biggest air and last car, and each stage's lap record.

## Competition

**Race** now · **Stage** (one car at a time, against the clock) · **Rally** (several stages, times added up) ·
**Rallycross** (heats and a final)

The formats are in [COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Rally is a sport. Our own name, stages, cars and look; no real championships, teams, sponsors or car
makers. See [Originality](../README.md#originality).

## First playable: done

- [x] Gravel and dirt stages over hills, with crests, dips and a ford
- [x] Real car physics: springs, sliding, flight, landings, rolling over
- [x] Collisions: car against car, against trees and rocks
- [x] Surface grip and sliding; a handbrake
- [x] Computer drivers; back on the road when stuck or upside down
- [x] A co-driver's calls on the screen and the phone
- [x] Phones show what each button does; a manual; the brand; saved records; stars and paint jobs

## Next

- Stage mode: one at a time against the clock, with ghosts
- Rally: several stages, times added up; rallycross heats and a final
- Snow and tarmac stages; mud that slows you
- Damage you can see; punctures
- More cars
