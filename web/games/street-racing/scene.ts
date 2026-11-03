// The 3D city, built from its plan (city.ts): avenues, streets and alleys with their markings, junctions with
// zebra crossings and traffic lights, kerbs and pavements, blocks of buildings with lit windows and shops, a
// park, trees, street lamps, bus stops, signs pointing the quickest way to the finish, the river and its
// bridges, the start and the finish with a landmark beyond it, a skyline, planes going over and a helicopter
// following the leader. Moving through it: the cars (cars.ts) with their headlights on at night, the people on
// the crossings, the police car's lights. The cameras: a chase camera per person (the screen splits for 2 to
// 4), a TV camera when nobody's driving, and a turntable for each person while they pick a car.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carLights, carMesh, disposeCar, fitTyres, rollWheels, steerWheels, type CarModel } from '@racing/cars.ts';
import { canvas, checkerTexture, DISPLAY_FONT, seeded, speckle, texture } from '@world/draw.ts';
import { glowTexture, Particles } from '@world/particles.ts';
import { WeatherLook } from '@world/precipitation.ts';
import { layout, type Rect as Screen } from '@world/screen.ts';
import { reflections, sky, stars } from '@world/sky.ts';
import { Tyre } from '@racing/tyres.ts';
import type { Weather } from '@world/weather.ts';
import { fit, loadCast, loadMoves, Person, type Cast, type Moves } from '@people/people.ts';
import { PAVE, type City, type Node } from './city.ts';
import { TOP, type Car, type Drive } from './drive.ts';

// The light of each time of day. `env`: how strongly the cars reflect the sky; `carLights`: how
// bright their headlights and tail lights are; `beams`: how strong the headlights' light on the road is
const TIMES = {
  day: { sky: ['#4f8fdc', '#cfe5fb'], fog: 0xc9e0f6, hemi: [0xe6f0ff, 0x56703f, 1.9], sun: [0xfff2dc, 2.8], sunAt: [250, 420, 300], dim: 1, lamps: false, stars: false, env: 1, carLights: 0, beams: 0 },
  dusk: { sky: ['#27305e', '#f0a066'], fog: 0x8a6a68, hemi: [0xffd0b0, 0x3a2e22, 1.4], sun: [0xffb070, 2.4], sunAt: [-600, 110, -320], dim: 0.8, lamps: true, stars: false, env: 0.8, carLights: 0.8, beams: 0.5 },
  night: { sky: ['#04060b', '#151b2b'], fog: 0x0a0c12, hemi: [0xc4cee6, 0x1d2618, 1.6], sun: [0xfff1dc, 1.6], sunAt: [150, 400, 260], dim: 0.4, lamps: true, stars: true, env: 0.6, carLights: 2, beams: 1 },
} as const;
type Time = (typeof TIMES)[keyof typeof TIMES];

const SIGNAL = { red: 0xff2a2a, amber: 0xffb020, green: 0x2aff7a };
const NEAR = 280; // m: lights and people further than this from every camera aren't drawn
const UP = new THREE.Vector3(0, 1, 0);

// What the scene needs to know about the race it's showing
export interface Route { start: string; to: string; landmark: 'harbour' | 'airport' | 'tower' }

export interface View {
  car: Car | null; // whose chase camera; null: the TV camera
  show: THREE.Object3D | null; // or a car on a turntable
  rect: Screen;
  camera: THREE.PerspectiveCamera;
  lookBack: boolean;
  yaw: number; // the chase camera's heading, eased
  aim: THREE.Vector3;
  shake: number;
  beam: THREE.SpotLight | null; // this person's headlights (real light, on the road and the walls)
}

