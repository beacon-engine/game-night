# Street Racing

City streets and canyon roads at night, with traffic · 1–4 players · Racing · **coming soon**

Fast cars through a city at night and down winding canyon roads: tight corners, long sweepers, other
traffic to weave through, shortcuts through alleys. Races are circuits through the streets or
point-to-point sprints from one side of the map to the other.

## Controls (a first plan)

The racing pad, like [Stock Cars](../stock-cars): slide to steer, Bolt for gas, Drop to brake.

| Button | Driving |
|---|---|
| Steering slider | Steer |
| Bolt | Gas (hold) |
| Drop | Brake (hold) |
| Leaf | Handbrake: slide round hairpins |
| Star | Boost (fills up by driving close to traffic and drifting) |
| R1 | Look back |

## Competition

**Exhibition** · **Cup** · **Career**

Cups of 4 races, points per position. Career: win races to unlock cars and districts.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## How it builds on Stock Cars

- The cars, the repainting, the car picker, collisions and sound come straight from `stock-cars/`
  (`cars.ts`, `race.ts`'s contact rules, `sound.ts`). They should move into a shared place first.
- New: road layouts with left and right turns that don't need to mirror (a list of straights and curves
  that closes, or a road network the race follows), road-side buildings, junctions, and simple traffic
  cars on fixed routes.

## Originality

Street racing games are a genre. Our own name, city, cars and look; no real cities' landmarks, car
makers, or another series' names, logos or heat/police systems. See [Originality](../README.md#originality).

## First playable

- [ ] One city circuit with left and right turns, at night
- [ ] Traffic on fixed routes
- [ ] Collisions with walls, traffic and each other (from Stock Cars)
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
