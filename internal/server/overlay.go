package server

import (
	"errors"
	"io/fs"
	"sort"
)

// Overlay stacks file systems: a file is read from the first layer that has it, and folder
// listings are merged. Used to put a user's folder (extra games, edited teams.json...) over
// the files built into the binary.
type Overlay []fs.FS

func (o Overlay) Open(name string) (fs.File, error) {
	for _, layer := range o {
		f, err := layer.Open(name)
		if err == nil || !errors.Is(err, fs.ErrNotExist) {
			return f, err
		}
	}
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (o Overlay) ReadDir(name string) ([]fs.DirEntry, error) {
	seen := map[string]fs.DirEntry{}
	found := false
	for _, layer := range o {
		entries, err := fs.ReadDir(layer, name)
		if err != nil {
			continue
		}
		found = true
		for _, e := range entries {
			if _, ok := seen[e.Name()]; !ok {
				seen[e.Name()] = e
			}
		}
	}
	if !found {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	out := make([]fs.DirEntry, 0, len(seen))
	for _, e := range seen {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name() < out[j].Name() })
	return out, nil
}
