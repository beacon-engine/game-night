# Dodgeball

Team dodgeball · 2–8 players · Sports · **coming soon**

Two teams, a handful of balls in the middle. Hit someone and they're out; catch it and the thrower is out and a teammate comes back.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | With a ball | Without |
|---|---|---|
| ✕ | Throw (at the nearest in front) | Pick up |
| ○ | Lob | Catch (timing) |
| □ | Fake throw | Dodge roll |
| Stick past the ring | Sprint | Sprint |

## Competition

**Exhibition** · **League** · **Cup**

Teams play best-of-3 rounds; league table or a bracket.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Court with a centre line
- [ ] Throw, catch, dodge
- [ ] Outs and comebacks
- [ ] Rounds
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Power throws with a charge
- Different balls

## Notes

3D with the shared player model, or 2D top-down.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
