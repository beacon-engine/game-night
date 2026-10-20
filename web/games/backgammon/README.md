# Backgammon

Race your pieces home, hit theirs on the way · 1–2 players · Board · **coming soon**

Roll two dice and race your fifteen pieces around the board and off it. Land on a lone piece to send it back to the start.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| Bolt | Roll; pick up a piece, put it down |
| D-pad | Move your cursor between points |
| Drop | Undo this turn's last move |
| Leaf | Offer the doubling cube |

## Competition

**Exhibition** · **Ladder**

Matches to 3, 5 or 7 points, with the doubling cube.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Backgammon is thousands of years old (its family goes back to ancient Persia and Rome); the name and rules are free. Our own board, pieces and dice. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] The board, 15 pieces each, two dice
- [ ] Legal moves only (you must use both dice when you can), hitting, entering from the bar, bearing off
- [ ] The doubling cube; gammons and backgammons
- [ ] A computer opponent
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Matches to N points with the Crawford rule
- Saved records

## Notes

2D. Dice rolls want to feel physical: a short tumble, then the numbers big.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
