// The run: everyone on the same course at once, jumping, sliding, changing lanes, picking things up,
// and the security drone that comes for anyone who stumbles twice or falls off the back. No graphics.
// Runners don't bump into each other (they run through one another), but coins and power-ups are
// first come, first served.
import { ALL, CAR_TOP, Course, LANE_W, POWERS, ZIP_Y, type Piece, type Power } from './course.ts';
import type { Look } from './people.ts';

export const TICK = 1 / 60;
const GRAVITY = 26;
const JUMP = 9; // m/s up: about 1.5 m high, 0.69 s in the air (JUMP_AIR in course.ts)
const BOOTS_JUMP = 12.6; // with the jump boots: up onto a train
export const SLIDE = 0.62; // seconds
const DIVE = 20; // m/s down: sliding in the air drops you straight down
const TALL = 1.75, LOW = 0.85; // how tall a runner is, standing and sliding
const HALF = 0.35; // half a runner's width and depth
const LANE_RATE = 14; // how quickly a lane change happens
const STUMBLE_SLOW = 0.62; // speed for a moment after a stumble
const DRONE_TIME = 7; // seconds the drone stays after a stumble: stumble again and it has you
const LEFT_BEHIND = 24; // m behind the leader: off the back of the screen, and the drone has you
export const POWER_TIME: Record<Power, number> = { magnet: 10, boots: 10, shield: 0, double: 12 };

// What a runner is good at (runners.json), compared with an all-rounder at 1
export interface Stats {
  agility: number; // how fast they change lanes
  spring: number; // how high they jump
  grit: number; // how little a stumble costs
  reach: number; // how far to the side they pick up coins
}

export interface RunnerSpec {
  id: string;
  name: string;
  color: string; // the player's colour (the standings, their tag)
  look: Look; // who they are and what they're wearing
  trail: string; // their trail's colour ('rainbow' for the rainbow one)
  stats: Stats;
  ai: boolean;
}

export type Out = 'crashed' | 'fell' | 'caught';

export class Runner {
  s = 0; // m along the course
  x = 0; // m across (lane × LANE_W, eased)
  lane = 0;
  y = 0;
  vy = 0;
  grounded = true;
  slide = 0; // seconds of slide left
  zip: Piece | null = null; // hanging from a zip line
  slow = 0; // seconds of stumble slowdown left
  drone = 0; // seconds the drone stays on you
  safe = 0; // seconds of not being hit again (after a stumble, or a shield)
  out: Out | null = null;
  outAt = 0; // run time it went out
  coins = 0;
  score = 0; // distance, plus coins, with the double
  powers: Record<Power, number> = { magnet: 0, boots: 0, shield: 0, double: 0 }; // seconds left (shield: 1 while held)
  stride = 0; // for the legs
  // the computer runner's plan
  think = 0;
  constructor(readonly spec: RunnerSpec) {}
  get id() { return this.spec.id; }
  get height() { return this.slide > 0 ? LOW : TALL; }
}

export interface RunEvents {
  jumped: Runner[];
  landed: Runner[];
  coin: Runner[];
  power: { r: Runner; power: Power }[];
  stumbled: Runner[];
  shielded: Runner[];
  out: Runner[];
  drone: Runner[]; // the drone set off after someone
}

const SPEED_UP = 12; // m/s added over the run
const SPEED_TIME = 150; // s: how slowly it gets there

export class Run {
  readonly runners: Runner[];
  t = 0; // seconds since Go
  private ev: RunEvents = { jumped: [], landed: [], coin: [], power: [], stumbled: [], shielded: [], out: [], drone: [] };

  constructor(readonly course: Course, specs: RunnerSpec[]) {
    // everyone starts side by side across the lanes (and on top of each other beyond three)
    this.runners = specs.map((spec, i) => {
      const r = new Runner(spec);
      r.lane = [0, -1, 1][i % 3];
      r.x = r.lane * LANE_W;
      r.s = -Math.floor(i / 3) * 1.5;
      return r;
    });
    course.ensure(250);
  }

  get alive() { return this.runners.filter((r) => !r.out); }
  // the runner furthest along who's still going (or furthest along, once everyone's out)
  get leader() {
    let best = this.runners[0];
    for (const r of this.runners) if ((!r.out && best.out) || (!r.out === !best.out && r.s > best.s)) best = r;
    return best;
  }
  // the course's speed right now (everyone runs at it, unless they've just stumbled)
  get speed() { return this.course.base + SPEED_UP * (1 - Math.exp(-this.t / SPEED_TIME)); }

  // Finishers first: whoever lasted longest, then whoever went furthest
  standings() {
    const lasted = (r: Runner) => (r.out ? r.outAt : Infinity);
    return [...this.runners].sort((a, b) => lasted(b) - lasted(a) || b.s - a.s); // (Infinity - Infinity is NaN: on to the distance)
  }

