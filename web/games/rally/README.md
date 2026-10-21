# Rally

Dirt, gravel and jumps, one stage at a time · 1–4 players · Racing · **coming soon**

Rugged terrain: forest gravel, desert dirt, mountain hairpins and jumps over crests. Cars slide on loose
surfaces, so you steer with the throttle as much as the wheel. Rally is run against the clock, one car
at a time on a stage, or as a rallycross race with everyone on a short mixed circuit at once.

## Controls (a first plan)

The racing pad, like [Stock Cars](../stock-cars).

| Button | Driving |
|---|---|
| Steering slider | Steer |
| Bolt | Gas (hold) |
| Drop | Brake (hold) |
| Leaf | Handbrake |
| R1 | Look back |

## Competition

**Stage** · **Rally** (several stages, times added up) · **Rallycross** (heats and a final)

The formats are in [COMPETITIONS.md](../COMPETITIONS.md).

## How it builds on Stock Cars

- The cars, picker, collisions and sound from `stock-cars/`. The hills come from `stock-cars/scenery.ts`
  (the land there already rises into hills and mesas); a rally stage is a road laid over that land.
- New: grip that depends on the surface (tarmac, gravel, dirt, snow), the car's weight shifting, jumps,
  dust and a co-driver's calls ("left 3, over crest") on the phone.

## Originality

Rally is a sport. Our own name, stages, cars and look; no real championships, teams, sponsors or car
makers. See [Originality](../README.md#originality).

## First playable

- [ ] One gravel stage over hills, against the clock
- [ ] Surface grip and sliding
- [ ] Phones show what each button does; a manual; the brand
