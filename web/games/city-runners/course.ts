// The course: an endless line of rooftops and an elevated rail line (or, on the Streets route, a city
// street with its traffic and junctions), made up as the runners go from a seed, so everyone runs the
// same one (and "today's course" is the same all day). No graphics here:
// the run (run.ts) and the 3D world (scene.ts) both work from these numbers.
//
// Everything is measured along the course (`s`, metres from the start) and across it in lanes
// (-1 left, 0 middle, 1 right, LANE_W apart). Heights are metres above the roofs.

export const LANE_W = 2.4;
export const CAR_TOP = 2.6; // the roof of a rail car
export const ZIP_Y = 2.8; // a zip line's cable
export const JUMP_AIR = 0.69; // seconds in the air from an ordinary jump (see run.ts)
export const ROPE_TOP = 8.5; // where the swinging ropes hang from
export const ROPE_SPAN = 6; // m a rope carries you
export const ROPE_FLIGHT = 0.22; // seconds between letting go of one rope and catching the next
export const ROPE_CATCH = 1.2; // how high you have to be to catch the next rope (the first: just off the ground)

export type GroundKind = 'roof' | 'rail' | 'gap' | 'street' | 'junction';
export interface Ground {
  s0: number;
  s1: number;
  kind: GroundKind;
  depth: number; // how far the building drops below the roof (for the scenery)
  wide?: boolean; // a gap too far to jump: cross on the beam or the zip line
  crossing?: boolean; // a crossing: a zip line, a thin rail and swinging ropes, one in each lane
  phase?: number; // a junction: where its lights are in their cycle at the start of the run (seconds)
}

// --- the streets -------------------------------------------------------------------------------------
// The vehicles, as the runners meet them: how long and how tall. A car's roof can be jumped onto (running
// into one is a stumble); vans, lorries and buses are too tall: go round, or run into it and you're out.
export type Model = 'sedan' | 'shc' | 'thunderbolt' | 'azura' | 'van' | 'lorry' | 'bus' | 'police';
export const VEHICLES: Record<Model, { length: number; height: number; roof: boolean }> = {
  sedan: { length: 4.9, height: 1.48, roof: true },
  shc: { length: 4.8, height: 1.39, roof: true },
  thunderbolt: { length: 4.4, height: 1.38, roof: true },
  azura: { length: 4.4, height: 1.46, roof: true },
  van: { length: 5, height: 1.97, roof: false },
  lorry: { length: 7, height: 3.32, roof: false },
  bus: { length: 11.5, height: 2.85, roof: false },
  police: { length: 5.2, height: 1.61, roof: false },
};
const CARS: Model[] = ['sedan', 'shc', 'thunderbolt', 'azura'];

// A junction's lights, for the runners: green, then amber, then red while the cross traffic goes
export const LIGHT_CYCLE = 10; // s
const GREEN = 5, AMBER = 1.5; // s of each; red for the rest
export type Signal = 'green' | 'amber' | 'red';
export const JUNCTION = 18; // m across the cross street (the junction's length along the course)
export const CROSS_LANES = [5.5, 12.5]; // m into the junction: the cross traffic's two lanes, going right, then left
const CROSS_SPEED = 13; // m/s
const CROSS_FROM = 30; // m out to the side where the cross traffic comes from
export const FOOTBRIDGE_TOP = CAR_TOP; // the footbridge's deck: always the way across, whatever the lights

