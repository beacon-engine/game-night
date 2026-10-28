// A rally stage, from its description in stages.json: a loop of loose road laid over rough, hilly
// land. The land is noise (rolling hills, with bumps on top); the road wanders round the middle, its
// height smoothed so it can be driven, with crests that throw the cars into the air, dips that bottom
// them out, and a ford. It's all baked into one grid of heights and surfaces, 2.5 m apart, which the
// physics drives on and the scene draws, triangle for triangle the same. Along the road: `s`, metres
// from the start line; across it: `d`, + to the right of travel. No graphics here.
import * as THREE from 'three';
import { noise2, seeded } from '@world/draw.ts';
import { SURFACE_LIST, type Ground, type Post, type Surface } from './physics.ts';

export interface StageSpec {
  id: string;
  name: string;
  about: string; // a line for the lobby
  seed: number; // the same stage every time
  look: 'forest' | 'canyon';
  time: 'day' | 'dusk';
  size: number; // m, about how far across the loop is
  hills: number; // m, how far the land rises and falls
  width: number; // m, the road
  jumps: number; // crests that launch you
  dips: number; // compressions that bottom you out
  ford: boolean; // a splash through water
}

export interface Feature { s: number; kind: 'crest' | 'dip' | 'ford'; size: number }
export interface Scenery { x: number; z: number; y: number; size: number; kind: 'tree' | 'rock' | 'cactus' }
export interface Where { s: number; d: number; dist: number } // on the road: along, across, how far from its middle

const CELL = 2.5; // m between the grid's heights
const MARGIN = 260; // m of land round the road
const SHOULDER = 1.5; // m of loose stuff beside the road
const BLEND = 16; // m over which the road's banks blend into the land
const GRADE = 0.13; // the steepest the road climbs or falls
const BUCKET = 12; // m: the posts are looked up in squares this size
const START = 120; // m of tarmac after the line (and 60 before it)

export class Stage implements Ground {
  readonly length: number;
  readonly width: number;
  // the road, a sample a metre
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly hs: Float32Array; // its height
  readonly hx: Float32Array; // which way it runs
  readonly hz: Float32Array;
  readonly ks: Float32Array; // how sharply it turns (1/radius, + right)
  readonly surfs: Surface[];
  readonly features: Feature[] = [];
  readonly scenery: Scenery[] = [];
  readonly water: { x: number; z: number; level: number; r: number } | null = null;
  // the grid
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  readonly surfaces: Uint8Array;
  readonly natural: (x: number, z: number) => number; // the land without the road
  private buckets: Post[][] = [];
  private bx = 0;
  private roadIndex = new Map<number, number[]>(); // samples every 2 m, by 24 m square

