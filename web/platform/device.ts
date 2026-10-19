import { keyCode } from './dom.ts';

// What the screen this page runs on can handle, so games that would struggle aren't offered:
// a TV with 1 GB of memory shouldn't be asked to run 22 animated footballers.
//
// Each game says what it needs in game.json ("needs"):
//   'light'     2D (canvas). Runs anywhere, including small TVs.
//   'standard'  simple 3D: a few models, simple lighting.
//   'heavy'     big 3D scenes: many animated characters, shadows, large textures (football, racing grids).
//
// The device's tier is the heaviest it runs well, decided by its weakest part: memory, CPU cores,
// graphics features, and a short graphics test. Games check it before loading (requireDevice) and
// keep an eye on themselves while running (PerformanceGuard).

export type Tier = 'light' | 'standard' | 'heavy';
const ORDER: Tier[] = ['light', 'standard', 'heavy'];
export const canRun = (have: Tier, need: Tier) => ORDER.indexOf(have) >= ORDER.indexOf(need);

// How to call this device when talking to players: "this TV" in the TV app, "this device" elsewhere.
// Players get plain words (what works, what to do instead); the measurements go to the console.
export const thisDevice = (d: Pick<DeviceProfile, 'tv'>) => (d.tv ? 'this TV' : 'this device');

export interface DeviceProfile {
  tier: Tier;
  limit: string; // what holds it back ('1 GB of memory'): for developers (logged), not for players
  memoryGB: number | null;
  cores: number | null;
  gpu: string;
  webgl2: boolean;
  maxTexture: number;
  gpuMs: number | null; // the graphics test: ms per frame (lower is faster)
  tv: boolean; // running in the Beacon Arcade TV app
}

// The TV app (android/) describes the device to the page through this
interface AppDevice { memoryMB: number; lowRam: boolean; cores: number; model: string }
declare global {
  interface Window { GameNightApp?: { device(): string } }
  interface Navigator { deviceMemory?: number }
}

let cached: Promise<DeviceProfile> | null = null;
export const deviceProfile = () => (cached ??= measure());

async function measure(): Promise<DeviceProfile> {
  const app = readApp();
  const gl = probeGraphics();
  const memoryGB = app ? app.memoryMB / 1024 : navigator.deviceMemory ?? null;
  const cores = app?.cores ?? navigator.hardwareConcurrency ?? null;

  // each check caps the tier; the lowest cap wins and becomes the reason
  const caps: [Tier, string][] = [];
  const cap = (tier: Tier, why: string) => caps.push([tier, why]);
  if (memoryGB !== null) {
    if (memoryGB < 1.5 || app?.lowRam) cap('light', `${fmtGB(memoryGB)} of memory`);
    else if (memoryGB < 3) cap('standard', `${fmtGB(memoryGB)} of memory`);
  }
  if (cores !== null && cores < 4) cap('standard', `${cores} CPU cores`);
  if (!gl) cap('light', 'no 3D graphics (WebGL)');
  else {
    if (!gl.webgl2) cap('standard', 'older graphics (no WebGL 2)');
    if (gl.maxTexture < 4096) cap('standard', 'small graphics memory');
    if (gl.ms !== null && gl.ms > GPU_STANDARD_MS) cap('light', 'slow graphics');
    else if (gl.ms !== null && gl.ms > GPU_HEAVY_MS) cap('standard', 'slow graphics');
  }

  let tier: Tier = 'heavy', limit = '';
  for (const [t, why] of caps) {
    if (ORDER.indexOf(t) < ORDER.indexOf(tier)) { tier = t; limit = why; }
  }
  // developers can try another tier in a browser (?device=light); never in the TV app
  const forced = new URLSearchParams(location.search).get('device') as Tier | null;
  if (forced && ORDER.includes(forced) && !app) { tier = forced; limit = `a test setting (?device=${forced})`; }

  const profile: DeviceProfile = {
    tier, limit, memoryGB, cores, tv: !!app,
    gpu: gl?.renderer ?? 'none', webgl2: !!gl?.webgl2, maxTexture: gl?.maxTexture ?? 0, gpuMs: gl?.ms ?? null,
  };
  console.info('[device]', profile);
  return profile;
}

const fmtGB = (gb: number) => (gb < 1 ? `${Math.round(gb * 1024)} MB` : `${Math.round(gb * 10) / 10} GB`);

function readApp(): AppDevice | null {
  try {
    return window.GameNightApp ? (JSON.parse(window.GameNightApp.device()) as AppDevice) : null;
  } catch {
    return null;
  }
}

// --- the graphics test ------------------------------------------------------------------------
// A full-screen pass of a fragment shader with roughly the per-pixel work of a lit 3D scene, at
// 720p, timed with a forced finish. An Apple M-series laptop takes ~1 ms.
// The cut-offs are first guesses: tune them with real TVs (the profile is logged to the console).
const GPU_HEAVY_MS = 4;
const GPU_STANDARD_MS = 20;
const TEST_W = 1280, TEST_H = 720;

interface Graphics { webgl2: boolean; maxTexture: number; renderer: string; ms: number | null }

