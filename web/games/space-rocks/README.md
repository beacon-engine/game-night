# Space Rocks

Thrust, turn, shoot the rocks (and each other) · 1–4 players · Arcade · **coming soon**

Vector-style ships in a screen full of rocks that split when you shoot them. Co-op for points, or free-for-all.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Flying |
|---|---|
| ✕ | Thrust |
| ○ | Fire |
| □ | Hyperspace |
| Stick | Turn |

## Competition

**Arcade** · **Versus**

Co-op for a shared high score, or free-for-all to 10.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Rock-shooting games go back to *Asteroids* (1979). Atari has enforced its rights before, so: our own ship and rock designs, colours and sounds, and our own twists (co-op, versus). No vector-outline imitation of the original. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Ships with inertia
- [ ] Rocks that split
- [ ] Screen wrap
- [ ] Lives and score
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Versus
- UFOs

## Notes

2D, thin vector lines.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
