# Fighters

1-v-1 fighting: combos, blocks, specials · 1–2 players · Action · **coming soon**

A 2D-plane fighting game with a small cast. Light and heavy attacks chain into combos; each fighter has two specials.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting |
|---|---|
| Bolt | Light punch |
| Drop | Heavy punch |
| Leaf | Light kick |
| Star | Heavy kick |
| L1 | Block (hold) |
| R1 | Special |
| Swipe across Star | Super (when the bar is full) |
| Stick | Move, jump (up), crouch (down) |

## Competition

**Arcade ladder** · **Tournament** · **Ranked**

Arcade: beat the AI cast in order to the final boss. Tournament: double-elimination bracket like a real fighting-game event. Ranked: a rating per player that moves after each fight.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Fighting games are a genre; no characters, moves, stages or names from Street Fighter, Tekken or others. See [Originality](../README.md#originality).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Two fighters, one stage
- [ ] Attacks with hitboxes, hit stun, blocking
- [ ] Health, a super bar, best of 3 rounds
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More fighters
- Combo trainer
- Arcade mode against the AI

## Notes

Side view; 3D models on a 2D plane, or 2D sprites. Inputs need to feel instant: read the pad every frame.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
