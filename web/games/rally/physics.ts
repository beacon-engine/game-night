// Rally's physics. Each car is a rigid body (a box with a mass, and the inertia to match) on four
// wheels, each a ray down from where it's mounted to the ground, with a spring and a damper. The tyres
// push along and across the ground, as hard as the surface lets them. When the ground drops away faster
// than gravity can bring the car down after it, nothing holds it up and it flies: its momentum carries
// it on, gravity brings it down, and it keeps turning the way it was turning as it left (over a fast
// crest the front wheels lose the ground first while the rear ones still push up, so it pitches
// nose-down). It lands on its springs; land too hard and they bottom out, land on a corner and the
// body hits the ground and can roll. Cars hit each other as three spheres each; trees and rocks are
// posts. World space, metres and seconds, y up. No graphics here, and nothing allocated per step.
import * as THREE from 'three';
import type { Weather } from '@world/weather.ts';

export const TICK = 1 / 60;
const SUB = 3; // steps per tick: the springs are stiff
const DT = TICK / SUB;
export const G = 9.81;
const MAX_STEER = 0.6; // rad, the front wheels' lock when slow...
const STEER_FADE = 22; // ...less the faster you go (halved at this many m/s)
const STEER_RATE = 3; // rad/s the wheels turn at
const AIR_PITCH = 2.6; // in the air, throttle lifts the nose and the brake drops it (the wheels' inertia): N·m per kg
const BOUNCE_CARS = 0.45;
const BOUNCE_POSTS = 0.25;
const BOUNCE_GROUND = 0.15;

// How each surface grips (× the tyres' grip), how much it holds the car back (rolling resistance,
// × the load on the wheel), and how much dust it throws up
export const SURFACES = {
  tarmac: { grip: 1.1, roll: 0.015, dust: 0 },
  gravel: { grip: 0.82, roll: 0.03, dust: 1 },
  dirt: { grip: 0.76, roll: 0.04, dust: 1 },
  grass: { grip: 0.6, roll: 0.07, dust: 0.3 },
  water: { grip: 0.5, roll: 0.35, dust: 0 }, // (spray, not dust)
} as const;
export type Surface = keyof typeof SURFACES;
export const SURFACE_LIST = Object.keys(SURFACES) as Surface[];

// The weather's share of that (racing/weather.ts has the rain): soaked tarmac loses the most, wet
// gravel hardly anything (the stones drain), dirt turns to mud. Snow packs over everything; rally
// cars run studded tyres on it, which bite, but it's still the slipperiest there is.
const SOAKED: Record<Surface, number> = { tarmac: 0.72, gravel: 0.93, dirt: 0.78, grass: 0.72, water: 1 };
const SNOWED: Record<Surface, number> = { tarmac: 0.5, gravel: 0.62, dirt: 0.6, grass: 0.6, water: 1 };

// A tree trunk or a rock: an upright post, from the ground to `top`
export interface Post { x: number; z: number; r: number; top: number }

// What the cars drive on (stage.ts)
export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  surface(x: number, z: number): Surface;
  posts(x: number, z: number): readonly Post[]; // the ones near here
}

// What a car is made of. Body coordinates: x forward, y up, z to the right, from the centre of mass.
export interface Chassis {
  mass: number; // kg
  length: number; // m, the body
  width: number;
  height: number;
  cmHeight: number; // m, the centre of mass above the ground, at rest on its springs
  wheels: { x: number; z: number; front: boolean; name: string }[];
  wheelRadius: number;
  power: number; // W
  force: number; // N, the most the engine pushes with at low speed
  drag: number; // N per (m/s)²
  grip: number; // × the surface's grip
  travel: number; // m of suspension, from bottomed out to hanging free
  spring: number; // N/m, each wheel
  damper: number; // N·s/m, each wheel
}

export interface Wheel {
  x: number; z: number; front: boolean; name: string;
  length: number; // the spring's length now: 0 bottomed out .. travel hanging free
  contact: boolean;
  surface: Surface;
  load: number; // N pressing it into the ground
  slip: number; // m/s it's sliding across or along the ground
  spin: number; // rad, for drawing
}

