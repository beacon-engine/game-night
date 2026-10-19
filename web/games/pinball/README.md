# Pinball

Take turns on one table; beat the high score · 1–4 players · Arcade · **coming soon**

A pinball table with ramps, bumpers and a multiball mode. Pass-and-play turns, like a real arcade.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| L1 | Left flipper |
| R1 | Right flipper |
| ✕ | Launch (hold for power) |
| Stick | Nudge the table |

## Competition

**Arcade** · **Tournament**

High-score table; tournament is best total over 3 balls each round.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One table with bumpers and two ramps
- [ ] Flipper and ball physics
- [ ] Tilt
- [ ] Turns and high scores
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Multiball
- More tables

## Notes

2.5D or 3D. Physics: fixed step, small time step for the ball.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
