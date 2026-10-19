# 🧟 Last Stand

Co-op survival against waves · 1–4 players · **coming soon**

Hold the compound together against waves of shambling creatures. Board up windows between waves, revive each other.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Fighting | Between waves |
|---|---|---|
| ✕ | Fire | Repair / board up |
| ○ | Melee | Buy |
| □ | Reload | — |
| △ | Revive (hold, near a teammate) | Ready |
| R1 | Switch weapon | — |
| Stick | Move and face | Move |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One compound map
- [ ] Waves that grow
- [ ] Shooting, reloading, melee
- [ ] Downed and revive; game over when all are down
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Weapon shop
- More maps
- Boss waves

## Notes

Top-down 3D. Not gory: cartoon creatures, so it stays a family game.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
