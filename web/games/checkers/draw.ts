// Drawing the board on a 2D canvas: ink squares, our own pieces (discs with a groove, a king with a
// crown on top), the highlights, everyone's cursor as viewfinder corners in their colour, the path of a
// jump being entered, and each move played out hop by hop, the pieces it takes fading as it passes.
// Cheap: a few dozen shapes a frame.
import { colOf, colorOf, destOf, isKing, rowOf, type Color, type Draughts, type Move } from './rules.ts';

// From the brand (brand/README.md): ink squares, chalk and ink pieces
const LIGHT = '#3a3f4e', DARK = '#20242f', EDGE = '#262a36', CHALK = '#f3f0e8', CHALK_3 = '#6a6875', BAD = '#ff4d5a', COIN = '#ffd76a';
const LOOK = { w: { fill: '#f3f0e8', edge: '#07080b', groove: '#c9c4b8' }, b: { fill: '#14171f', edge: '#a6a4ae', groove: '#3a3f4e' } };

// The squares' colours: the ink board, or a theme bought with stars (shop.json)
export const INK_BOARD = { light: LIGHT, dark: DARK };
let board = INK_BOARD;
export const setBoard = (b: { light: string; dark: string }) => { board = b; };

// The crown on a king, in a 100x100 box
const CROWN = 'M28 64l-4-26 14 12 12-18 12 18 14-12-4 26z';

// A piece as inline svg (for the HUD)
export const pieceSvg = (king: boolean, c: Color) => {
  const { fill, edge, groove } = LOOK[c];
  return `<svg viewBox="0 0 100 100" class="piece" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="${fill}" stroke="${edge}" stroke-width="6"/>`
    + (king ? `<path d="${CROWN}" fill="${COIN}" stroke="${edge}" stroke-width="5" stroke-linejoin="round"/>` : `<circle cx="50" cy="50" r="25" fill="none" stroke="${groove}" stroke-width="6"/>`)
    + '</svg>';
};

// What to draw this frame
export interface Scene {
  game: Draughts;
  flipped: boolean; // Black at the bottom
  lastMove: Move | null;
  held: { from: number; hops: number[]; taken: number[]; color: string } | null; // the piece in hand, the hops made so far
  targets: number[]; // where it can hop to next
  must: { squares: number[]; color: string } | null; // pieces that have to take (captures are compulsory)
  cursors: { sq: number; color: string; active: boolean }[];
}

const HOP_MS = 190, STEP_MS = 160, FADE_MS = 220, CROWN_MS = 520;
interface Anim { move: Move; t0: number; ms: number } // a move being played out

export class View {
  private ctx: CanvasRenderingContext2D;
  private crown = new Path2D(CROWN);
  private anim: Anim | null = null;
  private crowned: { sq: number; t0: number } | null = null; // the crown popping on
  private dpr = 1;
  private s = 60; // a square, in device pixels
  private ox = 0; // the board's top left
  private oy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  // Fit the board into this part of the window (css pixels)
  layout(r: { x: number; y: number; w: number; h: number }) {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
    this.s = Math.floor((Math.min(r.w, r.h) * this.dpr) / 8.2);
    const size = this.s * 8;
    this.ox = Math.round(r.x * this.dpr + (r.w * this.dpr - size) / 2);
    this.oy = Math.round(r.y * this.dpr + (r.h * this.dpr - size) / 2);
  }

  // The board's place on the page, in css pixels (for the callout)
  get rect() {
    return { x: this.ox / this.dpr, y: this.oy / this.dpr, size: (this.s * 8) / this.dpr };
  }

  // Play a move out: a slide for a step, a hop for each jump
  play(m: Move) {
    const now = performance.now();
    this.anim = { move: m, t0: now, ms: m.taken.length ? HOP_MS * m.path.length : STEP_MS };
    this.crowned = null;
  }

  get sliding() {
    return this.anim !== null;
  }

  // A square's top left, in device pixels. Unflipped is the usual diagram: Black at the top.
  private xy(square: number, flipped: boolean): [number, number] {
    const col = flipped ? 7 - colOf(square) : colOf(square), row = flipped ? 7 - rowOf(square) : rowOf(square);
    return [this.ox + col * this.s, this.oy + row * this.s];
  }

