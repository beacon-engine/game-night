// Pool: the ball physics. No drawing here (and nothing from the browser), so the computer player can run
// whole shots ahead on a copy of the table, and node can run it in a test.
//
// Units are metres, seconds and radians. The table is flat: x runs along its length (the head, where you break
// from, is at -x), y across it, z up. Each ball has a velocity on the cloth (vx, vy) and a spin (wx, wy, wz):
// wx and wy roll it (top and back spin), wz is side spin. What happens, in order of a substep:
//   - The cloth: a ball whose bottom slides over the cloth (just struck, or with draw or follow) feels sliding
//     friction at its contact point, which slows the slide and turns it into a roll at 2/7 of the rate it changes
//     the speed. Rolling, it only feels the much smaller rolling resistance. Side spin dies away slowly.
//   - Balls: equal masses, nearly elastic. The surfaces rub (the friction falls off with how fast they slide on
//     each other), which throws the object ball a little off the line of centres and passes on some spin.
//   - Cushions and jaws: straight rubber noses; a rebound loses more energy the harder it hits, rubs off side
//     spin, and takes most of the roll out of the ball. The pockets' jaws are cushions too, angled into the
//     pocket, so a ball that hits them can rattle and stay out.
//   - Pockets: a ball whose centre gets over the hole drops.
// It runs in fixed substeps (1/1200 s: less than a centimetre at break speed), and each collision is wound back to
// the moment the balls touched before it's resolved, so nothing tunnels and the angles come out right.

export const R = 0.028575; // ball radius (57.15 mm balls)
export const L = 2.24; // the bed between the cushion noses: an 8-foot table
export const W = 1.12;
export const HEAD_X = -L / 4; // the head string: break from behind it (the kitchen)
export const FOOT_X = L / 4; // the foot spot: the front ball of the rack

const G = 9.81;
const MU_SLIDE = 0.2; // ball on cloth, sliding
const MU_ROLL = 0.011; // rolling resistance
const SPIN_DECAY = 9; // side spin lost to the cloth, rad/s²
const E_BALL = 0.94; // ball on ball
const MU_CUSHION = 0.18;
export const SUBSTEP = 1 / 1200;
export const TICK = 1 / 60; // the game steps the table in ticks of this

// Pockets: mouth widths between the cushion points, the angle of the jaws to the cushion face (wider than 90°
// means the pocket narrows going in), and how far back the hole starts (the shelf)
const CORNER = { mouth: 0.116, jaw: 142, jawLen: 0.06, shelf: 0.028, hole: 0.07 };
const SIDE = { mouth: 0.13, jaw: 104, jawLen: 0.045, shelf: 0.008, hole: 0.066 };

export interface Seg { ax: number; ay: number; bx: number; by: number; jaw: boolean }
export interface Pocket { x: number; y: number; r: number; mx: number; my: number; ux: number; uy: number; side: boolean }

// --- the table ----------------------------------------------------------------------------------------------
export const POCKETS: Pocket[] = [];
export const CUSHIONS: Seg[] = []; // the cushion faces, then the jaws
export const NOSES: [number, number][][] = []; // each cushion's outline on the bed (for drawing it)

