# Ludo

Roll a six, race round, send them home · 2–4 players · Board · **coming soon**

Two to four players race four pieces each around a cross-shaped board. Roll a six to come out; land on someone to send them back home.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Playing |
|---|---|
| Bolt | Roll; move the chosen piece |
| ◀▶ | Choose which piece to move |

## Competition

**Party** · **Cup**

One race, or first to 3 wins.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Ludo is the generic English name of a family that goes back to the Indian game Pachisi. Other modern editions have trademarked names (such as Parcheesi or Sorry!): we use none of them. Our own board, colours (the players' colours) and pieces. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] The board for 2 to 4, four pieces each
- [ ] Six to come out, sending pieces home, the home column
- [ ] Computer players to fill empty colours
- [ ] Everyone sees whose turn it is on their phone
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- House rules as settings (a six rolls again, safe squares)
- Teams of two

## Notes

2D. Good with lots of people: turns are short and everyone watches the TV.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
