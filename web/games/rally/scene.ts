// The 3D world: the stage's land and road (drawn from stage.ts's grid, so it's exactly what the cars
// drive on), the ford, trees and rocks, lit for day or dusk; the cars (the shared models, with their
// front wheels steering, every wheel spinning and riding its spring, and a shadow on the ground under
// them however high they fly); dust and spray; and the cameras: a chase camera per person (the screen
// splits for 2 to 4) that keeps the horizon level through the jumps, a roadside camera when nobody's
// driving, and a turntable for each person while they pick a car. Plain three.js, cheap materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carLights, carMesh, disposeCar, fitTyres, type CarModel } from '@racing/cars.ts';
import { canvas, checkerTexture, DISPLAY_FONT, seeded, speckle, texture } from '@world/draw.ts';
import { Tyre } from '@racing/tyres.ts';
import { WeatherLook } from '@world/precipitation.ts';
import { layout, type Rect } from '@world/screen.ts';
import { reflections, sky } from '@world/sky.ts';
import { SURFACE_LIST, SURFACES } from './physics.ts';
import type { Racer } from './race.ts';
import type { Stage } from './stage.ts';
import type { Weather } from '@world/weather.ts';

// The light of each time of day. `env`: how strongly the cars reflect the sky; `carLights`: their lamps
const TIMES = {
  day: { sky: ['#5b97de', '#d4e7f7'], fog: 0xc8dcef, hemi: [0xe8f0ff, 0x4f6a3a, 1.8], sun: [0xfff0d8, 2.8], sunAt: [300, 380, 200], dim: 1, env: 1, carLights: 0 },
  dusk: { sky: ['#2b3264', '#f2a468'], fog: 0xcf8f6c, hemi: [0xffd2b2, 0x3e2c20, 1.4], sun: [0xffad68, 2.5], sunAt: [-500, 120, -300], dim: 0.8, env: 0.8, carLights: 0.8 },
} as const;
type Time = (typeof TIMES)[keyof typeof TIMES];

// The colours of each kind of land
const LOOKS = {
  forest: { low: '#5a8240', high: '#3a6131', rock: '#77736a', bank: '#6e5a40', tree: '#25552f', trunk: '#5a4030', stone: '#8a877e' },
  canyon: { low: '#c98d58', high: '#a95a33', rock: '#7c3a26', bank: '#a8683f', tree: '#4f7a3a', trunk: '#4f7a3a', stone: '#8c4a30' },
} as const;
// Under snow: white land with the rock showing through, the road packed white with the gravel
// rutted through it, and the trees dark under their load
type Look = { -readonly [K in keyof (typeof LOOKS)['forest']]: string } & { road: Record<string, string> };
function lookFor(st: Stage, snow: boolean): Look {
  const base = LOOKS[st.spec.look], white = (c: string, k: number) => '#' + new THREE.Color(c).lerp(new THREE.Color('#eef2f7'), k).getHexString();
  if (!snow) return { ...base, road: ROAD };
  return {
    ...base, low: white(base.low, 0.85), high: white(base.high, 0.8), bank: white(base.bank, 0.7), rock: white(base.rock, 0.25),
    tree: '#' + new THREE.Color(base.tree).multiplyScalar(0.75).getHexString(),
    road: Object.fromEntries(Object.entries(ROAD).map(([k, c]) => [k, k === 'water' ? c : white(c, 0.68)])),
  };
}
// the road's colour, by surface (the texture is grey grit and ruts, tinted by this)
const ROAD: Record<string, string> = { tarmac: '#4a4c52', gravel: '#b7a283', dirt: '#6e4a30', grass: '#6e7d4a', water: '#6b6250' };
// what each surface throws up
const SNOW_DUST: [number, number, number] = [0.95, 0.97, 1]; // powder
const MUD: [number, number, number] = [0.36, 0.3, 0.24]; // what wet gravel and dirt throw up
const DUST: Record<string, [number, number, number]> = { gravel: [0.72, 0.65, 0.53], dirt: [0.74, 0.55, 0.38], grass: [0.45, 0.42, 0.3], tarmac: [0.6, 0.6, 0.62], water: [0.92, 0.95, 1] };

const CELL_STEPS = [1, 2, 4]; // the land's detail near, further, far
const LOD_AT = [0, 280, 650]; // m: where each takes over (the coarse ones smooth over the road in a cutting: keep them far off)
const CHUNK = 32; // grid squares per side of a piece of land (small, so how far each is from the camera is about right)

