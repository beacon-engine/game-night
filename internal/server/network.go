package server

import (
	"fmt"
	"net"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// LANAddress is this machine's address on the local network, preferring Wi-Fi/ethernet over
// VPNs and virtual bridges.
func LANAddress() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "localhost"
	}
	best, bestScore := "localhost", -1
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ip, ok := a.(*net.IPNet)
			if !ok || ip.IP.To4() == nil {
				continue
			}
			if s := interfaceScore(iface.Name); s > bestScore {
				best, bestScore = ip.IP.String(), s
			}
		}
	}
	return best
}

func interfaceScore(name string) int {
	for _, p := range []string{"en", "wl", "eth"} {
		if strings.HasPrefix(name, p) {
			return 2
		}
	}
	for _, p := range []string{"utun", "tun", "tap", "bridge", "vbox", "docker", "vmnet"} {
		if strings.HasPrefix(name, p) {
			return 0
		}
	}
	return 1
}

// QRSVG renders text as an SVG QR code (one unit per module, a one-module margin).
func QRSVG(text string) (string, error) {
	q, err := qrcode.New(text, qrcode.Medium)
	if err != nil {
		return "", err
	}
	q.DisableBorder = true
	bits := q.Bitmap()
	n := len(bits) + 2
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">`, n, n)
	b.WriteString(`<rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="`)
	for y, row := range bits {
		for x, on := range row {
			if on {
				fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+1, y+1)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	return b.String(), nil
}
