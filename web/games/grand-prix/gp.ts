// A Grand Prix: the shared racing (the handling, the tow, contact and the computer drivers, from
// @racing/race.ts, as in Stock Cars) on a road circuit, plus what open-wheel racing adds: every car's condition
// (damage.ts: health, tyres, fuel, fire) and the pit lane (pits.ts). A car in the pit lane, or out
// of the race, is taken off the track (out of Race.cars) so nobody runs into it; `all` keeps the
// whole field, and the standings are worked out here. With weather, the crew fits wets or slicks for
// it, and the pit wall calls a car in when it's on the wrong ones. No graphics.
import { Race, TICK, type Car, type CarSpec, type Hit, type RaceEvents } from '@racing/race.ts';
import type { Track } from '@racing/track.ts';
import { bestTyre, Tyre } from '@racing/tyres.ts';
import type { Weather } from '@world/weather.ts';
import { Condition, RULES, type Out, type PitPlan } from './damage.ts';
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
export enum Call {
  Fire = 'Fire',
  Wets = 'Wets',
  Slicks = 'Slicks',
  Fuel = 'Fuel',
  Tyres = 'Tyres',
  Damage = 'Damage',
}

// When the pit wall calls a car in (other than a fire, which is always): fuel that won't last the
// laps left (with a little margin), tyres this worn, health this low; and not with this few laps to
// go, when a stop costs more than it gains (the wrong tyres by a long way excepted)
const CALL = { fuelMargin: 1.35, worn: 0.62, hurt: 45, lastLaps: 2 };

const CLEARLY = { dry: 0.05, soaked: 0.6 }; // (see clearlyWrong)
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
  readonly plans = new Map<Car, PitPlan>(); // what the crew will do for each car in the pit lane
  private locked = new Set<Car>(); // ...settled once it stops in its box
  private held = new Map<Car, number>(); // seconds waiting at the pit exit

  // `straight`: the front straight either side of the line, for the pit lane; `damage`: off for the
  // race behind the menu, so it never runs out of cars; `weather`: none for a dry race
  constructor(readonly track: Track, specs: CarSpec[], laps: number, straight: { before: number; after: number }, damage = true,
    readonly weather: Weather | null = null) {
    this.race = new Race(track, specs, laps);
    this.race.weather = weather;
    this.all = [...this.race.cars];
    for (const c of this.all) {
      this.cond.set(c, new Condition(!damage, bestTyre(weather, 0, Tyre.Slick)));
      this.base.set(c, { top: c.stats.top, accel: c.stats.accel, grip: c.stats.grip });
      this.stopped.set(c, 0);
      c.tyre = this.cond.get(c)!.tyre;
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
    if (k.burning) return Call.Fire;
    const left = this.race.laps - c.laps; // (this one included)
    if (left <= 1) return null;
    const worthIt = left > CALL.lastLaps;
    const want = bestTyre(this.weather, this.t, k.tyre);
    if (want !== k.tyre && (worthIt || this.clearlyWrong(k.tyre))) return want === Tyre.Wet ? Call.Wets : Call.Slicks;
    if (k.fuel < Math.min(left, CALL.fuelMargin)) return Call.Fuel;
    if (worthIt && k.tyres > CALL.worn) return Call.Tyres;
    if (worthIt && k.health < CALL.hurt) return Call.Damage;
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
      c.tyre = k.tyre;
    }
    // the computer drivers decide when to box, and line up on the left for the entry
    for (const c of race.cars) {
      if (!green || !c.spec.ai) continue;
      if (this.call(c)) this.boxCall.add(c);
      const toEntry = this.toPitEntry(c);
      if (this.boxCall.has(c) && toEntry > 0 && toEntry < 350) { c.lane = -W / 2 + 2.5; c.laneWait = 0.5; }
    }

    const was = new Map(this.all.map((c) => [c, c.dist]));
    const ev: GPEvents = { ...race.step(green), hurt: [], fire: [], out: [], pitIn: [], pitDone: [], pitOut: [] };

    // wear for the distance run; hits
    for (const c of race.cars) {
      if (c.finish !== null) continue; // (the cool-down lap doesn't count)
      const out = this.cond.get(c)!.run(TICK, green ? (c.dist - was.get(c)!) / L : 0, Math.abs(c.slide) + Math.abs(c.knock) * 0.5, this.weather?.wet ?? 0);
      if (out) this.retire(c, ev);
    }
    // (a barrier taken at speed is the worst: the hit is scaled up by how fast the car was going)
    for (const h of ev.wall) this.hit(h, h.strength * (0.7 + 0.5 * Math.min(1, h.car.v / 70)), true, ev);
    for (const h of ev.contact) this.hit(h, h.strength, false, ev);

    // into the pit lane: asked to box, at the entry, and over on the left
    for (const c of [...race.cars]) {
      if (!green || !this.boxCall.has(c) || c.finish !== null || c.d > 0 || !this.pits.atEntry(c.dist, c.v * TICK)) continue;
      const k = this.cond.get(c)!;
      this.plans.set(c, k.suggest(this.race.laps - c.laps, bestTyre(this.weather, this.t, k.tyre)));
      this.locked.delete(c);
      this.off(c);
      this.pits.enter(c, this.all.indexOf(c));
      this.boxCall.delete(c);
      ev.pitIn.push(c);
    }

    // the pit lane, and the laps counted for those in it (the line runs through it)
    const { serviced, arrived, left } = this.pits.step(TICK, (c) => this.clearToLeave(c as Car));
    for (const c of arrived as Car[]) {
      this.locked.add(c);
      this.pits.work(c, this.cond.get(c)!.time(this.plans.get(c)!));
    }
    for (const c of this.pits.cars as Car[]) this.lapCheck(c, was.get(c)!, green, ev);
    for (const c of serviced as Car[]) {
      this.cond.get(c)!.service(this.plans.get(c)!);
      c.tyre = this.cond.get(c)!.tyre;
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

  // Metres to the pit entry from here (it's on the left of the main straight)
  toPitEntry(c: Car) { return this.track.gap(this.pits.from, this.pits.at(c.dist)); }

  // The plan for a car on its way down the pit lane, while it can still be changed (null once it's
  // stopped in its box and the crew has started)
  openPlan(c: Car) { return this.locked.has(c) ? null : this.plans.get(c) ?? null; }

  // The choices at a stop, for this car: which tyres (null: keep them), and how much fuel
  tyreChoices(): (Tyre | null)[] { return this.weather ? [null, Tyre.Slick, Tyre.Wet] : [null, Tyre.Slick]; }
  fuelChoices(c: Car) {
    const k = this.cond.get(c)!, finish = Math.max(0, k.toFinish(this.race.laps - c.laps) - k.fuel);
    const laps = Array.from({ length: Math.floor(k.room) + 1 }, (_, i) => i);
    return [...new Set([...laps, Math.round(finish * 10) / 10])].filter((f) => f <= k.room + 1e-6).sort((a, b) => a - b);
  }
  // fuel that gets it to the flag
  fuelToFinish(c: Car) { const k = this.cond.get(c)!; return Math.max(0, k.toFinish(this.race.laps - c.laps) - k.fuel); }

  // On the wrong tyres by a long way: worth a stop even near the end (slicks on a soaked road, wets
  // on a dry one)
  private clearlyWrong(on: Tyre) {
    const wet = this.weather?.wet ?? 0;
    return on === Tyre.Wet ? wet < CLEARLY.dry : wet > CLEARLY.soaked;
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
