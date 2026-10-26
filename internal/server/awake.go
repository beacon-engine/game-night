package server

// Nobody touches the laptop during a game (everyone's on their phone), so the OS thinks it's idle:
// the screen dims and the machine goes to sleep, taking the server with it. The game page asks the
// browser for a wake lock, but that's refused in some browsers and on plain-http LAN addresses, so
// the server also tells the OS to stay awake while phones are playing on a screen.

// NewWaker returns a switch that keeps the display and the machine awake while it's on. The OS
// calls run on their own goroutine, so switching never waits on them.
func NewWaker() func(on bool) {
	want := make(chan bool, 1)
	go func() {
		var release func()
		for on := range want {
			if on && release == nil {
				release = holdAwake()
			} else if !on && release != nil {
				release()
				release = nil
			}
		}
	}()
	return func(on bool) {
		select { // only the latest wish matters
		case <-want:
		default:
		}
		want <- on
	}
}
