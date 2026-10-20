# Snakes and Ladders

Climb the ladders, dodge the snakes · 1–6 players · Board · **coming soon**

Roll and move up a numbered board. A ladder carries you up; a snake slides you down. First to the last square wins. Pure luck: perfect for small children and big groups.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| Bolt | Roll |

## Competition

**Party**

One race; a quick one between bigger games.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Snakes and Ladders comes from the old Indian game Moksha Patam, and the name is generic. **"Chutes and Ladders" is a trademark** of an American edition: we never use it. Our own board, snakes and ladders (their places are ours, not copied from a printed board). See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] A 10x10 board with our own snakes and ladders
- [ ] Rolls, moving, climbing and sliding, animated
- [ ] Computer players to fill in
- [ ] Exact roll to finish, as a setting
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Several boards
- A big-group mode with teams

## Notes

2D. All on the TV; the phone only rolls.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
