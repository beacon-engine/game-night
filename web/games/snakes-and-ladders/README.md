# Snakes and Ladders

Climb the ladders, dodge the snakes · 1–4 players · Board · **playable**

Roll and move up a numbered board, all on the TV. A ladder carries you up; a snake slides you down. First to
square 100 wins, and you can play on for every place. Pure luck: perfect for small children and big groups.
Computer players fill the empty seats, so two to four tokens always race.

## Controls

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. Here the phone only rolls, and Bolt is lit only on your turn (`controls.json`).

| Button | Lobby | Your turn | Results |
|---|---|---|---|
| D-pad, stick or arrow keys | Choose a setting (▲▼), change it (◀▶) | | |
| Bolt | Start | Roll | Play again |
| Drop | Back to the games | | Back to the lobby |
| Star | How to play | | |
| ❚❚ (pause) | | Resume, or quit to the lobby | |

Two keyboard players work too (WASD with F/H, and the arrows with , and /). Enter starts, Esc pauses or goes back.

## How it works

- `rules.ts`: the rules, no drawing. Squares numbered back and forth (each row runs the other way to the one
  below), our three boards and a random one, and a race: who's where, whose turn, what a roll does, step by step
  (each square walked, a bounce off 100, a ladder, a snake, the third six, getting home).
  - `problems()` checks a board can be read: every end on its own square, never the start or home; snakes down and
    ladders up, each to another row; no two ladders (or two snakes) crossing or lying close alongside; no end hidden
    under the other kind.
  - `expectedRolls()` works out exactly how many rolls one player needs, on average, to get home on a board.
  - `randomBoard()` places eight ladders and eight snakes one at a time where each fits, and keeps the layout only if it's
    as quick a race as our own boards (27 to 35 rolls each).
- `draw.ts`: the board on a 2D canvas. Squares, numbers, ladders and snakes are painted once into a canvas of their own; each
  frame copies it and draws the tokens and the die. Snakes are curvy, patterned (bands, diamonds or spots) and tapered,
  with a head, eyes and a forked tongue; ladders are wooden, with rungs. Tokens are discs in player colours with their
  number, side by side when they share a square, the one whose turn it is ringed.
- `main.ts`: lobby, the race, pause, results, saved records, the phones. A roll plays out as a list of moves: the die
  tumbles, the token hops square by square, climbs a ladder rung by rung or slides down a snake along its body. Callouts
  for the big moments ("Up 36!", "Down 57!", "Bounce!", "Three sixes!"). Computer players roll after a short beat; once no
  person is still racing, they finish at triple speed.

## The boards

Our own layouts, all passing `problems()`:

| Board | | Ladders | Snakes | Rolls each to get home, on average |
|---|---|---|---|---|
| Meadow | Gentle | 9 | 7, small | 28 |
| Jungle | Even | 8 | 8 | 30 |
| Temple | Wild: huge climbs, huge falls | 7 | 9 | 35 |
| Random | A new fair layout every game | 8 | 8 | 27–35 |

## Rules (lobby settings)

- **Computer players**: 0 to 3, always at least one other token on the board.
- **Exact roll to finish** (on): land on 100 exactly; roll too many and you bounce back off it.
- **Six rolls again** (on): a 6 gives another roll; three 6s in a row and you go back to where that turn began.
- **Play for**: every place (play on until one is left) or the win (stop at the first one home; the rest are placed by
  how far they got).

The turn order is random each game, and shown on the right with everyone's square.

## Competition

**Party**

One race; a quick one between bigger games. Stars for playing, more for winning, and a podium for second or
third with three or more on the board. The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Snakes and Ladders comes from the old Indian game Moksha Patam, and the name is generic. **"Chutes and Ladders" is a trademark** of an American edition: we never use it. Our own board, snakes and ladders (their places are ours, not copied from a printed board). See [Originality](../README.md#originality).

## First playable: done

- [x] A 10x10 board with our own snakes and ladders
- [x] Rolls, moving, climbing and sliding, animated
- [x] Computer players to fill in
- [x] Exact roll to finish, as a setting
- [x] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [x] A manual (`manual.json`): what it is, how you win, how to play, tips
- [x] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [x] Two keyboard players can play it too (they come free with `Input`)

Also built: three boards and a random fair one, six rolls again (and the three-sixes rule) as a setting, playing on for
every place, saved records per player (wins, podiums, ladders, snakes, the longest slide).

## Later

- A big-group mode with teams (more than four phones: the rest watch for now)
- A board theme or two in the shop (looks only)

## Notes

2D, `"needs": "light"`. All on the TV; the phone only rolls.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
