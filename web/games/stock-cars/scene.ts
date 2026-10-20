// The 3D world: the venue built from the track's numbers (track.ts), lit for day, dusk or night,
// the cars (cars.ts), sparks, and the cameras: a chase camera per person (the screen splits for 2
// to 4), a TV camera when nobody's driving, and a turntable for each person while they pick a car.
// Plain three.js with cheap materials, so it runs on modest screens.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carMesh, disposeCar, rollWheels, type CarModel } from './cars.ts';
import { TOP, type Car } from './race.ts';
import type { Track } from './track.ts';
import { canvas, DISPLAY_FONT, seeded, speckle, texture } from './draw.ts';
import { buildScenery, Land } from './scenery.ts';

const STEP = 4; // m between the rings of the track's meshes

// The light of each time of day
const TIMES = {
  day: { sky: ['#4f8fdc', '#cfe5fb'], fog: 0xc9e0f6, hemi: [0xe6f0ff, 0x56703f, 1.9], sun: [0xfff2dc, 2.8], sunAt: [250, 420, 300], dim: 1, lamps: false, stars: false, env: 0.8 },
  dusk: { sky: ['#27305e', '#f0a066'], fog: 0xc98a68, hemi: [0xffd0b0, 0x3a2e22, 1.4], sun: [0xffb070, 2.4], sunAt: [-600, 110, -320], dim: 0.8, lamps: true, stars: false, env: 0.55 },
  night: { sky: ['#04060b', '#151b2b'], fog: 0x0a0c12, hemi: [0xc4cee6, 0x1d2618, 1.6], sun: [0xfff1dc, 1.6], sunAt: [150, 400, 260], dim: 0.4, lamps: true, stars: true, env: 0.35 },
} as const;
type Time = (typeof TIMES)[keyof typeof TIMES];

// A rectangle of the screen, as fractions from the top left
export interface Rect { x: number; y: number; w: number; h: number }

export interface View {
  car: Car | null; // whose chase camera; null: the TV camera
  show: THREE.Object3D | null; // or a car on a turntable
  rect: Rect;
  camera: THREE.PerspectiveCamera;
  lookBack: boolean;
  d: number; // the chase camera's line, eased
  aim: THREE.Vector3; // the TV camera's target, eased
  shake: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private venue = new THREE.Group();
  private track: Track | null = null;
  private cars = new Map<Car, THREE.Group>();
  private extras: THREE.Object3D[] = []; // what goes first when the screen struggles
  private sparks = new Sparks();
  private shown: THREE.Group[] = []; // the cars on turntables
  views: View[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // (gives the cars' paint a sheen)
    pmrem.dispose();
    this.scene.add(this.venue, this.sparks.points);
  }

