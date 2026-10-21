# Dominoes

Match the ends, empty your hand · 2–4 players · Board · **coming soon**

Each player holds a hand of tiles. Take turns laying a tile whose end matches an open end of the line. First to play all their tiles wins the hand.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ◀▶ | Choose a tile from your hand (on your phone) |
| Bolt | Play it |
| Leaf | Which end of the line |
| Drop | Draw or pass |

## Competition

**Exhibition** · **Cup**

Games to 100 or 150 points.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Dominoes is a generic name and the standard double-six set and its games (block, draw, All Fives) are free to use. Our own tiles and table. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] A double-six set; the block and draw games
- [ ] Your hand shown only on your phone (the pad needs a way to show tiles: a platform change)
- [ ] Scoring to a target
- [ ] Computer players to fill in
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- All Fives (points for ends that add up to a multiple of five)
- Partners (2 against 2)

## Notes

2D. The hand is secret, so this is the first game that needs the phone to show private cards: plan that with the pad.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
