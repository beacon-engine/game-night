#!/bin/sh
# Tags a release after checking it's ready. Usage: scripts/tag.sh 1.2.0   (or: make tag V=1.2.0)
# Then: git push origin v1.2.0   -> GitHub Actions builds and publishes the release.
set -eu
v=${1:?usage: scripts/tag.sh <version>, e.g. 1.2.0}
v=${v#v}
tag="v$v"

fail() { echo "error: $*" >&2; exit 1; }

# MAJOR.MINOR.PATCH, optionally -prerelease (e.g. 1.2.0-beta.1)
echo "$v" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$' \
  || fail "$v is not a semantic version (MAJOR.MINOR.PATCH)"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "$tag already exists"
[ -z "$(git status --porcelain)" ] || fail "commit or stash your changes first"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "release from main"
grep -q "^## \[$v\]" CHANGELOG.md || fail "CHANGELOG.md has no '## [$v]' section"

# must be newer than the last release
last=$(git tag --list 'v*' --sort=-v:refname | head -n1)
if [ -n "$last" ]; then
  newest=$(printf '%s\n%s\n' "${last#v}" "$v" | sort -V | tail -n1)
  [ "$newest" = "$v" ] && [ "${last#v}" != "$v" ] || fail "$tag is not newer than $last"
fi

git tag -a "$tag" -m "game-night $tag"
echo "Tagged $tag. Publish it with:  git push origin main $tag"
