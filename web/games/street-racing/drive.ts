// The race through the city (city.ts): cars that drive anywhere the road goes, no graphics.
//
// - A car is a position and heading on the ground with a velocity. Gas and brake push it along the way it
//   points; the tyres pull its velocity round to where it points, up to their grip (more and it slides); the
//   steering turns it, tighter the slower it goes. It hits the kerbs (the blocks' edges) and the other cars:
//   a hard hit bounces it off, costs speed and can spin it round.
// - The racers go wherever they like. The computer drivers take the shortest way to the finish (now and then
//   the second shortest), pass what's in front, mostly stop at red lights, and don't let the people get away.
// - Traffic drives the streets on the right, turning wherever, stopping at red lights and behind each other.
// - Run a red light and the police come: their car comes after you from a street behind, and if it catches
//   you it pulls across in front of you and holds you there a few seconds before it drives off.
import type { City, Edge, Node } from './city.ts';

export const TICK = 1 / 60;
export const TOP = 64; // m/s flat out in a car with "top" 1: about 143 mph
const ACCEL = 15;
const BRAKE = 24;
const GRIP = 21; // m/s² of cornering a car with "grip" 1 holds
const R_MIN = 5.5; // m: the tightest it turns, at walking pace
const STEER_RATE = 1.7; // rad/s: the quickest it turns
const BOUNCE = 0.35; // how much of a hit comes back
const SPIN_HIT = 13; // m/s into something that spins a car round
const CORNER_R = 12; // m: the radius a computer driver takes a right-angled corner at
const POLICE_HOLD = 5; // s you're held when they catch you
const POLICE_GIVES_UP = 40; // s
const POLICE_LOSES = 380; // m
const START_CLEAR = 6; // s before a red light counts (nobody's caught by one on the way off the grid)

export type Kind = 'racer' | 'traffic' | 'police';
export interface Stats { top: number; accel: number; grip: number; weight: number; length: number; width: number }
export interface CarSpec { id: string; name: string; color: string; paint?: string; model: string; kind: Kind; ai: boolean; skill: number; stats: Stats }

export class Car {
  x = 0; z = 0; h = 0; // where it is, which way it points (radians: 0 is east, +x; π/2 is south, +z)
  vx = 0; vz = 0;
  spin = 0; // rad/s of a spin-out
  spinning = 0; // s left of it
  throttle = 0; brake = 0; steer = 0; // -1 (left) .. 1
  boost = 0; // extra top speed and pick-up, as a share
  remaining = Infinity; // m to the finish, the shortest way
  finish: number | null = null; // race time it got there
  bumped = 9; // s since it last hit something
  held = 0; // s left pulled over by the police
  scraping = 0; // along a kerb now
  active = true; // (the police car, until it's needed)
  // the computer driver's plan
  next: Node | null = null;
  prev: Node | null = null;
  lane = 2.5; // m right of the middle of the street
  laneT = 0;
  inNode: Node | null = null; // the junction it's in (for red lights run)
  constructor(readonly spec: CarSpec) {}
  get id() { return this.spec.id; }
  get stats() { return this.spec.stats; }
  get v() { return Math.hypot(this.vx, this.vz); }
  get forward() { return this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h); }
}

export interface Hit { car: Car; strength: number; x: number; z: number; wall: boolean }
export interface Events {
  hits: Hit[]; spun: Car[]; finished: Car[]; near: Car[];
  violation: Car[]; chased: Car[]; pulledOver: Car[]; released: Car[]; escaped: Car[];
}

export class Drive {
  readonly cars: Car[] = []; // the racers, then the traffic, then the police
  t = 0;
  wet = 0; // how wet the road is (grip goes down)
  readonly police: Car;
  chasing: Car | null = null; // who the police are after
  private chaseT = 0;
  private close = 0;
  private blockFrom: { x: number; z: number; h: number } | null = null;
  private blockT = 0;
  private leaving = 0;
  private passing = new Map<string, number>();
  private routeT = 0;
  trafficWanted = 0;
  private rnd = Math.random;

