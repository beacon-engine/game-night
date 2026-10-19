# Stock Cars

Oval racing: drafting, bump-and-run, last-lap moves · 1–4 players · Racing · **coming soon**

Heavy cars, high banks, three wide. The draft is everything: line up behind someone and you both go faster. Bump-drafting, cautions, restarts and a lot of last-lap drama.

## Controls (a first plan)

Every game uses the same phone pad: a stick (pushed past its ring = sprint), ✕ ○ □ △, L1, R1, and a swipe
across a button. This is what each does here; it goes into `controls.json` once the game exists, and the
phone dims the buttons a situation doesn't use.

| Button | Driving |
|---|---|
| ✕ | Throttle |
| ○ | Brake |
| □ | Pit road (under caution) |
| R1 | Spotter: who is beside me |
| Stick | Steer |

## Competition

**Exhibition** · **Race weekend** · **Championship** · **Playoffs**

Weekend: single-car qualifying, then a race in stages with stage points. Season: points for every finishing position plus stage points; the top drivers enter elimination playoff rounds, and the last four race for the title in the final round.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## First playable

What it needs before `index.html` goes in and it shows up as playable on the game select page:

- [ ] One oval with banking
- [ ] Drafting (pack speed)
- [ ] Contact that bumps, not wrecks, unless it's hard
- [ ] Cautions and restarts; checkered flag
- [ ] Phones show what each button does (`input.show`); ○ in the lobby goes back to the games (`backToHub`)
- [ ] Menus and HUD use the brand (`/brand/brand.css`, see [brand/README.md](../../brand/README.md))
- [ ] Two keyboard players can play it too (they come free with `Input`)

## Later

- Short tracks, superspeedways and a road course
- Stage racing
- Damage and pit repairs
- Overtime finish

## Notes

3D, chase and roof cameras. Pack racing with 20+ AI cars needs cheap AI: follow lanes, react to the car ahead.

See [Building a game](../README.md) for how a game folder works and how to run it while you work on it.
