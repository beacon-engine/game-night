# 🏙️ Rooftop Brawl

Platform fighter: knock them off the roof · 2–4 players · **coming soon**

Smash-style: the more damage you take the further you fly. Knock everyone off the rooftops.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting |
|---|---|
| ✕ | Attack (direction from the stick) |
| ○ | Jump (twice in the air) |
| □ | Special |
| L1 | Shield / dodge |
| R1 | Grab |
| Stick | Move |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One rooftop stage with platforms
- [ ] Damage percent and knockback
- [ ] Stocks (3 lives)
- [ ] 2–4 players
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- More stages
- Items
- Characters with different moves

## Notes

Side view, 3D models or sprites.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