  constructor(readonly spec: StageSpec) {
    const rnd = seeded(spec.seed), land = noise2(spec.seed), grain = noise2(spec.seed + 7);
    this.width = spec.width;
    const hills = (x: number, z: number) => spec.hills * (land(x / 380, z / 380, 3) - 0.5) * 2;
    this.natural = (x, z) => hills(x, z) + 0.9 * (grain(x / 16, z / 16, 2) - 0.5) + 0.35 * (grain(x / 5, z / 5, 1) - 0.5);

    // --- the road's line: a loop round the middle, wandering in and out --------------------------
    const line = loop(spec, rnd);
    const L = (this.length = line.length / 2);
    this.xs = new Float32Array(L); this.zs = new Float32Array(L);
    this.hx = new Float32Array(L); this.hz = new Float32Array(L); this.ks = new Float32Array(L);
    // start where it's straightest, so the grid lines up on a straight
    const raw = Array.from({ length: L }, (_, i) => ({ x: line[i * 2], z: line[i * 2 + 1] }));
    const at = (i: number) => raw[((i % L) + L) % L];
    const head = (i: number) => { const a = at(i + 1), b = at(i - 1); return Math.atan2(a.z - b.z, a.x - b.x); };
    const turn = raw.map((_, i) => wrapAngle(head(i + 3) - head(i - 3)) / 6);
    let start = 0, best = Infinity;
    for (let i = 0; i < L; i += 4) {
      let worst = 0;
      for (let j = -70; j <= 70; j += 5) worst = Math.max(worst, Math.abs(turn[(i + j + L) % L]));
      if (worst < best) { best = worst; start = i; }
    }
    for (let i = 0; i < L; i++) {
      const j = (i + start) % L, a = head(j);
      this.xs[i] = raw[j].x; this.zs[i] = raw[j].z;
      this.hx[i] = Math.cos(a); this.hz[i] = Math.sin(a);
      this.ks[i] = turn[j];
    }

    // --- its height: the land under it, smoothed and not too steep, then the crests and dips ------
    let h = Float32Array.from({ length: L }, (_, i) => hills(this.xs[i], this.zs[i]));
    for (let pass = 0; pass < 2; pass++) h = boxFilter(h, 40);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < L * 2; i++) { const a = h[(i - 1) % L]; h[i % L] = clamp(h[i % L], a - GRADE, a + GRADE); }
      for (let i = L * 2; i > 0; i--) { const a = h[i % L]; h[(i - 1) % L] = clamp(h[(i - 1) % L], a - GRADE, a + GRADE); }
    }
    // nothing tighter than k from a little before s to a while after (a jump needs somewhere to land)
    const straightish = (s: number, k: number, after: number) => {
      for (let j = -40; j <= after; j += 3) if (Math.abs(this.ks[(s + j + L) % L]) > k) return false;
      return true;
    };
    const place = (kind: Feature['kind'], size: number, k: number, after = 40) => {
      for (let tries = 0; tries < 500; tries++) {
        const s = Math.floor(200 + rnd() * (L - 340));
        if (!straightish(s, k, after) || this.features.some((f) => Math.abs(gapOf(f.s, s, L)) < 170)) continue;
        this.features.push({ s, kind, size });
        return;
      }
    };
    if (spec.ford) place('ford', 1.4, 1 / 80);
    for (let i = 0; i < spec.jumps; i++) place('crest', 1.9 + rnd() * 0.8, 1 / 50, 60);
    for (let i = 0; i < spec.dips; i++) place('dip', 0.9 + rnd() * 0.5, 1 / 60);
    for (const f of this.features) {
      const [a, w] = f.kind === 'crest' ? [f.size, 15 + rnd() * 3] : f.kind === 'dip' ? [-f.size, 7 + rnd() * 2] : [-f.size, 18];
      for (let j = -Math.ceil(w * 3); j <= w * 3; j++) h[(f.s + j + L) % L] += a * Math.exp(-((j / w) ** 2));
    }
    this.hs = h;
    const ford = this.features.find((f) => f.kind === 'ford');
    if (ford) this.water = { x: this.xs[ford.s], z: this.zs[ford.s], level: h[ford.s] + 0.45, r: 30 };

    // what the road is made of: tarmac by the start, then gravel and dirt in stretches
    const [main, other] = spec.look === 'forest' ? ['gravel', 'dirt'] as const : ['dirt', 'gravel'] as const;
    this.surfs = Array.from({ length: L }, (_, s) => s < START || s > L - 60 ? 'tarmac' : grain(s / 140, 9.5, 2) > 0.6 ? other : main);

    // --- the grid: the road blended into the land ------------------------------------------------------
    for (let i = 0; i < L; i += 2) {
      const key = this.square(this.xs[i], this.zs[i]);
      if (!this.roadIndex.has(key)) this.roadIndex.set(key, []);
      this.roadIndex.get(key)!.push(i);
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < L; i++) { minX = Math.min(minX, this.xs[i]); maxX = Math.max(maxX, this.xs[i]); minZ = Math.min(minZ, this.zs[i]); maxZ = Math.max(maxZ, this.zs[i]); }
    this.x0 = minX - MARGIN; this.z0 = minZ - MARGIN;
    this.nx = Math.ceil((maxX - minX + MARGIN * 2) / CELL) + 1;
    this.nz = Math.ceil((maxZ - minZ + MARGIN * 2) / CELL) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    this.surfaces = new Uint8Array(this.nx * this.nz);
    const W = spec.width, near: Where = { s: 0, d: 0, dist: 0 };
    const offroad = SURFACE_LIST.indexOf(spec.look === 'forest' ? 'grass' : 'dirt');
    const shoulder = SURFACE_LIST.indexOf(main), water = SURFACE_LIST.indexOf('water');
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + i * CELL, z = this.z0 + j * CELL, k = j * this.nx + i, nat = this.natural(x, z);
      if (!this.nearest(x, z, near) || near.dist > W / 2 + SHOULDER + BLEND) { this.heights[k] = nat; this.surfaces[k] = offroad; continue; }
      const edge = near.dist - W / 2;
      const road = this.roadHeight(near.s) - 0.06 * (near.dist / (W / 2)) ** 2 + 0.08 * (grain(x / 6, z / 6, 1) - 0.5); // (a crown, and a few ruts)
      if (edge <= 0) this.heights[k] = road;
      else {
        const t = smooth(clamp((edge - SHOULDER) / BLEND, 0, 1));
        const ditch = -0.5 * Math.exp(-(((edge - SHOULDER - 1.5) / 1.4) ** 2));
        this.heights[k] = (road + ditch) * (1 - t) + nat * t;
      }
      this.surfaces[k] = edge <= 0 ? SURFACE_LIST.indexOf(this.surfs[Math.floor(near.s) % L]) : edge <= SHOULDER ? shoulder : offroad;
      const wt = this.water;
      if (wt && this.heights[k] < wt.level && (x - wt.x) ** 2 + (z - wt.z) ** 2 < wt.r ** 2) this.surfaces[k] = water;
    }

    // --- trees, rocks and cacti, and the posts the cars hit --------------------------------------------
    this.bx = Math.ceil((this.nx * CELL) / BUCKET);
    this.buckets = Array.from({ length: this.bx * Math.ceil((this.nz * CELL) / BUCKET) }, () => []);
    const kinds: [Scenery['kind'], number][] = spec.look === 'forest' ? [['tree', 2600], ['rock', 140]] : [['rock', 650], ['cactus', 500]];
    for (const [kind, count] of kinds) {
      for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
        const x = this.x0 + rnd() * (this.nx - 1) * CELL, z = this.z0 + rnd() * (this.nz - 1) * CELL;
        const edge = this.nearest(x, z, near) ? near.dist - W / 2 : Infinity;
        if (edge < 7 || (edge < 30 && rnd() < 0.4) || this.surface(x, z) === 'water') continue;
        const size = kind === 'rock' ? 0.8 + rnd() ** 2 * 3 : 0.7 + rnd() * 0.9, y = this.height(x, z);
        this.scenery.push({ x, z, y, size, kind });
        this.addPost({ x, z, r: kind === 'tree' ? 0.35 * size : kind === 'rock' ? size : 0.4, top: y + (kind === 'tree' ? 9 * size : kind === 'rock' ? size * 0.9 : 5) });
        n++;
      }
    }
    // the start gantry's legs
    for (const side of [-1, 1]) {
      const p = this.point(0, side * (W / 2 + 1.2));
      this.addPost({ x: p.x, z: p.z, r: 0.3, top: p.y + 8 });
    }
  }

  // --- the ground, for the physics -----------------------------------------------------------------------
  // The grid's triangles: each square is split from its first corner to the opposite one
  height(x: number, z: number) {
    const { nx, heights: H } = this;
    let fx = clamp((x - this.x0) / CELL, 0, nx - 1.0001), fz = clamp((z - this.z0) / CELL, 0, this.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), k = j * nx + i;
    fx -= i; fz -= j;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + nx], h11 = H[k + nx + 1];
    return fx > fz ? h00 + fx * (h10 - h00) + fz * (h11 - h10) : h00 + fz * (h01 - h00) + fx * (h11 - h01);
  }

  normal(x: number, z: number, out: THREE.Vector3) {
    const { nx, heights: H } = this;
    let fx = clamp((x - this.x0) / CELL, 0, nx - 1.0001), fz = clamp((z - this.z0) / CELL, 0, this.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), k = j * nx + i;
    fx -= i; fz -= j;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + nx], h11 = H[k + nx + 1];
    const [dx, dz] = fx > fz ? [h10 - h00, h11 - h10] : [h11 - h01, h01 - h00];
    return out.set(-dx / CELL, 1, -dz / CELL).normalize();
  }

  surface(x: number, z: number): Surface {
    const i = clamp(Math.round((x - this.x0) / CELL), 0, this.nx - 1), j = clamp(Math.round((z - this.z0) / CELL), 0, this.nz - 1);
    return SURFACE_LIST[this.surfaces[j * this.nx + i]];
  }

  posts(x: number, z: number): readonly Post[] {
    const i = Math.floor((x - this.x0) / BUCKET), j = Math.floor((z - this.z0) / BUCKET);
    return i < 0 || j < 0 || i >= this.bx ? NONE : this.buckets[j * this.bx + i] ?? NONE;
  }

  // --- the road ----------------------------------------------------------------------------------------
  wrap(s: number) { return ((s % this.length) + this.length) % this.length; }

  // The shortest way from b to a along the road: + if a is ahead
  gap(a: number, b: number) { return gapOf(a, b, this.length); }

  private lerp(arr: Float32Array, s: number) {
    const u = this.wrap(s), i = Math.floor(u), t = u - i;
    return arr[i] * (1 - t) + arr[(i + 1) % this.length] * t;
  }

  roadHeight(s: number) { return this.lerp(this.hs, s); }
  curve(s: number) { return this.ks[Math.floor(this.wrap(s))]; }
  heading(s: number) { const i = Math.floor(this.wrap(s)); return Math.atan2(this.hz[i], this.hx[i]); }

  // A point on the stage: s along the road, d across it (+ right), on the ground
  point(s: number, d: number, out = new THREE.Vector3()) {
    const i = Math.floor(this.wrap(s)), x = this.lerp(this.xs, s) - this.hz[i] * d, z = this.lerp(this.zs, s) + this.hx[i] * d;
    return out.set(x, this.height(x, z), z);
  }

  // Where (x, z) is on the road, looking near `s` (for following a car round): false if it's lost
  locate(s: number, x: number, z: number, out: Where, reach = 40) {
    const L = this.length, c = Math.round(this.wrap(s));
    let best = Infinity, at = c;
    for (let j = -reach; j <= reach; j++) {
      const i = (c + j + L) % L, d2 = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d2 < best) { best = d2; at = i; }
    }
    return this.refine(at, x, z, out);
  }

  // The nearest bit of road anywhere (within 24 m or so of a sample): false if none
  nearest(x: number, z: number, out: Where) {
    let best = Infinity, at = -1;
    const gx = Math.floor(x / 24), gz = Math.floor(z / 24);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const i of this.roadIndex.get(key(gx + a, gz + b)) ?? []) {
        const d2 = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
        if (d2 < best) { best = d2; at = i; }
      }
    }
    if (at < 0) return false;
    for (const i of [at - 1, at + 1]) { // (the samples in the index are 2 m apart)
      const k = (i + this.length) % this.length, d2 = (this.xs[k] - x) ** 2 + (this.zs[k] - z) ** 2;
      if (d2 < best) { best = d2; at = k; }
    }
    return this.refine(at, x, z, out);
  }

  // From the nearest sample to the exact spot, along the road's direction there
  private refine(i: number, x: number, z: number, out: Where) {
    const dx = x - this.xs[i], dz = z - this.zs[i];
    const along = clamp(dx * this.hx[i] + dz * this.hz[i], -1, 1);
    out.s = this.wrap(i + along);
    out.d = -dx * this.hz[i] + dz * this.hx[i];
    out.dist = Math.abs(out.d);
    return true;
  }

  // The co-driver's next call: the next turn and how tight, and what's on the road
  note(s: number) {
    const calls: string[] = [];
    for (let x = 15; x < 150; x += 3) {
      const k = this.curve(s + x);
      if (Math.abs(k) < 1 / 130) continue;
      let tightest = 0;
      for (let y = x; y < x + 60; y += 3) tightest = Math.max(tightest, Math.abs(this.curve(s + y)));
      const r = 1 / tightest, grade = r < 22 ? 'hairpin' : r < 35 ? '2' : r < 55 ? '3' : r < 80 ? '4' : r < 115 ? '5' : '6';
      calls.push(grade === 'hairpin' ? `Hairpin ${k > 0 ? 'right' : 'left'}` : `${k > 0 ? 'Right' : 'Left'} ${grade}`);
      break;
    }
    const f = this.features.map((f) => ({ f, ahead: this.gap(f.s, s) })).filter((x) => x.ahead > -10 && x.ahead < 130).sort((a, b) => a.ahead - b.ahead)[0];
    if (f) calls.push(f.f.kind === 'ford' ? 'water splash' : f.f.kind === 'dip' ? 'dip' : f.f.size > 2.3 ? 'big jump' : 'over crest');
    return calls.join(' · ') || 'Straight';
  }

  // Where each car starts: two by two behind the line
  gridSpot(i: number) {
    return { s: -14 - Math.floor(i / 2) * 9, d: (i % 2 ? 1 : -1) * Math.min(2.6, this.width / 4) };
  }

  private addPost(p: Post) {
    const m = p.r + 3.5; // (a car's spheres reach this far from its middle)
    for (let j = Math.floor((p.z - m - this.z0) / BUCKET); j <= Math.floor((p.z + m - this.z0) / BUCKET); j++) {
      for (let i = Math.floor((p.x - m - this.x0) / BUCKET); i <= Math.floor((p.x + m - this.x0) / BUCKET); i++) {
        if (i >= 0 && j >= 0 && i < this.bx) this.buckets[j * this.bx + i]?.push(p);
      }
    }
  }

  private square(x: number, z: number) { return key(Math.floor(x / 24), Math.floor(z / 24)); }
}

