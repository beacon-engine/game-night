// The city a race is run through, made up from a seed (cities.json): a grid of avenues and streets, a few
// streets closed off (their blocks joined), alleys cut through some blocks (shortcuts), a river across it
// with a handful of bridges, a park. No graphics, and no rules: the driving (drive.ts) and the 3D city
// (scene.ts) both work from these numbers.
//
// Everything is in metres on the ground: x east, z south. A street is the stretch between two junctions
// (nodes); everything that isn't street or junction is solid: the blocks (pavement and buildings: the kerb
// is the wall) and the river (but for the bridges).

export interface CitySpec {
  id: string;
  name: string;
  about: string;
  start: string; // where the race starts, and where it goes
  to: string;
  time: 'day' | 'dusk' | 'night';
  seed: number;
  cols: number; // blocks across and down
  rows: number;
  landmark: 'harbour' | 'airport' | 'tower'; // what's at the finish
}

export interface Node { id: number; x: number; z: number; edges: Edge[]; size: number; lights: boolean; phase: number }
export interface Edge { id: number; a: Node; b: Node; width: number; axis: 'x' | 'z'; kind: 'avenue' | 'street' | 'alley' | 'bridge'; length: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Lot extends Rect { park: boolean } // a block: what's on it is the scene's to draw

export const AVENUE = 18, STREET = 13, ALLEY = 8; // m wide, kerb to kerb
export const PAVE = 4; // m of pavement round a block
export const CYCLE = 22, GREEN = 9, AMBER = 2; // s: the lights at a junction: green one way, then the other

export class City {
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];
  readonly lots: Lot[] = []; // the blocks (solid)
  readonly solids: Rect[] = []; // everything you can't drive through: the blocks, closed streets, the river, the edge of the city
  readonly river: Rect | null = null; // the water, right across the city
  readonly start: { x: number; z: number; h: number }; // the grid's front, and which way it faces (radians: 0 is east)
  readonly finish: Node;
  readonly bounds: Rect;
  private toFinish = new Map<Node, number>(); // m from each junction to the finish, the shortest way
  private rnd: () => number;
  private nextEdge = 0;