  // --- what the runners can do ---------------------------------------------------------------------
  move(r: Runner, dir: number) {
    if (r.out) return;
    const lane = Math.max(-1, Math.min(1, r.lane + dir));
    if (lane === r.lane) return;
    r.lane = lane;
    if (r.zip) { r.zip = null; r.vy = 0; } // let go of the zip line
  }

  jump(r: Runner) {
    if (r.out || (!r.grounded && !r.zip)) return;
    r.vy = (r.powers.boots > 0 ? BOOTS_JUMP : JUMP) * Math.sqrt(r.spec.stats.spring); // (height goes with the square)
    r.grounded = false;
    r.zip = null;
    r.slide = 0;
    this.ev.jumped.push(r);
  }

  duck(r: Runner) {
    if (r.out) return;
    if (r.zip) { r.zip = null; r.vy = 0; return; } // drop off the zip line
    r.slide = SLIDE;
    if (!r.grounded) r.vy = Math.min(r.vy, -DIVE);
  }

  // --- one tick ----------------------------------------------------------------------------------------
  step(going: boolean): RunEvents {
    const ev = this.ev;
    for (const list of Object.values(ev)) list.length = 0; // (the same lists every tick)
    if (!going) return ev;
    this.t += TICK;
    const lead = this.leader;
    this.course.ensure(lead.s + 260);
    let last = lead.s;
    for (const r of this.runners) if (!r.out) last = Math.min(last, r.s);
    this.course.trim(last - 40);
    for (const m of this.course.movers) if (m.go < 0 && lead.s > m.s0 - 110) m.go = this.t;
    for (const r of this.runners) {
      if (r.out) continue;
      if (r.spec.ai) this.drive(r);
      this.runner(r);
    }
    // off the back of the screen
    const front = this.leader.s;
    for (const r of this.runners) if (!r.out && front - r.s > LEFT_BEHIND) this.knockOut(r, 'caught');
    return ev;
  }

  private runner(r: Runner) {
    const c = this.course, v = this.speed * (r.slow > 0 ? STUMBLE_SLOW : 1);
    for (const k of POWERS) if (k !== 'shield' && r.powers[k] > 0) r.powers[k] = Math.max(0, r.powers[k] - TICK);
    r.slow = Math.max(0, r.slow - TICK);
    r.drone = Math.max(0, r.drone - TICK);
    r.safe = Math.max(0, r.safe - TICK);
    r.slide = Math.max(0, r.slide - TICK);
    const prevS = r.s, prevX = r.x;
    r.s += v * TICK;
    r.stride += v * TICK;
    r.x += (r.lane * LANE_W - r.x) * Math.min(1, LANE_RATE * r.spec.stats.agility * TICK);
    r.score += v * TICK * (r.powers.double > 0 ? 2 : 1);

    // up and down: hanging from a zip line, or flying and landing
    if (r.zip && r.s > r.zip.s1) r.zip = null;
    if (r.zip) { r.y = ZIP_Y - 2.1; r.vy = 0; r.grounded = false; }
    else {
      const was = r.grounded;
      const floor = this.floor(r);
      r.vy -= GRAVITY * TICK;
      r.y += r.vy * TICK;
      if (r.y <= floor && r.y > floor - 0.6 && r.vy <= 0) {
        r.y = floor;
        r.vy = 0;
        r.grounded = true;
        if (!was) this.ev.landed.push(r);
      } else if (r.grounded && floor < r.y - 0.05 && floor > r.y - 0.6) {
        r.y = floor; // down a slope, or a step
      } else {
        r.grounded = r.y <= floor + 0.01 && r.vy <= 0;
      }
      // grab a zip line on the way past
      const zip = this.zipHere(r);
      if (zip && !r.grounded && r.y + TALL + 0.5 >= ZIP_Y) { r.zip = zip; this.ev.landed.push(r); }
    }
    if (r.y < -5) {
      if (r.powers.shield) { r.powers.shield = 0; r.vy = BOOTS_JUMP * 1.15; r.y = -1; this.ev.shielded.push(r); r.safe = 1; }
      else return this.knockOut(r, 'fell');
    }

    // what's in the way, and what to pick up
    const t = this.t;
    for (let i = c.firstNear(r.s); i < c.pieces.length; i++) {
      const p = c.pieces[i];
      if (p.s0 > r.s + 12) break;
      this.touch(r, p, 0, prevS, prevX);
      if (r.out) return;
    }
    for (const p of c.movers) {
      const off = c.offset(p, t);
      if (p.s0 - off > r.s + 2 || p.s1 - off < r.s - 2) continue;
      this.touch(r, p, off, prevS + p.move * TICK, prevX);
      if (r.out) return;
    }
  }

