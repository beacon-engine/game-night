// Beacon Arcade: couch games on the TV, with phones as controllers.
//
//	beacon-arcade                  start and open the game select page
//	beacon-arcade -port 8080       another port (or PORT=8080)
//	beacon-arcade -no-open         don't open a browser
//	beacon-arcade -dev             serve web/dist from disk (with `make dev`); -web DIR for another folder
//	beacon-arcade -host 192.0.2.7  the address phones should use (detected if left out)
//	beacon-arcade -version         print the version
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/beacon-engine/game-night/internal/server"
	"github.com/beacon-engine/game-night/internal/store"
	"github.com/beacon-engine/game-night/web"
)

// The release this is, e.g. v1.2.0 (semantic versioning; set by `make` from the git tag).
var version = "dev"

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	port := flag.Int("port", envInt("PORT", 10000), "port to listen on")
	noOpen := flag.Bool("no-open", false, "don't open the game select page in a browser")
	dev := flag.Bool("dev", false, "serve web/dist from disk instead of the built-in copy (same as -web web/dist)")
	webDir := flag.String("web", "", "serve the web files from this folder instead of the built-in copy")
	host := flag.String("host", "", "this machine's address on the Wi-Fi, for the phones (detected if left out)")
	exitWithStdin := flag.Bool("exit-with-stdin", false, "stop when stdin closes (an app running this as a child process keeps it open)")
	userDir := flag.String("dir", defaultUserDir(), "folder with extra games, or files that replace built-in ones")
	flag.Parse()
	if *showVersion {
		fmt.Println("beacon-arcade", version)
		return
	}

	if *dev {
		*webDir = "web/dist"
	}
	if *exitWithStdin {
		// the TV app holds our stdin open; if the app goes (even killed), so do we
		go func() {
			io.Copy(io.Discard, os.Stdin)
			os.Exit(0)
		}()
	}
	if *webDir == "" && !web.Embedded {
		log.Fatal("this build has no web files built in: pass -web DIR")
	}
	db := openStore(*userDir)
	srv := server.New(files(*webDir, *userDir), *port, db)
	srv.Version = version
	srv.Host = *host
	srv.Awake = server.NewWaker()
	ln, err := srv.Listen()
	if errors.Is(err, server.ErrPortInUse) {
		log.Fatalf("Port %d is already in use (is Beacon Arcade already running?). Try another: -port %d", *port, *port+1)
	} else if err != nil {
		log.Fatal(err)
	}

	url := fmt.Sprintf("http://localhost:%d", *port)
	fmt.Printf("\n  BEACON ARCADE %s is running\n  Game screen : %s\n  Phones      : %s   (same Wi-Fi)\n", version, url, srv.PadURL())
	if *userDir != "" {
		fmt.Printf("  Your folder : %s\n                (games you add go in games/; progress and stars are kept in beacon-arcade.db)\n", *userDir)
	}
	fmt.Println()
	if !*noOpen {
		openBrowser(url)
	}
	log.Fatal(srv.Serve(ln))
}

// Saves and stars live in <dir>/beacon-arcade.db. Without a folder, or if the file can't be
// opened, the games still run; they just don't remember anything.
func openStore(userDir string) *store.Store {
	if userDir == "" {
		return nil
	}
	db, err := store.Open(filepath.Join(userDir, "beacon-arcade.db"))
	if err != nil {
		log.Printf("Saving is off: %v", err)
		return nil
	}
	// before 0.2, saves were files in saves/
	if n, err := db.ImportFiles(filepath.Join(userDir, "saves")); err != nil {
		log.Printf("Couldn't bring in the old saves: %v", err)
	} else if n > 0 {
		log.Printf("Moved %d saves into beacon-arcade.db", n)
	}
	return db
}

// The built-in games, with the user's folder on top: a game dropped in <dir>/games/<id>/ shows
// up next to them, and e.g. <dir>/games/football/teams.json replaces the built-in clubs.
func files(webDir, userDir string) fs.FS {
	var base fs.FS
	if webDir != "" {
		base = os.DirFS(webDir)
	} else {
		base, _ = fs.Sub(web.Dist, "dist")
	}
	if info, err := os.Stat(userDir); err == nil && info.IsDir() {
		return server.Overlay{os.DirFS(userDir), base}
	}
	return base
}

func defaultUserDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	user := filepath.Join(dir, "beacon-arcade")
	// Before 0.2 the folder was called game-night: move it over, saves and all
	if _, err := os.Stat(user); os.IsNotExist(err) {
		_ = os.Rename(filepath.Join(dir, "game-night"), user)
	}
	return user
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start() // best effort: the address is printed above anyway
}
