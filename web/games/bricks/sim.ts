// Bricks: the rules. A Field is one wall of bricks with its paddles, balls, falling power-ups and laser
// shots. In co-op everyone shares one field; in versus each player has their own, built from the same
// level, and stepAll() carries the attacks between them. No drawing here (draw.ts) and no pads
// (main.ts sets each paddle's move, fire, launch and use from its player's phone).
//
// The ball moves by sweeping: each tick it travels along a line, and we find the first thing on that
// line (a wall, a brick, a paddle), move it there, bounce, and carry on with what's left of the tick.
// So it can't pass through a brick however fast it goes. A brick (or a paddle) is tested as its box
// grown by the ball's radius, which turns "a circle hits a box" into "a point hits a bigger box".
import { LEVELS, type Level } from './levels.ts';

export const TICK = 1 / 60;
export const COLS = 12;
export const ROWS = 13; // room for junk rows to push a wall down in versus
export const BRICK_H = 28;
export const TOP = 84; // the gap above the bricks: get the ball up there and it does the work for you
export const HEIGHT = 820;
export const PADDLE_Y = HEIGHT - 70; // the paddles' top edge
export const PADDLE_H = 16;
export const BALL_R = 9;
export const BALL_SPEED = 440; // units a second, at the start of each life
export const SPEED_RAMP = 5.5; // faster by this much every second the ball is in play...
export const MAX_SPEED = 1000; // ...up to this
const PADDLE_SPEED = 920;
const PADDLE_ACCEL = 9000; // (full speed in a tenth of a second: tight, but not a teleport)
const SPRINT = 1.45; // stick pushed past its ring
const MAX_BALLS = 12;
const CAPSULE_W = 46, CAPSULE_H = 20, CAPSULE_FALL = 170;
const SHOT_SPEED = 1300;
const ROUND_TIME = 150; // versus: seconds before the round goes to whoever has broken the most

export type Power = 'wide' | 'multi' | 'laser' | 'slow' | 'catch' | 'life' | 'junk' | 'shrink';
export const POWERS: Record<Power, { name: string; letter: string; color: string; time: number }> = {
  wide: { name: 'Wide', letter: 'W', color: '#4c8dff', time: 15 },
  multi: { name: 'Multi-ball', letter: '3', color: '#ff5ecf', time: 0 },
  laser: { name: 'Laser', letter: 'L', color: '#ff4d5a', time: 12 },
  slow: { name: 'Slow', letter: 'S', color: '#2ee59d', time: 10 },
  catch: { name: 'Catch', letter: 'C', color: '#ffc23d', time: 15 },
  life: { name: 'Extra ball', letter: '+', color: '#f3f0e8', time: 0 },
  junk: { name: 'Junk', letter: 'J', color: '#ff8a3d', time: 0 }, // versus: a row of bricks onto their walls
  shrink: { name: 'Shrink', letter: '−', color: '#a97bff', time: 10 }, // versus: their paddles shrink
};
// How often each turns up when a brick drops one
const DROPS_COOP: [Power, number][] = [['wide', 3], ['multi', 3], ['laser', 2], ['slow', 2], ['catch', 2], ['life', 0.7]];
const DROPS_VERSUS: [Power, number][] = [['wide', 2], ['multi', 2], ['laser', 2], ['slow', 1.2], ['catch', 1.2], ['life', 0.5], ['junk', 2], ['shrink', 2]];

export type BrickKind = 'plain' | 'tough' | 'steel' | 'charge';

export interface Brick {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BrickKind;
  hp: number;
  max: number;
  color: string;
  drop: boolean; // always drops a power-up
  alive: boolean;
}

export interface PaddleSpec { id: string; name: string; color: string; ai: boolean; skill?: number; tag?: string }

export interface Paddle {
  spec: PaddleSpec;
  x: number; // centre
  w: number;
  baseW: number;
  vx: number;
  // from the pad, every tick
  move: number; // -1..1
  sprint: boolean;
  fire: boolean; // held: fire the laser
  launch: boolean; // pressed: let go of the ball
  use: boolean; // pressed (versus): send the power-up held
  // power-ups (seconds left)
  wideT: number;
  laserT: number;
  catchT: number;
  shrinkT: number;
  laserCd: number;
  stored: Power | null; // versus: an attack waiting to be sent
  // what they did
  score: number;
  bricks: number;
  bestCombo: number;
  // the computer's plans
  aim: number; // where on the paddle it means to hit the ball
  wait: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: Paddle | null; // the last paddle to touch it: the points go to them
  stuck: Paddle | null; // held on a paddle (a serve, or caught)
  stuckX: number; // where on the paddle
  stuckT: number;
  combo: number; // bricks broken since it last touched a paddle
  trail: number[]; // its last few positions, x y x y... (for drawing)
  out: boolean;
}

