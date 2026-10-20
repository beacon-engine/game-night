# Reversi

Trap their discs, flip them to yours · 1–2 players · Board · **coming soon**

Place a disc so that it traps a line of the other colour between yours: every trapped disc flips to your colour. Most discs at the end wins.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| D-pad | Move your square (the squares you can play are marked) |
| Bolt | Place a disc |

## Competition

**Exhibition** · **Ladder**

One game, or a ladder through the evening.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Reversi is the game's original, generic name (England, 1880s). **"Othello" is a trademark** of its own modern edition: we never use it, nor that edition's green board and black-and-white look. Our own name and colours. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] 8x8 board, the standard four-disc start
- [ ] Only moves that flip something; pass when you have none; the game ends when neither can move
- [ ] Discs flip one after another along each line
- [ ] A computer opponent at three strengths
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- A clock
- Saved records

## Notes

2D. The flips are the show: make them quick and clear.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
