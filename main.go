// Game Night: couch games on the TV, with phones as controllers.
//
//	game-night                  start and open the game select page
//	game-night -port 8080       another port (or PORT=8080)
//	game-night -no-open         don't open a browser
//	game-night -dev             serve web/dist from disk (with `make dev`)
package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"

	"game-night/internal/server"
	"game-night/web"
)

func main() {
	port := flag.Int("port", envInt("PORT", 10000), "port to listen on")
	noOpen := flag.Bool("no-open", false, "don't open the game select page in a browser")
	dev := flag.Bool("dev", false, "serve web/dist from disk instead of the built-in copy")
	userDir := flag.String("dir", defaultUserDir(), "folder with extra games, or files that replace built-in ones")
	flag.Parse()

	srv := server.New(files(*dev, *userDir), *port)
	ln, err := srv.Listen()
	if errors.Is(err, server.ErrPortInUse) {
		log.Fatalf("Port %d is already in use (is Game Night already running?). Try another: -port %d", *port, *port+1)
	} else if err != nil {
		log.Fatal(err)
	}

	url := fmt.Sprintf("http://localhost:%d", *port)
	fmt.Printf("\n  GAME NIGHT is running\n  Game screen : %s\n  Phones      : %s   (same Wi-Fi)\n", url, srv.PadURL())
	if *userDir != "" {
		fmt.Printf("  Extra games : %s/games/\n", *userDir)
	}
	fmt.Println()
	if !*noOpen {
		openBrowser(url)
	}
	log.Fatal(srv.Serve(ln))
}

// The built-in games, with the user's folder on top: a game dropped in <dir>/games/<id>/ shows
// up next to them, and e.g. <dir>/games/football/teams.json replaces the built-in clubs.
func files(dev bool, userDir string) fs.FS {
	var base fs.FS = os.DirFS("web/dist")
	if !dev {
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
	return filepath.Join(dir, "game-night")
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
