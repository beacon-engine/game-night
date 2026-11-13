// Drawing Snakes and Ladders on a 2D canvas. The board (squares, numbers, ladders, snakes) is painted once
// into a canvas of its own whenever the layout or the board changes; each frame copies it, then draws the
// tokens and the die on top. A few dozen shapes a frame: fine on a weak TV.
import { centre, LAST, SIZE, type Board } from './rules.ts';

type P = { x: number; y: number };

// A token: where it stands (a square), or exactly where it is mid-move (board units), and how high it hops
export interface Token { color: string; n: number; sq: number; at?: P; lift?: number; active: boolean }
// The die, at its place on the page (css pixels): the face showing, thrown `t` seconds ago
export interface Die { value: number; rolling: boolean; t: number; color: string }
export interface Scene { tokens: Token[]; die: Die | null; ring: number } // ring: a square to mark (-1: none)

// From the brand (brand/README.md), and the board's own colours: content, not UI
const INK_0 = '#07080b', CHALK = '#f3f0e8', CHALK_3 = '#6a6875', VOLT = '#d7ff3b', LINE = '#3a3f4e';
// The squares: dark, each a muted colour, so the snakes, ladders and tokens stand out
const SQUARES = ['#1f2b2a', '#2a2433', '#2d2a21', '#1f2636', '#2e2228'];
// Each snake's look: body, pattern, outline, and how it's patterned
const SNAKES = [
  { body: '#4fb85f', mark: '#f2d64b', edge: '#123018', kind: 'bands' },
  { body: '#e2513f', mark: '#2a1012', edge: '#3d0f0c', kind: 'diamonds' },
  { body: '#9a6bf2', mark: '#ffb547', edge: '#24154a', kind: 'spots' },
  { body: '#33b9cc', mark: '#0f3c49', edge: '#0b2a33', kind: 'diamonds' },
  { body: '#f0952f', mark: '#5a2a0a', edge: '#3b1c05', kind: 'bands' },
  { body: '#d4d84a', mark: '#3b4a12', edge: '#2c3309', kind: 'spots' },
] as const;
const WOOD = { rail: '#c98f4e', rung: '#e3b77d', edge: '#4a2d14' };
const UI = 'Inter, system-ui, sans-serif', DISPLAY = '"Big Shoulders Display", Inter, sans-serif';

// The spine of a snake, head (t=0) to tail (t=1), in board units: a wave either side of the straight line,
// still at both ends, so the head and the tail sit in the middle of their squares
function spine(head: number, tail: number, i: number): P[] {
  const h = centre(head), z = centre(tail);
  const dx = z.x - h.x, dy = z.y - h.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  const waves = Math.max(2, Math.round(len / 1.5)), amp = Math.min(0.45, 0.2 + len * 0.03) * (i % 2 ? 1 : -1);
  const out: P[] = [];
  for (let k = 0; k <= 72; k++) {
    const t = k / 72, side = amp * Math.sin(waves * Math.PI * t) * Math.sin(Math.PI * t) ** 0.6;
    out.push({ x: h.x + dx * t + nx * side, y: h.y + dy * t + ny * side });
  }
  return out;
}

// How thick a snake is along its length: a neck behind the head, then tapering to the tail
const girth = (t: number) => (t < 0.08 ? 0.78 + (t / 0.08) * 0.22 : 1 - 0.9 * ((t - 0.08) / 0.92) ** 1.4);
const SNAKE_W = 0.26; // squares

