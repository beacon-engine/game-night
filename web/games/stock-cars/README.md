# Stock Cars

Oval racing: slipstreams, bump drafts, last-lap passes · 1–4 players · Racing · **playable**

Heavy cars, banked ovals, a pack that never spreads out. The draft is everything: line up behind someone
and you go faster (and give them a shove). Pull out late to pass, and stay off the wall.

Pick a track in the lobby (`tracks.json`) and, after Start, everyone picks a car on their phone
(`cars.json`): the Stocker, Hot Hatch, Prototype, Open Wheeler, Pickup or Big SUV, each with its own
speed, pick-up, grip and weight.

## Controls

Every game uses the same phone pad. Here, while racing, the phone shows the racing pad: slide your thumb
left and right to steer, with gas and brake pedals (`controls.json`). Menus use the d-pad.

| Button | Driving |
|---|---|
| Steering slider, stick, or arrows / A D | Steer (right = up the track, toward the wall) |
| Bolt (or up / W) | Gas (hold) |
| Drop (or down / S) | Brake (hold) |
| R1 | Look back (hold) |

## How it works

| File | |
|---|---|
| `tracks.json` | The tracks. An oval is half a lap of straights and left turns (the other half is its mirror image, so it always closes); a road course is the whole lap, turning both ways. Width, banking, time of day. Add one and it's in the lobby. |
| `cars.json` | The cars: which model, how long, and top speed, pick-up, grip and weight compared with the Stocker. |
| `scene.ts` | The venue in three.js, built from the track and lit for day, dusk or night; sparks, rain and spray; a chase camera per person (the screen splits for 2 to 4), a TV camera, and the turntables for picking cars. |
| `main.ts` | Lobby (with the weather), picking cars (and, for showers, tyres), countdown, race, results, saved records, what the phones show. |

The racing itself is shared with the other racing games, in [`web/racing/`](../../racing/README.md):
the track (`track.ts`), the cars on it, the slipstream, contact, laps and the computer drivers (`race.ts`,
no graphics, so it can be tested on its own), the models and their paint (`cars.ts`), the land round each
track (`scenery.ts`), the weather (`weather.ts`, `rain.ts`) and the engine sound (`sound.ts`).

Handling, in short: gas settles you at your top speed (more in a slipstream); the tyres and the banking hold
the turns up to a point, and beyond it you slide to the outside and scrub speed. An oval's banking is steeper
up by the wall, so the high line carries more speed, and the apron below the inside edge is slow. Steering
moves you across the track, faster the faster you go. Hits bounce cars apart (a knock you can't just steer
out of), the walls cost a lot of speed, and grinding along one costs more. The computer drivers brake for
the turns they can't take flat, take the racing line on a road course, and keep looking for a way past.

Saved: each driver's races, wins, podiums, best lap and last car, and each track's lap record.

**Weather** (the road course only: ovals aren't raced wet, as in the real sport): Dry, Showers or Rain.
The rain soaks the road over half a minute and it dries over a couple. There are no pit stops, so for
Showers everyone picks tyres before the start with Leaf: slicks are quicker until the rain comes and slither
about once it does; wets, with grooves cut in them to clear the water, are slower in the dry and safe in the
wet. For Rain everyone's on wets. Half the computer drivers gamble on slicks.

The cars are from [Kenney's Car Kit](https://kenney.nl/assets/car-kit) (CC0), kept with their licence in
[`web/racing/source/`](../../racing/source/README.md). Everything else (track, scenery, textures) is drawn in code.

## Competition

**Exhibition** (now) · **Race weekend** · **Championship** · **Playoffs**

Weekend: single-car qualifying, then a race in stages with stage points. Season: points for every finishing position plus stage points; the top drivers enter elimination playoff rounds, and the last four race for the title in the final round.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Oval stock car racing is a sport, not anyone's game. Our own name, cars, liveries, numbers, drivers and
track; no real series, teams, sponsors, manufacturers or circuits. See [Originality](../README.md#originality).

## First playable: done

- [x] One banked oval
- [x] Drafting (the slipstream, and a shove for the car in front)
- [x] Contact that bumps, not wrecks; the wall costs speed
- [x] Countdown, laps, final lap, chequered flag, results
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)
- [x] A road course, turning both ways
- [x] Weather on the road course: showers and rain, slicks or wets

## Next

- Cautions and restarts (a yellow flag after a big hit, the pack bunches up behind a pace car)
- Qualifying, then Race weekend and Championship (with COMPETITIONS.md)
- Pit stops: tyres wear, fresh ones are faster
- A superspeedway
- More road courses
- Overtime finish
- A spotter: "car outside" on your phone
