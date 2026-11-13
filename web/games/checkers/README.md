# Checkers

Jump, crown, clear the board · 1–2 players · Board · **playable**

Draughts: diagonal moves, jumps that take, and a crown when you reach the far side. Each player moves a square
over the dark squares with their phone, picks up a piece and puts it down, one hop at a time for a jump. On your
own, the computer plays you at three strengths.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. Here the phone shows the d-pad: the arrows move your square over the dark squares; Bolt picks up
and puts down; Drop goes back a hop or puts the piece back (`controls.json`).

| Button | Playing | Asked for a draw |
|---|---|---|
| D-pad, stick or arrow keys | Move your square (with a piece in hand: from one square it can land on to the next) | |
| Bolt | Pick up a piece, put it down (a jump that can go on, goes on: Bolt on each landing square) | Accept |
| Drop | Back one hop, or put the piece back | Play on |
| ❚❚ (pause) | Resume, offer a draw, resign, quit | |

Two keyboard players work too (WASD with F/H, and the arrows with , and /). Enter starts, Esc pauses or goes back.

## How it works

- `rules.ts`: the rules, no drawing. The 32 dark squares, numbered 1–32 as in every checkers book; men move
  forwards, kings both ways; taking is compulsory and a jump goes on while it can (any of the possible jumps may
  be chosen, not necessarily the longest); a man crowned during a jump stops there. A side with no pieces or no
  move loses; a draw after forty moves each with no capture and no man moved, or the same position three times.
  Moves are written the usual way (11-15, 22x15, 15x24x31). Checked with perft against the published counts.
- `ai.ts`: the computer. Alpha-beta search with a memory of positions it has seen (a transposition table), jumps
  played out to the end before it judges a position, scored by material, kings, how far the men have come, the
  back row kept as a guard, the centre, and (when ahead) swapping pieces off and hunting with the kings. It thinks
  a few milliseconds a frame (a generator it steps each frame), so the screen never freezes, and stops at a time
  limit. Easy looks two moves ahead with a lot of randomness and plays the odd random move; Medium five; Hard
  as deep as it gets in two seconds.
- `draw.ts`: the board on a 2D canvas: ink squares with their numbers, our own discs (a king is two stacked with a
  crown), each player's cursor as the brand's viewfinder corners in their colour, a breathing ring round each piece
  that must take, the piece in hand, dots where it can go, the jump's path so far with the pieces it has jumped
  crossed out, and each move played out hop by hop, the taken pieces fading as it passes and the crown popping on.
- `main.ts`: lobby, the game, pause (draw offers, resigning), clocks, results, saved records, callouts (crowned,
  double and triple jumps, the win), the phones.

## Competition

**Exhibition** · **Ladder**

One game, or a ladder through the evening.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Checkers (US) and draughts (UK) are the game's old, generic names. This is **English draughts** (8x8 board, men
move forward, kings one square at a time, taking is compulsory); the rules are centuries old and free to use. Our
own pieces (drawn in code), board colours and look. See [Originality](../README.md#originality).

## First playable: done

- [x] 8x8 board and the English rules: compulsory captures, multi-jumps, kings
- [x] Win when the other side has no pieces or no move; draw by agreement, forty moves, or repetition
- [x] A computer opponent at three strengths that never freezes the screen
- [x] Cursor, pick up and put down, as in Chess; jumps entered hop by hop, with the path shown
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built: clocks (5 or 10 minutes), saved records per player (wins, draws, losses, and wins against each computer
strength), the move list, pieces left, rematch with colours swapped, board themes bought with stars (`shop.json`).

## Next

- International draughts (10x10, men take backwards, flying kings, the longest capture is compulsory) as a variant
- A ladder across the evening
- Take back a move against the computer
- An opening book (or the three-move ballot), so games against the computer start differently
- Watch a finished game again, move by move

## Notes

2D only. Shares its feel with [Chess](../chess): the same lobby, cursor, pick up and put down. The computer's
search runs on its own copy of the board, a slice per frame, so drawing never sees a half-made move.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