export class Car {
  readonly p = new THREE.Vector3(); // the centre of mass
  readonly v = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly w = new THREE.Vector3(); // angular velocity
  throttle = 0; // 0..1
  brake = 0; // 0..1 (held when stopped: reverse)
  handbrake = 0; // 0..1, locks the rear wheels
  steer = 0; // -1 left .. 1 right
  angle = 0; // rad the front wheels are turned now (+ right)
  air = 0; // seconds with no wheel on the ground
  touching = 0; // wheels on the ground
  readonly wheels: Wheel[];
  readonly invMass: number;
  readonly invI: THREE.Vector3; // body axes
  readonly mount: number; // y of the wheels' mounting points, body coordinates
  readonly rest: number; // the springs' length at rest
  readonly corners: THREE.Vector3[]; // the body's box, for hitting the ground
  readonly spheres: THREE.Vector3[]; // ...and for hitting each other
  readonly radius: number;

  constructor(readonly id: string, readonly c: Chassis) {
    this.wheels = c.wheels.map((w) => ({ ...w, length: 0, contact: false, surface: 'gravel' as Surface, load: 0, slip: 0, spin: 0 }));
    this.invMass = 1 / c.mass;
    const { mass: m, length: L, width: W, height: H } = c;
    this.invI = new THREE.Vector3(12 / (m * (H * H + W * W)), 12 / (m * (L * L + W * W)), 12 / (m * (L * L + H * H)));
    this.rest = Math.max(c.travel * 0.25, c.travel - (m * G) / (4 * c.spring));
    for (const w of this.wheels) w.length = this.rest;
    this.mount = c.wheelRadius - c.cmHeight + this.rest;
    const bottom = c.wheelRadius * 0.9 - c.cmHeight, top = H - c.cmHeight;
    this.corners = [];
    for (const x of [-L / 2, L / 2]) for (const y of [bottom, top]) for (const z of [-W / 2, W / 2]) this.corners.push(new THREE.Vector3(x * 0.95, y, z * 0.9));
    this.radius = (W / 2) * 0.95;
    const mid = (bottom + top) / 2;
    this.spheres = [-1, 0, 1].map((k) => new THREE.Vector3(k * (L / 2 - this.radius), mid, 0));
  }

  get speed() { return this.v.length(); }
  get upright() { return _a.set(0, 1, 0).applyQuaternion(this.q).y; } // 1 on its wheels, -1 on its roof

  // On its wheels, still, facing `heading` (radians from +x, turning right as it grows)
  place(x: number, y: number, z: number, heading: number) {
    this.p.set(x, y + this.c.cmHeight + 0.05, z);
    this.q.setFromAxisAngle(_a.set(0, 1, 0), -heading);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.angle = this.air = 0;
    for (const w of this.wheels) w.length = this.rest;
  }
}

export interface Hit { car: Car; other: Car | null; strength: number; kind: 'car' | 'post' | 'ground' }
export interface Landing { car: Car; air: number; impact: number } // impact: m/s coming down

export class Physics {
  readonly cars: Car[] = [];
  readonly hits: Hit[] = [];
  readonly landings: Landing[] = [];

  weather: Weather | null = null; // none: dry

  constructor(readonly ground: Ground) {}

  // How much this surface grips (× the tyres' grip), in this weather
  grip(s: Surface) {
    const w = this.weather, dry = SURFACES[s].grip;
    if (!w) return dry;
    return dry * (w.snow ? SNOWED[s] : 1 + (SOAKED[s] - 1) * w.wet);
  }