// The people on the crossings: the shared cast (@people), walking
let walkers: { cast: Cast; moves: Moves } | null = null;
export async function loadPeople() {
  const [cast, moves] = await Promise.all([loadCast('footballers'), loadMoves('football-moves')]);
  walkers = { cast, moves: { ...moves, clips: new Map([...moves.clips].filter(([n]) => n === 'walk')) } };
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private venue = new THREE.Group();
  private city: City | null = null;
  private time: Time = TIMES.night;
  private models = new Map<string, CarModel>();
  private cars = new Map<Car, THREE.Group>();
  private extras: THREE.Object3D[] = []; // what goes first when the screen struggles
  private sparks = new Particles(400, 0xffc46b, 0.22, THREE.AdditiveBlending);
  private weather = new WeatherLook(this.scene);
  private shown: THREE.Group[] = [];
  private people = new People(this.scene);
  private signals = new Signals(this.scene);
  private sky = new Sky(this.scene);
  private siren: THREE.Sprite[] = [];
  private pools: THREE.InstancedMesh; // the headlights' light on the road ahead of every car, at night
  views: View[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(this.venue, this.sparks.points);
    this.siren = [0xff2a3a, 0x2a6dff].map((c) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(3.2);
      s.visible = false;
      this.scene.add(s);
      return s;
    });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0xfff1d6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }), 96);
    this.pools.frustumCulled = false;
    this.pools.count = 0;
    this.scene.add(this.pools);
  }

  setModels(models: Map<string, CarModel>) { this.models = models; }
  setAircraft(plane: THREE.Object3D | null, helicopter: THREE.Object3D | null) { this.sky.set(plane, helicopter); }

  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else {
      for (const o of this.extras) o.visible = false;
      this.weather.fewer();
      this.people.max = 6;
    }
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  // --- the city -----------------------------------------------------------------------------------
  setCity(city: City, route: Route) {
    if (this.city === city) return;
    this.city = city;
    this.venue.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat() as THREE.MeshBasicMaterial[]) { m.map?.dispose(); m.dispose(); }
    });
    this.venue.clear();
    this.extras = [];
    const time = this.time = TIMES[city.spec.time];
    this.scene.fog = new THREE.Fog(time.fog, 220, 1500);
    this.scene.background = new THREE.Color(time.fog);
    const pmrem = new THREE.PMREMGenerator(this.renderer), env = reflections(time, '#3a3c42');
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = time.env;
    env.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.MeshBasicMaterial).map?.dispose(); o.material.dispose(); } });
    pmrem.dispose();
    for (const g of [...this.cars.values(), ...this.shown]) carLights(g, time.carLights);
    buildCity((o, extra) => { this.venue.add(o); if (extra) this.extras.push(o); }, city, route, time);
    this.weather.venue(((this.venue.children.find((o) => o.userData.road) as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial) ?? null);
    this.sky.route(city, route, time.lamps);
  }

  // --- the cars: made as they turn up (the traffic comes and goes), freed when they're gone -------------
  private sync(cars: Car[]) {
    const live = new Set(cars.filter((c) => c.active));
    for (const [c, g] of this.cars) if (!live.has(c)) { this.scene.remove(g); disposeCar(g); this.cars.delete(c); }
    for (const c of live) {
      if (this.cars.has(c)) continue;
      const m = this.models.get(c.spec.model);
      if (!m) continue;
      const g = carMesh(m, c.spec.paint ?? c.spec.color, 0);
      carLights(g, this.time.carLights);
      this.scene.add(g);
      this.cars.set(c, g);
    }
  }

  clearCars() { this.sync([]); }

  // Each person's chase camera (with their headlights); a TV camera too when nobody is driving
  setViews(cars: Car[]) {
    this.clearShowroom();
    for (const v of this.views) if (v.beam) { this.scene.remove(v.beam, v.beam.target); v.beam.dispose(); }
    this.views = layout(cars.length).map((rect, i) => view(rect, cars[i] ?? null));
    for (const v of this.views) {
      if (!v.car || !this.time.beams) continue;
      v.beam = new THREE.SpotLight(0xfff1d6, 60 * this.time.beams, 90, 0.55, 0.6, 1.4);
      this.scene.add(v.beam, v.beam.target);
    }
  }

  // Picking cars: each person's choice turning behind the start line, in their part of the screen
  showroom(picks: { model: CarModel; color: string; tyre?: Tyre }[]) {
    this.clearShowroom();
    const s = this.city!.start;
    this.views = layout(picks.length).slice(0, picks.length).map((rect, i) => {
      const g = carMesh(picks[i].model, picks[i].color, 0);
      carLights(g, this.time.carLights);
      fitTyres(g, picks[i].tyre ?? Tyre.Slick);
      g.position.set(s.x - 30 - i * 14, 0.05, s.z);
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
  hit(c: Car, x: number, z: number, strength: number) {
    this.sparks.emit(new THREE.Vector3(x, 0.5, z), Math.min(40, 6 + strength * 2), 14, 5, 0.35);
    for (const v of this.views) if (v.car === c) v.shake = Math.max(v.shake, Math.min(0.7, strength * 0.05));
  }

  // Where a car is on a view's part of the screen (0..1 from the top left), or null if it's off it
  screenOf(c: Car, v: View) {
    const g = this.cars.get(c);
    if (!g) return null;
    const p = TMP.copy(g.position);
    p.y += 2.2;
    const dist = v.camera.position.distanceTo(p);
    p.project(v.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return null;
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, dist };
  }

  // Place everything and draw each view. `follow`: who the TV camera watches; `leader`: who the helicopter follows
  render(dt: number, now: number, drive: Drive, follow: Car | null, leader: Car | null, weather: Weather | null = null) {
    const city = this.city!, wet = weather?.wet ?? 0;
    this.weather.update(dt, weather);
    this.sync(drive.cars);
    let pools = 0;
    for (const [c, g] of this.cars) {
      const before = g.position.clone();
      g.position.set(c.x, 0.02, c.z);
      g.rotation.set(0, -c.h, 0);
      rollWheels(g, Math.min(10, before.distanceTo(g.position)) * Math.sign(c.forward || 1));
      steerWheels(g, c.spinning > 0 ? 0 : c.steer);
      if (wet > 0.15 && c.v > 8) this.weather.splash(TMP.set(c.x - Math.cos(c.h) * c.stats.length * 0.55, 0.5, c.z - Math.sin(c.h) * c.stats.length * 0.55), c.v, wet);
      if (c.scraping && c.v > 12) this.sparks.emit(TMP.set(c.x, 0.4, c.z), 1, 14, 5, 0.35);
      // the headlights' light on the road in front
      if (this.time.beams && pools < 96) {
        const ahead = c.stats.length / 2 + 6.5;
        M.compose(TMP.set(c.x + Math.cos(c.h) * ahead, 0.03, c.z + Math.sin(c.h) * ahead), Q.setFromAxisAngle(UP, -c.h), S.set(13, 1, 7));
        this.pools.setMatrixAt(pools++, M);
      }
    }
    this.pools.count = pools;
    this.pools.instanceMatrix.needsUpdate = true;
    (this.pools.material as THREE.MeshBasicMaterial).opacity = 0.32 * this.time.beams;
    // the police car's lights, while it's out
    const p = drive.police, flash = Math.floor(now / 140) % 2;
    this.siren.forEach((s, i) => {
      s.visible = p.active && i === flash;
      if (!s.visible) return;
      const side = i ? 0.42 : -0.42;
      s.position.set(p.x - Math.sin(p.h) * side, 1.75, p.z + Math.cos(p.h) * side);
    });
    for (const g of this.shown) g.rotation.y += dt * 0.5;
    this.sparks.update(dt, -20);

    // the lights, and the people crossing, at the junctions near a camera
    const eyes = this.views.map((v) => v.camera.position);
    this.people.begin();
    this.signals.begin();
    for (const n of city.nodes) {
      if (!n.lights || !eyes.some((e) => Math.hypot(e.x - n.x, e.z - n.z) < NEAR)) continue;
      this.signals.put(n, (axis) => city.signal(n, axis, drive.t));
      for (const axis of ['x', 'z'] as const) {
        // (red for the cars going along `axis`: people walk over that street, just outside the junction)
        const since = city.sinceRed(n, axis, drive.t);
        if (since < 0) continue;
        for (const e of n.edges) {
          if (e.axis !== axis) continue;
          const o = city.other(e, n), dir = Math.sign(axis === 'x' ? o.x - n.x : o.z - n.z), at = n.size / 2 + 2.5, half = e.width / 2 + 2;
          for (let k = 0; k < 2; k++) {
            const start = 0.3 + k * 0.5, way = (k + n.id) % 2 ? 1 : -1, u = way * (-half + 3.2 * (since - start));
            if (since < start || Math.abs(u) > half) continue;
            let x = axis === 'x' ? n.x + dir * at : n.x + u, z = axis === 'x' ? n.z + u : n.z + dir * at;
            // (a car bearing down on the crossing: they hurry back to the kerb)
            const danger = dangerAt(drive.cars, x, z);
            if (danger > 0) {
              const kerb = Math.sign(u || way) * half;
              if (axis === 'x') z = n.z + u + (kerb - u) * danger; else x = n.x + u + (kerb - u) * danger;
            }
            const yaw = axis === 'x' ? (way > 0 ? 0 : Math.PI) : (way > 0 ? Math.PI / 2 : -Math.PI / 2);
            this.people.put(n.id * 10 + (axis === 'x' ? 0 : 4) + (dir > 0 ? 2 : 0) + k, x, z, yaw);
          }
        }
      }
    }
    this.people.end(dt);
    this.signals.end();
    this.sky.update(dt, now, leader);

    const r = this.renderer, cv = r.domElement;
    const W = cv.clientWidth, H = cv.clientHeight;
    r.setScissorTest(true);
    for (const v of this.views) {
      const x = v.rect.x * W, y = (1 - v.rect.y - v.rect.h) * H, w = v.rect.w * W, h = v.rect.h * H;
      v.camera.aspect = w / h;
      if (v.show) turntable(v.camera, v.show);
      else if (v.car) chase(v, v.car, dt);
      else if (follow) tv(v, follow, dt);
      if (v.beam && v.car) {
        const c = v.car, fx = Math.cos(c.h), fz = Math.sin(c.h);
        v.beam.position.set(c.x + fx * (c.stats.length / 2), 0.8, c.z + fz * (c.stats.length / 2));
        v.beam.target.position.set(c.x + fx * 40, 0, c.z + fz * 40);
      }
      if (v.shake > 0.01) {
        v.camera.position.add(TMP.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(v.shake));
        v.shake *= Math.exp(-7 * dt);
      }
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(this.scene, v.camera);
    }
  }
}

const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();
const view = (rect: Screen, car: Car | null): View => ({
  car, show: null, rect, lookBack: false, shake: 0, yaw: car?.h ?? 0, aim: new THREE.Vector3(), beam: null,
  camera: new THREE.PerspectiveCamera(62, 1, 0.5, 6000),
});

// How close a car is to running into a point (0: nowhere near .. 1: on it), for people getting out of the way
function dangerAt(cars: Car[], x: number, z: number) {
  let worst = 0;
  for (const c of cars) {
    if (!c.active || c.v < 4) continue;
    const dx = x - c.x, dz = z - c.z, fx = Math.cos(c.h), fz = Math.sin(c.h), along = dx * fx + dz * fz, across = Math.abs(dx * -fz + dz * fx);
    if (along < -2 || along > 30 || across > 3.5) continue;
    worst = Math.max(worst, Math.min(1, (30 - along) / 18));
  }
  return worst;
}

// --- the cameras -------------------------------------------------------------------------------------
// Behind the car, turning after it (the way it's going, once it's going); wider at speed and on the boost
function chase(v: View, car: Car, dt: number) {
  const cam = v.camera, heading = car.v > 4 && car.spinning <= 0 ? Math.atan2(car.vz, car.vx) : car.h;
  let d = heading - v.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  v.yaw += d * Math.min(1, 5 * dt);
  const back = v.lookBack ? -1 : 1, behind = 6.5 + car.stats.length * 0.75, fx = Math.cos(v.yaw), fz = Math.sin(v.yaw);
  cam.position.set(car.x - fx * behind * back, 2.5 + car.stats.width * 0.45, car.z - fz * behind * back);
  cam.up.copy(UP);
  cam.lookAt(car.x + fx * 14 * back, 1, car.z + fz * 14 * back);
  cam.fov = 62 + 14 * Math.min(1, car.v / TOP) ** 2 + Math.max(0, car.boost) * 25;
  cam.updateProjectionMatrix();
}

// From the pavement ahead, a long lens on the car
function tv(v: View, car: Car, dt: number) {
  const cam = v.camera, fx = Math.cos(car.h), fz = Math.sin(car.h);
  const target = TMP.set(car.x, 0.8, car.z);
  const reset = v.aim.lengthSq() === 0 || v.aim.distanceTo(target) > 120;
  if (reset) v.aim.copy(target);
  else v.aim.lerp(target, Math.min(1, 8 * dt));
  // (a new spot when the car's gone past this one, or got too far away)
  if (reset || cam.position.distanceTo(v.aim) > 90 || TMP2.set(v.aim.x - cam.position.x, 0, v.aim.z - cam.position.z).dot(TMP.set(fx, 0, fz)) > 20) {
    cam.position.set(car.x + fx * 50 - fz * 8, 9, car.z + fz * 50 + fx * 8);
  }
  cam.up.copy(UP);
  cam.lookAt(v.aim);
  cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(14 / cam.position.distanceTo(v.aim))), 12, 60);
  cam.updateProjectionMatrix();
}

