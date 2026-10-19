// Builds web/ into web/dist/, which the Go server embeds.
//
// Every app is a folder with an optional main.ts entry; everything else in it (html, json,
// models...) is copied next to the bundle, except READMEs and a game's source/ folder (the
// original art files the game's assets were made from; kept in git, never shipped):
//   brand/          -> dist/brand/        the brand: brand.css, fonts, the mark (see brand/README.md)
//   hub/            -> dist/              the game select page
//   pad/            -> dist/pad/          the phone controller
//   games/<id>/     -> dist/games/<id>/   one folder per game
//
//   node build.ts            one-off production build
//   node build.ts --watch    rebuild on change (for `make dev`)
import * as esbuild from 'esbuild';
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
  return [{ src: 'brand', out: join(OUT, 'brand') }, { src: 'hub', out: OUT }, { src: 'pad', out: join(OUT, 'pad') }, ...games];
}

const shipped = (f: string) => !/\.(ts|md)$/.test(f) && !f.endsWith('.gitkeep') && !/\/source(\/|$)/.test(f);

function copyStatic(app: App) {
  cpSync(app.src, app.out, { recursive: true, filter: shipped });
}

const list = apps();
rmSync(OUT, { recursive: true, force: true });
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
      if (file && !file.endsWith('.ts')) copyStatic(app);
    });
  }
} else {
  await esbuild.build(options);
}