export interface View {
  racer: Racer | null; // whose chase camera; null: the roadside camera
  show: THREE.Object3D | null; // or a car on a turntable
  rect: Rect;
  camera: THREE.PerspectiveCamera;
  lookBack: boolean;
  dir: THREE.Vector3; // the chase camera's heading, level and eased
  eye: THREE.Vector3;
  aim: THREE.Vector3;
  shake: number;
  fresh: boolean; // just made: jump straight to the car
}

// A car as drawn: its model, its shadow on the ground, and its wheels
interface Drawn {
  g: THREE.Group;
  shadow: THREE.Mesh;
  offset: THREE.Vector3; // the centre of mass, from the model's origin
  wheels: { node: THREE.Object3D; base: number; i: number }[];
  scale: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private venue = new THREE.Group();
  private stage: Stage | null = null;
  private cars = new Map<Racer, Drawn>();
  private extras: THREE.Object3D[] = []; // what goes first when the screen struggles
  private dust = new Dust();
  private shown: THREE.Group[] = [];
  private lightsOn = 0;
  private dustColor: [number, number, number] = DUST.gravel;
  private snow = false;
  private weather = new WeatherLook(this.scene);
  private road: THREE.MeshLambertMaterial | null = null;
  private wet = 0;
  views: View[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(this.venue, this.dust.points);
  }

