// The race: cars on the track, the tow, contact, laps, and the computer drivers. No graphics.
// A car lives in track terms (track.ts): how far it has gone (`dist`, counting laps), how far out
// from the centre line (`d`), and its speeds along and across the track. That keeps the handling
// simple to tune and the computer drivers simple to write: pick a lane, hold it, pull out to pass.
import type { Track } from './track.ts';

export const TICK = 1 / 60;
export const TOP = 84; // m/s flat out on your own in a Stocker: about 188 mph
const ACCEL = 16;
const BRAKE = 26;
const GRIP = 54; // m/s² of cornering the banking holds; beyond it the car slides up the track
const SLIDE = 0.45; // how fast the extra pushes it out
const SCRUB = 0.1; // ...and the speed that costs
const TOW = 0.07; // up to 7% more top speed in another car's slipstream
const TOW_RANGE = 45; // m
const SHOVE = 0.015; // a car right behind pushes the one in front along a little
const BOUNCE = 0.35; // how much of a hit comes back off the wall or another car
const SPIN_WALL = 11; // m/s into the wall that spins you round
const SPIN_HIT = 12; // m/s of closing speed in a hit that spins the lighter car

// What a car is like (cars.json), compared with the Stocker; length and width in metres
export interface CarStats { top: number; accel: number; grip: number; weight: number; length: number; width: number }

export interface CarSpec {
  id: string;
  name: string;
  color: string;
  number: number;
  ai: boolean;
  skill: number; // the computer drivers' pace, as a share of the car's best (people drive at 1)
  car: CarStats & { id: string; name: string; model: string };
}

export class Car {
  dist = 0; // m from the line, since the start (negative on the grid)
  d = 0; // m out from the centre line
  v = 0; // m/s along the track
  vd = 0; // m/s across it, from steering and knocks
  slide = 0; // m/s up the track, from going into a turn faster than it holds
  throttle = 0; // 0..1
  brake = 0; // 0..1
  steer = 0; // -1 (down the track) .. 1 (up)
  tow = 0; // the slipstream it's in right now
  spin = 0; // rad: knocked sideways, or spinning round
  spinRate = 0;
  spinning = 0; // seconds of a spin-out left
  scraping = false; // along the wall right now
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
  get stats() { return this.spec.car; }
  // which way it points, relative to the track
  get yaw() { return Math.atan2(this.vd + this.slide, Math.max(this.v, 1)) + this.spin; }
}

export interface Hit { car: Car; strength: number; d: number } // d: where across the car, for the sparks
export interface RaceEvents {
  contact: Hit[];
  wall: Hit[];
  spun: Car[];
  lap: Car[];
  finished: Car[];
}

export class Race {
  readonly cars: Car[];
  t = 0; // seconds since the green flag
  private lanes: number[]; // where the computer drivers like to run: bottom, middle, top

  // specs in grid order: two by two, the pole on the inside
  constructor(readonly track: Track, specs: CarSpec[], readonly laps: number) {
    const W = track.width;
    this.lanes = [-W / 2 + 3.5, -W / 2 + 3.5 + Math.min(6, W / 3), -W / 2 + 3.5 + Math.min(12, (2 * W) / 3)];
    this.cars = specs.map((spec, i) => {
      const c = new Car(spec);
      c.dist = -8 - Math.floor(i / 2) * 11;
      c.d = c.lane = this.lanes[i % 2];
      return c;
    });
  }

