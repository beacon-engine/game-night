// The race: cars on the oval, the tow, contact, laps, and the computer drivers. No graphics.
// A car lives in track terms (track.ts): how far it has gone (`dist`, counting laps), how far out
// from the centre line (`d`), and its speeds along and across the track. That keeps the handling
// simple to tune and the computer drivers simple to write: pick a lane, hold it, pull out to pass.
import type { Track } from './track.ts';

export const TICK = 1 / 60;
export const TOP = 84; // m/s flat out on your own: about 188 mph
const ACCEL = 16;
const BRAKE = 26;
const GRIP = 54; // m/s² of cornering the banking holds; beyond it the car slides up the track
const SLIDE = 0.45; // how fast the extra pushes it out
const SCRUB = 0.1; // ...and the speed that costs
const TOW = 0.07; // up to 7% more top speed in another car's slipstream
const TOW_RANGE = 45; // m
const SHOVE = 0.015; // a car right behind pushes the one in front along a little
export const CAR_LENGTH = 5;
export const CAR_WIDTH = 2;
const LANES = [-6, 0, 6]; // where the computer drivers like to run (bottom, middle, top)

export interface CarSpec {
  id: string;
  name: string;
  color: string;
  number: number;
  ai: boolean;
  skill: number; // top speed, as a share of the fastest car (people drive at 1)
}

export class Car {
  dist = 0; // m from the line, since the start (negative on the grid)
  d = 0; // m out from the centre line
  v = 0; // m/s along the track
  vd = 0; // m/s across it, from steering
  slide = 0; // m/s up the track, from going into a turn faster than it holds
  throttle = 0; // 0..1
  brake = 0; // 0..1
  steer = 0; // -1 (down the track) .. 1 (up)
  tow = 0; // the slipstream it's in right now
  laps = 0;
  lapStart = 0;
  lastLap = 0;
  bestLap = 0;
  finish: number | null = null; // race time when it took the chequered flag
  bumped = 0; // seconds since the last contact (for buzzing phones once, not every tick)
  lane = 0; // the computer driver: the lane it's heading for
  laneWait = 0;

  constructor(readonly spec: CarSpec) {}

  get id() { return this.spec.id; }
  // which way it points, relative to the track (sliding or changing lanes)
  get yaw() { return Math.atan2(this.vd + this.slide, Math.max(this.v, 1)); }
}

export interface RaceEvents {
  contact: Car[];
  wall: Car[];
  lap: Car[];
  finished: Car[];
}

export class Race {
  readonly cars: Car[];
  t = 0; // seconds since the green flag

  // specs in grid order: two by two, the pole on the inside
  constructor(readonly track: Track, specs: CarSpec[], readonly laps: number) {
    this.cars = specs.map((spec, i) => {
      const c = new Car(spec);
      c.dist = -8 - Math.floor(i / 2) * 11;
      c.d = c.lane = i % 2 ? 2 : -5;
      return c;
    });
  }

  // One tick. Before the green flag the cars wait on the grid.
  step(green: boolean): RaceEvents {
    const ev: RaceEvents = { contact: [], wall: [], lap: [], finished: [] };
    if (green) this.t += TICK;
    for (const c of this.cars) {
      if (c.spec.ai || c.finish !== null) this.drive(c);
      if (!green) c.throttle = c.steer = 0;
      this.move(c, ev, green);
    }
    this.collide(ev);
    return ev;
  }

