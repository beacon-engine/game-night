# Chess

The classic, against a friend or the computer · 1–2 players · Board · **playable**

The standard game with the standard rules, on the TV. Each player moves a square around the board with their
phone, picks up a piece and puts it down. On your own, the computer plays you at three strengths.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. Here the phone shows the d-pad: the arrows move your square; Bolt picks up and puts down; Drop puts
the piece back (`controls.json`).

| Button | Playing | Asked for a draw |
|---|---|---|
| D-pad, stick or arrow keys | Move your square; ◀▶ choose what a pawn becomes | |
| Bolt | Pick up a piece, put it down (and confirm a promotion) | Accept |
| Drop | Put the piece back | Play on |
| ❚❚ (pause) | Resume, offer a draw, resign, quit | |

Two keyboard players work too (WASD with F/H, and the arrows with , and /). Enter starts, Esc pauses or goes back.

## How it works

- `rules.ts`: the rules, no drawing. A 0x88 board; legal moves with castling (all its conditions), en passant and
  promotion; check, checkmate, stalemate; draws by the fifty-move rule, threefold repetition and too few pieces
  to mate; moves named in standard notation (SAN). Checked with perft against the published counts.
- `ai.ts`: the computer. Alpha-beta search with captures tried first (most valuable victim, least valuable attacker),
  scored by material and piece-square tables, with a capture search at the end on Medium and Hard. It thinks a few
  milliseconds a frame (a generator it steps each frame), so the screen never freezes, and stops at a time limit.
  Easy looks one move ahead with some randomness and the odd blunder; Medium two, Hard four.
- `draw.ts`: the board on a 2D canvas: ink squares, our own vector pieces, each player's cursor as the brand's
  viewfinder corners in their colour, the piece in hand, dots where it can go, the last move, a king in check,
  a short slide for each move.
- `main.ts`: lobby, the game, pause (draw offers, resigning), clocks, results, saved records, the phones.

## Competition

**Exhibition** · **Ladder**

A single game, or a standing ladder: challenge someone up to two places above you; win and you swap.
The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Chess is about 1,500 years old and belongs to everyone, rules and name. Our own pieces (drawn in code), board
colours and look. See [Originality](../README.md#originality).

## First playable: done

- [x] Full rules: castling, en passant, promotion, check, checkmate, stalemate, the draws
- [x] Moving pieces with the phone: a cursor each, pick up, put down
- [x] A computer opponent at three strengths that never freezes the screen
- [x] Clocks (5 or 10 minutes), draw offers, resigning
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built: saved records per player (wins, draws, losses, and wins against each computer strength), the move list,
captured pieces, rematch with colours swapped.

## Next

- A ladder across the evening
- Clocks with an increment (3+2), and a clock that only starts when both have moved
- Take back a move against the computer
- An opening book, so the computer varies its first moves
- Watch a finished game again, move by move

## Notes

2D only. The computer's search runs on its own copy of the board, a slice per frame, so drawing never sees a
half-made move.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
