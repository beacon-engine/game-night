// A Grand Prix: Stock Cars' racing (the handling, the tow, contact and the computer drivers, from
// ../stock-cars/race.ts) on a road circuit, plus what open-wheel racing adds: every car's condition
// (damage.ts: health, tyres, fuel, fire) and the pit lane (pits.ts). A car in the pit lane, or out
// of the race, is taken off the track (out of Race.cars) so nobody runs into it; `all` keeps the
// whole field, and the standings are worked out here. No graphics.
import { Race, TICK, type Car, type CarSpec, type Hit, type RaceEvents } from '../stock-cars/race.ts';
import type { Track } from '../stock-cars/track.ts';
import { Condition, RULES, type Out, type Service } from './damage.ts';
import { PitLane } from './pits.ts';

export interface GPEvents extends RaceEvents {
  hurt: { car: Car; damage: number }[]; // health lost in a hit
  fire: Car[]; // caught fire
  out: Car[]; // out of the race (crashed out, burnt out, ran dry)
  pitIn: Car[];
  pitDone: Car[]; // the crew has finished
  pitOut: Car[]; // back on the track
}

// Why a car should box this lap, if it should
export type Call = 'Fire' | 'Fuel' | 'Tyres' | 'Damage';

const EXIT_CHECK = 280; // m before the pit exit that has to be clear of cars to come out
const EXIT_WAIT = 4; // s at most, waiting for a gap

export class GrandPrix {
  readonly race: Race;
  readonly all: Car[]; // the whole field, in grid order
  readonly cond = new Map<Car, Condition>();
  readonly pits: PitLane;
  readonly boxCall = new Set<Car>(); // asked to box this lap (people with L1; the computer drivers on their own)
  readonly outAt = new Map<Car, number>(); // when each car went out of the race
  readonly stopped = new Map<Car, number>(); // pit stops made
  private base = new Map<Car, { top: number; accel: number; grip: number }>();
  private service = new Map<Car, Service>();
  private held = new Map<Car, number>(); // seconds waiting at the pit exit

  // `straight`: the front straight either side of the line, for the pit lane; `damage`: off for the
  // race behind the menu, so it never runs out of cars
  constructor(readonly track: Track, specs: CarSpec[], laps: number, straight: { before: number; after: number }, damage = true) {
    this.race = new Race(track, specs, laps);
    this.all = [...this.race.cars];
    for (const c of this.all) {
      this.cond.set(c, new Condition(!damage));
      this.base.set(c, { top: c.stats.top, accel: c.stats.accel, grip: c.stats.grip });
      this.stopped.set(c, 0);
    }
    this.pits = new PitLane(track, straight.before, straight.after, Math.max(12, this.all.length)); // (a box for a full grid, always)
  }

  get t() { return this.race.t; }
  get laps() { return this.race.laps; }
  on(c: Car) { return this.race.cars.includes(c); } // on the track (not in the pits, not out)
  inPits(c: Car) { return this.pits.has(c); }
  isOut(c: Car) { return this.outAt.has(c); }

  // Finishers in the order they finished; then everyone still going, by how far they've got;
  // then whoever went out, the furthest first
  standings() {
    const rank = (c: Car) => (c.finish !== null ? 0 : this.isOut(c) ? 2 : 1);
    return [...this.all].sort((a, b) => rank(a) - rank(b) || (a.finish ?? 0) - (b.finish ?? 0) || b.dist - a.dist);
  }

  // Should this car come in this lap? A fire, always; otherwise not on the last lap, and only for
  // fuel it can't finish on, tyres that are going off, or damage that's slowing it down
  call(c: Car): Call | null {
    const k = this.cond.get(c)!;
    if (k.out || c.finish !== null) return null;
    if (k.burning) return 'Fire';
    const left = this.race.laps - c.laps; // (this one included)
    if (left <= 1) return null;
    if (k.fuel < Math.min(left, 1.35)) return 'Fuel';
    if (k.tyres > 0.62 && left > 2) return 'Tyres';
    if (k.health < 45 && left > 2) return 'Damage';
    return null;
  }