const NONE: Post[] = [];
const key = (i: number, j: number) => (i + 5000) * 10000 + (j + 5000);

// The road's line: a lopsided oval, with waves along it from side to side (whole numbers of them
// round the lap, so it still joins up), measured out a metre at a time. The waves make the bends:
// each is no tighter than a hairpin on its own, and if together they make one too tight, they're
// all made a little smaller until they don't.
function loop(spec: StageSpec, rnd: () => number) {
  const R = (spec.size / 2) * 0.8, h2 = 0.1 + rnd() * 0.12, p2 = rnd() * 6.28, h3 = 0.04 + rnd() * 0.08, p3 = rnd() * 6.28;
  const base: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const a = (i / 4000) * Math.PI * 2, r = R * (1 + h2 * Math.sin(2 * a + p2) + h3 * Math.sin(3 * a + p3));
    base.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  const n = base.length / 2, along = [0];
  for (let i = 1; i <= n; i++) along.push(along[i - 1] + Math.hypot(base[(i % n) * 2] - base[(i - 1) * 2], base[(i % n) * 2 + 1] - base[(i - 1) * 2 + 1]));
  const P = along[n];
  const waves = [0, 1, 2].map(() => {
    const count = Math.max(2, Math.round(P / (90 + rnd() * 150))), k = (2 * Math.PI * count) / P;
    return { k, phase: rnd() * 6.28, amp: Math.min(38, 1 / (k * k * 22)) * (0.5 + rnd() * 0.5) };
  });
  for (let scale = 1; ; scale *= 0.85) {
    const dense: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i + 1) % n, b = (i - 1 + n) % n;
      let nx = -(base[a * 2 + 1] - base[b * 2 + 1]), nz = base[a * 2] - base[b * 2];
      const len = Math.hypot(nx, nz);
      nx /= len; nz /= len;
      const off = scale * waves.reduce((sum, w) => sum + w.amp * Math.sin(w.k * along[i] + w.phase), 0);
      dense.push(base[i * 2] + nx * off, base[i * 2 + 1] + nz * off);
    }
    const out = measure(dense);
    if (tightest(out) < 1 / 16 || scale < 0.3) return out;
  }
}