function turntable(cam: THREE.PerspectiveCamera, g: THREE.Object3D) {
  cam.position.set(g.position.x, 2.6, g.position.z + 9);
  cam.up.copy(UP);
  cam.lookAt(g.position.x, 0.9, g.position.z);
  cam.fov = 40;
  cam.updateProjectionMatrix();
}

// --- the people on the crossings: the shared cast in everyday colours, walking ---------------------------------
const CLOTHES = ['#2c3e66', '#b9ab8e', '#6e1f2a', '#e8e6df', '#3f8a5a', '#d9a13a', '#1c1f26', '#8a5a34', '#9b6bff'];
class People {
  max = 16;
  private crowd = new Map<number, { p: Person; mixer: THREE.AnimationMixer }>();
  private used = new Set<number>();
  constructor(private scene: THREE.Scene) {}
  begin() { this.used.clear(); }
  put(key: number, x: number, z: number, yaw: number) {
    if (!walkers || this.used.size >= this.max) return;
    let one = this.crowd.get(key);
    if (!one) {
      const names = [...walkers.cast.people.keys()].filter((n) => /^p\d/.test(n));
      const p = new Person(walkers.cast, names[key % names.length]);
      p.dress({ shirt: CLOTHES[key % CLOTHES.length], shorts: CLOTHES[(key * 5 + 3) % CLOTHES.length], socks: '#1c1f26', boots: '#2a2a2e', number: '' });
      const mixer = new THREE.AnimationMixer(p.root);
      mixer.clipAction(fit(walkers.moves, p.root).get('walk')!).play();
      this.scene.add(p.root);
      one = { p, mixer };
      this.crowd.set(key, one);
    }
    this.used.add(key);
    one.p.root.position.set(x, 0.02, z);
    one.p.root.rotation.y = yaw;
  }
  end(dt: number) {
    for (const [key, one] of this.crowd) {
      if (this.used.has(key)) { one.mixer.update(dt); continue; }
      this.scene.remove(one.p.root);
      one.mixer.stopAllAction();
      this.crowd.delete(key);
    }
  }
}

// --- the traffic lights: at each corner of a junction, three bulbs facing the cars coming in, the lit one bright -
class Signals {
  private bulbs: THREE.InstancedMesh;
  private glows: THREE.Sprite[] = [];
  private glow: Record<'red' | 'amber' | 'green', THREE.SpriteMaterial>;
  private n = 0;
  private g = 0;
  constructor(scene: THREE.Scene) {
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 6), new THREE.MeshBasicMaterial(), 480);
    this.bulbs.frustumCulled = false;
    this.bulbs.count = 0;
    scene.add(this.bulbs);
    const make = (c: number) => new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.glow = { red: make(SIGNAL.red), amber: make(SIGNAL.amber), green: make(SIGNAL.green) };
    for (let i = 0; i < 80; i++) {
      const s = new THREE.Sprite(this.glow.red);
      s.scale.setScalar(1.5);
      s.visible = false;
      scene.add(s);
      this.glows.push(s);
    }
  }
  begin() { this.n = 0; this.g = 0; }
  put(n: Node, state: (axis: 'x' | 'z') => 'red' | 'amber' | 'green') {
    // for each way in: the head on the post at the near right corner, facing the cars coming in
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = state(dx ? 'x' : 'z'), h = n.size / 2 + 0.8;
      // (coming in going +x, the near right corner is behind the middle and to the right: x -, z +)
      const x = n.x - dx * h - dz * h, z = n.z - dz * h + dx * h;
      (['red', 'amber', 'green'] as const).forEach((c, i) => {
        if (this.n >= 480) return;
        M.makeTranslation(x - dx * 0.25, 4.4 - i * 0.42, z - dz * 0.25);
        this.bulbs.setMatrixAt(this.n, M);
        this.bulbs.setColorAt(this.n++, C.setHex(SIGNAL[c]).multiplyScalar(c === k ? 1.8 : 0.1));
        if (c === k && this.g < this.glows.length) {
          const s = this.glows[this.g++];
          s.visible = true;
          s.material = this.glow[c];
          s.position.set(x - dx * 0.4, 4.4 - i * 0.42, z - dz * 0.4);
        }
      });
    }
  }
  end() {
    this.bulbs.count = this.n;
    this.bulbs.instanceMatrix.needsUpdate = true;
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    for (let i = this.g; i < this.glows.length; i++) this.glows[i].visible = false;
  }
}

