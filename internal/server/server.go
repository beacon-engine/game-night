// Package server is the local host for Beacon Arcade: it serves the games and the phone
// controller page, and relays phone input to the game on the TV.
package server

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"syscall"

	"github.com/beacon-engine/game-night/internal/store"
)

// Server serves one set of web files (the built web/dist, possibly with user overrides on top).
type Server struct {
	Version string        // shown on the game select page
	Host    string        // this machine's address for the phones; detected when empty
	Awake   func(on bool) // keeps the machine awake during games (NewWaker); nil leaves it to the OS

	files   fs.FS
	port    int
	tlsPort int // the HTTPS side (for tilt to steer); 0 until ListenTLS
	relay   *Relay
	db      *store.Store // saves and stars; nil turns both off

	earning sync.Mutex // one stars payout at a time, so two at once can't both pass the daily checks
}

// New serves files on port, keeping saves and stars in db (both are off if it's nil).
func New(files fs.FS, port int, db *store.Store) *Server {
	return &Server{files: files, port: port, relay: NewRelay(), db: db}
}

// PadURL is what phones on the same Wi-Fi open to join.
func (s *Server) PadURL() string {
	return fmt.Sprintf("http://%s:%d/pad/", s.host(), s.port)
}

// TiltURL is the same pad over HTTPS, where phones let it read the tilt; "" when that's off.
func (s *Server) TiltURL() string {
	if s.tlsPort == 0 {
		return ""
	}
	return fmt.Sprintf("https://%s:%d/pad/", s.host(), s.tlsPort)
}

func (s *Server) host() string {
	if s.Host == "" {
		return LANAddress()
	}
	return s.Host
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/games", s.games)
	mux.HandleFunc("GET /api/info", s.info)
	mux.Handle("/api/saves/", &Saves{db: s.db})
	s.starsRoutes(mux)
	s.relay.awake = s.Awake
	mux.Handle("/ws", s.relay)
	mux.Handle("/", s.static())
	return mux
}

// Listen binds the port (on all interfaces, so phones can reach it). A taken port is
// reported as ErrPortInUse.
func (s *Server) Listen() (net.Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
	if errors.Is(err, syscall.EADDRINUSE) {
		return nil, fmt.Errorf("%w: %d", ErrPortInUse, s.port)
	}
	return ln, err
}

// ListenTLS binds the HTTPS side on port, with a certificate of our own kept in dir (see PadCert).
// Serve it like the other one.
func (s *Server) ListenTLS(port int, dir string) (net.Listener, error) {
	cert, err := PadCert(dir, s.host())
	if err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if errors.Is(err, syscall.EADDRINUSE) {
		return nil, fmt.Errorf("%w: %d", ErrPortInUse, port)
	} else if err != nil {
		return nil, err
	}
	s.tlsPort = ln.Addr().(*net.TCPAddr).Port
	return tls.NewListener(ln, &tls.Config{Certificates: []tls.Certificate{cert}}), nil
}

// Serve blocks until the server stops.
func (s *Server) Serve(ln net.Listener) error {
	return http.Serve(ln, s.Handler())
}

var ErrPortInUse = errors.New("port already in use")

func (s *Server) games(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, Discover(s.files))
}

func (s *Server) info(w http.ResponseWriter, _ *http.Request) {
	url := s.PadURL()
	qr, err := QRSVG(url)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"padUrl": url, "tiltUrl": s.TiltURL(), "qr": qr, "version": s.Version})
}

// Static files. Folders serve their index.html; there are no directory listings.
func (s *Server) static() http.Handler {
	files := http.FileServerFS(s.files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "."
		}
		if info, err := fs.Stat(s.files, p); err == nil && info.IsDir() {
			if _, err := fs.Stat(s.files, path.Join(p, "index.html")); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false) // (the QR code is svg markup)
	enc.Encode(v)
}
