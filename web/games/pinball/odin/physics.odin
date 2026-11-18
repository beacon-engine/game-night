// The ball moving and bouncing: off walls, bumpers and swinging flippers. Every collision is the
// same idea: find the closest point on the thing to the ball's centre; if that's nearer than the
// ball's radius, push the ball back out and take away (most of) its speed into the surface.
package pinball

import "core:math"
import "core:math/linalg"

Vec2 :: [2]f32 // arrays of numbers do arithmetic in Odin: a + b, v * 2...

GRAVITY         :: 1400 // units/s², down the table
MAX_SPEED       :: 3000 // that's 6 units a substep: less than the ball's radius
WALL_BOUNCE     :: 0.45 // how much of its speed into a wall the ball keeps
FLIPPER_BOUNCE  :: 0.3
FLIP_UP_SPEED   :: 26 // radians/s
FLIP_DOWN_SPEED :: 14

flipper_local: [2]f32 // each flipper's angle between `rest` and `up` (see Flipper)
flipper_spin:  [2]f32 // how fast each one is turning, as drawn (radians/s)
flipper_dir:   [2]Vec2
lane_inside:   [LANES]bool
on_plunger:    bool // the ball sits still on the plunger until it's launched

physics_step :: proc(dt: f32) {
	move_flippers(dt)
	if on_plunger {
		return
	}
	s := &state
	s.ball_vel.y += GRAVITY * dt
	speed := linalg.length(s.ball_vel)
	if speed > MAX_SPEED {
		s.ball_vel *= MAX_SPEED / speed
	}
	s.ball += s.ball_vel * dt

	hit_segments()
	hit_bumpers()
	hit_flippers()
	roll_over_lanes()

	// back down the plunger lane: it settles on the plunger, ready to go again
	if s.ball.x > 460 && s.ball.y >= table.plunger_rest.y - 0.5 && s.ball_vel.y >= 0 {
		on_plunger = true
		s.phase = .In_Lane
		s.ball = table.plunger_rest
		s.ball_vel = {}
	}
}

move_flippers :: proc(dt: f32) {
	for f, i in table.flippers {
		held := (controls.left if i == 0 else controls.right) && !state.tilted
		target := f.up if held else f.rest
		speed: f32 = FLIP_UP_SPEED if held else FLIP_DOWN_SPEED
		before := flipper_local[i]
		a := before
		if a > target {
			a = max(target, a - speed * dt)
		} else {
			a = min(target, a + speed * dt)
		}
		flipper_local[i] = a
		place_flipper(i, (a - before) / dt)
	}
}

// Where flipper i is drawn and how fast it's turning, from its local angle
place_flipper :: proc(i: int, spin: f32) {
	a := flipper_local[i]
	if i == 0 {
		state.flipper_angle[i] = a
		flipper_spin[i] = spin
	} else { 	// the right one is the left one mirrored: it turns the other way
		state.flipper_angle[i] = math.PI - a
		flipper_spin[i] = -spin
	}
	flipper_dir[i] = {math.cos(state.flipper_angle[i]), math.sin(state.flipper_angle[i])}
}

hit_segments :: proc() {
	r := table.ball_radius
	for i in 0 ..< table.segment_count {
		seg := table.segments[i]
		p, _ := closest_on_segment(state.ball, seg.a, seg.b)
		d := state.ball - p
		dist := linalg.length(d)
		if dist >= r || dist == 0 {
			continue
		}
		n := d / dist
		hit := bounce(n, r - dist, {}, WALL_BOUNCE)
		switch seg.kind {
		case .Wall:
			if hit > 350 {
				push_event(.Wall, p, i32(hit))
			}
		case .Sling:
			if hit > 60 { 	// (hard enough to trip its switch)
				sling_hit(seg.id, n, p)
			}
		case .Target:
			if hit > 60 {
				target_hit(seg.id, p)
			}
		}
	}
}

hit_bumpers :: proc() {
	for b, i in table.bumpers {
		d := state.ball - b.pos
		dist := linalg.length(d)
		reach := b.radius + table.ball_radius
		if dist >= reach || dist == 0 {
			continue
		}
		n := d / dist
		bounce(n, reach - dist, {}, WALL_BOUNCE)
		bumper_hit(i, n, b.pos + n * b.radius)
	}
}

// A flipper is a rod that's thicker at the pivot. The point of it the ball touches is moving
// (spin × its distance from the pivot), and that's what sends the ball flying.
hit_flippers :: proc() {
	for f, i in table.flippers {
		tip := f.pivot + flipper_dir[i] * f.length
		p, t := closest_on_segment(state.ball, f.pivot, tip)
		reach := math.lerp(f.base_radius, f.tip_radius, t) + table.ball_radius
		d := state.ball - p
		dist := linalg.length(d)
		if dist >= reach || dist == 0 {
			continue
		}
		n := d / dist
		arm := p - f.pivot
		surface := flipper_spin[i] * Vec2{-arm.y, arm.x}
		hit := bounce(n, reach - dist, surface, FLIPPER_BOUNCE)
		if hit > 400 {
			push_event(.Flipper_Hit, p, i32(hit))
		}
	}
}

// The top lanes have a switch under them: light it as the ball rolls over
roll_over_lanes :: proc() {
	for pos, i in table.lanes {
		dist := linalg.length(state.ball - pos)
		if !lane_inside[i] && dist < table.lane_radius {
			lane_inside[i] = true
			lane_hit(i)
		} else if lane_inside[i] && dist > table.lane_radius + 8 {
			lane_inside[i] = false
		}
	}
}

// Push the ball `depth` out along `n` and bounce it off a surface moving at `surface_vel`.
// Returns how hard it hit (its speed into the surface), or 0 if it was already moving away.
bounce :: proc(n: Vec2, depth: f32, surface_vel: Vec2, restitution: f32) -> f32 {
	state.ball += n * depth
	into := linalg.dot(state.ball_vel - surface_vel, n)
	if into >= 0 {
		return 0
	}
	keep := restitution if -into > 60 else 0 // (a ball resting on something stays put instead of jittering)
	state.ball_vel -= n * (1 + keep) * into
	return -into
}

closest_on_segment :: proc(p, a, b: Vec2) -> (point: Vec2, t: f32) {
	ab := b - a
	t = clamp(linalg.dot(p - a, ab) / linalg.dot(ab, ab), 0, 1)
	return a + ab * t, t
}
