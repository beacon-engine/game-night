package server

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/beacon-engine/game-night/internal/store"
)

// Saves keeps what games want to remember between nights (progress, records, a league that runs
// for weeks) in the database on the machine running Beacon Arcade:
//
//	GET /api/saves/<game>/<key>   the saved value, or 404
//	PUT /api/saves/<game>/<key>   save a value (JSON, up to 256 KB)
//
// A key is up to three parts, like players/3fa9c1 or league/tuesday. The server doesn't look
// inside: games decide what they store.
type Saves struct {
	db *store.Store // nil: saving is off
}

const maxSave = 256 << 10

var (
	saveName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	saveKey  = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}(/[a-z0-9][a-z0-9_-]{0,63}){0,2}$`)
)

func (s *Saves) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	game, key, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/api/saves/"), "/")
	if !ok || !saveName.MatchString(game) || !saveKey.MatchString(key) {
		http.Error(w, "bad save name", http.StatusBadRequest)
		return
	}
	if s.db == nil {
		http.Error(w, "saving is off (no folder)", http.StatusServiceUnavailable)
		return
	}

	switch r.Method {
	case http.MethodGet:
		data, found, err := s.db.Load(game, key)
		if err != nil {
			serverError(w, err)
			return
		} else if !found {
			http.NotFound(w, r)
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
		if err := s.db.Save(game, key, data); err != nil {
			serverError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "GET or PUT", http.StatusMethodNotAllowed)
	}
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("[store] %v", err)
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