// --- overhead: planes crossing the sky (coming in low to land, on the airport run), and a helicopter
// following the leader with its searchlight on at night -----------------------------------------------------
class Sky {
  private plane: THREE.Object3D | null = null;
  private heli: THREE.Object3D | null = null;
  private rotor: THREE.Object3D[] = [];
  private beam: THREE.Mesh;
  private navs: THREE.Sprite[] = [];
  private planeT = 0;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; time: number } | null = null;
  private heliAt = new THREE.Vector3(0, 90, 0);
  private centre = new THREE.Vector3();
  private size = 1000;
  private landing: THREE.Vector3 | null = null;
  private night = false;

  constructor(private scene: THREE.Scene) {
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 20, 1, true).translate(0, -45, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.visible = false;
    scene.add(this.beam);
    for (const c of [0xff3030, 0x30ff60, 0xffffff]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(6);
      s.visible = false;
      scene.add(s);
      this.navs.push(s);
    }
  }

  set(plane: THREE.Object3D | null, heli: THREE.Object3D | null) {
    this.plane = plane;
    this.heli = heli;
    if (plane) { plane.visible = false; this.scene.add(plane); }
    if (heli) {
      this.scene.add(heli);
      heli.traverse((o) => { if (o instanceof THREE.Mesh) { const s = new THREE.Box3().setFromObject(o).getSize(TMP); if (s.y < 0.5 && s.x > 6) this.rotor.push(o); } });
    }
  }

  route(city: City, route: Route, night: boolean) {
    const b = city.bounds;
    this.centre.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    this.size = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
    this.night = night;
    const f = city.finish, out = outward(city, f);
    this.landing = route.landmark === 'airport' ? new THREE.Vector3(f.x + out.x * 400, 0, f.z + out.z * 400) : null;
    this.planeT = 3;
    this.flight = null;
  }

  update(dt: number, now: number, leader: Car | null) {
    if (this.plane) {
      this.planeT -= dt;
      if (!this.flight && this.planeT <= 0) {
        const a = Math.random() * Math.PI * 2, r = this.size * 0.7;
        const to = this.landing ? this.landing.clone().add(TMP.set(Math.cos(a) * 200, 30, Math.sin(a) * 200)) : this.centre.clone().add(TMP.set(-Math.cos(a) * r, 260, -Math.sin(a) * r));
        const from = this.landing ? this.landing.clone().add(TMP.set(-Math.cos(a) * 2600, 420, -Math.sin(a) * 2600)) : this.centre.clone().add(TMP.set(Math.cos(a) * r, 230, Math.sin(a) * r));
        this.flight = { from, to, time: 0 };
      }
      if (this.flight) {
        const f = this.flight, total = f.from.distanceTo(f.to) / 75;
        f.time += dt;
        const k = f.time / total;
        this.plane.visible = k < 1;
        this.plane.position.lerpVectors(f.from, f.to, k);
        this.plane.lookAt(TMP.copy(f.to).add(TMP2.subVectors(f.to, f.from)));
        this.plane.rotateY(Math.PI); // (it's made facing -z)
        if (k >= 1) { this.flight = null; this.planeT = this.landing ? 14 : 22 + Math.random() * 15; }
      }
      const on = this.plane.visible, blink = Math.floor(now / 600) % 3 === 0;
      this.navs.forEach((s, i) => {
        s.visible = on && (i < 2 || blink);
        if (!on) return;
        s.position.copy(this.plane!.position).add(TMP.set(i === 0 ? -18 : i === 1 ? 18 : 0, i === 2 ? 3 : 0, 0).applyQuaternion(this.plane!.quaternion));
      });
    }
    if (this.heli && leader) {
      const want = TMP.set(leader.x - Math.cos(leader.h) * 40, 75, leader.z - Math.sin(leader.h) * 40);
      this.heliAt.lerp(want, Math.min(1, 0.8 * dt));
      this.heli.position.copy(this.heliAt);
      this.heli.position.y += Math.sin(now * 0.001) * 1.5;
      this.heli.lookAt(leader.x, this.heli.position.y, leader.z);
      this.heli.rotateY(Math.PI);
      for (const r of this.rotor) r.rotation.y += dt * 30;
      this.beam.visible = this.night;
      this.beam.position.copy(this.heli.position);
      this.beam.lookAt(leader.x, 0, leader.z);
      this.beam.rotateX(-Math.PI / 2);
    }
  }
}

