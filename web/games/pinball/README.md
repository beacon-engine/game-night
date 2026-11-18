# Pinball

Take turns on one table; beat the high score · 1–4 players · Arcade · **playable** (in progress)

A pinball table with ramps, bumpers and a multiball mode. Pass-and-play turns, like a real arcade.

The table and its rules are written in **Odin** and compiled to WebAssembly: see [odin/README.md](odin/README.md)
for how it works and how to change it. `main.ts` is the game flow (lobby, turns, results, saves), `sim.ts` talks
to `sim.wasm`, `draw.ts` draws it and `sound.ts` makes the noises.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here (from `controls.json`); the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| L1 | Left flipper |
| R1 | Right flipper |
| Bolt | Launch (hold for power) |
| Stick | Nudge the table (flick it; too often and it tilts) |

## Competition

**Arcade** · **Tournament**

High-score table; tournament is best total over 3 balls each round.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [x] One table with bumpers, slingshots, top lanes (bonus multiplier) and targets (jackpot)
- [ ] Two ramps (see [odin/README.md](odin/README.md))
- [x] Flipper and ball physics
- [x] Tilt
- [x] Turns and high scores
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

## Later

- Multiball
- A kickback in the left outlane
- Tournament: best total over 3 balls each round
- More tables

## Notes

2D for now (a `light` game: runs on a 1 GB TV). Physics: fixed 60 steps a second, 8 substeps for the ball.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
