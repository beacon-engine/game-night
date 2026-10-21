// The race: everyone on the stage at once (rallycross, so 1 to 4 people share one screen and nobody
// waits for a turn), laps, positions, the computer drivers, and putting cars back on the road when
// they're upside down, stuck, or lost out in the trees. Only driving counts: cutting across the land
// doesn't move you on. No graphics.
import * as THREE from 'three';
import { Car, clamp, G, Physics, SURFACES, TICK, type Chassis, type Hit, type Landing } from './physics.ts';
import type { Stage, Where } from './stage.ts';

export interface RacerSpec {
  id: string;
  name: string;
  color: string; // the player's colour (the tower, the results)
  paint?: string; // the car's paint, when it isn't that colour
  number: number;
  ai: boolean;
  skill: number; // the computer drivers' pace, as a share of the car's best (people drive at 1)
  car: { id: string; name: string };
  chassis: Chassis;
}

export class Racer {
  readonly car: Car;
  s = 0; // where it is along the road...
  d = 0; // ...and across it
  safe = 0; // the last s it was on the road at (where it goes back to)
  dist = 0; // m driven along the road since the start (negative on the grid)
  laps = 0;
  lapStart = 0;
  lastLap = 0;
  bestLap = 0;
  finish: number | null = null; // race time when it crossed the line for the last time
  lost = 0; // seconds upside down, stuck or off the road
  resets = 0;
  why: 'flipped' | 'off' | 'asked' = 'off'; // the last time it was put back
  bigAir = 0; // the longest it's flown, seconds
  wantsReset = false; // its driver asked to be put back on the road
  // the computer driver
  lane = 0;
  stuck = 0;
  reverse = 0;

  constructor(readonly spec: RacerSpec) {
    this.car = new Car(spec.id, spec.chassis);
  }

  get id() { return this.spec.id; }
}

export interface RaceEvents {
  hits: (Hit & { racer: Racer })[];
  landings: (Landing & { racer: Racer })[];
  lap: Racer[];
  finished: Racer[];
  reset: Racer[];
}

const OFF = 22; // m beyond the road's edge that counts as lost
const LOST = 3; // seconds lost before going back on the road
const FLIPPED = 2; // ...or upside down

export class Race {
  readonly physics: Physics;
  readonly racers: Racer[];
  t = 0; // seconds since the green flag
  private byCar = new Map<Car, Racer>();
  private where: Where = { s: 0, d: 0, dist: 0 };

  // specs in grid order: two by two behind the line
  constructor(readonly stage: Stage, specs: RacerSpec[], readonly laps: number) {
    this.physics = new Physics(stage);
    this.racers = specs.map((spec, i) => {
      const r = new Racer(spec), spot = stage.gridSpot(i);
      this.put(r, spot.s, spot.d);
      r.dist = spot.s;
      this.byCar.set(r.car, r);
      this.physics.cars.push(r.car);
      return r;
    });
  }

  // One tick. Before the green flag the cars wait on the grid with the handbrake on.
  step(green: boolean): RaceEvents {
    const ev: RaceEvents = { hits: [], landings: [], lap: [], finished: [], reset: [] };
    if (green) this.t += TICK;
    for (const r of this.racers) {
      if (r.spec.ai || r.finish !== null) this.drive(r);
      if (!green) { r.car.throttle = r.car.brake = 0; r.car.handbrake = 1; }
    }
    this.physics.step();
    for (const h of this.physics.hits) ev.hits.push({ ...h, racer: this.byCar.get(h.car)! });
    for (const l of this.physics.landings) {
      const r = this.byCar.get(l.car)!;
      r.bigAir = Math.max(r.bigAir, l.air);
      ev.landings.push({ ...l, racer: r });
    }
    for (const r of this.racers) this.follow(r, green, ev);
    return ev;
  }

