// The 3D world for a Grand Prix: the circuit built from the track's numbers (Stock Cars' track.ts),
// with the pit lane and its garages alongside the main straight; the cars (Stock Cars' cars.ts);
// sparks, flames and smoke; and the cameras: a chase camera per person (the screen splits for 2
// to 4), a TV camera when nobody's driving, and a turntable for each person while they pick.
// It follows Stock Cars' scene.ts, with a road circuit's venue in place of an oval's.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carLights, carMesh, disposeCar, rollWheels, steerWheels, type CarModel } from '../stock-cars/cars.ts';
import { canvas, DISPLAY_FONT, seeded, speckle, texture } from '../stock-cars/draw.ts';
import { TOP, type Car } from '../stock-cars/race.ts';
import { buildScenery, Land } from '../stock-cars/scenery.ts';
import type { Track } from '../stock-cars/track.ts';
import type { PitLane } from './pits.ts';

const STEP = 4; // m between the rings of the track's meshes

const TIMES = {
  day: { sky: ['#4f8fdc', '#cfe5fb'], fog: 0xc9e0f6, hemi: [0xe6f0ff, 0x56703f, 1.9], sun: [0xfff2dc, 2.8], sunAt: [250, 420, 300], dim: 1, lamps: false, env: 1, carLights: 0 },
  dusk: { sky: ['#27305e', '#f0a066'], fog: 0xc98a68, hemi: [0xffd0b0, 0x3a2e22, 1.4], sun: [0xffb070, 2.4], sunAt: [-600, 110, -320], dim: 0.8, lamps: true, env: 0.8, carLights: 0.8 },
  night: { sky: ['#04060b', '#151b2b'], fog: 0x0a0c12, hemi: [0xc4cee6, 0x1d2618, 1.6], sun: [0xfff1dc, 1.6], sunAt: [150, 400, 260], dim: 0.4, lamps: true, env: 0.6, carLights: 2 },
} as const;
type Time = (typeof TIMES)[keyof typeof TIMES];

export interface Rect { x: number; y: number; w: number; h: number }

export interface View {
  car: Car | null; // whose chase camera; null: the TV camera
  show: THREE.Object3D | null; // or a car on a turntable
  rect: Rect;
  camera: THREE.PerspectiveCamera;
  lookBack: boolean;
  d: number; // the chase camera's line, eased
  aim: THREE.Vector3;
  shake: number;
}