// Which way is out of the city from a corner junction (towards the corner)
function outward(city: City, n: Node) {
  const b = city.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, x = Math.sign(n.x - cx), z = Math.sign(n.z - cz), l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

// --- the city ------------------------------------------------------------------------------------------
type Add = (o: THREE.Object3D, extra?: boolean) => void; // extra: drop it when the screen struggles
type Box = { x0: number; z0: number; x1: number; z1: number };

function buildCity(add: Add, city: City, route: Route, time: Time) {
  const rnd = seeded(city.spec.seed + 5), b = city.bounds, river = city.river!;
  const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const lit = time.lamps, dim = (c: number, min = 0.5) => new THREE.Color(c).multiplyScalar(Math.max(min, time.dim));
  add(new THREE.HemisphereLight(time.hemi[0], time.hemi[1], time.hemi[2]));
  const sun = new THREE.DirectionalLight(time.sun[0], time.sun[1]);
  sun.position.set(time.sunAt[0], time.sunAt[1], time.sunAt[2]);
  add(sun);
  add(sky(time.sky[0], time.sky[1]));
  if (time.stars) add(stars(), true);

  // the ground either side of the river, and the water between, a few metres down
  const pad = 700, concrete = groundTexture();
  concrete.repeat.set((b.x1 - b.x0 + pad * 2) / 8, (b.z1 - b.z0 + pad * 2) / 8);
  const groundMat = lambert({ map: concrete, color: dim(0xffffff) });
  for (const [z0, z1] of [[b.z0 - pad, river.z0], [river.z1, b.z1 + pad]]) {
    add(new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0 + pad * 2, z1 - z0).rotateX(-Math.PI / 2).translate((b.x0 + b.x1) / 2, -0.03, (z0 + z1) / 2), groundMat));
  }
  add(placedMesh(new THREE.PlaneGeometry(b.x1 - b.x0 + pad * 2, river.z1 - river.z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x163447, roughness: 0.12, metalness: 0.4 }), (b.x0 + b.x1) / 2, -4, (river.z0 + river.z1) / 2));
  for (const [z, s] of [[river.z0, 1], [river.z1, -1]]) add(placedMesh(new THREE.BoxGeometry(b.x1 - b.x0 + pad * 2, 4.2, 0.6), lambert({ color: dim(0x6a6b70) }), (b.x0 + b.x1) / 2, -2, z + s * 0.3));

  // the streets: their road (with the markings each kind has), and the junctions
  const roads: Record<'avenue' | 'street' | 'alley', THREE.BufferGeometry[]> = { avenue: [], street: [], alley: [] };
  for (const e of city.edges) {
    const len = e.length - e.a.size / 2 - e.b.size / 2;
    if (len <= 0) continue;
    const g = new THREE.PlaneGeometry(e.width, len).rotateX(-Math.PI / 2), uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 12);
    if (e.axis === 'x') g.rotateY(Math.PI / 2);
    g.translate((e.a.x + e.b.x) / 2, 0.005, (e.a.z + e.b.z) / 2);
    roads[e.kind === 'bridge' ? 'avenue' : e.kind].push(g);
  }
  const roadMat = (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const avenue = new THREE.Mesh(mergeGeometries(roads.avenue), roadMat(roadTexture(4)));
  avenue.userData.road = true; // (it shines when it's wet)
  add(avenue);
  if (roads.street.length) add(new THREE.Mesh(mergeGeometries(roads.street), roadMat(roadTexture(2))));
  if (roads.alley.length) add(new THREE.Mesh(mergeGeometries(roads.alley), roadMat(roadTexture(0))));
  const junctions: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [];
  for (const n of city.nodes) {
    if (!n.edges.length) continue;
    junctions.push(new THREE.PlaneGeometry(n.size, n.size).rotateX(-Math.PI / 2).translate(n.x, 0.004, n.z));
    if (!n.lights) continue;
    // a zebra crossing over each street, just outside the junction, and the stop line before it on the way in
    for (const e of n.edges) {
      const o = city.other(e, n), dx = Math.sign(o.x - n.x), dz = Math.sign(o.z - n.z), at = n.size / 2 + 2.5;
      for (let u = -e.width / 2 + 0.6; u < e.width / 2; u += 1.2) {
        white.push(new THREE.BoxGeometry(dx ? 3.4 : 0.6, 0.02, dx ? 0.6 : 3.4).translate(n.x + dx * at + (dz ? u : 0), 0.02, n.z + dz * at + (dx ? u : 0)));
      }
      // (coming in towards the junction you're going -dx, -dz: your lanes are on your right, the +dz, -dx side)
      const sx = n.x + dx * (at + 2.4) + dz * e.width / 4, sz = n.z + dz * (at + 2.4) - dx * e.width / 4;
      white.push(new THREE.BoxGeometry(dx ? 0.45 : e.width / 2, 0.02, dx ? e.width / 2 : 0.45).translate(sx, 0.021, sz));
    }
  }
  add(new THREE.Mesh(mergeGeometries(junctions), lambert({ map: plainRoad(), color: dim(0xffffff, 0.6) })));
  if (white.length) add(new THREE.Mesh(mergeGeometries(white), new THREE.MeshBasicMaterial({ color: dim(0xe8e6df, 0.55) })));

  // the blocks: pavement round the edge (up a kerb), buildings inside it, or a park
  const pave: THREE.BufferGeometry[] = [], grass: THREE.BufferGeometry[] = [], trunks: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [];
  const regions = new Map<string, { blocks: THREE.BufferGeometry[]; shops: THREE.BufferGeometry[]; signs: THREE.BufferGeometry[]; colors: number[] }>();
  const region = (x: number, z: number) => {
    const k = `${Math.floor(x / 420)},${Math.floor(z / 420)}`;
    if (!regions.has(k)) regions.set(k, { blocks: [], shops: [], signs: [], colors: [] });
    return regions.get(k)!;
  };
  const NEON = [0xff3fd2, 0x3fd0ff, 0xffb03d, 0xd7ff3b, 0xff5a3d].map((c) => new THREE.Color(c));
  const tree = (x: number, z: number, k: number) => {
    trunks.push(new THREE.CylinderGeometry(0.14 * k, 0.2 * k, 3 * k, 5).translate(x, 1.5 * k, z));
    leaves.push(new THREE.IcosahedronGeometry(1.9 * k, 0).translate(x, 3.8 * k, z));
  };
  for (const lot of city.lots) {
    const w = lot.x1 - lot.x0, d = lot.z1 - lot.z0;
    if (w < 1 || d < 1) continue;
    pave.push(slab(lot, 0.16));
    // trees along the pavement
    for (const [x0, z0, x1, z1] of [[lot.x0, lot.z0 + 1.6, lot.x1, lot.z0 + 1.6], [lot.x0, lot.z1 - 1.6, lot.x1, lot.z1 - 1.6], [lot.x0 + 1.6, lot.z0, lot.x0 + 1.6, lot.z1], [lot.x1 - 1.6, lot.z0, lot.x1 - 1.6, lot.z1]]) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let s = 10; s < len - 10; s += 18 + rnd() * 10) if (rnd() < 0.7) tree(x0 + (x1 - x0) * s / len, z0 + (z1 - z0) * s / len, 0.8 + rnd() * 0.4);
    }
    const inner = { x0: lot.x0 + PAVE, z0: lot.z0 + PAVE, x1: lot.x1 - PAVE, z1: lot.z1 - PAVE };
    if (lot.park) {
      grass.push(slab(inner, 0.2));
      for (let i = 0; i < 30; i++) tree(inner.x0 + rnd() * (inner.x1 - inner.x0), inner.z0 + rnd() * (inner.z1 - inner.z0), 1 + rnd() * 0.6);
      continue;
    }
    const r = region((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2);
    buildings(inner, rnd, (g, shop, sign) => {
      r.blocks.push(g);
      if (shop) r.shops.push(shop);
      if (sign) { const c = NEON[Math.floor(rnd() * NEON.length)]; for (let i = 0; i < sign.attributes.position.count; i++) r.colors.push(c.r, c.g, c.b); r.signs.push(sign); }
    });
  }
  add(new THREE.Mesh(mergeGeometries(pave), lambert({ map: paveTexture(), color: dim(0xffffff, 0.6) })));
  if (grass.length) add(new THREE.Mesh(mergeGeometries(grass), lambert({ color: dim(0x3f7a3a) })));
  add(new THREE.Mesh(mergeGeometries(trunks), lambert({ color: 0x4a3828 })), true);
  add(new THREE.Mesh(mergeGeometries(leaves), lambert({ color: dim(0x2f6b34), flatShading: true })), true);
  const facade = facadeTextures();
  const blockMat = lambert({ map: facade.map, color: dim(0xffffff), emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? facade.glow : null, emissiveIntensity: lit ? 1 : 0 });
  const shopMat = lit ? new THREE.MeshBasicMaterial({ color: 0x8a6c4a }) : lambert({ color: 0x3a4250 }), signMat = lit ? new THREE.MeshBasicMaterial({ vertexColors: true }) : lambert({ vertexColors: true });
  for (const r of regions.values()) {
    if (r.blocks.length) add(new THREE.Mesh(mergeGeometries(r.blocks), blockMat));
    if (r.shops.length) add(new THREE.Mesh(mergeGeometries(r.shops), shopMat));
    if (r.signs.length) { const g = mergeGeometries(r.signs); g.setAttribute('color', new THREE.Float32BufferAttribute(r.colors, 3)); add(new THREE.Mesh(g, signMat), true); }
  }

  // the street lamps, along every street, staggered either side, leaning out over the road
  const posts: THREE.BufferGeometry[] = [], glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  for (const e of city.edges) {
    if (e.kind === 'alley') continue;
    const len = e.length - e.a.size / 2 - e.b.size / 2, dx = Math.sign(e.b.x - e.a.x), dz = Math.sign(e.b.z - e.a.z);
    for (let s = 12, i = 0; s < len - 6; s += 32, i++) {
      const side = i % 2 ? 1 : -1, along = e.a.size / 2 + s;
      const fx = e.a.x + dx * along - dz * side * (e.width / 2 + 0.6), fz = e.a.z + dz * along + dx * side * (e.width / 2 + 0.6);
      const ox = fx + dz * side * 2.6, oz = fz - dx * side * 2.6, h = 8;
      posts.push(new THREE.CylinderGeometry(0.1, 0.15, h, 6).translate(fx, h / 2, fz));
      posts.push(new THREE.BoxGeometry(Math.abs(ox - fx) + 0.1, 0.1, Math.abs(oz - fz) + 0.1).translate((fx + ox) / 2, h, (fz + oz) / 2));
      if (lit) { const g = new THREE.Sprite(glowMat); g.position.set(ox, h - 0.3, oz); g.scale.setScalar(4.5); add(g, true); }
    }
  }
  // the lights' posts at the junctions
  for (const n of city.nodes) {
    if (!n.lights) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const h = n.size / 2 + 0.8, x = n.x - dx * h - dz * h, z = n.z - dz * h + dx * h;
      posts.push(new THREE.CylinderGeometry(0.12, 0.15, 5.2, 6).translate(x, 2.6, z), new THREE.BoxGeometry(dz ? 0.45 : 0.35, 1.4, dx ? 0.45 : 0.35).translate(x, 4, z));
    }
  }
  add(new THREE.Mesh(mergeGeometries(posts), lambert({ color: 0x2a2e36 })));

  // the bridges: the deck, its parapets, and (on the middle one) towers and cables
  const bridges = city.edges.filter((e) => e.kind === 'bridge').sort((p, q) => p.a.x - q.a.x), steel = lambert({ color: dim(0xb8bcc6, 0.6) });
  bridges.forEach((e, i) => {
    const x = e.a.x, z0 = river.z0 - 4, z1 = river.z1 + 4, w = e.width + 4, len = z1 - z0, cz = (z0 + z1) / 2;
    add(placedMesh(new THREE.BoxGeometry(w, 1.6, len), lambert({ color: dim(0x55565c) }), x, -0.81, cz));
    for (const s of [-1, 1]) add(placedMesh(new THREE.BoxGeometry(0.5, 1.2, len), lambert({ color: dim(0x8d8c88) }), x + s * (e.width / 2 + 0.25), 0.6, cz));
    if (i !== Math.floor(bridges.length / 2)) return;
    const H = 40, parts: THREE.BufferGeometry[] = [], cables: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const cx = x + s * (e.width / 2 + 1.2);
      for (const tz of [z0 + len * 0.25, z0 + len * 0.75]) parts.push(new THREE.BoxGeometry(1.5, H + 6, 1.5).translate(cx, H / 2 - 3, tz));
      for (let z = z0; z < z1; z += 3) {
        const u = (z - (z0 + len * 0.25)) / (len * 0.5), y = u >= 0 && u <= 1 ? 6 + (H - 6) * (2 * u - 1) ** 2 : H - (H - 2) * Math.min(1, Math.abs(u < 0 ? u : u - 1) * 2);
        cables.push(new THREE.BoxGeometry(0.15, 0.15, 3.1).translate(cx, y, z + 1.5));
        if (Math.round(z) % 9 < 3 && y > 2) cables.push(new THREE.CylinderGeometry(0.04, 0.04, y - 1.2, 3).translate(cx, 1.2 + (y - 1.2) / 2, z));
      }
    }
    add(new THREE.Mesh(mergeGeometries(parts), lambert({ color: dim(0x9aa0ab) })));
    add(new THREE.Mesh(mergeGeometries(cables), steel));
  });

  // bus stops along the avenues, and signs before the big junctions pointing the quickest way to the finish
  const shelters: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  for (const e of city.edges) {
    if (e.kind !== 'avenue' || e.length < 120 || rnd() < 0.6) continue;
    const dx = Math.sign(e.b.x - e.a.x), dz = Math.sign(e.b.z - e.a.z);
    const x = (e.a.x + e.b.x) / 2 - dz * (e.width / 2 + 2.2), z = (e.a.z + e.b.z) / 2 + dx * (e.width / 2 + 2.2), yaw = Math.atan2(dx, dz) + Math.PI / 2;
    const put = (g: THREE.BufferGeometry, list: THREE.BufferGeometry[]) => list.push(g.rotateY(yaw).translate(x, 0.16, z));
    put(new THREE.BoxGeometry(5, 0.12, 1.8).translate(0, 2.6, 0), shelters);
    put(new THREE.BoxGeometry(5, 2.4, 0.06).translate(0, 1.4, 0.85), glass);
    put(new THREE.BoxGeometry(3, 0.5, 0.45).translate(0, 0.5, 0.5), shelters);
  }
  if (shelters.length) add(new THREE.Mesh(mergeGeometries(shelters), lambert({ color: 0x3a3f4a })));
  if (glass.length) add(new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.35, roughness: 0.1 })), true);
  const grey = lambert({ color: 0x5a5f6e });
  for (const n of city.nodes) {
    if (!n.lights || n.size < 18 || rnd() < 0.5) continue;
    // on one way in: which way to turn for the finish, and how far
    const e = n.edges[Math.floor(rnd() * n.edges.length)], from = city.other(e, n), best = city.nextToward(n, from);
    if (!best) continue;
    const ix = Math.sign(n.x - from.x), iz = Math.sign(n.z - from.z), ox = Math.sign(best.x - n.x), oz = Math.sign(best.z - n.z);
    const cross = ix * oz - iz * ox, arrow = ox === ix && oz === iz ? '↑' : cross > 0 ? '→' : cross < 0 ? '←' : '↓';
    const at = n.size / 2 + 22, sx = n.x - ix * at, sz = n.z - iz * at;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.3), new THREE.MeshBasicMaterial({ map: directionTexture(arrow, route.to, city.toGo(n) / 1000), side: THREE.DoubleSide }));
    board.position.set(sx - iz * e.width / 4, 6.2, sz + ix * e.width / 4);
    board.rotation.y = Math.atan2(-ix, -iz);
    add(board);
    for (const s of [-1, 1]) add(placedMesh(new THREE.CylinderGeometry(0.16, 0.18, 7.4, 6), grey, sx + iz * s * (e.width / 2 + 0.6), 3.7, sz - ix * s * (e.width / 2 + 0.6)));
    add(placedMesh(new THREE.BoxGeometry(Math.abs(iz) * (e.width + 1.2) + 0.3, 0.3, Math.abs(ix) * (e.width + 1.2) + 0.3), grey, sx, 7.4, sz));
  }

  // the start: a banner over the road; the finish: a banner by the junction, and the landmark past it
  const s = city.start, f = city.finish, dark = lambert({ color: 0x20242f });
  const banner = (x: number, z: number, across: 'x' | 'z', width: number, text: string, finish: boolean) => {
    const face = new THREE.MeshBasicMaterial({ map: bannerTexture(text, finish) });
    const g = new THREE.Mesh(new THREE.BoxGeometry(across === 'x' ? width : 0.4, 2, across === 'x' ? 0.4 : width), across === 'x' ? [dark, dark, dark, dark, face, face] : [face, face, dark, dark, dark, dark]);
    g.position.set(x, 8.5, z);
    add(g);
    for (const k of [-1, 1]) add(placedMesh(new THREE.BoxGeometry(0.6, 9, 0.6), dark, x + (across === 'x' ? k * width / 2 : 0), 4.5, z + (across === 'z' ? k * width / 2 : 0)));
  };
  banner(s.x, s.z, 'z', 20, `Start · ${route.start}`, false);
  add(placedMesh(new THREE.PlaneGeometry(1.6, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2 }), s.x, 0.03, s.z));
  banner(f.x, f.z + (f.z > (b.z0 + b.z1) / 2 ? -1 : 1) * (f.size / 2 + 1), 'x', f.size + 4, `Finish · ${route.to}`, true);
  add(placedMesh(new THREE.PlaneGeometry(f.size, f.size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: checkerTexture(), transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }), f.x, 0.025, f.z));
  landmark(add, city, route, time);
  skyline(add, b, time);
}