  constructor(readonly spec: CitySpec) {
    this.rnd = mulberry(spec.seed);
    const rnd = this.rnd;
    // the grid lines: every third an avenue; the gap where the river runs is wider
    const riverRow = Math.floor(spec.rows / 2);
    const X: number[] = [0], Z: number[] = [0];
    for (let i = 0; i < spec.cols; i++) X.push(X[i] + 140 + rnd() * 50);
    for (let j = 0; j < spec.rows; j++) Z.push(Z[j] + (j === riverRow ? 240 : 120 + rnd() * 45));
    const colW = X.map((_, i) => (i % 3 === 0 ? AVENUE : STREET)), rowW = Z.map((_, j) => (j % 3 === 0 ? AVENUE : STREET));
    const grid: Node[][] = X.map((x, i) => Z.map((z, j) => this.node(x, z, Math.max(colW[i], rowW[j]))));
    const link = (a: Node, b: Node, width: number, kind: Edge['kind']) => {
      const e: Edge = { id: this.nextEdge++, a, b, width, axis: a.z === b.z ? 'x' : 'z', kind, length: Math.hypot(b.x - a.x, b.z - a.z) };
      this.edges.push(e);
      a.edges.push(e);
      b.edges.push(e);
      return e;
    };
    for (let i = 0; i <= spec.cols; i++) for (let j = 0; j <= spec.rows; j++) {
      if (i < spec.cols) link(grid[i][j], grid[i + 1][j], rowW[j], rowW[j] === AVENUE ? 'avenue' : 'street');
      if (j < spec.rows) link(grid[i][j], grid[i][j + 1], colW[i], colW[i] === AVENUE ? 'avenue' : 'street');
    }
    // the river, between two rows of blocks: only a few streets cross it, on bridges
    const rz0 = Z[riverRow] + rowW[riverRow] / 2 + 70, rz1 = Z[riverRow + 1] - rowW[riverRow + 1] / 2 - 70;
    this.river = { x0: -2000, z0: rz0, x1: X[spec.cols] + 2000, z1: rz1 };
    const bridges = new Set([0, Math.floor(spec.cols / 3), Math.floor((2 * spec.cols) / 3) + 1, spec.cols].map((i) => Math.min(spec.cols, i)));
    for (let i = 0; i <= spec.cols; i++) {
      const e = this.between(grid[i][riverRow], grid[i][riverRow + 1])!;
      if (bridges.has(i)) e.kind = 'bridge';
      else this.close(e);
    }
    // a few more streets closed (their blocks joined), never leaving a dead end or cutting the city in two
    const inner = this.edges.filter((e) => e.kind !== 'bridge' && !this.onEdgeOfCity(e, X, Z));
    for (let k = 0; k < inner.length * 0.1; k++) {
      const e = inner[Math.floor(rnd() * inner.length)];
      if (!this.edges.includes(e) || e.a.edges.length <= 2 || e.b.edges.length <= 2) continue;
      this.close(e);
      if (!this.connected()) this.reopen(e);
    }
    // the blocks, between the grid lines (where a street was closed, its stretch is block too); some have an
    // alley through the middle, and one's a park
    const cell = (i: number, j: number): Rect => ({ x0: X[i] + colW[i] / 2, x1: X[i + 1] - colW[i + 1] / 2, z0: Z[j] + rowW[j] / 2, z1: Z[j + 1] - rowW[j + 1] / 2 });
    const park = { i: Math.floor(spec.cols / 2) + (rnd() < 0.5 ? -1 : 1), j: riverRow + 1 + Math.floor(rnd() * 2) };
    for (let i = 0; i < spec.cols; i++) for (let j = 0; j < spec.rows; j++) {
      if (j === riverRow) {
        // the river banks: a strip of block either side of the water
        const c = cell(i, j);
        this.lots.push({ ...c, z1: rz0, park: false }, { ...c, z0: rz1, park: false });
        this.solids.push({ ...c });
        continue;
      }
      const c = cell(i, j), isPark = i === park.i && j === park.j;
      if (!isPark && rnd() < 0.18) {
        // an alley through the middle, from one street to the one opposite
        const across = rnd() < 0.5, mid = across ? (c.x0 + c.x1) / 2 : (c.z0 + c.z1) / 2;
        const [s0, s1] = across ? [this.split(grid[i][j], grid[i + 1][j], mid), this.split(grid[i][j + 1], grid[i + 1][j + 1], mid)]
          : [this.split(grid[i][j], grid[i][j + 1], mid), this.split(grid[i + 1][j], grid[i + 1][j + 1], mid)];
        if (s0 && s1) {
          link(s0, s1, ALLEY, 'alley');
          const halves: Rect[] = across
            ? [{ ...c, x1: mid - ALLEY / 2 }, { ...c, x0: mid + ALLEY / 2 }]
            : [{ ...c, z1: mid - ALLEY / 2 }, { ...c, z0: mid + ALLEY / 2 }];
          for (const h of halves) { this.lots.push({ ...h, park: false }); this.solids.push(h); }
          continue;
        }
      }
      this.lots.push({ ...c, park: isPark });
      this.solids.push(c);
    }
    // the edge of the city: nothing past the outer streets
    const W = X[spec.cols], H = Z[spec.rows], m = 600;
    this.bounds = { x0: -colW[0] / 2, z0: -rowW[0] / 2, x1: W + colW[spec.cols] / 2, z1: H + rowW[spec.rows] / 2 };
    const b = this.bounds;
    this.solids.push({ x0: b.x0 - m, z0: b.z0 - m, x1: b.x1 + m, z1: b.z0 }, { x0: b.x0 - m, z0: b.z1, x1: b.x1 + m, z1: b.z1 + m },
      { x0: b.x0 - m, z0: b.z0, x1: b.x0, z1: b.z1 }, { x0: b.x1, z0: b.z0, x1: b.x1 + m, z1: b.z1 });
    // (and blocks all round the outside of the outer streets, to look at)
    const o = 50;
    this.lots.push({ x0: b.x0 - o, z0: b.z0 - o, x1: b.x1 + o, z1: b.z0, park: false }, { x0: b.x0 - o, z0: b.z1, x1: b.x1 + o, z1: b.z1 + o, park: false },
      { x0: b.x0 - o, z0: b.z0, x1: b.x0, z1: b.z1, park: false }, { x0: b.x1, z0: b.z0, x1: b.x1 + o, z1: b.z1, park: false });
    // the river itself (solid but for the bridges), across the gap between the banks
    const bridgeEdges = this.edges.filter((e) => e.kind === 'bridge').sort((p, q) => p.a.x - q.a.x);
    let x0 = b.x0;
    for (const e of bridgeEdges) { this.solids.push({ x0, z0: rz0, x1: e.a.x - e.width / 2, z1: rz1 }); x0 = e.a.x + e.width / 2; }
    this.solids.push({ x0, z0: rz0, x1: b.x1, z1: rz1 });
    // traffic lights where three or more streets meet (not alleys' ends)
    for (const n of this.nodes) {
      n.lights = n.edges.filter((e) => e.kind !== 'alley').length >= 3 && n.edges.every((e) => e.kind !== 'alley');
      n.phase = rnd() * CYCLE;
    }
    // start in one corner, finish in the opposite one (which corner: the seed's)
    const corner = rnd() < 0.5;
    const s = corner ? grid[0][spec.rows] : grid[0][0], f = corner ? grid[spec.cols][0] : grid[spec.cols][spec.rows];
    const first = s.edges.find((e) => e.axis === 'x')!, next = first.a === s ? first.b : first.a;
    this.start = { x: (s.x + next.x) / 2, z: s.z, h: 0 };
    this.finish = f;
    this.distances();
  }