export interface Capsule { x: number; y: number; power: Power; dead: boolean }
export interface Shot { x: number; y: number; owner: Paddle; dead: boolean }

export type FieldEvent =
  | { type: 'hit'; brick: Brick }
  | { type: 'break'; brick: Brick; by: Paddle | null; points: number; combo: number }
  | { type: 'steel'; brick: Brick }
  | { type: 'boom'; brick: Brick }
  | { type: 'paddle'; paddle: Paddle; x: number; speed: number }
  | { type: 'wall'; x: number; y: number }
  | { type: 'launch'; paddle: Paddle }
  | { type: 'laser'; paddle: Paddle }
  | { type: 'pickup'; paddle: Paddle; power: Power; x: number; y: number }
  | { type: 'combo'; x: number; y: number; combo: number; mult: number }
  | { type: 'lost'; x: number } // a ball fell off the bottom
  | { type: 'life' } // the last one: a life gone
  | { type: 'out' } // and no lives left
  | { type: 'clear' }
  | { type: 'junk' } // (versus) a row of bricks arrived from a rival
  | { type: 'shrunk' }
  | { type: 'sent'; power: Power; paddle: Paddle };

export interface FieldOptions {
  specs: PaddleSpec[];
  level: number; // index into LEVELS (it wraps)
  loop?: number; // times round all the levels: each time a little faster
  lives: number;
  versus?: boolean;
  carry?: Field; // the field before: scores and lives go on
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const DEG = Math.PI / 180;
export const multiplier = (combo: number) => Math.min(8, 1 + Math.floor(combo / 5));

export class Field {
  readonly w: number;
  readonly h = HEIGHT;
  readonly bw: number; // brick width
  readonly versus: boolean;
  readonly level: Level;
  readonly levelIndex: number;
  readonly loop: number;
  grid: (Brick | null)[] = new Array(ROWS * COLS).fill(null);
  bricks: Brick[] = [];
  paddles: Paddle[];
  balls: Ball[] = [];
  capsules: Capsule[] = [];
  shots: Shot[] = [];
  lives: number;
  score = 0;
  t = 0;
  playT = 0; // seconds the ball has been in play this life (it speeds up)
  slowT = 0;
  left = 0; // bricks still to break
  total = 0;
  bestCombo = 0;
  version = 0; // changes when the bricks do (draw.ts redraws them then)
  cleared = false;
  over = false;
  events: FieldEvent[] = [];
  private booms: { b: Brick; t: number; by: Paddle | null; ball: Ball | null }[] = [];
  private serveAt = 0;

  constructor(o: FieldOptions) {
    this.versus = !!o.versus;
    this.levelIndex = o.level % LEVELS.length;
    this.level = LEVELS[this.levelIndex];
    this.loop = o.loop ?? 0;
    this.lives = o.lives;
    const n = o.specs.length;
    this.bw = n > 2 ? 80 : 64; // (a wider field for three or four paddles)
    this.w = COLS * this.bw;
    const baseW = [128, 116, 108, 100][Math.min(3, n - 1)];
    this.paddles = o.specs.map((spec, i) => {
      const old = o.carry?.paddles.find((p) => p.spec.id === spec.id);
      return {
        spec, x: (this.w * (i + 0.5)) / n, w: baseW, baseW, vx: 0,
        move: 0, sprint: false, fire: false, launch: false, use: false,
        wideT: 0, laserT: 0, catchT: 0, shrinkT: 0, laserCd: 0, stored: null,
        score: old?.score ?? 0, bricks: old?.bricks ?? 0, bestCombo: old?.bestCombo ?? 0, aim: 0, wait: 0,
      };
    });
    if (o.carry) { this.score = o.carry.score; this.bestCombo = o.carry.bestCombo; }
    this.build();
    this.serve();
  }