export function signal(g: Ground, t: number): Signal {
  const c = (((t + g.phase!) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  return c < GREEN ? 'green' : c < GREEN + AMBER ? 'amber' : 'red';
}

// The cross traffic in a junction at time t: while it's red for the runners, a car every 1.7 s each way
export interface Crosser { x: number; s: number; dir: number; model: Model; key: number }
export function crossers(g: Ground, t: number): Crosser[] {
  const out: Crosser[] = [], cycle = Math.floor((t + g.phase!) / LIGHT_CYCLE);
  for (const k of [cycle - 1, cycle]) {
    const red = k * LIGHT_CYCLE - g.phase! + GREEN + AMBER, length = LIGHT_CYCLE - GREEN - AMBER;
    for (let i = 0; i * 1.7 < length - 0.4; i++) {
      for (const [lane, dir] of [[0, 1], [1, -1]]) {
        const go = red + 0.2 + i * 1.7 + lane * 0.6, x = dir * (-CROSS_FROM + CROSS_SPEED * (t - go));
        if (t < go || Math.abs(x) > CROSS_FROM) continue;
        const key = Math.abs((k * 7 + i * 3 + lane) * 2654435761) % 1000;
        out.push({ x, s: g.s0 + CROSS_LANES[lane], dir, model: CARS[key % CARS.length], key });
      }
    }
  }
  return out;
}

// The ways across a crossing, each its own trade-off (see run.ts)
export type Tech = 'zip' | 'balance' | 'ropes';

// low: a barrier to jump; bar: a pipe or sign to slide under; block: a vent stack to go round;
// car: a rail car (a train is several), run along its roof; ramp: up onto one; beam and zip: across a
// wide gap; balance: a thin rail to walk; rope: one of a line of ropes to swing on; sign: which lane
// crosses how; auto: a car on the street (onto its roof, or a stumble); truck: a van, lorry or bus (go
// round); deck: a footbridge's deck, over a junction; coin and power: to pick up
export type PieceKind = 'low' | 'bar' | 'block' | 'car' | 'ramp' | 'beam' | 'zip' | 'balance' | 'rope' | 'sign' | 'coin' | 'power' | 'auto' | 'truck' | 'deck';
export type Power = 'magnet' | 'boots' | 'shield' | 'double';
export const POWERS: Power[] = ['magnet', 'boots', 'shield', 'double'];

export interface Piece {
  id: number;
  kind: PieceKind;
  lane: number; // -1, 0, 1; or ALL for something across the whole width
  s0: number; // where it starts and ends along the course (a moving car: where it started)
  s1: number;
  y0: number; // bottom and top
  y1: number;
  move: number; // m/s towards the runners (an oncoming train), 0 for everything else
  go: number; // when it set off (seconds into the run), -1 until a runner comes near
  power?: Power;
  tech?: Tech; // a crossing's sign: which way across this lane is
  model?: Model; // a vehicle: which
  taken: boolean; // a coin or power-up someone has picked up
  look: number; // 0..1, picks a variation when it's drawn
}

export const ALL = 9;

// The routes to choose from: the time of day, and how the course is mixed (how often a stretch is a
// gap too wide to jump, or the rail line, and how often a train comes the other way on it)
export interface Route { id: string; name: string; about: string; sky: 'dusk' | 'night' | 'dawn'; wide: number; rail: number; oncoming: number; crossing: number; streets?: boolean }
export const ROUTES: Route[] = [
  { id: 'streets', name: 'Downtown Streets', about: 'Down in the traffic at night: parked cars to vault, lorries and buses to dodge, cars coming at you, and junctions. Cross on red and the police come after you.', sky: 'night', wide: 0, rail: 0, oncoming: 0.35, crossing: 0, streets: true },
  { id: 'rooftops', name: 'Rooftops', about: 'Over the roofs as the sun goes down. A bit of everything.', sky: 'dusk', wide: 0.2, rail: 0.25, oncoming: 0.55, crossing: 0.45 },
  { id: 'rail-line', name: 'The Rail Line', about: 'Along the elevated line at night: trains standing, trains coming at you.', sky: 'night', wide: 0.08, rail: 0.7, oncoming: 0.8, crossing: 0.3 },
  { id: 'sky-bridges', name: 'Sky Bridges', about: 'Tower to tower at sunrise. Gaps too wide to jump: zip lines, thin rails and swinging ropes.', sky: 'dawn', wide: 0.45, rail: 0.12, oncoming: 0.3, crossing: 0.6 },
];

export class Course {
  readonly grounds: Ground[] = [];
  readonly pieces: Piece[] = []; // everything that stays put, sorted by s0
  readonly movers: Piece[] = []; // oncoming trains' cars
  private rnd: () => number;
  private end = -12; // made up to here (the first roof starts a little behind the start line)
  private nextId = 1;
  private nextPower = 220;

  constructor(readonly seed: number, readonly base: number, readonly route: Route = ROUTES[0]) {
    this.rnd = mulberry(seed);
    if (route.streets) this.street(140, true);
    else this.roof(82, true);
  }

  // Make the course up to s
  ensure(s: number) {
    while (this.end < s) this.next();
  }

  // Forget everything behind s, so the lists don't grow for ever
  trim(s: number) {
    while (this.grounds.length > 2 && this.grounds[1].s1 < s) this.grounds.shift();
    let n = 0;
    while (n < this.pieces.length && this.pieces[n].s1 < s) n++;
    if (n > 64) this.pieces.splice(0, n);
    while (this.movers.length && this.movers[0].s1 < s - 300) this.movers.shift();
  }

  groundAt(s: number): Ground {
    const g = this.grounds;
    let lo = 0, hi = g.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (g[mid].s0 <= s) lo = mid; else hi = mid - 1;
    }
    return g[lo];
  }

  // How far an oncoming train's car has come towards the runners: it stops at the start of the line
  offset(p: Piece, t: number) {
    if (!p.move || p.go < 0) return 0;
    return Math.max(0, Math.min(p.move * (t - p.go), p.s0 - this.groundAt(p.s0).s0 - 2));
  }

  // A crossing coming up within `range` of s: its ways across, left lane to right
  crossingAhead(s: number, range: number) {
    const g = this.grounds.find((x) => x.crossing && x.s0 > s && x.s0 < s + range);
    if (!g) return null;
    const signs = this.pieces.filter((p) => p.kind === 'sign' && p.tech && Math.abs(p.s0 - (g.s0 - 14)) < 1);
    return [-1, 0, 1].map((l) => signs.find((p) => p.lane === l)?.tech ?? null);
  }

  // The first piece that could reach past s (they're sorted by s0, and none is longer than 60 m)
  firstNear(s: number) {
    const p = this.pieces;
    let lo = 0, hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p[mid].s0 < s - 60) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // The speed a runner is likely to have reached by s, if nothing goes wrong (for spacing things out)
  private speedAt(s: number) {
    return this.base + 12 * (1 - Math.exp(-s / (150 * (this.base + 6))));
  }

  // --- making it up ----------------------------------------------------------------------------------
  private next() {
    if (this.route.streets) {
      this.junction();
      this.street(110 + this.rnd() * 120);
      return;
    }
    const r = this.rnd(), v = this.speedAt(this.end), reach = JUMP_AIR * v, { wide, rail } = this.route;
    if (r < wide && this.end > 200) {
      if (this.rnd() < this.route.crossing) this.crossing(v);
      else this.gap(reach * (1.15 + this.rnd() * 0.35), true);
      this.roof(50 + this.rnd() * 40);
    } else if (r < wide + rail && this.end > 150) {
      this.gap(reach * (0.35 + this.rnd() * 0.2), false);
      this.rail(150 + this.rnd() * 90);
      this.gap(reach * (0.35 + this.rnd() * 0.2), false);
      this.roof(40 + this.rnd() * 30);
    } else {
      this.gap(reach * (0.35 + this.rnd() * 0.25), false);
      this.roof(50 + this.rnd() * 70);
    }
  }

  // --- the streets -----------------------------------------------------------------------------------
  // A stretch of street between junctions: one-way, three lanes, rows of traffic in the way
  private street(len: number, start = false) {
    const g = this.ground(len, 'street');
    let s = g.s0 + (start ? 60 : 14);
    while (true) {
      const v = this.speedAt(s), space = Math.min(34, 12 + v * 0.95);
      if (s + 12 > g.s1 - 26) break; // (the run-up to the junction stays clear for its footbridge)
      s = this.traffic(s);
      s += space * (0.8 + this.rnd() * 0.5);
    }
    if (start) this.coins(0, g.s0 + 24, g.s0 + 54, () => 0.9);
    this.maybePower(g.s0 + 4, g.s1 - 30);
  }

  // One row of traffic; always a way through: a free lane, or a car's roof to vault. Returns where it ends.
  private traffic(s: number) {
    const r = this.rnd(), lanes = shuffle([-1, 0, 1], this.rnd);
    const car = () => CARS[Math.floor(this.rnd() * CARS.length)];
    const vehicle = (kind: 'auto' | 'truck', model: Model, lane: number, at: number, extra: Partial<Piece> = {}) => {
      const { length, height } = VEHICLES[model];
      return this.add(kind, lane, at, at + length, 0, height, { model, ...extra });
    };
    if (r < 0.3) {
      // parked cars in two lanes: vault one, or take the third
      const [a, b, free] = lanes;
      vehicle('auto', car(), a, s);
      vehicle('auto', car(), b, s + this.rnd() * 3);
      if (this.rnd() < 0.5) this.coins(free, s - 4, s + 8, () => 0.9);
      else for (let i = 0; i < 4; i++) this.add('coin', a, s + 0.8 + i * 1.1, s + 1.2 + i * 1.1, 2.2, 2.8); // (on the roof)
      return s + 6;
    }
    if (r < 0.5) {
      // a lorry or a bus pulled in, and a parked car: round the lorry, over the car
      const big: Model = this.rnd() < 0.45 ? 'bus' : this.rnd() < 0.5 ? 'van' : 'lorry', [a, b, free] = lanes;
      vehicle('truck', big, a, s);
      vehicle('auto', car(), b, s + 2);
      this.coins(free, s - 4, s + VEHICLES[big].length + 2, () => 0.9);
      return s + VEHICLES[big].length;
    }
    if (r < 0.66 && this.end > 120) {
      // something coming the other way, in one lane, and a parked car in another
      const [a, b, free] = lanes, model: Model = this.rnd() < 0.3 ? 'van' : car();
      const at = s + 40;
      vehicle(VEHICLES[model].roof ? 'auto' : 'truck', model, a, at, { move: 7 + this.rnd() * 4 });
      if (this.rnd() < this.route.oncoming) vehicle('auto', car(), b, s);
      this.coins(free, s - 2, s + 14, () => 0.9);
      return s + 6;
    }
    if (r < 0.82) {
      // roadworks: barriers across two lanes (jump them), a lorry in the third
      const [a, b, c] = lanes;
      this.add('low', a, s, s + 0.5, 0, 0.9);
      this.add('low', b, s, s + 0.5, 0, 0.9);
      if (this.rnd() < 0.5) vehicle('truck', 'van', c, s - 2);
      this.coinArc(a, s);
      return s + 3;
    }
    // scaffolding right across: slide under; a car parked beyond it
    this.add('bar', ALL, s, s + 0.6, 1.15, 3.2);
    vehicle('auto', car(), lanes[0], s + 9);
    this.coins(lanes[1], s - 5, s + 5, () => 0.5);
    return s + 14;
  }

  // A junction: the cross street, its lights, and a footbridge over it in one lane (ramp up, deck across)
  private junction() {
    const g = this.ground(JUNCTION, 'junction');
    g.phase = this.rnd() * LIGHT_CYCLE;
    const lane = this.lane();
    this.add('ramp', lane, g.s0 - 14, g.s0 - 4, 0, FOOTBRIDGE_TOP);
    this.add('deck', lane, g.s0 - 4, g.s1 + 1, FOOTBRIDGE_TOP - 0.35, FOOTBRIDGE_TOP);
    this.coins(lane, g.s0 - 2, g.s1 - 1, () => FOOTBRIDGE_TOP + 0.9);
  }

  private ground(len: number, kind: GroundKind, wide = false) {
    const g: Ground = { s0: this.end, s1: this.end + len, kind, depth: 18 + this.rnd() * 40, wide };
    this.grounds.push(g);
    this.end = g.s1;
    return g;
  }

  private add(kind: PieceKind, lane: number, s0: number, s1: number, y0: number, y1: number, extra: Partial<Piece> = {}) {
    const p: Piece = { id: this.nextId++, kind, lane, s0, s1, y0, y1, move: 0, go: -1, taken: false, look: this.rnd(), ...extra };
    if (p.move) { this.movers.push(p); return p; }
    // (kept sorted: pieces are mostly made in order, so this is a short walk back)
    let i = this.pieces.length;
    while (i > 0 && this.pieces[i - 1].s0 > s0) i--;
    this.pieces.splice(i, 0, p);
    return p;
  }

  private gap(len: number, wide: boolean, way = true) {
    const g = this.ground(len, 'gap', wide);
    if (!wide) return g;
    // a clear run-up, so there's time to get into the right lane
    const runUp = g.s0 - this.speedAt(g.s0) * 1.8;
    for (let i = this.pieces.length - 1; i >= 0 && this.pieces[i].s1 > runUp - 30; i--) {
      const p = this.pieces[i];
      if (p.kind !== 'coin' && p.kind !== 'power' && p.s1 > runUp) this.pieces.splice(i, 1);
    }
    if (!way) return g; // (a crossing puts in its own)
    // a beam to run across, or a zip line to grab (jump up to it), in one lane
    const lane = this.lane();
    if (this.rnd() < 0.5) {
      this.add('beam', lane, g.s0 - 0.5, g.s1 + 0.5, -0.4, 0);
      this.coins(lane, g.s0 + 1, g.s1 - 1, () => 0.9);
    } else {
      this.add('zip', lane, g.s0 - 6, g.s1 + 4, ZIP_Y - 0.1, ZIP_Y);
      this.coins(lane, g.s0 + 1, g.s1 - 1, () => ZIP_Y - 1.4);
    }
    return g;
  }

  // A crossing: one way across in each lane. A zip line (jump to grab it: quick, but miss and you
  // fall); a thin rail (can't be missed, but you walk it slowly, and stepping off is a fall); a line
  // of ropes (swing, and jump at the end of each swing to fly to the next: a bit quicker than running).
  // The gap is as long as three swings and the flights between them.
  private crossing(v: number) {
    const flight = ROPE_FLIGHT * v, n = 3;
    const g = this.gap(1 + n * ROPE_SPAN + (n - 1) * flight + flight * 0.8, true, false);
    g.crossing = true;
    const [zip, balance, ropes] = shuffle([-1, 0, 1], this.rnd);
    this.add('zip', zip, g.s0 - 6, g.s1 + 4, ZIP_Y - 0.1, ZIP_Y);
    this.coins(zip, g.s0 + 1, g.s1 - 1, () => ZIP_Y - 1.4);
    this.add('balance', balance, g.s0 - 0.5, g.s1 + 0.5, -0.1, 0);
    for (let i = 0, s = g.s0 - 1; i < n; i++, s += ROPE_SPAN + flight) {
      // (the first is caught with a jump off the roof; the others on the way past, high up)
      this.add('rope', ropes, s, s + ROPE_SPAN, i ? ROPE_CATCH : 0.3, ROPE_TOP);
      if (i < n - 1) this.coins(ropes, s + ROPE_SPAN + 1, s + ROPE_SPAN + flight - 1, () => 3.2);
    }
    for (const [lane, tech] of [[zip, 'zip'], [balance, 'balance'], [ropes, 'ropes']] as [number, Tech][]) {
      this.add('sign', lane, g.s0 - 14, g.s0 - 13.6, 0, 2.6, { tech });
    }
  }

  // A roof: rows of things in the way, coins between them
  private roof(len: number, start = false) {
    const g = this.ground(len, 'roof');
    let s = g.s0 + (start ? 57 : 10);
    while (true) {
      const v = this.speedAt(s), space = Math.min(32, 9 + v * 0.95);
      if (s + 4 > g.s1 - 6) break;
      this.row(s);
      s += space * (0.8 + this.rnd() * 0.5);
    }
    if (start) this.coins(0, g.s0 + 24, g.s0 + 52, () => 0.9);
    this.maybePower(g.s0 + 4, g.s1 - 4);
  }

  // One row across the roof. There's always a way through: a free lane, or one move (jump or slide)
  // that clears the whole width.
  private row(s: number) {
    const r = this.rnd(), lanes = shuffle([-1, 0, 1], this.rnd);
    if (r < 0.22) {
      // barriers to jump, in two or three lanes
      const n = this.rnd() < 0.4 ? 3 : 2;
      for (const l of lanes.slice(0, n)) this.add('low', l, s, s + 0.5, 0, 0.9, {});
      if (n === 2) this.coins(lanes[2], s - 6, s + 6, () => 0.9);
      else this.coinArc(lanes[0], s);
    } else if (r < 0.38) {
      // a sign right across: slide under it
      this.add('bar', ALL, s, s + 0.6, 1.15, 3.2);
      this.coins(lanes[0], s - 5, s + 5, () => 0.5);
    } else if (r < 0.7) {
      // vent stacks in one or two lanes: go round
      const n = this.rnd() < 0.5 ? 1 : 2, len = 2 + this.rnd() * 3;
      for (const l of lanes.slice(0, n)) this.add('block', l, s, s + len, 0, 2.4);
      this.coins(lanes[2], s - 8, s + len + 4, () => 0.9);
    } else if (r < 0.85) {
      // a vent stack, a barrier and a pipe: a different move in each lane
      const len = 2 + this.rnd() * 2;
      this.add('block', lanes[0], s, s + len, 0, 2.4);
      this.add('low', lanes[1], s, s + 0.5, 0, 0.9);
      this.add('bar', lanes[2], s, s + 0.6, 1.15, 2.2);
      this.coinArc(lanes[1], s);
    } else {
      // a pipe low across two lanes, a barrier in the third
      this.add('bar', lanes[0], s, s + 0.6, 1.15, 2.2);
      this.add('bar', lanes[1], s, s + 0.6, 1.15, 2.2);
      this.add('low', lanes[2], s, s + 0.5, 0, 0.9);
      this.coins(lanes[0], s - 4, s + 4, () => 0.5);
    }
  }

  // The rail line: trains standing in some lanes (some with a ramp up), maybe one coming the other way.
  // One lane at a time is always clear or has a ramp.
  private rail(len: number) {
    const g = this.ground(len, 'rail');
    const lanes = shuffle([-1, 0, 1], this.rnd);
    const [clear, a, b] = lanes;
    this.trains(a, g.s0 + 20, g.s1 - 10, true);
    if (this.rnd() < this.route.oncoming) {
      // an oncoming train, starting near the far end; it sets off when the first runner comes near
      const cars = 2, s0 = g.s1 - 8 - cars * 15;
      for (let i = 0; i < cars; i++) this.add('car', b, s0 + i * 15, s0 + i * 15 + 14, 0, CAR_TOP, { move: 9, look: i === 0 ? 1 : 0.5 });
      this.coins(clear, g.s0 + 15, g.s1 - 15, () => 0.9);
    } else {
      this.trains(b, g.s0 + 40, g.s1 - 20, false);
    }
    // the clear lane has the odd signal box or sleeper stack
    for (let s = g.s0 + 35; s < g.s1 - 15; s += 45 + this.rnd() * 30) {
      if (this.rnd() < 0.5) this.add('low', clear, s, s + 0.5, 0, 0.9);
      else this.add('bar', clear, s, s + 0.6, 1.15, 2.2);
    }
    this.maybePower(g.s0 + 10, g.s1 - 10);
  }

  // Standing trains along a lane, with gaps between them; `ramp`: the first one has a ramp up
  private trains(lane: number, from: number, to: number, ramp: boolean) {
    let s = from, first = true;
    while (s + 30 < to) {
      const cars = 1 + Math.floor(this.rnd() * 3);
      const withRamp = (first && ramp) || this.rnd() < 0.4;
      if (withRamp) this.add('ramp', lane, s - 8, s, 0, CAR_TOP);
      for (let i = 0; i < cars; i++) this.add('car', lane, s + i * 15, s + i * 15 + 14, 0, CAR_TOP);
      this.coins(lane, s + 2, s + cars * 15 - 3, () => CAR_TOP + 0.9);
      s += cars * 15 + 12 + this.rnd() * 25;
      first = false;
    }
  }

  private coins(lane: number, s0: number, s1: number, y: (s: number) => number) {
    for (let s = s0; s <= s1; s += 2.5) this.add('coin', lane, s, s + 0.4, y(s), y(s) + 0.6);
  }

  // Coins in an arc over a barrier, where a jump goes
  private coinArc(lane: number, s: number) {
    for (let i = -3; i <= 3; i++) {
      const u = i / 3.5, y = 0.9 + 1.4 * (1 - u * u);
      this.add('coin', lane, s + i * 1.6, s + i * 1.6 + 0.4, y, y + 0.6);
    }
  }

  private maybePower(s0: number, s1: number) {
    if (this.nextPower > s1) return;
    const s = Math.max(s0, Math.min(s1, this.nextPower));
    // in a lane with nothing in it nearby
    const lane = [-1, 0, 1].find((l) => !this.pieces.some((p) => (p.lane === l || p.lane === ALL) && p.kind !== 'coin' && p.s1 > s - 6 && p.s0 < s + 6));
    if (lane === undefined) { this.nextPower += 30; return; }
    this.add('power', lane, s, s + 0.8, 0.6, 1.6, { power: POWERS[Math.floor(this.rnd() * POWERS.length)] });
    this.nextPower = s + 220 + this.rnd() * 160;
  }

  private lane() {
    return Math.floor(this.rnd() * 3) - 1;
  }
}

// A small fast seeded random number generator
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rnd: () => number) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Today's course: the same for everyone all day (from the date)
export function todaySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