// How each car is doing, for the flames and smoke
export interface Look { burning: (c: Car) => boolean; out: (c: Car) => boolean; inPits: (c: Car) => boolean }

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private venue = new THREE.Group();
  private track: Track | null = null;
  private cars = new Map<Car, THREE.Group>();
  private extras: THREE.Object3D[] = [];
  private sparks = new Particles(400, 0xffc46b, 0.22, THREE.AdditiveBlending);
  private flames = new Particles(600, 0xff8a2a, 0.9, THREE.AdditiveBlending);
  private smoke = new Particles(500, 0x2a2b30, 2.2, THREE.NormalBlending, 0.55);
  private shown: THREE.Group[] = [];
  private lightsOn = 0;
  views: View[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(this.venue, this.sparks.points, this.flames.points, this.smoke.points);
  }

  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else for (const o of this.extras) o.visible = false;
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  // --- the venue ---------------------------------------------------------------------------------
  setTrack(track: Track, pits: PitLane) {
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
    const pmrem = new THREE.PMREMGenerator(this.renderer), env = reflections(time, new Land(track, track.spec.scenery).look.low);
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = time.env;
    env.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.MeshBasicMaterial).map?.dispose(); o.material.dispose(); } });
    pmrem.dispose();
    this.lightsOn = time.carLights;
    for (const g of [...this.cars.values(), ...this.shown]) carLights(g, this.lightsOn);
    buildVenue((o, extra) => { this.venue.add(o); if (extra) this.extras.push(o); }, track, pits, time);
  }

  // --- the cars ----------------------------------------------------------------------------------
  setCars(cars: Car[], models: Map<string, CarModel>) {
    for (const g of this.cars.values()) { this.scene.remove(g); disposeCar(g); }
    this.cars.clear();
    for (const c of cars) {
      const g = carMesh(models.get(c.spec.car.id)!, c.spec.paint ?? c.spec.color, c.spec.number);
      carLights(g, this.lightsOn);
      this.scene.add(g);
      this.cars.set(c, g);
    }
  }

  setViews(cars: Car[]) {
    this.clearShowroom();
    this.views = layout(cars.length).map((rect, i) => view(rect, cars[i] ?? null));
  }

  showroom(picks: { model: CarModel; color: string; number: number }[]) {
    this.clearShowroom();
    const spot = this.track!.point(0, -(this.track!.width / 2 + 70)); // (in the infield, behind the garages)
    this.views = layout(picks.length).slice(0, picks.length).map((rect, i) => {
      const g = carMesh(picks[i].model, picks[i].color, picks[i].number);
      carLights(g, this.lightsOn);
      g.position.set(spot.x + (i - (picks.length - 1) / 2) * 18, 0.1, spot.z);
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

  hit(c: Car, side: number, strength: number) {
    const p = this.track!.point(c.dist, c.d + side * c.stats.width * 0.5);
    this.sparks.emit(new THREE.Vector3(p.x, p.y + 0.5, p.z), Math.min(40, 6 + strength * 2), 14, 6);
    for (const v of this.views) if (v.car === c) v.shake = Math.max(v.shake, Math.min(0.7, strength * 0.05));
  }

  render(dt: number, follow: Car | null, look: Look) {
    const t = this.track!;
    const at = new THREE.Vector3();
    for (const [c, g] of this.cars) {
      const before = g.position.clone();
      place(t, g, c.dist, c.d, c.yaw);
      rollWheels(g, Math.min(10, before.distanceTo(g.position)));
      steerWheels(g, c.spinning > 0 || look.inPits(c) || look.out(c) ? 0 : c.steer);
      if (c.scraping) {
        const p = t.point(c.dist, c.d + c.scraping * c.stats.width * 0.5);
        this.sparks.emit(at.set(p.x, p.y + 0.4, p.z), 2, 14, 6);
      }
      // a fire: flames off the engine cover, smoke trailing; a wreck just smokes
      const burning = look.burning(c);
      if (burning || look.out(c)) {
        at.set(g.position.x, g.position.y + 0.9, g.position.z);
        if (burning) this.flames.emit(at, Math.ceil(90 * dt), 2.2, 3.5, 0.35);
        if (Math.random() < 30 * dt) this.smoke.emit(at, 1, 1.2, 4, 0.5);
      }
    }
    for (const g of this.shown) g.rotation.y += dt * 0.5;
    this.sparks.update(dt, -20);
    this.flames.update(dt, 2);
    this.smoke.update(dt, 1.5);

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
// Low behind the car, as open-wheelers sit low; wider at speed
function chase(t: Track, v: View, car: Car, dt: number) {
  const cam = v.camera;
  v.d += (car.d - v.d) * Math.min(1, 6 * dt);
  const back = v.lookBack ? -1 : 1, behind = 5 + car.stats.length * 0.7;
  const eye = t.point(car.dist - behind * back, v.d), at = t.point(car.dist + 14 * back, car.d);
  const lift = surfaceUp(t, car.dist, v.d);
  cam.position.set(eye.x, eye.y, eye.z).addScaledVector(lift, 2.0);
  cam.up.copy(lift).lerp(UP, 0.5).normalize();
  cam.lookAt(at.x + lift.x * 0.8, at.y + lift.y * 0.8, at.z + lift.z * 0.8);
  cam.fov = 60 + 16 * Math.min(1, car.v / TOP) ** 2;
  cam.updateProjectionMatrix();
}

// From the nearest camera spot round the outside, a long lens on the car
function tv(t: Track, v: View, car: Car, dt: number) {
  const cam = v.camera, spots = 10;
  let best = 0, bestGap = Infinity;
  for (let i = 0; i < spots; i++) {
    const gap = Math.abs(t.gap(((i + 0.5) / spots) * t.length, car.dist + 30));
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  const spot = t.point(((best + 0.5) / spots) * t.length, t.width / 2 + 6);
  const p = t.point(car.dist, car.d), target = new THREE.Vector3(p.x, p.y, p.z);
  if (v.aim.lengthSq() === 0 || v.aim.distanceTo(target) > 120) v.aim.copy(target);
  else v.aim.lerp(target, Math.min(1, 8 * dt));
  cam.position.set(spot.x, spot.y + 16, spot.z);
  cam.up.copy(UP);
  cam.lookAt(v.aim);
  cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(14 / cam.position.distanceTo(v.aim))), 8, 55);
  cam.updateProjectionMatrix();
}

function turntable(cam: THREE.PerspectiveCamera, g: THREE.Object3D) {
  cam.position.set(g.position.x, 2.2, g.position.z + 8.5);
  cam.up.copy(UP);
  cam.lookAt(g.position.x, 0.6, g.position.z);
  cam.fov = 40;
  cam.updateProjectionMatrix();
}

// --- the venue, from the track ---------------------------------------------------------------------
type Add = (o: THREE.Object3D, extra?: boolean) => void;

function buildVenue(add: Add, t: Track, pits: PitLane, time: Time) {
  const W = t.width, L = t.length;
  const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  add(new THREE.HemisphereLight(time.hemi[0], time.hemi[1], time.hemi[2]));
  const sun = new THREE.DirectionalLight(time.sun[0], time.sun[1]);
  sun.position.set(time.sunAt[0], time.sunAt[1], time.sunAt[2]);
  add(sun);
  add(sky(time.sky[0], time.sky[1]));

  const land = new Land(t, t.spec.scenery);
  buildScenery(add, land, time.dim);
  const at = (d: number, up = 0) => (s: number) => { const p = t.point(s, d); return new THREE.Vector3(p.x, p.y + up, p.z); };
  add(new THREE.Mesh(strip(t, at(-W / 2), at(W / 2), 24), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9 })));
  kerbs(add, t);

  // the barriers: a wall each side, with a catch fence on the outside; on the inside it stands back
  // behind the pit lane along the main straight
  const wallTex = wallTexture();
  const wall = (d: number, s0: number, s1: number) => add(new THREE.Mesh(strip(t, at(d), at(d, 1.1), 8, s0, s1), lambert({ map: wallTex, side: THREE.DoubleSide })));
  wall(W / 2 + 0.1, 0, L);
  add(new THREE.Mesh(strip(t, at(W / 2 + 0.1, 1.1), at(W / 2 + 0.1, 4), 3),
    new THREE.MeshBasicMaterial({ map: fenceTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false })));
  wall(-W / 2 - 0.1, pits.to, L + pits.from);
  const back = -(W / 2 + 11);
  wall(back - 0.1, pits.from, pits.to);
  pitLane(add, t, pits, time);

  // the start/finish line and its gantry, across the track and the pit lane
  add(new THREE.Mesh(strip(t, at(-W / 2, 0.02), at(W / 2, 0.02), 1.6, 0, 1.6),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2 })));
  gantry(add, t, back - 1);

  // the main grandstand, across the track from the pits
  const stand = Math.min(320, pits.to - pits.from - 60), s0 = -stand / 2, s1 = stand / 2;
  const off = (d: number, y: number) => (s: number) => { const p = t.point(s, W / 2 + d); return new THREE.Vector3(p.x, y, p.z); };
  add(new THREE.Mesh(strip(t, off(9, 3), off(43, 19), 64, s0, s1), lambert({ map: crowdTexture(), side: THREE.DoubleSide })));
  const dark = lambert({ color: 0x1b1e27, side: THREE.DoubleSide });
  add(new THREE.Mesh(strip(t, off(9, 0), off(9, 3), 8, s0, s1), dark));
  add(new THREE.Mesh(strip(t, off(44, 0), off(44, 30), 8, s0, s1), dark));
  add(new THREE.Mesh(strip(t, off(16, 29), off(45, 30.5), 8, s0, s1), dark));
  lights(add, t, time.lamps, stand);
}