  // --- the wall ------------------------------------------------------------------------------------
  private build() {
    const { rows, palette } = this.level;
    rows.forEach((line, row) => {
      for (let col = 0; col < COLS; col++) {
        const ch = line[col] ?? '.';
        if (ch === '.') continue;
        const kind: BrickKind = ch === '#' ? 'steel' : ch === '*' ? 'charge' : ch === '2' || ch === '3' ? 'tough' : 'plain';
        const hp = ch === '2' ? 2 : ch === '3' ? 3 : 1;
        this.put(col, row, kind, hp, palette[row % palette.length], ch === '?');
      }
    });
  }

  private put(col: number, row: number, kind: BrickKind, hp: number, color: string, drop = false) {
    const b: Brick = { col, row, x: col * this.bw, y: TOP + row * BRICK_H, w: this.bw, h: BRICK_H, kind, hp, max: hp, color, drop, alive: true };
    this.grid[row * COLS + col] = b;
    this.bricks.push(b);
    if (kind !== 'steel') { this.left++; this.total++; }
    this.version++;
    return b;
  }

  at(col: number, row: number) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS ? this.grid[row * COLS + col] : null;
  }

  // Versus: a rival sent junk. The wall moves down a row and a row of plain bricks fills the top
  // (or, if the wall is already as low as it goes, the gaps in the top row fill instead).
  addJunk() {
    const lowest = this.bricks.reduce((m, b) => (b.alive ? Math.max(m, b.row) : m), -1);
    if (lowest < ROWS - 1) {
      this.grid.fill(null);
      for (const b of this.bricks) {
        if (!b.alive) continue;
        b.row++;
        b.y += BRICK_H;
        this.grid[b.row * COLS + b.col] = b;
      }
    }
    for (let col = 0; col < COLS; col++) if (!this.at(col, 0)?.alive) this.put(col, 0, 'plain', 1, '#b0643a'); // (rust: junk)
    this.bricks = this.bricks.filter((b) => b.alive);
    this.cleared = false;
    this.events.push({ type: 'junk' });
  }

  // --- the speed ---------------------------------------------------------------------------------------
  get speed() {
    const ramp = Math.min(MAX_SPEED, (BALL_SPEED + SPEED_RAMP * this.playT) * (1 + 0.1 * this.loop));
    return ramp * (this.slowT > 0 ? 0.62 : 1);
  }

  // --- one tick ----------------------------------------------------------------------------------------
  step() {
    this.events = [];
    if (this.over || this.cleared) return;
    this.t += TICK;
    this.slowT = Math.max(0, this.slowT - TICK);
    if (this.balls.some((b) => !b.stuck)) this.playT += TICK;

    for (const p of this.paddles) { if (p.spec.ai) this.think(p); this.movePaddle(p); }
    this.keepApart();
    this.fireLasers();
    for (const b of this.balls) this.moveBall(b);
    this.moveShots();
    this.blowUp();
    this.moveCapsules();
    for (const p of this.paddles) { p.launch = false; }

    // balls off the bottom
    for (const b of this.balls) if (b.out) this.events.push({ type: 'lost', x: b.x });
    this.balls = this.balls.filter((b) => !b.out);
    if (!this.balls.length) this.loseLife();
    if (!this.left && !this.cleared) { this.cleared = true; this.events.push({ type: 'clear' }); }
  }

  private loseLife() {
    if (this.lives <= 0) {
      this.over = true;
      this.events.push({ type: 'out' });
      return;
    }
    this.lives--;
    this.events.push({ type: 'life' });
    // a fresh start: power-ups and the speed go back to normal
    this.playT = 0;
    this.slowT = 0;
    for (const p of this.paddles) { p.wideT = p.laserT = p.catchT = 0; }
    this.capsules = [];
    this.shots = [];
    this.serve();
  }

  // New balls, held on the paddles in turn (in co-op with three or four of you, two at once)
  serve() {
    const n = this.versus ? 1 : Math.ceil(this.paddles.length / 2);
    for (let i = 0; i < n; i++) {
      const p = this.paddles[(this.serveAt + i * 2) % this.paddles.length];
      const ball = this.newBall(p.x, PADDLE_Y - BALL_R, 0, 0, p);
      ball.stuck = p;
      ball.stuckX = (Math.random() - 0.5) * p.w * 0.3;
      p.wait = 0.5 + Math.random() * 0.6; // (the computer waits a moment before it serves)
      this.balls.push(ball);
    }
    this.serveAt = (this.serveAt + 1) % this.paddles.length;
  }

