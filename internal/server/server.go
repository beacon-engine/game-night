// Package server is the local host for Game Night: it serves the games and the phone
// controller page, and relays phone input to the game on the TV.
package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"syscall"
)

// Server serves one set of web files (the built web/dist, possibly with user overrides on top).
type Server struct {
	Version string // shown on the game select page
	Host    string // this machine's address for the phones; detected when empty

	files fs.FS
	port  int
	relay *Relay
}

func New(files fs.FS, port int) *Server {
	return &Server{files: files, port: port, relay: NewRelay()}
}

// PadURL is what phones on the same Wi-Fi open to join.
func (s *Server) PadURL() string {
	host := s.Host
	if host == "" {
		host = LANAddress()
	}
	return fmt.Sprintf("http://%s:%d/pad/", host, s.port)
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/games", s.games)
	mux.HandleFunc("GET /api/info", s.info)
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
	writeJSON(w, map[string]string{"padUrl": url, "qr": qr, "version": s.Version})
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
