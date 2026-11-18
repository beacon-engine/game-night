// The computer playing, behind the lobby: it launches the ball and flips when the ball comes down
// onto a flipper.
package pinball

import "core:math"

ai_hold:   [2]f32 // how much longer it holds each flipper up
ai_wait:   [2]f32 // and how long before it may flip that one again
ai_power:  f32    // how far it means to pull the plunger
rng_state: u32

autoplay_controls :: proc() {
	s := &state
	controls = {}
	if on_plunger {
		if ai_power == 0 { 	// a new ball: pick how hard to launch it (and let go for a tick, see launch_ready)
			ai_power = 0.55 + 0.45 * random()
			return
		}
		controls.launch = s.plunger < ai_power // (let go once it's pulled far enough)
		if !controls.launch {
			ai_power = 0
		}
		return
	}
	for f, i in table.flippers {
		ai_hold[i] -= TICK
		ai_wait[i] -= TICK
		on_this_side := s.ball.x < MIDDLE if i == 0 else s.ball.x > MIDDLE
		close := s.ball.y > f.pivot.y - 80 && s.ball.y < f.pivot.y + 30 && math.abs(s.ball.x - f.pivot.x) < 100
		if on_this_side && close && s.ball_vel.y > -200 && ai_wait[i] <= 0 {
			ai_hold[i] = 0.2
			ai_wait[i] = 0.45
		}
	}
	controls.left = ai_hold[0] > 0
	controls.right = ai_hold[1] > 0
}

// xorshift: a tiny random number generator (0..1), so the demo isn't the same every time
random :: proc() -> f32 {
	rng_state ~= rng_state << 13
	rng_state ~= rng_state >> 17
	rng_state ~= rng_state << 5
	return f32(rng_state >> 8) / f32(1 << 24)
}