  // Lower the detail when the screen can't keep up: first the resolution, then the extras
  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else { for (const o of this.extras) o.visible = false; this.dust.thin = true; this.weather.fewer(); }
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  // --- the stage -------------------------------------------------------------------------------------
  setStage(stage: Stage, snow = false) {
    if (this.stage === stage && this.snow === snow) return;
    this.stage = stage;
    this.snow = snow;
    this.venue.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat() as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
    });
    this.venue.clear();
    this.extras = [];
    const time = TIMES[stage.spec.time], look = lookFor(stage, snow);
    this.scene.fog = new THREE.Fog(time.fog, 260, 1700);
    this.scene.background = new THREE.Color(time.fog);
    const pmrem = new THREE.PMREMGenerator(this.renderer), env = reflections(time, look.low);
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = time.env;
    env.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.MeshBasicMaterial).map?.dispose(); o.material.dispose(); } });
    pmrem.dispose();
    this.lightsOn = time.carLights;
    this.dustColor = snow ? SNOW_DUST : DUST[stage.spec.look === 'forest' ? 'gravel' : 'dirt'];
    for (const d of this.cars.values()) carLights(d.g, this.lightsOn);
    for (const g of this.shown) carLights(g, this.lightsOn);
    buildVenue((o, extra) => { this.venue.add(o); if (extra) this.extras.push(o); }, stage, time, look);
    this.weather.venue(null);
    this.road = ((this.venue.children.find((o) => o.userData.road) as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial) ?? null;
  }

  // --- the cars ----------------------------------------------------------------------------------------
  setCars(racers: Racer[], models: Map<string, CarModel>) {
    this.clearCars();
    for (const r of racers) {
      const m = models.get(r.spec.car.id)!;
      const g = carMesh(m, r.spec.paint ?? r.spec.color, r.spec.number);
      carLights(g, this.lightsOn);
      // the shadow goes on the ground, not with the car (it stays down there when the car flies)
      let shadow: THREE.Mesh | null = null;
      g.traverse((o) => { if (o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).map === m.shadow) shadow = o; });
      const sh = shadow! as THREE.Mesh;
      g.remove(sh);
      this.scene.add(g, sh);
      const c = r.car.c, model = g.children[0];
      const wheels = r.car.wheels.map((w, i) => {
        const node = model.getObjectByName(w.name)!;
        node.rotation.order = 'YXZ'; // (steer, then spin)
        return { node, base: node.position.y, i };
      });
      const shape = { x: 0, z: 0 };
      const mid = new THREE.Box3().setFromObject(m.scene).getCenter(new THREE.Vector3());
      shape.x = mid.z * m.scale; shape.z = -mid.x * m.scale;
      this.cars.set(r, { g, shadow: sh, offset: new THREE.Vector3(shape.x, c.cmHeight, shape.z), wheels, scale: m.scale });
    }
  }

  private clearCars() {
    for (const d of this.cars.values()) {
      this.scene.remove(d.g, d.shadow);
      disposeCar(d.g);
      (d.shadow.material as THREE.Material).dispose();
      d.shadow.geometry.dispose();
    }
    this.cars.clear();
  }

  // Each person's chase camera; a roadside camera too when nobody is driving, or to fill the fourth corner
  setViews(racers: Racer[]) {
    this.clearShowroom();
    this.views = layout(racers.length).map((rect, i) => view(rect, racers[i] ?? null));
  }

  // Picking cars: each person's choice on a turntable on the start straight, in their part of the screen
  showroom(picks: { model: CarModel; color: string; number: number }[]) {
    this.clearShowroom();
    const st = this.stage!;
    this.views = layout(picks.length).slice(0, picks.length).map((rect, i) => {
      const g = carMesh(picks[i].model, picks[i].color, picks[i].number);
      carLights(g, this.lightsOn);
      fitTyres(g, this.snow ? Tyre.Snow : Tyre.Gravel);
      g.position.copy(st.point(-60, (i - (picks.length - 1) / 2) * 8));
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

  // A hit: a puff of dust and a jolt for that driver's camera
  hit(r: Racer, strength: number) {
    const p = r.car.p;
    this.dust.burst(p, Math.min(30, 4 + strength * 2), this.dustColor, 1.2);
    for (const v of this.views) if (v.racer === r) v.shake = Math.max(v.shake, Math.min(0.6, strength * 0.05));
  }

  // Landing from a jump: dust from under it, a jolt as heavy as the landing
  land(r: Racer, impact: number) {
    const p = r.car.p;
    _a.set(p.x, p.y - r.car.c.cmHeight, p.z);
    this.dust.burst(_a, Math.min(40, 8 + impact * 4), this.dustColor, 2);
    for (const v of this.views) if (v.racer === r) v.shake = Math.max(v.shake, Math.min(0.5, impact * 0.06));
  }

  // Place everything and draw each view. `follow`: who the roadside camera watches.
  render(dt: number, follow: Racer | null, weather: Weather | null = null) {
    const st = this.stage!;
    this.weather.update(dt, weather);
    this.wet = weather && !weather.snow ? weather.wet : 0;
    this.road?.color.setScalar(1 - 0.38 * this.wet); // (a wet road is darker; Lambert can't shine)
    for (const [r, d] of this.cars) {
      fitTyres(d.g, this.snow ? Tyre.Snow : Tyre.Gravel);
      this.place(r, d);
      this.kickUp(r, dt);
    }
    for (const g of this.shown) g.rotation.y += dt * 0.5;
    this.dust.update(dt);

    const rd = this.renderer, cv = rd.domElement;
    const W = cv.clientWidth, H = cv.clientHeight;
    rd.setScissorTest(true);
    for (const v of this.views) {
      const x = v.rect.x * W, y = (1 - v.rect.y - v.rect.h) * H, w = v.rect.w * W, h = v.rect.h * H;
      v.camera.aspect = w / h;
      if (v.show) turntable(st, v.camera, v.show);
      else if (v.racer) chase(st, v, v.racer, dt);
      else if (follow) roadside(st, v, follow, dt);
      if (v.shake > 0.01) {
        v.camera.position.add(_a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(v.shake));
        v.shake *= Math.exp(-7 * dt);
      }
      this.dust.scale(h * rd.getPixelRatio(), v.camera.fov);
      rd.setViewport(x, y, w, h);
      rd.setScissor(x, y, w, h);
      rd.render(this.scene, v.camera);
    }
  }

  // The car where the physics has it; its wheels turned, spun and on their springs; its shadow below
  private place(r: Racer, d: Drawn) {
    const car = r.car, st = this.stage!;
    d.g.quaternion.copy(car.q);
    d.g.position.copy(d.offset).applyQuaternion(car.q).negate().add(car.p);
    for (const w of d.wheels) {
      const wh = car.wheels[w.i];
      w.node.position.y = w.base + (car.rest - wh.length) / d.scale;
      w.node.rotation.x = wh.spin;
      w.node.rotation.y = wh.front ? -car.angle : 0;
    }
    const ground = st.height(car.p.x, car.p.z), above = car.p.y - car.c.cmHeight - ground;
    st.normal(car.p.x, car.p.z, _n);
    _f.set(1, 0, 0).applyQuaternion(car.q);
    const yaw = Math.atan2(-_f.z, _f.x);
    d.shadow.quaternion.setFromUnitVectors(UP, _n).multiply(_q.setFromAxisAngle(UP, yaw));
    d.shadow.position.set(car.p.x, ground + 0.02, car.p.z);
    (d.shadow.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - above / 6);
  }

  // Dust off loose ground (more when sliding), spray through water
  private kickUp(r: Racer, dt: number) {
    const car = r.car, speed = car.speed;
    if (speed < 3) return;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      const surface = SURFACES[w.surface], water = w.surface === 'water';
      const amount = water ? speed * 0.6 : surface.dust * (Math.max(0, speed - 4) * 0.12 + w.slip * 0.9);
      if (Math.random() > amount * dt * 4) continue;
      _a.set(w.x, -car.c.cmHeight + 0.2, w.z).applyQuaternion(car.q).add(car.p);
      _v.copy(car.v).multiplyScalar(water ? 0.2 : -0.05).add(_b.set((Math.random() - 0.5) * 2, water ? 3 + Math.random() * 3 : 0.6 + Math.random(), (Math.random() - 0.5) * 2));
      // (in the snow everything throws up powder; once it's wet, gravel and dirt throw mud, not dust)
      const color = water ? DUST.water : this.snow ? SNOW_DUST : this.wet > 0.4 && surface.dust > 0.5 ? MUD : DUST[w.surface] ?? this.dustColor;
      this.dust.emit(_a, _v, water ? 1.2 : 1.6 + Math.random(), water ? 0.7 : 1.4 + Math.random(), color, water ? 0.8 : 0.45);
    }
  }
}

const view = (rect: Rect, racer: Racer | null): View => ({
  racer, show: null, rect, lookBack: false, shake: 0, fresh: true,
  dir: new THREE.Vector3(1, 0, 0), eye: new THREE.Vector3(), aim: new THREE.Vector3(),
  camera: new THREE.PerspectiveCamera(64, 1, 0.3, 5000),
});

// --- the cameras -------------------------------------------------------------------------------------
// Behind the car and a little above, turning with it but never tipping with it: through a jump the
// horizon stays level and the car pitches and rolls in front of you
function chase(st: Stage, v: View, r: Racer, dt: number) {
  const car = r.car, cam = v.camera;
  _f.set(1, 0, 0).applyQuaternion(car.q);
  _f.y = 0;
  if (_f.lengthSq() > 0.05) {
    _f.normalize();
    if (v.fresh) v.dir.copy(_f); else v.dir.lerp(_f, 1 - Math.exp(-4 * dt)).normalize();
  }
  const back = v.lookBack ? -1 : 1, behind = 6 + car.c.length * 0.6;
  _a.copy(car.p).addScaledVector(v.dir, -behind * back);
  _a.y = Math.max(car.p.y + 2 + car.c.height * 0.4, st.height(_a.x, _a.z) + 1.4);
  if (v.fresh || v.eye.distanceTo(_a) > 40) v.eye.copy(_a);
  else v.eye.lerp(_a, 1 - Math.exp(-9 * dt));
  v.fresh = false;
  cam.position.copy(v.eye);
  cam.up.copy(UP);
  cam.lookAt(_b.copy(car.p).addScaledVector(v.dir, 5 * back).setY(car.p.y + 0.8));
  cam.fov = 64 + 12 * Math.min(1, car.speed / 45) ** 2;
  cam.updateProjectionMatrix();
}

// The TV camera: up above and behind the car, drifting slowly round it, so the hills and cuttings
// the road runs through never get in the way and the jumps are seen from the side
function roadside(st: Stage, v: View, r: Racer, dt: number) {
  const cam = v.camera, car = r.car;
  _f.set(1, 0, 0).applyQuaternion(car.q);
  _f.y = 0;
  if (_f.lengthSq() > 0.05) { _f.normalize(); if (v.fresh) v.dir.copy(_f); else v.dir.lerp(_f, 1 - Math.exp(-1.5 * dt)).normalize(); }
  const swing = Math.sin(performance.now() / 7000) * 1.1; // (round to one side, then the other)
  _a.copy(v.dir).applyAxisAngle(UP, swing).multiplyScalar(-17).add(car.p);
  _a.y = Math.max(car.p.y + 8, st.height(_a.x, _a.z) + 4);
  if (v.fresh || v.eye.distanceTo(_a) > 60) v.eye.copy(_a); else v.eye.lerp(_a, 1 - Math.exp(-3 * dt));
  _b.copy(car.p);
  if (v.fresh || v.aim.distanceTo(_b) > 60) v.aim.copy(_b); else v.aim.lerp(_b, 1 - Math.exp(-8 * dt));
  v.fresh = false;
  cam.position.copy(v.eye);
  cam.up.copy(UP);
  cam.lookAt(v.aim);
  cam.fov = 50;
  cam.updateProjectionMatrix();
}

function turntable(st: Stage, cam: THREE.PerspectiveCamera, g: THREE.Object3D) {
  const h = st.heading(-60);
  cam.position.set(g.position.x - Math.sin(h) * 9, g.position.y + 2.6, g.position.z + Math.cos(h) * 9);
  cam.up.copy(UP);
  cam.lookAt(g.position.x, g.position.y + 0.9, g.position.z);
  cam.fov = 40;
  cam.updateProjectionMatrix();
}

// --- the venue, from the stage ----------------------------------------------------------------------
type Add = (o: THREE.Object3D, extra?: boolean) => void; // extra: drop it when the screen struggles

function buildVenue(add: Add, st: Stage, time: Time, look: Look) {
  add(new THREE.HemisphereLight(time.hemi[0], time.hemi[1], time.hemi[2]));
  const sun = new THREE.DirectionalLight(time.sun[0], time.sun[1]);
  sun.position.set(time.sunAt[0], time.sunAt[1], time.sunAt[2]);
  add(sun);
  add(sky(time.sky[0], time.sky[1], 4800));
  land(add, st, time, look);
  add(farLand(st, time, look), true);
  road(add, st, time, look);
  if (st.water) {
    const w = st.water;
    add(new THREE.Mesh(new THREE.CircleGeometry(w.r, 40).rotateX(-Math.PI / 2).translate(w.x, w.level, w.z),
      new THREE.MeshStandardMaterial({ color: dim('#3d6f8a', time.dim), roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.78 })));
  }
  scenery(add, st, time, look);
  chevrons(add, st, time);
  gantry(add, st);
}

// The land, in pieces, each drawn finer near the camera and coarser far away; each piece has a skirt
// hanging down round its edge, so where a fine piece meets a coarse one there's no gap to see through
function land(add: Add, st: Stage, time: Time, look: Look) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grainTexture() });
  const low = new THREE.Color(look.low), high = new THREE.Color(look.high), rock = new THREE.Color(look.rock), bank = new THREE.Color(look.bank);
  const wild = SURFACE_LIST.indexOf(st.spec.look === 'forest' ? 'grass' : 'dirt'); // (as stage.ts lays it)
  let lowest = Infinity, highest = -Infinity;
  for (const h of st.heights) { lowest = Math.min(lowest, h); highest = Math.max(highest, h); }
  const H = (i: number, j: number) => st.heights[Math.min(st.nz - 1, Math.max(0, j)) * st.nx + Math.min(st.nx - 1, Math.max(0, i))];
  const color = (i: number, j: number, out: THREE.Color) => {
    const k = Math.min(st.nz - 1, j) * st.nx + Math.min(st.nx - 1, i), h = H(i, j);
    const slope = (Math.abs(H(i + 1, j) - H(i - 1, j)) + Math.abs(H(i, j + 1) - H(i, j - 1))) / 5;
    const surface = st.surfaces[k];
    out.copy(low).lerp(high, Math.max(0, Math.min(1, (h - lowest) / (highest - lowest + 1)))).lerp(rock, Math.max(0, Math.min(1, (slope - 0.35) * 2)));
    if (surface !== wild) out.lerp(bank, 0.8); // (not the open land: the road's verges and the ford's bed)
    return out.multiplyScalar(time.dim);
  };
  const C = 2.5; // (the grid's spacing: stage.ts)
  for (let cj = 0; cj < st.nz - 1; cj += CHUNK) for (let ci = 0; ci < st.nx - 1; ci += CHUNK) {
    const lod = new THREE.LOD(), i1 = Math.min(st.nx - 1, ci + CHUNK), j1 = Math.min(st.nz - 1, cj + CHUNK);
    const cx = st.x0 + ((ci + i1) / 2) * C, cz = st.z0 + ((cj + j1) / 2) * C;
    lod.position.set(cx, 0, cz);
    CELL_STEPS.forEach((step, level) => {
      const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
      const is: number[] = [], js: number[] = [];
      for (let i = ci; i < i1; i += step) is.push(i);
      is.push(i1);
      for (let j = cj; j < j1; j += step) js.push(j);
      js.push(j1);
      const c = new THREE.Color(), vert = (i: number, j: number, drop: number) => {
        const x = st.x0 + i * C, z = st.z0 + j * C, h = H(i, j);
        pos.push(x - cx, h - drop, z - cz);
        _n.set(-(H(i + 1, j) - H(i - 1, j)) / (2 * C), 1, -(H(i, j + 1) - H(i, j - 1)) / (2 * C)).normalize();
        nor.push(_n.x, _n.y, _n.z);
        color(i, j, c);
        col.push(c.r, c.g, c.b);
        uv.push(x / 9, z / 9);
        return pos.length / 3 - 1;
      };
      const grid: number[][] = js.map((j) => is.map((i) => vert(i, j, 0)));
      for (let b = 0; b < js.length - 1; b++) for (let a = 0; a < is.length - 1; a++) {
        const p00 = grid[b][a], p10 = grid[b][a + 1], p01 = grid[b + 1][a], p11 = grid[b + 1][a + 1];
        idx.push(p00, p11, p10, p00, p01, p11); // (split the same way as stage.ts's height())
      }
      // the skirt
      const ring: [number, number, number][] = [
        ...is.map((i, a): [number, number, number] => [i, js[0], grid[0][a]]),
        ...js.slice(1).map((j, b): [number, number, number] => [is[is.length - 1], j, grid[b + 1][is.length - 1]]),
        ...is.slice(0, -1).reverse().map((i, a): [number, number, number] => [i, js[js.length - 1], grid[js.length - 1][is.length - 2 - a]]),
        ...js.slice(0, -1).reverse().map((j, b): [number, number, number] => [is[0], j, grid[js.length - 2 - b][0]]),
      ];
      const skirt = ring.map(([i, j]) => vert(i, j, 4));
      for (let k = 0; k < ring.length - 1; k++) idx.push(ring[k][2], skirt[k], ring[k + 1][2], ring[k + 1][2], skirt[k], skirt[k + 1]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, mat);
      mesh.material.side = THREE.DoubleSide; // (the skirts are seen from either side)
      lod.addLevel(mesh, LOD_AT[level]);
    });
    add(lod);
  }
}

