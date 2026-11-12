// Drawing Bricks on a 2D canvas, cheaply enough for a small TV. Each field's bricks are painted once
// into their own layer and only repainted when a brick changes, so a frame draws one image, the
// paddles, the balls and the sparks. Glows are soft shapes drawn underneath (no blur filters: slow on TVs).
import { BALL_R, BRICK_H, COLS, HEIGHT, PADDLE_H, PADDLE_Y, POWERS, ROWS, TOP, type Brick, type Field, type FieldEvent, type Paddle } from './sim.ts';

interface Part { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number; fall: number }
interface Pop { x: number; y: number; text: string; color: string; t: number; size: number }
interface Ring { x: number; y: number; t: number; life: number; color: string; r: number }

// One field on screen: where it is, its brick layer and its effects (all in field units)
interface Tile {
  field: Field;
  x: number;
  y: number;
  s: number; // device px per field unit
  layer: HTMLCanvasElement;
  version: number;
  shake: number;
  parts: Part[];
  pops: Pop[];
  rings: Ring[];
  flashes: { b: Brick; t: number }[];
  lost: number; // the red glow along the bottom when a ball falls
  glow: number; // the white wash when the wall is cleared
}

export interface TileInfo { wins: number; target: number; tag: string; banner?: string }

const DISPLAY = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
const UI = 'Inter, system-ui, sans-serif';
const MAX_PARTS = 500;

export class View {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private maxDpr = 2;
  tiles: Tile[] = [];
  info = new Map<Field, TileInfo>(); // versus: what goes over each field
  header = false; // versus: a header over each field
  lite = false; // a struggling device: fewer sparks

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  // Fit the fields in an area of the page (CSS px): one field big, or several in the best grid
  layout(fields: Field[], area: { x: number; y: number; w: number; h: number }, maxDpr = this.maxDpr) {
    this.maxDpr = maxDpr;
    this.dpr = Math.min(devicePixelRatio || 1, maxDpr);
    const d = this.dpr;
    const W = Math.round(innerWidth * d), H = Math.round(innerHeight * d);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const old = new Map(this.tiles.map((t) => [t.field, t]));
    this.tiles = [];
    if (!fields.length) return;
    const n = fields.length, gap = 18 * d, head = this.header ? 46 * d : 0;
    const ax = area.x * d, ay = area.y * d, aw = area.w * d, ah = area.h * d;
    const fw = fields[0].w, fh = HEIGHT;
    let best = { s: 0, cols: 1, rows: 1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const s = Math.min((aw - gap * (cols - 1)) / cols / fw, (ah - gap * (rows - 1) - head * rows) / rows / fh);
      if (s > best.s) best = { s, cols, rows };
    }
    const { s, cols, rows } = best;
    const tw = fw * s, th = fh * s + head;
    const ox = ax + (aw - (tw * cols + gap * (cols - 1))) / 2, oy = ay + (ah - (th * rows + gap * (rows - 1))) / 2;
    fields.forEach((field, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols; // (centre a short last row)
      const rowX = ox + ((cols - inRow) * (tw + gap)) / 2;
      const prev = old.get(field);
      const layer = prev?.layer ?? document.createElement('canvas');
      layer.width = Math.ceil(field.w * s);
      layer.height = Math.ceil((TOP + ROWS * BRICK_H) * s);
      this.tiles.push({
        field, x: Math.round(rowX + c * (tw + gap)), y: Math.round(oy + r * (th + gap) + head), s, layer, version: -1,
        shake: 0, parts: prev?.parts ?? [], pops: prev?.pops ?? [], rings: prev?.rings ?? [], flashes: [], lost: 0, glow: 0,
      });
    });
  }

  // A field's tile and its screen rectangle (CSS px), for the HUD
  rect(field: Field) {
    const t = this.tiles.find((q) => q.field === field);
    if (!t) return null;
    const d = this.dpr;
    return { x: t.x / d, y: t.y / d, w: (field.w * t.s) / d, h: (HEIGHT * t.s) / d };
  }