  // The highest thing under a runner's feet (or -Infinity over a gap)
  floor(r: Runner) {
    const c = this.course, g = c.groundAt(r.s), lane = Math.round(r.x / LANE_W);
    let y = g.kind === 'gap' ? -Infinity : 0;
    const check = (p: Piece, off: number) => {
      if (p.lane !== lane || p.s0 - off > r.s + HALF || p.s1 - off < r.s - HALF) return;
      if (p.kind === 'beam' || (p.kind === 'car' && r.y >= CAR_TOP - 0.6)) y = Math.max(y, p.y1);
      else if (p.kind === 'ramp') y = Math.max(y, ((r.s - p.s0) / (p.s1 - p.s0)) * CAR_TOP);
    };
    for (let i = c.firstNear(r.s); i < c.pieces.length && c.pieces[i].s0 <= r.s + HALF; i++) check(c.pieces[i], 0);
    for (const p of c.movers) check(p, c.offset(p, this.t));
    return y;
  }

  private zipHere(r: Runner) {
    const c = this.course, lane = Math.round(r.x / LANE_W);
    for (let i = c.firstNear(r.s); i < c.pieces.length && c.pieces[i].s0 <= r.s; i++) {
      const p = c.pieces[i];
      if (p.kind === 'zip' && p.lane === lane && p.s1 > r.s + 1) return p;
    }
    return null;
  }

  // A runner and one piece: pick it up, or run into it
  private touch(r: Runner, p: Piece, off: number, prevS: number, prevX: number) {
    const s0 = p.s0 - off, s1 = p.s1 - off;
    if (p.kind === 'coin' || p.kind === 'power') {
      if (p.taken) return;
      const reach = p.kind === 'coin' && r.powers.magnet > 0 ? 6 : 0.9;
      const dx = p.lane * LANE_W - r.x, ds = (s0 + s1) / 2 - r.s, dy = (p.y0 + p.y1) / 2 - (r.y + r.height / 2);
      const near = reach > 1 ? Math.abs(dx) < reach * 1.3 && ds > -1 && ds < reach : Math.abs(dx) < 1.1 * r.spec.stats.reach && Math.abs(ds) < reach && Math.abs(dy) < 1.4;
      if (!near) return;
      p.taken = true;
      if (p.kind === 'coin') { r.coins++; r.score += r.powers.double > 0 ? 10 : 5; this.ev.coin.push(r); }
      else { r.powers[p.power!] = p.power === 'shield' ? 1 : POWER_TIME[p.power!]; this.ev.power.push({ r, power: p.power! }); }
      return;
    }
    if (p.kind === 'ramp' || p.kind === 'beam' || p.kind === 'zip') return;
    // overlap, in all three directions?
    const w = p.lane === ALL ? 4.5 : p.kind === 'car' ? 1.05 : 1;
    const px = p.lane === ALL ? 0 : p.lane * LANE_W;
    if (Math.abs(r.x - px) > w + HALF || r.s + HALF < s0 || r.s - HALF > s1) return;
    if (r.y >= p.y1 - 0.02 || r.y + r.height <= p.y0) return;
    if (p.kind === 'car' && r.y >= CAR_TOP - 0.6) return; // (on its roof)
    if (r.safe > 0) return;
    // into its side while changing lanes: bounce back and stumble; into its front: down you go
    const fromSide = prevS + HALF > s0 && Math.abs(prevX - px) > w + HALF - 0.05;
    if (p.kind === 'low' || fromSide) {
      if (fromSide) r.lane = Math.round(prevX / LANE_W);
      return this.stumble(r);
    }
    if (r.powers.shield) {
      r.powers.shield = 0;
      r.safe = 1.2;
      this.ev.shielded.push(r);
      return;
    }
    this.knockOut(r, 'crashed');
  }

  private stumble(r: Runner) {
    if (r.drone > 0) return this.knockOut(r, 'caught');
    r.slow = 0.9 / r.spec.stats.grit;
    r.safe = 0.6;
    r.drone = DRONE_TIME / r.spec.stats.grit;
    this.ev.stumbled.push(r);
    this.ev.drone.push(r);
  }

  private knockOut(r: Runner, why: Out) {
    if (r.out) return;
    r.out = why;
    r.outAt = this.t;
    r.zip = null;
    this.ev.out.push(r);
  }

