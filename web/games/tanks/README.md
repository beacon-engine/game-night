# Tanks

Tank battle in a destructible arena · 2–8 players · Action · **coming soon**

Top-down tanks: bouncing shells, walls that break, last tank standing. Simple to learn, chaotic with 8.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving |
|---|---|
| ✕ | Fire (shells bounce once) |
| ○ | Mine |
| □ | Shield (short, cooldown) |
| L1 | Turret left |
| R1 | Turret right |
| Stick | Drive |

## Competition

**Exhibition** · **League** · **Party**

Rounds to a target score; team league for regular groups.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Arena with breakable walls
- [ ] Driving, aiming, bouncing shells
- [ ] Last one standing, rounds and a score
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Teams
- Power-ups
- More arenas

## Notes

2D canvas or low-poly 3D from above.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
