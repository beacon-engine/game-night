// A track, from its description in tracks.json: the first half of a lap as straights and left
// turns, from the start/finish line round to the middle of the back straight. The second half is
// the same in mirror image, so every track closes up by construction:
//
//   { "half": [{ "straight": 190 }, { "turn": 180, "radius": 110, "bank": 24 }] }   (an oval)
//
// The half has to turn through 180°; a last straight back to the middle is added for you.
// Everything is measured along the lap (`s`, from the line) and across it (`d`, outward +).
// No graphics here: the race (race.ts) and the scenery (scene.ts) both work from these numbers.

export interface Segment { straight?: number; turn?: number; radius?: number; bank?: number }

export interface TrackSpec {
  id: string;
  name: string;
  about: string; // a line for the lobby
  time: 'day' | 'dusk' | 'night';
  scenery: 'countryside' | 'desert' | 'harbour' | 'city';
  width: number; // m, from the inside edge to the outside wall
  bankStraights: number; // degrees
  half: Segment[];
}

export interface TrackPoint {
  x: number; // centre line, metres (y is up; the track lies in x/z)
  z: number;
  hx: number; // which way the track runs here (unit vector)
  hz: number;
  k: number; // curvature: 1/radius in the turns, 0 on the straights
}

const STEP = 1; // m between the samples the lap is stored as
const BANK_EASE = 35; // m over which the banking changes, either side of where a turn starts or ends

export class Track {
  readonly length: number;
  readonly width: number;
  private pts: TrackPoint[] = [];
  private banks: number[] = []; // radians, per sample

  constructor(readonly spec: TrackSpec) {
    this.width = spec.width;
    const half = spec.half;
    const turned = half.reduce((a, s) => a + (s.turn ?? 0), 0);
    if (Math.abs(turned - 180) > 0.01) throw new Error(`${spec.id}: the half lap turns ${turned}°, not 180°`);

    // trace the half, to find the straight that brings it back to the middle
    const end = trace(half);
    if (end.x < -0.01) throw new Error(`${spec.id}: the half lap overshoots the middle by ${(-end.x).toFixed(1)} m`);
    const rest: Segment = { straight: Math.max(0, end.x) };
    const lap = [...half, rest, rest, ...[...half].reverse()];

    // walk the whole lap a metre at a time
    let x = 0, z = 0, a = 0; // a: heading, turning left as it grows
    const raw: { p: TrackPoint; bank: number }[] = [];
    for (const seg of lap) {
      const len = segmentLength(seg);
      const k = seg.turn ? Math.sign(seg.turn) / seg.radius! : 0;
      const bank = ((seg.turn ? seg.bank ?? spec.bankStraights : spec.bankStraights) * Math.PI) / 180;
      const n = Math.max(1, Math.round(len / STEP)), ds = len / n;
      for (let i = 0; i < n; i++) {
        raw.push({ p: { x, z, hx: Math.cos(a), hz: -Math.sin(a), k }, bank });
        const mid = a + (k * ds) / 2;
        x += Math.cos(mid) * ds;
        z -= Math.sin(mid) * ds;
        a += k * ds;
      }
    }
    // close the tiny gap rounding leaves, and centre the track on the origin
    const n = raw.length;
    let cx = 0, cz = 0;
    raw.forEach((r, i) => { r.p.x -= (x * i) / n; r.p.z -= (z * i) / n; cx += r.p.x / n; cz += r.p.z / n; });
    for (const r of raw) { r.p.x -= cx; r.p.z -= cz; }
    this.pts = raw.map((r) => r.p);
    this.length = lap.reduce((sum, g) => sum + segmentLength(g), 0);

    // banking eases between straights and turns (a moving average over BANK_EASE either side)
    const w = Math.round(BANK_EASE / STEP);
    this.banks = raw.map((_, i) => {
      let sum = 0;
      for (let j = -w; j <= w; j++) sum += raw[(i + j + n) % n].bank;
      return sum / (2 * w + 1);
    });
  }

  get name() { return this.spec.name; }

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
    const u = this.wrap(s) / (this.length / this.pts.length);
    const i = Math.floor(u), t = u - i;
    const p = this.pts[i % this.pts.length], q = this.pts[(i + 1) % this.pts.length];
    const hx = p.hx + (q.hx - p.hx) * t, hz = p.hz + (q.hz - p.hz) * t, h = Math.hypot(hx, hz);
    return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, hx: hx / h, hz: hz / h, k: p.k };
  }

  // The banking here, in radians (the outside is higher)
  bank(s: number) {
    const u = this.wrap(s) / (this.length / this.pts.length);
    const i = Math.floor(u), t = u - i, n = this.banks.length;
    return this.banks[i % n] * (1 - t) + this.banks[(i + 1) % n] * t;
  }

  // A point on the racing surface: d sideways (outward +), raised by the banking
  point(s: number, d: number) {
    const p = this.at(s);
    const y = Math.max(0, d + this.width / 2) * Math.tan(this.bank(s));
    return { x: p.x - p.hz * d, y, z: p.z + p.hx * d, p }; // (outward is the right of travel: (-hz, hx))
  }
}

// Where a list of segments ends up, starting at the origin heading +x
function trace(segs: Segment[]) {
  let x = 0, z = 0, a = 0;
  for (const s of segs) {
    if (s.straight) { x += Math.cos(a) * s.straight; z -= Math.sin(a) * s.straight; continue; }
    const turn = (s.turn! * Math.PI) / 180;
    // along an arc: the chord, at half the turn
    const chord = 2 * s.radius! * Math.sin(Math.abs(turn) / 2);
    x += Math.cos(a + turn / 2) * chord;
    z -= Math.sin(a + turn / 2) * chord;
    a += turn;
  }
  return { x, z, a };
}

const segmentLength = (s: Segment) => s.straight ?? (Math.abs(s.turn!) * Math.PI * s.radius!) / 180;