  // Lower the detail when the screen can't keep up: first the resolution, then the scenery
  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else for (const o of this.extras) o.visible = false;
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  // --- the venue ---------------------------------------------------------------------------------
  setTrack(track: Track) {
    if (this.track === track) return;
    this.track = track;
    this.venue.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat() as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
    });
    this.venue.clear();
    this.extras = [];
    const time = TIMES[track.spec.time];
    this.scene.fog = new THREE.Fog(time.fog, 450, 3200);
    this.scene.background = new THREE.Color(time.fog);
    this.scene.environmentIntensity = time.env;
    buildVenue((o, extra) => { this.venue.add(o); if (extra) this.extras.push(o); }, track, time);
  }

  // --- the cars ----------------------------------------------------------------------------------
  setCars(cars: Car[], models: Map<string, CarModel>) {
    for (const g of this.cars.values()) { this.scene.remove(g); disposeCar(g); }
    this.cars.clear();
    for (const c of cars) {
      const g = carMesh(models.get(c.spec.car.id)!, c.spec.color, c.spec.number);
      this.scene.add(g);
      this.cars.set(c, g);
    }
  }

  // Each person's chase camera; a TV camera too when nobody is driving, or to fill the fourth corner
  setViews(cars: Car[]) {
    this.clearShowroom();
    this.views = layout(cars.length).map((rect, i) => view(rect, cars[i] ?? null));
  }

  // Picking cars: each person's choice on a turntable in the infield, in their part of the screen
  showroom(picks: { model: CarModel; color: string; number: number }[]) {
    this.clearShowroom();
    this.views = layout(picks.length).slice(0, picks.length).map((rect, i) => {
      const g = carMesh(picks[i].model, picks[i].color, picks[i].number);
      g.position.set((i - (picks.length - 1) / 2) * 18, 0.1, 0);
      g.rotation.y = 0.6 + i;
      this.scene.add(g);
      this.shown.push(g);
      return { ...view(rect, null), show: g };
    });
  }

  private clearShowroom() {
    for (const g of this.shown) { this.scene.remove(g); disposeCar(g); }
    this.shown = [];
  }

  // A hit: sparks where it happened, and a jolt for that driver's camera
  hit(c: Car, side: number, strength: number) {
    const p = this.track!.point(c.dist, c.d + side * c.stats.width * 0.5);
    this.sparks.emit(new THREE.Vector3(p.x, p.y + 0.5, p.z), Math.min(40, 6 + strength * 2));
    for (const v of this.views) if (v.car === c) v.shake = Math.max(v.shake, Math.min(0.7, strength * 0.05));
  }

  // Place everything and draw each view. `follow`: who the TV camera watches.
  render(dt: number, follow: Car | null) {
    const t = this.track!;
    for (const [c, g] of this.cars) {
      const before = g.position.clone();
      place(t, g, c.dist, c.d, c.yaw);
      rollWheels(g, Math.min(10, before.distanceTo(g.position)));
      if (c.scraping) {
        const p = t.point(c.dist, c.d + c.stats.width * 0.5);
        this.sparks.emit(new THREE.Vector3(p.x, p.y + 0.4, p.z), 2);
      }
    }
    for (const g of this.shown) g.rotation.y += dt * 0.5;
    this.sparks.update(dt);

    const r = this.renderer, canvas = r.domElement;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    r.setScissorTest(true);
    for (const v of this.views) {
      const x = v.rect.x * W, y = (1 - v.rect.y - v.rect.h) * H, w = v.rect.w * W, h = v.rect.h * H;
      v.camera.aspect = w / h;
      if (v.show) turntable(v.camera, v.show);
      else if (v.car) chase(t, v, v.car, dt);
      else if (follow) tv(t, v, follow, dt);
      if (v.shake > 0.01) {
        v.camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(v.shake));
        v.shake *= Math.exp(-7 * dt);
      }
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(this.scene, v.camera);
    }
  }
}

const layout = (n: number): Rect[] => n <= 1 ? [{ x: 0, y: 0, w: 1, h: 1 }]
  : n === 2 ? [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]
  : [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];

const view = (rect: Rect, car: Car | null): View => ({
  car, show: null, rect, lookBack: false, shake: 0, d: car?.d ?? 0, aim: new THREE.Vector3(),
  camera: new THREE.PerspectiveCamera(60, 1, 0.5, 6000),
});

// --- the cameras -------------------------------------------------------------------------------------
// Behind the car, riding the banking with it; wider at speed
function chase(t: Track, v: View, car: Car, dt: number) {
  const cam = v.camera;
  v.d += (car.d - v.d) * Math.min(1, 6 * dt);
  const back = v.lookBack ? -1 : 1, behind = 6 + car.stats.length * 0.75;
  const eye = t.point(car.dist - behind * back, v.d), at = t.point(car.dist + 14 * back, car.d);
  const lift = surfaceUp(t, car.dist);
  cam.position.set(eye.x, eye.y, eye.z).addScaledVector(lift, 2.4 + car.stats.width * 0.45);
  cam.up.copy(lift).lerp(UP, 0.5).normalize();
  cam.lookAt(at.x + lift.x, at.y + lift.y, at.z + lift.z);
  cam.fov = 60 + 14 * Math.min(1, car.v / TOP) ** 2;
  cam.updateProjectionMatrix();
}

// From the nearest camera spot around the outside, a long lens on the car
function tv(t: Track, v: View, car: Car, dt: number) {
  const cam = v.camera, spots = 8;
  let best = 0, bestGap = Infinity;
  for (let i = 0; i < spots; i++) {
    const gap = Math.abs(t.gap(((i + 0.5) / spots) * t.length, car.dist + 30)); // (looking a little ahead)
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  const spot = t.point(((best + 0.5) / spots) * t.length, t.width / 2 + 5);
  const p = t.point(car.dist, car.d), target = new THREE.Vector3(p.x, p.y, p.z);
  if (v.aim.lengthSq() === 0 || v.aim.distanceTo(target) > 120) v.aim.copy(target);
  else v.aim.lerp(target, Math.min(1, 8 * dt));
  cam.position.set(spot.x, spot.y + 18, spot.z);
  cam.up.copy(UP);
  cam.lookAt(v.aim);
  cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(16 / cam.position.distanceTo(v.aim))), 8, 55);
  cam.updateProjectionMatrix();
}

