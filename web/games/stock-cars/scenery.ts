// The land around a track, and what stands on it, by the track's theme (tracks.json "scenery"):
// rolling countryside and forest, red desert mesas, a harbour with cranes and containers, or a
// city. The ground is flat by the track and in the infield, and rises into hills further out.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, noise2, seeded, texture } from './draw.ts';
import type { Track } from './track.ts';

export type Theme = 'countryside' | 'desert' | 'harbour' | 'city';
type Add = (o: THREE.Object3D, extra?: boolean) => void; // extra: dropped first when the screen struggles

interface Look {
  low: string; // the ground's colour by the track...
  high: string; // ...up on the hills
  rock: string; // where it's steep
  hills: number; // m: how high they get
  scale: number; // m: how far apart
  terraces: number; // m: flat-topped steps (mesas), or 0
}

const LOOKS: Record<Theme, Look> = {
  countryside: { low: '#4f8f3f', high: '#2d6331', rock: '#7d7a6e', hills: 120, scale: 520, terraces: 0 },
  desert: { low: '#cf9a62', high: '#a4502f', rock: '#7c3424', hills: 170, scale: 600, terraces: 22 },
  harbour: { low: '#5d6b4c', high: '#47533d', rock: '#5f605c', hills: 45, scale: 380, terraces: 0 },
  city: { low: '#628349', high: '#4b693c', rock: '#77756c', hills: 30, scale: 380, terraces: 0 },
};

const FLAT = 75; // m beyond the outside wall that stay flat (grandstand, lights)
const SEA = -1.2; // the harbour's water level

// The shape of the land: flat by the track, rising into hills (or mesas) further out
export class Land {
  readonly look: Look;
  private line: { x: number; z: number }[] = []; // the track's centre line, every 15 m
  private noise = noise2(9);
  readonly box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

  constructor(readonly track: Track, readonly theme: Theme) {
    this.look = LOOKS[theme];
    for (let s = 0; s < track.length; s += 15) {
      const p = track.at(s);
      this.line.push({ x: p.x, z: p.z });
      this.box.minX = Math.min(this.box.minX, p.x); this.box.maxX = Math.max(this.box.maxX, p.x);
      this.box.minZ = Math.min(this.box.minZ, p.z); this.box.maxZ = Math.max(this.box.maxZ, p.z);
    }
  }

  // How far outside the track's outer edge (negative: inside the oval)
  outside(x: number, z: number) {
    let best = Infinity, inside = false;
    const L = this.line;
    for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const a = L[i], b = L[j];
      best = Math.min(best, (a.x - x) ** 2 + (a.z - z) ** 2);
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside ? -1 : Math.sqrt(best) - this.track.width / 2;
  }

  // The harbour's water: beyond the back straight
  sea(x: number, z: number) {
    return this.theme === 'harbour' ? clamp01((this.box.minZ - 90 - z) / 60) : 0;
  }

  height(x: number, z: number) {
    const out = this.outside(x, z);
    if (out < FLAT) return -0.05;
    const { hills, scale, terraces } = this.look;
    const rise = smooth(clamp01((out - FLAT) / 500));
    let h = clamp01((this.noise(x / scale, z / scale) - 0.35) / 0.55) * hills * rise;
    if (terraces) { // mesas: steps with steep sides
      const step = Math.floor(h / terraces), f = h / terraces - step;
      h = (step + smooth(clamp01(f * 4 - 3))) * terraces;
    }
    const sea = this.sea(x, z);
    return h * (1 - sea) + (SEA - 6) * sea - 0.05;
  }
}

export function buildScenery(add: Add, land: Land, night: number) {
  add(ground(land, night));
  const t = land.theme;
  if (t === 'countryside') forest(add, land, 900, night);
  if (t === 'desert') { rocks(add, land, 320, night); cacti(add, land, 220, night); }
  if (t === 'harbour') { harbour(add, land, night); towers(add, land, 90, night, (x, z) => z > land.box.maxZ + 220); forest(add, land, 250, night); }
  if (t === 'city') { towers(add, land, 260, night, () => true); forest(add, land, 200, night); }
}

