// The pit lane: a road alongside the main straight, beside the track on the infield side. In
// before the start/finish line, out after it, with a speed limit and a box for every car in
// between. A car in the pit lane is driven by the lane, not by its driver: it slows to the limit,
// stops at its box while the crew works, and is let back out at the end. Works on anything with a
// place on the track (`dist`, `d`) and a speed, so Superbikes can use it too.
import type { Track } from '../stock-cars/track.ts';

export interface InPit { dist: number; d: number; v: number }

const RAMP = 110; // m of slip road at each end, to slow down to the limit and to get back up to speed
const LIMIT = 25; // m/s in the lane (90 km/h)
const BRAKE = 22; // m/s² slowing in the lane (the limiter does it for you)
const PICKUP = 8; // m/s² getting going again
const OUT_SPEED = 45; // m/s by the end of the exit road

interface Stop { box: number; phase: 'in' | 'box' | 'out'; wait: number; d0: number; released: boolean }

export class PitLane {
  readonly from: number; // m from the line where the lane leaves the track (negative: before it)
  readonly to: number; // ...and where it joins again
  readonly lane: number; // d of the lane's middle
  readonly boxes: number[]; // m from the line of each box
  readonly limit = LIMIT;
  readonly ramp = RAMP;
  private stops = new Map<InPit, Stop>();

  // `before`/`after`: how much straight there is before and after the line; one box per team
  constructor(readonly track: Track, before: number, after: number, teams: number) {
    this.from = -(before - 40);
    this.to = after - 40;
    this.lane = -(track.width / 2 + 7);
    const a = this.from + RAMP + 10, b = this.to - RAMP - 10;
    this.boxes = Array.from({ length: teams }, (_, i) => a + ((b - a) * (i + 0.5)) / teams);
  }

  // How far a car is from the line, either way
  at(dist: number) { return this.track.gap(dist, 0); }

  // Is it at the entry right now (just past where the lane leaves the track)?
  atEntry(dist: number, step: number) {
    const s = this.at(dist);
    return s >= this.from && s < this.from + step + 0.5;
  }

  has(car: InPit) { return this.stops.has(car); }
  get cars() { return [...this.stops.keys()]; }
  waiting(car: InPit) { const s = this.stops.get(car); return s?.phase === 'box' ? s.wait : null; }

  // Into the lane, heading for box `box` (an index), with `work` seconds of work waiting there
  enter(car: InPit, box: number, work: number) {
    this.stops.set(car, { box: this.boxes[box % this.boxes.length], phase: 'in', wait: work, d0: car.d, released: false });
  }

  // One step for every car in the lane. Returns who has just been seen to (their stop is done)
  // and who has reached the end of the exit road (back on the track: the caller takes them back).
  // `clear`: is the track clear to let this car out? (If not, it waits at the end of the lane.)
  step(dt: number, clear: (car: InPit) => boolean = () => true) {
    const serviced: InPit[] = [], left: InPit[] = [];
    for (const [car, stop] of this.stops) {
      const s = this.at(car.dist);
      if (stop.phase === 'box') {
        car.v = 0;
        stop.wait -= dt;
        if (stop.wait <= 0) { stop.phase = 'out'; serviced.push(car); }
      } else if (stop.phase === 'in') {
        // down to the limit by the end of the slip road, and to a stop at the box
        const want = Math.min(Math.sqrt(LIMIT ** 2 + 2 * BRAKE * Math.max(0, this.from + RAMP - s)), Math.sqrt(2 * BRAKE * Math.max(0, stop.box - s)));
        car.v = car.v > want ? Math.max(want, car.v - BRAKE * 1.6 * dt) : Math.min(want, car.v + PICKUP * dt);
        if (s + car.v * dt >= stop.box) { car.dist += stop.box - s; car.v = 0; stop.phase = 'box'; continue; }
      } else {
        const end = this.to - RAMP;
        if (!stop.released && s + car.v * dt >= end) { // the end of the lane: out if the track is clear, or wait
          if (!clear(car)) { car.dist += Math.max(0, end - s); car.v = 0; continue; }
          stop.released = true;
        }
        const want = s < end ? LIMIT : LIMIT + ((OUT_SPEED - LIMIT) * (s - end)) / RAMP;
        car.v = Math.min(want, car.v + PICKUP * dt * (s < this.to - RAMP ? 1 : 2));
      }
      car.dist += car.v * dt;
      car.d = this.side(this.at(car.dist), stop);
      if (stop.phase === 'out' && this.at(car.dist) >= this.to) { this.stops.delete(car); left.push(car); }
    }
    return { serviced, left };
  }

  // Where across the track a car is along the lane: easing over from the track at the entry, back at the exit
  private side(s: number, stop: Stop) {
    const edge = -this.track.width / 2 + 2;
    if (s < this.from + RAMP) return lerp(stop.d0, this.lane, ease((s - this.from) / RAMP));
    if (s > this.to - RAMP) return lerp(this.lane, edge, ease((s - (this.to - RAMP)) / RAMP));
    return this.lane;
  }

  clear() { this.stops.clear(); }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
