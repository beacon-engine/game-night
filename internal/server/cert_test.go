package server

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func TestPadCert(t *testing.T) {
	dir := t.TempDir()
	first, err := PadCert(dir, "192.168.1.20")
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Leaf.VerifyHostname("192.168.1.20"); err != nil {
		t.Fatalf("should name the LAN address: %v", err)
	}
	again, _ := PadCert(dir, "192.168.1.20")
	if again.Leaf.SerialNumber.Cmp(first.Leaf.SerialNumber) != 0 {
		t.Fatal("the saved certificate should be reused (or every phone warns again)")
	}
	moved, _ := PadCert(dir, "10.0.0.5")
	if moved.Leaf.SerialNumber.Cmp(first.Leaf.SerialNumber) == 0 || moved.Leaf.VerifyHostname("10.0.0.5") != nil {
		t.Fatal("a new address needs a new certificate")
	}
}

func TestTiltURL(t *testing.T) {
	s := New(fstest.MapFS{}, 10000, nil)
	s.Host = "127.0.0.1"
	if s.TiltURL() != "" {
		t.Fatal("no HTTPS side yet: no tilt address")
	}
	ln, err := s.ListenTLS(0, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go s.Serve(ln)

	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	res, err := client.Get(strings.TrimSuffix(s.TiltURL(), "pad/") + "api/info")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info map[string]string
	json.NewDecoder(res.Body).Decode(&info)
	if !strings.HasPrefix(info["tiltUrl"], "https://127.0.0.1:") || info["padUrl"] != "http://127.0.0.1:10000/pad/" {
		t.Fatalf("info = %v", info)
	}
}