  private node(x: number, z: number, size: number) {
    const n: Node = { id: this.nodes.length, x, z, edges: [], size, lights: false, phase: 0 };
    this.nodes.push(n);
    return n;
  }

  between(a: Node, b: Node) { return a.edges.find((e) => e.a === b || e.b === b) ?? null; }
  other(e: Edge, n: Node) { return e.a === n ? e.b : e.a; }

  // A street closed off: it's block now (solid)
  private close(e: Edge) {
    this.edges.splice(this.edges.indexOf(e), 1);
    e.a.edges.splice(e.a.edges.indexOf(e), 1);
    e.b.edges.splice(e.b.edges.indexOf(e), 1);
    const h = e.width / 2;
    this.closed.push(e);
    this.solids.push(e.axis === 'x'
      ? { x0: Math.min(e.a.x, e.b.x) + e.a.size / 2, x1: Math.max(e.a.x, e.b.x) - e.b.size / 2, z0: e.a.z - h, z1: e.a.z + h }
      : { z0: Math.min(e.a.z, e.b.z) + e.a.size / 2, z1: Math.max(e.a.z, e.b.z) - e.b.size / 2, x0: e.a.x - h, x1: e.a.x + h });
  }
  readonly closed: Edge[] = []; // (the streets closed off: drawn as block)
  private reopen(e: Edge) {
    this.closed.pop();
    this.solids.pop();
    this.edges.push(e);
    e.a.edges.push(e);
    e.b.edges.push(e);
  }

  // Put a junction part way along a street (for an alley to come in): the street becomes two
  private split(a: Node, b: Node, at: number) {
    const e = this.between(a, b);
    if (!e || e.kind === 'bridge') return null;
    const n = this.node(e.axis === 'x' ? at : a.x, e.axis === 'x' ? a.z : at, e.width);
    this.edges.splice(this.edges.indexOf(e), 1);
    a.edges.splice(a.edges.indexOf(e), 1);
    b.edges.splice(b.edges.indexOf(e), 1);
    for (const [p, q] of [[a, n], [n, b]]) {
      const f: Edge = { id: this.nextEdge++, a: p, b: q, width: e.width, axis: e.axis, kind: e.kind, length: Math.hypot(q.x - p.x, q.z - p.z) };
      this.edges.push(f);
      p.edges.push(f);
      q.edges.push(f);
    }
    return n;
  }

  private onEdgeOfCity(e: Edge, X: number[], Z: number[]) {
    const last = (v: number[]) => v[v.length - 1];
    return e.axis === 'x' ? e.a.z === 0 || e.a.z === last(Z) : e.a.x === 0 || e.a.x === last(X);
  }

  private connected() {
    const seen = new Set<Node>([this.nodes[0]]), todo = [this.nodes[0]];
    while (todo.length) {
      const n = todo.pop()!;
      for (const e of n.edges) { const o = this.other(e, n); if (!seen.has(o)) { seen.add(o); todo.push(o); } }
    }
    return this.nodes.every((n) => !n.edges.length || seen.has(n));
  }

