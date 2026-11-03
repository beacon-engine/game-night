// The battlegrounds, as numbers: how big, what stands on the floor (rocks, mesas, trees, buildings: they
// block bots, shots and sight), where the enemy drives in from, and how well tyres grip. The floor is flat;
// battle.ts draws the rest (walls, sky, light). No imports, so the rules run anywhere (balance.ts, in Node).

// Something in the way: round (r across), or a box (half-sizes w by d along x and z) when w is set
export interface Rock { x: number; z: number; r: number; h: number; w?: number; d?: number; kind: 'rock' | 'pillar' | 'mesa' | 'tree' | 'building' | 'car' | 'barrier' }
export type Look = 'quarry' | 'desert' | 'city' | 'snow';
export interface Arena { id: Look; name: string; radius: number; rocks: Rock[]; spawns: [number, number][]; grip: number }

export function arena(id: Look): Arena {
  switch (id) {
    case 'desert': return desert();
    case 'city': return city();
    case 'snow': return snow();
    default: return quarry();
  }
}

// Scatter round things over a disc, apart from each other and from the middle (where you start)
function scatter(rocks: Rock[], rnd: () => number, n: number, radius: number, from: number, to: number, size: () => [number, number], kind: Rock['kind']) {
  for (let i = 0, tries = 0; i < n && tries < n * 80; tries++) {
    const a = rnd() * Math.PI * 2, d = from + rnd() * (to - from), [r, h] = size(), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x, z) < radius - r - 4 && rocks.every((o) => Math.hypot(o.x - x, o.z - z) > (o.w ? Math.hypot(o.w, o.d!) : o.r) + r + 5)) { rocks.push({ x, z, r, h, kind }); i++; }
  }
}
const ring = (n: number, radius: number, turn = 0.2) => Array.from({ length: n }, (_, i): [number, number] => {
  const a = (i / n) * Math.PI * 2 + turn;
  return [Math.cos(a) * radius, Math.sin(a) * radius];
});

// The quarry: a round pit of gravel ringed by terraced rock walls, boulders all over its floor and a few
// tall pillars left standing where the stone was cut round them
function quarry(): Arena {
  const rnd = seeded(7), rocks: Rock[] = [], radius = 115;
  scatter(rocks, rnd, 16, radius, 22, 100, () => [3 + rnd() * 3, 9 + rnd() * 12], 'pillar');
  scatter(rocks, rnd, 60, radius, 16, 108, () => { const r = 1.2 + rnd() * 2.6; return [r, r * (0.8 + rnd() * 0.6)]; }, 'rock');
  return { id: 'quarry', name: 'Quarry', radius, rocks, spawns: ring(16, radius - 8), grip: 1 };
}

// The desert canyon: wide open red sand between a few huge flat-topped mesas, a scatter of boulders, and
// tyres that slide a little
function desert(): Arena {
  const rnd = seeded(21), rocks: Rock[] = [], radius = 140;
  scatter(rocks, rnd, 11, radius, 30, 115, () => [8 + rnd() * 7, 14 + rnd() * 14], 'mesa');
  scatter(rocks, rnd, 34, radius, 18, 130, () => { const r = 1.4 + rnd() * 2.4; return [r, r * (0.7 + rnd() * 0.5)]; }, 'rock');
  return { id: 'desert', name: 'Desert canyon', radius, rocks, spawns: ring(18, radius - 8), grip: 0.8 };
}

// The night city: a grid of blocks with streets between (a plaza in the middle to start in), concrete
// barriers and parked cars to hide behind; the streets run out to the edge, where they come in
function city(): Arena {
  const rnd = seeded(33), rocks: Rock[] = [], radius = 102, step = 30;
  for (const bx of [-2, -1, 0, 1, 2]) for (const bz of [-2, -1, 0, 1, 2]) {
    if (Math.hypot(bx, bz) > 2.5) continue; // (the corners are past the edge)
    if (!bx && !bz) continue; // (the plaza)
    const x = bx * step, z = bz * step;
    // a block is one big building or two, on its pavement
    if (rnd() < 0.5) rocks.push({ x, z, r: 0, h: 16 + rnd() * 26, w: 9, d: 9, kind: 'building' });
    else for (const s of [-1, 1]) rocks.push({ x: x + (rnd() < 0.5 ? s * 4.6 : 0), z: z + (rnd() < 0.5 ? 0 : s * 4.6), r: 0, h: 10 + rnd() * 22, w: rnd() < 0.5 ? 9 : 4.2, d: 4.2, kind: 'building' });
  }
  for (const r of rocks) if (r.w) r.r = Math.hypot(r.w, r.d!);
  // parked cars by the kerbs of the eight streets between the blocks (at ±15 and ±45), and concrete barriers
  for (let i = 0, tries = 0; i < 44 && tries < 900; tries++) {
    const street = [-45, -15, 15, 45][Math.floor(rnd() * 4)], kerb = street + (rnd() < 0.5 ? -4.2 : 4.2), along = (rnd() - 0.5) * 180, northSouth = rnd() < 0.5;
    const x = northSouth ? kerb : along, z = northSouth ? along : kerb, car = rnd() < 0.65;
    const long = car ? 2.3 : 2, thin = car ? 1 : 0.35;
    const box: Rock = { x, z, r: 0, h: car ? 1.4 : 1.1, w: northSouth ? thin : long, d: northSouth ? long : thin, kind: car ? 'car' : 'barrier' };
    box.r = Math.hypot(box.w!, box.d!);
    if (Math.hypot(x, z) < 12 || Math.hypot(x, z) > radius - 6 || rocks.some((o) => Math.abs(o.x - x) < (o.w ?? o.r) + box.w! + 2 && Math.abs(o.z - z) < (o.d ?? o.r) + box.d! + 2)) continue;
    rocks.push(box);
    i++;
  }
  // (in at the ends of the streets)
  const spawns: [number, number][] = [];
  for (const end of [-1, 1]) for (const street of [-45, -15, 15, 45]) {
    const out = Math.sqrt((radius - 8) ** 2 - street * street);
    spawns.push([end * out, street]); spawns.push([street, end * out]);
  }
  return { id: 'city', name: 'Night city', radius, rocks, spawns, grip: 1 };
}

