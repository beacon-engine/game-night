# Stock Cars

Oval racing: slipstreams, bump drafts, last-lap passes · 1–4 players · Racing · **playable**

Heavy cars, a banked oval, a pack that never spreads out. The draft is everything: line up behind someone
and you go faster (and give them a shove). Pull out late to pass, and stay off the wall.

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
| `track.ts` | The oval as numbers: two straights, two half-circle turns banked at 24°. Everything is measured along it (`s`) and across it (`d`). |
| `race.ts` | The cars, the slipstream, contact (bumps, not wrecks), laps, finishing order, and the computer drivers. No graphics, so it can be tested on its own. |
| `scene.ts` | The night race in three.js: the track and walls built from `track.ts`, grandstand, lights, the cars (simple shapes in each car's colour, numbers painted on), a chase camera per person (the screen splits for 2 to 4) and a TV camera. |
| `sound.ts` | A synthesised engine per person driving, and a thump for contact. |
| `main.ts` | Lobby, countdown, race, results, saved records, what the phones show. |

Handling, in short: gas settles you at your top speed (more in a slipstream); the banking holds the turns up
to a point, and beyond it you slide up toward the wall and scrub speed; steering moves you across the track,
faster the faster you go; the outside wall costs a lot of speed.

Saved: each driver's races, wins, podiums and best lap, and the lap record (with who set it).

Everything is drawn in code: no downloaded models or textures yet. The cars could later use a free
(CC0) low-poly car pack; record its licence in `source/` (see [Originality](../README.md#originality)).

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

## Next

- Cautions and restarts (a yellow flag after a big hit, the pack bunches up behind a pace car)
- Qualifying, then Race weekend and Championship (with COMPETITIONS.md)
- Pit stops: tyres wear, fresh ones are faster
- Short tracks, a superspeedway and a road course
- Overtime finish
- A spotter: "car outside" on your phone
