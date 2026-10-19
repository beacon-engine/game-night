// Drawing Neon Trails on a 2D canvas, cheaply enough for a small TV: trails are painted once into
// their own layer as each cell fills, so a frame only redraws the bikes' heads and the sparks.
// The glow is a soft square painted under each trail cell, not a blur filter (those are slow on TVs).
import { DX, DY, WALL, type Arena, type Rider } from './arena.ts';

interface Spark { x: number; y: number; vx: number; vy: number; t: number; color: string }

export class View {
  private ctx: CanvasRenderingContext2D;
  private trails = document.createElement('canvas');
  private tctx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
  private cell = 8; // px per cell (device pixels)
  private ox = 0; // where the arena starts on the canvas
  private oy = 0;
  private dpr = 1;
  glow = true; // off when the device is struggling

  constructor(private canvas: HTMLCanvasElement, private top = 92) {
    this.ctx = canvas.getContext('2d')!;
    this.tctx = this.trails.getContext('2d')!;
  }

  // Fit the arena on screen (call on resize and for each new arena)
  layout(arena: Arena, maxDpr = 2) {
    this.dpr = Math.min(devicePixelRatio || 1, maxDpr);
    const W = Math.round(innerWidth * this.dpr), H = Math.round(innerHeight * this.dpr);
    this.canvas.width = W;
    this.canvas.height = H;
    const margin = 24 * this.dpr, top = this.top * this.dpr;
    this.cell = Math.max(2, Math.floor(Math.min((W - margin * 2) / arena.w, (H - top - margin) / arena.h)));
    this.ox = Math.round((W - arena.w * this.cell) / 2);
    this.oy = Math.round(top + (H - top - margin - arena.h * this.cell) / 2);
    this.trails.width = arena.w * this.cell;
    this.trails.height = arena.h * this.cell;
    this.redrawTrails(arena);
  }

  // Paint the cells a rider just entered
  paint(r: Rider) {
    const c = this.cell, g = this.tctx;
    if (this.glow) {
      g.globalAlpha = 0.16;
      g.fillStyle = r.color;
      g.fillRect(r.x * c - c, r.y * c - c, c * 3, c * 3);
      g.globalAlpha = 1;
    }
    g.fillStyle = r.color;
    g.fillRect(r.x * c + 1, r.y * c + 1, c - 2, c - 2);
  }

  // The walls closing in: one ring of solid cells
  paintWalls(arena: Arena) {
    const c = this.cell, g = this.tctx;
    g.fillStyle = '#20242f';
    for (let i = 0; i < arena.cells.length; i++) {
      if (arena.cells[i] === WALL) g.fillRect((i % arena.w) * c, Math.floor(i / arena.w) * c, c, c);
    }
  }

  // From scratch, from the grid (after a trail is cleared)
  redrawTrails(arena: Arena) {
    this.tctx.clearRect(0, 0, this.trails.width, this.trails.height);
    this.paintWalls(arena);
    for (const r of arena.riders) {
      const mark = r.index + 1;
      for (let i = 0; i < arena.cells.length; i++) {
        if (arena.cells[i] !== mark) continue;
        this.paint({ ...r, x: i % arena.w, y: Math.floor(i / arena.w) });
      }
    }
  }

  crash(r: Rider) {
    const c = this.cell;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 6) * c;
      this.sparks.push({ x: (r.x + 0.5) * c, y: (r.y + 0.5) * c, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0.5 + Math.random() * 0.5, color: r.color });
    }
  }

  frame(arena: Arena, dt: number, tickFraction: number) {
    const g = this.ctx, c = this.cell;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // the board: a hairline frame and a faint dot grid every 4 cells
    g.fillStyle = '#0e1016';
    g.fillRect(this.ox, this.oy, arena.w * c, arena.h * c);
    g.fillStyle = 'rgba(243,240,232,0.06)';
    for (let y = 0; y <= arena.h; y += 4) for (let x = 0; x <= arena.w; x += 4) g.fillRect(this.ox + x * c - 1, this.oy + y * c - 1, 2, 2);
    g.strokeStyle = '#3a3f4e';
    g.lineWidth = Math.max(1, this.dpr);
    g.strokeRect(this.ox - 0.5, this.oy - 0.5, arena.w * c + 1, arena.h * c + 1);

    g.drawImage(this.trails, this.ox, this.oy);

    // heads, slid smoothly toward the next cell
    for (const r of arena.alive) {
      const p = Math.min(1, r.progress + tickFraction * 0.5);
      const hx = this.ox + (r.x + DX[r.dir] * p) * c, hy = this.oy + (r.y + DY[r.dir] * p) * c;
      if (this.glow) {
        g.globalAlpha = 0.28;
        g.fillStyle = r.color;
        g.fillRect(hx - c * 1.5, hy - c * 1.5, c * 4, c * 4);
        g.globalAlpha = 1;
      }
      g.fillStyle = r.boostT > 0 ? '#d7ff3b' : '#f3f0e8';
      g.fillRect(hx - 1, hy - 1, c + 2, c + 2);
    }

    // sparks
    for (const s of this.sparks) {
      s.t -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.92;
      s.vy *= 0.92;
      g.globalAlpha = Math.max(0, s.t);
      g.fillStyle = s.color;
      g.fillRect(this.ox + s.x, this.oy + s.y, c * 0.7, c * 0.7);
    }
    g.globalAlpha = 1;
    this.sparks = this.sparks.filter((s) => s.t > 0);
  }
}
