# Grand Prix

Single-seaters on road circuits: damage, fire and pit stops · 1–4 players · Racing · **playable** (in progress)

Light, fast open-wheelers on circuits that turn both ways. Look after the car: every hit costs health, a
hard one can set it alight, and the tyres and fuel won't last a long race, so you choose when to pit.

Pick a circuit in the lobby (`circuits.json`), how many computer drivers, how many laps (5, 10 or 15) and
how quick they are. After Start, everyone picks a livery on their phone.

## Controls

| Button | Driving |
|---|---|
| Steering slider, stick, or arrows / A D | Steer |
| Bolt | Gas (hold) |
| Drop | Brake (hold) |
| L1 | Box this lap (press again to stay out) |
| R1 | Look back |

Box, then keep to the left side of the main straight: you turn into the pit lane where it leaves the
track. In the lane the speed limiter drives for you: down to 90 km/h, a stop at your box while the crew
works, and back out when the track is clear.

## How a car wears (`damage.ts`)

| | |
|---|---|
| Health | 100 to start. Hits above 3 m/s cost 2 per m/s more (another car) or 3.5 (a barrier; its force counts 0.7× at a crawl, up to 1.2× at 250 km/h). Racing costs 1.5 a lap. Below 60, the car loses pace: up to 12% at none left. |
| Fire | From 11 m/s (a car) or 9 m/s (a barrier), a chance of fire: 5% per m/s more, at most 50%. A burning car loses 2.5 health a second: box, or it burns out. |
| Wrecked | From 24 m/s (a car) or 17 m/s (a barrier), a chance the car is wrecked outright: 12% per m/s more, at most 90%. Also when health reaches 0. |
| Tyres | 8% wear a lap, more when sliding; fully worn tyres grip 35% less. |
| Fuel | A full tank is 7 laps. Empty, the engine dies and the car coasts; stop out on the track and you're out. |
| Pit stop | 1.5 s to stop and go, 2.5 s for tyres, 0.35 s per lap of fuel put in (filled to what's left of the race, up to a full tank), 0.05 s per point of health mended, 1.5 s to put out a fire. |

The computer drivers come in for fuel they can't finish on, tyres past 62% worn, health under 45 or a
fire, and never on the last lap unless they're burning. Your phone gives you the same call.

## Files

| File | What's in it |
|---|---|
| `circuits.json` | The circuits: a whole lap of straights and turns both ways, the same as Stock Cars' road courses. The first and last straights are the main straight, where the pit lane goes. |
| `cars.json` | The car. The model borrows Stock Cars' open-wheeler; a `.glb` of your own goes in `models/` (with wheel parts named `wheel-front-left` and so on). |
| `damage.ts` | Health, tyres, fuel and fire, and the pit crew's times. No race rules or graphics, so Superbikes can use it too. |
| `pits.ts` | The pit lane: where it is, a box per car, and driving cars through it. Works on anything with a place on the track. |
| `gp.ts` | The race: Stock Cars' racing (`../stock-cars/race.ts`) with each car's condition and the pit lane. Cars in the pits or out of the race are taken off the track. |
| `scene.ts` | The circuit in three.js, with the pit lane, garages and grandstand; sparks, flames and smoke; the cameras. |
| `main.ts` | Lobby, picking liveries, countdown, race, results (with DNFs), saved records, what the phones show. |

Built on Stock Cars: the handling, the computer drivers, the track model, the cars and the engine sound are
imported from `../stock-cars/`, not copied.

Saved: each driver's races, wins, podiums and best lap, and each circuit's lap record.

## Originality

Open-wheel racing is a sport, not anyone's game. Our own name, cars, liveries, numbers, drivers and
circuits; no real series, teams, sponsors, manufacturers or circuits. See [Originality](../README.md#originality).

## First playable

- [x] Two circuits, one car (`circuits.json`, `cars.json`)
- [x] Handling with more grip (downforce) than Stock Cars
- [x] Health, damage, fire and wrecks; tyres and fuel that run out
- [x] A pit lane and pit stops, for people and the computer drivers
- [x] Health in the standings and on your own screen; DNFs in the results
- [x] Phones show what each button does and when to box; Drop in the lobby goes back to the games
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`)
- [x] Two keyboard players can play it too (they come free with `Input`)

## Next

- Qualifying sets the grid; Race weekend and Championship (points for the top 10, with COMPETITIONS.md)
- Tyre compounds (soft, hard), and a mandatory stop
- A safety car after a crash
- Grip that grows with speed (real downforce)
- Weather, and wet tyres
- Our own single-seater model

## Competition

**Race** now · **Race weekend** · **Championship** · **Career** next. The formats are in
[COMPETITIONS.md](../COMPETITIONS.md).