// Hills all round, out to the horizon, under the stage's land and rising away from it
function farLand(st: Stage, time: Time, look: Look) {
  const size = 9000, n = 110;
  const g = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2);
  const cx = st.x0 + (st.nx * 2.5) / 2, cz = st.z0 + (st.nz * 2.5) / 2, half = Math.max(st.nx, st.nz) * 1.25;
  g.translate(cx, 0, cz);
  const pos = g.attributes.position as THREE.BufferAttribute, colors: number[] = [];
  const low = new THREE.Color(look.low), high = new THREE.Color(look.high), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), out = Math.max(Math.abs(x - cx), Math.abs(z - cz)) - half;
    const rise = out < 0 ? -8 : Math.min(1, out / 900) ** 1.5 * st.spec.hills * 5;
    const h = st.natural(x, z) * (out < 0 ? 1 : 1.6) + rise;
    pos.setY(i, h);
    c.copy(low).lerp(high, Math.min(1, Math.max(0, rise / (st.spec.hills * 4)))).multiplyScalar(time.dim);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// The road: a ribbon a little above the land, gritty, with ruts worn into it, tinted by its surface
function road(add: Add, st: Stage, time: Time, look: Look) {
  const W = st.width, cols = 9, rows = Math.ceil(st.length / 2);
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [], c = new THREE.Color();
  for (let r = 0; r <= rows; r++) {
    const s = (r / rows) * st.length;
    c.set(look.road[st.surfs[Math.floor(s) % st.length]]).multiplyScalar(time.dim);
    for (let k = 0; k < cols; k++) {
      const u = k / (cols - 1), p = st.point(s, (u - 0.5) * (W + 2.8), _a);
      pos.push(p.x, p.y + 0.04, p.z);
      uv.push(u, s / 10);
      col.push(c.r, c.g, c.b);
      if (r < rows && k < cols - 1) { const a = r * cols + k; idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols); } // (facing up)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ribbon = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: roadTexture(), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  ribbon.userData.road = true; // (it darkens when it's wet)
  add(ribbon);
  // the start/finish line
  const line: number[] = [], lineUv: number[] = [];
  for (const [ds, v] of [[-0.8, 0], [0.8, 1]]) for (const u of [0, 1]) {
    const p = st.point(ds, (u - 0.5) * W, _a);
    line.push(p.x, p.y + 0.06, p.z);
    lineUv.push(u, v);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(lineUv, 2));
  lg.setIndex([0, 2, 1, 1, 2, 3]);
  add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6 })));
}

