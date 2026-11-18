// Builds web/ into web/dist/, which the Go server embeds.
//
// Every app is a folder with an optional main.ts entry; everything else in it (html, json,
// models...) is copied next to the bundle, except READMEs, a game's source/ folder (the
// original art files the game's assets were made from; kept in git, never shipped) and its odin/
// folder (a game written in Odin: `make wasm` builds it into sim.wasm, which is shipped):
//   brand/          -> dist/brand/        the brand: brand.css, fonts, the mark (see brand/README.md)
//   hub/            -> dist/              the game select page
//   pad/            -> dist/pad/          the phone controller
//   racing/         -> dist/racing/       what the racing games share: code (bundled into each) and the car models
//   people/         -> dist/people/       the people in the 3D games: their models, their moves and the mesh decoder
//   armoury/        -> dist/armoury/      guns, ready to hold
//   cars/           -> dist/cars/         real cars cut into panels (tools/cars/), for any game that drives
//   games/<id>/     -> dist/games/<id>/   one folder per game
//
//   node build.ts            one-off production build
//   node build.ts --watch    rebuild on change (for `make dev`; also rebuilds a game's sim.wasm when
//                            its Odin changes, if Odin is installed)
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, watch } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist';
const watching = process.argv.includes('--watch');

interface App {
  src: string;
  out: string;
}

function apps(): App[] {
  const games = readdirSync('games', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ src: join('games', d.name), out: join(OUT, 'games', d.name) }));
  return [{ src: 'brand', out: join(OUT, 'brand') }, { src: 'hub', out: OUT }, { src: 'pad', out: join(OUT, 'pad') }, { src: 'racing', out: join(OUT, 'racing') }, { src: 'people', out: join(OUT, 'people') }, { src: 'armoury', out: join(OUT, 'armoury') }, { src: 'cars', out: join(OUT, 'cars') }, ...games];
}

const shipped = (f: string) => !/\.(ts|md)$/.test(f) && !f.endsWith('.gitkeep') && !/\/(source|odin)(\/|$)/.test(f);

function copyStatic(app: App) {
  cpSync(app.src, app.out, { recursive: true, filter: shipped });
}

// Rebuild a game's sim.wasm from its odin/ folder (scripts/wasm.sh), at most one build per game at
// a time; a change during a build builds again when it's done. The watcher below then copies the
// new sim.wasm into dist like any other file.
const odinBuilds = new Map<string, 'building' | 'again'>();
const odinWaits = new Map<string, ReturnType<typeof setTimeout>>();
const odinChanged = (game: string) => { // (an editor's save can be several file events: build once)
  clearTimeout(odinWaits.get(game));
  odinWaits.set(game, setTimeout(() => buildWasm(game), 150));
};
function buildWasm(game: string) {
  if (odinBuilds.has(game)) { odinBuilds.set(game, 'again'); return; }
  odinBuilds.set(game, 'building');
  spawn('../scripts/wasm.sh', [game], { stdio: 'inherit' }).on('close', (code) => {
    if (code === 0) console.log(`[odin] ${game}/sim.wasm rebuilt: reload the page`);
    const again = odinBuilds.get(game) === 'again';
    odinBuilds.delete(game);
    if (again) buildWasm(game);
  });
}

const list = apps();
// (not when watching: `make dev` has just built dist, and the server it starts alongside this is
// embedding it; emptying it now would pull the files out from under that build)
if (!watching) rmSync(OUT, { recursive: true, force: true });
for (const app of list) copyStatic(app);

const options: esbuild.BuildOptions = {
  entryPoints: list
    .filter((a) => existsSync(join(a.src, 'main.ts')))
    .map((a) => ({ in: join(a.src, 'main.ts'), out: join(a.out, 'main').slice(OUT.length + 1) })),
  outdir: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: watching, // (dev only: keeps the binary small)
  minify: !watching,
  logLevel: 'info',
};

if (watching) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  for (const app of list) {
    watch(app.src, { recursive: true }, (_, file) => {
      if (file && /^odin[\\/].*\.odin$/.test(file)) odinChanged(app.src.slice('games/'.length));
      else if (file && !file.endsWith('.ts')) copyStatic(app);
    });
  }
} else {
  await esbuild.build(options);
}