  // One tick. hits and landings say what happened in it.
  step() {
    this.hits.length = this.landings.length = 0;
    const cars = this.cars;
    for (let s = 0; s < SUB; s++) {
      for (const c of cars) this.drive(c);
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) this.collide(cars[i], cars[j]);
      for (const c of cars) { this.body(c); this.posts(c); this.move(c); }
    }
  }

  // --- the wheels: springs, tyres, the engine and brakes -------------------------------------------
  private drive(car: Car) {
    const c = car.c, g = this.ground;
    basis(car);
    _f.set(0, -c.mass * G, 0);
    _t.set(0, 0, 0);
    const along = car.v.dot(_fwd);
    const lock = (car.steer * MAX_STEER) / (1 + Math.abs(along) / STEER_FADE);
    car.angle += clamp(lock - car.angle, -STEER_RATE * DT, STEER_RATE * DT);
    // the engine through all four wheels; held on the brake when stopped, it reverses
    const reversing = car.brake > 0 && car.throttle === 0 && along < 1.5;
    const drive = reversing ? -car.brake * c.force * 0.4 : car.throttle * Math.min(c.force, c.power / Math.max(1, Math.abs(along)));
    const falling = -car.v.y;
    let touching = 0;
    for (const wh of car.wheels) {
      _hp.set(wh.x, car.mount, wh.z).applyQuaternion(car.q).add(car.p); // where it's mounted
      _dir.copy(_up).negate();
      const t = this.ray(_hp, _dir, c.travel + c.wheelRadius);
      if (t < 0) { // hanging free: spinning on, slowing
        wh.contact = false;
        wh.length = c.travel;
        wh.load = wh.slip = 0;
        continue;
      }
      touching++;
      wh.contact = true;
      wh.length = Math.max(0, t - c.wheelRadius);
      _cp.copy(_dir).multiplyScalar(t).add(_hp); // where the tyre touches
      g.normal(_cp.x, _cp.z, _n);

      // the spring and damper, and the bump stop when it runs out of travel
      _r.subVectors(_hp, car.p);
      pointVelocity(car, _r, _vc);
      const opening = _vc.dot(_up); // the mounting point moving away from the ground
      let load = c.spring * (c.travel - wh.length) - c.damper * opening;
      const stop = c.travel * 0.12;
      if (wh.length < stop) load += c.spring * 12 * (stop - wh.length) - c.damper * 4 * Math.min(0, opening);
      load = Math.max(0, load);
      wh.load = load;

      // the tyre: how fast the ground is going by under it, along the wheel and across it
      _r.subVectors(_cp, car.p);
      pointVelocity(car, _r, _vc);
      if (wh.front) _fw.copy(_fwd).multiplyScalar(Math.cos(car.angle)).addScaledVector(_right, Math.sin(car.angle));
      else _fw.copy(_fwd);
      _fw.addScaledVector(_n, -_fw.dot(_n)).normalize();
      _sw.crossVectors(_fw, _n);
      const vAlong = _vc.dot(_fw), vAcross = _vc.dot(_sw);
      const surface = SURFACES[(wh.surface = g.surface(_cp.x, _cp.z))];
      const grip = this.grip(wh.surface) * c.grip * load;
      const locked = !wh.front && car.handbrake > 0.5;
      // across: as hard as it's sliding, up to the grip (stiffer when nearly still, so it parks on a slope)
      const give = Math.abs(vAlong) + Math.abs(vAcross) < 1 ? 0.08 : 0.45;
      let fy = -grip * clamp(vAcross / give, -1, 1) * (locked ? 0.45 : 1);
      // along: the engine, the brakes and rolling resistance; a locked wheel just slides
      let fx: number;
      if (locked) fx = -grip * 0.9 * clamp(vAlong / 0.5, -1, 1);
      else {
        fx = drive / 4 - surface.roll * load * clamp(vAlong, -1, 1);
        if (!reversing) fx -= car.brake * grip * 0.9 * clamp(vAlong / 0.5, -1, 1);
      }
      // together they can't be more than the grip. Turning comes first: the engine and the brakes get
      // what's left (the rest spins or locks the wheel), so the car still steers with your foot down.
      // A locked wheel shares it out, so the back steps out on the handbrake.
      let over = 0;
      if (locked) {
        const total = Math.hypot(fx, fy);
        if (total > grip) { over = 1 - grip / total; fx *= 1 - over; fy *= 1 - over; }
      } else {
        const room = Math.sqrt(Math.max(0, grip * grip - fy * fy));
        if (Math.abs(fx) > room) { over = 1 - room / Math.abs(fx); fx = Math.sign(fx) * room; }
      }
      wh.slip = Math.abs(vAcross) + (locked ? Math.abs(vAlong) : 0) + over * 6;
      const turn = locked ? 0 : vAlong / c.wheelRadius + (car.throttle * over * 40);
      wh.spin += turn * DT;
      _a.copy(_fw).multiplyScalar(fx).addScaledVector(_sw, fy).addScaledVector(_n, load);
      addForce(_a, _r);
    }
    // the air holds it back, more the faster it goes; in the air, the pedals pitch it a little
    _f.addScaledVector(car.v, -c.drag * car.v.length());
    if (!touching) _t.addScaledVector(_right, (car.throttle - car.brake) * AIR_PITCH * c.mass);

    car.v.addScaledVector(_f, car.invMass * DT);
    worldInverseInertia(car, _t, _a);
    car.w.addScaledVector(_a, DT);
    car.w.multiplyScalar(1 - (touching ? 0.6 : 0.08) * DT);

    // landing: when the wheels find the ground again after a while in the air
    if (touching && car.air > 0.25) this.landings.push({ car, air: car.air, impact: Math.max(0, falling) });
    car.air = touching ? 0 : car.air + DT;
    car.touching = touching;
  }

  // How far along the ray the ground is, or -1 if it isn't within reach
  private ray(from: THREE.Vector3, dir: THREE.Vector3, reach: number) {
    const g = this.ground;
    const above = (t: number) => from.y + dir.y * t - g.height(from.x + dir.x * t, from.z + dir.z * t);
    if (above(0) <= 0) return 0;
    if (above(reach) > 0) return -1;
    let lo = 0, hi = reach;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (above(mid) > 0) lo = mid; else hi = mid;
    }
    return hi;
  }

  // --- the body against the ground: a bad landing, or rolling over ---------------------------------
  // Every corner touching is worked out from the same moment and shared between them, so landing
  // flat on two corners doesn't roll the car toward whichever was looked at first.
  private body(car: Car) {
    const g = this.ground;
    let deepest = 0, n = 0;
    for (const k of car.corners) {
      const r = _rs[n];
      r.copy(k).applyQuaternion(car.q);
      _cp.addVectors(car.p, r);
      const pen = g.height(_cp.x, _cp.z) - _cp.y;
      if (pen <= 0) continue;
      g.normal(_cp.x, _cp.z, _ns[n]);
      if (pen > deepest) { deepest = pen; _push.copy(_ns[n]); }
      n++;
    }
    if (!n) return;
    _v0.copy(car.v);
    _w0.copy(car.w);
    _dv.set(0, 0, 0);
    _dw.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      car.v.copy(_v0);
      car.w.copy(_w0);
      this.impulse(car, _rs[i], _ns[i], BOUNCE_GROUND, 0.6, 'ground');
      _dv.add(car.v).sub(_v0);
      _dw.add(car.w).sub(_w0);
    }
    car.v.copy(_v0).addScaledVector(_dv, 1 / n);
    car.w.copy(_w0).addScaledVector(_dw, 1 / n);
    car.p.addScaledVector(_push, deepest * 0.6);
  }

  // Trees and rocks: posts the car's spheres can't go through
  private posts(car: Car) {
    for (const post of this.ground.posts(car.p.x, car.p.z)) {
      for (const k of car.spheres) {
        _cp.copy(k).applyQuaternion(car.q).add(car.p);
        if (_cp.y - car.radius > post.top) continue;
        const dx = _cp.x - post.x, dz = _cp.z - post.z, d = Math.hypot(dx, dz), reach = car.radius + post.r;
        if (d >= reach || d < 1e-6) continue;
        _n.set(dx / d, 0, dz / d); // from the post to the car
        car.p.addScaledVector(_n, reach - d);
        _r.copy(_n).multiplyScalar(-car.radius).add(_cp).sub(car.p);
        this.impulse(car, _r, _n, BOUNCE_POSTS, 0.4, 'post');
      }
    }
  }

  // --- car against car: three spheres each, impulses with spin ---------------------------------------
  private collide(a: Car, b: Car) {
    const reach = a.radius + b.radius;
    if (a.p.distanceToSquared(b.p) > (reach + a.c.length) ** 2) return;
    for (const ka of a.spheres) for (const kb of b.spheres) {
      _ca.copy(ka).applyQuaternion(a.q).add(a.p);
      _cb.copy(kb).applyQuaternion(b.q).add(b.p);
      _n.subVectors(_cb, _ca);
      const d = _n.length();
      if (d >= reach) continue;
      if (d < 1e-6) _n.set(1, 0, 0); else _n.divideScalar(d); // from a to b
      const pen = reach - d, share = a.invMass / (a.invMass + b.invMass);
      a.p.addScaledVector(_n, -pen * share);
      b.p.addScaledVector(_n, pen * (1 - share));
      _cp.copy(_n).multiplyScalar(a.radius - pen / 2).add(_ca); // where they touch
      _ra.subVectors(_cp, a.p);
      _rb.subVectors(_cp, b.p);
      pointVelocity(b, _rb, _vb);
      pointVelocity(a, _ra, _va);
      _vb.sub(_va); // b relative to a
      const vn = _vb.dot(_n);
      if (vn >= 0) continue;
      const j = (-(1 + BOUNCE_CARS) * vn) / (a.invMass + b.invMass + turning(a, _ra, _n) + turning(b, _rb, _n));
      _a.copy(_n).multiplyScalar(j);
      applyImpulse(b, _a, _rb);
      applyImpulse(a, _a.negate(), _ra);
      // friction: rubbing slows the sideways scrape
      _vb.addScaledVector(_n, -vn);
      const vt = _vb.length();
      if (vt > 1e-3) {
        _vb.divideScalar(vt);
        const jt = Math.min(0.3 * j, vt / (a.invMass + b.invMass + turning(a, _ra, _vb) + turning(b, _rb, _vb)));
        _a.copy(_vb).multiplyScalar(-jt);
        applyImpulse(b, _a, _rb);
        applyImpulse(a, _a.negate(), _ra);
      }
      if (-vn > 1.5) {
        this.hits.push({ car: a, other: b, strength: -vn, kind: 'car' });
        this.hits.push({ car: b, other: a, strength: -vn, kind: 'car' });
      }
    }
  }

  // A hit against something that doesn't move (the ground, a post): `n` points out of it, toward the car
  private impulse(car: Car, r: THREE.Vector3, n: THREE.Vector3, bounce: number, friction: number, kind: Hit['kind']) {
    pointVelocity(car, r, _vc);
    const vn = _vc.dot(n);
    if (vn >= 0) return;
    const j = (-(1 + bounce) * vn) / (car.invMass + turning(car, r, n));
    _a.copy(n).multiplyScalar(j);
    applyImpulse(car, _a, r);
    _vc.addScaledVector(n, -vn);
    const vt = _vc.length();
    if (vt > 1e-3) {
      _vc.divideScalar(vt);
      const jt = Math.min(friction * j, vt / (car.invMass + turning(car, r, _vc)));
      _a.copy(_vc).multiplyScalar(-jt);
      applyImpulse(car, _a, r);
    }
    if (-vn > 2) this.hits.push({ car, other: null, strength: -vn, kind });
  }

  private move(car: Car) {
    car.p.addScaledVector(car.v, DT);
    const w = car.w, q = car.q, h = DT / 2;
    _q.set(w.x * h, w.y * h, w.z * h, 0).multiply(q); // dq = ½ ω q dt
    q.set(q.x + _q.x, q.y + _q.y, q.z + _q.z, q.w + _q.w).normalize();
  }
}