// The snowfield: a frozen pass among pines and rocks dusted with snow. Robots keep their feet; cars slide.
function snow(): Arena {
  const rnd = seeded(45), rocks: Rock[] = [], radius = 115;
  scatter(rocks, rnd, 95, radius, 14, 108, () => [0.9 + rnd() * 0.5, 9 + rnd() * 8], 'tree');
  scatter(rocks, rnd, 28, radius, 16, 106, () => { const r = 1.3 + rnd() * 2.2; return [r, r * (0.7 + rnd() * 0.5)]; }, 'rock');
  return { id: 'snow', name: 'Snowfield', radius, rocks, spawns: ring(16, radius - 8, 0.5), grip: 0.45 };
}

// The same "random" numbers every time, so a battleground is the same each visit
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// The point of a rock nearest (x, z): for pushing things out of it and steering round it
export function nearest(r: Rock, x: number, z: number): [number, number] {
  if (!r.w) { const d = Math.hypot(x - r.x, z - r.z) || 1e-6; return [r.x + ((x - r.x) / d) * r.r, r.z + ((z - r.z) / d) * r.r]; }
  return [Math.max(r.x - r.w, Math.min(r.x + r.w, x)), Math.max(r.z - r.d!, Math.min(r.z + r.d!, z))];
}
export const inside = (r: Rock, x: number, z: number) =>
  r.w ? Math.abs(x - r.x) < r.w && Math.abs(z - r.z) < r.d! : Math.hypot(x - r.x, z - r.z) < r.r;

// Where something round (radius rad) at (x, z) has to go to be clear of the rock, or null if it's clear:
// straight out from the nearest point, or out of the nearest side if it's got right inside a box
export function pushOut(r: Rock, x: number, z: number, rad: number): [number, number] | null {
  if (r.w && inside(r, x, z)) {
    const sides: [number, number, number][] = [[x - (r.x - r.w), -1, 0], [r.x + r.w - x, 1, 0], [z - (r.z - r.d!), 0, -1], [r.z + r.d! - z, 0, 1]];
    const [, nx, nz] = sides.reduce((m, v) => (v[0] < m[0] ? v : m));
    return [nx ? r.x + nx * (r.w + rad) : x, nz ? r.z + nz * (r.d! + rad) : z];
  }
  const [px, pz] = nearest(r, x, z), d = Math.hypot(x - px, z - pz);
  if (!r.w && Math.hypot(x - r.x, z - r.z) < r.r) { const c = Math.hypot(x - r.x, z - r.z) || 1e-6; return [r.x + ((x - r.x) / c) * (r.r + rad), r.z + ((z - r.z) / c) * (r.r + rad)]; }
  if (d >= rad) return null;
  return [px + ((x - px) / (d || 1e-6)) * rad, pz + ((z - pz) / (d || 1e-6)) * rad];
}

// Is the line from a to b blocked by something?
export function blocked(arena: Arena, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
  for (const r of arena.rocks) {
    if (r.w) {
      // (through a box: where the line enters and leaves each pair of its sides overlap)
      let t0 = 0, t1 = 1;
      for (const [p, d, lo, hi] of [[ax, dx, r.x - r.w, r.x + r.w], [az, dz, r.z - r.d!, r.z + r.d!]]) {
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 2; break; } continue; }
        const u = (lo - p) / d, v = (hi - p) / d;
        t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
      }
      if (t0 <= t1) return r;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((r.x - ax) * dx + (r.z - az) * dz) / len2));
    if (Math.hypot(ax + dx * t - r.x, az + dz * t - r.z) < r.r) return r;
  }
  return null;
}
