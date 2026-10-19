//go:build noweb

package web

import "embed"

// Dist is empty in `noweb` builds: the web files are served from a folder (game-night -web DIR).
var Dist embed.FS

const Embedded = false