// --- helpers (scratch vectors, so a step allocates nothing) --------------------------------------------
const _a = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
const _hp = new THREE.Vector3(), _dir = new THREE.Vector3(), _cp = new THREE.Vector3(), _r = new THREE.Vector3();
const _vc = new THREE.Vector3(), _n = new THREE.Vector3(), _fw = new THREE.Vector3(), _sw = new THREE.Vector3();
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _ra = new THREE.Vector3(), _rb = new THREE.Vector3();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _push = new THREE.Vector3(), _i = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _rs = Array.from({ length: 8 }, () => new THREE.Vector3()), _ns = Array.from({ length: 8 }, () => new THREE.Vector3());
const _v0 = new THREE.Vector3(), _w0 = new THREE.Vector3(), _dv = new THREE.Vector3(), _dw = new THREE.Vector3();

function basis(car: Car) {
  _fwd.set(1, 0, 0).applyQuaternion(car.q);
  _up.set(0, 1, 0).applyQuaternion(car.q);
  _right.set(0, 0, 1).applyQuaternion(car.q);
}

// The velocity of a point on the car, r from its centre of mass
function pointVelocity(car: Car, r: THREE.Vector3, out: THREE.Vector3) {
  return out.crossVectors(car.w, r).add(car.v);
}

// A force at r from the centre of mass, into this step's totals
function addForce(f: THREE.Vector3, r: THREE.Vector3) {
  _f.add(f);
  _t.add(_i.crossVectors(r, f));
}

// The inverse inertia, turned into the world: out = I⁻¹ v
function worldInverseInertia(car: Car, v: THREE.Vector3, out: THREE.Vector3) {
  _qi.copy(car.q).invert();
  return out.copy(v).applyQuaternion(_qi).multiply(car.invI).applyQuaternion(car.q);
}

// How much a push along n at r turns the car rather than moving it: n · ((I⁻¹ (r × n)) × r)
function turning(car: Car, r: THREE.Vector3, n: THREE.Vector3) {
  worldInverseInertia(car, _i.crossVectors(r, n), _i);
  return _i.cross(r).dot(n);
}

function applyImpulse(car: Car, j: THREE.Vector3, r: THREE.Vector3) {
  car.v.addScaledVector(j, car.invMass);
  car.w.add(worldInverseInertia(car, _i.crossVectors(r, j), _i));
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