function turntable(cam: THREE.PerspectiveCamera, g: THREE.Object3D) {
  cam.position.set(g.position.x, 2.6, g.position.z + 9);
  cam.up.copy(UP);
  cam.lookAt(g.position.x, 0.9, g.position.z);
  cam.fov = 40;
  cam.updateProjectionMatrix();
}

// --- the venue, from the track ---------------------------------------------------------------------
type Add = (o: THREE.Object3D, extra?: boolean) => void; // extra: drop it when the screen struggles

function buildVenue(add: Add, t: Track, time: Time) {
  const W = t.width, L = t.length;
  const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  add(new THREE.HemisphereLight(time.hemi[0], time.hemi[1], time.hemi[2]));
  const sun = new THREE.DirectionalLight(time.sun[0], time.sun[1]);
  sun.position.set(time.sunAt[0], time.sunAt[1], time.sunAt[2]);
  add(sun);
  add(sky(time.sky[0], time.sky[1]));

  // the land and what's on it, then the apron (flat, inside) and the banked racing surface
  const land = new Land(t, t.spec.scenery);
  buildScenery(add, land, time.dim);
  const at = (d: number, up = 0) => (s: number) => { const p = t.point(s, d); return new THREE.Vector3(p.x, p.y + up, p.z); };
  add(new THREE.Mesh(strip(t, at(-W / 2 - 8), at(-W / 2), 16), lambert({ map: apronTexture() })));
  add(new THREE.Mesh(strip(t, at(-W / 2), at(W / 2), 24), new THREE.MeshStandardMaterial({ map: asphaltTexture(W), roughness: 0.9 })));
  // the earth banked up behind the outside wall, so the turns don't float
  const top = (s: number) => { const p = t.point(s, W / 2 + 0.1); return new THREE.Vector3(p.x, p.y, p.z); };
  const foot = (s: number) => { const p = t.point(s, W / 2 + 0.1 + Math.max(1, t.point(s, W / 2).y * 1.6)); return new THREE.Vector3(p.x, -0.05, p.z); };
  add(new THREE.Mesh(strip(t, top, foot, 8), lambert({ color: new THREE.Color(land.look.low).multiplyScalar(time.dim * 0.85), side: THREE.DoubleSide })));

  // the wall, and the catch fence above it
  const wall = (h: number) => (s: number) => { const p = t.point(s, W / 2 + 0.1); return new THREE.Vector3(p.x, p.y + h, p.z); };
  add(new THREE.Mesh(strip(t, wall(0), wall(1.3), 8), lambert({ map: wallTexture(), side: THREE.DoubleSide })));
  add(new THREE.Mesh(strip(t, wall(1.3), wall(6.5), 3),
    new THREE.MeshBasicMaterial({ map: fenceTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false })));
  const inner = (h: number) => (s: number) => { const p = t.point(s, -W / 2 - 8); return new THREE.Vector3(p.x, h, p.z); };
  add(new THREE.Mesh(strip(t, inner(0), inner(0.9), 8), lambert({ color: 0x9a9caa, side: THREE.DoubleSide })));

  // the start/finish line and its gantry
  add(new THREE.Mesh(strip(t, at(-W / 2, 0.02), at(W / 2, 0.02), 1.6, 0, 1.6),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2 })));
  gantry(add, t);

  // the main grandstand along the front stretch, either side of the line
  const stand = Math.min(360, L * 0.22), s0 = -stand / 2, s1 = stand / 2;
  const off = (d: number, y: number) => (s: number) => { const p = t.point(s, W / 2 + d); return new THREE.Vector3(p.x, y, p.z); };
  add(new THREE.Mesh(strip(t, off(9, 3), off(43, 19), 64, s0, s1), lambert({ map: crowdTexture(), side: THREE.DoubleSide })));
  const dark = lambert({ color: 0x1b1e27, side: THREE.DoubleSide });
  add(new THREE.Mesh(strip(t, off(9, 0), off(9, 3), 8, s0, s1), dark));
  add(new THREE.Mesh(strip(t, off(44, 0), off(44, 30), 8, s0, s1), dark));
  add(new THREE.Mesh(strip(t, off(16, 29), off(45, 30.5), 8, s0, s1), dark));
  add(new THREE.Mesh(strip(t, off(20, 28.4), off(20, 28.8), 8, s0, s1), new THREE.MeshBasicMaterial({ color: time.lamps ? 0xfff3d6 : 0x6a6875 })));

  lights(add, t, time.lamps, stand);
  infieldName(add, t);
  if (time.stars) add(stars(), true);
}

