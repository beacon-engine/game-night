# Pinball in Odin

The table and its rules are written in [Odin](https://odin-lang.org) and compiled to WebAssembly
(`../sim.wasm`). The page around it is TypeScript, like every other game: the lobby, turns, drawing,
sound and the phones. This folder is the part you change to change how the game *plays*.

| File | What's in it |
|---|---|
| `main.odin` | What the page can call (`@(export)` procedures), `State` (everything the page reads each frame) and the events |
| `table.odin` | The table: walls, slingshots, targets, top lanes, bumpers, flippers. `build_table()` |
| `physics.odin` | The ball moving and bouncing off walls, bumpers and flippers |
| `rules.odin` | Points, bonus and multiplier, plunger, ball save, nudge and tilt, losing the ball |
| `autoplay.odin` | The computer playing behind the lobby |

## Build it, run it

```sh
brew install odin          # once (Odin, plus the LLVM linker it uses for WebAssembly)
make dev                   # from the repo root: http://localhost:10000
```

While `make dev` runs, saving a `.odin` file rebuilds `sim.wasm` (compile errors show in that terminal):
reload the page to play the change. `make wasm` builds every Odin game by hand. Both build with `-vet -strict-style`, so unused variables and untidy formatting are errors.
`odin check web/games/pinball/odin -target:freestanding_wasm32 -no-entry-point` checks without building.
`sim.wasm` is kept in git, so the rest of Beacon Arcade builds without Odin installed: commit it with your
change.

## How the page and Odin talk

```
main.ts ──▶ sim.ts ──calls──▶ setup(seed)  start_ball()  set_controls(l, r, launch)  nudge(dx, dy)  step()
                    ◀─reads── state (State, every frame) and table (Table, once) straight out of wasm memory
```

- The page calls `step()` 60 times a second. Each step runs the physics in 8 small substeps.
- `State` and `Table` are plain structs. `sim.ts` reads their fields **in the order they're declared**,
  4 bytes each. If you add, remove or reorder a field, make the same change in `readState` / `readTable`
  in `../sim.ts`. If you forget, the page stops with an error saying which struct doesn't match.
- Things that happen (a bumper hit, a lane lit, the ball lost) are pushed as **events**
  (`push_event`). The page reads them after each step to play sounds, throw sparks and show callouts.
  To add one, add it to `Event_Kind` and to `EV` in `../sim.ts`, then react to it in `react()` in
  `../main.ts`.
- The table's counts (`LANES`, `BUMPERS`...) are passed to the page, so adding a bumper is only a change
  here.

## Odin in this code

| You'll see | It means |
|---|---|
| `GRAVITY :: 1400` | A constant. `::` declares something that never changes: constants, types, procedures |
| `x := 3` / `x: f32 = 3` | A variable, with its type worked out, or given |
| `Vec2 :: [2]f32` | A type. Arrays of numbers do maths: `a + b`, `v * 2`, `v.x`, `v.y` |
| `step :: proc() {...}` | A procedure (a function) |
| `s := &state` then `s.score += 1` | `&` takes a pointer; using a pointer's fields works the same as the value's |
| `t: ^Table` | A pointer to a `Table`. `t^ = {}` sets the whole thing |
| `.In_Play` | An enum value; Odin works out which enum from where it's used |
| `for b, i in table.bumpers` | Loop over an array: the value and its index. `for &g in arr` lets you change them |
| `a if cond else b` | Choose one of two values |
| `switch seg.kind { case .Wall: ... }` | No fall-through; every case must be handled |
| `proc "c"` + `@(export)` | Callable from JavaScript. These set up `context` first (see `setup`), because other Odin procedures expect it |

## Game programming in this code

- **Fixed steps.** The game moves forward exactly 1/60 s per `step()`, whatever the screen's frame rate.
  The page catches up with extra steps if a frame is slow. The same inputs always play out the same way.
- **Substeps.** A fast ball moves 50 units in 1/60 s, more than its own size, so it could jump right
  through a wall. Eight substeps keep each move small (and `MAX_SPEED` caps it).
- **Collisions.** Every collision in `physics.odin` works the same way: find the closest point on the
  thing to the ball's centre. If it's nearer than the ball's radius, push the ball back out and remove its
  speed into the surface (`bounce`). `restitution` decides how much of that speed bounces back.
- **Flippers** are surfaces that move. The point the ball touches is moving at `spin × distance from the
  pivot`, and the bounce uses the ball's speed *relative to it*. That's why the tip hits harder than the base.
- **Kickers** (bumpers, slingshots) bounce the ball, then add speed away from the surface.

## Things to try, easiest first

1. **Tune it.** Change `GRAVITY`, `BUMPER_KICK`, `FLIP_UP_SPEED`, `WALL_BOUNCE` or `BALL_SAVE_TIME`,
   then `make wasm` and play. Most of a game's feel comes from numbers like these.
2. **Add a fourth bumper.** Set `BUMPERS :: 4` and add one to `t.bumpers` in `table.odin`. The page draws
   it without any other change.
3. **Move things around.** Change the slingshots, lanes or targets in `build_table()`. Every wall is a
   line from `a` to `b`, in a 520 × 1000 table, with y going down. Watch out for gaps smaller than the
   ball (24 wide), where it can get stuck.
4. **A kickback.** A switch at the bottom of the left outlane that fires the ball back up, once, until
   it's re-lit. Use a sensor like the top lanes (`roll_over_lanes`), a new event, and a light on the page.
5. **Ramps.** The README's first-playable list still wants two. A ramp is a path the ball rides *above*
   the playfield: when the ball enters it, ignore the playfield walls and follow the ramp's walls
   instead, until it drops out at the end. It needs a `layer` on the ball and on each `Segment`.
6. **Multiball.** Make `ball` and `ball_vel` arrays, and loop over them in the physics. The ball only
   drains when the last one is gone. This changes `State`, so update `sim.ts` and `draw.ts` as well.
