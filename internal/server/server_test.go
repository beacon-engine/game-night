package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"
)

func TestDiscover(t *testing.T) {
	files := fstest.MapFS{
		"games/football/game.json":  {Data: []byte(`{"name":"Football","icon":"⚽","order":1}`)},
		"games/football/index.html": {Data: []byte(`<html>`)},
		"games/football/icon.svg":   {Data: []byte(`<svg/>`)},
		"games/pool/game.json":      {Data: []byte(`{"name":"Pool","order":2}`)}, // no index.html yet
		"games/broken/game.json":    {Data: []byte(`{not json`)},                 // skipped
		"games/notes/readme.txt":    {Data: []byte(`not a game`)},                // no game.json
		"games/zed/game.json":       {Data: []byte(`{"name":"Zed"}`)},            // no order: last
		"games/zed/index.html":      {Data: []byte(`<html>`)},
	}
	got := Discover(files)
	var ids, statuses []string
	for _, g := range got {
		ids = append(ids, g.ID)
		statuses = append(statuses, g.Status)
	}
	if strings.Join(ids, ",") != "football,pool,zed" {
		t.Fatalf("ids = %v", ids)
	}
	if strings.Join(statuses, ",") != "ready,soon,ready" {
		t.Fatalf("statuses = %v", statuses)
	}
	if got[2].Icon != "🎮" || got[0].URL != "/games/football/" || got[0].IconURL != "/games/football/icon.svg" || got[1].IconURL != "" {
		t.Fatalf("defaults: %+v", got)
	}
}

func TestOverlay(t *testing.T) {
	user := fstest.MapFS{
		"games/hello/game.json":     {Data: []byte(`{"name":"Hello"}`)},
		"games/football/teams.json": {Data: []byte(`["mine"]`)},
	}
	builtIn := fstest.MapFS{
		"games/football/game.json":  {Data: []byte(`{"name":"Football"}`)},
		"games/football/teams.json": {Data: []byte(`["built-in"]`)},
	}
	o := Overlay{user, builtIn}
	if b, _ := fsRead(o, "games/football/teams.json"); b != `["mine"]` {
		t.Fatalf("user file should win, got %s", b)
	}
	if b, _ := fsRead(o, "games/football/game.json"); b != `{"name":"Football"}` {
		t.Fatalf("built-in file should show through, got %s", b)
	}
	if n := len(Discover(o)); n != 2 {
		t.Fatalf("want both games listed, got %d", n)
	}
}

// Slots: the first pad is P1, a second P2; a pad that reconnects gets its own slot back, and
// a new pad takes the lowest free one.
func TestRelaySlots(t *testing.T) {
	ts := httptest.NewServer(New(fstest.MapFS{}, 0, "").Handler())
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	display := dial(t, ctx, ts, map[string]any{"t": "hello", "role": "display"})
	a := dial(t, ctx, ts, map[string]any{"t": "hello", "role": "pad", "id": "padaaaa1", "name": "A"})
	expect(t, ctx, a, "slot", 0)
	expect(t, ctx, display, "t", "join", "id", "padaaaa1")
	b := dial(t, ctx, ts, map[string]any{"t": "hello", "role": "pad", "id": "padbbbb2", "name": "B"})
	expect(t, ctx, b, "slot", 1)

	// pad input reaches the display tagged with the pad's id
	send(t, ctx, b, map[string]any{"t": "in", "x": 1, "y": 0, "b": 1})
	expect(t, ctx, display, "id", "padbbbb2")

	// the display talks to one pad by id
	send(t, ctx, display, map[string]any{"t": "buzz", "ms": 50, "to": "padaaaa1"})
	expect(t, ctx, a, "t", "buzz")

	a.Close(websocket.StatusNormalClosure, "")
	expect(t, ctx, display, "t", "leave", "id", "padaaaa1")
	c := dial(t, ctx, ts, map[string]any{"t": "hello", "role": "pad", "id": "padcccc3", "name": "C"})
	expect(t, ctx, c, "slot", 0) // A's slot was free
	c.Close(websocket.StatusNormalClosure, "")
	expect(t, ctx, display, "t", "leave", "id", "padcccc3")
	a = dial(t, ctx, ts, map[string]any{"t": "hello", "role": "pad", "id": "padaaaa1", "name": "A"})
	expect(t, ctx, a, "slot", 0) // and A gets it back

	// pads hear when the display goes and comes back
	display.Close(websocket.StatusNormalClosure, "")
	expect(t, ctx, b, "t", "display", "on", false)
}

func fsRead(o Overlay, name string) (string, error) {
	f, err := o.Open(name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, 64)
	n, _ := f.Read(buf)
	return string(buf[:n]), nil
}

func dial(t *testing.T, ctx context.Context, ts *httptest.Server, hello map[string]any) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {ts.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	send(t, ctx, c, hello)
	return c
}

func send(t *testing.T, ctx context.Context, c *websocket.Conn, msg map[string]any) {
	t.Helper()
	data, _ := json.Marshal(msg)
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}

// read until a message with these fields arrives: expect(..., "t", "join", "slot", 0)
func expect(t *testing.T, ctx context.Context, c *websocket.Conn, kv ...any) {
	t.Helper()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %v: %v", kv, err)
		}
		var m map[string]any
		json.Unmarshal(data, &m)
		match := true
		for i := 0; i < len(kv); i += 2 {
			want, _ := json.Marshal(kv[i+1])
			got, _ := json.Marshal(m[kv[i].(string)])
			match = match && string(want) == string(got)
		}
		if match {
			return
		}
	}
}

func TestSaves(t *testing.T) {
	dir := t.TempDir()
	ts := httptest.NewServer(New(fstest.MapFS{}, 0, dir).Handler())
	defer ts.Close()
	do := func(method, path, body string) (int, string) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	if code, _ := do("GET", "/api/saves/light-cycles/players/abc123", ""); code != 404 {
		t.Fatalf("missing save: %d", code)
	}
	if code, _ := do("PUT", "/api/saves/light-cycles/players/abc123", `{"wins":3}`); code != 204 {
		t.Fatalf("save: %d", code)
	}
	if code, body := do("GET", "/api/saves/light-cycles/players/abc123", ""); code != 200 || body != `{"wins":3}` {
		t.Fatalf("read back: %d %s", code, body)
	}
	for _, bad := range []string{"/api/saves/../etc/passwd", "/api/saves/light-cycles/../../x", "/api/saves/Light/x", "/api/saves/a/b/c/d/e"} {
		if code, _ := do("PUT", bad, `{}`); code != 400 && code != 404 && code != 301 {
			t.Fatalf("%s should be refused, got %d", bad, code)
		}
	}
	if code, _ := do("PUT", "/api/saves/light-cycles/x", `not json`); code != 400 {
		t.Fatalf("non-JSON should be refused, got %d", code)
	}
	if code, _ := do("PUT", "/api/saves/light-cycles/x", `"`+strings.Repeat("a", maxSave)+`"`); code != 413 {
		t.Fatalf("too big should be refused, got %d", code)
	}
	if _, err := os.Stat(filepath.Join(dir, "light-cycles", "players", "abc123.json")); err != nil {
		t.Fatalf("file not where expected: %v", err)
	}
}