function scenery(add: Add, st: Stage, time: Time, look: Look) {
  const place = (kind: string, geo: THREE.BufferGeometry, color: string, size: (s: number) => [number, number, number], flat = false) => {
    const list = st.scenery.filter((s) => s.kind === kind);
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: dim(color, time.dim), flatShading: flat }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), rnd = seeded(5);
    list.forEach((s, i) => {
      q.setFromAxisAngle(UP, rnd() * 6.28);
      mesh.setMatrixAt(i, m.compose(_a.set(s.x, s.y - 0.2, s.z), q, _b.set(...size(s.size))));
    });
    add(mesh);
  };
  const tree = mergeGeometries([new THREE.ConeGeometry(3.4, 9, 7).translate(0, 8, 0), new THREE.ConeGeometry(2.6, 7, 7).translate(0, 12, 0)]);
  place('tree', tree, look.tree, (k) => [k, k * 1.1, k]);
  place('tree', new THREE.CylinderGeometry(0.35, 0.5, 4, 6).translate(0, 2, 0), look.trunk, (k) => [k, k, k]);
  place('rock', new THREE.DodecahedronGeometry(1, 0), look.stone, (k) => [k * 1.2, k * 0.9, k * 1.05], true);
  const cactus = mergeGeometries([
    new THREE.CylinderGeometry(0.45, 0.5, 5, 7).translate(0, 2.5, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 2, 6).translate(1, 3, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 1.2, 6).rotateZ(Math.PI / 2).translate(0.6, 2.1, 0),
    new THREE.CylinderGeometry(0.28, 0.28, 1.6, 6).translate(-0.9, 3.6, 0),
    new THREE.CylinderGeometry(0.28, 0.28, 1, 6).rotateZ(Math.PI / 2).translate(-0.5, 2.9, 0),
  ]);
  place('cactus', cactus, look.tree, (k) => [k, k, k]);
}

