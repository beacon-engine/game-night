// The table: its walls, slingshots, targets, top lanes, bumpers and flippers. The page draws
// whatever is here, so changing the layout is only a change to build_table().
package pinball

import "core:math"

WIDTH       :: 520
HEIGHT      :: 1000
MIDDLE      :: 240 // the middle of the playfield (the plunger lane is on the right, past x = 460)
BALL_RADIUS :: 12

LANES        :: 3
BUMPERS      :: 3
TARGETS      :: 3
MAX_SEGMENTS :: 80

Segment_Kind :: enum i32 {
	Wall,
	Sling,  // a slingshot's rubber: kicks the ball away (id: 0 left, 1 right)
	Target, // a standup target (id: which one)
}

Segment :: struct {
	a, b: Vec2,
	kind: Segment_Kind,
	id:   i32,
}

Bumper :: struct {
	pos:    Vec2,
	radius: f32,
}

// The left flipper's numbers; the right one is its mirror image. Angles are in radians, from
// pointing straight across the table; positive points down towards the drain.
Flipper :: struct {
	pivot:       Vec2,
	length:      f32,
	base_radius: f32,
	tip_radius:  f32,
	rest, up:    f32,
}

// Read by sim.ts in this order. The counts come first so the page knows how long the arrays
// below (and State's) are.
Table :: struct {
	lane_count:     i32,
	bumper_count:   i32,
	max_segments:   i32,
	max_events:     i32,
	size:           Vec2,
	ball_radius:    f32,
	plunger_rest:   Vec2, // where the ball sits on the plunger
	plunger_travel: f32,  // how far the plunger (and the ball) go back when it's pulled all the way
	lane_radius:    f32,  // how close the ball has to pass a top lane's switch
	lanes:          [LANES]Vec2,
	bumpers:        [BUMPERS]Bumper,
	flippers:       [2]Flipper,
	segment_count:  i32,
	segments:       [MAX_SEGMENTS]Segment,
}

build_table :: proc(t: ^Table) {
	t^ = {}
	t.lane_count = LANES
	t.bumper_count = BUMPERS
	t.max_segments = MAX_SEGMENTS
	t.max_events = MAX_EVENTS
	t.size = {WIDTH, HEIGHT}
	t.ball_radius = BALL_RADIUS
	t.plunger_rest = {480, 940}
	t.plunger_travel = 36
	t.lane_radius = 16

	// The outside: up the left side, round the top, down the right side of the plunger lane.
	// (The page fills this outline in as the playfield: keep these segments first, joined up.)
	add_segment(t, {20, HEIGHT}, {20, 260})
	ARC_STEPS :: 24
	center := Vec2{260, 260}
	for i in 0 ..< ARC_STEPS {
		a0 := math.PI * (1 + f32(i) / ARC_STEPS)
		a1 := math.PI * (1 + f32(i + 1) / ARC_STEPS)
		add_segment(t, center + 240 * Vec2{math.cos(a0), math.sin(a0)}, center + 240 * Vec2{math.cos(a1), math.sin(a1)})
	}
	add_segment(t, {500, 260}, {500, HEIGHT})

	// The plunger lane's inside wall, and its floor: the plunger
	add_segment(t, {460, 300}, {460, HEIGHT})
	add_segment(t, {460, 952}, {500, 952})

	// Above each flipper: the wall between the outlane (straight down the side to the drain) and
	// the inlane (down onto the flipper), and the slingshot
	add_symmetric(t, {{55, 700}, {55, 830}, {160, 866}}) // (ends over the flipper, so the ball rolls onto it)
	add_symmetric(t, {{100, 700}, {100, 790}, {145, 820}})
	add_symmetric(t, {{100, 700}, {145, 820}}, .Sling)

	// The guides between the top lanes
	for x in ([]f32{165, 215, 265, 315}) {
		add_segment(t, {x, 62}, {x, 108})
	}
	t.lanes = {{190, 88}, {240, 88}, {290, 88}}

	// Standup targets along the left wall
	for i in 0 ..< TARGETS {
		y := f32(470 + 50 * i)
		add_segment(t, {24, y}, {24, y + 32}, .Target, i32(i))
	}

	t.bumpers = {{{175, 330}, 26}, {{305, 330}, 26}, {{240, 415}, 26}}

	left := Flipper {
		pivot       = {155, 880},
		length      = 72,
		base_radius = 10,
		tip_radius  = 6,
		rest        = 0.52,
		up          = -0.45,
	}
	right := left
	right.pivot = mirror(left.pivot)
	t.flippers = {left, right}
}

add_segment :: proc(t: ^Table, a, b: Vec2, kind := Segment_Kind.Wall, id: i32 = 0) {
	if t.segment_count >= MAX_SEGMENTS {
		return
	}
	t.segments[t.segment_count] = {a, b, kind, id}
	t.segment_count += 1
}

// A line through `points` on the left of the table, and its mirror image on the right (id 1)
add_symmetric :: proc(t: ^Table, points: []Vec2, kind := Segment_Kind.Wall) {
	for i in 0 ..< len(points) - 1 {
		add_segment(t, points[i], points[i + 1], kind, 0)
		add_segment(t, mirror(points[i]), mirror(points[i + 1]), kind, 1)
	}
}

mirror :: proc(p: Vec2) -> Vec2 {
	return {2 * MIDDLE - p.x, p.y}
}
