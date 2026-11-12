// Pool: the computer player. It looks for pots the way a player does (a ball, a pocket, a clear line for both,
// a cut it can make), then plays the best few on a copy of the table with the real physics to see which go in
// and where the cue ball ends up. Then it shoots with a little human error: more on Easy, very little on Hard.
// It thinks a few milliseconds a frame (a generator, stepped by the game), so the screen never stalls.
import { FOOT_X, HEAD_X, L, POCKETS, R, Table, W } from './physics.ts';
import { advance, judge, onTheEight, targets, type Frame, type Verdict } from './rules.ts';

export interface Shot {
  angle: number;
  speed: number; // m/s
  side: number; // -1..1
  height: number; // -1..1
  place: { x: number; y: number } | null; // where it puts the cue ball (in hand)
}

// aim: how far off its aim can be (degrees, one standard deviation); power: the same for speed (a fraction);
// tries: how many shots it plays out on a copy of the table before choosing; position: does it care where the
// cue ball stops
export const LEVELS = [
  { name: 'Easy', aim: 1.2, power: 0.14, tries: 4, position: false },
  { name: 'Medium', aim: 0.45, power: 0.07, tries: 18, position: false },
  { name: 'Hard', aim: 0.14, power: 0.035, tries: 60, position: true },
];

interface Pot { target: number; pocket: number; angle: number; cut: number; score: number; d1: number; d2: number }

// Is the straight path from (x1, y1) to (x2, y2) clear of balls, for a ball of radius R? (skip: balls that don't count)
function clear(t: Table, x1: number, y1: number, x2: number, y2: number, skip: number[]) {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1e-9;
  for (const b of t.balls) {
    if (b.state !== 'table' || skip.includes(b.n)) continue;
    const k = Math.max(0, Math.min(1, ((b.x - x1) * dx + (b.y - y1) * dy) / len2));
    if ((b.x - x1 - dx * k) ** 2 + (b.y - y1 - dy * k) ** 2 < (2 * R - 0.001) ** 2) return false;
  }
  return true;
}