function gantry(add: Add, t: Track) {
  const W = t.width, mat = new THREE.MeshLambertMaterial({ color: 0x20242f });
  const a = t.point(0, -W / 2 - 1), b = t.point(0, W / 2 + 1);
  for (const p of [a, b]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9 + p.y, 0.5), mat);
    pole.position.set(p.x, (9 + p.y) / 2, p.z);
    add(pole);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, W + 2), new THREE.MeshBasicMaterial({ map: gantryTexture() }));
  beam.position.set((a.x + b.x) / 2, 9 + b.y, (a.z + b.z) / 2);
  beam.rotation.y = -Math.atan2(a.p.hz, a.p.hx);
  add(beam);
}

function lights(add: Add, t: Track, on: boolean, stand: number) {
  const n = Math.max(8, Math.round(t.length / 110)), poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
  const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.25) / n) * t.length;
    if (Math.abs(t.gap(s, 0)) < stand / 2 + 20) continue; // (the grandstand roof lights that stretch)
    const p = t.point(s, t.width / 2 + 16), h = 34;
    poles.push(new THREE.CylinderGeometry(0.35, 0.6, h, 6).translate(p.x, h / 2, p.z));
    heads.push(new THREE.BoxGeometry(5, 2.4, 5).translate(p.x, h + 1, p.z));
    if (!on) continue;
    const sprite = new THREE.Sprite(glow);
    sprite.position.set(p.x, h + 1, p.z);
    sprite.scale.setScalar(26);
    add(sprite, true);
  }
  add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x5a5f6e })));
  add(new THREE.Mesh(mergeGeometries(heads), on ? new THREE.MeshBasicMaterial({ color: 0xfff3d6 }) : new THREE.MeshLambertMaterial({ color: 0x8a8f9c })));
}


