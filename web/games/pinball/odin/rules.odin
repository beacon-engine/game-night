// The rules: points, the bonus and its multiplier, lanes and targets, the plunger, ball save,
// nudging and tilt, and losing the ball.
package pinball

import "core:math/linalg"

BALL_SAVE_TIME :: 8   // seconds after the first launch when a lost ball comes straight back (once a ball)
PLUNGER_PULL   :: 1.4 // per second: a full pull takes 0.7 s
NUDGE_POWER    :: 160
TILT_WARNING   :: 2   // the tilt meter goes up 1 a nudge and down TILT_COOL a second
TILT_LIMIT     :: 3
TILT_COOL      :: 0.5
BUMPER_KICK    :: 700
SLING_KICK     :: 600
MAX_MULTIPLIER :: 5

ALL_LANES   :: (1 << LANES) - 1
ALL_TARGETS :: (1 << TARGETS) - 1

was_pressed:  Controls
save_given:   bool // this ball has had its ball save
launch_ready: bool // the launch button has been let go since this ball appeared (so the press that started the game doesn't pull the plunger)

reset_ball :: proc() {
	state = {}
	state.multiplier = 1
	state.ball = table.plunger_rest
	on_plunger = true
	save_given = false
	launch_ready = false
	lane_inside = {}
	was_pressed = controls
	for f, i in table.flippers {
		flipper_local[i] = f.rest
		place_flipper(i, 0)
	}
}

// Once a tick, before the physics: the flipper buttons and the plunger
press_buttons :: proc(dt: f32) {
	s := &state
	if !s.tilted {
		// each flip also moves the lit top lanes along, so you can line up the dark one
		if controls.left && !was_pressed.left {
			push_event(.Flip, table.flippers[0].pivot, 0)
			s.lanes = (s.lanes >> 1) | ((s.lanes & 1) << (LANES - 1))
		}
		if controls.right && !was_pressed.right {
			push_event(.Flip, table.flippers[1].pivot, 1)
			s.lanes = ((s.lanes << 1) & ALL_LANES) | (s.lanes >> (LANES - 1))
		}
	}
	was_pressed = controls

	if !controls.launch {
		launch_ready = true
	}
	if !on_plunger || !launch_ready {
		s.plunger = 0
		return
	}
	if controls.launch {
		s.plunger = min(1, s.plunger + PLUNGER_PULL * dt)
		s.ball = table.plunger_rest + {0, s.plunger * table.plunger_travel}
	} else if s.plunger > 0 { 	// let go: the harder it was pulled, the faster the ball goes
		push_event(.Launch, s.ball, i32(s.plunger * 100))
		s.ball = table.plunger_rest
		s.ball_vel = {0, -(900 + 1900 * s.plunger)}
		s.plunger = 0
		on_plunger = false
	}
}

// Once a tick, after the physics: timers, and whether the ball is in play or lost
after_step :: proc(dt: f32) {
	s := &state
	for &g in s.bumper_glow {
		g = max(0, g - 4 * dt)
	}
	for &g in s.sling_glow {
		g = max(0, g - 4 * dt)
	}
	s.tilt_meter = max(0, s.tilt_meter - TILT_COOL * dt)
	s.ball_save = max(0, s.ball_save - dt)

	if s.phase == .In_Lane && !on_plunger && s.ball.x < 455 {
		s.phase = .In_Play
		if !save_given {
			save_given = true
			s.ball_save = BALL_SAVE_TIME
		}
	}
	r := table.ball_radius
	if s.ball.y > HEIGHT + 2 * r || s.ball.x < -r || s.ball.x > WIDTH + r || s.ball.y < -r {
		drain()
	}
}

drain :: proc() {
	s := &state
	if s.ball_save > 0 && !s.tilted {
		push_event(.Ball_Saved, {s.ball.x, HEIGHT})
		s.ball_save = 0
		s.phase = .In_Lane
		s.ball = table.plunger_rest
		s.ball_vel = {}
		on_plunger = true
		return
	}
	paid := 0 if s.tilted else s.bonus * s.multiplier
	s.score += paid
	s.phase = .Drained
	push_event(.Drain, {s.ball.x, HEIGHT}, paid)
}

nudge_table :: proc(dir: Vec2) {
	s := &state
	if s.phase != .In_Play || s.tilted {
		return
	}
	d := dir
	if l := linalg.length(d); l > 1 {
		d /= l
	}
	s.ball_vel += d * NUDGE_POWER
	s.tilt_meter += 1
	if s.tilt_meter > TILT_LIMIT {
		s.tilted = true
		push_event(.Tilt, s.ball)
	} else if s.tilt_meter > TILT_WARNING {
		push_event(.Tilt_Warning, s.ball)
	}
}

bumper_hit :: proc(i: int, n: Vec2, at: Vec2) {
	s := &state
	if s.tilted || s.bumper_glow[i] > 0.6 { 	// (dead after a tilt; and one kick per touch)
		return
	}
	s.ball_vel += n * BUMPER_KICK
	s.bumper_glow[i] = 1
	s.score += 100
	s.bonus += 50
	push_event(.Bumper, at, i32(i))
}

sling_hit :: proc(id: i32, n: Vec2, at: Vec2) {
	s := &state
	if s.tilted || s.sling_glow[id] > 0.6 {
		return
	}
	s.ball_vel += n * SLING_KICK
	s.sling_glow[id] = 1
	s.score += 10
	push_event(.Sling, at, id)
}

// Light all the top lanes to put the bonus multiplier up
lane_hit :: proc(i: int) {
	s := &state
	if s.tilted {
		return
	}
	bit := u32(1) << u32(i)
	if s.lanes & bit != 0 {
		s.score += 100
		return
	}
	s.lanes |= bit
	s.score += 500
	s.bonus += 200
	push_event(.Lane, table.lanes[i], i32(i))
	if s.lanes == ALL_LANES {
		s.lanes = 0
		s.multiplier = min(MAX_MULTIPLIER, s.multiplier + 1)
		s.score += 2000
		push_event(.Lanes_Complete, table.lanes[LANES / 2], s.multiplier)
	}
}

// Hit all the targets for the jackpot
target_hit :: proc(id: i32, at: Vec2) {
	s := &state
	if s.tilted {
		return
	}
	bit := u32(1) << u32(id)
	if s.targets & bit != 0 {
		s.score += 50
		return
	}
	s.targets |= bit
	s.score += 250
	s.bonus += 250
	push_event(.Target, at, id)
	if s.targets == ALL_TARGETS {
		s.targets = 0
		s.score += 5000
		s.bonus += 1000
		push_event(.Targets_Complete, at, 5000)
	}
}