  private newBall(x: number, y: number, vx: number, vy: number, owner: Paddle | null): Ball {
    return { x, y, vx, vy, owner, stuck: null, stuckX: 0, stuckT: 0, combo: 0, trail: [], out: false };
  }

  // --- paddles ------------------------------------------------------------------------------------------
  private movePaddle(p: Paddle) {
    for (const k of ['wideT', 'laserT', 'catchT', 'shrinkT'] as const) p[k] = Math.max(0, p[k] - TICK);
    const want = clamp(p.move, -1, 1) * PADDLE_SPEED * (p.sprint ? SPRINT : 1);
    p.vx += clamp(want - p.vx, -PADDLE_ACCEL * TICK, PADDLE_ACCEL * TICK);
    p.x += p.vx * TICK;
    // the width eases to its new size (wide, shrunk)
    const target = p.baseW * (p.wideT > 0 ? 1.6 : 1) * (p.shrinkT > 0 ? 0.6 : 1);
    p.w += (target - p.w) * Math.min(1, TICK * 10);
  }

  // Paddles share the bottom edge in order and can't pass through each other or the walls
  private keepApart() {
    const ps = this.paddles;
    for (let pass = 0; pass < 3; pass++) {
      for (const p of ps) {
        const x = clamp(p.x, p.w / 2, this.w - p.w / 2);
        if (x !== p.x) { p.x = x; p.vx = 0; }
      }
      for (let i = 0; i + 1 < ps.length; i++) {
        const a = ps[i], b = ps[i + 1];
        const gap = b.x - b.w / 2 - (a.x + a.w / 2);
        if (gap < 0) { a.x += gap / 2; b.x -= gap / 2; }
      }
    }
  }

