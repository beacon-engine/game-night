# make                 build the web files and the beacon-arcade binary
# make dev             rebuild on change and serve from disk (http://localhost:10000)
# make check           type-check the TypeScript, vet and test the Go
# make release         archives for every platform in dist/ (what a GitHub release ships)
# make android         the Android TV app in dist/ (needs a JDK and the Android SDK)
# make tag V=1.2.0     tag a release (see RELEASING.md)

# the version comes from git tags: v1.2.0 on a tagged commit, v1.2.0-3-gabc1234 after it
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all web dev check release android tag clean

all: web
	go build -ldflags "$(LDFLAGS)" -o beacon-arcade .

web: web/node_modules
	cd web && npm run build

web/node_modules: web/package.json
	cd web && npm install --no-audit --no-fund
	touch web/node_modules

# (the watcher is stopped when the server is)
dev: web
	(cd web && exec node build.ts --watch) & watcher=$$!; trap "kill $$watcher" EXIT; go run . -dev

check: web
	cd web && npm run check
	go vet ./...
	go test ./...

release: web
	scripts/package.sh $(VERSION)

android: web
	scripts/android.sh $(VERSION)

tag:
	scripts/tag.sh $(V)

clean:
	rm -rf beacon-arcade dist web/dist android/app/build android/app/src/main/jniLibs android/app/src/main/assets
