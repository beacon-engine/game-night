package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImportFiles(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "saves")
	os.MkdirAll(filepath.Join(old, "chess", "players"), 0o755)
	os.WriteFile(filepath.Join(old, "chess", "players", "abc123.json"), []byte(`{"wins":2}`), 0o644)
	os.WriteFile(filepath.Join(old, "chess", "players", "keep.json"), []byte(`{"old":true}`), 0o644)

	s, err := Open(filepath.Join(dir, "beacon-arcade.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.Save("chess", "players/keep", []byte(`{"new":true}`)) // already in the database: wins
	if n, err := s.ImportFiles(old); err != nil || n != 1 {
		t.Fatalf("import: %d %v", n, err)
	}
	if v, ok, _ := s.Load("chess", "players/abc123"); !ok || string(v) != `{"wins":2}` {
		t.Fatalf("imported save: %s %v", v, ok)
	}
	if v, _, _ := s.Load("chess", "players/keep"); string(v) != `{"new":true}` {
		t.Fatalf("an import replaced a newer save: %s", v)
	}
	if _, err := os.Stat(old + "-imported"); err != nil {
		t.Fatalf("old folder not set aside: %v", err)
	}
	if n, _ := s.ImportFiles(old); n != 0 {
		t.Fatalf("imported twice: %d", n)
	}
}

func TestReopen(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	s, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	s.Earn("p1", "chess", "won", 15, "2026-10-20")
	s.Close()
	if s, err = Open(file); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if b, _ := s.Balance("p1"); b != 15 {
		t.Fatalf("balance after reopening: %d", b)
	}
}