// Every pot it could see from the cue ball at (cx, cy), best first
export function pots(t: Table, cx: number, cy: number, legal: number[]): Pot[] {
  const out: Pot[] = [];
  for (const n of legal) {
    const b = t.balls[n];
    if (b.state !== 'table') continue;
    POCKETS.forEach((p, i) => {
      // aim a little into the pocket, past its mouth
      const ax = p.mx + p.ux * 0.02, ay = p.my + p.uy * 0.02;
      let ux = ax - b.x, uy = ay - b.y;
      const d2 = Math.hypot(ux, uy);
      ux /= d2; uy /= d2;
      // too steep into the pocket: the jaws turn it away
      if (ux * p.ux + uy * p.uy < Math.cos(((p.side ? 52 : 58) * Math.PI) / 180)) return;
      const gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R; // the ghost ball: where the cue ball must be at contact
      if (Math.abs(gx) > L / 2 - R + 0.002 || Math.abs(gy) > W / 2 - R + 0.002) return;
      let vx = gx - cx, vy = gy - cy;
      const d1 = Math.hypot(vx, vy);
      if (d1 < 1e-4) return;
      vx /= d1; vy /= d1;
      const cosCut = vx * ux + vy * uy;
      if (cosCut < Math.cos((78 * Math.PI) / 180)) return;
      if (!clear(t, b.x, b.y, ax, ay, [0, n]) || !clear(t, cx, cy, gx, gy, [0, n])) return;
      // harder the longer both lines, the thinner the cut, and into a side pocket at an angle
      const across = 1 - (ux * p.ux + uy * p.uy);
      const score = cosCut ** 1.5 / ((0.25 + d1) * (0.25 + d2)) * (p.side ? 0.8 - across : 1 - across * 0.4);
      out.push({ target: n, pocket: i, angle: Math.atan2(vy, vx), cut: Math.acos(Math.min(1, cosCut)), score, d1, d2 });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// About how fast to hit it: enough for the object ball to reach the pocket with some to spare
function speedFor(p: Pot) {
  const obj = Math.sqrt(2 * 0.11 * (p.d2 + 0.45)) / (5 / 7); // (it slides off the hit, losing 2/7 of its speed)
  const atContact = obj / (0.97 * Math.max(0.2, Math.cos(p.cut)));
  const start = Math.sqrt(atContact * atContact + 2 * 0.3 * p.d1);
  return Math.max(0.9, Math.min(6.5, start * 1.15));
}

const gauss = () => {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};

// Play a shot out on a copy of the table: the verdict and the table after it
function tryShot(t: Table, f: Frame, s: Shot) {
  const copy = t.clone();
  if (s.place) { copy.cue.x = s.place.x; copy.cue.y = s.place.y; }
  const was = onTheEight(f, copy);
  const legal = targets(f, copy);
  copy.strike(s.angle, s.speed, s.side, s.height);
  copy.settle(20);
  return { verdict: judge(f, copy, copy.events, was, legal), after: copy };
}

// How good is the position for the next shot (the best pot it would have next)
function nextScore(f: Frame, v: Verdict, after: Table) {
  const g = { ...f, groups: [...f.groups] as Frame['groups'], shots: [...f.shots] as Frame['shots'] };
  advance(g, v);
  if (g.turn !== f.turn) return 0;
  const best = pots(after, after.cue.x, after.cue.y, targets(g, after))[0];
  return best ? best.score : 0;
}

export class Planner {
  shot: Shot | null = null;
  private gen: Generator<void, Shot>;

  constructor(t: Table, f: Frame, level: number) {
    this.gen = this.think(t, f, LEVELS[level]);
  }

  // Think for up to `ms`; true once the shot is chosen
  step(ms: number) {
    if (this.shot) return true;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const r = this.gen.next();
      if (r.done) { this.shot = r.value; return true; }
    }
    return false;
  }

  private *think(t: Table, f: Frame, lv: (typeof LEVELS)[number]): Generator<void, Shot> {
    if (f.breakShot) return this.err(this.breakShot(t), lv, true);
    const legal = targets(f, t);
    // Where to put the cue ball, if it's in hand: behind the best pots it can find
    const places: ({ x: number; y: number } | null)[] = f.inHand === 'none' ? [null] : this.placings(t, f, legal);
    let best: { s: Shot; value: number } | null = null;
    let tried = 0;
    for (const place of places) {
      const cx = place ? place.x : t.cue.x, cy = place ? place.y : t.cue.y;
      const list = pots(t, cx, cy, legal).slice(0, Math.max(1, Math.ceil(lv.tries / 6)));
      for (const p of list) {
        const base = speedFor(p);
        const spins = lv.position ? [[0, 0], [0, 0.6], [0, -0.7], [0, 0.2]] : [[0, 0]];
        for (const k of lv.tries > 4 ? [1, 0.75, 1.4] : [1]) {
          for (const [side, height] of spins) {
            if (tried++ >= lv.tries) break;
            const s: Shot = { angle: p.angle, speed: Math.min(7, base * k), side, height, place };
            const { verdict, after } = tryShot(t, f, s);
            yield;
            const good = verdict.winner === f.turn || (!verdict.foul && verdict.keepTurn && verdict.winner === null);
            if (!good) continue;
            // a sure pot is worth the most; then the next shot it leaves (Hard), and a gentler stroke
            const value = 10 + (verdict.winner === f.turn ? 100 : 0) + p.score + (lv.position ? nextScore(f, verdict, after) * 2 : 0) - k * 0.1;
            if (!best || value > best.value) best = { s, value };
          }
        }
      }
    }
    // Nothing it's sure of: Easy (and anyone, on the 8 or a clear pot) just goes for the best-looking pot
    const first = places[0];
    const fx = first ? first.x : t.cue.x, fy = first ? first.y : t.cue.y;
    if (!best && lv.tries <= 4) {
      const p = pots(t, fx, fy, legal)[0];
      if (p) best = { s: { angle: p.angle, speed: speedFor(p), side: 0, height: 0, place: first }, value: 0 };
    }
    if (!best) best = { s: yield* this.safety(t, f, legal, first), value: 0 };
    return this.err(best.s, lv, false);
  }

  // No pot: hit one of its balls so that something reaches a cushion, leaving the cue ball awkward if it can
  private *safety(t: Table, f: Frame, legal: number[], place: { x: number; y: number } | null): Generator<void, Shot> {
    const cx = place ? place.x : t.cue.x, cy = place ? place.y : t.cue.y;
    let best: { s: Shot; value: number } | null = null;
    const aims: number[] = [];
    for (const n of legal) {
      const b = t.balls[n], d = Math.hypot(b.x - cx, b.y - cy), base = Math.atan2(b.y - cy, b.x - cx);
      const half = Math.asin(Math.min(1, (1.6 * R) / d));
      aims.push(base, base + half * 0.5, base - half * 0.5);
      // off a cushion, if there's no straight way to it: aim at its mirror image in each cushion
      for (const [mx, my] of [[L / 2 - R, 0], [-L / 2 + R, 0], [0, W / 2 - R], [0, -W / 2 + R]]) {
        const ix = mx ? 2 * mx - b.x : b.x, iy = my ? 2 * my - b.y : b.y;
        aims.push(Math.atan2(iy - cy, ix - cx));
      }
    }
    for (const angle of aims) {
      for (const speed of [1.4, 2.6]) {
        const s: Shot = { angle, speed, side: 0, height: 0, place };
        const { verdict, after } = tryShot(t, f, s);
        yield;
        if (verdict.foul && verdict.winner === null) { if (!best) best = { s, value: -100 }; continue; }
        if (verdict.winner !== null && verdict.winner !== f.turn) continue;
        // a pot by accident is fine; otherwise leave the other player the worst next shot
        const g = { ...f, turn: (1 - f.turn) as 0 | 1 };
        const theirs = verdict.keepTurn ? -1 : (pots(after, after.cue.x, after.cue.y, targets(g, after))[0]?.score ?? 0);
        const value = -theirs + Math.random() * 0.05;
        if (!best || best.value === -100 || value > best.value) best = { s, value };
      }
    }
    return best?.s ?? { angle: Math.atan2(t.balls[legal[0]].y - cy, t.balls[legal[0]].x - cx), speed: 2, side: 0, height: 0, place };
  }

  // Cue ball in hand: spots behind the best pots, at a small angle (to send the cue ball on), within the rules
  private placings(t: Table, f: Frame, legal: number[]) {
    const kitchen = f.inHand === 'kitchen';
    const spots: { x: number; y: number; score: number }[] = [];
    for (const n of legal) {
      const b = t.balls[n];
      for (const pocket of POCKETS) {
        let ux = pocket.mx - b.x, uy = pocket.my - b.y;
        const d = Math.hypot(ux, uy);
        ux /= d; uy /= d;
        for (const cut of [0, 12, -12, 25, -25]) {
          for (const back of [0.18, 0.35, 0.6]) {
            const a = Math.atan2(uy, ux) + (cut * Math.PI) / 180;
            const x = b.x - ux * 2 * R - Math.cos(a) * back, y = b.y - uy * 2 * R - Math.sin(a) * back;
            if (!t.canPlace(x, y, kitchen)) continue;
            const best = pots(t, x, y, legal)[0];
            if (best) spots.push({ x, y, score: best.score });
          }
        }
      }
    }
    // (in the kitchen, the good spots might all be out of bounds: try a row along the head string)
    for (let y = -W / 2 + 0.1; y <= W / 2 - 0.1; y += 0.1) {
      for (const x of kitchen ? [HEAD_X - 0.05, HEAD_X - 0.3] : [-0.6, 0, 0.6]) {
        if (!t.canPlace(x, y, kitchen)) continue;
        spots.push({ x, y, score: pots(t, x, y, legal)[0]?.score ?? -1 });
      }
    }
    spots.sort((a, b) => b.score - a.score);
    return spots.length ? spots.slice(0, 3) : [{ x: HEAD_X - 0.2, y: 0 }];
  }

  // The break: from the kitchen, hard into the front ball, a touch below centre to keep the cue ball near the middle
  private breakShot(t: Table): Shot {
    const y = (Math.random() - 0.5) * 0.3, x = HEAD_X - 0.02;
    const front = t.balls.filter((b) => b.n && b.state === 'table').sort((a, b) => Math.hypot(a.x - FOOT_X, a.y) - Math.hypot(b.x - FOOT_X, b.y))[0];
    return { angle: Math.atan2(front.y - y, front.x - x), speed: 8.2 + Math.random() * 0.6, side: 0, height: -0.15, place: { x, y } };
  }

  // The human touch: a little off in aim and strength
  private err(s: Shot, lv: (typeof LEVELS)[number], isBreak: boolean): Shot {
    const aim = (isBreak ? 0.4 : lv.aim) * (Math.PI / 180);
    return { ...s, angle: s.angle + gauss() * aim, speed: Math.max(0.4, s.speed * (1 + gauss() * lv.power)) };
  }
}