  // How far every junction is from the finish, the shortest way (Dijkstra)
  private distances() {
    const d = this.toFinish, todo = new Set(this.nodes.filter((n) => n.edges.length));
    for (const n of todo) d.set(n, Infinity);
    d.set(this.finish, 0);
    while (todo.size) {
      let best: Node | null = null;
      for (const n of todo) if (!best || d.get(n)! < d.get(best)!) best = n;
      todo.delete(best!);
      for (const e of best!.edges) {
        const o = this.other(e, best!), via = d.get(best!)! + e.length;
        if (via < d.get(o)!) d.set(o, via);
      }
    }
  }
  toGo(n: Node) { return this.toFinish.get(n) ?? Infinity; }

  // --- where things are ---------------------------------------------------------------------------------
  solid(x: number, z: number) {
    for (const r of this.solids) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    return false;
  }

  // The junction a point is in, or the street it's on (and how far along it from a), or null (off the road)
  where(x: number, z: number): { node: Node } | { edge: Edge; t: number } | null {
    for (const n of this.nodes) if (n.edges.length && Math.abs(x - n.x) < n.size / 2 + 1 && Math.abs(z - n.z) < n.size / 2 + 1) return { node: n };
    for (const e of this.edges) {
      const h = e.width / 2 + 1;
      if (e.axis === 'x' ? Math.abs(z - e.a.z) < h && x > Math.min(e.a.x, e.b.x) && x < Math.max(e.a.x, e.b.x)
        : Math.abs(x - e.a.x) < h && z > Math.min(e.a.z, e.b.z) && z < Math.max(e.a.z, e.b.z)) {
        const t = e.axis === 'x' ? (x - e.a.x) / (e.b.x - e.a.x) : (z - e.a.z) / (e.b.z - e.a.z);
        return { edge: e, t };
      }
    }
    return null;
  }

  // How far a point is from the finish, the shortest way by road
  remaining(x: number, z: number, last = Infinity) {
    const w = this.where(x, z);
    if (!w) return last;
    if ('node' in w) return this.toGo(w.node) + Math.hypot(x - w.node.x, z - w.node.z) * 0.5;
    const e = w.edge;
    return Math.min(this.toGo(e.a) + e.length * w.t, this.toGo(e.b) + e.length * (1 - w.t));
  }

  // The best way on from a junction (towards the finish), or another (for variety: `pick` 0 is the best)
  nextToward(n: Node, from: Node | null, pick = 0): Node | null {
    const options = n.edges.map((e) => this.other(e, n)).filter((o) => o !== from)
      .sort((p, q) => this.toGo(p) + this.between(n, p)!.length - (this.toGo(q) + this.between(n, q)!.length));
    return options[Math.min(pick, options.length - 1)] ?? null;
  }

  // The shortest way from a point to the finish, as junctions
  route(x: number, z: number, heading: number): Node[] {
    const w = this.where(x, z);
    if (!w) return [];
    let n: Node;
    if ('node' in w) n = w.node;
    else {
      // (on a street: whichever end is the better way, unless it means turning round)
      const e = w.edge, dx = Math.cos(heading), dz = Math.sin(heading);
      const ahead = (dx * (e.b.x - e.a.x) + dz * (e.b.z - e.a.z)) > 0 ? e.b : e.a, behind = this.other(e, ahead);
      n = this.toGo(ahead) + e.length * 0.5 <= this.toGo(behind) + e.length * 0.5 + 60 ? ahead : behind;
    }
    const out = [n];
    for (let k = 0; k < 60 && n !== this.finish; k++) {
      const next = this.nextToward(n, out[out.length - 2] ?? null);
      if (!next) break;
      out.push(next);
      n = next;
    }
    return out;
  }

  // The lights at a junction for traffic going along an axis
  signal(n: Node, axis: 'x' | 'z', t: number): 'green' | 'amber' | 'red' {
    if (!n.lights) return 'green';
    const c = (((t + n.phase) % CYCLE) + CYCLE) % CYCLE, half = CYCLE / 2;
    const k = axis === 'x' ? c : (c + half) % CYCLE;
    return k < GREEN ? 'green' : k < GREEN + AMBER ? 'amber' : 'red';
  }
  // How long it's been red for an axis (s), or -1
  sinceRed(n: Node, axis: 'x' | 'z', t: number) {
    if (!n.lights) return -1;
    const c = (((t + n.phase) % CYCLE) + CYCLE) % CYCLE, half = CYCLE / 2;
    const k = axis === 'x' ? c : (c + half) % CYCLE;
    return k >= GREEN + AMBER ? k - GREEN - AMBER : -1;
  }
  readonly redFor = CYCLE - GREEN - AMBER;
}

// A small fast seeded random number generator
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
