# Street Racing

Across the city at night, any way you like, through the traffic, with the police on your tail · 1–4 players · Racing · **playable**

A race from one corner of a city to the far one: from Central Station down to the Harbour, from Market Square out
to the Airport, from the Old Town up to Uptown. There's no set route. The city is a real grid of avenues, streets
and alleys (some of them shortcuts through the blocks), with a river across it and only a few bridges, so how you
get there is yours to choose: the quickest way, a gamble down an alley, or round the jam at the lights. Traffic
drives every street and stops at the lights; people walk over the crossings while it's red; run a red and the
police come after you, and if they catch you they pull across in front of you and hold you there.

Pick a race, the weather, how many computer drivers, how busy the streets are and how quick the drivers are in
the lobby (`cities.json`); after Start, everyone picks a car on their phone (`cars.json`): the Sovereign, Goblin,
Cheetah, Abyss, Stinger, Nomad, Kiri or Azura, each with its own speed, pick-up, grip and weight.

## Controls

The racing pad, like [Stock Cars](../stock-cars): slide to steer, with gas and brake pedals (`controls.json`).

| Button | Driving |
|---|---|
| Steering slider, stick, or arrows / A D | Steer |
| Bolt (or up / W) | Gas (hold) |
| Drop (or down / S) | Brake (hold); stopped, it backs up |
| Star | Boost (hold, while the meter lasts) |
| R1 | Look back (hold) |

## On the screen

- **Where you are**: your place, and how far it is to the finish by the quickest way from where you are now.
- **The next turn** (bottom): `Left in 120 m`, `Right now`, `Straight on`, `Turn round`: the quickest way, worked out
  again all the time, so it follows you whichever way you go.
- **The map** (top right): the whole city (avenues wider, alleys fainter, the river, the park), the quickest way
  from where you are in yellow, the finish 🏁, everyone (you: an arrow the way you're pointing), and the police.
- **Who's who**: the name and place of every racer in sight, over their car.
- **POLICE**, flashing red and blue, while they're after you (and how long you're held when they catch you).
- The boost meter, and: Near miss, Ran a red light, Spun round!, Lost the police, New record.

Out in the city: the lights at every junction, the green signs before the big junctions pointing the quickest way
to the finish and how far it is, the banners at the start and the finish, the landmark past the finish (the
harbour's cranes, the airport, the tallest tower in town) and, at night, everyone's headlights on the road.

## How it works

| File | |
|---|---|
| `cities.json` | The races: a city each (from a seed, so it's the same every time), how many blocks across and down, where it starts and finishes, dusk or night, what's at the finish. |
| `city.ts` | The city as numbers: the grid of junctions and streets (avenues, streets, alleys cut through some blocks, bridges), a few streets closed (never leaving a dead end or cutting the city in two), the blocks, the river, the park; what's solid; how far every junction is from the finish (and so the quickest way from anywhere); the lights' cycle at each junction. No graphics. |
| `drive.ts` | The driving, no graphics: cars on the ground with a heading and a velocity, the tyres' grip, sliding, spinning; the kerbs and the other cars to hit; the computer drivers, the traffic, red lights run, the police. |
| `scene.ts` | The city in three.js, built from the plan: roads and their markings, junctions with zebra crossings and lights, pavements, buildings with lit windows and shops, trees, lamps, bus stops, signs, the river and bridges (the middle one a suspension bridge), the banners, the landmark, the skyline, planes, the helicopter; the cars with their headlights, the people crossing, the police lights; the cameras. |
| `cars.json` | The cars to pick, from the [car library](../../cars/README.md), and the traffic. |
| `main.ts` | Lobby, picking cars, countdown, race, results, records; the boost, the computer drivers' pace, the HUD (map, next turn, name tags, police), the phones, the siren. |

### The rules of the road

- **The walls are the kerbs**: everything off the road is block (pavement and buildings), the river is solid but for
  the bridges. Hit a kerb or a car hard enough and you spin.
- **Traffic** drives on the right, turning wherever it likes at each junction, keeping its distance and stopping at
  red lights. It's heavy: hit it and you lose up to half your speed; a bump with another racer costs you both a bit.
- **The lights**: each junction's cycle is 22 s, each at its own point in it: 9 s green and 2 s amber one way while
  it's red the other, then the other way round. While it's red for a street, people walk over its crossings (and step
  back to the kerb if a car's bearing down on them).
- **Run a red** (into the junction on red, after the first 6 s of the race) and the police come from a junction
  behind you, faster than anything you can drive. Keep within 7.5 m of them for under a second (or get rammed) and
  you're caught: they pull across in front of you and hold you for 5 s, then drive off. Get 380 m away, or keep clear
  for 40 s, and they give up. One police car: it goes after whoever ran the last red, a person before a computer driver.
- **Computer drivers** take the quickest way (now and then the second quickest), pass what's slow when the other side
  of the street is clear, stop at most reds (they chance about one in three), and don't let you get away: one behind
  the leading person gets up to 16% more speed, one far ahead eases off.
- **The boost**: shaving past traffic (under 1.8 m between you, going 12 m/s or more) fills a quarter of it; sitting
  close behind another racer fills it slowly.

In simulation (six computer drivers, 40 traffic cars, each city) everyone gets to the finish in 1–4 minutes, the
police catch about half the people they chase, and nobody gets stuck.

Saved: each driver's races, wins, podiums, best time and last car, and each city's record.

The cars, traffic, police car, plane and helicopter are from the [car library](../../cars/README.md) (credits
there); the people on the crossings are the shared cast ([`web/people/`](../../people/README.md)); everything else
is drawn in code.

## Competition

**Exhibition** (now) · **Cup** · **Career**

Cups of 4 races, points per position. Career: win races to unlock cars and districts.

The formats (and how standings, brackets and seasons work in every game) are in
[COMPETITIONS.md](../COMPETITIONS.md).

## Originality

Street racing games are a genre. Our own name, cities, cars and look; no real cities' landmarks, car makers, or
another series' names, logos or heat/police systems. See [Originality](../README.md#originality).

## Next

- Tunnels and an elevated expressway; roadworks closing a street for a race
- Leaf as a handbrake, for the right-angled corners
- Cups and a career
