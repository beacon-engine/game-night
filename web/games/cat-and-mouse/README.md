# Cat and Mouse

Grab the cheese; one of you is the cat · 2–5 players · Arcade · **coming soon**

A kitchen, seen from above, at night. Most players are mice dashing between cupboards for crumbs and cheese;
one player (or the computer) is the cat. Mice can dive into a mouse hole to hide for a few seconds. Then the
roles swap, so everyone gets a turn as the cat.

## Controls (a first plan)

Every game uses the same phone pad. Here: the d-pad, and two buttons.

| Button | Mouse | Cat |
|---|---|---|
| D-pad | Run | Prowl |
| Button 1 | Dive into a mouse hole (when next to one) | Pounce (a short dash, then a pause) |
| Button 2 | Squeak (lure the cat, score bonus if it works) | Listen (shows mice nearby for a moment) |

## Competition

**Party** · **Score attack**

Everyone takes a turn as the cat; most cheese wins.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Maze chase games go back to the 1970s (the Magnavox Odyssey had a *Cat and Mouse*). We take the idea of
"collect while being chased", not anyone's look: no dots in corridors, no ghosts, no power pellets, our own
kitchen layouts, characters and sounds. See [Originality](../README.md#originality).

## First playable

- [ ] One kitchen with cupboards, tables and mouse holes
- [ ] Mice and a cat with different speeds; catching, hiding
- [ ] Cheese and crumbs to collect; rounds where the cat changes
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Phones show what each button does (`input.show`); back in the lobby goes back to the games (`backToHub`)

## Later

- More rooms (market, bakery)
- Two cats with more players

## Notes

2D, top-down. A grid for movement, with soft round characters and warm night-kitchen colours.
