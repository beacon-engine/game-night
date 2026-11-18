// Drawing the table on a 2D canvas, cheaply enough for a small TV. Everything that never moves
// (the playfield and its walls) is painted once into a layer; a frame draws that image, then the
// lights, bumpers, flippers, plunger, ball and sparks. Glows are soft shapes, not blur filters.
// All drawing is in table units (see sim.ts); one transform scales the table to the screen.
import { EV, PHASE, type SimEvent, type State, type Table, type Vec } from './sim.ts';

interface Part { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number }
interface Pop { x: number; y: number; text: string; color: string; t: number; size: number }

const DISPLAY = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
const VOLT = '#d7ff3b', STAR = '#ff5ecf', BOLT = '#ffc23d', LEAF = '#2ee59d', BAD = '#ff4d5a', CHALK = '#f3f0e8';
const MAX_PARTS = 300;

export class View {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private dpr = 1;
  private maxDpr = 2;
  private s = 1; // device px per table unit
  private ox = 0;
  private oy = 0;
  private parts: Part[] = [];
  private pops: Pop[] = [];
  private shake = 0;
  private time = 0;
  private mid: number; // the middle of the playfield, between the flippers
  lite = false; // a struggling device: fewer sparks
  flipperColor = CHALK;

  constructor(private canvas: HTMLCanvasElement, private table: Table) {
    this.ctx = canvas.getContext('2d')!;
    this.mid = (table.flippers[0].pivot.x + table.flippers[1].pivot.x) / 2;
  }

  // Fit the table into an area of the page (CSS px)
  layout(area: { x: number; y: number; w: number; h: number }, maxDpr = this.maxDpr) {
    this.maxDpr = maxDpr;
    const d = (this.dpr = Math.min(devicePixelRatio || 1, maxDpr));
    const W = Math.round(innerWidth * d), H = Math.round(innerHeight * d);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const t = this.table;
    this.s = Math.min((area.w * d) / t.w, (area.h * d) / t.h);
    this.ox = area.x * d + (area.w * d - t.w * this.s) / 2;
    this.oy = area.y * d + (area.h * d - t.h * this.s) / 2;
    this.paintLayer();
  }

  // Where the table is on the page (CSS px)
  rect() {
    return { x: this.ox / this.dpr, y: this.oy / this.dpr, w: (this.table.w * this.s) / this.dpr, h: (this.table.h * this.s) / this.dpr };
  }

  react(e: SimEvent, st: State) {
    switch (e.kind) {
      case EV.bumper: this.sparks(e, STAR, 10); this.shake = Math.max(this.shake, 2); break;
      case EV.sling: this.sparks(e, VOLT, 6); break;
      case EV.flipperHit: if (e.value > 1200) this.sparks(e, CHALK, 4); break;
      case EV.lane: this.pop(e, '+500', VOLT); this.sparks(e, VOLT, 8); break;
      case EV.lanesComplete: this.pop(e, `${e.value}× bonus`, VOLT, 34); break;
      case EV.target: this.pop(e, '+250', BOLT); this.sparks(e, BOLT, 8); break;
      case EV.targetsComplete: this.pop({ x: e.x + 90, y: e.y }, 'Jackpot', BOLT, 40); this.sparks(e, BOLT, 30); break;
      case EV.ballSaved: this.pop({ x: this.mid, y: 840 }, 'Ball saved', LEAF, 30); break;
      case EV.tilt: this.shake = 14; break;
      case EV.tiltWarning: this.shake = 8; break;
      case EV.launch: this.sparks(st.ball, CHALK, 5); break;
    }
  }

