# City Runners

Race the rooftops together; the drone takes the slowest · 1–4 players · Arcade · **playable**

An endless three-lane runner over city rooftops and an elevated rail line. Everyone picks a runner and runs the same
course at the same time on one screen: last one running wins. On your own it's a run for distance.

## Controls

Every game uses the same phone pad. Here the phone shows the d-pad: one tap, one move (`controls.json`).

| Button | Running |
|---|---|
| ◀ ▶ (or arrow keys) | Change lane |
| ▲, or Bolt | Jump (grab a zip line on the way up) |
| ▼, or Drop | Slide (in the air: drop straight down; on a zip line: let go) |

## Runners and routes

**Six runners** (`runners.json`), real people in running kit, animated with motion capture (`people.ts`; the models
and how they were made: [`source/README.md`](source/README.md)). Each is good at something and pays for it, compared
with Rio, the all-rounder:

| | Agility (lane changes) | Spring (jump) | Grit (stumbles) | Reach (coins) |
|---|---|---|---|---|
| Rio | 1 | 1 | 1 | 1 |
| Kemi | 0.92 | **1.14** | 1 | 1 |
| Dash | **1.3** | 0.94 | 0.95 | 1 |
| Tunde | 0.88 | 0.95 | **1.4** | 1 |
| Ava | 1 | 1 | 0.85 | **2.2** (the next lane over) |
| Zara | 1.15 | 1.06 | 0.78 | 1 |

They're picked, not bought: the shop only sells looks (a suit replaces the runner's top; trails).
Shoes are always in the player's colour. The computer runners are the runners nobody picked.

**Crossings**: some gaps have three ways across, one in each lane, so each runner chooses how much to risk:

| | Speed (vs running) | The risk |
|---|---|---|
| Zip line | 1.3× | You have to jump to grab it. Miss and you fall. |
| Thin rail | 0.72× | Can't be missed, but you lose ground (and the drone takes anyone 24 m behind). Step off it and you fall. |
| Ropes | 1.25× on the rope | Jump onto the first. On each, press ▲ in the last 40% of the swing to fly to the next; earlier, or holding on to the end, and you fall. Spring throws you further. |

In simulation (computer runners, Sky Bridges) a crossing takes 0.78× the time of running it on the zip line, 0.94×
on the ropes and 1.42× on the rail; letting go of a rope in the last 40% of its swing always reaches the next.

**Three routes** (`ROUTES` in `course.ts`): **Rooftops** (dusk into night, a bit of everything), **The Rail Line** (at
night, mostly trains, more of them coming at you) and **Sky Bridges** (sunrise into day, gaps too wide to jump, so beams
and zip lines).

## How it works

- **The course** (`course.ts`) is made up from a seed as the runners go: roofs with rows of barriers (jump), signs and
  pipes (slide), vent stacks (go round); gaps between roofs; the rail line, with standing trains (some with a ramp up
  onto their roofs) and now and then one coming the other way; and gaps too wide to jump, crossed on a beam or a zip
  line. Every row has a way through. "Today's course" is the same seed all day, so distances can be compared.
- **The run** (`run.ts`): everyone runs at the course's speed, which rises over the run. Runners pass through each
  other; coins and power-ups go to whoever gets there first. Hit a barrier, or the side of something while changing
  lanes, and you stumble: you drop back and the **security drone** comes after you for 7 s (less with more grit). Stumble again while it's
  there, or fall more than 24 m behind the leader (off the back of the screen), and it has you. Run into the front of
  a vent stack or a train and you're out; so is falling into a gap.
- **Power-ups**: magnet (pulls coins in), jump boots (high enough to land on a train), shield (saves you once,
  from a crash or a fall), double (twice the score).
- **Score**: a point a metre, 5 a coin, all doubled with the double. Distance decides records; the score is for show.
- **Computer runners** (0–3) fill in, and run behind the lobby. Once every person is out the run ends; computer
  runners still going are ranked as having lasted longer.

### One shared view, not a split screen

All runners share one camera that sits behind whoever is at the back and keeps the leader in shot. Everyone runs at
the same speed, so the pack only spreads out when someone stumbles, and the rule that the drone takes anyone 24 m
behind keeps it on screen. That means a big, readable picture on a TV instead of four small ones, one render a frame
instead of four (it holds 30 fps on a TV), and you can see who's about to grab the coins in front of you.

## Saved

Per player (`gameSaves()`, by phone): runs, wins, best distance, best score, coins collected, and the runner, suit and
trail they last ran with. The furthest run anyone has made (`best-run`). Stars: for running, for winning (against someone), and
for a new personal best.

## Shop

`shop.json`: suits and trails, looks only. Before the run everyone picks their runner (◀▶), and a suit (▲▼) or trail
(Leaf) if they own one.

## Originality

Endless runners go back to the early 2000s, and the three-lane kind became popular on phones in the 2010s. Ours has
its own name, its own runners (CC0 bodies and motion capture, in our kits), light trails, rooftops and a rail line,
and a security drone; no train yard, no graffiti, no chasing guard and dog, and it's played together on one screen. The
city is drawn in code. See
[Originality](../README.md#originality).

## First playable: done

- [x] Course from a seed: roofs, gaps, rail line, trains, ramps, beams and zip lines, coins, power-ups
- [x] Lanes, jump, slide, stumbles, the drone
- [x] 1–4 people on one screen, computer runners, standings along the top, a tag over each runner
- [x] Six runners with different strengths, animated people; three routes
- [x] Saved records, stars, a shop
- [x] A manual (`manual.json`), menus and HUD in the brand, keyboard players

## Next

- Missions ("collect 50 coins in one run") and a daily course leaderboard
- More scenery along the way: a bridge over the river, a station
- Sounds: footsteps, the trains