  constructor(readonly city: City, racers: CarSpec[], private trafficTypes: CarSpec[], policeSpec: CarSpec) {
    // the grid: two by two behind the start, facing the way
    const s = city.start, fx = Math.cos(s.h), fz = Math.sin(s.h), rx = -fz, rz = fx;
    racers.forEach((spec, i) => {
      const c = new Car(spec), back = 6 + Math.floor(i / 2) * 9, side = i % 2 ? 3.4 : -2;
      c.x = s.x - fx * back + rx * side;
      c.z = s.z - fz * back + rz * side;
      c.h = s.h;
      c.lane = side;
      this.cars.push(c);
    });
    for (const c of this.cars) c.remaining = city.remaining(c.x, c.z);
    this.police = new Car(policeSpec);
    this.police.active = false;
    this.cars.push(this.police);
  }

  get racers() { return this.cars.filter((c) => c.spec.kind === 'racer'); }
  get traffic() { return this.cars.filter((c) => c.spec.kind === 'traffic'); }
  // Finishers first, in the order they finished; then whoever has least to go
  standings() {
    return this.racers.sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || a.remaining - b.remaining);
  }

  // One step. Before the green light the racers wait on the grid (the traffic doesn't).
  step(green: boolean): Events {
    const ev: Events = { hits: [], spun: [], finished: [], near: [], violation: [], chased: [], pulledOver: [], released: [], escaped: [] };
    if (green) this.t += TICK;
    this.keepTraffic();
    for (const c of this.cars) {
      if (!c.active) continue;
      if (c.spec.kind === 'police') this.drivePolice(c, ev);
      else if (c.spec.kind === 'traffic') this.driveTraffic(c);
      else if (c.spec.ai || c.finish !== null) this.driveRacer(c);
      if (c.spec.kind === 'racer' && !green) { c.throttle = 0; c.brake = 1; }
      if (c.held > 0) { c.held -= TICK; c.throttle = 0; c.brake = 1; c.vx *= 0.9; c.vz *= 0.9; if (c.held <= 0) ev.released.push(c); }
      this.move(c, ev);
    }
    this.collide(ev);
    this.lights(ev, green);
    this.nearMisses(ev);
    if (green && Math.round(this.t / TICK) % 4 === 0) {
      for (const c of this.racers) {
        c.remaining = this.city.remaining(c.x, c.z, c.remaining);
        const f = this.city.finish;
        if (c.finish === null && Math.abs(c.x - f.x) < f.size / 2 + 4 && Math.abs(c.z - f.z) < f.size / 2 + 4) { c.finish = this.t; c.remaining = 0; ev.finished.push(c); }
      }
    }
    return ev;
  }

  // --- handling --------------------------------------------------------------------------------------
  private move(c: Car, ev: Events) {
    const s = c.stats, fx = Math.cos(c.h), fz = Math.sin(c.h), rx = -fz, rz = fx;
    let vf = c.vx * fx + c.vz * fz, vr = c.vx * rx + c.vz * rz;
    const grip = GRIP * s.grip * (1 - 0.3 * this.wet) * (c.spinning > 0 ? 0.25 : 1);
    const top = TOP * s.top * c.spec.skill * (1 + c.boost);
    // gas and brake, along the way it points
    if (c.spinning <= 0) {
      let a = ACCEL * s.accel * (1 + Math.max(0, c.boost)) * (c.throttle - Math.max(0, vf) / top);
      if (a < 0) a *= 0.3; // (lifting off slows it gently)
      vf += a * TICK;
      if (c.brake > 0) vf = vf > 0 ? Math.max(0, vf - c.brake * BRAKE * (1 - 0.25 * this.wet) * TICK) : Math.min(0, vf + c.brake * 8 * TICK); // (and backs up, slowly)
    }
    vf -= vf * 0.02 * TICK;
    // the tyres pull the sideways part of its speed away, up to their grip
    const pull = Math.min(Math.abs(vr), grip * TICK);
    vr -= Math.sign(vr) * pull;
    // the steering turns it (tighter the slower); a spin turns it whatever
    if (c.spinning > 0) {
      c.h += c.spin * TICK;
      c.spinning -= TICK;
      c.spin *= 1 - 1.4 * TICK;
      vf *= 1 - 0.8 * TICK;
    } else {
      const yaw = c.steer * Math.min(STEER_RATE, Math.abs(vf) / R_MIN) * Math.sign(vf || 1);
      c.h += yaw * TICK;
      c.spin *= 1 - 5 * TICK;
      c.h += c.spin * TICK;
    }
    // (the speed it had carries on the way it was going: the grip brings it round, next step, as far as it can)
    c.vx = fx * vf + rx * vr;
    c.vz = fz * vf + rz * vr;
    c.x += c.vx * TICK;
    c.z += c.vz * TICK;
    c.bumped += TICK;
    this.walls(c, ev);
  }

  // The kerbs: two round ends of the car against every block near it
  private walls(c: Car, ev: Events) {
    const s = c.stats, fx = Math.cos(c.h), fz = Math.sin(c.h), r = s.width / 2, off = Math.max(0, s.length / 2 - r);
    c.scraping = 0;
    for (const end of [off, -off]) {
      const px = c.x + fx * end, pz = c.z + fz * end;
      for (const w of this.city.solids) {
        if (px < w.x0 - r || px > w.x1 + r || pz < w.z0 - r || pz > w.z1 + r) continue;
        const nx0 = Math.max(w.x0, Math.min(w.x1, px)), nz0 = Math.max(w.z0, Math.min(w.z1, pz));
        let dx = px - nx0, dz = pz - nz0, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) { // (right inside: out the nearest side)
          const sides = [[px - w.x0, -1, 0], [w.x1 - px, 1, 0], [pz - w.z0, 0, -1], [w.z1 - pz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
          dx = sides[1]; dz = sides[2]; d = 0;
        } else { dx /= d; dz /= d; }
        const push = r - d;
        c.x += dx * push;
        c.z += dz * push;
        const into = -(c.vx * dx + c.vz * dz);
        if (into <= 0) continue;
        c.vx += dx * into * (1 + BOUNCE);
        c.vz += dz * into * (1 + BOUNCE);
        // grinding along it slows it too
        c.vx *= 1 - Math.min(0.25, into * 0.02);
        c.vz *= 1 - Math.min(0.25, into * 0.02);
        c.scraping = 1;
        if (into > 2.5) {
          c.spin += (end > 0 ? 1 : -1) * (dx * -fz + dz * fx) * into * 0.05;
          if (into > SPIN_HIT) this.spinOut(c, ev);
          if (c.bumped > 0.3) ev.hits.push({ car: c, strength: into, x: px - dx * r, z: pz - dz * r, wall: true });
          c.bumped = 0;
        }
      }
    }
  }

  private spinOut(c: Car, ev: Events) {
    if (c.spinning > 0) return;
    c.spinning = 1.2;
    c.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 2);
    ev.spun.push(c);
  }

  // The cars against each other: round ends again, pushed apart by weight; traffic is heavy
  private collide(ev: Events) {
    const cs = this.cars.filter((c) => c.active);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) continue;
      for (const ea of ends(a)) for (const eb of ends(b)) {
        const dx = eb.x - ea.x, dz = eb.z - ea.z, d = Math.hypot(dx, dz), min = ea.r + eb.r;
        if (d >= min || d < 1e-6) continue;
        const nx = dx / d, nz = dz / d, ma = a.stats.weight, mb = b.stats.weight, push = min - d;
        a.x -= nx * push * mb / (ma + mb); a.z -= nz * push * mb / (ma + mb);
        b.x += nx * push * ma / (ma + mb); b.z += nz * push * ma / (ma + mb);
        const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (closing <= 0) continue;
        const J = (1 + BOUNCE) * closing / (1 / ma + 1 / mb);
        a.vx -= (J / ma) * nx; a.vz -= (J / ma) * nz;
        b.vx += (J / mb) * nx; b.vz += (J / mb) * nz;
        // a racer into an ordinary car or the police loses far more than in a bump with another racer
        for (const [me, them] of [[a, b], [b, a]]) {
          if (me.spec.kind === 'racer' && them.spec.kind !== 'racer') { me.vx *= Math.max(0.45, 1 - closing * 0.05); me.vz *= Math.max(0.45, 1 - closing * 0.05); }
          if (me.spec.kind === 'racer' && them.spec.kind === 'racer') { me.vx *= Math.max(0.8, 1 - closing * 0.02); me.vz *= Math.max(0.8, 1 - closing * 0.02); }
        }
        a.spin += (Math.random() - 0.5) * closing * 0.06;
        b.spin += (Math.random() - 0.5) * closing * 0.06;
        if (closing > SPIN_HIT) this.spinOut(ma < mb ? a : b, ev);
        if (closing > 2) for (const c of [a, b]) {
          if (c.bumped > 0.3) ev.hits.push({ car: c, strength: closing, x: (ea.x + eb.x) / 2, z: (ea.z + eb.z) / 2, wall: false });
          c.bumped = 0;
        }
        if (this.chasing && ((a === this.police && b === this.chasing) || (b === this.police && a === this.chasing))) this.close += 0.4; // (rammed: as good as caught)
      }
    }
  }

  // --- the computer drivers ------------------------------------------------------------------------
  // Head for the next junction on the way, in a lane, at a speed it can take the corner at and stop in
  // time for a red light; pass what's in front
  private driveRacer(c: Car) {
    const city = this.city;
    if (c.finish !== null) { c.throttle = 0; c.brake = 0.6; c.steer = 0; return; }
    if (!c.next) {
      // (where it is now: the junction ahead on the way, and the one behind it on this street)
      c.next = city.route(c.x, c.z, c.h)[0] ?? null;
      const w = city.where(c.x, c.z);
      c.prev = w && 'edge' in w && c.next ? city.other(w.edge, c.next) : null;
    } else if (this.reached(c, c.next)) {
      // on to the best way from here; now and then the second best, if it's hardly any further
      const at = c.next, best = city.nextToward(at, c.prev), second = city.nextToward(at, c.prev, 1);
      const cost = (n: Node | null) => (n ? city.toGo(n) + city.between(at, n)!.length : Infinity);
      c.prev = at;
      c.next = second && second !== best && cost(second) - cost(best) < 60 && this.rnd() < 0.15 ? second : best;
    }
    if (!c.next) return;
    const after = c.prev ? city.nextToward(c.next, c.prev) : null;
    // pass whatever's slow in front: across to the other side of the street for a while
    c.laneT -= TICK;
    const ahead = this.ahead(c, 45);
    if (ahead && ahead.forward < c.forward - 3 && c.laneT <= 0) {
      // across to the other side, if it's clear; if not, wait behind
      const other = c.lane > 0 ? -3 : 3;
      if (this.laneClear(c, other)) { c.lane = other; c.laneT = 2; }
    } else if (c.laneT <= 0 && !ahead) c.lane += (2.5 - c.lane) * 0.02;
    let speed = this.cornerSpeed(c, c.next, after, CORNER_R);
    if (ahead && ahead.forward < c.forward) speed = Math.min(speed, ahead.forward + Math.max(0, this.distTo(c, ahead) - 8) * 0.9);
    // a red light: most of them stop (each driver decides at each junction, the same way every time)
    const stop = this.redAhead(c, c.next);
    if (stop !== null && obeys(c, c.next)) speed = Math.min(speed, Math.sqrt(2 * BRAKE * 0.55 * Math.max(0, stop)));
    if (ahead && ahead.forward < 3 && this.distTo(c, ahead) < 9) speed = Math.min(speed, 2);
    this.steerTo(c, c.next, after, c.lane, speed);
  }

  // Traffic: in its lane on the right, turning wherever at each junction (not into alleys, not back), stopping
  // at red lights and behind whatever's in front
  private driveTraffic(c: Car) {
    const city = this.city;
    if (!c.next || this.reached(c, c.next)) {
      const at = c.next!;
      const options = at.edges.filter((e) => e.kind !== 'alley').map((e) => city.other(e, at)).filter((n) => n !== c.prev);
      const straight = options.find((n) => c.prev && Math.abs((n.x - at.x) * (at.z - c.prev.z) - (n.z - at.z) * (at.x - c.prev.x)) < 1);
      c.prev = at;
      c.next = straight && this.rnd() < 0.55 ? straight : options[Math.floor(this.rnd() * options.length)] ?? c.prev;
    }
    const e = c.prev ? city.between(c.prev, c.next) : null;
    const lane = e?.kind === 'avenue' ? (c.lane > 4 ? 6.4 : 2.4) : 3.2;
    let speed = this.cornerSpeed(c, c.next, null, 7);
    const stop = this.redAhead(c, c.next);
    if (stop !== null) speed = Math.min(speed, Math.sqrt(2 * BRAKE * 0.4 * Math.max(0, stop)));
    const ahead = this.ahead(c, 22);
    if (ahead) speed = Math.min(speed, Math.max(0, ahead.forward + (this.distTo(c, ahead) - 9) * 0.6));
    this.steerTo(c, c.next, null, lane, speed);
  }

  // Steer for a point a little way ahead on the way through `next` (then `after`), `lane` m right of the
  // middle of the street; gas or brake for `speed`
  private steerTo(c: Car, next: Node, after: Node | null, lane: number, speed: number) {
    const from = c.prev ?? { x: c.x, z: c.z };
    let dx = next.x - from.x, dz = next.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const look = 8 + c.v * 0.55, toNode = Math.hypot(next.x - c.x, next.z - c.z);
    let tx: number, tz: number;
    if (toNode > look + next.size / 2 || !after) {
      // along this street, in the lane
      const along = (c.x - from.x) * dx + (c.z - from.z) * dz + look;
      tx = from.x + dx * along - dz * lane;
      tz = from.z + dz * along + dx * lane;
    } else {
      // round the corner, into the lane of the street after
      let ax = after.x - next.x, az = after.z - next.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      const past = look - toNode + next.size * 0.3;
      tx = next.x + ax * past - az * lane;
      tz = next.z + az * past + ax * lane;
    }
    let want = Math.atan2(tz - c.z, tx - c.x) - c.h;
    while (want > Math.PI) want -= Math.PI * 2;
    while (want < -Math.PI) want += Math.PI * 2;
    c.steer = Math.max(-1, Math.min(1, want * 2.4));
    const v = c.forward;
    c.throttle = v < speed - 1 ? 1 : v < speed ? 0.4 : 0;
    c.brake = v > speed + 1.5 ? Math.min(1, (v - speed) / 5) : 0;
    if (Math.abs(want) > 1.6 && c.v < 4) { c.throttle = 0.6; c.steer = Math.sign(want); } // (turned right round: get going again)
  }

  // The speed to be doing now so as to take the corner at `next` (or carry straight on)
  private cornerSpeed(c: Car, next: Node, after: Node | null, radius: number) {
    const top = TOP * c.stats.top * c.spec.skill * (1 + c.boost);
    if (!c.prev || !after) return top; // (traffic is slow enough to turn anywhere)
    const ax = next.x - c.prev.x, az = next.z - c.prev.z, bx = after.x - next.x, bz = after.z - next.z;
    const turn = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
    if (turn > 0.95) return top;
    const corner = Math.sqrt(GRIP * c.stats.grip * (1 - 0.3 * this.wet) * radius);
    const dist = Math.max(0, Math.hypot(next.x - c.x, next.z - c.z) - next.size / 2);
    return Math.min(top, Math.sqrt(corner * corner + 2 * BRAKE * 0.75 * dist));
  }

  // How far to the stop line, if the light at `next` is red (or turning red) for the way this car comes in
  private redAhead(c: Car, next: Node) {
    if (!next.lights || !c.prev) return null;
    const axis = Math.abs(next.x - c.prev.x) > Math.abs(next.z - c.prev.z) ? 'x' : 'z';
    const k = this.city.signal(next, axis, this.t), dist = Math.hypot(next.x - c.x, next.z - c.z) - next.size / 2 - 4;
    if (dist < -1) return null; // (over the line already: keep going)
    if (k === 'red' || (k === 'amber' && dist > 15)) return Math.max(0, dist);
    return null;
  }

  private reached(c: Car, n: Node) { return Math.abs(c.x - n.x) < n.size / 2 && Math.abs(c.z - n.z) < n.size / 2; }
  private distTo(a: Car, b: Car) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // Nothing in a lane (m right of the street's middle) from a little behind to a good way ahead?
  private laneClear(c: Car, lane: number) {
    const fx = Math.cos(c.h), fz = Math.sin(c.h);
    return this.cars.every((o) => {
      if (o === c || !o.active) return true;
      const dx = o.x - c.x, dz = o.z - c.z, along = dx * fx + dz * fz, across = dx * -fz + dz * fx;
      const myAcross = lane - c.lane; // (where that lane is, from here)
      return along < -8 || along > 55 || Math.abs(across - myAcross) > 2.6;
    });
  }

  // The nearest car in front, in its line
  private ahead(c: Car, range: number) {
    const fx = Math.cos(c.h), fz = Math.sin(c.h);
    let best: Car | null = null, bd = range;
    for (const o of this.cars) {
      if (o === c || !o.active) continue;
      const dx = o.x - c.x, dz = o.z - c.z, along = dx * fx + dz * fz, across = Math.abs(dx * -fz + dz * fx);
      if (along > 0 && along < bd && across < (c.stats.width + o.stats.width) * 0.6) { bd = along; best = o; }
    }
    return best;
  }

  // --- the traffic: kept round the racers ---------------------------------------------------------------
  private keepTraffic() {
    const racers = this.racers, city = this.city;
    if (!racers.length) return;
    const near = (x: number, z: number) => Math.min(...racers.map((r) => Math.hypot(r.x - x, r.z - z)));
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.spec.kind === 'traffic' && near(c.x, c.z) > 650) this.cars.splice(i, 1);
    }
    let n = this.traffic.length;
    for (let tries = 0; n < this.trafficWanted && tries < 6; tries++) {
      const e: Edge = city.edges[Math.floor(this.rnd() * city.edges.length)];
      if (e.kind === 'alley' || e.length < 50) continue;
      const t = 0.25 + this.rnd() * 0.5, x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t, d = near(x, z);
      if (d < 140 || d > 600) continue;
      const fwd = this.rnd() < 0.5, from = fwd ? e.a : e.b, to = fwd ? e.b : e.a;
      const dx = Math.sign(to.x - from.x), dz = Math.sign(to.z - from.z), lane = e.kind === 'avenue' ? (this.rnd() < 0.5 ? 2.4 : 6.4) : 3.2;
      if (this.cars.some((o) => Math.hypot(o.x - x, o.z - z) < 12)) continue;
      const spec = this.trafficTypes[Math.floor(this.rnd() * this.trafficTypes.length)];
      const c = new Car({ ...spec, id: `t${Math.floor(this.rnd() * 1e9)}` });
      c.x = x - dz * lane;
      c.z = z + dx * lane;
      c.h = Math.atan2(dz, dx);
      c.vx = dx * 11; c.vz = dz * 11;
      c.prev = from; c.next = to; c.lane = lane;
      this.cars.splice(this.cars.indexOf(this.police), 0, c);
      n++;
    }
  }

  // --- red lights, and the police -------------------------------------------------------------------------
  private lights(ev: Events, green: boolean) {
    const city = this.city;
    for (const c of this.racers) {
      // into a junction: across its stop line on red?
      let inside: Node | null = null;
      for (const n of city.nodes) if (n.lights && Math.abs(c.x - n.x) < n.size / 2 && Math.abs(c.z - n.z) < n.size / 2) { inside = n; break; }
      if (inside && inside !== c.inNode && green && this.t > START_CLEAR && c.finish === null) {
        const axis = Math.abs(Math.cos(Math.atan2(c.vz, c.vx))) > 0.7 ? 'x' : 'z';
        if (c.v > 3 && city.signal(inside, axis, this.t) === 'red') { ev.violation.push(c); this.wanted(c, ev); }
      }
      c.inNode = inside;
    }
  }

  // Someone ran a red: the police come after them, unless they're after someone already (a person running a
  // red takes them off a computer driver)
  private wanted(c: Car, ev: Events) {
    const now = this.chasing;
    if (c.held > 0 || (now && (!now.spec.ai || c.spec.ai)) || this.blockFrom) return;
    // in from a junction behind them, 80 to 220 m back
    const fx = Math.cos(c.h), fz = Math.sin(c.h), p = this.police;
    let best: Node | null = null;
    for (const n of this.city.nodes) {
      if (!n.edges.length) continue;
      const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot(dx, dz);
      if (d > 80 && d < 220 && dx * fx + dz * fz < -40 && (!best || d < Math.hypot(best.x - c.x, best.z - c.z))) best = n;
    }
    if (!best) return;
    p.active = true;
    p.x = best.x; p.z = best.z;
    p.h = Math.atan2(c.z - best.z, c.x - best.x);
    p.vx = Math.cos(p.h) * 15; p.vz = Math.sin(p.h) * 15;
    p.spin = p.spinning = 0;
    p.prev = null; p.next = best;
    this.chasing = c;
    this.chaseT = this.close = 0;
    this.routeT = 0;
    ev.chased.push(c);
  }

  private drivePolice(p: Car, ev: Events) {
    const target = this.chasing;
    // holding someone: across in front of them, lights going, until they're let go
    if (this.blockFrom && target) {
      this.blockT += TICK;
      const k = Math.min(1, this.blockT / 0.8), fx = Math.cos(target.h), fz = Math.sin(target.h);
      const want = { x: target.x + fx * (target.stats.length / 2 + p.stats.width / 2 + 1.2), z: target.z + fz * (target.stats.length / 2 + p.stats.width / 2 + 1.2), h: target.h + Math.PI / 2 };
      p.x = this.blockFrom.x + (want.x - this.blockFrom.x) * k;
      p.z = this.blockFrom.z + (want.z - this.blockFrom.z) * k;
      p.h = this.blockFrom.h + angleTo(this.blockFrom.h, want.h) * k;
      p.vx = p.vz = 0;
      p.throttle = 0; p.brake = 1; p.steer = 0;
      if (target.held <= 0) { this.blockFrom = null; this.chasing = null; this.leaving = 4; ev.released.push(target); }
      return;
    }
    if (!target) {
      // off again (after a while, gone)
      if (this.leaving > 0) {
        this.leaving -= TICK;
        p.throttle = 0.8; p.brake = 0; p.steer = 0;
        if (this.leaving <= 0) { p.active = false; p.x = p.z = -9999; }
      } else { p.active = false; p.x = p.z = -9999; }
      return;
    }
    this.chaseT += TICK;
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    if (this.chaseT > POLICE_GIVES_UP || d > POLICE_LOSES || target.finish !== null) {
      this.chasing = null;
      this.leaving = 3;
      ev.escaped.push(target);
      return;
    }
    // close: straight at them (to the side of them, to get alongside); further off: by the streets
    if (d < 45) {
      const fx = Math.cos(target.h), fz = Math.sin(target.h);
      const tx = target.x + fx * 4 - fz * 2.6, tz = target.z + fz * 4 + fx * 2.6;
      let want = Math.atan2(tz - p.z, tx - p.x) - p.h;
      while (want > Math.PI) want -= Math.PI * 2;
      while (want < -Math.PI) want += Math.PI * 2;
      p.steer = Math.max(-1, Math.min(1, want * 2.6));
      const match = target.forward + (d - 5) * 1.2;
      p.throttle = p.forward < match ? 1 : 0;
      p.brake = p.forward > match + 4 ? 0.5 : 0;
    } else {
      // by the streets: every half second, how far each junction is from them; at each junction, the street
      // that gets closest
      this.routeT -= TICK;
      if (this.routeT <= 0) { this.routeT = 0.5; this.goal = this.distancesTo(target.x + Math.cos(target.h) * 25, target.z + Math.sin(target.h) * 25); }
      const best = (at: Node, not: Node | null) => {
        let pick: Node | null = null, cost = Infinity;
        for (const e of at.edges) {
          const o = this.city.other(e, at), k = (this.goal.get(o) ?? Infinity) + e.length;
          if (o !== not && k < cost) { cost = k; pick = o; }
        }
        return pick ?? not;
      };
      if (!p.next || this.reached(p, p.next)) {
        const at = p.next ?? this.nearestNode(p.x, p.z);
        const next = best(at, p.prev);
        p.prev = at;
        p.next = next;
      }
      if (p.next) { const after = best(p.next, p.prev); this.steerTo(p, p.next, after, 0, this.cornerSpeed(p, p.next, after, CORNER_R + 2)); }
    }
    // caught: close beside or behind them for a moment (or rammed them)
    this.close = d < 7.5 ? this.close + TICK : Math.max(0, this.close - TICK * 0.5);
    if (this.close > 0.8) {
      target.held = POLICE_HOLD;
      this.blockFrom = { x: p.x, z: p.z, h: p.h };
      this.blockT = 0;
      ev.pulledOver.push(target);
    }
  }

  private goal = new Map<Node, number>();
  private nearestNode(x: number, z: number) {
    let best = this.city.finish, bd = Infinity;
    for (const n of this.city.nodes) { if (!n.edges.length) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  // How far each junction is from the one nearest a point, by road (Dijkstra: it's a small city)
  private distancesTo(x: number, z: number) {
    const start = this.nearestNode(x, z), dist = new Map<Node, number>([[start, 0]]), done = new Set<Node>();
    while (true) {
      let u: Node | null = null;
      for (const [n, d] of dist) if (!done.has(n) && (!u || d < dist.get(u)!)) u = n;
      if (!u) break;
      done.add(u);
      for (const e of u.edges) {
        const o = this.city.other(e, u), via = dist.get(u)! + e.length;
        if (via < (dist.get(o) ?? Infinity)) dist.set(o, via);
      }
    }
    return dist;
  }

  // --- near misses: past an ordinary car going quicker, with less than 1.8 m between you ------------------
  private nearMisses(ev: Events) {
    for (const c of this.racers) {
      if (c.finish !== null) continue;
      const fx = Math.cos(c.h), fz = Math.sin(c.h);
      for (const o of this.cars) {
        if (o.spec.kind !== 'traffic') continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
        const along = dx * fx + dz * fz, key = c.id + o.id, was = this.passing.get(key);
        this.passing.set(key, along);
        if (was === undefined || was <= 0 || along > 0) continue;
        const clear = Math.abs(dx * -fz + dz * fx) - (o.stats.width + c.stats.width) / 2;
        if (clear < 1.8 && c.bumped > 0.8 && c.v > 12) ev.near.push(c);
      }
    }
    if (this.passing.size > 4000) this.passing.clear();
  }
}

// A car's two round ends (front and back), for hitting things
function ends(c: Car) {
  const r = c.stats.width / 2, off = Math.max(0, c.stats.length / 2 - r), fx = Math.cos(c.h), fz = Math.sin(c.h);
  return [{ x: c.x + fx * off, z: c.z + fz * off, r }, { x: c.x - fx * off, z: c.z - fz * off, r }];
}

const angleTo = (from: number, to: number) => { let a = to - from; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// Does this computer driver stop at this junction's red light? Mostly; the same answer every time it's asked
const RUNS_REDS = 0.3;
function obeys(c: Car, n: Node) {
  let h = n.id * 31 + Math.floor(n.phase * 7);
  for (const ch of c.id) h = (h * 33 + ch.charCodeAt(0)) % 100003;
  return (h % 100) / 100 >= RUNS_REDS;
}
