// Package store keeps everything Beacon Arcade remembers in one SQLite file on the machine running
// it (the laptop, or the TV in the TV app): games' saves, and each player's stars and what they
// bought with them.
//
// The SQLite is modernc.org/sqlite, a translation of SQLite into Go, so there's no C to cross-
// compile: the same build runs on macOS, Windows, Linux and Android (arm and arm64).
//
// Writes are quick: WAL mode with synchronous=NORMAL commits without waiting on the disk every
// time, and one connection means writers queue up in Go instead of retrying on "database is busy".
// A game night writes a few rows a second at most; this does thousands.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

// Each step brings an older file up to date; the file remembers how far it got (user_version).
// Only ever add steps at the end.
var migrations = []string{
	`CREATE TABLE saves (
		game    TEXT NOT NULL,
		key     TEXT NOT NULL,
		value   BLOB NOT NULL,
		updated INTEGER NOT NULL,
		PRIMARY KEY (game, key)
	) WITHOUT ROWID;

	-- every star earned (+) or spent (-): a player's balance is the sum, so it can't drift
	CREATE TABLE stars (
		id     INTEGER PRIMARY KEY,
		player TEXT NOT NULL,
		delta  INTEGER NOT NULL,
		game   TEXT NOT NULL,
		reason TEXT NOT NULL,
		day    TEXT NOT NULL,
		at     INTEGER NOT NULL
	);
	CREATE INDEX stars_player ON stars (player, day, game, reason);

	CREATE TABLE owned (
		player TEXT NOT NULL,
		item   TEXT NOT NULL,
		at     INTEGER NOT NULL,
		PRIMARY KEY (player, item)
	) WITHOUT ROWID;`,
}

// Open opens (or creates) the database file and brings it up to date.
func Open(file string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + file + "?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("%s: %w", file, err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("made by a newer Beacon Arcade (version %d): update to open it", version)
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			return err
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// --- saves -------------------------------------------------------------------------------------

// Load is a game's saved value for key, and whether there was one.
func (s *Store) Load(game, key string) ([]byte, bool, error) {
	var v []byte
	err := s.db.QueryRow(`SELECT value FROM saves WHERE game = ? AND key = ?`, game, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	return v, err == nil, err
}

func (s *Store) Save(game, key string, value []byte) error {
	_, err := s.db.Exec(`INSERT INTO saves (game, key, value, updated) VALUES (?, ?, ?, ?)
		ON CONFLICT (game, key) DO UPDATE SET value = excluded.value, updated = excluded.updated`,
		game, key, value, time.Now().Unix())
	return err
}

// ImportFiles brings in saves kept as files by Beacon Arcade before 0.2 (<dir>/<game>/<key>.json),
// then renames the folder so it only happens once. Saves already in the database win.
func (s *Store) ImportFiles(dir string) (int, error) {
	if _, err := os.Stat(dir); err != nil {
		return 0, nil // nothing to bring in
	}
	n := 0
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		game, key, ok := strings.Cut(filepath.ToSlash(strings.TrimSuffix(rel, ".json")), "/")
		if !ok {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		res, err := s.db.Exec(`INSERT INTO saves (game, key, value, updated) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
			game, key, data, time.Now().Unix())
		if err != nil {
			return err
		}
		if c, _ := res.RowsAffected(); c > 0 {
			n++
		}
		return nil
	})
	if err != nil {
		return n, err
	}
	return n, os.Rename(dir, dir+"-imported")
}

// --- stars -------------------------------------------------------------------------------------

var (
	ErrOwned = errors.New("already owned")
	ErrShort = errors.New("not enough stars")
)

// Day is the date stars are counted against for daily limits: the machine's own calendar day.
func Day(t time.Time) string { return t.Format("2006-01-02") }

func (s *Store) Balance(player string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM stars WHERE player = ?`, player).Scan(&n)
	return n, err
}

// EarnedToday counts how many times a player has earned stars today for this game and reason
// (reason "" counts every reason, game "" every game).
func (s *Store) EarnedToday(player, game, reason, day string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM stars WHERE player = ? AND day = ? AND delta > 0
		AND (? = '' OR game = ?) AND (? = '' OR reason = ?)`, player, day, game, game, reason, reason).Scan(&n)
	return n, err
}

// Earn adds stars to a player's balance and returns the new balance.
func (s *Store) Earn(player, game, reason string, stars int, day string) (int, error) {
	if stars <= 0 {
		return 0, errors.New("earn a positive number of stars")
	}
	if _, err := s.db.Exec(`INSERT INTO stars (player, delta, game, reason, day, at) VALUES (?, ?, ?, ?, ?, ?)`,
		player, stars, game, reason, day, time.Now().Unix()); err != nil {
		return 0, err
	}
	return s.Balance(player)
}

// Buy spends price stars on item, all or nothing, and returns the new balance.
// It fails with ErrOwned if the player has it already, ErrShort if they can't afford it.
func (s *Store) Buy(player, item string, price int) (int, error) {
	tx, err := s.db.Begin() // (one connection: nothing else can write in between)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var have int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM owned WHERE player = ? AND item = ?`, player, item).Scan(&have); err != nil {
		return 0, err
	}
	if have > 0 {
		return 0, ErrOwned
	}
	var balance int
	if err := tx.QueryRow(`SELECT COALESCE(SUM(delta), 0) FROM stars WHERE player = ?`, player).Scan(&balance); err != nil {
		return 0, err
	}
	if balance < price {
		return balance, ErrShort
	}
	now := time.Now()
	game, _, _ := strings.Cut(item, "/")
	if price > 0 {
		if _, err := tx.Exec(`INSERT INTO stars (player, delta, game, reason, day, at) VALUES (?, ?, ?, ?, ?, ?)`,
			player, -price, game, "bought "+item, Day(now), now.Unix()); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO owned (player, item, at) VALUES (?, ?, ?)`, player, item, now.Unix()); err != nil {
		return 0, err
	}
	return balance - price, tx.Commit()
}

// Owned lists what a player has bought, oldest first.
func (s *Store) Owned(player string) ([]string, error) {
	rows, err := s.db.Query(`SELECT item FROM owned WHERE player = ? ORDER BY at, item`, player)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var item string
		if err := rows.Scan(&item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
