# ✈️ Dogfight

Planes in the sky, last one flying · 1–8 players · **coming soon**

Arcade planes over the sea and the city. Loop, barrel roll, get on someone's tail.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Flying |
|---|---|
| ✕ | Guns |
| ○ | Missile (needs a lock) |
| □ | Flares |
| L1 | Barrel roll left |
| R1 | Barrel roll right |
| Stick past the ring | Afterburner |
| Stick | Pitch and turn |

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Sky with ground and sea
- [ ] Plane handling that's easy to fly
- [ ] Guns, hits, respawn
- [ ] Free-for-all to 10
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Teams
- Ground targets
- Split screen

## Notes

3D. With many players, a shared wide camera or split screen.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
