// Drawing the board on a 2D canvas: ink squares, our own vector pieces (svg paths, so the HUD can
// show the same ones), the highlights, everyone's cursor as viewfinder corners in their colour,
// and a short slide for each move. Cheap: a few dozen shapes a frame.
import { BISHOP, fileOf, KNIGHT, QUEEN, rankOf, ROOK, sq, typeOf, colorOf, type Chess, type Color, type Move } from './rules.ts';

// The pieces, in a 100x100 box: a body (filled and outlined) and an optional detail line.
// Drawn for this game; no fonts or downloaded art.
const BASE = 'M24 90h52a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-52a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2z';
const BALL = (x: number, y: number) => `M${x} ${y - 5}a5 5 0 1 1 0 10a5 5 0 1 1 0-10z`;
const SHAPES: Record<number, { body: string; detail?: string }> = {
  1: { body: BASE + 'M50 16a12 12 0 0 1 7 21.7c4 2 6.5 5 6.5 8.3h-27c0-3.3 2.5-6.3 6.5-8.3a12 12 0 0 1 7-21.7zM39 50h22c0 10 3 19 9 26h-40c6-7 9-16 9-26z' },
  2: { body: BASE + 'M30 76c0-14 6-22 14-28-6 1-12 4-16 8-3 2-7 0-6-4l4-8c4-8 10-16 18-20l2-9 6 7c14 3 24 16 24 38v16z', detail: 'M37 33h.01' },
  3: { body: BASE + 'M50 6a5 5 0 0 1 3 9c9 7 15 15 15 23 0 6-4 10-9 12h-18c-5-2-9-6-9-12 0-8 6-16 15-23a5 5 0 0 1 3-9zM40 54h20c0 9 3 16 8 22h-36c5-6 8-13 8-22z', detail: 'M56 24l-8 10' },
  4: { body: BASE + 'M27 16h10v8h8v-8h10v8h8v-8h10v18l-8 6h-30l-8-6zM37 44h26l3 32h-32z' },
  5: { body: BASE + BALL(50, 13) + BALL(20, 23) + BALL(80, 23) + BALL(34, 17) + BALL(66, 17) + 'M22 30l14 18 2-22 12 20 12-20 2 22 14-18-6 30h-44zM31 64h38l2 12h-42z' },
  6: { body: BASE + 'M46 4h8v7h7v8h-7v7h-8v-7h-7v-8h7zM50 30c4-4 10-6 17-4 9 3 12 12 8 21l-6 13h-38l-6-13c-4-9-1-18 8-21 7-2 13 0 17 4zM31 64h38l2 12h-42z', detail: 'M50 31v27' },
};

// From the brand (brand/README.md): ink squares, chalk and ink pieces
const LIGHT = '#3a3f4e', DARK = '#20242f', EDGE = '#262a36', CHALK_2 = '#a6a4ae', CHALK_3 = '#6a6875', BAD = '#ff4d5a';
const LOOK = { w: { fill: '#f3f0e8', edge: '#07080b' }, b: { fill: '#0e1016', edge: CHALK_2 } };

// A piece as inline svg (for the captured pieces in the HUD)
export const pieceSvg = (type: number, c: Color) => {
  const { body, detail } = SHAPES[type], { fill, edge } = LOOK[c];
  return `<svg viewBox="0 0 100 100" class="piece" aria-hidden="true"><path d="${body}" fill="${fill}" stroke="${edge}" stroke-width="6" stroke-linejoin="round"/>${detail ? `<path d="${detail}" fill="none" stroke="${edge}" stroke-width="6" stroke-linecap="round"/>` : ''}</svg>`;
};

export const PROMOTIONS = [QUEEN, ROOK, BISHOP, KNIGHT];

// What to draw this frame
export interface Scene {
  game: Chess;
  flipped: boolean; // Black at the bottom
  lastMove: Move | null;
  held: { sq: number; color: string } | null; // the picked-up piece, in its player's colour
  targets: Move[]; // where it can go
  cursors: { sq: number; color: string; active: boolean }[];
  promo: { side: Color; choice: number; color: string } | null; // picking what a pawn becomes
}

interface Slide { piece: number; from: number; to: number; t0: number }
const SLIDE_MS = 150;