// Chevron boards on the outside of the tight bends, pointing the way
function chevrons(add: Add, st: Stage, time: Time) {
  const L = st.length, at: { s: number; dir: number }[] = [];
  for (let s = 0; s < L; s += 2) {
    const k = st.curve(s);
    if (Math.abs(k) < 1 / 40) continue;
    if (Math.abs(st.curve(s - 2)) > Math.abs(k) || Math.abs(st.curve(s + 2)) > Math.abs(k)) continue; // (the bend's tightest point)
    if (at.length && st.gap(s, at[at.length - 1].s) < 30) continue;
    at.push({ s, dir: Math.sign(k) });
  }
  for (const dir of [-1, 1]) {
    const list = at.filter((a) => a.dir === dir);
    if (!list.length) continue;
    const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshBasicMaterial({ map: chevronTexture(dir), side: THREE.DoubleSide, color: dim('#ffffff', Math.max(0.7, time.dim)) }), list.length);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.4, 0.1).translate(0, 0.7, 0), new THREE.MeshLambertMaterial({ color: 0x3a3d44 }), list.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((a, i) => {
      const p = st.point(a.s, -dir * (st.width / 2 + 3), _a), h = st.heading(a.s - 20);
      q.setFromAxisAngle(UP, -h - Math.PI / 2); // (facing back down the road at whoever's coming)
      boards.setMatrixAt(i, m.compose(_b.set(p.x, p.y + 1.6, p.z), q, ONE));
      for (const side of [-1, 1]) legs.setMatrixAt(i * 2 + (side + 1) / 2, m.makeTranslation(p.x + Math.sin(h) * side * 1.1, p.y, p.z - Math.cos(h) * side * 1.1));
    });
    add(boards, true);
    add(legs, true);
  }
}

