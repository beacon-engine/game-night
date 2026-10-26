package server

import (
	"os"
	"os/exec"
	"strconv"
)

// caffeinate holds the assertion for as long as it runs; -w ends it if we go (even killed)
func holdAwake() func() {
	cmd := exec.Command("caffeinate", "-d", "-i", "-w", strconv.Itoa(os.Getpid()))
	if cmd.Start() != nil {
		return nil
	}
	return func() {
		cmd.Process.Kill()
		cmd.Wait()
	}
}
