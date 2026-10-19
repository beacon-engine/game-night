package server

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// Saves keeps what games want to remember between nights (progress, records, a league that runs
// for weeks) as JSON files on the machine running Beacon Arcade:
//
//	GET /api/saves/<game>/<key>   the saved value, or 404
//	PUT /api/saves/<game>/<key>   save a value (JSON, up to 256 KB)
//
// A key is up to three parts, like players/3fa9c1 or league/tuesday. Files live in
// <dir>/<game>/<key>.json. The server doesn't look inside: games decide what they store.
type Saves struct {
	dir string
	mu  sync.Mutex
}

const maxSave = 256 << 10

var (
	saveName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	saveKey  = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}(/[a-z0-9][a-z0-9_-]{0,63}){0,2}$`)
)

func NewSaves(dir string) *Saves {
	return &Saves{dir: dir}
}

func (s *Saves) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	game, key, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/api/saves/"), "/")
	if !ok || !saveName.MatchString(game) || !saveKey.MatchString(key) {
		http.Error(w, "bad save name", http.StatusBadRequest)
		return
	}
	if s.dir == "" {
		http.Error(w, "saving is off (no folder)", http.StatusServiceUnavailable)
		return
	}
	file := filepath.Join(s.dir, game, filepath.FromSlash(key)+".json")

	switch r.Method {
	case http.MethodGet:
		s.mu.Lock()
		data, err := os.ReadFile(file)
		s.mu.Unlock()
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		} else if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)

	case http.MethodPut:
		data, err := io.ReadAll(io.LimitReader(r.Body, maxSave+1))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(data) > maxSave {
			http.Error(w, "save too big (256 KB at most)", http.StatusRequestEntityTooLarge)
			return
		}
		if !json.Valid(data) {
			http.Error(w, "a save must be JSON", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		err = writeAtomic(file, data)
		s.mu.Unlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "GET or PUT", http.StatusMethodNotAllowed)
	}
}

// write to a temporary file and rename it over the old one, so a crash mid-write can't leave
// half a save behind
func writeAtomic(file string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), ".save-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // (gone already after a successful rename)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), file)
}
