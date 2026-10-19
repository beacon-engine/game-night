# Competitions

Every game can be played as a one-off, but game night is better with something at stake: a league that
runs for weeks, a cup final, a championship that goes down to the last race. This is the shared plan, so
every game's competitions work the same way, look the same, and are built once in the platform.

**Status: planned.** Nothing here is built yet. Football is the first game to get it (League and Cup);
each game's README says which formats it will use.

## Formats

| Format | What it is | Used by |
|---|---|---|
| **Exhibition** | One match or race, nothing saved. Every game has it. | all |
| **League** | Everyone plays everyone (once, or home and away). A table decides it. | team sports, team action games |
| **Cup** | Knockout bracket. Seeded, byes for odd numbers, the game's tie-breaker for draws (penalties, super over, golden goal...). Optionally two legs. | most |
| **Groups + knockout** | Groups play a mini league, the top N go into a cup. | football, cricket, table tennis, basketball |
| **Series** | Best of N between two sides (baseball playoffs). | baseball |
| **Race weekend** | One event in stages: practice, qualifying (sets the grid, possibly in knockout parts), sprint, race. | racing |
| **Championship** | A season of events (races, rounds, tournaments) with points per finishing position, adding up to a table. | racing, tour sports, danfo rush |
| **Playoffs** | A championship whose last rounds eliminate drivers until a few race for the title. | stock cars |
| **Tour** | A season of tournaments with ranking points (tennis, beach volleyball). | long tennis, volleyball |
| **Title fight / Career** | Rankings per weight class or class of car/bike; challenge the champion, win the belt, defend it. Career: one player's path from the bottom. | boxing, racing, fighters |
| **Ladder** | Challenge someone up to two places above you; win and you swap. Runs forever. | pool, air hockey |
| **Tournament (fighting games)** | Double elimination: you're out after two losses. | fighters, rooftop brawl |
| **Arcade** | Credits and continues, a high-score table with initials. | arcade games |
| **Party** | Short rounds, first to N wins. | party and arcade games |
| **Game Night Cup** | Across games: the evening as a decathlon. Points for placings in each game played tonight, one overall table. | the hub |

## What a game decides

A game declares the formats it supports and their rules in a `competitions.json` next to its
`game.json`, so they can be tuned without code (like `controls.json`):

```json
{
  "formats": ["exhibition", "league", "cup", "groups"],
  "league": { "win": 3, "draw": 1, "loss": 0, "tiebreak": ["points", "goalDifference", "goalsFor", "headToHead"] },
  "cup": { "draw": "penalties", "legs": 1 }
}
```

```json
{
  "formats": ["exhibition", "weekend", "championship", "career"],
  "weekend": ["practice", "qualifying:Q1,Q2,Q3", "race"],
  "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  "bonus": { "fastestLap": 1 }
}
```

Points tables are data, so a game can offer several (a sprint race scores less than the main race).

## Entrants

An entrant is a human (a phone, by player slot and name), a team of humans, or an AI side (a club,
a rider, a car). Mixed is normal: two friends in a 16-team league with the rest played by the AI.
Matches between two AI sides can be simulated instantly so the table moves without watching them.

## Saved between nights

A league or season is saved on the machine running Game Night, in the user folder
(`<user folder>/saves/<game>/<competition>.json`), so you can continue next week. The server stores and
lists saves; it doesn't need to understand them.

## How it looks

Built once, with the brand (`/brand/brand.css`):

- **Table**: position, entrant (with player chip or club colour), played, won, drawn, lost, for, against, points.
  The leader's row gets the volt bar; promotion/elimination lines are hairlines.
- **Bracket**: rounds left to right, the current tie framed with the volt viewfinder.
- **Grid / start order**: for races, from qualifying.
- **Podium**: the end of a race, a cup final or a season.
- **Next up**: what's being played next and who's in it, so everyone knows when to pick up their phone.

## In the platform (proposed)

```ts
import { Competition } from '@platform';

const comp = await Competition.load('football', 'tuesday-league');   // or Competition.create({...})
const next = comp.next();                    // { stage: 'Round 3', home, away } or a race event
// ...play it...
comp.record(next, { scores: [2, 1] });       // or { order: [...] } for races
await comp.save();
comp.table();                                // standings, already sorted by the game's tie-breakers
```

Plus ready-made screens (`renderTable`, `renderBracket`, `renderPodium`) that any game can drop into its
menus. Once two or three games use it, the hub can show "tonight's standings" for the Game Night Cup.

## Order of work

1. Football: League and Cup, with the platform pieces above (tables, brackets, saves).
2. The first racing game: Race weekend and Championship (points tables, grids).
3. Boxing: Title fights and rankings.
4. The Game Night Cup on the hub.
