# Four in a Row

Drop discs, line up four · 1–2 players · Board · **coming soon**

Take turns dropping a disc into one of seven columns; it falls to the lowest free space. Four in a line, any way, wins.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ◀▶ | Choose a column |
| Bolt | Drop the disc |

## Competition

**Exhibition** · **Ladder** · **Party**

Best of 5, or a ladder; quick enough for a party round between bigger games.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Four-in-a-line games with falling discs are old and their rules are free, but **"Connect Four" is a Hasbro trademark**: we never use that name, and we avoid its look (the blue upright frame with red and yellow discs). Our own name, board and colours (the players' colours). See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] A 7 by 6 board; discs that fall with a short drop
- [ ] Four in a row across, down or diagonally wins; a full board is a draw
- [ ] A computer opponent at three strengths
- [ ] Best of 5, the loser starts the next game
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Bigger boards (8 by 7, 9 by 7)
- Teams of two, taking turns

## Notes

2D. Tiny state: the computer can look many moves ahead.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