  // Something happened: sparks, shakes, words
  react(field: Field, e: FieldEvent) {
    const t = this.tiles.find((q) => q.field === field);
    if (!t) return;
    const lite = this.lite;
    switch (e.type) {
      case 'hit':
        t.flashes.push({ b: e.brick, t: 0.12 });
        this.burst(t, e.brick.x + e.brick.w / 2, e.brick.y + e.brick.h / 2, '#f3f0e8', lite ? 2 : 4, 160, 2.5);
        break;
      case 'steel':
        t.flashes.push({ b: e.brick, t: 0.1 });
        this.burst(t, e.brick.x + e.brick.w / 2, e.brick.y + e.brick.h, '#cfd6e4', lite ? 2 : 5, 220, 2);
        t.shake = Math.max(t.shake, 1.5);
        break;
      case 'break': {
        const b = e.brick;
        this.shards(t, b, lite ? 6 : 12);
        if (e.points >= 150 || e.combo >= 5) t.pops.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, text: `+${e.points}`, color: '#f3f0e8', t: 0.8, size: 22 });
        if (b.max >= 3) t.shake = Math.max(t.shake, 3);
        break;
      }
      case 'boom': {
        const b = e.brick, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        t.rings.push({ x: cx, y: cy, t: 0, life: 0.45, color: '#ffc23d', r: b.w * 1.7 });
        t.rings.push({ x: cx, y: cy, t: 0, life: 0.3, color: '#ff5a36', r: b.w });
        this.burst(t, cx, cy, '#ffc23d', lite ? 10 : 26, 520, 4);
        this.burst(t, cx, cy, '#ff5a36', lite ? 6 : 14, 380, 5);
        t.shake = Math.max(t.shake, 9);
        break;
      }
      case 'paddle':
        this.burst(t, e.x, PADDLE_Y, e.paddle.spec.color, lite ? 3 : 7, 260, 2.5, -1);
        t.rings.push({ x: e.x, y: PADDLE_Y, t: 0, life: 0.22, color: e.paddle.spec.color, r: 26 });
        break;
      case 'wall':
        if (!lite) this.burst(t, e.x, e.y, '#6a6875', 3, 120, 2);
        break;
      case 'launch':
        t.rings.push({ x: e.paddle.x, y: PADDLE_Y, t: 0, life: 0.3, color: '#f3f0e8', r: 34 });
        break;
      case 'pickup': {
        const info = POWERS[e.power];
        t.pops.push({ x: e.x, y: PADDLE_Y - 34, text: info.name, color: info.color, t: 1.1, size: 30 });
        t.rings.push({ x: e.paddle.x, y: PADDLE_Y + PADDLE_H / 2, t: 0, life: 0.45, color: info.color, r: e.paddle.w * 0.8 });
        this.burst(t, e.x, PADDLE_Y, info.color, lite ? 6 : 16, 300, 3, -1);
        break;
      }
      case 'combo':
        t.pops.push({ x: e.x, y: e.y + 30, text: `Combo ×${e.mult}`, color: '#d7ff3b', t: 1.2, size: 34 + Math.min(4, e.mult) * 4 });
        t.shake = Math.max(t.shake, 2 + e.mult);
        break;
      case 'lost':
        t.lost = 1;
        t.shake = Math.max(t.shake, 6);
        this.burst(t, e.x, HEIGHT - 4, '#ff4d5a', lite ? 6 : 14, 300, 3, -1);
        break;
      case 'life':
        t.shake = Math.max(t.shake, 12);
        break;
      case 'clear':
        t.glow = 1;
        for (let i = 0; i < (lite ? 30 : 80); i++) {
          const x = Math.random() * field.w;
          t.parts.push({ x, y: HEIGHT, vx: (Math.random() - 0.5) * 200, vy: -500 - Math.random() * 700, t: 1.6, life: 1.6, color: ['#d7ff3b', '#4c8dff', '#ff5ecf', '#ffc23d', '#2ee59d'][i % 5], size: 5, fall: 700 });
        }
        break;
      case 'junk':
        t.shake = Math.max(t.shake, 8);
        t.pops.push({ x: field.w / 2, y: TOP + 40, text: 'Junk!', color: '#ff8a3d', t: 1.2, size: 44 });
        break;
      case 'shrunk':
        t.pops.push({ x: field.w / 2, y: PADDLE_Y - 70, text: 'Shrunk!', color: '#a97bff', t: 1.2, size: 44 });
        break;
      case 'sent':
        t.pops.push({ x: e.paddle.x, y: PADDLE_Y - 50, text: e.power === 'junk' ? 'Junk sent' : 'Shrink sent', color: POWERS[e.power].color, t: 1, size: 28 });
        break;
    }
    if (t.parts.length > MAX_PARTS) t.parts.splice(0, t.parts.length - MAX_PARTS);
  }

  private burst(t: Tile, x: number, y: number, color: string, n: number, speed: number, size: number, up = 0) {
    for (let i = 0; i < n; i++) {
      const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      t.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.35 + Math.random() * 0.35, life: 0.7, color, size, fall: 300 });
    }
  }

  // A brick breaking: pieces of it fly off and fall
  private shards(t: Tile, b: Brick, n: number) {
    const color = b.kind === 'charge' ? '#ff5a36' : b.color;
    for (let i = 0; i < n; i++) {
      const x = b.x + Math.random() * b.w, y = b.y + Math.random() * b.h;
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260;
      t.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0.6 + Math.random() * 0.5, life: 1.1, color, size: 4 + Math.random() * 5, fall: 1100 });
    }
  }

  // --- each frame --------------------------------------------------------------------------------------
  frame(dt: number) {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const t of this.tiles) this.drawTile(g, t, dt);
  }

  private drawTile(g: CanvasRenderingContext2D, t: Tile, dt: number) {
    const f = t.field, s = t.s, W = f.w * s, H = HEIGHT * s;
    if (t.version !== f.version) this.paintBricks(t);
    t.shake = Math.max(0, t.shake - dt * 30);
    const sx = t.shake ? (Math.random() - 0.5) * 2 * t.shake * s : 0, sy = t.shake ? (Math.random() - 0.5) * 2 * t.shake * s : 0;

    if (this.header) this.drawHeader(g, t);
    g.save();
    g.translate(Math.round(t.x + sx), Math.round(t.y + sy));
    // the board: dark, a little lighter at the top, a hairline frame
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#141826');
    bg.addColorStop(1, '#090a0f');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(243,240,232,0.035)';
    for (let c = 1; c < COLS; c++) g.fillRect(Math.round(c * f.bw * s), 0, 1, H);
    g.strokeStyle = '#3a3f4e';
    g.lineWidth = Math.max(2, 3 * s);
    g.strokeRect(-g.lineWidth / 2, -g.lineWidth / 2, W + g.lineWidth, H + g.lineWidth);
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    // the floor: a faint red below the paddles (it's where balls are lost), brighter when one is
    t.lost = Math.max(0, t.lost - dt * 1.8);
    const fl = g.createLinearGradient(0, (PADDLE_Y + PADDLE_H) * s, 0, H);
    fl.addColorStop(0, 'rgba(255,77,90,0)');
    fl.addColorStop(1, `rgba(255,77,90,${0.12 + t.lost * 0.5})`);
    g.fillStyle = fl;
    g.fillRect(0, (PADDLE_Y + PADDLE_H) * s, W, H);

    g.drawImage(t.layer, 0, 0);
    // charges glow, gently
    const pulse = 0.25 + 0.2 * Math.sin(performance.now() / 160);
    g.fillStyle = `rgba(255,120,60,${pulse})`;
    for (const b of f.bricks) if (b.alive && b.kind === 'charge') g.fillRect(b.x * s - 2 * s, b.y * s - 2 * s, (b.w + 4) * s, (b.h + 4) * s);
    // bricks just hit: a white flash
    for (const fx of t.flashes) {
      fx.t -= dt;
      if (!fx.b.alive) continue;
      g.fillStyle = `rgba(255,255,255,${Math.max(0, fx.t / 0.12) * 0.7})`;
      g.fillRect(fx.b.x * s + 2, fx.b.y * s + 2, fx.b.w * s - 4, fx.b.h * s - 4);
    }
    t.flashes = t.flashes.filter((x) => x.t > 0);

    this.drawCapsules(g, f, s);
    // laser shots
    g.fillStyle = '#ff8a9a';
    for (const sh of f.shots) g.fillRect((sh.x - 2) * s, sh.y * s, 4 * s, 22 * s);
    g.fillStyle = '#fff';
    for (const sh of f.shots) g.fillRect((sh.x - 1) * s, sh.y * s, 2 * s, 12 * s);
    for (const p of f.paddles) this.drawPaddle(g, p, s, f);
    this.drawBalls(g, f, s);
    this.drawEffects(g, t, dt);
    // the wall cleared: a white wash that fades
    if (t.glow > 0) {
      t.glow = Math.max(0, t.glow - dt * 1.2);
      g.fillStyle = `rgba(243,240,232,${t.glow * 0.35})`;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
    // versus: out of balls, or finished
    const banner = this.info.get(f)?.banner;
    if (banner) {
      g.fillStyle = 'rgba(7,8,11,0.6)';
      g.fillRect(0, 0, W, H);
      g.font = `900 ${Math.round(110 * s)}px ${DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = banner === 'Out' ? '#ff4d5a' : '#d7ff3b';
      g.fillText(banner.toUpperCase(), W / 2, H * 0.7); // (below the round's callout)
    }
    g.restore();
  }

  // --- bricks ------------------------------------------------------------------------------------------
  private paintBricks(t: Tile) {
    t.version = t.field.version;
    const g = t.layer.getContext('2d')!, s = t.s;
    g.clearRect(0, 0, t.layer.width, t.layer.height);
    for (const b of t.field.bricks) if (b.alive) drawBrick(g, b, s);
  }

  private drawCapsules(g: CanvasRenderingContext2D, f: Field, s: number) {
    const w = 46 * s, h = 20 * s;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(17 * s)}px ${DISPLAY}`;
    for (const c of f.capsules) {
      const info = POWERS[c.power], x = c.x * s - w / 2, y = c.y * s - h / 2;
      g.globalAlpha = 0.25;
      g.fillStyle = info.color;
      roundRect(g, x - 4 * s, y - 4 * s, w + 8 * s, h + 8 * s, h / 2 + 4 * s);
      g.fill();
      g.globalAlpha = 1;
      roundRect(g, x, y, w, h, h / 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillRect(x + h / 2, y + 3 * s, w - h, 3 * s);
      g.fillStyle = '#07080b';
      g.fillText(info.letter, c.x * s, c.y * s + 1 * s);
    }
  }

  private drawPaddle(g: CanvasRenderingContext2D, p: Paddle, s: number, f: Field) {
    const x = (p.x - p.w / 2) * s, y = PADDLE_Y * s, w = p.w * s, h = PADDLE_H * s;
    const ending = (t: number) => t > 0 && t < 2 && Math.floor(t * 6) % 2 === 0; // (blinks when it's about to run out)
    // a soft glow under it
    g.globalAlpha = 0.2;
    g.fillStyle = p.spec.color;
    roundRect(g, x - 6 * s, y - 5 * s, w + 12 * s, h + 10 * s, h);
    g.fill();
    g.globalAlpha = 1;
    // laser cannons on the ends
    if (p.laserT > 0 && !ending(p.laserT)) {
      g.fillStyle = '#3a3f4e';
      for (const side of [-1, 1]) g.fillRect((p.x + side * (p.w / 2 - 9) - 4) * s, y - 9 * s, 8 * s, 10 * s);
      g.fillStyle = '#ff4d5a';
      for (const side of [-1, 1]) g.fillRect((p.x + side * (p.w / 2 - 9) - 4) * s, y - 11 * s, 8 * s, 3 * s);
    }
    g.fillStyle = p.shrinkT > 0 && !ending(p.shrinkT) ? '#a97bff' : p.spec.color;
    roundRect(g, x, y, w, h, h / 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x + h / 2, y + 2 * s, w - h, 3 * s);
    g.fillStyle = 'rgba(7,8,11,0.35)';
    g.fillRect(x + h / 2, y + h - 4 * s, w - h, 2 * s);
    // the ends, a shade darker: they send the ball out wide
    g.fillStyle = 'rgba(7,8,11,0.25)';
    g.fillRect(x + 3 * s, y + 3 * s, 10 * s, h - 6 * s);
    g.fillRect(x + w - 13 * s, y + 3 * s, 10 * s, h - 6 * s);
    // catch: a sticky strip along the top
    if (p.catchT > 0 && !ending(p.catchT)) {
      g.fillStyle = '#ffc23d';
      g.fillRect(x + 6 * s, y - 3 * s, w - 12 * s, 4 * s);
    }
    // who it is (co-op: there can be four)
    if (f.paddles.length > 1 || !this.header) {
      g.font = `800 ${Math.max(11, Math.round(17 * s))}px ${DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillStyle = p.spec.color;
      g.fillText((p.spec.tag ?? p.spec.name).toUpperCase(), p.x * s, y + h + 7 * s);
    }
  }

  private drawBalls(g: CanvasRenderingContext2D, f: Field, s: number) {
    const r = BALL_R * s;
    for (const b of f.balls) {
      const color = b.owner?.spec.color ?? '#f3f0e8';
      // the trail
      const n = b.trail.length / 2;
      g.fillStyle = color;
      for (let i = 1; i < n; i++) {
        g.globalAlpha = 0.32 * (1 - i / n);
        const tr = r * (1 - (i / n) * 0.6);
        g.beginPath();
        g.arc(b.trail[i * 2] * s, b.trail[i * 2 + 1] * s, tr, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 0.22;
      g.beginPath();
      g.arc(b.x * s, b.y * s, r * 2.3, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(b.x * s, b.y * s, r, 0, Math.PI * 2);
      g.fill();
    }
    // held balls: a little arrow for where it will go
    for (const b of f.balls) {
      if (!b.stuck) continue;
      const p = b.stuck, u = Math.max(-1, Math.min(1, b.stuckX / (p.w / 2 + BALL_R)));
      const a = (Math.abs(u) < 0.15 ? 0.15 * (Math.sign(u) || 1) : u) * 62 * (Math.PI / 180);
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 140);
      g.strokeStyle = `rgba(243,240,232,${0.35 + blink * 0.4})`;
      g.lineWidth = 3 * s;
      g.setLineDash([6 * s, 8 * s]);
      g.beginPath();
      g.moveTo(b.x * s, b.y * s);
      g.lineTo((b.x + Math.sin(a) * 90) * s, (b.y - Math.cos(a) * 90) * s);
      g.stroke();
      g.setLineDash([]);
    }
  }

  private drawEffects(g: CanvasRenderingContext2D, t: Tile, dt: number) {
    const s = t.s;
    for (const p of t.parts) {
      p.t -= dt;
      p.vy += p.fall * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.globalAlpha = Math.max(0, Math.min(1, p.t / (p.life * 0.5)));
      g.fillStyle = p.color;
      g.fillRect((p.x - p.size / 2) * s, (p.y - p.size / 2) * s, p.size * s, p.size * s);
    }
    t.parts = t.parts.filter((p) => p.t > 0);
    for (const r of t.rings) {
      r.t += dt;
      const k = r.t / r.life;
      g.globalAlpha = Math.max(0, 1 - k);
      g.strokeStyle = r.color;
      g.lineWidth = Math.max(1, 6 * s * (1 - k));
      g.beginPath();
      g.arc(r.x * s, r.y * s, r.r * s * (0.3 + k), 0, Math.PI * 2);
      g.stroke();
    }
    t.rings = t.rings.filter((r) => r.t < r.life);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of t.pops) {
      p.t -= dt;
      p.y -= 50 * dt;
      g.globalAlpha = Math.max(0, Math.min(1, p.t * 3));
      g.font = `900 ${Math.round(p.size * s)}px ${DISPLAY}`;
      g.fillStyle = 'rgba(7,8,11,0.7)';
      g.fillText(p.text.toUpperCase(), p.x * s + 2 * s, p.y * s + 3 * s);
      g.fillStyle = p.color;
      g.fillText(p.text.toUpperCase(), p.x * s, p.y * s);
    }
    t.pops = t.pops.filter((p) => p.t > 0);
    g.globalAlpha = 1;
  }

  // Versus: over each field, who it is, their round wins, balls left, what they hold, and how much
  // of their wall is gone
  private drawHeader(g: CanvasRenderingContext2D, t: Tile) {
    const f = t.field, p = f.paddles[0], d = this.dpr, W = f.w * t.s;
    const info = this.info.get(f);
    const x = t.x, y = t.y - 42 * d, h = 30 * d;
    g.font = `800 ${Math.round(13 * d)}px ${UI}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const tag = info?.tag ?? 'CPU';
    const tw = g.measureText(tag).width + 16 * d;
    g.fillStyle = '#0e1016';
    g.fillRect(x, y, W, h);
    g.fillStyle = p.spec.color;
    g.fillRect(x, y, tw, h);
    g.fillStyle = '#07080b';
    g.fillText(tag, x + 8 * d, y + h / 2);
    g.font = `800 ${Math.round(19 * d)}px ${DISPLAY}`;
    g.fillStyle = '#f3f0e8';
    g.fillText(p.spec.name.toUpperCase(), x + tw + 10 * d, y + h / 2 + 1 * d);
    // round wins
    let rx = x + W - 10 * d;
    if (info) {
      for (let i = info.target - 1; i >= 0; i--) {
        g.beginPath();
        g.arc(rx - 6 * d, y + h / 2, 6 * d, 0, Math.PI * 2);
        g.lineWidth = 2 * d;
        g.strokeStyle = p.spec.color;
        if (i < info.wins) { g.fillStyle = p.spec.color; g.fill(); }
        g.stroke();
        rx -= 18 * d;
      }
    }
    // balls left
    rx -= 10 * d;
    g.fillStyle = '#f3f0e8';
    for (let i = 0; i < Math.min(6, f.lives); i++) {
      g.beginPath();
      g.arc(rx - 5 * d, y + h / 2, 4.5 * d, 0, Math.PI * 2);
      g.fill();
      rx -= 13 * d;
    }
    // an attack ready to send
    if (p.stored) {
      const info2 = POWERS[p.stored], cw = 40 * d, ch = 18 * d;
      rx -= cw + 8 * d;
      g.fillStyle = info2.color;
      roundRect(g, rx, y + (h - ch) / 2, cw, ch, ch / 2);
      g.fill();
      g.fillStyle = '#07080b';
      g.textAlign = 'center';
      g.font = `900 ${Math.round(14 * d)}px ${DISPLAY}`;
      g.fillText(info2.letter, rx + cw / 2, y + h / 2 + 1 * d);
    }
    // the wall: how much is broken
    const done = 1 - f.left / Math.max(1, f.total);
    g.fillStyle = '#20242f';
    g.fillRect(x, y + h + 2 * d, W, 4 * d);
    g.fillStyle = p.spec.color;
    g.fillRect(x, y + h + 2 * d, W * done, 4 * d);
  }
}

// A brick: its colour, a light top edge and a dark bottom one; tough bricks have a heavy rim and a
// pip per hit left; steel is grey with rivets; a charge is red with a black core
function drawBrick(g: CanvasRenderingContext2D, b: Brick, s: number) {
  const pad = Math.max(1, 2 * s);
  const x = b.x * s + pad, y = b.y * s + pad, w = b.w * s - pad * 2, h = b.h * s - pad * 2, r = Math.min(h * 0.3, 5 * s);
  const base = b.kind === 'steel' ? '#8b93a5' : b.kind === 'charge' ? '#e8452c' : b.color;
  g.fillStyle = base;
  roundRect(g, x, y, w, h, r);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.fillRect(x + r, y + 2 * s, w - 2 * r, h * 0.22);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(x + r, y + h - h * 0.22, w - 2 * r, h * 0.22 - 1 * s);
  const cx = x + w / 2, cy = y + h / 2;
  switch (b.kind) {
    case 'tough': {
      g.strokeStyle = 'rgba(7,8,11,0.45)';
      g.lineWidth = 3 * s;
      roundRect(g, x + 1.5 * s, y + 1.5 * s, w - 3 * s, h - 3 * s, r);
      g.stroke();
      // a pip per hit left
      const n = b.hp, pw = 6 * s, gap = 5 * s, total = n * pw + (n - 1) * gap;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) g.fillRect(cx - total / 2 + i * (pw + gap), cy - pw / 2, pw, pw);
      // cracks once it's been hit
      if (b.hp < b.max) {
        g.strokeStyle = 'rgba(7,8,11,0.6)';
        g.lineWidth = 1.5 * s;
        g.beginPath();
        const k = (b.col * 7 + b.row * 3) % 5;
        g.moveTo(x + w * (0.12 + k * 0.03), y);
        g.lineTo(x + w * 0.22, cy);
        g.lineTo(x + w * 0.16, y + h);
        if (b.max - b.hp > 1) { g.moveTo(x + w * 0.85, y); g.lineTo(x + w * 0.76, cy + 2 * s); g.lineTo(x + w * 0.88, y + h); }
        g.stroke();
      }
      break;
    }
    case 'steel': {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(x + w * 0.3, y);
      g.lineTo(x + w * 0.42, y);
      g.lineTo(x + w * 0.3, y + h);
      g.lineTo(x + w * 0.18, y + h);
      g.fill();
      g.fillStyle = '#4a5161';
      for (const rx of [x + 7 * s, x + w - 7 * s]) { g.beginPath(); g.arc(rx, cy, 2.6 * s, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'charge': {
      g.fillStyle = '#1a0d0a';
      g.beginPath();
      g.arc(cx, cy, h * 0.32, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffc23d';
      g.lineWidth = 2 * s;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        g.moveTo(cx + Math.cos(a) * h * 0.14, cy + Math.sin(a) * h * 0.14);
        g.lineTo(cx - Math.cos(a) * h * 0.14, cy - Math.sin(a) * h * 0.14);
      }
      g.stroke();
      break;
    }
    case 'plain':
      if (b.drop) {
        // holds a power-up: a small white diamond
        const d = h * 0.24;
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath();
        g.moveTo(cx, cy - d);
        g.lineTo(cx + d, cy);
        g.lineTo(cx, cy + d);
        g.lineTo(cx - d, cy);
        g.fill();
      }
      break;
  }
}

// (roundRect by hand: older TV browsers don't have it)
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}
