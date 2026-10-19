# Grand Prix

Open-wheel racing: qualifying, pit stops, championship · 1–4 players · Racing · **coming soon**

Open-wheel single-seaters: downforce, tyre choice and pit strategy. Arcade-friendly handling with assists you can switch off, and a proper race weekend.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), Bolt, Drop, Leaf, Star, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving | In the pits |
|---|---|---|
| Bolt | Throttle | Confirm tyres |
| Drop | Brake | Change tyre compound |
| Leaf | Overtake boost (limited) | — |
| R1 | Look behind | — |
| L1 | Pit request | — |
| Stick | Steer | Choose |

## Competition

**Exhibition** · **Race weekend** · **Championship** · **Career**

Weekend: practice, three-part knockout qualifying (Q1/Q2/Q3), race with a mandatory pit stop. Championship: points for the top 10 (25-18-15-12-10-8-6-4-2-1) plus a point for fastest lap, drivers' and teams' tables. Career: sign for a back-of-the-grid team and earn your way up.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One circuit, one car
- [ ] Handling with downforce (faster corners at speed)
- [ ] Tyres that wear; one pit stop
- [ ] Qualifying sets the grid; a race to the flag
- [ ] Phones show what each button does (`input.show`); Drop in the lobby goes back to the games (`backToHub`)
- [ ] A manual (`manual.json`): what it is, how you win, how to play, tips
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- A calendar of circuits
- Weather and intermediate/wet tyres
- Safety car
- Car setup

## Notes

3D. Split screen with `renderer.setScissor`; AI cars follow a racing line baked per track.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
