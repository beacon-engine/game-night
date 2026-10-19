package server

import (
	"encoding/json"
	"io/fs"
	"log"
	"path"
	"sort"
)

// Game is one entry on the game select page. Every folder in games/ with a game.json is a
// game; there is no other registration, so adding or removing a folder is all it takes.
type Game struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Icon     string `json:"icon"`              // an emoji, used when there's no icon.svg
	IconURL  string `json:"iconUrl,omitempty"` // the game's icon.svg: a line icon, drawn in the brand colours
	Tagline  string `json:"tagline"`
	Players  string `json:"players"`
	Category string `json:"category"` // groups games on the page: "Sports", "Action"...
	Needs    string `json:"needs"`    // how much device it takes: "light", "standard" or "heavy" (see web/platform/device.ts)
	Status   string `json:"status"`   // "ready", or "soon" when it has no index.html yet
	URL      string `json:"url"`
	Order    int    `json:"-"`
}

// manifest is a game's game.json
type manifest struct {
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Tagline  string `json:"tagline"`
	Players  string `json:"players"`
	Category string `json:"category"`
	Needs    string `json:"needs"`
	Status   string `json:"status"`
	Order    int    `json:"order"`
}

// Discover lists the games in files, sorted by their "order" then name. A folder with a broken
// game.json is skipped with a warning rather than taking the whole page down.
func Discover(files fs.FS) []Game {
	entries, err := fs.ReadDir(files, "games")
	if err != nil {
		return []Game{}
	}
	games := []Game{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		raw, err := fs.ReadFile(files, path.Join("games", id, "game.json"))
		if err != nil {
			continue // not a game (yet)
		}
		var m manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			log.Printf("[games] skipping %s: game.json: %v", id, err)
			continue
		}
		g := Game{ID: id, Name: m.Name, Icon: m.Icon, Tagline: m.Tagline, Players: m.Players, Category: m.Category, Needs: m.Needs,
			Status: "soon", URL: "/games/" + id + "/", Order: m.Order}
		if g.Category == "" {
			g.Category = "Other"
		}
		if g.Needs != "light" && g.Needs != "standard" && g.Needs != "heavy" {
			g.Needs = "standard" // (unknown or missing: be careful)
		}
		if _, err := fs.Stat(files, path.Join("games", id, "icon.svg")); err == nil {
			g.IconURL = g.URL + "icon.svg"
		}
		if g.Name == "" {
			g.Name = id
		}
		if g.Icon == "" {
			g.Icon = "🎮"
		}
		if g.Order == 0 {
			g.Order = 999
		}
		if _, err := fs.Stat(files, path.Join("games", id, "index.html")); err == nil && m.Status != "soon" {
			g.Status = "ready"
		}
		games = append(games, g)
	}
	sort.SliceStable(games, func(i, j int) bool {
		if games[i].Order != games[j].Order {
			return games[i].Order < games[j].Order
		}
		return games[i].Name < games[j].Name
	})
	return games
}
