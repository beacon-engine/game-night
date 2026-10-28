// Wear and tear, for any racing game (Grand Prix now, Superbikes next): a car's health, its tyres,
// its fuel, fire, and how it ends up out of the race. No graphics and no race rules here: the game
// tells it about hits, distance and sliding, and reads back what the car can still do (grip, pace)
// and what just happened (caught fire, wrecked, burnt out, ran dry). The pit crew's side is
// suggest(), time() and service(): what a stop would do, how long it takes, and doing it. Which tyres (slicks or wets) suit the weather is
// the weather's to say (racing/weather.ts); the crew fits what it's asked for.
import { Tyre } from '@racing/tyres.ts';

export type Out = 'wrecked' | 'fire' | 'fuel';

export const RULES = {
  // hits, by how hard (m/s of closing speed, or of speed into the barrier)
  safe: 3, // below this, nothing but paint
  damage: { car: 2, wall: 3.5 }, // health lost per m/s above `safe`
  fireFrom: { car: 11, wall: 9 }, // from here, a chance of fire...
  fireChance: 0.05, // ...that rises this much per m/s above it...
  fireMax: 0.5, // ...up to this
  wreckFrom: { car: 24, wall: 17 }, // from here, a chance of the car being wrecked outright...
  wreckChance: 0.12, // ...rising this much per m/s...
  wreckMax: 0.9, // ...up to this
  burn: 2.5, // health per second while on fire
  // wear
  tyreWear: 0.08, // tyre wear per lap (1 = worn out)...
  slideWear: 0.002, // ...plus this per m/s of sliding, per second
  tyreGrip: 0.35, // grip lost on fully worn tyres
  freshTyres: 0.12, // the crew changes tyres worn more than this
  wetsInDry: 3, // wets wear this many times faster on a dry road (they overheat without water to cool them)
  carWear: 1.5, // health lost per lap just from racing
  hurt: 60, // below this much health the car loses pace...
  hurtPace: 0.12, // ...up to this much at none left
  tank: 7, // laps of fuel in a full tank
  dryPace: 0.05, // what's left of the engine with the tank empty: the car coasts
  // the pit crew
  stop: 1.5, // s to stop, jack up and go
  tyres: 2.5, // s for four new tyres
  perLap: 0.35, // s per lap of fuel put in
  repair: 0.05, // s per point of health mended
  putOut: 1.5, // s to put a fire out
};

export interface HitResult { damage: number; fire: boolean; wrecked: boolean }

export class Condition {
  health = 100;
  tyres = 0; // wear, 0 (new) .. 1 (worn out)
  tyre = Tyre.Slick; // which kind are on
  fuel = RULES.tank; // laps' worth
  burning = false;
  out: Out | null = null;

  constructor(private immortal = false, tyre = Tyre.Slick) { this.tyre = tyre; } // (immortal: the race behind the menu: knocks, but nobody retires)

  // A hit with this force; `wall`: into the barrier (worse than another car). `rnd` gives 0..1.
  hit(strength: number, wall: boolean, rnd: () => number = Math.random): HitResult {
    const r: HitResult = { damage: 0, fire: false, wrecked: false };
    if (this.out || strength <= RULES.safe) return r;
    const kind = wall ? 'wall' : 'car';
    r.damage = (strength - RULES.safe) * RULES.damage[kind];
    this.health = Math.max(0, this.health - r.damage);
    const wreck = Math.min(RULES.wreckMax, (strength - RULES.wreckFrom[kind]) * RULES.wreckChance);
    const fire = Math.min(RULES.fireMax, (strength - RULES.fireFrom[kind]) * RULES.fireChance);
    if (!this.immortal && (wreck > 0 && rnd() < wreck || this.health <= 0)) { r.wrecked = true; this.retire('wrecked'); return r; }
    if (!this.burning && fire > 0 && rnd() < fire) { this.burning = r.fire = true; }
    if (this.immortal) this.health = Math.max(this.health, 20);
    return r;
  }

  // Time passing: `laps` of distance covered, `slide` m/s of sliding, on a road this `wet` (0..1).
  // Returns how it went out, if it did.
  run(dt: number, laps: number, slide: number, wet = 0): Out | null {
    if (this.out) return null;
    const cook = this.tyre === Tyre.Wet ? 1 + (RULES.wetsInDry - 1) * Math.max(0, 1 - wet / 0.3) : 1;
    this.tyres = Math.min(1, this.tyres + (laps * RULES.tyreWear + slide * RULES.slideWear * dt) * cook);
    this.fuel = Math.max(0, this.fuel - laps);
    this.health = Math.max(this.immortal ? 20 : 0, this.health - laps * RULES.carWear - (this.burning ? RULES.burn * dt : 0));
    if (this.immortal) { if (this.fuel < 0.5) this.fuel = RULES.tank; return null; }
    if (this.health <= 0) return this.retire(this.burning ? 'fire' : 'wrecked');
    return null;
  }

  // Ran dry and rolled to a stop somewhere it can't be refuelled
  stranded() {
    return this.out ? null : this.retire('fuel');
  }

  retire(why: Out) {
    this.out = why;
    this.burning = why === 'fire' || (this.burning && why === 'wrecked');
    return why;
  }

  get empty() { return this.fuel <= 0; }

  // What the car can still do, compared with new: its grip and its pace (top speed)
  get grip() { return 1 - RULES.tyreGrip * this.tyres; }
  get pace() {
    if (this.empty) return RULES.dryPace;
    const hurt = Math.max(0, RULES.hurt - this.health) / RULES.hurt;
    return 1 - RULES.hurtPace * hurt - (this.burning ? 0.05 : 0);
  }

  // A pit stop: what the crew would do for this many laps still to run, with these tyres wanted for
  // the weather. The driver can change it on the way down the pit lane (see PitPlan).
  suggest(lapsLeft: number, want: Tyre = this.tyre): PitPlan {
    const fuel = Math.max(0, this.toFinish(lapsLeft) - this.fuel);
    const tyres = this.tyres > RULES.freshTyres || want !== this.tyre ? want : null;
    return { tyres, fuel, repair: this.health < 100 };
  }

  // The fuel that sees the car to the flag, with a little over (no more than the tank holds)
  toFinish(lapsLeft: number) { return Math.min(RULES.tank, lapsLeft + 0.3); }

  // How much fuel can go in: up to a full tank
  get room() { return Math.max(0, RULES.tank - this.fuel); }

  // How long the crew takes over this plan (a fire is always put out)
  time(p: PitPlan) {
    return RULES.stop + (p.tyres ? RULES.tyres : 0) + p.fuel * RULES.perLap
      + (p.repair ? (100 - this.health) * RULES.repair : 0) + (this.burning ? RULES.putOut : 0);
  }

  // ...and once it's done
  service(p: PitPlan) {
    this.fuel = Math.min(RULES.tank, this.fuel + p.fuel);
    if (p.tyres) { this.tyres = 0; this.tyre = p.tyres; }
    if (p.repair) this.health = 100;
    this.burning = false;
  }
}

// What the crew does at a stop: new tyres of this kind (null: keep the ones on), laps of fuel to
// put in, and whether to mend the damage
export interface PitPlan { tyres: Tyre | null; fuel: number; repair: boolean }

// What the out-of-the-race reasons say in the results
export const OUT_LABEL: Record<Out, string> = { wrecked: 'Crashed out', fire: 'Burnt out', fuel: 'Out of fuel' };
