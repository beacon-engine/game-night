// The oval: two straights joined by two banked half-circle turns, run anticlockwise (left turns).
// Everything is measured along it: `s` is the distance from the start/finish line (the middle of the
// front straight), `d` the distance sideways from the racing surface's centre line, outward positive.
// No graphics here: the race (race.ts) and the scenery (scene.ts) both work from these numbers.

export interface TrackPoint {
  x: number; // centre line, metres (y is up; the oval lies in x/z)
  z: number;
  hx: number; // which way the track runs here (unit vector)
  hz: number;
  k: number; // curvature: 1/radius in the turns, 0 on the straights
}

export class Track {
  readonly length: number;
  readonly turns: [number, number][]; // [start, end] of each turn, in s

  constructor(
    readonly straight = 380, // m
    readonly radius = 110, // of the centre line in the turns
    readonly width = 20, // from the inside edge to the outside wall
    readonly bankTurns = 24, // degrees
    readonly bankStraights = 5,
  ) {
    const half = straight / 2, arc = Math.PI * radius;
    this.length = 2 * straight + 2 * arc;
    this.turns = [[half, half + arc], [half + arc + straight, half + 2 * arc + straight]];
  }

  // s wrapped into one lap
  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }

  // The shortest way from b to a along the track: positive if a is ahead
  gap(a: number, b: number) {
    const L = this.length;
    return ((((a - b) % L) + L * 1.5) % L) - L / 2;
  }

  at(s: number): TrackPoint {
    const { straight: S, radius: R } = this;
    const half = S / 2, arc = Math.PI * R;
    let u = this.wrap(s);
    if (u < half) return { x: u, z: R, hx: 1, hz: 0, k: 0 }; // front straight, after the line
    u -= half;
    if (u < arc) { // turns 1 and 2
      const a = u / R;
      return { x: half + R * Math.sin(a), z: R * Math.cos(a), hx: Math.cos(a), hz: -Math.sin(a), k: 1 / R };
    }
    u -= arc;
    if (u < S) return { x: half - u, z: -R, hx: -1, hz: 0, k: 0 }; // back straight
    u -= S;
    if (u < arc) { // turns 3 and 4
      const a = u / R;
      return { x: -half - R * Math.sin(a), z: -R * Math.cos(a), hx: -Math.cos(a), hz: Math.sin(a), k: 1 / R };
    }
    u -= arc;
    return { x: -half + u, z: R, hx: 1, hz: 0, k: 0 }; // front straight, up to the line
  }

  // How far into a turn's banking we are: 0 on the straights, 1 in the turns, eased in between
  turnness(s: number) {
    const u = this.wrap(s), ease = 70;
    let best = 0;
    for (const [a, b] of this.turns) {
      if (u >= a && u <= b) return 1;
      const out = Math.min(Math.abs(this.gap(u, a)), Math.abs(this.gap(u, b)));
      if (out < ease) best = Math.max(best, smooth(1 - out / ease));
    }
    return best;
  }

  // The banking here, in radians (the outside is higher)
  bank(s: number) {
    const t = this.turnness(s);
    return ((this.bankStraights + (this.bankTurns - this.bankStraights) * t) * Math.PI) / 180;
  }

  // A point on the racing surface: d sideways (outward +), raised by the banking
  point(s: number, d: number) {
    const p = this.at(s);
    const y = Math.max(0, d + this.width / 2) * Math.tan(this.bank(s));
    return { x: p.x - p.hz * d, y, z: p.z + p.hx * d, p }; // (outward is the right of travel: (-hz, hx))
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