{
  const rot = (x: number, y: number, deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  };
  // the cushion's two points and the jaw at each end, going round the table
  const add = (p: [number, number], q: [number, number], jp: [number, number], jq: [number, number]) => {
    CUSHIONS.push({ ax: p[0], ay: p[1], bx: q[0], by: q[1], jaw: false });
    CUSHIONS.push({ ax: p[0], ay: p[1], bx: p[0] + jp[0], by: p[1] + jp[1], jaw: true });
    CUSHIONS.push({ ax: q[0], ay: q[1], bx: q[0] + jq[0], by: q[1] + jq[1], jaw: true });
    NOSES.push([[p[0] + jp[0], p[1] + jp[1]], p, q, [q[0] + jq[0], q[1] + jq[1]]]);
  };
  const c = CORNER.mouth / Math.SQRT2; // how far each corner's cushion points are from the corner
  const s = SIDE.mouth / 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const mx = sx * (L / 2 - c / 2), my = sy * (W / 2 - c / 2), u = Math.SQRT1_2;
      const d = CORNER.shelf + CORNER.hole;
      POCKETS.push({ x: mx + sx * u * d, y: my + sy * u * d, r: CORNER.hole, mx, my, ux: sx * u, uy: sy * u, side: false });
    }
    POCKETS.push({ x: 0, y: sx * (W / 2 + SIDE.shelf + SIDE.hole), r: SIDE.hole, mx: 0, my: sx * W / 2, ux: 0, uy: sx, side: true });
  }
  // A jaw leaves the cushion point heading out of the bed, turned (jaw angle - 90°) towards the pocket
  const jaw = (len: number, ox: number, oy: number, deg: number) => rot(ox * len, oy * len, deg);
  const tc = CORNER.jaw - 90, ts = SIDE.jaw - 90;
  for (const sy of [-1, 1]) {
    // the long cushions, either side of the side pocket: from the corner to the side pocket
    for (const sx of [-1, 1]) {
      const p: [number, number] = [sx * (L / 2 - c), sy * W / 2];
      const q: [number, number] = [sx * s, sy * W / 2];
      // out of the bed is +y·sy; towards the corner pocket is +x·sx; towards the side pocket -x·sx
      add(p, q, jaw(CORNER.jawLen, 0, sy, -tc * sx * sy), jaw(SIDE.jawLen, 0, sy, ts * sx * sy));
    }
  }
  for (const sx of [-1, 1]) {
    // the end cushions, corner to corner
    const p: [number, number] = [sx * L / 2, -(W / 2 - c)];
    const q: [number, number] = [sx * L / 2, W / 2 - c];
    add(p, q, jaw(CORNER.jawLen, sx, 0, -tc * sx), jaw(CORNER.jawLen, sx, 0, tc * sx));
  }
}

// --- balls --------------------------------------------------------------------------------------------------
export type BallState = 'table' | 'falling' | 'potted';
export interface Ball {
  n: number; // 0 is the cue ball, then 1-15 (8 is the black)
  x: number; y: number;
  vx: number; vy: number;
  wx: number; wy: number; wz: number;
  state: BallState;
  pocket: number; // the pocket it fell in
  fall: number; // seconds since it dropped
}

export type SimEvent =
  | { t: 'hit'; time: number; a: number; b: number; speed: number } // two balls (a < b)
  | { t: 'rail'; time: number; a: number; speed: number; jaw: boolean }
  | { t: 'pot'; time: number; a: number; pocket: number };

const newBall = (n: number, x: number, y: number): Ball => ({ n, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, state: 'table', pocket: -1, fall: 0 });

export class Table {
  balls: Ball[] = [];
  events: SimEvent[] = [];
  time = 0;

  constructor(balls?: Ball[]) {
    this.balls = balls ? balls.map((b) => ({ ...b })) : Array.from({ length: 16 }, (_, n) => newBall(n, 0, 0));
  }

  clone() {
    const t = new Table(this.balls);
    t.time = this.time;
    return t;
  }

  get cue() { return this.balls[0]; }
  onTable(n: number) { return this.balls[n].state === 'table'; }

