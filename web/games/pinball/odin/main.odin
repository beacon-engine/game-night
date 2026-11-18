// Pinball's table and rules, compiled to WebAssembly (sim.wasm; `make wasm` from the repo root).
//
// The page (main.ts) calls the procedures marked @(export) below, and reads `state` and `table`
// straight out of the wasm memory: sim.ts goes through their fields in the order they're declared
// here, so change a struct here and change its reader there (the sizes are checked when it loads).
//
// Everything is in table units: the table is 520 wide and 1000 tall, y pointing down the table
// towards the flippers. One step() is 1/60 s.
package pinball

import "base:runtime"

TICK       :: 1.0 / 60.0
SUBSTEPS   :: 8 // physics steps per tick: short enough that a fast ball can't jump through a wall
MAX_EVENTS :: 32

// What happened during the last step(), for the page's sounds, sparks and callouts
Event_Kind :: enum i32 {
	None,
	Bumper,           // value: which bumper
	Sling,            // value: 0 left, 1 right
	Wall,             // value: how hard (the speed into the wall)
	Flipper_Hit,      // value: how hard
	Flip,             // value: 0 left, 1 right
	Lane,             // value: which top lane
	Lanes_Complete,   // value: the new bonus multiplier
	Target,           // value: which target
	Targets_Complete, // value: the points
	Launch,           // value: how hard, 0..100
	Ball_Saved,
	Tilt_Warning,
	Tilt,
	Drain,            // value: the end-of-ball bonus paid (0 after a tilt)
}

Event :: struct {
	kind:  Event_Kind,
	pos:   Vec2,
	value: i32,
}

Phase :: enum i32 {
	In_Lane, // in the plunger lane, waiting to be launched
	In_Play,
	Drained, // gone: the page ends the turn and calls start_ball() for the next one
}

// Everything the page needs to draw a frame and run the game. Every field is 4 bytes wide, so
// there's no padding between them and sim.ts can read them one after the other.
State :: struct {
	ball:          Vec2,
	ball_vel:      Vec2,
	flipper_angle: [2]f32,       // radians, as drawn: the direction from each pivot to its tip
	plunger:       f32,          // 0..1: how far it's pulled back
	tilt_meter:    f32,          // up with every nudge, down over time (see rules.odin)
	ball_save:     f32,          // seconds left: drain before then and the ball comes back
	phase:         Phase,
	tilted:        b32,
	score:         i32,          // this ball's points (the page adds them to the player's total)
	bonus:         i32,          // paid at the end of the ball, times the multiplier
	multiplier:    i32,
	lanes:         u32,          // a bit per top lane that is lit
	targets:       u32,          // a bit per target that has been hit
	bumper_glow:   [BUMPERS]f32, // 1 when hit, fading to 0
	sling_glow:    [2]f32,
	event_count:   i32,
	events:        [MAX_EVENTS]Event,
}

// What the player is pressing right now
Controls :: struct {
	left, right, launch: bool,
}

state:    State
table:    Table
controls: Controls
autoplay: bool // the computer plays (behind the lobby)

// Build the table. Call once, before anything else.
@(export)
setup :: proc "c" (seed: u32) {
	// Odin procedures get an implicit `context` (allocators, logger...). Ones called from
	// JavaScript ("c" procedures) don't, so they set one up before calling into the rest.
	context = runtime.default_context()
	rng_state = seed | 1
	build_table(&table)
	reset_ball()
}

// A new ball in the plunger lane, with this ball's score, bonus and lights back to zero
@(export)
start_ball :: proc "c" () {
	context = runtime.default_context()
	reset_ball()
}

@(export)
set_controls :: proc "c" (left, right, launch: i32) {
	controls = {left != 0, right != 0, launch != 0}
}

// Shove the table; (dx, dy) is the direction, up to length 1
@(export)
nudge :: proc "c" (dx, dy: f32) {
	context = runtime.default_context()
	nudge_table({dx, dy})
}

@(export)
set_autoplay :: proc "c" (on: i32) {
	autoplay = on != 0
}

// Advance 1/60 s
@(export)
step :: proc "c" () {
	context = runtime.default_context()
	state.event_count = 0
	if state.phase == .Drained {
		return
	}
	if autoplay {
		autoplay_controls()
	}
	press_buttons(TICK)
	for _ in 0 ..< SUBSTEPS {
		physics_step(TICK / SUBSTEPS)
	}
	after_step(TICK)
}

// Where `state` and `table` are in the wasm memory, and how big they are (sim.ts checks)
@(export)
state_ptr :: proc "c" () -> rawptr {return &state}
@(export)
state_size :: proc "c" () -> i32 {return size_of(State)}
@(export)
table_ptr :: proc "c" () -> rawptr {return &table}
@(export)
table_size :: proc "c" () -> i32 {return size_of(Table)}

push_event :: proc(kind: Event_Kind, pos: Vec2, value: i32 = 0) {
	if state.event_count >= MAX_EVENTS {
		return
	}
	state.events[state.event_count] = {kind, pos, value}
	state.event_count += 1
}