  // One tick. Before the green flag the cars wait on the grid.
  step(green: boolean): RaceEvents {
    const ev: RaceEvents = { contact: [], wall: [], spun: [], lap: [], finished: [] };
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

  // --- handling --------------------------------------------------------------------------------
  private move(c: Car, ev: RaceEvents, green: boolean) {
    const track = this.track, L = track.length, s = c.stats;
    const { k } = track.at(c.dist);
    const spinning = c.spinning > 0;
    const throttle = spinning ? 0 : c.throttle, steer = spinning ? 0 : c.steer;

    // the tow: tucked in behind someone you go faster, and they get a shove
    c.tow = 0;
    let shove = 0;
    for (const o of this.cars) {
      if (o === c || Math.abs(o.d - c.d) > (s.width + o.stats.width) * 0.6) continue;
      const gap = track.gap(o.dist, c.dist);
      if (gap > s.length * 0.8 && gap < TOW_RANGE) c.tow = Math.max(c.tow, TOW * (1 - gap / TOW_RANGE));
      else if (gap < -s.length * 0.8 && gap > -10) shove = SHOVE;
    }
    const top = TOP * s.top * c.spec.skill * (1 + c.tow + shove);
    let a = ACCEL * s.accel * (throttle - c.v / top); // settles at throttle × top speed
    if (a < 0) a *= 0.25; // lifting off slows you gently
    a -= c.brake * BRAKE;
    if (spinning) a = -(4 + c.v * 0.6); // a spin scrubs off speed fast
    c.v = Math.max(0, c.v + a * TICK);

    // the turns: more speed than the banking holds pushes you up the track and scrubs speed
    const need = k ? (c.v * c.v * k) / (1 + k * c.d) : 0;
    const extra = Math.max(0, need - GRIP * s.grip);
    c.slide = extra * SLIDE;
    c.v = Math.max(0, c.v - extra * SCRUB * TICK);

    // steering moves you across the track, quicker the faster you go
    const reach = 3 + 0.12 * c.v;
    c.vd += (steer * reach - c.vd) * Math.min(1, (spinning ? 1 : 8) * TICK);
    c.v = Math.max(0, c.v - Math.abs(c.vd) * 0.03 * TICK);
    c.d += (c.vd + c.slide) * TICK;

    // the spin: a spin-out goes round and round; a knock just twitches the car, then it straightens up
    c.spin += c.spinRate * TICK;
    if (spinning) {
      c.spinning -= TICK;
      c.spinRate *= 1 - 1.2 * TICK;
    } else {
      c.spinRate *= 1 - 6 * TICK;
      const straight = Math.round(c.spin / (2 * Math.PI)) * 2 * Math.PI;
      c.spin += (straight - c.spin) * Math.min(1, 4 * TICK);
    }

    this.walls(c, ev);

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

  // The outside wall bounces you back down, costs speed, and a big enough hit spins you round.
  // The inside edge is softer: the apron below it is out of bounds, so you're nudged back up.
  private walls(c: Car, ev: RaceEvents) {
    const edge = this.track.width / 2 - c.stats.width / 2;
    c.scraping = false;
    if (c.d > edge) {
      const hit = c.vd + c.slide;
      c.d = edge;
      if (hit > 1.5) {
        c.vd = -hit * BOUNCE - 1;
        c.v = Math.max(0, c.v - Math.min(c.v * 0.35, hit * 1.6));
        c.spinRate -= hit * 0.06; // the nose kicks away from the wall
        if (hit > SPIN_WALL) this.spinOut(c, -1, ev);
        if (c.bumped > 0.3) ev.wall.push({ car: c, strength: hit, d: 1 });
        c.bumped = 0;
      } else {
        c.vd = Math.min(c.vd, 0);
        c.scraping = c.v > 15;
        c.v = Math.max(0, c.v - 3 * TICK); // grinding along it
      }
    } else if (c.d < -edge) {
      c.d = -edge;
      c.vd = Math.max(c.vd, 0) + 0.5;
    }
  }

  private spinOut(c: Car, dir: number, ev: RaceEvents) {
    if (c.spinning > 0) return;
    c.spinning = 1.4;
    c.spinRate = dir * (5 + Math.random() * 2);
    ev.spun.push(c);
  }

  // Cars hit like objects with weight: nose to tail passes speed forward (a bump draft, or a
  // punt), side to side bats them apart. A hard enough hit spins the one that came off worse.
  private collide(ev: RaceEvents) {
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        const ds = this.track.gap(a.dist, b.dist), dd = a.d - b.d;
        const along = (a.stats.length + b.stats.length) / 2 - Math.abs(ds);
        const across = (a.stats.width + b.stats.width) / 2 - Math.abs(dd);
        if (along <= 0 || across <= 0) continue;
        const ma = a.stats.weight, mb = b.stats.weight, share = 1 / (1 / ma + 1 / mb);
        let strength = 0;
        if (along / (a.stats.length + b.stats.length) < across / (a.stats.width + b.stats.width)) {
          const [front, back] = ds > 0 ? [a, b] : [b, a];
          back.dist -= along;
          const closing = back.v - front.v;
          if (closing > 0) {
            const J = (1 + BOUNCE * 0.5) * closing * share;
            back.v -= J / back.stats.weight;
            front.v += J / front.stats.weight;
            strength = closing;
            // hit off-centre and hard: the front car is turned round
            const off = front.d - back.d;
            if (closing > SPIN_HIT && Math.abs(off) > 0.7) this.spinOut(front, Math.sign(off), ev);
            else front.spinRate += Math.sign(off) * closing * 0.05;
          }
        } else {
          const side = Math.sign(dd) || 1; // a is on this side of b
          a.d += (side * across * mb) / (ma + mb);
          b.d -= (side * across * ma) / (ma + mb);
          const closing = -((a.vd + a.slide) - (b.vd + b.slide)) * side;
          if (closing > 0) {
            const J = (1 + BOUNCE) * closing * share;
            a.vd += (side * J) / ma;
            b.vd -= (side * J) / mb;
            a.spinRate += (side * closing * 0.05) / ma;
            b.spinRate -= (side * closing * 0.05) / mb;
            strength = closing;
            if (closing > SPIN_HIT) { const lighter = ma < mb ? a : b; this.spinOut(lighter, lighter === a ? side : -side, ev); }
          }
          // rubbing evens out their speeds a little
          const rub = (a.v - b.v) * 0.04;
          a.v -= rub;
          b.v += rub;
        }
        if (strength > 1.5) {
          for (const c of [a, b]) {
            if (c.bumped > 0.3) ev.contact.push({ car: c, strength, d: c === a ? -Math.sign(dd) : Math.sign(dd) });
            c.bumped = 0;
          }
        }
      }
    }
  }

