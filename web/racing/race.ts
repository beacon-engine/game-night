// The race: cars on the track, the tow, contact, laps, and the computer drivers. No graphics.
// A car lives in track terms (track.ts): how far it has gone (`dist`, counting laps), how far out
// from the centre line (`d`), and its speeds along and across the track. That keeps the handling
// simple to tune and the computer drivers simple to write: pick a lane, hold it, pull out to pass.
import type { Track } from './track.ts';
import type { Weather } from '@world/weather.ts';
import { Tyre, tyreGrip } from './tyres.ts';

export const TICK = 1 / 60;
export const TOP = 84; // m/s flat out on your own in a Stocker: about 188 mph
const ACCEL = 16;
const BRAKE = 26;
const GRIP = 34; // m/s² of cornering the tyres hold on the flat...
const BANK_GRIP = 45; // ...plus this much per unit of banking slope; beyond it the car slides to the outside
const SLIDE = 0.45; // how fast the extra pushes it out...
const SLIDE_MAX = 6; // ...at most (m/s)
const SLIDE_BUILD = 3; // and how quickly a slide builds up and dies away (per second): never all at once
const SCRUB = 0.1; // ...and the speed that costs
const TOW = 0.07; // up to 7% more top speed in another car's slipstream
const TOW_RANGE = 45; // m
const SHOVE = 0.015; // a car right behind pushes the one in front along a little
const BOUNCE = 0.5; // how much of a hit comes back off the wall
const BOUNCE_CARS = 0.4; // ...and off another car, side to side
const KNOCK_MAX = 6; // m/s: the most a hit can throw a car sideways
const BOUNCE_BUMP = 0.45; // ...and nose to tail
const KNOCK_FADE = 2.5; // how quickly a knock sideways dies away (the driver can't just steer it out)
const SCRAPE = 9; // m/s² lost grinding along a wall
const APRON = 7; // m/s² lost with your wheels down on the apron
const SPIN_WALL = 11; // m/s into the wall that spins you round
const SPIN_HIT = 12; // m/s of closing speed in a hit that spins the lighter car

// What a car is like (cars.json), compared with the Stocker; length and width in metres
export interface CarStats { top: number; accel: number; grip: number; weight: number; length: number; width: number }

export interface CarSpec {
  id: string;
  name: string;
  color: string; // the player's colour (the tower, the results)
  paint?: string; // the car's paint, when it isn't that colour
  number: number;
  ai: boolean;
  skill: number; // the computer drivers' pace, as a share of the car's best (people drive at 1)
  car: CarStats & { id: string; name: string; model: string };
}

export class Car {
  dist = 0; // m from the line, since the start (negative on the grid)
  d = 0; // m out from the centre line
  v = 0; // m/s along the track
  vd = 0; // m/s across it, from steering
  knock = 0; // m/s across it, from hitting a wall or another car (fades on its own)
  slide = 0; // m/s toward the outside of the turn, from going in faster than it holds
  throttle = 0; // 0..1
  brake = 0; // 0..1
  steer = 0; // -1 (down the track) .. 1 (up)
  tow = 0; // the slipstream it's in right now
  spin = 0; // rad: knocked sideways, or spinning round
  spinRate = 0;
  spinning = 0; // seconds of a spin-out left
  scraping = 0; // along a wall right now: 1 on the right, -1 on the left
  laps = 0;
  lapStart = 0;
  lastLap = 0;
  bestLap = 0;
  finish: number | null = null; // race time when it took the chequered flag
  bumped = 0; // seconds since the last contact (for buzzing phones once, not every tick)
  tyre = Tyre.Slick;
  lane = 0; // the computer driver: the lane it's heading for
  laneWait = 0;

  constructor(readonly spec: CarSpec) {}

  get id() { return this.spec.id; }
  get stats() { return this.spec.car; }
  // which way it points, relative to the track
  get yaw() { return Math.atan2(this.drift, Math.max(this.v, 1)) + this.spin; }
  // all the ways it's moving across the track
  get drift() { return this.vd + this.knock + this.slide; }
}