// The pit lane: its road, the low wall between it and the track, the lines where the speed limit
// starts and ends, a box painted for every car, and the garages behind
function pitLane(add: Add, t: Track, pits: PitLane, time: Time) {
  const W = t.width, at = (d: number, up = 0) => (s: number) => { const p = t.point(s, d); return new THREE.Vector3(p.x, p.y + up, p.z); };
  const back = -(W / 2 + 11);
  add(new THREE.Mesh(strip(t, at(back), at(-W / 2), 12, pits.from, pits.to), new THREE.MeshStandardMaterial({ map: pitTexture(), roughness: 0.85 })));
  const a = pits.from + pits.ramp, b = pits.to - pits.ramp;
  add(new THREE.Mesh(strip(t, at(-W / 2 - 1.4), at(-W / 2 - 1.4, 1), 6, a - 20, b + 20), new THREE.MeshLambertMaterial({ map: wallTexture(), side: THREE.DoubleSide })));
  const white = new THREE.MeshBasicMaterial({ color: 0xe8e6df, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [a, b]) add(new THREE.Mesh(strip(t, at(back, 0.03), at(-W / 2 - 1.6, 0.03), 1, s, s + 0.6), white));
  // the boxes, on the garage side of the lane, and the garages
  const box = new THREE.MeshBasicMaterial({ color: 0xffc23d, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of pits.boxes) add(new THREE.Mesh(strip(t, at(back + 0.2, 0.03), at(pits.lane - 2.2, 0.03), 1, s - 3, s + 3), box));
  const g = (d: number, y: number) => (s: number) => { const p = t.point(s, d); return new THREE.Vector3(p.x, y, p.z); };
  add(new THREE.Mesh(strip(t, g(back - 0.2, 0), g(back - 0.2, 6), 24, a - 10, b + 10), new THREE.MeshLambertMaterial({ map: garageTexture(time.lamps), side: THREE.DoubleSide })));
  add(new THREE.Mesh(strip(t, g(back - 12, 7), g(back - 0.2, 6.5), 12, a - 10, b + 10), new THREE.MeshLambertMaterial({ color: 0x2a2f3d, side: THREE.DoubleSide })));
}

function gantry(add: Add, t: Track, inside: number) {
  const W = t.width, mat = new THREE.MeshLambertMaterial({ color: 0x20242f });
  const a = t.point(0, inside), b = t.point(0, W / 2 + 1);
  for (const p of [a, b]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9 + p.y, 0.5), mat);
    pole.position.set(p.x, (9 + p.y) / 2, p.z);
    add(pole);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, W / 2 + 1 - inside), new THREE.MeshBasicMaterial({ map: gantryTexture() }));
  beam.position.set((a.x + b.x) / 2, 9 + b.y, (a.z + b.z) / 2);
  beam.rotation.y = -Math.atan2(a.p.hz, a.p.hx);
  add(beam);
}