  // --- the computer runners ------------------------------------------------------------------------
  // Look down each lane for the next thing in the way; jump it, slide under it, or move to a lane
  // where it's easier. Lane changes have a moment's pause between them; jumps and slides don't.
  // Not perfect: now and then one jumps a little early, and doesn't quite make a long gap.
  private drive(r: Runner) {
    r.think -= TICK;
    const c = this.course, v = this.speed, look = v * 1.1 + 8;
    if (c.groundAt(r.s).kind === 'gap') return; // (on a beam: stay on it)
    // a wide gap coming: the beam's or the zip line's lane is the only way across
    let want: number | null = null;
    const g = c.grounds.find((x) => x.wide && x.s0 > r.s && x.s0 < r.s + v * 1.8);
    if (g) {
      const way = c.pieces.find((p) => (p.kind === 'beam' || p.kind === 'zip') && p.s1 > g.s0 && p.s0 < g.s1);
      if (way) want = way.lane;
      if (way?.kind === 'zip' && way.lane === r.lane && r.grounded && r.s > g.s0 - v * 0.35) this.jump(r);
    }
    const here = this.danger(r, r.lane, look);
    if (r.think <= 0) {
      if (want !== null && !(here?.what === 'wall' && here.ds < v * 0.7)) {
        if (want !== r.lane) { this.move(r, Math.sign(want - r.lane)); r.think = 0.15; }
      } else if (here?.what === 'wall') {
        // head for the nearest lane without something to go round (through the middle if need be)
        const better = [r.lane - 1, r.lane + 1, r.lane - 2, r.lane + 2].filter((l) => l >= -1 && l <= 1).find((l) => {
          const d = this.danger(r, l, look);
          return !d || d.what !== 'wall' || d.ds > here.ds + 6;
        });
        if (better !== undefined) { this.move(r, Math.sign(better - r.lane)); r.think = 0.16 + Math.random() * 0.12; }
      } else if (!here && Math.random() < 0.004) {
        // wander towards some coins
        const l = Math.floor(Math.random() * 3) - 1;
        if (!this.danger(r, l, look)) { this.move(r, Math.sign(l - r.lane)); r.think = 0.5; }
      }
    }
    if (!here || here.what === 'wall') return;
    const when = here.ds / v, early = Math.random() < 0.02 ? 0.12 : 0;
    if ((here.what === 'low' || here.what === 'gap') && when < 0.24 + early && when > 0.05) this.jump(r);
    else if (here.what === 'bar' && when < 0.3 && r.slide <= 0.05) this.duck(r);
  }

  // The nearest trouble in a lane ahead: something to go round ('wall'), jump, slide under, or a gap
  private danger(r: Runner, lane: number, look: number) {
    const c = this.course;
    let best: Danger | null = null;
    const consider = (what: Danger['what'], ds: number) => {
      if (ds > -0.5 && ds < look && (!best || ds < best.ds)) best = { what, ds };
    };
    for (let i = c.firstNear(r.s); i < c.pieces.length && c.pieces[i].s0 < r.s + look; i++) {
      const p = c.pieces[i];
      if (p.lane !== lane && p.lane !== ALL) continue;
      if (p.kind === 'low') consider('low', p.s0 - r.s);
      else if (p.kind === 'bar') consider('bar', p.s0 - r.s);
      else if (p.kind === 'block') consider('wall', p.s0 - r.s);
      else if (p.kind === 'car' && r.y >= CAR_TOP - 0.6) {
        // up on a train: the next train along (not the next car of this one) is a wall once we drop down
        if (lane === r.lane && p.s0 > r.s + 1 && !c.pieces.some((q) => q.kind === 'car' && q.lane === lane && q.s1 > r.s && q.s1 > p.s0 - 1.5 && q.s0 < p.s0)) consider('wall', p.s0 - r.s);
      } else if (p.kind === 'car') {
        // a ramp up to it (just before it in the list) is a way up: if we're on it, or can get to it in time
        let ramped = false;
        for (let j = Math.max(0, i - 12); j < i; j++) {
          const q = c.pieces[j];
          if (q.kind === 'ramp' && q.lane === lane && Math.abs(q.s1 - p.s0) < 0.5) ramped = lane === r.lane || q.s0 - r.s > this.speed * 0.3;
        }
        if (!ramped) consider('wall', p.s0 - r.s);
      }
    }
    for (const p of c.movers) {
      if (p.lane !== lane) continue;
      const off = c.offset(p, this.t), ds = p.s0 - off - r.s;
      if (ds > -16) consider('wall', Math.max(0, ds - p.move * 2)); // (it's coming: further away than it looks)
    }
    for (const g of c.grounds) if (g.kind === 'gap' && !g.wide && g.s0 > r.s - 1) { consider('gap', g.s0 - r.s); break; }
    return best as Danger | null;
  }
}

interface Danger { what: 'wall' | 'low' | 'bar' | 'gap'; ds: number }