function gantry(add: Add, st: Stage) {
  const W = st.width, mat = new THREE.MeshLambertMaterial({ color: 0x20242f });
  const a = st.point(0, -(W / 2 + 1.2)), b = st.point(0, W / 2 + 1.2);
  for (const p of [a, b]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), mat);
    pole.position.set(p.x, p.y + 4, p.z);
    add(pole);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, W + 2.4), new THREE.MeshBasicMaterial({ map: gantryTexture() }));
  beam.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 8, (a.z + b.z) / 2);
  beam.rotation.y = -st.heading(0);
  add(beam);
}



// --- dust and spray: soft round puffs that drift, grow and fade ----------------------------------------
class Dust {
  private n = 1400;
  private pos = new Float32Array(this.n * 3);
  private vel = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private span = new Float32Array(this.n);
  private size = new Float32Array(this.n);
  private alpha = new Float32Array(this.n);
  private tint = new Float32Array(this.n * 3);
  private start = new Float32Array(this.n); // the alpha it starts at
  private next = 0;
  thin = false; // (fewer, when the screen struggles)
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.pos.fill(-1e4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 }, map: { value: puffTexture() } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint; uniform float scale; varying float vAlpha; varying vec3 vTint;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / -mv.z; vAlpha = alpha; vTint = tint; }`,
      fragmentShader: `uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
        void main() { float a = texture2D(map, gl_PointCoord).a * vAlpha; if (a < 0.01) discard; gl_FragColor = vec4(vTint, a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  // How big a metre looks: per view (its height in pixels and its lens)
  scale(heightPx: number, fov: number) {
    this.mat.uniforms.scale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emit(at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, tint: [number, number, number], alpha: number) {
    if (this.thin && Math.random() < 0.5) return;
    const k = this.next++ % this.n;
    this.pos.set([at.x, at.y, at.z], k * 3);
    this.vel.set([vel.x, vel.y, vel.z], k * 3);
    this.tint.set(tint, k * 3);
    this.life[k] = this.span[k] = life;
    this.size[k] = size;
    this.start[k] = alpha;
  }

  burst(at: THREE.Vector3, count: number, tint: [number, number, number], size: number) {
    for (let i = 0; i < count; i++) {
      _v.set((Math.random() - 0.5) * 6, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 6);
      this.emit(at, _v, size + Math.random() * size, 0.8 + Math.random(), tint, 0.5);
    }
  }

  update(dt: number) {
    const drag = Math.exp(-1.6 * dt);
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e4; this.alpha[k] = 0; continue; }
      const t = this.life[k] / this.span[k];
      for (let j = 0; j < 3; j++) { this.vel[k * 3 + j] *= drag; this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt; }
      this.vel[k * 3 + 1] += 0.4 * dt; // (warm dust lifts a little)
      this.size[k] += dt * 1.6;
      this.alpha[k] = this.start[k] * t * Math.min(1, (1 - t) * 8);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'size', 'alpha', 'tint']) (g.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }
}