function probeGraphics(): Graphics | null {
  const canvas = document.createElement('canvas');
  canvas.width = TEST_W;
  canvas.height = TEST_H;
  const gl2 = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  const gl = gl2 ?? canvas.getContext('webgl', { antialias: false });
  if (!gl) return null;
  // the real chip name when the browser tells it (otherwise just 'WebKit WebGL')
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || 'unknown');
  const result: Graphics = { webgl2: !!gl2, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, renderer, ms: null };

  // the test is the same every time on the same hardware: remember it
  const key = `gn.gpu2.${renderer}`; // (bump the number when the test changes)
  try {
    const saved = localStorage.getItem(key);
    if (saved) return { ...result, ms: Number(saved) };
  } catch { /* storage unavailable */ }

  result.ms = timeShader(gl);
  try { if (result.ms !== null) localStorage.setItem(key, String(result.ms)); } catch { /* fine */ }
  gl.getExtension('WEBGL_lose_context')?.loseContext(); // give the memory back now
  return result;
}

function timeShader(gl: WebGLRenderingContext | WebGL2RenderingContext): number | null {
  const vs = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  const fs = `precision mediump float;
    uniform float t;
    void main() {
      vec2 uv = gl_FragCoord.xy / vec2(${TEST_W}.0, ${TEST_H}.0);
      vec3 c = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float f = float(i);
        c += 0.04 * vec3(sin(uv.x * 9.0 + f + t), cos(uv.y * 7.0 - f), sin((uv.x + uv.y) * 5.0 + f * 0.5));
        uv = fract(uv * 1.7 + 0.13);
      }
      gl_FragColor = vec4(c, 1.0);
    }`;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, TEST_W, TEST_H);
  const tLoc = gl.getUniformLocation(prog, 't');
  const px = new Uint8Array(4);
  const frame = (i: number) => {
    gl.uniform1f(tLoc, i);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU to finish
  };
  frame(0); frame(1); // warm up (shader compile, first upload)
  const frames = 6, start = performance.now();
  for (let i = 0; i < frames; i++) frame(i + 2);
  return Math.round(((performance.now() - start) / frames) * 10) / 10;
}

// --- in games -------------------------------------------------------------------------------------

// Call before loading anything big. Reads "needs" from the game's game.json. If this device can't run
// the game, shows why and goes back to the game select page; the returned promise then never
// resolves, so the game stops loading.
export async function requireDevice(): Promise<DeviceProfile> {
  const [d, game] = await Promise.all([
    deviceProfile(),
    fetch('game.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ name?: string; needs?: Tier }>),
  ]);
  const needs = game.needs && ORDER.includes(game.needs) ? game.needs : 'standard';
  const gameName = game.name ?? 'This game';
  if (canRun(d.tier, needs)) return d;
  notice(`${gameName} can't run on ${thisDevice(d)}`,
    `It needs a more powerful ${d.tv ? 'TV' : 'device'}, like a laptop. Pick another game: the phones stay connected.`,
    'Back to the games', 0);
  return new Promise<never>(() => {});
}

export interface GuardOptions {
  targetFps: number; // what the game aims for
  onStruggle?: (level: number) => void; // 1, 2...: lower the quality a step; the game decides how
  maxLevel?: number; // after this many steps, give up: tell the players and go back to the games
}

// Watches a running game. Call frame() once per drawn frame. If it runs well below its target for a
// few seconds, the game is asked to lower its quality; if that doesn't help, it stops the game.
// Losing the 3D graphics (out of memory) stops it too: watchCanvas().
export class PerformanceGuard {
  level = 0;
  private times: number[] = [];
  private badSince: number | null = null; // when it dropped below target
  private started = performance.now();
  private stopped = false;

  constructor(private o: GuardOptions) {}

  frame(now = performance.now()) {
    if (this.stopped) return;
    this.times.push(now);
    while (this.times.length && now - this.times[0] > 3000) this.times.shift();
    if (now - this.started < 6000 || this.times.length < 10) return; // (loading and warm-up are slow everywhere)
    const fps = ((this.times.length - 1) * 1000) / (now - this.times[0]);
    if (fps >= this.o.targetFps * 0.6) { this.badSince = null; return; }
    this.badSince ??= now;
    if (now - this.badSince < 4000) return; // below target for 4 s straight
    this.badSince = null;
    this.times = [];
    this.started = now - 3000; // give the new quality a moment to settle
    this.level++;
    if (this.level > (this.o.maxLevel ?? 2)) return this.stop();
    this.o.onStruggle?.(this.level);
  }

  // The browser drops the 3D graphics when the device runs out of memory: end the game cleanly
  watchCanvas(canvas: HTMLCanvasElement) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
    });
  }

  private stop() {
    this.stopped = true;
    deviceProfile().then((d) => notice(`That was too much for ${thisDevice(d)}`,
      'We stopped the game so everything stays smooth. The lighter games will run better here.', 'Back to the games', 8));
  }
}

// A full-screen notice in the brand, with a way back to the game select page
function notice(title: string, text: string, action: string, autoBackSeconds: number) {
  const el = document.createElement('div');
  el.className = 'grid-bg';
  el.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;justify-content:center;gap:18px;padding:8vw;background:var(--ink-0)';
  el.innerHTML = `<span class="eyebrow">Beacon Arcade</span><h1 class="h1"></h1><p class="muted" style="max-width:52ch;font-size:18px;margin:0"></p>
    <button class="btn btn-primary btn-lg" style="align-self:flex-start"></button>`;
  el.querySelector('h1')!.textContent = title;
  el.querySelector('p')!.textContent = text;
  const btn = el.querySelector('button')!;
  btn.textContent = action;
  btn.addEventListener('click', () => { location.href = '/'; });
  addEventListener('keydown', (e) => { if (['Enter', 'Escape'].includes(keyCode(e))) location.href = '/'; });
  document.body.append(el);
  btn.focus();
  if (autoBackSeconds) setTimeout(() => { location.href = '/'; }, autoBackSeconds * 1000);
}
