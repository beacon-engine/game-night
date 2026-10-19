# make          build the web files and the game-night binary
# make dev      rebuild on change and serve from disk (open http://localhost:10000)
# make check    type-check the TypeScript and vet + test the Go
# make release  binaries for macOS, Windows and Linux in dist/

.PHONY: all web dev check release clean

all: web
	go build -o game-night .

web: web/node_modules
	cd web && npm run build

web/node_modules: web/package.json
	cd web && npm install --no-audit --no-fund
	touch web/node_modules

# (the watcher is stopped when the server is)
dev: web
	(cd web && exec node build.ts --watch) & watcher=$$!; trap "kill $$watcher" EXIT; go run . -dev

check: web/node_modules
	cd web && npm run check
	go vet ./...
	go test ./...

release: web
	GOOS=darwin GOARCH=arm64 go build -o dist/game-night-macos-arm64 .
	GOOS=darwin GOARCH=amd64 go build -o dist/game-night-macos-intel .
	GOOS=windows GOARCH=amd64 go build -o dist/game-night-windows.exe .
	GOOS=linux GOARCH=amd64 go build -o dist/game-night-linux .

clean:
	rm -rf game-night dist web/dist