  // Finishers first, in the order they finished; then whoever has gone furthest
  standings() {
    return [...this.cars].sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.dist - a.dist);
  }

  get winner() {
    return this.cars.find((c) => c.finish !== null && this.cars.every((o) => o.finish === null || o.finish >= c.finish!)) ?? null;
  }

  // --- handling --------------------------------------------------------------------------------
  private move(c: Car, ev: RaceEvents, green: boolean) {
    const track = this.track, L = track.length;
    const { k } = track.at(c.dist);

    // the tow: tucked in behind someone you go faster, and they get a shove
    c.tow = 0;
    let shove = 0;
    for (const o of this.cars) {
      if (o === c || Math.abs(o.d - c.d) > CAR_WIDTH * 1.3) continue;
      const gap = track.gap(o.dist, c.dist);
      if (gap > CAR_LENGTH * 0.8 && gap < TOW_RANGE) c.tow = Math.max(c.tow, TOW * (1 - gap / TOW_RANGE));
      else if (gap < -CAR_LENGTH * 0.8 && gap > -10) shove = SHOVE;
    }
    const top = TOP * c.spec.skill * (1 + c.tow + shove);
    let a = ACCEL * (c.throttle - c.v / top); // settles at throttle × top speed
    if (a < 0) a *= 0.25; // lifting off slows you gently
    a -= c.brake * BRAKE;
    c.v = Math.max(0, c.v + a * TICK);

    // the turns: more speed than the banking holds pushes you up the track and scrubs speed
    const need = k ? (c.v * c.v * k) / (1 + k * c.d) : 0;
    const extra = Math.max(0, need - GRIP);
    c.slide = extra * SLIDE;
    c.v = Math.max(0, c.v - extra * SCRUB * TICK);

    // steering moves you across the track, quicker the faster you go
    const reach = 3 + 0.12 * c.v;
    c.vd += (c.steer * reach - c.vd) * Math.min(1, 8 * TICK);
    c.v = Math.max(0, c.v - Math.abs(c.vd) * 0.03 * TICK);
    c.d += (c.vd + c.slide) * TICK;

    const edge = track.width / 2 - CAR_WIDTH / 2;
    if (c.d > edge) { // the outside wall
      const hit = c.vd + c.slide;
      c.d = edge;
      if (hit > 2) { c.v = Math.max(0, c.v - Math.min(c.v * 0.3, hit * 1.5)); ev.wall.push(c); }
      c.vd = -0.2 * Math.abs(c.vd);
    } else if (c.d < -edge) { // the inside edge (the apron below it is out of bounds)
      c.d = -edge;
      c.vd = 0.2 * Math.abs(c.vd);
    }

    // along the track: a lane further out is a longer way round
    const lapsBefore = Math.floor(c.dist / L);
    c.dist += (c.v / (1 + k * c.d)) * TICK;
    c.bumped += TICK;
    if (green && c.finish === null && lapsBefore >= 0 && Math.floor(c.dist / L) > lapsBefore) {
      c.laps++;
      c.lastLap = this.t - c.lapStart;
      c.bestLap = c.bestLap ? Math.min(c.bestLap, c.lastLap) : c.lastLap;
      c.lapStart = this.t;
      ev.lap.push(c);
      if (c.laps >= this.laps) { c.finish = this.t; ev.finished.push(c); }
    }
  }

  // Cars bump rather than wreck: nose to tail passes speed forward (a bump draft), side to side
  // pushes them apart
  private collide(ev: RaceEvents) {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        const ds = this.track.gap(a.dist, b.dist), dd = a.d - b.d;
        const along = CAR_LENGTH - Math.abs(ds), across = CAR_WIDTH - Math.abs(dd);
        if (along <= 0 || across <= 0) continue;
        let hard = false;
        if (along / CAR_LENGTH < across / CAR_WIDTH) {
          const [front, back] = ds > 0 ? [a, b] : [b, a];
          back.dist -= along;
          if (back.v > front.v) {
            hard = back.v - front.v > 3;
            const give = (back.v - front.v) * 0.55;
            back.v -= give;
            front.v += give * 0.9;
          }
        } else {
          const side = Math.sign(dd) || 1;
          a.d += (side * across) / 2;
          b.d -= (side * across) / 2;
          hard = Math.abs(a.vd - b.vd) > 3;
          const mid = (a.vd + b.vd) / 2;
          a.vd = mid + side * 1.5;
          b.vd = mid - side * 1.5;
          a.v *= 0.997;
          b.v *= 0.997;
        }
        for (const c of [a, b]) {
          if (hard && c.bumped > 0.4) ev.contact.push(c);
          c.bumped = 0;
        }
      }
    }
  }

  // --- the computer drivers ------------------------------------------------------------------------
  // Run in a lane; catching someone, pull out to whichever side is clear; drift back to the bottom.
  private drive(c: Car) {
    const ahead = this.nearestAhead(c);
    c.laneWait -= TICK;
    if (c.laneWait <= 0) {
      if (ahead && (ahead.gap < 14 || ahead.car.v < c.v - 1)) {
        const free = LANES.filter((l) => Math.abs(l - c.lane) > 1)
          .sort((x, y) => Math.abs(x - c.d) - Math.abs(y - c.d))
          .find((l) => this.clear(c, l));
        if (free !== undefined) { c.lane = free; c.laneWait = 2 + Math.random() * 2; }
      } else if (c.lane !== LANES[0] && Math.random() < 0.01 && this.clear(c, LANES[0])) {
        c.lane = LANES[0];
        c.laneWait = 3;
      }
    }
    const reach = 3 + 0.12 * c.v;
    c.steer = clamp((c.lane - c.d) * 0.25 - c.vd * 0.05 - c.slide / reach, -1, 1);
    c.brake = 0;
    if (c.finish !== null) c.throttle = 0.45; // the cool-down lap
    else c.throttle = ahead && ahead.gap < 6 && ahead.car.v < c.v ? 0.6 : 1;
  }

  // The nearest car ahead in this car's line
  private nearestAhead(c: Car) {
    let best: { car: Car; gap: number } | null = null;
    for (const o of this.cars) {
      if (o === c || Math.abs(o.d - c.d) > CAR_WIDTH * 1.3) continue;
      const gap = this.track.gap(o.dist, c.dist);
      if (gap > 0 && gap < 30 && (!best || gap < best.gap)) best = { car: o, gap };
    }
    return best;
  }

  // Room in that lane, from a little behind to a bit ahead
  private clear(c: Car, lane: number) {
    return this.cars.every((o) => {
      if (o === c || Math.abs(o.d - lane) > CAR_WIDTH * 1.5) return true;
      const gap = this.track.gap(o.dist, c.dist);
      return gap < -9 || gap > 18;
    });
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