  private sparks(at: Vec, color: string, n: number) {
    if (this.lite) n = Math.ceil(n / 3);
    for (let i = 0; i < n && this.parts.length < MAX_PARTS; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260;
      this.parts.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.3 + Math.random() * 0.3, color, size: 2 + Math.random() * 3 });
    }
  }

  private pop(at: Vec, text: string, color: string, size = 26) {
    this.pops.push({ x: at.x, y: at.y, text, color, t: 0, size });
  }

  // --- the parts that never move ------------------------------------------------------------------
  private paintLayer() {
    const t = this.table, L = this.layer;
    L.width = this.canvas.width;
    L.height = this.canvas.height;
    const g = L.getContext('2d')!;
    g.setTransform(this.s, 0, 0, this.s, this.ox, this.oy);

    // the playfield: the outline is the first run of joined-up walls (see build_table)
    const outline: Vec[] = [t.segments[0].a];
    for (const seg of t.segments) {
      const last = outline[outline.length - 1];
      if (Math.hypot(seg.a.x - last.x, seg.a.y - last.y) > 0.5) break;
      outline.push(seg.b);
    }
    g.beginPath();
    outline.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    const bg = g.createLinearGradient(0, 0, 0, t.h);
    bg.addColorStop(0, '#171b2a');
    bg.addColorStop(0.6, '#10131d');
    bg.addColorStop(1, '#0a0c12');
    g.fillStyle = bg;
    g.fill();

    // soft pools of light under the bumpers, and the middle stripe
    for (const b of t.bumpers) this.glow(g, b.pos, b.radius * 3.2, 'rgba(255,94,207,0.10)');
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(166,164,174,0.06)';
    g.lineWidth = 2;
    for (let y = 520; y < 820; y += 26) { g.beginPath(); g.moveTo(this.mid - 14, y); g.lineTo(this.mid, y + 10); g.lineTo(this.mid + 14, y); g.stroke(); }
    g.restore();

    // the walls: a coloured glow, then the rail
    const floor = t.plungerRest.y + t.ballRadius;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of [{ w: 9, c: 'rgba(76,141,255,0.16)' }, { w: 3.5, c: '#8a8fa3' }]) {
      g.strokeStyle = pass.c;
      g.lineWidth = pass.w;
      g.beginPath();
      for (const seg of t.segments) {
        if (seg.kind !== 'wall' || seg.a.y === floor && seg.b.y === floor) continue; // (the plunger is drawn instead of its floor)
        g.moveTo(seg.a.x, seg.a.y);
        g.lineTo(seg.b.x, seg.b.y);
      }
      g.stroke();
    }

    // words on the table
    g.textAlign = 'center';
    g.fillStyle = 'rgba(243,240,232,0.08)';
    g.font = `900 64px ${DISPLAY}`;
    g.fillText('PINBALL', this.mid, 560);
    g.font = `800 13px ${DISPLAY}`;
    g.fillStyle = 'rgba(243,240,232,0.35)';
    g.fillText('LIGHT ALL 3 · BONUS ×', t.lanes[1].x, t.lanes[1].y + 42);
  }

  private glow(g: CanvasRenderingContext2D, at: Vec, r: number, color: string) {
    const grad = g.createRadialGradient(at.x, at.y, 0, at.x, at.y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
    g.fill();
  }

  // --- a frame -----------------------------------------------------------------------------------------
  frame(dt: number, st: State) {
    const c = this.ctx, t = this.table;
    this.time += dt;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.shake = Math.max(0, this.shake - dt * 40);
    const sx = (Math.random() - 0.5) * this.shake * this.s, sy = (Math.random() - 0.5) * this.shake * this.s;
    c.drawImage(this.layer, sx, sy);
    c.setTransform(this.s, 0, 0, this.s, this.ox + sx, this.oy + sy);
    c.lineCap = 'round';

    // slingshots: their rubber flashes when they kick
    for (const seg of t.segments) {
      if (seg.kind === 'wall') continue;
      if (seg.kind === 'sling') {
        const glow = st.slingGlow[seg.id] ?? 0;
        c.strokeStyle = glow > 0 ? VOLT : 'rgba(215,255,59,0.55)';
        c.lineWidth = 6 + glow * 4;
        if (glow > 0) this.glow(c, mid(seg.a, seg.b), 50, `rgba(215,255,59,${0.3 * glow})`);
      } else {
        const lit = (st.targets >> seg.id) & 1;
        if (lit) this.glow(c, mid(seg.a, seg.b), 30, 'rgba(255,194,61,0.35)');
        c.strokeStyle = lit ? BOLT : '#6b5a2e';
        c.lineWidth = 9;
      }
      c.beginPath();
      c.moveTo(seg.a.x, seg.a.y);
      c.lineTo(seg.b.x, seg.b.y);
      c.stroke();
    }

    // the top lanes' lights
    t.lanes.forEach((p, i) => {
      const lit = (st.lanes >> i) & 1;
      if (lit) this.glow(c, p, 26, 'rgba(215,255,59,0.4)');
      c.fillStyle = lit ? VOLT : '#20242f';
      c.strokeStyle = lit ? VOLT : '#3a3f4e';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y + 4, 8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });

    // the multiplier lights
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 15px ${DISPLAY}`;
    for (let m = 2; m <= 5; m++) {
      const x = this.mid + (m - 3.5) * 40, y = 640, on = st.multiplier >= m;
      if (on) this.glow(c, { x, y }, 26, 'rgba(215,255,59,0.3)');
      c.fillStyle = on ? VOLT : '#1a1d27';
      c.beginPath();
      c.arc(x, y, 14, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = on ? '#0b0d06' : '#4a4e5c';
      c.fillText(`${m}×`, x, y + 1);
    }

    // the bumpers
    t.bumpers.forEach((b, i) => {
      const glow = st.bumperGlow[i] ?? 0;
      if (glow > 0) this.glow(c, b.pos, b.radius + 26 * glow, `rgba(255,94,207,${0.55 * glow})`);
      c.fillStyle = '#2a1030';
      c.beginPath();
      c.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = STAR;
      c.lineWidth = 5;
      c.stroke();
      c.fillStyle = glow > 0.05 ? '#ffd1f2' : 'rgba(255,94,207,0.45)';
      c.beginPath();
      c.arc(b.pos.x, b.pos.y, b.radius * (0.5 + 0.1 * glow), 0, Math.PI * 2);
      c.fill();
    });

    // ball save: lit under the flippers while it lasts (blinking near the end)
    if (st.ballSave > 0 && (st.ballSave > 2 || Math.floor(this.time * 6) % 2 === 0)) {
      c.font = `900 18px ${DISPLAY}`;
      c.fillStyle = LEAF;
      c.fillText('SAVE', this.mid, 960);
    }

    this.drawPlunger(st);
    for (let i = 0; i < t.flippers.length; i++) this.drawFlipper(i, st.flipperAngle[i], st.tilted);
    if (st.phase !== PHASE.drained) this.drawBall(st.ball);
    this.drawEffects(dt);

    if (st.tilted || st.tiltMeter > 2) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.strokeStyle = BAD;
      c.globalAlpha = st.tilted ? 0.9 : 0.4 + 0.4 * Math.abs(Math.sin(this.time * 10));
      c.lineWidth = 6 * this.dpr;
      const r = this.rect(), d = this.dpr;
      c.strokeRect(r.x * d, r.y * d, r.w * d, r.h * d);
      c.globalAlpha = 1;
      if (st.tilted) {
        c.setTransform(this.s, 0, 0, this.s, this.ox, this.oy);
        c.font = `900 110px ${DISPLAY}`;
        c.fillStyle = BAD;
        c.fillText('TILT', this.mid, 500);
      }
    }
  }

  private drawFlipper(i: number, angle: number, dead: boolean) {
    const c = this.ctx, f = this.table.flippers[i];
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const tip = { x: f.pivot.x + dx * f.length, y: f.pivot.y + dy * f.length };
    c.beginPath();
    c.arc(f.pivot.x, f.pivot.y, f.baseRadius, angle + Math.PI / 2, angle + (Math.PI * 3) / 2);
    c.arc(tip.x, tip.y, f.tipRadius, angle - Math.PI / 2, angle + Math.PI / 2);
    c.closePath();
    c.fillStyle = dead ? '#3a3f4e' : CHALK;
    c.fill();
    c.strokeStyle = dead ? '#3a3f4e' : this.flipperColor;
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#20242f';
    c.beginPath();
    c.arc(f.pivot.x, f.pivot.y, 3, 0, Math.PI * 2);
    c.fill();
  }

  private drawPlunger(st: State) {
    const c = this.ctx, t = this.table, r = t.ballRadius;
    const top = t.plungerRest.y + r + st.plunger * t.plungerTravel;
    c.fillStyle = '#3a3f4e';
    c.fillRect(t.plungerRest.x - 3, top, 6, t.h - top);
    c.fillStyle = st.plunger > 0 ? BOLT : '#8a8fa3';
    c.fillRect(t.plungerRest.x - 13, top, 26, 7);
  }

  private drawBall(p: Vec) {
    const c = this.ctx, r = this.table.ballRadius;
    const g = c.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#c9ccd6');
    g.addColorStop(1, '#5b5f6c');
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.arc(p.x + 3, p.y + 4, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = g;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fill();
  }

  private drawEffects(dt: number) {
    const c = this.ctx;
    this.parts = this.parts.filter((p) => (p.t += dt) < p.life);
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    this.pops = this.pops.filter((p) => (p.t += dt) < 1.1);
    for (const p of this.pops) {
      c.globalAlpha = Math.min(1, 3 * (1.1 - p.t));
      c.font = `900 ${p.size}px ${DISPLAY}`;
      c.fillStyle = p.color;
      c.fillText(p.text.toUpperCase(), p.x, p.y - 40 * p.t);
    }
    c.globalAlpha = 1;
  }
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