// --- helpers and textures, drawn here so there's nothing to download -------------------------------------
const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const dim = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

// Grey grit with two worn ruts, fading out at the edges (tinted by the surface's colour)
function roadTexture() {
  const c = canvas(256, 512), g = c.getContext('2d')!, rnd = seeded(31);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 256, 512);
  speckle(g, 256, 512, 9000, 180, rnd, 2);
  speckle(g, 256, 512, 2200, 120, rnd, 3);
  for (const u of [0.33, 0.67]) {
    const grad = g.createLinearGradient(u * 256 - 22, 0, u * 256 + 22, 0);
    grad.addColorStop(0, 'rgba(60,50,40,0)');
    grad.addColorStop(0.5, 'rgba(60,50,40,0.28)');
    grad.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = grad;
    g.fillRect(u * 256 - 22, 0, 44, 512);
  }
  // soft edges: the road fades into the verge
  const img = g.getImageData(0, 0, 256, 512), d = img.data;
  for (let x = 0; x < 256; x++) {
    const u = x / 255, a = Math.min(1, Math.min(u, 1 - u) / 0.12);
    for (let y = 0; y < 512; y++) d[(y * 256 + x) * 4 + 3] = 255 * a * (0.85 + 0.15 * rnd());
  }
  g.putImageData(img, 0, 0);
  return texture(c);
}

function grainTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(41);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(195 + rnd() * 60);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  return texture(c);
}

function chevronTexture(dir: number) {
  const c = canvas(256, 80), g = c.getContext('2d')!;
  g.fillStyle = '#c8323a';
  g.fillRect(0, 0, 256, 80);
  g.fillStyle = '#f3f0e8';
  for (let i = 0; i < 4; i++) {
    const x = 40 + i * 58;
    g.beginPath();
    // (pointing the way the road goes: to the right for a right-hander)
    if (dir > 0) { g.moveTo(x - 14, 12); g.lineTo(x + 10, 40); g.lineTo(x - 14, 68); g.lineTo(x + 4, 68); g.lineTo(x + 28, 40); g.lineTo(x + 4, 12); }
    else { g.moveTo(x + 14, 12); g.lineTo(x - 10, 40); g.lineTo(x + 14, 68); g.lineTo(x - 4, 68); g.lineTo(x - 28, 40); g.lineTo(x - 4, 12); }
    g.fill();
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

function puffTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, false);
}