// A point every metre along a closed line
function measure(dense: number[]) {
  const out: number[] = [], n = dense.length / 2;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const ax = dense[i * 2], az = dense[i * 2 + 1], bx = dense[((i + 1) % n) * 2], bz = dense[((i + 1) % n) * 2 + 1];
    const seg = Math.hypot(bx - ax, bz - az);
    for (let u = carry; u < seg; u += 1) out.push(ax + ((bx - ax) * u) / seg, az + ((bz - az) * u) / seg);
    carry = (carry - seg) % 1;
    if (carry < 0) carry += 1;
  }
  return out;
}

// How sharply the line's tightest bend turns (1/radius), over 8 m
function tightest(line: number[]) {
  const m = line.length / 2, ang = (i: number) => {
    const a = (((i + 1) % m) + m) % m, b = (((i - 1) % m) + m) % m;
    return Math.atan2(line[a * 2 + 1] - line[b * 2 + 1], line[a * 2] - line[b * 2]);
  };
  let tight = 0;
  for (let i = 0; i < m; i++) tight = Math.max(tight, Math.abs(wrapAngle(ang(i + 4) - ang(i - 4)) / 8));
  return tight;
}

function boxFilter(a: Float32Array, r: number) {
  const n = a.length, out = new Float32Array(n);
  let sum = 0;
  for (let j = -r; j <= r; j++) sum += a[(j + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * r + 1);
    sum += a[(i + r + 1) % n] - a[(i - r + n) % n];
  }
  return out;
}

const gapOf = (a: number, b: number, L: number) => ((((a - b) % L) + L * 1.5) % L) - L / 2;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