function kerbs(add: Add, t: Track) {
  const mat = new THREE.MeshLambertMaterial({ map: kerbTexture(), polygonOffset: true, polygonOffsetFactor: -2 });
  for (const turn of t.turns) {
    const d = -turn.dir * t.width / 2, inward = d + turn.dir * 1.4;
    const edge = (x: number) => (s: number) => { const p = t.point(s, x); return new THREE.Vector3(p.x, p.y + 0.03, p.z); };
    add(new THREE.Mesh(turn.dir > 0 ? strip(t, edge(d), edge(inward), 4, turn.s0, turn.s1) : strip(t, edge(inward), edge(d), 4, turn.s0, turn.s1), mat));
  }
}

function lights(add: Add, t: Track, on: boolean, stand: number) {
  const n = Math.max(8, Math.round(t.length / 110)), poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
  const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.25) / n) * t.length;
    if (Math.abs(t.gap(s, 0)) < stand / 2 + 20) continue;
    const p = t.point(s, t.width / 2 + 16), h = 30;
    poles.push(new THREE.CylinderGeometry(0.35, 0.6, h, 6).translate(p.x, h / 2, p.z));
    heads.push(new THREE.BoxGeometry(5, 2.4, 5).translate(p.x, h + 1, p.z));
    if (!on) continue;
    const sprite = new THREE.Sprite(glow);
    sprite.position.set(p.x, h + 1, p.z);
    sprite.scale.setScalar(24);
    add(sprite, true);
  }
  add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x5a5f6e })));
  add(new THREE.Mesh(mergeGeometries(heads), on ? new THREE.MeshBasicMaterial({ color: 0xfff3d6 }) : new THREE.MeshLambertMaterial({ color: 0x8a8f9c })));
}

// What the cars' paint reflects: this sky, this ground, and bright panels where the light comes from
function reflections(time: Time, ground: string) {
  const env = new THREE.Scene();
  const c = canvas(4, 256), g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  const earth = '#' + new THREE.Color(ground).multiplyScalar(time.dim * 0.5).getHexString();
  grad.addColorStop(0, time.sky[0]);
  grad.addColorStop(0.48, time.sky[1]);
  grad.addColorStop(0.52, earth);
  grad.addColorStop(1, earth);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: texture(c, false), side: THREE.BackSide })));
  const panel = (p: THREE.Vector3, w: number, h: number, color: number, power: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.copy(p);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(new THREE.Vector3(...time.sunAt).normalize().multiplyScalar(80), 30, 30, time.sun[0], 6);
  panel(new THREE.Vector3(0, 90, 0), 120, 20, 0xffffff, time.lamps ? 2.5 : 1.5);
  if (time.lamps) for (const a of [0.6, 2.2, 3.8, 5.4]) panel(new THREE.Vector3(Math.cos(a) * 75, 40, Math.sin(a) * 75), 14, 8, 0xfff1d0, 5);
  return env;
}

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

