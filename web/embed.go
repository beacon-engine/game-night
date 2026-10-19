//go:build !noweb

// Package web holds the built front end (run `make web` first; see build.ts).
package web

import "embed"

// Dist is web/dist, built into the binary. (Builds tagged `noweb`, like the TV app's, leave it out
// and serve the files from a folder instead: beacon-arcade -web DIR.)
//
//go:embed all:dist
var Dist embed.FS

const Embedded = true