  // --- the ball -----------------------------------------------------------------------------------------
  private moveBall(b: Ball) {
    if (b.stuck) {
      const p = b.stuck;
      b.stuckT += TICK;
      b.stuckX = clamp(b.stuckX, -p.w / 2 + 4, p.w / 2 - 4);
      b.x = p.x + b.stuckX;
      b.y = PADDLE_Y - BALL_R;
      b.trail.length = 0;
      // let go: Bolt, or on its own after a while (so nobody can hold up a game)
      if (p.launch || b.stuckT > (p.catchT > 0 ? 2.5 : 5)) this.launch(b, p);
      else return;
    }
    // the speed ramps; keep the ball at it, and never let it go nearly flat (endless side to side)
    const speed = this.speed;
    let a = Math.atan2(b.vx, -b.vy); // (0 = straight up)
    const flat = Math.abs(Math.abs(a) - Math.PI / 2);
    if (flat < 16 * DEG) {
      const up = Math.abs(a) < Math.PI / 2 ? 1 : -1; // keep it going the way it was, up or down
      const side = Math.sign(a) || 1;
      a = up > 0 ? side * (Math.PI / 2 - 16 * DEG) : side * (Math.PI / 2 + 16 * DEG);
    }
    b.vx = Math.sin(a) * speed;
    b.vy = -Math.cos(a) * speed;

    this.pushOut(b);
    const R = BALL_R;
    let left = TICK;
    for (let i = 0; i < 12 && left > 1e-7; i++) {
      const mx = b.vx * left, my = b.vy * left;
      let best = 1, nx = 0, ny = 0;
      let brick: Brick | null = null, paddle: Paddle | null = null, wall = false;
      // walls: left, right and top
      if (mx < 0 && b.x + mx < R) { const t = (R - b.x) / mx; if (t < best) { best = t; nx = 1; ny = 0; wall = true; } }
      if (mx > 0 && b.x + mx > this.w - R) { const t = (this.w - R - b.x) / mx; if (t < best) { best = t; nx = -1; ny = 0; wall = true; } }
      if (my < 0 && b.y + my < R) { const t = (R - b.y) / my; if (t < best) { best = t; nx = 0; ny = 1; wall = true; } }
      // bricks: only those under the ball's path
      const c0 = Math.max(0, Math.floor((Math.min(b.x, b.x + mx) - R) / this.bw));
      const c1 = Math.min(COLS - 1, Math.floor((Math.max(b.x, b.x + mx) + R) / this.bw));
      const r0 = Math.max(0, Math.floor((Math.min(b.y, b.y + my) - R - TOP) / BRICK_H));
      const r1 = Math.min(ROWS - 1, Math.floor((Math.max(b.y, b.y + my) + R - TOP) / BRICK_H));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const br = this.grid[r * COLS + c];
          if (!br?.alive) continue;
          const hit = sweep(b.x, b.y, mx, my, br.x - R, br.y - R, br.x + br.w + R, br.y + br.h + R);
          if (hit && hit.t < best) { best = hit.t; nx = hit.nx; ny = hit.ny; brick = br; wall = false; paddle = null; }
        }
      }
      // paddles
      for (const p of this.paddles) {
        const hit = sweep(b.x, b.y, mx, my, p.x - p.w / 2 - R, PADDLE_Y - R, p.x + p.w / 2 + R, PADDLE_Y + PADDLE_H + R);
        if (hit && hit.t < best) { best = hit.t; nx = hit.nx; ny = hit.ny; paddle = p; brick = null; wall = false; }
      }
      b.x += mx * best;
      b.y += my * best;
      left *= 1 - best;
      if (best >= 1) break;
      // bounce (a hair off the surface, so the next sweep starts outside it)
      b.x += nx * 1e-3;
      b.y += ny * 1e-3;
      if (paddle) this.offPaddle(b, paddle, nx, ny);
      else {
        if (nx) b.vx = Math.abs(b.vx) * nx;
        if (ny) b.vy = Math.abs(b.vy) * ny;
      }
      if (brick) this.hit(brick, b.owner, b);
      if (wall) this.events.push({ type: 'wall', x: b.x, y: b.y });
      if (b.stuck) break; // (caught)
    }
    b.trail.unshift(b.x, b.y);
    if (b.trail.length > 16) b.trail.length = 16;
    if (b.y - R > this.h) b.out = true;
  }

  // A ball inside something (a paddle pushed into it, junk dropped on it): put it outside first
  private pushOut(b: Ball) {
    const R = BALL_R;
    for (const p of this.paddles) {
      const x0 = p.x - p.w / 2 - R, x1 = p.x + p.w / 2 + R, y0 = PADDLE_Y - R, y1 = PADDLE_Y + PADDLE_H + R;
      if (b.x <= x0 || b.x >= x1 || b.y <= y0 || b.y >= y1) continue;
      if (b.y <= PADDLE_Y + PADDLE_H / 2 && b.vy >= 0) {
        // over the top half: it's a hit
        b.y = y0 - 1e-3;
        this.offPaddle(b, p, 0, -1);
      } else {
        // from the side: knocked out sideways (and it carries on down: too late for this one)
        const right = b.x > p.x;
        b.x = right ? x1 + 1e-3 : x0 - 1e-3;
        b.vx = right ? Math.max(Math.abs(b.vx), p.vx) : -Math.max(Math.abs(b.vx), -p.vx);
      }
    }
    // (a few goes: out of one brick can be into the next)
    for (let pass = 0; pass < 4; pass++) {
      const br = this.inside(b);
      if (!br) return;
      const x0 = br.x - R, x1 = br.x + br.w + R, y0 = br.y - R, y1 = br.y + br.h + R;
      // out the nearest side that isn't another brick or a wall (usually below)
      const blocked = (wx: number, wy: number) => {
        const c = br.col + wx, r = br.row + wy;
        return c < 0 || c >= COLS || !!this.at(c, r)?.alive;
      };
      const ways: [number, number, number][] = [[y1 - b.y, 0, 1], [b.y - y0, 0, -1], [b.x - x0, -1, 0], [x1 - b.x, 1, 0]];
      ways.sort((p, q) => p[0] - q[0]);
      let way = ways.find(([, wx, wy]) => !blocked(wx, wy));
      if (!way) {
        // bricks all round: drop it out under the wall in this column
        let r = br.row;
        while (this.at(br.col, r)?.alive) r++;
        way = [TOP + r * BRICK_H + R - b.y, 0, 1];
      }
      const [d, wx, wy] = way;
      b.x += wx * (d + 1e-3);
      b.y += wy * (d + 1e-3);
      if (wx) b.vx = Math.abs(b.vx) * wx;
      if (wy) b.vy = Math.abs(b.vy) * wy;
    }
  }

  // The brick (grown by the ball's radius) the ball's centre is inside, if any
  private inside(b: Ball) {
    const R = BALL_R, c = Math.floor(b.x / this.bw), r = Math.floor((b.y - TOP) / BRICK_H);
    for (let rr = r - 1; rr <= r + 1; rr++) {
      for (let cc = c - 1; cc <= c + 1; cc++) {
        const br = this.at(cc, rr);
        if (br?.alive && b.x > br.x - R && b.x < br.x + br.w + R && b.y > br.y - R && b.y < br.y + br.h + R) return br;
      }
    }
    return null;
  }

  // Off a paddle. On the top, where it lands decides the angle (the ends send it out wide) and the
  // paddle's movement drags it a little further the same way. Off an end, it's knocked sideways.
  private offPaddle(b: Ball, p: Paddle, nx: number, ny: number) {
    b.owner = p;
    if (b.combo > p.bestCombo) p.bestCombo = b.combo;
    b.combo = 0;
    if (ny < 0) {
      if (p.catchT > 0) {
        b.stuck = p;
        b.stuckX = b.x - p.x;
        b.stuckT = 0;
        b.y = PADDLE_Y - BALL_R;
      } else this.aimOff(b, p, (b.x - p.x) / (p.w / 2 + BALL_R));
      p.aim = (Math.random() - 0.5) * 1.3; // (the computer picks a new spot to hit it with)
    } else {
      b.vx = Math.abs(b.vx) * (nx || 1) + p.vx * 0.3;
      const k = this.speed / Math.hypot(b.vx, b.vy);
      b.vx *= k;
      b.vy *= k;
    }
    this.events.push({ type: 'paddle', paddle: p, x: b.x, speed: this.speed });
  }

  private aimOff(b: Ball, p: Paddle, u: number) {
    let a = clamp(u, -1, 1) * 62 * DEG + clamp(p.vx / PADDLE_SPEED, -1.4, 1.4) * 12 * DEG;
    a = clamp(a, -70 * DEG, 70 * DEG);
    const s = this.speed;
    b.vx = Math.sin(a) * s;
    b.vy = -Math.cos(a) * s;
  }

  private launch(b: Ball, p: Paddle) {
    b.stuck = null;
    b.owner = p;
    let u = b.stuckX / (p.w / 2 + BALL_R);
    if (Math.abs(u) < 0.15) u = 0.15 * (Math.sign(u || p.vx) || (Math.random() < 0.5 ? -1 : 1)); // (never straight up)
    this.aimOff(b, p, u);
    b.y = PADDLE_Y - BALL_R - 0.5;
    this.events.push({ type: 'launch', paddle: p });
  }

  // --- bricks ----------------------------------------------------------------------------------------
  hit(br: Brick, by: Paddle | null, ball: Ball | null, blast = false) {
    if (!br.alive) return;
    if (br.kind === 'steel') { this.events.push({ type: 'steel', brick: br }); return; }
    br.hp = blast ? 0 : br.hp - 1;
    this.version++;
    if (br.hp > 0) {
      this.addPoints(10, by);
      this.events.push({ type: 'hit', brick: br });
      return;
    }
    br.alive = false;
    this.grid[br.row * COLS + br.col] = null;
    this.left--;
    let combo = 1;
    if (ball) {
      combo = ++ball.combo;
      if (combo > this.bestCombo) this.bestCombo = combo;
      if (combo >= 5 && combo % 5 === 0) this.events.push({ type: 'combo', x: br.x + br.w / 2, y: br.y + br.h / 2, combo, mult: multiplier(combo) });
    }
    const base = br.kind === 'charge' ? 80 : 50 * br.max;
    const points = base * multiplier(combo);
    this.addPoints(points, by);
    if (by) by.bricks++;
    this.events.push({ type: 'break', brick: br, by, points, combo });
    // a power-up?
    const chance = this.versus ? 0.13 : 0.1;
    if (br.drop || (Math.random() < chance && this.capsules.length < 3)) this.drop(br.x + br.w / 2, br.y + br.h / 2);
    // a charge: everything around it goes a moment later (charges set each other off)
    if (br.kind === 'charge') {
      this.events.push({ type: 'boom', brick: br });
      for (let r = br.row - 1; r <= br.row + 1; r++) {
        for (let c = br.col - 1; c <= br.col + 1; c++) {
          const n = this.at(c, r);
          if (n?.alive && n.kind !== 'steel' && !this.booms.some((q) => q.b === n)) this.booms.push({ b: n, t: 0.09, by, ball });
        }
      }
    }
  }

  private addPoints(n: number, by: Paddle | null) {
    this.score += n;
    if (by) by.score += n;
  }

  private blowUp() {
    for (const q of this.booms) {
      q.t -= TICK;
      if (q.t <= 0) this.hit(q.b, q.by, q.ball, true);
    }
    this.booms = this.booms.filter((q) => q.t > 0);
  }

  // --- power-ups ------------------------------------------------------------------------------------
  private drop(x: number, y: number) {
    const table = this.versus ? DROPS_VERSUS : DROPS_COOP;
    let r = Math.random() * table.reduce((t, [, w]) => t + w, 0);
    let power = table[0][0];
    for (const [p, w] of table) { if ((r -= w) < 0) { power = p; break; } }
    if (power === 'multi' && this.balls.length >= MAX_BALLS - 2) power = 'wide';
    this.capsules.push({ x, y, power, dead: false });
  }

  private moveCapsules() {
    for (const c of this.capsules) {
      c.y += CAPSULE_FALL * TICK;
      if (c.y - CAPSULE_H / 2 > this.h) { c.dead = true; continue; }
      if (c.y + CAPSULE_H / 2 < PADDLE_Y || c.y - CAPSULE_H / 2 > PADDLE_Y + PADDLE_H) continue;
      const p = this.paddles.find((q) => Math.abs(c.x - q.x) < q.w / 2 + CAPSULE_W / 2);
      if (!p) continue;
      c.dead = true;
      this.give(p, c.power);
      this.events.push({ type: 'pickup', paddle: p, power: c.power, x: c.x, y: c.y });
    }
    this.capsules = this.capsules.filter((c) => !c.dead);
  }

  give(p: Paddle, power: Power) {
    this.addPoints(100, p);
    const time = POWERS[power].time;
    switch (power) {
      case 'wide': p.wideT = time; p.shrinkT = 0; break;
      case 'laser': p.laserT = time; break;
      case 'catch': p.catchT = time; break;
      case 'slow': this.slowT = time; break;
      case 'life': this.lives = Math.min(9, this.lives + 1); break;
      case 'junk': case 'shrink': p.stored = power; break;
      case 'multi': this.split(); break;
    }
  }

  // Every ball in play becomes three (a held ball is let go first)
  private split() {
    let free = this.balls.filter((b) => !b.stuck);
    if (!free.length && this.balls.length) {
      const b = this.balls[0];
      this.launch(b, b.stuck!);
      free = [b];
    }
    for (const b of free) {
      for (const turn of [-25, 25]) {
        if (this.balls.length >= MAX_BALLS) return;
        const a = Math.atan2(b.vx, -b.vy) + turn * DEG;
        const s = Math.hypot(b.vx, b.vy);
        const nb = this.newBall(b.x, b.y, Math.sin(a) * s, -Math.cos(a) * s, b.owner);
        nb.combo = b.combo;
        this.balls.push(nb);
      }
    }
  }

  // --- lasers ------------------------------------------------------------------------------------------
  private fireLasers() {
    for (const p of this.paddles) {
      p.laserCd = Math.max(0, p.laserCd - TICK);
      if (!p.laserT || !p.fire || p.laserCd > 0) continue;
      p.laserCd = 0.28;
      for (const side of [-1, 1]) this.shots.push({ x: p.x + side * (p.w / 2 - 9), y: PADDLE_Y, owner: p, dead: false });
      this.events.push({ type: 'laser', paddle: p });
    }
  }

  private moveShots() {
    for (const s of this.shots) {
      const ny = s.y - SHOT_SPEED * TICK;
      const col = Math.floor(s.x / this.bw);
      // the first brick in this column between where the shot was and where it is now (bottom up)
      for (let r = ROWS - 1; r >= 0 && !s.dead; r--) {
        const br = this.at(col, r);
        if (br?.alive && br.y + br.h >= ny && br.y <= s.y) { s.dead = true; this.hit(br, s.owner, null); }
      }
      s.y = ny;
      if (s.y < 0) s.dead = true;
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  // --- the computer's paddles -------------------------------------------------------------------------
  private think(p: Paddle) {
    const skill = p.spec.skill ?? 0.9;
    const R = BALL_R;
    let target = p.x, soonest = Infinity;
    for (const b of this.balls) {
      if (b.stuck || b.vy <= 0) continue;
      const t = (PADDLE_Y - R - b.y) / b.vy;
      if (t < 0) continue;
      const land = fold(b.x + b.vx * t, R, this.w - R);
      // in co-op, the ball is for whoever is nearest where it will land
      const nearest = this.paddles.reduce((m, q) => (Math.abs(q.x - land) < Math.abs(m.x - land) ? q : m), p);
      if (nearest !== p) continue;
      if (t < soonest) {
        soonest = t;
        // aim to hit it with a chosen spot of the paddle; the less skilful, the further off
        const miss = (1 - skill) * (this.speed / MAX_SPEED) * p.w * 0.9 * Math.sin(this.t * 1.7 + p.x);
        target = land - p.aim * p.w * 0.5 + miss;
      }
    }
    if (soonest === Infinity) {
      // nothing coming: fetch a power-up, or wait under the nearest ball
      const cap = this.capsules.filter((c) => c.power !== 'junk' || this.versus).sort((a, b) => b.y - a.y)[0];
      if (cap) target = cap.x;
      else {
        const b = this.balls.find((q) => !q.stuck);
        target = b ? b.x : p.x;
      }
    }
    p.move = clamp((target - p.x) / 36, -1, 1) * (0.8 + 0.2 * skill);
    p.sprint = soonest < 0.4 && Math.abs(target - p.x) > p.w;
    p.fire = p.laserT > 0;
    p.wait -= TICK;
    if (this.balls.some((b) => b.stuck === p) && p.wait <= 0) p.launch = true;
    if (p.stored && p.wait <= -1) { p.use = true; p.wait = 0; }
  }
}

// Where a point moving sideways ends up between two walls, bouncing
function fold(x: number, lo: number, hi: number) {
  const L = hi - lo;
  let u = (x - lo) % (2 * L);
  if (u < 0) u += 2 * L;
  return lo + (u > L ? 2 * L - u : u);
}

// When does a point moving from (px, py) by (dx, dy) enter the box? (0..1 along the move, and the
// side it comes in by), or null if it doesn't (or starts inside)
export function sweep(px: number, py: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number) {
  let tin = -Infinity, tout = Infinity, nx = 0, ny = 0;
  if (dx === 0) { if (px <= x0 || px >= x1) return null; }
  else {
    let a = (x0 - px) / dx, b = (x1 - px) / dx, n = -1;
    if (a > b) { [a, b] = [b, a]; n = 1; }
    if (a > tin) { tin = a; nx = n; ny = 0; }
    tout = Math.min(tout, b);
  }
  if (dy === 0) { if (py <= y0 || py >= y1) return null; }
  else {
    let a = (y0 - py) / dy, b = (y1 - py) / dy, n = -1;
    if (a > b) { [a, b] = [b, a]; n = 1; }
    if (a > tin) { tin = a; nx = 0; ny = n; }
    tout = Math.min(tout, b);
  }
  if (tin > tout || tin < 0 || tin > 1) return null;
  return { t: tin, nx, ny };
}

// --- a versus round -------------------------------------------------------------------------------------
// Step every field, and carry the attacks between them (Drop sends what a player holds)
export function stepAll(fields: Field[]) {
  for (const f of fields) f.step();
  for (const f of fields) {
    for (const p of f.paddles) {
      if (!p.use) continue;
      p.use = false;
      const power = p.stored;
      if (!power || f.over) continue;
      p.stored = null;
      f.events.push({ type: 'sent', power, paddle: p });
      for (const o of fields) {
        if (o === f || o.over) continue;
        if (power === 'junk') o.addJunk();
        else { for (const q of o.paddles) { q.shrinkT = POWERS.shrink.time; q.wideT = 0; } o.events.push({ type: 'shrunk' }); }
      }
    }
  }
}

// Is the round over, and who took it? The first to clear their wall; else the last one still
// playing; else (everyone out, or the time is up) whoever broke the most of their wall.
export function judgeRound(fields: Field[], t: number): { over: boolean; winner: Field | null } {
  const cleared = fields.filter((f) => f.cleared);
  if (cleared.length) return { over: true, winner: cleared.sort((a, b) => b.score - a.score)[0] };
  const playing = fields.filter((f) => !f.over);
  if (playing.length === 1 && fields.length > 1) return { over: true, winner: playing[0] };
  if (playing.length && t < ROUND_TIME) return { over: false, winner: null };
  const done = (f: Field) => 1 - f.left / Math.max(1, f.total);
  const order = [...fields].sort((a, b) => done(b) - done(a) || b.score - a.score);
  const tie = order.length > 1 && done(order[0]) === done(order[1]) && order[0].score === order[1].score;
  return { over: true, winner: tie ? null : order[0] };
}
export { ROUND_TIME };
