# Danfo Rush

Endless run through Lagos traffic · 1–4 players · Racing · **coming soon**

Drive a danfo through rush-hour traffic: switch lanes, pick up passengers, dodge okadas and go-slows. Everyone races on one road.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving |
|---|---|
| ✕ | Horn (clears the lane ahead a bit) |
| ○ | Brake |
| □ | Stop for passengers |
| Stick past the ring | Speed up |
| Stick | Change lane |

## Competition

**Score attack** · **Championship**

Routes as events: points for passengers delivered and position at the end; a season across routes.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] Endless road with lanes and traffic
- [ ] Lane changes and crashes
- [ ] Passengers for points
- [ ] Up to 4 buses on the road
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Routes (Oshodi, CMS, Ojuelegba)
- Conductor calls as sound
- Upgrades

## Notes

3D, camera behind the bus; or split lanes per player.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
