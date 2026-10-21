# City Runners

Race the rooftops together; the drone takes the slowest · 1–4 players · Arcade · **playable**

An endless three-lane runner over city rooftops and an elevated rail line, at dusk turning to night. Everyone runs the
same course at the same time on one screen: last one running wins. On your own it's a run for distance.

## Controls

Every game uses the same phone pad. Here the phone shows the d-pad: one tap, one move (`controls.json`).

| Button | Running |
|---|---|
| ◀ ▶ (or arrow keys) | Change lane |
| ▲, or Bolt | Jump (grab a zip line on the way up) |
| ▼, or Drop | Slide (in the air: drop straight down; on a zip line: let go) |

## How it works

- **The course** (`course.ts`) is made up from a seed as the runners go: roofs with rows of barriers (jump), signs and
  pipes (slide), vent stacks (go round); gaps between roofs; the rail line, with standing trains (some with a ramp up
  onto their roofs) and now and then one coming the other way; and gaps too wide to jump, crossed on a beam or a zip
  line. Every row has a way through. "Today's course" is the same seed all day, so distances can be compared.
- **The run** (`run.ts`): everyone runs at the course's speed, which rises over the run. Runners pass through each
  other; coins and power-ups go to whoever gets there first. Hit a barrier, or the side of something while changing
  lanes, and you stumble: you drop back and the **security drone** comes after you for 7 s. Stumble again while it's
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

Per player (`gameSaves()`, by phone): runs, wins, best distance, best score, coins collected, and the outfit and trail
they last wore. The furthest run anyone has made (`best-run`). Stars: for running, for winning (against someone), and
for a new personal best.

## Shop

`shop.json`: suits and trails, looks only. Anyone who owns something picks their look before the run (◀▶ suit, ▲▼ trail).

## Originality

Endless runners go back to the early 2000s, and the three-lane kind became popular on phones in the 2010s. Ours has
its own name, runners in helmets with light trails, rooftops and a rail line at night, and a security drone; no train
yard, no graffiti, no chasing guard and dog, and it's played together on one screen. Everything is drawn in code. See
[Originality](../README.md#originality).

## First playable: done

- [x] Course from a seed: roofs, gaps, rail line, trains, ramps, beams and zip lines, coins, power-ups
- [x] Lanes, jump, slide, stumbles, the drone
- [x] 1–4 people on one screen, computer runners, standings along the top, a tag over each runner
- [x] Saved records, stars, a shop
- [x] A manual (`manual.json`), menus and HUD in the brand, keyboard players

## Next

- Missions ("collect 50 coins in one run") and a daily course leaderboard
- More scenery along the way: a bridge over the river, a station
- Sounds: footsteps, the trains