  step(green: boolean): GPEvents {
    const race = this.race, L = this.track.length, W = this.track.width;
    // what each car can do now: worn tyres grip less, damage costs pace, an empty tank coasts
    for (const c of race.cars) {
      const k = this.cond.get(c)!, b = this.base.get(c)!;
      c.spec.car.grip = b.grip * k.grip;
      c.spec.car.top = b.top * k.pace;
      c.spec.car.accel = k.empty ? b.accel * RULES.dryPace : b.accel;
    }
    // the computer drivers decide when to box, and line up on the left for the entry
    for (const c of race.cars) {
      if (!green || !c.spec.ai) continue;
      if (this.call(c)) this.boxCall.add(c);
      const toEntry = this.track.gap(this.pits.from, this.pits.at(c.dist));
      if (this.boxCall.has(c) && toEntry > 0 && toEntry < 350) { c.lane = -W / 2 + 2.5; c.laneWait = 0.5; }
    }

    const was = new Map(this.all.map((c) => [c, c.dist]));
    const ev: GPEvents = { ...race.step(green), hurt: [], fire: [], out: [], pitIn: [], pitDone: [], pitOut: [] };

    // wear for the distance run; hits
    for (const c of race.cars) {
      if (c.finish !== null) continue; // (the cool-down lap doesn't count)
      const out = this.cond.get(c)!.run(TICK, green ? (c.dist - was.get(c)!) / L : 0, Math.abs(c.slide) + Math.abs(c.knock) * 0.5);
      if (out) this.retire(c, ev);
    }
    // (a barrier taken at speed is the worst: the hit is scaled up by how fast the car was going)
    for (const h of ev.wall) this.hit(h, h.strength * (0.7 + 0.5 * Math.min(1, h.car.v / 70)), true, ev);
    for (const h of ev.contact) this.hit(h, h.strength, false, ev);

    // into the pit lane: asked to box, at the entry, and over on the left
    for (const c of [...race.cars]) {
      if (!green || !this.boxCall.has(c) || c.finish !== null || c.d > 0 || !this.pits.atEntry(c.dist, c.v * TICK)) continue;
      const k = this.cond.get(c)!, plan = k.plan(this.race.laps - c.laps);
      this.service.set(c, plan);
      this.off(c);
      this.pits.enter(c, this.all.indexOf(c), plan.time);
      this.boxCall.delete(c);
      ev.pitIn.push(c);
    }

    // the pit lane, and the laps counted for those in it (the line runs through it)
    const { serviced, left } = this.pits.step(TICK, (c) => this.clearToLeave(c as Car));
    for (const c of this.pits.cars as Car[]) this.lapCheck(c, was.get(c)!, green, ev);
    for (const c of serviced as Car[]) {
      this.cond.get(c)!.service(this.service.get(c)!);
      this.stopped.set(c, this.stopped.get(c)! + 1);
      ev.pitDone.push(c);
    }
    for (const c of left as Car[]) {
      this.lapCheck(c, was.get(c)!, green, ev);
      c.vd = c.knock = c.slide = c.spin = c.spinRate = 0;
      c.lane = c.d;
      c.laneWait = 1;
      race.cars.push(c);
      this.held.delete(c);
      ev.pitOut.push(c);
    }

    // ran dry out on the track and rolled to a stop
    for (const c of [...race.cars]) {
      const k = this.cond.get(c)!;
      if (green && k.empty && c.v < 3 && c.finish === null && k.stranded()) this.retire(c, ev);
    }
    return ev;
  }

  private hit(h: Hit, strength: number, wall: boolean, ev: GPEvents) {
    const k = this.cond.get(h.car)!;
    if (k.out || h.car.finish !== null) return;
    const r = k.hit(strength, wall);
    if (r.damage > 0) ev.hurt.push({ car: h.car, damage: r.damage });
    if (r.fire) ev.fire.push(h.car);
    if (r.wrecked) this.retire(h.car, ev);
  }

  // Out of the race: off the track, parked behind the barrier
  private retire(c: Car, ev: GPEvents) {
    if (this.outAt.has(c)) return;
    this.outAt.set(c, this.race.t);
    this.off(c);
    this.boxCall.delete(c);
    c.d = (c.d < 0 ? -1 : 1) * (this.track.width / 2 + 4);
    c.v = c.throttle = c.vd = c.knock = c.slide = c.spinRate = c.spinning = 0;
    ev.out.push(c);
  }

  private off(c: Car) {
    const i = this.race.cars.indexOf(c);
    if (i >= 0) this.race.cars.splice(i, 1);
  }

  // Nothing coming down the left side of the straight toward the pit exit (or it's waited long enough)
  private clearToLeave(c: Car) {
    const t = (this.held.get(c) ?? 0) + TICK;
    this.held.set(c, t);
    if (t > EXIT_WAIT) return true;
    const exit = this.pits.to;
    return this.race.cars.every((o) => {
      const s = this.pits.at(o.dist);
      return o.d > 2 || s < exit - EXIT_CHECK || s > exit + 15;
    });
  }

  // A car crossing the line in the pit lane: the same lap counting as on the track (race.ts)
  private lapCheck(c: Car, before: number, green: boolean, ev: GPEvents) {
    const L = this.track.length, lapsBefore = Math.floor(before / L);
    if (!green || c.finish !== null || lapsBefore < 0 || Math.floor(c.dist / L) <= lapsBefore || ev.lap.includes(c)) return;
    const t = this.race.t;
    c.laps++;
    c.lastLap = t - c.lapStart;
    c.bestLap = c.bestLap ? Math.min(c.bestLap, c.lastLap) : c.lastLap;
    c.lapStart = t;
    ev.lap.push(c);
    if (c.laps >= this.race.laps) { c.finish = t; ev.finished.push(c); }
  }
}

export type { Out };