  // Finishers first, in the order they finished; then whoever has gone furthest
  standings() {
    return [...this.racers].sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.dist - a.dist);
  }

  // Where each car is on the road, its laps, and whether it needs putting back
  private follow(r: Racer, green: boolean, ev: RaceEvents) {
    const st = this.stage, car = r.car, w = this.where, L = st.length;
    st.locate(r.s, car.p.x, car.p.z, w);
    const ds = st.gap(w.s, r.s), on = w.dist < st.width / 2 + OFF;
    const before = r.dist;
    r.s = w.s;
    r.d = w.d;
    if (on) { r.dist += ds; r.safe = w.s; }
    const flipped = car.upright < 0.3 && car.speed < 3;
    r.lost = !on || flipped || car.p.y < st.height(car.p.x, car.p.z) - 3 ? r.lost + TICK : 0; // (stuck people press reset)
    if (r.wantsReset || r.lost > (flipped ? FLIPPED : LOST)) {
      r.why = r.wantsReset ? 'asked' : flipped ? 'flipped' : 'off';
      r.wantsReset = false;
      this.put(r, r.safe - 6, 0);
      r.resets++;
      ev.reset.push(r);
      return;
    }
    if (green && r.finish === null && before >= 0 && Math.floor(r.dist / L) > Math.floor(before / L)) {
      r.laps++;
      r.lastLap = this.t - r.lapStart;
      r.bestLap = r.bestLap ? Math.min(r.bestLap, r.lastLap) : r.lastLap;
      r.lapStart = this.t;
      ev.lap.push(r);
      if (r.laps >= this.laps) { r.finish = this.t; ev.finished.push(r); }
    }
  }

  // Back on the road, still, facing the right way; beside anyone already there
  private put(r: Racer, s: number, d: number) {
    const st = this.stage;
    for (const side of [0, -1, 1, -2, 2]) {
      const at = st.point(s, d + side * 3, _p);
      if (this.racers?.some((o) => o !== r && o.car.p.distanceTo(at) < 6)) continue;
      r.car.place(at.x, at.y, at.z, st.heading(s));
      break;
    }
    r.s = r.safe = st.wrap(s);
    r.lost = r.stuck = r.reverse = 0;
  }

  // --- the computer drivers ----------------------------------------------------------------------------
  // Aim at a point on the road ahead (further the faster), on the inside of the next bend unless
  // someone's there; slow for what the bends ahead allow and take the big jumps at a sane speed; level
  // the car in the air with the pedals; back out when stuck against something.
  private drive(r: Racer) {
    const car = r.car, st = this.stage, v = car.speed;
    const fwd = _f.set(1, 0, 0).applyQuaternion(car.q);
    if (r.finish !== null) { car.throttle = v < 12 ? 0.4 : 0; car.brake = v > 16 ? 0.3 : 0; }
    const look = 6 + v * 0.5, bend = st.curve(r.s + look);
    const ahead = this.nearestAhead(r);
    const inside = Math.abs(bend) < 1 / 35 ? -Math.sign(bend) * Math.min(1.5, st.width / 5) : 0; // (not in the hairpins: it'd cut them)
    const want = ahead ? clamp(ahead.d + (ahead.d > r.d ? -3 : 3), -st.width / 2 + 1.5, st.width / 2 - 1.5) : inside;
    r.lane += clamp(want - r.lane, -3 * TICK, 3 * TICK);
    const target = st.point(r.s + look, r.lane, _t);
    const dx = target.x - car.p.x, dz = target.z - car.p.z;
    const angle = Math.atan2(dx * -fwd.z + dz * fwd.x, dx * fwd.x + dz * fwd.z); // (+: to the right)
    car.steer = clamp(angle * 2.2, -1, 1);
    car.handbrake = 0;
    if (r.finish !== null) return;

    // how fast: the bends ahead (and stopping for them in time), the jumps and the water
    const mu = SURFACES[st.surface(car.p.x, car.p.z)].grip * car.c.grip;
    let top = 60 * r.spec.skill;
    for (let x = 5; x <= 130; x += 5) {
      const k = Math.abs(st.curve(r.s + x));
      if (k < 1e-4) continue;
      const vmax = Math.sqrt((mu * G * 0.72 * r.spec.skill) / k);
      top = Math.min(top, Math.sqrt(vmax * vmax + 2 * mu * G * 0.45 * x)); // (braking gently: it may be downhill)
    }
    for (const f of st.features) {
      const gap = st.gap(f.s, r.s);
      if (gap < -5 || gap > 90) continue;
      if (f.kind === 'crest') top = Math.min(top, (f.size > 2.3 ? 24 : 28) * r.spec.skill);
      if (f.kind === 'ford') top = Math.min(top, 16);
    }
    if (v > top + 1.5) { car.throttle = 0; car.brake = clamp((v - top) / 5, 0.3, 1); }
    else if (v > top) { car.throttle = 0.3; car.brake = 0; }
    else { car.throttle = 1; car.brake = 0; }
    // in the air: keep the nose level
    if (!car.touching) { car.throttle = fwd.y < -0.08 ? 1 : 0; car.brake = fwd.y > 0.15 ? 0.6 : 0; }
    // stuck against a tree or a car: back out, turning the other way
    if (r.reverse > 0) {
      r.reverse -= TICK;
      car.throttle = 0;
      car.brake = 1;
      car.steer = -car.steer;
    } else if (v < 1 && this.t > 4) {
      r.stuck += TICK;
      if (r.stuck > 1.5) { r.reverse = 1.4; r.stuck = 0; }
    } else r.stuck = 0;
  }

  // The nearest car close ahead in this car's line
  private nearestAhead(r: Racer) {
    let best: Racer | null = null, bestGap = 25;
    for (const o of this.racers) {
      if (o === r || Math.abs(o.d - r.d) > 2.6) continue;
      const gap = this.stage.gap(o.s, r.s);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = o; }
    }
    return best;
  }
}

const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