// A flat box over a rectangle, standing on the ground
const slab = (r: Box, h: number) => new THREE.BoxGeometry(r.x1 - r.x0, h, r.z1 - r.z0).translate((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);

// The buildings on a block (inside its pavement): a row along each side facing the street, shops on the
// ground floor; a small block is one building
function buildings(inner: Box, rnd: () => number, put: (g: THREE.BufferGeometry, shop: THREE.BufferGeometry | null, sign: THREE.BufferGeometry | null) => void) {
  const w = inner.x1 - inner.x0, d = inner.z1 - inner.z0;
  if (w < 6 || d < 6) return;
  const one = (x0: number, z0: number, x1: number, z1: number, face: [number, number]) => {
    const bw = x1 - x0, bd = z1 - z0, h = 10 + rnd() ** 1.6 * 55, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const [fx, fz] = face, len = (fx ? bd : bw) * 0.6, ox = cx + fx * (bw / 2 + 0.07), oz = cz + fz * (bd / 2 + 0.07);
    const shop = new THREE.BoxGeometry(fx ? 0.12 : len, 2.3, fx ? len : 0.12).translate(ox, 1.55, oz);
    const sign = rnd() < 0.7 ? new THREE.BoxGeometry(fx ? 0.2 : len * 0.5, 0.6, fx ? len * 0.5 : 0.2).translate(ox + fx * 0.05, 3.3, oz + fz * 0.05) : null;
    put(block(bw, h, bd).translate(cx, 0.16, cz), shop, sign);
  };
  if (w < 34 || d < 34) { one(inner.x0, inner.z0, inner.x1, inner.z1, w > d ? [0, 1] : [1, 0]); return; }
  const deep = Math.min(20, d / 2 - 1), side = Math.min(20, w / 2 - 1);
  for (const [z0, z1, fz] of [[inner.z0, inner.z0 + deep, -1], [inner.z1 - deep, inner.z1, 1]] as const) {
    for (let x = inner.x0; x < inner.x1 - 4;) {
      const bw = Math.min(inner.x1 - x, 12 + rnd() * 16);
      one(x, z0, x + bw - 0.6, z1, [0, fz]);
      x += bw;
    }
  }
  for (const [x0, x1, fx] of [[inner.x0, inner.x0 + side, -1], [inner.x1 - side, inner.x1, 1]] as const) {
    for (let z = inner.z0 + deep; z < inner.z1 - deep - 4;) {
      const bd = Math.min(inner.z1 - deep - z, 12 + rnd() * 14);
      one(x0, z, x1, z + bd - 0.6, [fx, 0]);
      z += bd;
    }
  }
}

// What's waiting past the finish: the harbour's cranes, the airport's terminal and control tower, or the tallest tower in town
function landmark(add: Add, city: City, route: Route, time: Time) {
  const f = city.finish, out = outward(city, f), cx = f.x + out.x * 160, cz = f.z + out.z * 160;
  const dim = (c: number) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c).multiplyScalar(Math.max(0.55, time.dim)) });
  const parts: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  if (route.landmark === 'harbour') {
    for (let i = -3; i <= 3; i++) {
      const x = cx + i * 40 * -out.z, z = cz + i * 40 * out.x;
      for (const k of [-7, 7]) parts.push(new THREE.BoxGeometry(1.6, 50, 1.6).translate(x + k * out.x, 25, z + k * out.z));
      parts.push(new THREE.BoxGeometry(4, 4, 4).translate(x, 50, z), new THREE.BoxGeometry(3, 3, 3).translate(x + out.x * 30, 54, z + out.z * 30));
      glow.push(new THREE.BoxGeometry(1, 1, 1).translate(x, 53, z));
    }
    add(new THREE.Mesh(mergeGeometries(parts), dim(0xe0a030)));
  } else if (route.landmark === 'airport') {
    parts.push(new THREE.BoxGeometry(220, 14, 60).translate(cx, 7, cz), new THREE.CylinderGeometry(3, 4, 60, 10).translate(cx + 140, 30, cz), new THREE.CylinderGeometry(9, 7, 8, 12).translate(cx + 140, 64, cz));
    glow.push(new THREE.CylinderGeometry(9.2, 7.2, 3, 12).translate(cx + 140, 63, cz), new THREE.BoxGeometry(221, 3, 61).translate(cx, 10, cz));
    add(new THREE.Mesh(mergeGeometries(parts), dim(0xc0c6d0)));
  } else {
    parts.push(new THREE.BoxGeometry(34, 220, 34).translate(cx, 110, cz), new THREE.BoxGeometry(22, 60, 22).translate(cx, 250, cz), new THREE.CylinderGeometry(0.6, 1.2, 50, 6).translate(cx, 305, cz));
    for (let y = 20; y < 270; y += 18) glow.push(new THREE.BoxGeometry(34.4, 1.2, 34.4).translate(cx, y, cz));
    add(new THREE.Mesh(mergeGeometries(parts), dim(0x30394a)));
  }
  if (glow.length) add(new THREE.Mesh(mergeGeometries(glow), time.lamps ? new THREE.MeshBasicMaterial({ color: 0xfff0c8 }) : dim(0xd0d4dc)));
}

