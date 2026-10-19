# Maze Chase

Eat the dots; one of you is the ghost · 1–5 players · Arcade · **coming soon**

A maze full of dots. Most players eat; one player (or the AI) hunts them as the ghost. Power pellets turn the tables.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Eater | Ghost |
|---|---|---|
| ✕ | — | Sprint (short) |
| Stick | Move | Move |

## Competition

**Party** · **Score attack**

Everyone takes a turn as the ghost; most dots wins.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One maze, dots and power pellets
- [ ] Eaters and a ghost
- [ ] Rounds; everyone takes a turn as the ghost
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More mazes
- Several ghosts

## Notes

2D grid.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