// --- sparks, flames, smoke: a pool of points each, reused round and round ------------------------------
class Particles {
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  readonly points: THREE.Points;

  constructor(private n: number, color: number, size: number, blending: THREE.Blending, opacity = 1) {
    this.pos = new Float32Array(n * 3).fill(-1e4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: glowTexture(), blending, transparent: true, opacity, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  // `spread`: sideways speed; `rise`: upward speed; `life`: seconds (plus a little at random)
  emit(at: THREE.Vector3, count: number, spread: number, rise: number, life = 0.3) {
    for (let i = 0; i < count; i++) {
      const k = this.next++ % this.n;
      this.pos.set([at.x + (Math.random() - 0.5) * 0.6, at.y, at.z + (Math.random() - 0.5) * 0.6], k * 3);
      this.vel.set([(Math.random() - 0.5) * spread, rise * (0.5 + Math.random()), (Math.random() - 0.5) * spread], k * 3);
      this.life[k] = life + Math.random() * life;
    }
  }

  update(dt: number, gravity: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e4; continue; }
      this.vel[k * 3 + 1] += gravity * dt;
      for (let j = 0; j < 3; j++) this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

// --- placing things on the track ------------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const basis = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

function surfaceUp(t: Track, s: number, d: number) {
  const p = t.at(s), b = Math.atan(t.slope(s, d));
  return new THREE.Vector3(p.hz * Math.sin(b), Math.cos(b), -p.hx * Math.sin(b));
}

function place(t: Track, o: THREE.Object3D, s: number, d: number, yaw: number) {
  const p = t.point(s, d);
  const f = new THREE.Vector3(p.p.hx, 0, p.p.hz), right = new THREE.Vector3(-p.p.hz, 0, p.p.hx);
  basis.makeBasis(f, UP, right);
  o.quaternion.setFromRotationMatrix(basis)
    .multiply(q1.setFromAxisAngle(X, -Math.atan(t.slope(s, d))))
    .multiply(q2.setFromAxisAngle(UP, -yaw));
  o.position.set(p.x, p.y, p.z);
}

// A ribbon along the lap (or part of it) between two edges: inner edge first, so it faces up / inwards.
// u0..u1: the part of the texture across it.
function strip(t: Track, a: (s: number) => THREE.Vector3, b: (s: number) => THREE.Vector3, tile: number, s0 = 0, s1 = t.length, u0 = 0, u1 = 1) {
  const n = Math.max(1, Math.ceil((s1 - s0) / STEP)), pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, p = a(s), q = b(s), v = (s - s0) / tile;
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uv.push(u0, v, u1, v);
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
function asphaltTexture() {
  const c = canvas(512, 512), g = c.getContext('2d')!, rnd = seeded(12);
  g.fillStyle = '#383b42';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 26000, 62, rnd, 1);
  speckle(g, 512, 512, 2500, 90, rnd, 2);
  g.fillStyle = 'rgba(12,12,16,0.22)'; // rubber down the racing line
  g.fillRect(150, 0, 212, 512);
  g.strokeStyle = 'rgba(8,8,10,0.25)';
  for (let i = 0; i < 22; i++) {
    let x = 20 + rnd() * 472;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) { x += (rnd() - 0.5) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#e8e6df'; // white lines both edges
  g.fillRect(0, 0, 8, 512);
  g.fillRect(504, 0, 8, 512);
  return texture(c);
}

function pitTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(6);
  g.fillStyle = '#4a4d55';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 1500, 80, rnd);
  return texture(c);
}

function garageTexture(lit: boolean) {
  const c = canvas(64, 256), g = c.getContext('2d')!;
  g.fillStyle = '#d9d6cf';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = lit ? '#fff1cf' : '#3a3f4c'; // the open doors (x is up the wall, y along it)
  g.fillRect(0, 30, 44, 196);
  g.fillStyle = '#9ea2ad';
  for (let y = 30; y < 226; y += 14) g.fillRect(0, y, 44, 2);
  return texture(c);
}

function kerbTexture() {
  const c = canvas(16, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 64; y += 16) {
    g.fillStyle = y % 32 ? '#f3f0e8' : '#c8323a';
    g.fillRect(0, y, 16, 16);
  }
  return texture(c);
}

function wallTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#c8323a'; // a red band along the barrier (x is up the wall, y along it)
  g.fillRect(20, 0, 22, 64);
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
  g.fillStyle = 'rgba(120,126,140,0.9)';
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
  g.fillText('GRAND  PRIX', 256, 34);
  return texture(c, false);
}

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