// The rest of the city, far off: towers all round
function skyline(add: Add, b: Box, time: Time) {
  const rnd = seeded(77), geo: THREE.BufferGeometry[] = [], cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2, r = 0.62 + rnd() * 0.5, x = cx + Math.cos(a) * (b.x1 - b.x0) * r, z = cz + Math.sin(a) * (b.z1 - b.z0) * r, w = 25 + rnd() * 35;
    if (x > b.x0 - 60 && x < b.x1 + 60 && z > b.z0 - 60 && z < b.z1 + 60) continue;
    geo.push(block(w, 40 + rnd() ** 2 * 200, w).translate(x, 0, z));
  }
  const f = facadeTextures();
  if (geo.length) add(new THREE.Mesh(mergeGeometries(geo), new THREE.MeshLambertMaterial({ map: f.map, color: new THREE.Color(0xffffff).multiplyScalar(Math.max(0.45, time.dim)), emissive: time.lamps ? 0xffffff : 0, emissiveMap: time.lamps ? f.glow : null })), true);
}

// A block standing on the ground, its windows the same size whatever its size (a texture tile: 24 m by 38 m)
function block(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), uv = g.attributes.uv as THREE.BufferAttribute;
  const span = [d, d, 0, 0, w, w]; // (faces: +x, -x, +y, -y, +z, -z; 4 corners each)
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    if (!span[f]) uv.setXY(k, 0.01, 0.01); // (the roof: the facade's dark corner)
    else uv.setXY(k, (uv.getX(k) * span[f]) / 24, (uv.getY(k) * h) / 38);
  }
  return g;
}

function placedMesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

// --- textures, drawn here so there's nothing to download ---------------------------------------------------

// Across the road (u: left kerb to right), along it (v, a tile every 12 m): asphalt, a white line along each
// kerb, and for `lanes` 4 the double yellow and dashed lines between lanes; 2: a dashed centre line; 0: nothing
function roadTexture(lanes: number) {
  const c = canvas(512, 512), g = c.getContext('2d')!, rnd = seeded(11 + lanes);
  g.fillStyle = '#34373e';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 26000, 58, rnd, 1);
  speckle(g, 512, 512, 2500, 84, rnd, 2);
  for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '20,20,24' : '70,72,78'},0.3)`; g.fillRect(rnd() * 440, rnd() * 440, 30 + rnd() * 50, 20 + rnd() * 60); }
  if (!lanes) return texture(c);
  g.fillStyle = '#e8e6df';
  g.fillRect(8, 0, 7, 512);
  g.fillRect(497, 0, 7, 512);
  if (lanes === 4) {
    for (const u of [0.25, 0.75]) for (let y = 0; y < 512; y += 256) g.fillRect(u * 512 - 3, y, 6, 110);
    g.fillStyle = '#f2c230';
    g.fillRect(249, 0, 5, 512);
    g.fillRect(258, 0, 5, 512);
  } else for (let y = 0; y < 512; y += 256) g.fillRect(253, y, 6, 110);
  return texture(c);
}

function plainRoad() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(15);
  g.fillStyle = '#323439';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 3000, 56, rnd, 1);
  return texture(c);
}

function paveTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(7);
  g.fillStyle = '#8d8c88';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 1500, 140, rnd);
  g.fillStyle = 'rgba(40,40,44,0.5)';
  for (let i = 0; i < 128; i += 32) { g.fillRect(i, 0, 2, 128); g.fillRect(0, i, 128, 2); }
  return texture(c);
}

function groundTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(9);
  g.fillStyle = '#4c4d52';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 2400, 88, rnd);
  g.fillStyle = 'rgba(25,25,28,0.4)';
  g.fillRect(0, 0, 128, 2);
  g.fillRect(0, 0, 2, 128);
  return texture(c);
}

// The light a car's headlights throw on the road ahead: brightest near the car, fading out
function beamTexture() {
  const c = canvas(128, 64), g = c.getContext('2d')!;
  const grad = g.createRadialGradient(10, 32, 2, 10, 32, 120);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  return texture(c, false);
}

// The blocks' walls: rows of windows (3.2 m storeys), lit at random at night
function facadeTextures() {
  const make = (lights: boolean) => {
    const c = canvas(128, 256), g = c.getContext('2d')!, rnd = seeded(lights ? 31 : 29);
    g.fillStyle = lights ? '#000000' : '#6a6e78';
    g.fillRect(0, 0, 128, 256);
    for (let y = 6; y < 250; y += 21) for (let x = 3; x < 128; x += 11) {
      if (lights) { if (rnd() < 0.32) { g.fillStyle = rnd() < 0.65 ? '#ffd9a0' : '#cfe0ff'; g.fillRect(x, y, 7, 12); } continue; }
      g.fillStyle = rnd() < 0.5 ? '#2c3442' : '#3a4558';
      g.fillRect(x, y, 7, 12);
    }
    g.fillStyle = '#1d1f24';
    g.fillRect(0, 250, 6, 6);
    return texture(c);
  };
  return { map: make(false), glow: make(true) };
}

// A green road sign: which way for the finish, and how far
function directionTexture(arrow: string, to: string, km: number) {
  const c = canvas(512, 148), g = c.getContext('2d')!;
  g.fillStyle = '#0f6b3e';
  g.fillRect(0, 0, 512, 148);
  g.strokeStyle = '#f3f0e8';
  g.lineWidth = 5;
  g.strokeRect(6, 6, 500, 136);
  g.fillStyle = '#f3f0e8';
  g.font = `800 60px ${DISPLAY_FONT}`;
  g.textBaseline = 'middle';
  g.fillText(`${arrow}  ${to.replace(/^the /, '')}`, 24, 54);
  g.font = `700 40px ${DISPLAY_FONT}`;
  g.fillText(`${km.toFixed(1)} km`, 24, 114);
  return texture(c, false);
}

function bannerTexture(text: string, finish: boolean) {
  const c = canvas(1024, 128), g = c.getContext('2d')!;
  g.fillStyle = '#0e1016';
  g.fillRect(0, 0, 1024, 128);
  if (finish) for (let x = 0; x < 1024; x += 32) for (const y of [0, 112]) { g.fillStyle = (x / 32 + y / 112) % 2 ? '#f3f0e8' : '#0e1016'; g.fillRect(x, y, 32, 16); }
  g.font = `900 76px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = finish ? '#d7ff3b' : '#f3f0e8';
  g.fillText(text.toUpperCase(), 512, 68, 980);
  return texture(c, false);
}