  // A fresh 8-ball rack: the front ball on the foot spot, the 8 in the middle of the third row, a solid and a
  // stripe in the back corners, the rest at random. Racks are never perfectly tight: tiny gaps vary each break.
  rack(rnd = Math.random) {
    const solids = [1, 2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
    const shuffle = (a: number[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    shuffle(solids);
    shuffle(stripes);
    const corners = rnd() < 0.5 ? [solids.pop()!, stripes.pop()!] : [stripes.pop()!, solids.pop()!];
    const rest = shuffle([...solids, ...stripes]);
    const order: number[] = [];
    for (let row = 0, k = 0; row < 5; row++) {
      for (let j = 0; j <= row; j++, k++) {
        if (row === 2 && j === 1) order.push(8);
        else if (row === 4 && j === 0) order.push(corners[0]);
        else if (row === 4 && j === 4) order.push(corners[1]);
        else order.push(rest.pop()!);
      }
    }
    let k = 0;
    for (let row = 0; row < 5; row++) {
      for (let j = 0; j <= row; j++, k++) {
        const gap = 0.0001 + rnd() * 0.0002;
        const b = this.balls[order[k]];
        Object.assign(b, newBall(b.n, FOOT_X + row * Math.sqrt(3) * (R + gap), (j - row / 2) * 2 * (R + gap) + (rnd() - 0.5) * 0.0002));
      }
    }
    Object.assign(this.cue, newBall(0, HEAD_X - 0.12, 0));
    this.events = [];
    this.time = 0;
  }

  // Strike the cue ball. angle: the direction it goes; speed in m/s; side (-1 left .. 1 right) and height
  // (-1 bottom .. 1 top) of where the tip meets the ball, as fractions of the furthest you can hit before a miscue
  // (half the radius). Hitting half a radius above centre gives 1.25 times a natural roll.
  strike(angle: number, speed: number, side = 0, height = 0) {
    const c = this.cue, dx = Math.cos(angle), dy = Math.sin(angle);
    const k = (5 / 2) * 0.5 * speed / R; // spin per unit of offset
    c.vx = dx * speed;
    c.vy = dy * speed;
    // top spin rolls it forwards: the axis is up × direction
    c.wx = -dy * k * height;
    c.wy = dx * k * height;
    c.wz = -k * side; // right side spins it clockwise from above
    this.events = [];
    this.time = 0;
  }

  moving() {
    for (const b of this.balls) {
      if (b.state === 'falling') return true;
      if (b.state === 'table' && (b.vx || b.vy || b.wx || b.wy || b.wz)) return true;
    }
    return false;
  }

  // Can the cue ball go here? On the bed, not touching a ball; in the kitchen if it must be.
  canPlace(x: number, y: number, kitchen: boolean) {
    if (Math.abs(x) > L / 2 - R || Math.abs(y) > W / 2 - R || (kitchen && x > HEAD_X)) return false;
    for (const b of this.balls) if (b.n && b.state === 'table' && (b.x - x) ** 2 + (b.y - y) ** 2 < (2 * R + 0.001) ** 2) return false;
    return true;
  }

  // Run one game tick (1/60 s) of substeps
  tick() {
    for (let i = 0; i < Math.round(TICK / SUBSTEP); i++) this.substep(SUBSTEP);
  }

  // Run until everything stops (or a time limit): what the computer player does to look ahead
  settle(limit = 30) {
    while (this.moving() && this.time < limit) this.tick();
    if (this.moving()) for (const b of this.balls) if (b.state === 'table') { b.vx = b.vy = b.wx = b.wy = b.wz = 0; }
    for (const b of this.balls) if (b.state === 'falling') b.state = 'potted';
  }

  private substep(dt: number) {
    this.time += dt;
    for (const b of this.balls) {
      if (b.state === 'falling') { if ((b.fall += dt) > 0.6) b.state = 'potted'; continue; }
      if (b.state !== 'table') continue;
      cloth(b, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    // Collisions can chain within a substep (a rack is a row of touching balls): go over them a few times
    for (let pass = 0; pass < 12; pass++) {
      let any = this.collideBalls(dt);
      any = this.collideCushions() || any;
      if (!any) break;
    }
    this.pockets();
  }

  private collideBalls(dt: number) {
    const bs = this.balls, d2 = 4 * R * R;
    let any = false;
    for (let i = 0; i < 16; i++) {
      const a = bs[i];
      if (a.state !== 'table') continue;
      for (let j = i + 1; j < 16; j++) {
        const b = bs[j];
        if (b.state !== 'table') continue;
        const px = b.x - a.x, py = b.y - a.y;
        if (Math.abs(px) >= 2 * R || Math.abs(py) >= 2 * R) continue;
        const pp = px * px + py * py;
        if (pp >= d2) continue;
        const rvx = a.vx - b.vx, rvy = a.vy - b.vy, pv = px * rvx + py * rvy; // > 0: closing
        if (pv <= 1e-9) {
          // touching but not closing (a rack): just keep them apart
          const d = Math.sqrt(pp) || 1e-9, push = (2 * R - d) / 2;
          a.x -= (px / d) * push; a.y -= (py / d) * push;
          b.x += (px / d) * push; b.y += (py / d) * push;
          continue;
        }
        // wind both back to the moment they touched, meet, then run on for the same time
        const t = rewind(pp, pv, rvx * rvx + rvy * rvy, d2, dt);
        a.x -= a.vx * t; a.y -= a.vy * t;
        b.x -= b.vx * t; b.y -= b.vy * t;
        const speed = impact(a, b);
        a.x += a.vx * t; a.y += a.vy * t;
        b.x += b.vx * t; b.y += b.vy * t;
        this.events.push({ t: 'hit', time: this.time, a: a.n, b: b.n, speed });
        any = true;
      }
    }
    return any;
  }

  private collideCushions() {
    let any = false;
    const edge = R + 0.003;
    for (const b of this.balls) {
      if (b.state !== 'table') continue;
      // (only near the rails: most of the bed can't touch a cushion)
      if (Math.abs(b.x) < L / 2 - edge && Math.abs(b.y) < W / 2 - edge) continue;
      for (const s of CUSHIONS) {
        const ex = s.bx - s.ax, ey = s.by - s.ay;
        let k = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / (ex * ex + ey * ey);
        k = Math.max(0, Math.min(1, k));
        const qx = s.ax + ex * k, qy = s.ay + ey * k;
        let nx = b.x - qx, ny = b.y - qy;
        const d = Math.hypot(nx, ny);
        if (d >= R || d < 1e-9) continue;
        nx /= d; ny /= d;
        const vn = b.vx * nx + b.vy * ny;
        b.x += nx * (R - d); // (back out of the rubber: a straight face, so this is where it touched)
        b.y += ny * (R - d);
        if (vn >= 0) continue;
        cushion(b, nx, ny, vn, s.jaw);
        this.events.push({ t: 'rail', time: this.time, a: b.n, speed: -vn, jaw: s.jaw });
        any = true;
      }
    }
    return any;
  }

  private pockets() {
    for (const b of this.balls) {
      if (b.state !== 'table') continue;
      const nearEdge = Math.abs(b.x) > L / 2 - 0.09 || Math.abs(b.y) > W / 2 - 0.02;
      if (!nearEdge) continue;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < POCKETS.length; i++) {
        const p = POCKETS[i], d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      // over the hole; or (it should never happen) somehow off the bed: into the nearest pocket
      const off = Math.abs(b.x) > L / 2 + 2 * R || Math.abs(b.y) > W / 2 + 2 * R;
      if (bestD < POCKETS[best].r || off) {
        b.state = 'falling';
        b.pocket = best;
        b.fall = 0;
        this.events.push({ t: 'pot', time: this.time, a: b.n, pocket: best });
      }
    }
  }
}

// How far back in time two overlapping, closing balls first touched: the smaller root of
// |p - v·t|² = (2R)², where p is from a to b and v their closing velocity (p·v = pv > 0)
function rewind(pp: number, pv: number, vv: number, d2: number, dt: number) {
  const disc = pv * pv - vv * (pp - d2); // (pp < d2, so this is > pv²)
  const t = (pv - Math.sqrt(Math.max(0, disc))) / vv; // negative: the root behind us is -t
  return Math.max(0, Math.min(dt, -t));
}

// --- the cloth ----------------------------------------------------------------------------------------------
function cloth(b: Ball, dt: number) {
  // the velocity of the bottom of the ball over the cloth: v + w × (0, 0, -R)
  const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
  const u = Math.hypot(ux, uy);
  const slide = MU_SLIDE * G * dt;
  if (u > 1e-6) {
    // sliding: friction against the slip slows the slip at 7/2 of the rate it changes the velocity
    const f = Math.min(1, u / (3.5 * slide)); // (stop exactly at a roll, not past it)
    const ax = (ux / u) * slide * f, ay = (uy / u) * slide * f;
    b.vx -= ax; b.vy -= ay;
    b.wx -= (2.5 / R) * ay;
    b.wy += (2.5 / R) * ax;
  } else {
    // rolling: a little resistance, and the spin follows the speed
    const v = Math.hypot(b.vx, b.vy), dec = MU_ROLL * G * dt;
    if (v <= dec) { b.vx = b.vy = 0; } else { b.vx *= (v - dec) / v; b.vy *= (v - dec) / v; }
    b.wx = -b.vy / R;
    b.wy = b.vx / R;
  }
  if (b.wz) {
    const s = SPIN_DECAY * dt;
    b.wz = Math.abs(b.wz) <= s ? 0 : b.wz - Math.sign(b.wz) * s;
  }
  // nearly still: still
  if (Math.abs(b.vx) + Math.abs(b.vy) < 2e-4 && Math.abs(b.wx) + Math.abs(b.wy) < 0.01) {
    b.vx = b.vy = b.wx = b.wy = 0;
    if (Math.abs(b.wz) < 0.2) b.wz = 0;
  }
}

// --- ball on ball -------------------------------------------------------------------------------------------
// a and b touching. Returns how hard they met (m/s along the line of centres).
function impact(a: Ball, b: Ball) {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d = Math.hypot(nx, ny) || 1e-9;
  nx /= d; ny /= d;
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn <= 0) return 0;
  const jn = ((1 + E_BALL) / 2) * vn; // (per unit mass: equal balls)
  a.vx -= jn * nx; a.vy -= jn * ny;
  b.vx += jn * nx; b.vy += jn * ny;

  // Friction between the surfaces. The contact points' relative slip has a sideways part (along t, from
  // the cut angle and side spin) and an up-down part (from top or back spin). Friction acts against all of
  // it, but only the sideways part moves the balls on the table: that's throw.
  const tx = -ny, ty = nx;
  const st = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + R * (a.wz + b.wz);
  const sz = R * (a.wx * ny - a.wy * nx + b.wx * ny - b.wy * nx);
  const s = Math.hypot(st, sz);
  if (s > 1e-6) {
    const mu = 0.00995 + 0.108 * Math.exp(-1.088 * s); // slower slip, more grip (measured for pool balls)
    const jf = Math.min(mu * jn, s / 7); // (7: what it takes to stop the slip outright, with both balls turning)
    const jt = -jf * (st / s), jz = -jf * (sz / s);
    a.vx += jt * tx; a.vy += jt * ty;
    b.vx -= jt * tx; b.vy -= jt * ty;
    const k = 2.5 / R;
    a.wz += k * jt; b.wz += k * jt;
    a.wx += k * jz * ny; a.wy -= k * jz * nx;
    b.wx += k * jz * ny; b.wy -= k * jz * nx;
  }
  return vn;
}

// --- ball on cushion ----------------------------------------------------------------------------------------
// n: out of the rubber towards the ball; vn: the speed into it (negative)
function cushion(b: Ball, nx: number, ny: number, vn: number, jaw: boolean) {
  const e = Math.max(jaw ? 0.55 : 0.62, (jaw ? 0.8 : 0.9) - 0.035 * -vn); // harder hits lose more
  const jn = (1 + e) * -vn;
  // where it touches the rubber, the ball's surface slides along the cushion with its speed and side spin
  const tx = -ny, ty = nx;
  const st = b.vx * tx + b.vy * ty - R * b.wz;
  b.vx += jn * nx; b.vy += jn * ny;
  if (Math.abs(st) > 1e-6) {
    const jt = -Math.sign(st) * Math.min(MU_CUSHION * jn, Math.abs(st) / 3.5);
    b.vx += jt * tx; b.vy += jt * ty;
    b.wz -= (2.5 / R) * jt;
  }
  // The rubber meets the ball above its middle and grips it: most of the roll into the cushion is lost
  const roll = b.wx * tx + b.wy * ty; // spin about the line of the cushion
  b.wx -= tx * roll * 0.6;
  b.wy -= ty * roll * 0.6;
}

// --- shared geometry (aiming lines, the computer) -------------------------------------------------------------
// Where a ball travelling from (x, y) along (dx, dy) first meets another ball: the distance it travels
// and which ball, or null. (Moving ball and the others all radius R; skip: balls to ignore.)
export function firstBall(t: Table, x: number, y: number, dx: number, dy: number, skip: (n: number) => boolean, max = 10) {
  let best: { dist: number; n: number } | null = null;
  for (const b of t.balls) {
    if (b.state !== 'table' || skip(b.n)) continue;
    const px = b.x - x, py = b.y - y;
    const along = px * dx + py * dy;
    if (along <= 0) continue;
    const off2 = px * px + py * py - along * along;
    if (off2 >= 4 * R * R) continue;
    const dist = along - Math.sqrt(4 * R * R - off2);
    if (dist < max && (!best || dist < best.dist)) best = { dist: Math.max(0, dist), n: b.n };
  }
  return best;
}

// Where a ball travelling from (x, y) along (dx, dy) first meets a cushion: the distance and the face's normal
export function firstCushion(x: number, y: number, dx: number, dy: number) {
  let best: { dist: number; nx: number; ny: number } | null = null;
  for (const s of CUSHIONS) {
    const ex = s.bx - s.ax, ey = s.by - s.ay, len = Math.hypot(ex, ey);
    let nx = -ey / len, ny = ex / len;
    if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; } // (the side the ball comes from)
    // the line the ball's centre would touch: the face moved out by R
    const ox = s.ax + nx * R - x, oy = s.ay + ny * R - y;
    const den = dx * ny - dy * nx;
    const toward = dx * nx + dy * ny;
    if (toward >= 0 || Math.abs(den) < 1e-12) continue;
    const dist = (ox * nx + oy * ny) / toward;
    if (dist < 0) continue;
    const hx = x + dx * dist - (s.ax + nx * R), hy = y + dy * dist - (s.ay + ny * R);
    const k = (hx * ex + hy * ey) / (len * len);
    if (k < 0 || k > 1) continue;
    if (!best || dist < best.dist) best = { dist, nx, ny };
  }
  return best;
}
