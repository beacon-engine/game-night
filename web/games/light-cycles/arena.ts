// The rules of Light Cycles, with no drawing: a grid, riders that leave a solid trail, crashes.
// Everyone moves on one shared clock (TICK) a whole cell at a time, so crashes are exact and fair,
// even two riders heading into the same cell at once.

export type Dir = 0 | 1 | 2 | 3; // up, right, down, left (screen directions)
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
const opposite = (d: Dir) => ((d + 2) % 4) as Dir;
const turnLeft = (d: Dir) => ((d + 3) % 4) as Dir;
const turnRight = (d: Dir) => ((d + 1) % 4) as Dir;

export const TICK = 1 / 30; // seconds per step of the clock
const SPEED = 0.5; // cells per tick: 15 a second
const BOOST_SPEED = 0.95;
const BRAKE_SPEED = 0.3;
const BOOST_TIME = 0.7; // seconds
const BOOST_COOLDOWN = 3;

export interface RiderSpec {
  id: string;
  name: string;
  color: string;
  ai: boolean;
}

export interface Rider extends RiderSpec {
  index: number; // its mark in the grid is index + 1
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  progress: number; // 0..1 of the way into the next cell (for smooth drawing)
  braking: boolean;
  boostT: number; // boost left, seconds
  boostCd: number; // until it can boost again
  turns: Dir[]; // turns asked for, taken one per cell
}

export interface StepResult {
  moved: Rider[]; // riders that entered a new cell this tick
  crashed: Rider[];
}

export const WALL = 255; // a cell the closing walls have taken

export class Arena {
  readonly cells: Uint8Array; // 0 = free, WALL, or the index + 1 of the rider whose trail it is
  ring = 0; // how many rings the walls have closed in
  readonly riders: Rider[];
  private seen: Uint8Array; // scratch for the AI's search

  constructor(readonly w: number, readonly h: number, specs: RiderSpec[]) {
    this.cells = new Uint8Array(w * h);
    this.seen = new Uint8Array(w * h);
    // spread out on an ellipse, all heading clockwise around it, so nobody starts head-on
    const n = specs.length;
    this.riders = specs.map((s, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI;
      const x = Math.round(w / 2 + Math.cos(a) * w * 0.36);
      const y = Math.round(h / 2 + Math.sin(a) * h * 0.36);
      const tx = -Math.sin(a), ty = Math.cos(a);
      const dir: Dir = Math.abs(tx) > Math.abs(ty) ? (tx > 0 ? 1 : 3) : ty > 0 ? 2 : 0;
      return { ...s, index: i, x, y, dir, alive: true, progress: 0, braking: false, boostT: 0, boostCd: 0, turns: [] };
    });
    for (const r of this.riders) this.cells[this.at(r.x, r.y)] = r.index + 1;
  }

  at(x: number, y: number) {
    return y * this.w + x;
  }

  free(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.cells[this.at(x, y)] === 0;
  }

  get alive() {
    return this.riders.filter((r) => r.alive);
  }

  // Ask to turn (taken at the next cell). Reversing into your own trail isn't a turn.
  turn(r: Rider, dir: Dir) {
    const last = r.turns.at(-1) ?? r.dir;
    if (dir === last || dir === opposite(last) || r.turns.length >= 2) return;
    r.turns.push(dir);
  }

  boost(r: Rider) {
    if (r.boostCd > 0 || !r.alive) return;
    r.boostT = BOOST_TIME;
    r.boostCd = BOOST_COOLDOWN;
  }

  step(): StepResult {
    const moving: Rider[] = [];
    for (const r of this.alive) {
      r.boostT = Math.max(0, r.boostT - TICK);
      r.boostCd = Math.max(0, r.boostCd - TICK);
      r.progress += r.boostT > 0 ? BOOST_SPEED : r.braking ? BRAKE_SPEED : SPEED;
      if (r.progress >= 1) {
        r.progress -= 1;
        if (r.ai) this.think(r);
        r.dir = r.turns.shift() ?? r.dir;
        moving.push(r);
      }
    }
    // everyone moves at once: into a wall or a trail, or two into the same cell, is a crash
    const target = new Map<number, Rider[]>();
    const crashed: Rider[] = [];
    for (const r of moving) {
      const x = r.x + DX[r.dir], y = r.y + DY[r.dir];
      if (!this.free(x, y)) { crashed.push(r); continue; }
      const k = this.at(x, y);
      target.set(k, [...(target.get(k) ?? []), r]);
    }
    for (const [k, rs] of target) {
      if (rs.length > 1) { crashed.push(...rs); continue; }
      const r = rs[0];
      r.x = k % this.w;
      r.y = Math.floor(k / this.w);
      this.cells[k] = r.index + 1;
    }
    for (const r of crashed) r.alive = false;
    return { moved: moving.filter((r) => r.alive), crashed };
  }

  // Sudden death: the walls take the outermost free ring. Riders caught in it crash.
  closeIn(): Rider[] {
    const k = this.ring++;
    if (k * 2 >= Math.min(this.w, this.h)) return [];
    for (let x = k; x < this.w - k; x++) { this.cells[this.at(x, k)] = WALL; this.cells[this.at(x, this.h - 1 - k)] = WALL; }
    for (let y = k; y < this.h - k; y++) { this.cells[this.at(k, y)] = WALL; this.cells[this.at(this.w - 1 - k, y)] = WALL; }
    const crushed = this.alive.filter((r) => Math.min(r.x, r.y, this.w - 1 - r.x, this.h - 1 - r.y) <= k);
    for (const r of crushed) r.alive = false;
    return crushed;
  }

  // A crashed rider's trail disappears, opening the board up again
  clearTrail(r: Rider) {
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === r.index + 1) this.cells[i] = 0;
  }

  // --- the computer riders --------------------------------------------------------------------
  // For each way it could go, count the open cells it could still reach from there (up to a limit):
  // the bigger the space, the better. Cells next to another rider's head are risky.
  private think(r: Rider) {
    if (r.turns.length) return;
    const options = [r.dir, turnLeft(r.dir), turnRight(r.dir)];
    let best = r.dir, bestScore = -Infinity;
    for (const d of options) {
      const x = r.x + DX[d], y = r.y + DY[d];
      if (!this.free(x, y)) continue;
      let score = this.space(x, y, 160) + (d === r.dir ? 6 : 0) + Math.random() * 4;
      for (const o of this.alive) if (o !== r && Math.abs(o.x - x) + Math.abs(o.y - y) <= 2) score -= 40;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (best !== r.dir) r.turns.push(best);
    // boost down a long open straight, now and then
    if (best === r.dir && this.run(r.x, r.y, r.dir) > 24 && Math.random() < 0.02) this.boost(r);
  }

  private space(x0: number, y0: number, cap: number) {
    this.seen.fill(0);
    const queue = [this.at(x0, y0)];
    this.seen[queue[0]] = 1;
    let n = 0;
    while (queue.length && n < cap) {
      const k = queue.shift()!;
      n++;
      const x = k % this.w, y = (k - x) / this.w;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!this.free(nx, ny)) continue;
        const nk = this.at(nx, ny);
        if (!this.seen[nk]) { this.seen[nk] = 1; queue.push(nk); }
      }
    }
    return n;
  }

  private run(x: number, y: number, d: Dir) {
    let n = 0;
    while (this.free(x + DX[d] * (n + 1), y + DY[d] * (n + 1)) && n < 60) n++;
    return n;
  }
}
