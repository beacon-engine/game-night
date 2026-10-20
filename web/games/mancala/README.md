# Mancala

Sow the seeds, capture the most · 1–2 players · Board · **coming soon**

Two rows of pits filled with seeds. Pick up all the seeds in one of your pits and sow them one by one around the board; capture by making the right count in your opponent's pits. Most seeds wins.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| ◀▶ | Choose one of your pits |
| Bolt | Sow |

## Competition

**Exhibition** · **Ladder**

One game, or a ladder through the evening.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Mancala is the name of the whole family of sowing games, played for centuries across Africa and beyond. We start with **oware**, played across West Africa, known in Nigeria as **ayo** (ayò, in Yoruba): two rows of six pits, four seeds in each, capture on twos and threes. All free to use; we avoid any one company's trademarked edition and its name. Our own board and seeds. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] The oware/ayo board and rules: sowing, skipping the starting pit, captures of 2 and 3, feeding a player who has no seeds
- [ ] Seeds that drop one by one, counted out loud on screen
- [ ] A computer opponent at three strengths
- [ ] The end: more than half the seeds, or the board stuck
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Other sowing games as variants
- Saved records

## Notes

2D. Small state: the computer can search deep.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
