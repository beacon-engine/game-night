# Road Hopper

Cross the road, the river, the railway: first across wins · 1–8 players · Arcade · **coming soon**

Everyone hops across busy lanes at once. Traffic, logs, trains. Push each other into the road.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Hopping |
|---|---|
| ✕ | Hop forward |
| ○ | Shove |
| Stick | Hop in a direction |

## Competition

**Party** · **Score attack**

Race to the line, or furthest distance.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Crossing games go back to *Frogger* (1981). No frog, no river-logs-and-turtles lookalike; our own characters and roads. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Endless lanes: road, river, rail
- [ ] Hop movement
- [ ] Race to a line, or last one alive
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Characters
- Lagos traffic theme

## Notes

Low-poly 3D, isometric camera.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
