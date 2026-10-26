//go:build !darwin && !windows && !linux

package server

func holdAwake() func() { return nil }