// --- the ground: one mesh, coloured by height and steepness, with fine grain on top -------------------
function ground(land: Land, night: number) {
  const b = land.box, reach = 1900, N = 170;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + reach * 2;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const g = new THREE.PlaneGeometry(size, size, N, N).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const pos = g.attributes.position as THREE.BufferAttribute, colors: number[] = [];
  const low = new THREE.Color(land.look.low), high = new THREE.Color(land.look.high), rock = new THREE.Color(land.look.rock);
  const sand = new THREE.Color('#9c9178'), c = new THREE.Color(), step = size / N;
  const hs = Array.from({ length: pos.count }, (_, i) => land.height(pos.getX(i), pos.getZ(i)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = hs[i];
    pos.setY(i, h);
    const col = i % (N + 1), right = col < N ? hs[i + 1] : h, below = i + N + 1 < hs.length ? hs[i + N + 1] : h;
    const slope = (Math.abs(right - h) + Math.abs(below - h)) / step;
    c.copy(low).lerp(high, clamp01(h / (land.look.hills * 0.6))).lerp(rock, clamp01((slope - 0.25) * 2));
    if (h < 0.5 && land.sea(x, z) > 0) c.copy(sand); // the shore
    c.multiplyScalar(night);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const grain = grainTexture();
  grain.repeat.set(size / 10, size / 10);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: grain }));
}

// Places outside the track's flat band, on the land, at random (but the same every time)
function spots(land: Land, n: number, seed: number, from: number, to: number, ok: (x: number, z: number, h: number) => boolean = () => true) {
  const rnd = seeded(seed), b = land.box, out: { x: number; z: number; y: number; r: number }[] = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const x = b.minX - to + rnd() * (b.maxX - b.minX + to * 2), z = b.minZ - to + rnd() * (b.maxZ - b.minZ + to * 2);
    const away = land.outside(x, z);
    if (away < from || away > to || land.sea(x, z) > 0) continue;
    const y = land.height(x, z);
    if (ok(x, z, y)) out.push({ x, z, y, r: rnd() });
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, places: { x: number; z: number; y: number; r: number }[], size: (r: number) => [number, number, number]) {
  const mesh = new THREE.InstancedMesh(geo, mat, places.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  places.forEach((p, i) => {
    const [sx, sy, sz] = size(p.r);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r * 40);
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(sx, sy, sz)));
  });
  return mesh;
}

const dim = (hex: string, night: number) => new THREE.Color(hex).multiplyScalar(night);

function forest(add: Add, land: Land, n: number, night: number) {
  const tree = mergeGeometries([
    new THREE.ConeGeometry(3.6, 10, 7).translate(0, 9, 0),
    new THREE.ConeGeometry(2.8, 8, 7).translate(0, 13, 0),
  ]);
  const trunk = new THREE.CylinderGeometry(0.5, 0.7, 5, 6).translate(0, 2.5, 0);
  const places = spots(land, n, 7, FLAT + 20, 1500, (_x, _z, h) => h > -0.5);
  const size = (r: number): [number, number, number] => { const k = 0.7 + r * 0.9; return [k, k * (0.8 + r * 0.5), k]; };
  add(instanced(tree, new THREE.MeshLambertMaterial({ color: dim('#24572f', night) }), places, size), true);
  add(instanced(trunk, new THREE.MeshLambertMaterial({ color: dim('#5a4030', night) }), places, size), true);
}

function rocks(add: Add, land: Land, n: number, night: number) {
  const places = spots(land, n, 11, FLAT + 10, 1400);
  add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: dim('#8a4a32', night), flatShading: true }),
    places, (r) => [3 + r * 9, 2 + r * 6, 3 + ((r * 7) % 1) * 9]), true);
}

function cacti(add: Add, land: Land, n: number, night: number) {
  const cactus = mergeGeometries([
    new THREE.CylinderGeometry(0.45, 0.5, 6, 7).translate(0, 3, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 2.2, 6).translate(1, 3.6, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 1.2, 6).rotateZ(Math.PI / 2).translate(0.6, 2.6, 0),
    new THREE.CylinderGeometry(0.28, 0.28, 1.8, 6).translate(-0.9, 4.2, 0),
    new THREE.CylinderGeometry(0.28, 0.28, 1, 6).rotateZ(Math.PI / 2).translate(-0.5, 3.4, 0),
  ]);
  const places = spots(land, n, 13, FLAT + 5, 900, (_x, _z, h) => h < 30);
  add(instanced(cactus, new THREE.MeshLambertMaterial({ color: dim('#4f7a3a', night) }), places, (r) => { const k = 0.8 + r * 0.7; return [k, k, k]; }), true);
}