export interface Hit { car: Car; strength: number; d: number } // d: which side of the car, for the sparks
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
  weather: Weather | null = null; // none: dry all race
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
    this.weather?.step(this.t, TICK);
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
    a -= c.brake * BRAKE * this.traction(c);
    if (spinning) a = -(4 + c.v * 0.6); // a spin scrubs off speed fast
    c.v = Math.max(0, c.v + a * TICK);

    // the turns: more speed than the tyres and banking hold pushes you to the outside and scrubs
    // speed. A lane further out is a wider turn, and on an oval it's banked steeper.
    const kd = k / (1 + k * c.d), dir = Math.sign(k);
    const extra = Math.max(0, c.v * c.v * Math.abs(kd) - this.grip(c, c.dist, c.d, dir));
    // (it builds over a moment, and has a limit: far too fast into a tight turn used to fling the car
    // across the track in one tick)
    const slide = Math.min(SLIDE_MAX, extra * SLIDE) * dir;
    c.slide += (slide - c.slide) * Math.min(1, SLIDE_BUILD * TICK);
    c.v = Math.max(0, c.v - extra * SCRUB * TICK);

    // steering moves you across the track, quicker the faster you go
    const reach = 3 + 0.12 * c.v;
    c.vd += (steer * reach - c.vd) * Math.min(1, (spinning ? 1 : 8) * TICK);
    c.v = Math.max(0, c.v - Math.abs(c.vd) * 0.03 * TICK);
    c.knock = clamp(c.knock, -KNOCK_MAX, KNOCK_MAX) * Math.max(0, 1 - KNOCK_FADE * TICK);
    c.d += c.drift * TICK;

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

    const lapsBefore = Math.floor(c.dist / L);
    c.dist += (c.v / (1 + k * c.d)) * TICK; // (a lane further out is a longer way round)
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

  // How much cornering this car can hold here (m/s²): its tyres, plus the banking when it leans
  // the right way for the turn
  private grip(c: Car, dist: number, d: number, dir: number) {
    return c.stats.grip * tyreGrip(c.tyre, this.weather) * (GRIP + BANK_GRIP * this.track.slope(dist, d) * dir);
  }

  // How much of its braking it has: in the wet the tyres lock sooner, so it takes longer to stop
  private traction(c: Car) {
    return 0.35 + 0.65 * tyreGrip(c.tyre, this.weather);
  }

  // The walls bounce you back, cost speed, and a big enough hit spins you round; grinding along one
  // costs speed too. On an oval the inside edge is softer: the apron below it is out of bounds, so
  // you're nudged back up, and it's slow down there. A road course has walls both sides.
  private walls(c: Car, ev: RaceEvents) {
    const edge = this.track.width / 2 - c.stats.width / 2;
    c.scraping = 0;
    if (c.d > edge) this.wall(c, ev, 1, edge);
    else if (c.d < -edge) {
      if (this.track.road) this.wall(c, ev, -1, edge);
      else {
        c.d = -edge;
        c.vd = Math.max(c.vd, 0) + 0.5;
        c.knock = Math.max(c.knock, 0);
        c.v = Math.max(0, c.v - APRON * TICK);
      }
    }
  }

  // Steering or being knocked into the wall hits it; sliding out into it in a turn grinds along it
  private wall(c: Car, ev: RaceEvents, side: number, edge: number) {
    const hit = (c.vd + c.knock) * side; // how fast it's going into the wall
    c.d = edge * side;
    if (c.slide * side > 0) c.slide = 0;
    if (hit > 1.5) {
      c.knock = -side * Math.min(KNOCK_MAX, hit * BOUNCE + 0.5);
      c.vd = 0;
      c.v = Math.max(0, c.v - Math.min(c.v * 0.45, hit * 2.2));
      c.spinRate -= side * hit * 0.09; // the nose kicks away from the wall
      if (hit > SPIN_WALL) this.spinOut(c, -side, ev);
      if (c.bumped > 0.3) ev.wall.push({ car: c, strength: hit, d: side });
      c.bumped = 0;
    } else {
      if (c.vd * side > 0) c.vd = 0;
      if (c.knock * side > 0) c.knock = 0;
      c.scraping = c.v > 15 ? side : 0;
      c.v = Math.max(0, c.v - SCRAPE * TICK); // grinding along it
      c.spinRate -= side * 0.4 * TICK * Math.min(1, c.v / 30); // and it drags the nose round
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
            const J = (1 + BOUNCE_BUMP) * closing * share;
            back.v -= J / back.stats.weight;
            front.v += J / front.stats.weight;
            strength = closing;
            // hit off-centre: the front car is knocked sideways and turned, the back one the other way;
            // hard enough, the front car is turned round
            const off = front.d - back.d, push = Math.sign(off) * closing * Math.min(1, Math.abs(off) / 1.2) * 0.2;
            front.knock += push / front.stats.weight;
            back.knock -= (push * 0.5) / back.stats.weight;
            if (closing > SPIN_HIT && Math.abs(off) > 0.7) this.spinOut(front, Math.sign(off), ev);
            else front.spinRate += Math.sign(off) * closing * 0.07;
          }
        } else {
          const side = Math.sign(dd) || 1; // a is on this side of b
          a.d += (side * across * mb) / (ma + mb);
          b.d -= (side * across * ma) / (ma + mb);
          const closing = -(a.drift - b.drift) * side;
          if (closing > 0) {
            // the bounce goes into the knock, which the drivers can't steer away at once
            const J = (1 + BOUNCE_CARS) * closing * share;
            a.knock += (side * J) / ma;
            b.knock -= (side * J) / mb;
            a.spinRate += (side * closing * 0.08) / ma;
            b.spinRate -= (side * closing * 0.08) / mb;
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
  // Run in a lane: on an oval, drift back to the bottom; on a road course, the racing line (out
  // wide, into the inside of the turn, out wide again). Catching someone, pull out to whichever
  // side is clear, and keep looking until there's room. Brake for what they can't take flat.
  private drive(c: Car) {
    const ahead = this.nearestAhead(c);
    const lanes = this.lanes, road = this.track.road;
    const home = road ? this.racingLine(c) : lanes[0];
    c.laneWait -= TICK;
    if (c.laneWait <= 0) {
      if (ahead && (ahead.gap < 14 || ahead.car.v < c.v - 1)) {
        const free = lanes.filter((l) => Math.abs(l - c.lane) > 1)
          .sort((x, y) => Math.abs(x - c.d) - Math.abs(y - c.d))
          .find((l) => this.clear(c, l));
        if (free !== undefined) { c.lane = free; c.laneWait = (road ? 1 : 2) + Math.random() * 2; }
        else c.laneWait = 0.3; // boxed in: look again in a moment
      } else if (Math.abs(c.lane - home) > 0.5 && (road || Math.random() < 0.01) && this.clear(c, home)) {
        c.lane = home;
        c.laneWait = road ? 0 : 3;
      }
    }
    const reach = 3 + 0.12 * c.v;
    // (changing lanes, they ease across: two-thirds lock at most, so they don't dart; more only to
    // catch a slide)
    const ease = Math.abs(c.slide) > 1 ? 1 : 0.65;
    c.steer = clamp((c.lane - c.d) * 0.25 - c.vd * 0.05 - c.slide / reach, -ease, ease);
    const target = this.cornerSpeed(c);
    c.brake = 0;
    if (c.finish !== null) c.throttle = 0.45; // the cool-down lap
    else if (c.v > target + 1) { c.throttle = 0; c.brake = Math.min(1, (c.v - target) / 4); } // a turn coming
    else if (c.v > target - 1) c.throttle = 0.6;
    else if (ahead && ahead.gap < 12 && ahead.car.v < c.v - 4) c.throttle = 0; // closing fast: back off
    else if (Math.abs(c.slide) > 2 && c.d * Math.sign(c.slide) > this.track.width / 2 - 4) c.throttle = 0.5; // sliding out to the wall: lift
    else c.throttle = ahead && ahead.gap < 6 && ahead.car.v < c.v ? 0.6 : 1;
  }

  // Where a road course's racing line is, for this car, now
  private racingLine(c: Car) {
    const wide = this.track.width / 2 - 2.5;
    const next = this.track.turnAhead(c.dist, 140);
    if (!next) return 0;
    const { turn, dist } = next;
    if (dist > 0) return turn.dir * wide * 0.8; // setting up on the outside
    const t = (this.track.wrap(c.dist) - turn.s0) / (turn.s1 - turn.s0);
    if (t < 0.5) return -turn.dir * wide; // to the apex
    return -turn.dir * wide + (t - 0.5) * 2 * turn.dir * wide * 1.8; // and out wide again
  }

  // The most it can carry right now and still slow down in time for every bit of the next 150 m
  private cornerSpeed(c: Car) {
    let best = Infinity;
    for (let x = 0; x <= 150; x += 10) {
      const s = c.dist + x, k = this.track.at(s).k;
      if (!k) continue;
      const kd = Math.abs(k / (1 + k * c.lane));
      const v = Math.sqrt((this.grip(c, s, c.lane, Math.sign(k)) * 0.96) / kd);
      best = Math.min(best, Math.sqrt(v * v + 2 * BRAKE * this.traction(c) * 0.8 * x));
    }
    return best;
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