  frame(sc: Scene, now: number) {
    const g = this.ctx, s = this.s, f = sc.flipped, b = sc.game.board;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const fill = (square: number, color: string, alpha = 1) => {
      const [x, y] = this.xy(square, f);
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.fillRect(x, y, s, s);
      g.globalAlpha = 1;
    };

    // squares (the dark ones numbered, small, as in a diagram), a hairline round the edge
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        g.fillStyle = (r + c) % 2 ? board.dark : board.light;
        g.fillRect(this.ox + c * s, this.oy + r * s, s, s);
      }
    }
    g.strokeStyle = EDGE;
    g.lineWidth = Math.max(1, this.dpr);
    g.strokeRect(this.ox - 0.5, this.oy - 0.5, s * 8 + 1, s * 8 + 1);
    g.fillStyle = CHALK_3;
    g.font = `600 ${Math.round(s * 0.15)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (let q = 0; q < 32; q++) { const [x, y] = this.xy(q, f); g.fillText(String(q + 1), x + s * 0.06, y + s * 0.05); }

    // the last move (where it came from, each square it landed on)
    const lm = sc.lastMove;
    if (lm && !this.anim) { fill(lm.from, CHALK, 0.08); for (const q of lm.path) fill(q, CHALK, 0.14); }

    // the move being played out: where the piece is now, and which taken pieces it hasn't passed yet
    const a = this.anim;
    let moving: { x: number; y: number; lift: number } | null = null, passed = 0;
    if (a) {
      const t = Math.min(1, (now - a.t0) / a.ms), legs = a.move.path.length;
      if (!a.move.taken.length) {
        const e = 1 - (1 - t) ** 3; // (ease-out)
        const [x0, y0] = this.xy(a.move.from, f), [x1, y1] = this.xy(destOf(a.move), f);
        moving = { x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, lift: 0 };
      } else {
        const leg = Math.min(legs - 1, Math.floor(t * legs)), u = t * legs - leg, e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        const from = leg ? a.move.path[leg - 1] : a.move.from, [x0, y0] = this.xy(from, f), [x1, y1] = this.xy(a.move.path[leg], f);
        moving = { x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, lift: Math.sin(Math.PI * u) };
        passed = leg + (u >= 0.5 ? 1 : 0);
      }
      if (t >= 1) {
        if (a.move.crown) this.crowned = { sq: destOf(a.move), t0: now };
        this.anim = null;
        moving = null;
      }
    }

    // the piece in hand: its square lit, the path so far, the pieces it has jumped crossed out
    const h = sc.held;
    if (h) {
      fill(h.from, h.color, 0.3);
      for (const q of h.hops) fill(q, h.color, 0.16);
    }
    // pieces that must take: a ring that breathes
    if (sc.must && !h && !a) {
      const pulse = 0.55 + 0.45 * Math.sin(now / 220);
      g.strokeStyle = sc.must.color;
      g.lineWidth = s * 0.06;
      g.globalAlpha = pulse;
      for (const q of sc.must.squares) {
        const [x, y] = this.xy(q, f);
        g.beginPath();
        g.arc(x + s / 2, y + s / 2, s * 0.47, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // pieces (the one in hand is drawn where it has hopped to; the one moving, on its way)
    const handAt = h ? (h.hops.length ? h.hops[h.hops.length - 1] : h.from) : -1;
    for (let q = 0; q < 32; q++) {
      if (!b[q] || q === h?.from || h?.taken.includes(q) || (a && q === destOf(a.move))) continue;
      const crownT = this.crowned?.sq === q ? Math.min(1, (now - this.crowned.t0) / CROWN_MS) : 1;
      this.piece(b[q], ...this.xy(q, f), 0, 1, crownT);
    }
    if (a) {
      a.move.taken.forEach((q, i) => { // (taken: still there until the jumping piece passes, then fading)
        const gone = i < passed ? Math.min(1, (now - a.t0 - ((i + 0.5) * a.ms) / a.move.path.length) / FADE_MS) : 0;
        if (gone < 1) this.piece(a.move.captured[i], ...this.xy(q, f), 0, 1 - gone, 1, 1 - gone * 0.3);
      });
    }
    if (h) {
      for (const q of h.taken) { this.piece(b[q], ...this.xy(q, f), 0, 0.35); this.cross(q, f); }
      this.path([h.from, ...h.hops], h.color, f);
      this.piece(b[h.from], ...this.xy(handAt, f), 1, 1);
    }
    if (a && moving) this.piece(a.move.piece, moving.x, moving.y, moving.lift, 1);

    // where the piece in hand can hop to next: a dot
    if (h) {
      g.fillStyle = h.color;
      for (const q of sc.targets) {
        const [x, y] = this.xy(q, f);
        g.beginPath();
        g.arc(x + s / 2, y + s / 2, s * 0.14, 0, Math.PI * 2);
        g.fill();
      }
    }

    // cursors: the player to move on top, the other faded (and a little smaller, if they share a square)
    for (const cur of [...sc.cursors].sort((p, z) => Number(p.active) - Number(z.active))) {
      const [x, y] = this.xy(cur.sq, f);
      const inset = !cur.active && sc.cursors.some((o) => o.active && o.sq === cur.sq) ? s * 0.12 : s * 0.04;
      this.corners(x + inset, y + inset, s - inset * 2, cur.color, cur.active ? 1 : 0.5);
    }
  }

  // A piece: a disc with a groove, or a king with its crown. lift: raised off the board (0-1), with a
  // bigger shadow. crownT: how far the crown has popped on (0-1). scale: shrinking as it's taken.
  private piece(p: number, x: number, y: number, lift: number, alpha: number, crownT = 1, scale = 1) {
    const g = this.ctx, s = this.s, { fill, edge, groove } = LOOK[colorOf(p)], r = s * 0.38 * scale * (1 + lift * 0.1);
    const cx = x + s / 2, cy = y + s / 2 - lift * s * 0.12;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = 'rgb(0 0 0 / 0.45)'; // (shadow)
    g.beginPath();
    g.ellipse(x + s / 2 + s * 0.03, y + s / 2 + s * 0.05 + lift * s * 0.06, r * (1 + lift * 0.15), r * 0.95, 0, 0, Math.PI * 2);
    g.fill();
    if (isKing(p)) { // (a second disc beneath, as a crowned piece is stacked)
      g.fillStyle = fill;
      g.strokeStyle = edge;
      g.lineWidth = Math.max(2, s * 0.045);
      g.beginPath();
      g.arc(cx, cy + s * 0.06, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = fill;
    g.strokeStyle = edge;
    g.lineWidth = Math.max(2, s * 0.045);
    g.beginPath();
    g.arc(cx, cy - (isKing(p) ? s * 0.03 : 0), r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    const top = cy - (isKing(p) ? s * 0.03 : 0);
    g.strokeStyle = groove;
    g.lineWidth = Math.max(1.5, s * 0.035);
    g.beginPath();
    g.arc(cx, top, r * 0.62, 0, Math.PI * 2);
    g.stroke();
    if (isKing(p) && crownT > 0) {
      // the crown pops on: a little too big, then settles
      const k = crownT < 1 ? 1 + 0.5 * Math.sin(Math.PI * crownT) : 1, size = (s / 100) * 0.62 * k * scale;
      g.translate(cx - 50 * size, top - 48 * size);
      g.scale(size, size);
      g.fillStyle = COIN;
      g.strokeStyle = colorOf(p) === 'w' ? edge : '#07080b';
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.fill(this.crown);
      g.stroke(this.crown);
    }
    g.restore();
  }

  // A cross over a piece that has been jumped (while a jump is being entered)
  private cross(q: number, f: boolean) {
    const g = this.ctx, s = this.s, [x, y] = this.xy(q, f), d = s * 0.2;
    g.strokeStyle = BAD;
    g.lineWidth = s * 0.07;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + s / 2 - d, y + s / 2 - d);
    g.lineTo(x + s / 2 + d, y + s / 2 + d);
    g.moveTo(x + s / 2 + d, y + s / 2 - d);
    g.lineTo(x + s / 2 - d, y + s / 2 + d);
    g.stroke();
  }

  // The hops made so far, as a line through the squares
  private path(squares: number[], color: string, f: boolean) {
    if (squares.length < 2) return;
    const g = this.ctx, s = this.s;
    g.strokeStyle = color;
    g.lineWidth = s * 0.06;
    g.lineCap = g.lineJoin = 'round';
    g.setLineDash([s * 0.12, s * 0.12]);
    g.beginPath();
    squares.forEach((q, i) => { const [x, y] = this.xy(q, f); (i ? g.lineTo : g.moveTo).call(g, x + s / 2, y + s / 2); });
    g.stroke();
    g.setLineDash([]);
  }

  // The brand's selection frame: four corners
  private corners(x: number, y: number, size: number, color: string, alpha: number) {
    const g = this.ctx, len = size * 0.3;
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = Math.max(3, this.s * 0.07);
    g.lineCap = 'square';
    g.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + size, y, -1, 1], [x, y + size, 1, -1], [x + size, y + size, -1, -1]]) {
      g.moveTo(cx, cy + dy * len);
      g.lineTo(cx, cy);
      g.lineTo(cx + dx * len, cy);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
}
