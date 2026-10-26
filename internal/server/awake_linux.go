package server

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

// systemd-inhibit holds the lock while tail waits for us to exit; without systemd, nothing to do
// (the TV app keeps its own screen on)
func holdAwake() func() {
	cmd := exec.Command("systemd-inhibit", "--what=idle:sleep", "--who=Beacon Arcade", "--why=Players are in a game",
		"tail", "--pid="+strconv.Itoa(os.Getpid()), "-f", "/dev/null")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // so releasing ends tail too
	if cmd.Start() != nil {
		return nil
	}
	return func() {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		cmd.Wait()
	}
}