// Water beyond the back straight, a quay with cranes and stacks of containers
function harbour(add: Add, land: Land, night: number) {
  const b = land.box, w = b.maxX - b.minX + 3000;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w, 3000).rotateX(-Math.PI / 2).translate((b.minX + b.maxX) / 2, SEA, b.minZ - 1600),
    new THREE.MeshStandardMaterial({ color: dim('#1f4a66', Math.max(night, 0.5)), roughness: 0.15, metalness: 0.3 }));
  add(water);
  const quayZ = b.minZ - 110, rnd = seeded(17);
  // containers: stacks of 1 to 4 along the quay
  const boxes: { x: number; z: number; y: number; r: number }[] = [];
  for (let x = b.minX - 300; x < b.maxX + 300; x += 13) {
    if (rnd() < 0.3) continue;
    for (let row = 0; row < 3; row++) {
      const stack = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < stack; k++) boxes.push({ x, z: quayZ + 12 + row * 3, y: land.height(x, quayZ + 12) + 1.3 + k * 2.6, r: rnd() });
    }
  }
  const box = new THREE.InstancedMesh(new THREE.BoxGeometry(12.2, 2.6, 2.4), new THREE.MeshLambertMaterial(), boxes.length);
  const paint = ['#b2432f', '#2f6db2', '#d9a13a', '#3f8a5a', '#8a8f9c', '#e0e0d8', '#6a3fa0'], m = new THREE.Matrix4();
  boxes.forEach((p, i) => {
    box.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    box.setColorAt(i, dim(paint[Math.floor(p.r * paint.length)], night));
  });
  add(box, true);
  // cranes: two legs, a deck, a boom out over the water
  const parts: THREE.BufferGeometry[] = [];
  for (let x = b.minX - 150; x < b.maxX + 150; x += 220) {
    for (const dx of [-6, 6]) parts.push(new THREE.BoxGeometry(1.4, 46, 1.4).translate(x + dx, 23, quayZ - 4));
    parts.push(new THREE.BoxGeometry(16, 3, 4).translate(x, 46, quayZ - 4));
    parts.push(new THREE.BoxGeometry(2.4, 2.4, 70).translate(x, 49, quayZ - 30));
    parts.push(new THREE.BoxGeometry(5, 7, 5).translate(x, 51, quayZ));
  }
  add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: dim('#e0a030', Math.max(night, 0.6)) })));
}

// Buildings with windows (lit at night), wherever `where` allows
function towers(add: Add, land: Land, n: number, night: number, where: (x: number, z: number) => boolean) {
  const places = spots(land, n, 19, FLAT + 120, 1300, (x, z, h) => where(x, z) && h < 25);
  const lit = night < 0.6;
  const mat = new THREE.MeshLambertMaterial({
    map: windowTexture(false), color: dim('#ffffff', Math.max(night, 0.35)),
    emissive: lit ? 0xffe2a8 : 0x000000, emissiveMap: lit ? windowTexture(true) : null, emissiveIntensity: lit ? 1 : 0,
  });
  add(instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, places, (r) => {
    const tall = 20 + (r ** 2) * 150;
    return [20 + ((r * 13) % 1) * 25, tall, 20 + ((r * 29) % 1) * 25];
  }));
}

function windowTexture(lights: boolean) {
  const c = canvas(64, 128), g = c.getContext('2d')!, rnd = seeded(lights ? 31 : 29);
  g.fillStyle = lights ? '#000000' : '#5b6474';
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 8) for (let x = 4; x < 64; x += 8) {
    if (lights) { if (rnd() < 0.35) { g.fillStyle = rnd() < 0.5 ? '#ffe2a8' : '#cfe0ff'; g.fillRect(x, y, 5, 5); } continue; }
    g.fillStyle = rnd() < 0.5 ? '#8fa4bf' : '#a9bad0';
    g.fillRect(x, y, 5, 5);
  }
  return texture(c, false);
}

// Fine grain for the ground, so it isn't a flat colour up close
function grainTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(41);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(200 + rnd() * 55);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  return texture(c);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
