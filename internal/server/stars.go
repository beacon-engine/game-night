package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"path"
	"regexp"
	"sort"
	"time"

	"github.com/beacon-engine/game-night/internal/store"
)

// Stars are what players earn by playing and spend in the shop on looks (paint, kits, piece sets),
// never on anything that helps them win. Games say what happened; the server decides how many
// stars that's worth, so no game can hand out more than the others:
//
//	GET  /api/stars/<player>         {"balance":120,"owned":["stock-cars/gold"]}
//	POST /api/stars/<player>/earn    {"game":"chess","for":["played","won"]}  -> {"balance","earned","lines"}
//	POST /api/stars/<player>/buy     {"item":"stock-cars/gold"}               -> {"balance","owned"}
//	GET  /api/shop                   everything on sale: every game's shop.json
//
// A player is a phone's id (or kb1, kb2 for keyboards), the same as their saves.
type earning struct {
	stars, perDay int // per day: the most times a player earns this, per game, so replaying a quick game all night doesn't flood the shop
}

var earnings = map[string]earning{
	"played":   {5, 12},  // finished a game
	"won":      {15, 10}, // won it
	"podium":   {8, 10},  // came second or third
	"record":   {10, 5},  // beat a saved best (a lap record, a high score)
	"champion": {50, 3},  // won a league, cup or championship
}

const dailyBonus = 20 // the first stars of the day, whatever the game

var playerID = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// ShopItem is one thing on sale, from a game's shop.json:
//
//	{"items": [{"id": "gold", "name": "Gold paint", "price": 80, "about": "...", ...}]}
//
// Fields other than id, name and price are the game's own (a colour, a model name).
type ShopItem struct {
	ID       string         `json:"id"` // <game>/<id>
	Game     string         `json:"game"`
	GameName string         `json:"gameName"`
	Name     string         `json:"name"`
	Price    int            `json:"price"`
	Extra    map[string]any `json:"extra"`
}

type earnLine struct {
	For   string `json:"for"`
	Stars int    `json:"stars"`
}

func (s *Server) starsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/shop", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, Shop(s.files)) })
	mux.HandleFunc("GET /api/stars/{player}", s.withPlayer(s.starsGet))
	mux.HandleFunc("POST /api/stars/{player}/earn", s.withPlayer(s.starsEarn))
	mux.HandleFunc("POST /api/stars/{player}/buy", s.withPlayer(s.starsBuy))
}

func (s *Server) withPlayer(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		player := r.PathValue("player")
		if !playerID.MatchString(player) {
			http.Error(w, "bad player id", http.StatusBadRequest)
			return
		}
		if s.db == nil {
			http.Error(w, "stars are off (no folder to keep them in)", http.StatusServiceUnavailable)
			return
		}
		h(w, r, player)
	}
}

func (s *Server) starsGet(w http.ResponseWriter, _ *http.Request, player string) {
	balance, err := s.db.Balance(player)
	if err != nil {
		serverError(w, err)
		return
	}
	owned, err := s.db.Owned(player)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]any{"balance": balance, "owned": owned})
}

func (s *Server) starsEarn(w http.ResponseWriter, r *http.Request, player string) {
	var req struct {
		Game string   `json:"game"`
		For  []string `json:"for"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req) != nil || !saveName.MatchString(req.Game) {
		http.Error(w, `send {"game": "<id>", "for": ["played", "won"]}`, http.StatusBadRequest)
		return
	}
	day := store.Day(time.Now())
	lines := []earnLine{}
	if n, err := s.db.EarnedToday(player, "", "", day); err != nil {
		serverError(w, err)
		return
	} else if n == 0 && len(req.For) > 0 {
		lines = append(lines, earnLine{"daily", dailyBonus})
	}
	seen := map[string]bool{}
	for _, why := range req.For {
		e, ok := earnings[why]
		if !ok || seen[why] {
			continue // (unknown reasons earn nothing, rather than failing the whole call)
		}
		seen[why] = true
		if n, err := s.db.EarnedToday(player, req.Game, why, day); err != nil {
			serverError(w, err)
			return
		} else if n < e.perDay {
			lines = append(lines, earnLine{why, e.stars})
		}
	}
	balance, err := s.db.Balance(player)
	if err != nil {
		serverError(w, err)
		return
	}
	earned := 0
	for _, l := range lines {
		if balance, err = s.db.Earn(player, req.Game, l.For, l.Stars, day); err != nil {
			serverError(w, err)
			return
		}
		earned += l.Stars
	}
	if earned > 0 {
		s.relay.Tell(player, map[string]any{"t": "stars", "balance": balance, "earned": earned})
	}
	writeJSON(w, map[string]any{"balance": balance, "earned": earned, "lines": lines})
}

func (s *Server) starsBuy(w http.ResponseWriter, r *http.Request, player string) {
	var req struct {
		Item string `json:"item"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req) != nil {
		http.Error(w, `send {"item": "<game>/<id>"}`, http.StatusBadRequest)
		return
	}
	var item *ShopItem
	for _, it := range Shop(s.files) {
		if it.ID == req.Item {
			item = &it
			break
		}
	}
	if item == nil {
		http.Error(w, "no such item in the shop", http.StatusNotFound)
		return
	}
	balance, err := s.db.Buy(player, item.ID, item.Price)
	switch {
	case errors.Is(err, store.ErrOwned):
		http.Error(w, "you have this already", http.StatusConflict)
		return
	case errors.Is(err, store.ErrShort):
		http.Error(w, "not enough stars yet", http.StatusPaymentRequired)
		return
	case err != nil:
		serverError(w, err)
		return
	}
	owned, err := s.db.Owned(player)
	if err != nil {
		serverError(w, err)
		return
	}
	s.relay.Tell(player, map[string]any{"t": "stars", "balance": balance, "earned": 0})
	writeJSON(w, map[string]any{"balance": balance, "owned": owned})
}

// Shop is everything on sale, game by game (in game select order), cheapest first within a game.
// A game with a broken shop.json is left out with a warning.
func Shop(files fs.FS) []ShopItem {
	items := []ShopItem{}
	for _, g := range Discover(files) {
		raw, err := fs.ReadFile(files, path.Join("games", g.ID, "shop.json"))
		if err != nil {
			continue
		}
		var f struct {
			Items []map[string]any `json:"items"`
		}
		if err := json.Unmarshal(raw, &f); err != nil {
			log.Printf("[shop] skipping %s: shop.json: %v", g.ID, err)
			continue
		}
		var mine []ShopItem
		for _, m := range f.Items {
			id, _ := m["id"].(string)
			name, _ := m["name"].(string)
			price, _ := m["price"].(float64)
			if !saveName.MatchString(id) || name == "" || price < 0 {
				log.Printf("[shop] %s: skipping an item without a good id, name and price", g.ID)
				continue
			}
			delete(m, "id")
			delete(m, "name")
			delete(m, "price")
			mine = append(mine, ShopItem{ID: g.ID + "/" + id, Game: g.ID, GameName: g.Name, Name: name, Price: int(price), Extra: m})
		}
		sort.SliceStable(mine, func(i, j int) bool { return mine[i].Price < mine[j].Price })
		items = append(items, mine...)
	}
	return items
}