// Our name painted on the infield grass, sized to fit, readable from the grandstand side
function infieldName(add: Add, t: Track) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let s = 0; s < t.length; s += 10) {
    const p = t.point(s, -t.width / 2 - 10);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const w = Math.min(260, (maxX - minX) * 0.55, ((maxZ - minZ) * 0.5 * 1024) / 192), h = (w * 192) / 1024;
  const c = canvas(1024, 192), g = c.getContext('2d')!;
  g.font = `800 150px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(215,255,59,0.6)';
  g.fillStyle = 'rgba(243,240,232,0.45)';
  g.fillText('BEACON', 300, 100);
  g.strokeText('ARCADE', 740, 100);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture(c, false), transparent: true, depthWrite: false }));
  name.rotation.x = -Math.PI / 2;
  name.position.set((minX + maxX) / 2, 0.02, (minZ + maxZ) / 2);
  add(name);
}

// A dome with the sky's colours, from the top down to the horizon
function sky(top: string, horizon: string) {
  const c = canvas(4, 256), g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.75, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.1),
    new THREE.MeshBasicMaterial({ map: texture(c, false), side: THREE.BackSide, fog: false, depthWrite: false }));
}

function stars() {
  const n = 900, pos = new Float32Array(n * 3), rnd = seeded(3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.4, r = 4500;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d0e8, size: 1.6, sizeAttenuation: false, fog: false }));
}

// --- sparks ----------------------------------------------------------------------------------------------
class Sparks {
  private n = 400;
  private pos = new Float32Array(this.n * 3);
  private vel = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private next = 0;
  readonly points: THREE.Points;

  constructor() {
    this.pos.fill(-1e4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.22, map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const k = this.next++ % this.n;
      this.pos.set([at.x, at.y, at.z], k * 3);
      this.vel.set([(Math.random() - 0.5) * 14, 2 + Math.random() * 6, (Math.random() - 0.5) * 14], k * 3);
      this.life[k] = 0.3 + Math.random() * 0.4;
    }
  }

  update(dt: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e4; continue; }
      this.vel[k * 3 + 1] -= 20 * dt;
      for (let j = 0; j < 3; j++) this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

// --- placing things on the track ------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const basis = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

// The banked surface's up direction (it leans in toward the infield)
function surfaceUp(t: Track, s: number) {
  const p = t.at(s), b = t.bank(s);
  return new THREE.Vector3(p.hz * Math.sin(b), Math.cos(b), -p.hx * Math.sin(b));
}

// A car on the track: along it, tilted with the banking, turned by its slide or spin
function place(t: Track, o: THREE.Object3D, s: number, d: number, yaw: number) {
  const p = t.point(s, d);
  const f = new THREE.Vector3(p.p.hx, 0, p.p.hz), right = new THREE.Vector3(-p.p.hz, 0, p.p.hx);
  basis.makeBasis(f, UP, right);
  o.quaternion.setFromRotationMatrix(basis)
    .multiply(q1.setFromAxisAngle(X, -t.bank(s)))
    .multiply(q2.setFromAxisAngle(UP, -yaw));
  o.position.set(p.x, p.y, p.z);
}

// A ribbon along the lap (or part of it) between two edges: inner edge first, so it faces up / inwards
function strip(t: Track, a: (s: number) => THREE.Vector3, b: (s: number) => THREE.Vector3, tile: number, s0 = 0, s1 = t.length) {
  const n = Math.max(1, Math.ceil((s1 - s0) / STEP)), pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, p = a(s), q = b(s), v = (s - s0) / tile;
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uv.push(0, v, 1, v);
    if (i < n) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// --- textures, drawn here so there's nothing to download ---------------------------------------------------



// across the track (u: inside edge to the wall), along it (v): fine aggregate, rubber in the groove,
// tyre marks, and the seams where it was laid
function asphaltTexture(width: number) {
  const c = canvas(512, 512), g = c.getContext('2d')!, rnd = seeded(11);
  g.fillStyle = '#3a3d44';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 26000, 62, rnd, 1);
  speckle(g, 512, 512, 2500, 90, rnd, 2);
  const u = (d: number) => ((d + width / 2) / width) * 512;
  const band = (d0: number, d1: number, color: string) => { g.fillStyle = color; g.fillRect(u(d0), 0, u(d1) - u(d0), 512); };
  band(-width / 2 + 1.5, -width / 2 + 8, 'rgba(12,12,16,0.32)'); // the groove: rubber laid down along the bottom
  band(width / 2 - 3, width / 2 - 0.3, 'rgba(12,12,16,0.18)'); // scuffs up by the wall
  g.strokeStyle = 'rgba(8,8,10,0.25)'; // tyre marks: long, slightly wandering
  for (let i = 0; i < 26; i++) {
    let x = u(-width / 2 + 1 + rnd() * (width - 2));
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) { x += (rnd() - 0.5) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.05)'; // a seam across, once a tile
  g.fillRect(0, 300, 512, 2);
  g.fillStyle = '#e8e6df'; // the white line along the inside edge
  g.fillRect(0, 0, 8, 512);
  return texture(c);
}

function apronTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(5);
  g.fillStyle = '#4c5059';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 700, 85, rnd);
  g.fillStyle = '#ffc23d'; // the double yellow line: below it is out of bounds
  g.fillRect(104, 0, 5, 128);
  g.fillRect(112, 0, 5, 128);
  return texture(c);
}

function wallTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1e27'; // the soft barrier's dark band (x is up the wall, y along it)
  g.fillRect(16, 0, 30, 64);
  g.fillStyle = '#c9c6bd';
  g.fillRect(0, 62, 64, 2);
  return texture(c);
}

function fenceTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(190,196,210,0.35)';
  g.lineWidth = 1;
  for (let i = -64; i < 128; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
  }
  g.fillStyle = 'rgba(120,126,140,0.9)'; // posts
  g.fillRect(0, 0, 64, 2);
  return texture(c);
}

function checkerTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f3f0e8';
    g.fillRect(x * 4, y * 32, 4, 32);
  }
  return texture(c, false);
}

function gantryTexture() {
  const c = canvas(512, 64), g = c.getContext('2d')!;
  g.fillStyle = '#0e1016';
  g.fillRect(0, 0, 512, 64);
  g.font = `800 44px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#d7ff3b';
  g.fillText('START  ·  FINISH', 256, 34);
  return texture(c, false);
}

// rows of people (x across the stand, y along it)
function crowdTexture() {
  const c = canvas(256, 512), g = c.getContext('2d')!, rnd = seeded(23);
  g.fillStyle = '#1d2029';
  g.fillRect(0, 0, 256, 512);
  const shirts = ['#d8d4cb', '#c4505a', '#4a74c4', '#d0a640', '#38a07a', '#b45aa0', '#7d7b85', '#a6c043', '#c47a45', '#2a2e3a'];
  for (let row = 0; row < 32; row++) {
    g.fillStyle = '#12141b';
    g.fillRect(row * 8 + 6, 0, 2, 512);
    for (let y = 0; y < 512; y += 4) {
      if (rnd() < 0.15) continue;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(row * 8 + 2, y + rnd(), 4, 3);
      g.fillStyle = '#8d6e5a';
      g.fillRect(row * 8, y + rnd(), 2, 2);
    }
  }
  return texture(c);
}

function glowTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, false);
}