export class View {
  private ctx: CanvasRenderingContext2D;
  private paths = new Map<number, { body: Path2D; detail?: Path2D }>();
  private slides: Slide[] = [];
  private dpr = 1;
  private s = 60; // a square, in device pixels
  private ox = 0; // the board's top left
  private oy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (const [t, { body, detail }] of Object.entries(SHAPES)) {
      this.paths.set(Number(t), { body: new Path2D(body), detail: detail ? new Path2D(detail) : undefined });
    }
  }

  // Fit the board into this part of the window (css pixels), leaving room for the coordinates
  layout(r: { x: number; y: number; w: number; h: number }) {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
    this.s = Math.floor((Math.min(r.w, r.h) * this.dpr) / 8.5);
    const size = this.s * 8, gutter = this.s * 0.5; // (the a-h and 1-8 sit in the gutter, left and below)
    this.ox = Math.round(r.x * this.dpr + (r.w * this.dpr - size + gutter) / 2);
    this.oy = Math.round(r.y * this.dpr + (r.h * this.dpr - size - gutter) / 2);
  }

  // The board's place on the page, in css pixels (for the callout)
  get rect() {
    return { x: this.ox / this.dpr, y: this.oy / this.dpr, size: (this.s * 8) / this.dpr };
  }

  // Slide a move's piece (and the rook, when castling) from its old square
  slide(m: Move) {
    const t0 = performance.now();
    this.slides = [{ piece: m.piece, from: m.from, to: m.to, t0 }];
    if (m.flag === 'castle') {
      const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      this.slides.push({ piece: (m.piece & 24) | ROOK, from: rf, to: rt, t0 });
    }
  }

  get sliding() {
    return this.slides.length > 0;
  }

  private xy(square: number, flipped: boolean): [number, number] {
    const col = flipped ? 7 - fileOf(square) : fileOf(square), row = flipped ? rankOf(square) : 7 - rankOf(square);
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

    // squares, coordinates, a hairline round the edge
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) fill(sq(c, r), (c + r) % 2 ? LIGHT : DARK);
    g.strokeStyle = EDGE;
    g.lineWidth = Math.max(1, this.dpr);
    g.strokeRect(this.ox - 0.5, this.oy - 0.5, s * 8 + 1, s * 8 + 1);
    g.fillStyle = CHALK_3;
    g.font = `600 ${Math.round(s * 0.24)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      g.fillText('abcdefgh'[f ? 7 - i : i], this.ox + (i + 0.5) * s, this.oy + s * 8.25);
      g.fillText(String(f ? i + 1 : 8 - i), this.ox - s * 0.25, this.oy + (i + 0.5) * s);
    }

    // the last move, a king in check, the piece in hand
    if (sc.lastMove) { fill(sc.lastMove.from, '#f3f0e8', 0.1); fill(sc.lastMove.to, '#f3f0e8', 0.16); }
    if (sc.game.inCheck()) fill(sc.game.kings[sc.game.turn], BAD, 0.55);
    if (sc.held) fill(sc.held.sq, sc.held.color, 0.35);

    // pieces (a sliding one is drawn on its way instead)
    this.slides = this.slides.filter((m) => now - m.t0 < SLIDE_MS);
    const moving = new Set(this.slides.map((m) => m.to));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const square = sq(c, r);
        if (b[square] && !moving.has(square)) this.piece(typeOf(b[square]), colorOf(b[square]), ...this.xy(square, f));
      }
    }
    for (const m of this.slides) {
      const t = 1 - (1 - (now - m.t0) / SLIDE_MS) ** 3; // (ease-out)
      const [x0, y0] = this.xy(m.from, f), [x1, y1] = this.xy(m.to, f);
      this.piece(typeOf(b[m.to]) || typeOf(m.piece), colorOf(m.piece), x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }

    // where the piece in hand can go: a dot, or a ring round a piece it would take
    if (sc.held) {
      g.fillStyle = g.strokeStyle = sc.held.color;
      g.lineWidth = s * 0.08;
      for (const m of new Set(sc.targets.map((m) => m.to))) {
        const [x, y] = this.xy(m, f);
        g.beginPath();
        if (b[m]) { g.arc(x + s / 2, y + s / 2, s * 0.44, 0, Math.PI * 2); g.stroke(); }
        else { g.arc(x + s / 2, y + s / 2, s * 0.14, 0, Math.PI * 2); g.fill(); }
      }
    }

    // cursors: the player to move on top, the other faded (and a little smaller, if they share a square)
    for (const cur of [...sc.cursors].sort((a, z) => Number(a.active) - Number(z.active))) {
      const [x, y] = this.xy(cur.sq, f);
      const inset = !cur.active && sc.cursors.some((o) => o.active && o.sq === cur.sq) ? s * 0.12 : s * 0.04;
      this.corners(x + inset, y + inset, s - inset * 2, cur.color, cur.active ? 1 : 0.5);
    }

    if (sc.promo) this.promoPicker(sc.promo);
  }

  private piece(type: number, c: Color, x: number, y: number) {
    const g = this.ctx, p = this.paths.get(type)!, k = this.s / 100, { fill, edge } = LOOK[c];
    g.save();
    g.translate(x + this.s * 0.08, y + this.s * 0.06);
    g.scale(k * 0.84, k * 0.84);
    g.fillStyle = fill;
    g.strokeStyle = edge;
    g.lineWidth = 4.5;
    g.lineJoin = g.lineCap = 'round';
    g.fill(p.body);
    g.stroke(p.body);
    if (p.detail) g.stroke(p.detail);
    g.restore();
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

  // What should the pawn become? Four pieces across the middle of the board.
  private promoPicker(p: NonNullable<Scene['promo']>) {
    const g = this.ctx, s = this.s, cell = s * 1.3, w = cell * 4 + s * 0.6, h = cell + s * 1.1;
    const x = this.ox + (s * 8 - w) / 2, y = this.oy + (s * 8 - h) / 2;
    g.fillStyle = '#0e1016';
    g.strokeStyle = '#3a3f4e';
    g.lineWidth = Math.max(1, this.dpr);
    g.fillRect(x, y, w, h);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = CHALK_2;
    g.font = `600 ${Math.round(s * 0.24)}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROMOTE TO', x + w / 2, y + s * 0.45);
    PROMOTIONS.forEach((type, i) => {
      const cx = x + s * 0.3 + i * cell, cy = y + s * 0.85;
      if (i === p.choice) { g.fillStyle = '#161922'; g.fillRect(cx, cy, cell, cell); }
      g.save();
      g.translate(cx + (cell - s) / 2, cy + (cell - s) / 2);
      this.piece(type, p.side, 0, 0);
      g.restore();
      if (i === p.choice) this.corners(cx + 2, cy + 2, cell - 4, p.color, 1);
    });
  }
}
