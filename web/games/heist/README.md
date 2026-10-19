# Heist

Co-op stealth: grab the loot, don't get seen · 2–4 players · Action · **coming soon**

A small crew, a building, guards on patrol and cameras. Split up, distract, grab the loot and get to the van.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Sneaking | Carrying loot |
|---|---|---|
| ✕ | Use / open / take | Throw the bag to a teammate |
| ○ | Crouch (quiet) | Drop the bag |
| □ | Distract (throw a coin) | — |
| △ | Mark a guard for the team | — |
| Stick past the ring | Run (noisy) | Run (slower) |
| Stick | Move | Move |

## Competition

**Campaign** · **Score attack**

A run of jobs; rank by loot and time, stealth bonus for no alarms.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One building with guards and vision cones
- [ ] Sneak, crouch, distract
- [ ] Loot and escape
- [ ] Caught = alarm and a chase
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More jobs
- Gadgets
- Procedural layouts

## Notes

Top-down 3D. Guard AI with simple patrol routes and a suspicion meter.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
