# Checkers

Jump, crown, clear the board · 1–2 players · Board · **coming soon**

Draughts: diagonal moves, jumps that take, and a crown when you reach the far side. Against a friend or the computer.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| D-pad | Move your square |
| Bolt | Pick up a piece, put it down (a jump that can go on, goes on) |
| Drop | Put the piece back |

## Competition

**Exhibition** · **Ladder**

One game, or a ladder through the evening.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Checkers (US) and draughts (UK) are the game's old, generic names. Start with **English draughts** (8x8 board, men move forward, kings one square at a time, taking is compulsory) and add **international draughts** (10x10, men take backwards, flying kings) as a variant; the rules are centuries old and free to use. Our own pieces and board. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] 8x8 board and the English rules: compulsory captures, multi-jumps, kings
- [ ] Win when the other side has no pieces or no move; draw by agreement or repetition
- [ ] A computer opponent at three strengths (the chess search fits: see `../chess/ai.ts`)
- [ ] Cursor, pick up and put down, as in Chess
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- International draughts (10x10) as a variant
- A clock
- Saved records

## Notes

2D. Shares its feel with [Chess](../chess): the same cursor, pick up and put down.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
