// The circuit map in the corner of each driver's view: the whole track from above, the pit lane,
// and every car on it as a dot (yours bigger, with a ring; the other people in their colours), so
// you can see where you are on the lap and where everyone else is. Drawn on a 2D canvas.
import type { Car } from '@racing/race.ts';
import type { Track } from '@racing/track.ts';
import type { PitLane } from './pits.ts';

const SAMPLES = 400;

export class CircuitMap {
  private pts: { x: number; z: number }[] = [];
  private pit: { x: number; z: number }[] = [];
  private box = { x0: 0, z0: 0, x1: 1, z1: 1 };

  constructor(readonly track: Track, pits: PitLane) {
    const L = track.length;
    for (let i = 0; i < SAMPLES; i++) { const p = track.point((i / SAMPLES) * L, 0); this.pts.push({ x: p.x, z: p.z }); }
    for (let s = pits.from; s <= pits.to; s += 10) { const p = track.point(s, pits.lane); this.pit.push({ x: p.x, z: p.z }); }
    const xs = this.pts.map((p) => p.x), zs = this.pts.map((p) => p.z);
    this.box = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
  }

  // `me`: whose view it is (null: the TV's); `people`: the cars people are driving
  draw(cv: HTMLCanvasElement, cars: Car[], me: Car | null, people: Set<Car>, where: (c: Car) => { d: number } | null) {
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { x0, z0, x1, z1 } = this.box, pad = 10;
    const k = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (z1 - z0 || 1));
    const ox = (w - (x1 - x0) * k) / 2, oz = (h - (z1 - z0) * k) / 2;
    const X = (x: number) => ox + (x - x0) * k, Z = (z: number) => oz + (z - z0) * k;
    const line = (pts: { x: number; z: number }[], close: boolean) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
      if (close) g.closePath();
    };
    g.lineJoin = g.lineCap = 'round';
    line(this.pts, true);
    g.strokeStyle = 'rgba(7, 8, 11, 0.75)'; g.lineWidth = 8; g.stroke();
    g.strokeStyle = 'rgba(232, 230, 223, 0.55)'; g.lineWidth = 4; g.stroke();
    line(this.pit, false);
    g.strokeStyle = 'rgba(255, 194, 61, 0.6)'; g.lineWidth = 2; g.stroke();
    // the start/finish line
    const a = this.track.point(0, -this.track.width / 2), b = this.track.point(0, this.track.width / 2);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3;
    const mx = (X(a.x) + X(b.x)) / 2, mz = (Z(a.z) + Z(b.z)) / 2, ux = X(a.x) - X(b.x), uz = Z(a.z) - Z(b.z), ul = Math.hypot(ux, uz) || 1;
    g.beginPath(); g.moveTo(mx + (ux / ul) * 5, mz + (uz / ul) * 5); g.lineTo(mx - (ux / ul) * 5, mz - (uz / ul) * 5); g.stroke();

    // the cars: the field first, then the people, then you on top
    const order = [...cars].sort((p, q) => rank(p) - rank(q));
    function rank(c: Car) { return c === me ? 2 : people.has(c) ? 1 : 0; }
    for (const c of order) {
      const at = where(c);
      if (!at) continue;
      const p = this.track.point(c.dist, at.d), x = X(p.x), z = Z(p.z);
      const r = c === me ? 5.5 : people.has(c) ? 4.5 : 3;
      g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2);
      g.fillStyle = c === me || people.has(c) ? c.spec.color : 'rgba(232, 230, 223, 0.85)';
      g.fill();
      g.lineWidth = c === me ? 2.5 : 1.2; g.strokeStyle = c === me ? '#ffffff' : 'rgba(7, 8, 11, 0.9)'; g.stroke();
    }
  }
}
