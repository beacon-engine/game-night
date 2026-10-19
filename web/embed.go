// Package web holds the built front end (run `make web` first; see build.ts).
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
