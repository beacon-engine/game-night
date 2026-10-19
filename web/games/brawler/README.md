# 👊 Street Brawler

Co-op beat-'em-up through the streets · 1–4 players · **coming soon**

Walk right, beat up gangs together. Grab, throw, pick up weapons, and save the special for when you're surrounded.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting |
|---|---|
| ✕ | Attack (combo by repeating) |
| ○ | Jump |
| □ | Grab / throw |
| △ | Special (costs health) |
| R1 | Pick up / use item |
| Stick | Walk (depth too) |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One street level that scrolls
- [ ] Up to 4 players, 2 enemy types and a boss
- [ ] Combos, grabs, knockdowns
- [ ] Lives and continues
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More levels (market, motor park, rooftop)
- Weapons
- Character select

## Notes

2.5D: 3D characters, side-on camera that follows the group.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
