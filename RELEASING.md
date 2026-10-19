# Releasing

Versions follow [Semantic Versioning](https://semver.org): `vMAJOR.MINOR.PATCH`.

- **PATCH** (0.1.0 → 0.1.1): bug fixes, nothing new to learn.
- **MINOR** (0.1.0 → 0.2.0): something new that doesn't break anything: a new game, a new option.
- **MAJOR** (1.x → 2.0.0): a break for people building on it: the phone protocol (`web/platform/protocol.ts`),
  the `@platform` API games use, or the format of `game.json` / `controls.json` / the user folder.
  While we're on 0.x, such breaks go in a MINOR release and are called out in the changelog.
- Pre-releases: `1.2.0-beta.1`. They're published as pre-releases on GitHub.

The git tag is the version: `make` stamps it into the binary (`beacon-arcade -version`), and between
releases a build says how far it is from the last one (`v0.1.0-3-gabc1234`).

## Making a release

1. Move what's under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) into a new section,
   `## [1.2.0] - YYYY-MM-DD`, and update the links at the bottom. Commit it on `main`.
2. `make tag V=1.2.0`. It checks the version is valid, newer than the last one, that your tree is clean
   and that the changelog has the section, then creates the tag.
3. `git push origin main v1.2.0`

Pushing the tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml): it checks
everything, builds the archives for each platform (`make release`), and publishes a GitHub release
with that changelog section as its notes. To try the packaging locally: `make release`, then look in `dist/`.

If a release goes wrong, don't move the tag: fix it and release the next PATCH.
