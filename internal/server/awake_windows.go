package server

import (
	"runtime"
	"syscall"
)

const (
	esContinuous      = 0x80000000
	esSystemRequired  = 0x00000001
	esDisplayRequired = 0x00000002
)

var setThreadExecutionState = syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")

// The request belongs to the thread that made it, so one thread holds it until released
func holdAwake() func() {
	if setThreadExecutionState.Find() != nil {
		return nil
	}
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread() // (never unlocked: the thread ends with the goroutine, dropping the request)
		setThreadExecutionState.Call(esContinuous | esSystemRequired | esDisplayRequired)
		<-done
		setThreadExecutionState.Call(esContinuous)
	}()
	return func() { close(done) }
}