// A point a fraction t along a polyline (by length)
function along(pts: P[], t: number): P {
  const f = Math.max(0, Math.min(1, t)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
}

export class View {
  private ctx: CanvasRenderingContext2D;
  private bg = document.createElement('canvas'); // the board, painted once
  private board: Board | null = null;
  private spines: P[][] = [];
  private dpr = 1;
  private s = 50; // a square, in device pixels
  private ox = 0; // the top left of square 91, in device pixels
  private oy = 0;
  private dieAt = { x: 0, y: 0, size: 0 }; // device pixels

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  // Fit the board (and the start, off its left edge) into this part of the page, and the die into its own
  // place (css pixels)
  layout(r: { x: number; y: number; w: number; h: number }, die?: { x: number; y: number; w: number; h: number }) {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
    const d = this.dpr;
    this.s = Math.floor(Math.min((r.w * d) / (SIZE + 1), (r.h * d) / (SIZE + 0.2)));
    const w = this.s * (SIZE + 1), h = this.s * SIZE;
    this.ox = Math.round(r.x * d + (r.w * d - w) / 2 + this.s);
    this.oy = Math.round(r.y * d + (r.h * d - h) / 2);
    if (die) {
      const size = Math.min(die.w, die.h) * d * 0.62;
      this.dieAt = { x: (die.x + die.w / 2) * d, y: (die.y + die.h / 2) * d, size };
    } else this.dieAt.size = 0;
    this.paint();
  }

  setBoard(b: Board) {
    this.board = b;
    this.spines = b.snakes.map(([a, z], i) => spine(a, z, i));
    this.paint();
  }

  // The board's place on the page, in css pixels (for the callout)
  get rect() {
    return { x: this.ox / this.dpr, y: this.oy / this.dpr, size: (this.s * SIZE) / this.dpr };
  }

  // Where a token sliding down snake i is, t of the way from head to tail (board units)
  onSnake(i: number, t: number) {
    return along(this.spines[i], t);
  }

  // --- the board, painted once (and again once the fonts have loaded) ----------------------------------
  paint() {
    const b = this.board;
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    if (!b) return;
    const g = this.bg.getContext('2d')!, s = this.s;
    g.save();
    g.translate(this.ox, this.oy);
    g.scale(s, s); // (from here on, one unit is one square)

    // squares and their numbers
    for (let n = 1; n <= LAST; n++) {
      const c = centre(n), x = c.x - 0.5, y = c.y - 0.5;
      g.fillStyle = SQUARES[(Math.floor(x) * 2 + Math.floor(y) * 3) % SQUARES.length];
      g.fillRect(x, y, 1, 1);
      if ((Math.floor(x) + Math.floor(y)) % 2) { g.fillStyle = 'rgb(255 255 255 / 0.035)'; g.fillRect(x, y, 1, 1); }
    }
    g.strokeStyle = 'rgb(7 8 11 / 0.55)';
    g.lineWidth = 0.02;
    for (let k = 0; k <= SIZE; k++) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, SIZE); g.stroke();
      g.beginPath(); g.moveTo(0, k); g.lineTo(SIZE, k); g.stroke();
    }
    // home: square 100 picked out in volt
    const home = centre(LAST);
    g.fillStyle = 'rgb(215 255 59 / 0.16)';
    g.fillRect(home.x - 0.5, home.y - 0.5, 1, 1);
    g.strokeStyle = VOLT;
    g.lineWidth = 0.05;
    g.strokeRect(home.x - 0.47, home.y - 0.47, 0.94, 0.94);
    g.textBaseline = 'top';
    g.textAlign = 'left';
    for (let n = 1; n <= LAST; n++) {
      const c = centre(n);
      g.fillStyle = n === LAST ? VOLT : 'rgb(243 240 232 / 0.55)';
      this.text(g, String(n), c.x - 0.43, c.y - 0.43, n === LAST ? 0.25 : 0.21, UI);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = VOLT;
    this.text(g, 'HOME', home.x, home.y + 0.18, 0.26, DISPLAY);
    // the start, off the board beside square 1
    const st = centre(0);
    g.strokeStyle = LINE;
    g.lineWidth = 0.03;
    g.setLineDash([0.08, 0.08]);
    g.strokeRect(st.x - 0.42, st.y - 0.47, 0.84, 0.94);
    g.setLineDash([]);
    g.fillStyle = CHALK_3;
    this.text(g, 'START', st.x, st.y - 0.64, 0.22, DISPLAY);
    g.strokeStyle = LINE;
    g.lineWidth = 0.02;
    g.strokeRect(0, 0, SIZE, SIZE);

    b.ladders.forEach(([a, z]) => this.ladder(g, a, z));
    this.spines.forEach((pts, i) => this.snake(g, pts, i));
    g.restore();
  }

  private ladder(g: CanvasRenderingContext2D, foot: number, top: number) {
    const a = centre(foot), z = centre(top);
    const dx = z.x - a.x, dy = z.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy * 0.2, ny = ux * 0.2;
    const over = 0.16; // (the rails stick out past the middles of the squares a little)
    const ax = a.x - ux * over, ay = a.y - uy * over, zx = z.x + ux * over, zy = z.y + uy * over;
    const rail = (side: number, dx2 = 0, dy2 = 0) => { g.beginPath(); g.moveTo(ax + nx * side + dx2, ay + ny * side + dy2); g.lineTo(zx + nx * side + dx2, zy + ny * side + dy2); g.stroke(); };
    const rungs = Math.max(2, Math.round((len + over * 2) / 0.3));
    const rung = (k: number, dx2 = 0, dy2 = 0) => {
      const t = (k + 0.5) / rungs, x = ax + (zx - ax) * t + dx2, y = ay + (zy - ay) * t + dy2;
      g.beginPath(); g.moveTo(x - nx, y - ny); g.lineTo(x + nx, y + ny); g.stroke();
    };
    g.lineCap = 'round';
    // a shadow, then the rungs under the rails
    g.strokeStyle = 'rgb(0 0 0 / 0.4)';
    g.lineWidth = 0.1;
    rail(1, 0.05, 0.07); rail(-1, 0.05, 0.07);
    for (let k = 0; k < rungs; k++) {
      g.strokeStyle = WOOD.edge; g.lineWidth = 0.075; rung(k);
      g.strokeStyle = WOOD.rung; g.lineWidth = 0.045; rung(k);
    }
    for (const side of [1, -1]) {
      g.strokeStyle = WOOD.edge; g.lineWidth = 0.1; rail(side);
      g.strokeStyle = WOOD.rail; g.lineWidth = 0.06; rail(side);
    }
  }

  private snake(g: CanvasRenderingContext2D, pts: P[], i: number) {
    const look = SNAKES[i % SNAKES.length], n = pts.length;
    // the body's two edges, from the spine's normals
    const left: P[] = [], right: P[] = [], nrm: P[] = [];
    for (let k = 0; k < n; k++) {
      const p = pts[Math.max(0, k - 1)], q = pts[Math.min(n - 1, k + 1)];
      const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1, w = (SNAKE_W / 2) * girth(k / (n - 1));
      nrm.push({ x: -dy / l, y: dx / l });
      left.push({ x: pts[k].x - (dy / l) * w, y: pts[k].y + (dx / l) * w });
      right.push({ x: pts[k].x + (dy / l) * w, y: pts[k].y - (dx / l) * w });
    }
    const outline = (ox = 0, oy = 0) => {
      g.beginPath();
      left.forEach((p, k) => (k ? g.lineTo(p.x + ox, p.y + oy) : g.moveTo(p.x + ox, p.y + oy)));
      for (let k = n - 1; k >= 0; k--) g.lineTo(right[k].x + ox, right[k].y + oy);
      g.closePath();
    };
    // the head: an oval facing away from the body
    const hx = pts[0].x - pts[3].x, hy = pts[0].y - pts[3].y, hl = Math.hypot(hx, hy), ux = hx / hl, uy = hy / hl;
    const angle = Math.atan2(uy, ux), cx = pts[0].x + ux * 0.04, cy = pts[0].y + uy * 0.04;
    const head = (ox = 0, oy = 0) => { g.beginPath(); g.ellipse(cx + ox, cy + oy, SNAKE_W * 0.85, SNAKE_W * 0.66, angle, 0, Math.PI * 2); };

    // shadow
    g.fillStyle = 'rgb(0 0 0 / 0.4)';
    outline(0.05, 0.07); g.fill();
    head(0.05, 0.07); g.fill();
    // body and pattern
    g.fillStyle = look.body;
    outline(); g.fill();
    g.save();
    outline(); g.clip();
    g.fillStyle = look.mark;
    for (let k = 4; k < n - 3; k += 4) {
      const p = pts[k], w = (SNAKE_W / 2) * girth(k / (n - 1)), q = pts[k + 1], tx = q.x - p.x, ty = q.y - p.y, tl = Math.hypot(tx, ty) || 1;
      const ax = tx / tl, ay = ty / tl, m = nrm[k];
      g.beginPath();
      if (look.kind === 'bands') {
        const a = 0.045;
        g.moveTo(left[k].x - ax * a, left[k].y - ay * a); g.lineTo(left[k].x + ax * a, left[k].y + ay * a);
        g.lineTo(right[k].x + ax * a, right[k].y + ay * a); g.lineTo(right[k].x - ax * a, right[k].y - ay * a);
      } else if (look.kind === 'diamonds') {
        const a = 0.07;
        g.moveTo(p.x - ax * a, p.y - ay * a); g.lineTo(p.x + m.x * w * 0.75, p.y + m.y * w * 0.75);
        g.lineTo(p.x + ax * a, p.y + ay * a); g.lineTo(p.x - m.x * w * 0.75, p.y - m.y * w * 0.75);
      } else g.arc(p.x + m.x * w * 0.3 * (k % 8 ? 1 : -1), p.y + m.y * w * 0.3 * (k % 8 ? 1 : -1), w * 0.38, 0, Math.PI * 2);
      g.fill();
    }
    // a sheen along one side, so it looks round
    g.strokeStyle = 'rgb(255 255 255 / 0.22)';
    g.lineWidth = 0.035;
    g.beginPath();
    pts.forEach((p, k) => {
      const w = (SNAKE_W / 2) * girth(k / (n - 1)) * 0.45, x = p.x + nrm[k].x * w, y = p.y + nrm[k].y * w;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
    g.restore();
    g.strokeStyle = look.edge;
    g.lineWidth = 0.03;
    g.lineJoin = 'round';
    outline(); g.stroke();

    // the head, a forked tongue, two eyes
    const tip = { x: cx + ux * SNAKE_W * 0.85, y: cy + uy * SNAKE_W * 0.85 }, fork = { x: tip.x + ux * 0.12, y: tip.y + uy * 0.12 };
    g.strokeStyle = '#ff3b55';
    g.lineWidth = 0.025;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(tip.x, tip.y); g.lineTo(fork.x, fork.y);
    g.lineTo(fork.x + ux * 0.06 - uy * 0.045, fork.y + uy * 0.06 + ux * 0.045);
    g.moveTo(fork.x, fork.y); g.lineTo(fork.x + ux * 0.06 + uy * 0.045, fork.y + uy * 0.06 - ux * 0.045);
    g.stroke();
    g.fillStyle = look.body;
    head(); g.fill();
    g.strokeStyle = look.edge;
    g.lineWidth = 0.03;
    head(); g.stroke();
    for (const side of [1, -1]) {
      const ex = cx + ux * 0.05 - uy * side * SNAKE_W * 0.36, ey = cy + uy * 0.05 + ux * side * SNAKE_W * 0.36;
      g.fillStyle = CHALK;
      g.beginPath(); g.arc(ex, ey, SNAKE_W * 0.17, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK_0;
      g.beginPath(); g.ellipse(ex + ux * 0.01, ey + uy * 0.01, SNAKE_W * 0.05, SNAKE_W * 0.12, angle, 0, Math.PI * 2); g.fill();
    }
  }

  // --- each frame -------------------------------------------------------------------------------------
  frame(sc: Scene, now: number) {
    const g = this.ctx, s = this.s;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.board) return;
    g.drawImage(this.bg, 0, 0);
    g.save();
    g.translate(this.ox, this.oy);
    g.scale(s, s);
    if (sc.ring > 0) {
      const c = centre(sc.ring), pulse = 0.5 + 0.5 * Math.sin(now / 160);
      g.strokeStyle = `rgb(215 255 59 / ${0.45 + pulse * 0.45})`;
      g.lineWidth = 0.05;
      g.strokeRect(c.x - 0.46, c.y - 0.46, 0.92, 0.92);
    }
    this.tokens(g, sc.tokens, now);
    g.restore();
    if (sc.die && this.dieAt.size) this.die(g, sc.die);
  }

  // Tokens standing on a square share it: side by side for two, a triangle for three, a square for four
  private tokens(g: CanvasRenderingContext2D, list: Token[], now: number) {
    const groups = new Map<number, Token[]>();
    for (const t of list) if (!t.at) groups.set(t.sq, [...(groups.get(t.sq) ?? []), t]);
    const SPOTS = [[[0, 0]], [[-0.21, 0], [0.21, 0]], [[-0.21, 0.17], [0.21, 0.17], [0, -0.19]], [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]];
    const placed: { t: Token; x: number; y: number; r: number }[] = [];
    for (const [sq, ts] of groups) {
      const c = centre(sq), spots = SPOTS[Math.min(ts.length, 4) - 1];
      ts.forEach((t, k) => {
        const [dx, dy] = spots[k % spots.length];
        placed.push({ t, x: c.x + dx, y: c.y + dy + (ts.length > 1 ? 0.04 : 0.06), r: ts.length > 1 ? 0.19 : 0.25 });
      });
    }
    for (const t of list) if (t.at) placed.push({ t, x: t.at.x, y: t.at.y + 0.06, r: 0.25 });
    // the one whose turn it is last (on top), the mover above everyone
    placed.sort((a, b) => Number(!!a.t.at) - Number(!!b.t.at) || Number(a.t.active) - Number(b.t.active) || a.y - b.y);
    for (const { t, x, y, r } of placed) {
      const lift = t.lift ?? 0;
      g.fillStyle = 'rgb(0 0 0 / 0.45)';
      g.beginPath(); g.ellipse(x + 0.03, y + r * 0.75, r * (1 - lift * 0.5), r * 0.4 * (1 - lift * 0.5), 0, 0, Math.PI * 2); g.fill();
      const ty = y - lift;
      if (t.active && !t.at) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        g.strokeStyle = t.color;
        g.globalAlpha = 0.5 + pulse * 0.5;
        g.lineWidth = 0.05;
        g.beginPath(); g.arc(x, ty, r + 0.07 + pulse * 0.04, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = INK_0;
      g.beginPath(); g.arc(x, ty, r + 0.035, 0, Math.PI * 2); g.fill();
      g.fillStyle = t.color;
      g.beginPath(); g.arc(x, ty, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgb(255 255 255 / 0.5)';
      g.lineWidth = 0.025;
      g.beginPath(); g.arc(x, ty, r * 0.72, 0, Math.PI * 2); g.stroke();
      g.fillStyle = INK_0;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      this.text(g, String(t.n), x, ty + r * 0.08, r * 1.2, DISPLAY);
    }
  }

  // Text, its size in squares. (Drawn at the canvas's own scale: fonts under a pixel don't scale up well.)
  private text(g: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, family: string) {
    const s = this.s;
    g.save();
    g.scale(1 / s, 1 / s);
    g.font = `800 ${Math.round(size * s)}px ${family}`;
    g.fillText(str, x * s, y * s);
    g.restore();
  }

  // The die: tumbling while it's thrown, then settling on its face with a little pop
  private die(g: CanvasRenderingContext2D, d: Die) {
    const { x, y, size } = this.dieAt;
    const spin = d.rolling ? Math.sin(d.t * 31) * 0.35 + d.t * 7 : 0;
    const pop = d.rolling ? 0.92 + Math.abs(Math.sin(d.t * 17)) * 0.1 : 1 + Math.max(0, 0.14 - d.t) * 1.1;
    const hop = d.rolling ? -Math.abs(Math.sin(d.t * 11)) * size * 0.12 : 0;
    const w = size * pop, rad = w * 0.18;
    g.save();
    g.fillStyle = 'rgb(0 0 0 / 0.45)';
    g.beginPath(); g.ellipse(x, y + size * 0.6, size * 0.45, size * 0.1, 0, 0, Math.PI * 2); g.fill();
    g.translate(x, y + hop);
    g.rotate(spin);
    g.fillStyle = d.color;
    g.beginPath(); g.roundRect(-w / 2 - size * 0.05, -w / 2 - size * 0.05, w + size * 0.1, w + size * 0.1, rad * 1.2); g.fill();
    g.fillStyle = CHALK;
    g.beginPath(); g.roundRect(-w / 2, -w / 2, w, w, rad); g.fill();
    const PIPS: Record<number, number[][]> = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    };
    g.fillStyle = INK_0;
    for (const [px, py] of PIPS[d.value] ?? []) {
      g.beginPath(); g.arc(px * w * 0.26, py * w * 0.26, w * 0.085, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
}
