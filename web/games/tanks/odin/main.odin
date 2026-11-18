// Tanks's rules and physics, to be compiled to WebAssembly (sim.wasm; `make wasm` from the
// repo root). This is a starter: it builds, and does nothing yet. Pinball (../../pinball/odin) is
// the worked example: how its State is shared with the page (pinball/sim.ts reads it), how
// step() runs the physics in small substeps, and how events tell the page what to play and draw.
//
// The idea: up to eight tanks in an arena whose walls break. Each tank has a position, a hull
// angle, a turret angle and health; shells fly and bounce; walls are a grid of blocks with hit
// points. Players: x/y on the stick drive, the turret aims, Bolt fires.
package tanks

import "base:runtime"

TICK       :: 1.0 / 60.0
MAX_EVENTS :: 32

Vec2 :: [2]f32

// What happened during the last step(), for the page's sounds and effects
Event_Kind :: enum i32 {
	None,
}

Event :: struct {
	kind:  Event_Kind,
	pos:   Vec2,
	value: i32,
}

// Everything the page needs to draw a frame. Keep every field 4 bytes wide (f32, i32, u32, b32,
// or arrays and structs of them) so the page can read them one after the other.
State :: struct {
	time:        f32,
	// tanks:  [MAX_TANKS]Tank,  // pos, hull angle, turret angle, health, alive
	// shells: [MAX_SHELLS]Shell,
	// walls:  [ARENA_W * ARENA_H]i32, // hit points left per block (0: gone)
	event_count: i32,
	events:      [MAX_EVENTS]Event,
}

state: State

@(export)
setup :: proc "c" (seed: u32) {
	context = runtime.default_context()
	state = {}
}

// Advance 1/60 s
@(export)
step :: proc "c" () {
	context = runtime.default_context()
	state.event_count = 0
	state.time += TICK
}

@(export)
state_ptr :: proc "c" () -> rawptr {return &state}
@(export)
state_size :: proc "c" () -> i32 {return size_of(State)}

push_event :: proc(kind: Event_Kind, pos: Vec2, value: i32 = 0) {
	if state.event_count >= MAX_EVENTS {
		return
	}
	state.events[state.event_count] = {kind, pos, value}
	state.event_count += 1
}