  // --- the computer drivers ------------------------------------------------------------------------
  // Run in a lane; catching someone, pull out to whichever side is clear; drift back to the bottom.
  private drive(c: Car) {
    const ahead = this.nearestAhead(c);
    const lanes = this.lanes;
    c.laneWait -= TICK;
    if (c.laneWait <= 0) {
      if (ahead && (ahead.gap < 14 || ahead.car.v < c.v - 1)) {
        const free = lanes.filter((l) => Math.abs(l - c.lane) > 1)
          .sort((x, y) => Math.abs(x - c.d) - Math.abs(y - c.d))
          .find((l) => this.clear(c, l));
        if (free !== undefined) { c.lane = free; c.laneWait = 2 + Math.random() * 2; }
      } else if (c.lane !== lanes[0] && Math.random() < 0.01 && this.clear(c, lanes[0])) {
        c.lane = lanes[0];
        c.laneWait = 3;
      }
    }
    const reach = 3 + 0.12 * c.v;
    c.steer = clamp((c.lane - c.d) * 0.25 - c.vd * 0.05 - c.slide / reach, -1, 1);
    c.brake = 0;
    if (c.finish !== null) c.throttle = 0.45; // the cool-down lap
    else if (ahead && ahead.gap < 12 && ahead.car.v < c.v - 4) c.throttle = 0; // closing fast: back off
    else if (c.slide > 2 && c.d > this.track.width / 2 - 4) c.throttle = 0.5; // sliding up to the wall: lift
    else c.throttle = ahead && ahead.gap < 6 && ahead.car.v < c.v ? 0.6 : 1;
  }

  // The nearest car ahead in this car's line
  private nearestAhead(c: Car) {
    let best: { car: Car; gap: number } | null = null;
    for (const o of this.cars) {
      if (o === c || Math.abs(o.d - c.d) > (c.stats.width + o.stats.width) * 0.65) continue;
      const gap = this.track.gap(o.dist, c.dist);
      if (gap > 0 && gap < 30 && (!best || gap < best.gap)) best = { car: o, gap };
    }
    return best;
  }

  // Room in that lane, from a little behind to a bit ahead
  private clear(c: Car, lane: number) {
    return this.cars.every((o) => {
      if (o === c || Math.abs(o.d - lane) > (c.stats.width + o.stats.width) * 0.75) return true;
      const gap = this.track.gap(o.dist, c.dist);
      return gap < -9 || gap > 18;
    });
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
