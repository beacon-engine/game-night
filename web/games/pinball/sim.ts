// The simulation, written in Odin (odin/) and built into sim.wasm with `make wasm`. This loads it,
// passes the controls in, and reads the table and the state out of its memory.
//
// The readers below go through the fields in the order odin/main.odin (State) and odin/table.odin
// (Table) declare them: change a struct there, change its reader here. The sizes are checked when
// it loads, so a mismatch stops the game with an error instead of reading nonsense.

export const TICK = 1 / 60; // one step()

// Event_Kind in main.odin
export const EV = {
  bumper: 1, sling: 2, wall: 3, flipperHit: 4, flip: 5, lane: 6, lanesComplete: 7, target: 8, targetsComplete: 9,
  launch: 10, ballSaved: 11, tiltWarning: 12, tilt: 13, drain: 14,
} as const;

// Phase in main.odin
export const PHASE = { inLane: 0, inPlay: 1, drained: 2 } as const;

export interface Vec { x: number; y: number }
export interface Segment { a: Vec; b: Vec; kind: 'wall' | 'sling' | 'target'; id: number }
export interface Bumper { pos: Vec; radius: number }
export interface Flipper { pivot: Vec; length: number; baseRadius: number; tipRadius: number }

export interface Table {
  w: number;
  h: number;
  ballRadius: number;
  plungerRest: Vec;
  plungerTravel: number;
  laneRadius: number;
  lanes: Vec[];
  bumpers: Bumper[];
  flippers: Flipper[];
  segments: Segment[];
}

export interface SimEvent { kind: number; x: number; y: number; value: number }

export interface State {
  ball: Vec;
  vel: Vec;
  flipperAngle: number[];
  plunger: number;
  tiltMeter: number;
  ballSave: number;
  phase: number;
  tilted: boolean;
  score: number;
  bonus: number;
  multiplier: number;
  lanes: number;
  targets: number;
  bumperGlow: number[];
  slingGlow: number[];
  events: SimEvent[];
}

interface Exports {
  memory: WebAssembly.Memory;
  setup(seed: number): void;
  start_ball(): void;
  set_controls(left: number, right: number, launch: number): void;
  nudge(dx: number, dy: number): void;
  set_autoplay(on: number): void;
  step(): void;
  state_ptr(): number;
  state_size(): number;
  table_ptr(): number;
  table_size(): number;
}

// Reads 4-byte fields one after another from a struct in the wasm memory
class Fields {
  private f: Float32Array;
  private i: Int32Array;
  at = 0;
  constructor(memory: WebAssembly.Memory, ptr: number, bytes: number) {
    this.f = new Float32Array(memory.buffer, ptr, bytes / 4);
    this.i = new Int32Array(memory.buffer, ptr, bytes / 4);
  }
  f32() { return this.f[this.at++]; }
  i32() { return this.i[this.at++]; }
  vec(): Vec { return { x: this.f32(), y: this.f32() }; }
  get words() { return this.f.length; }
}

const KINDS = ['wall', 'sling', 'target'] as const;

export class Sim {
  readonly table: Table;
  readonly state: State;
  private maxEvents = 0;

  constructor(private wasm: Exports) {
    wasm.setup((Math.random() * 2 ** 32) >>> 0);
    this.table = this.readTable();
    this.state = this.readState();
  }

  startBall() { this.wasm.start_ball(); this.readState(this.state); }
  controls(left: boolean, right: boolean, launch: boolean) { this.wasm.set_controls(+left, +right, +launch); }
  nudge(dx: number, dy: number) { this.wasm.nudge(dx, dy); }
  autoplay(on: boolean) { this.wasm.set_autoplay(+on); }
  step() { this.wasm.step(); this.readState(this.state); }

  private readTable(): Table {
    const r = new Fields(this.wasm.memory, this.wasm.table_ptr(), this.wasm.table_size());
    const lanes = r.i32(), bumpers = r.i32(), maxSegments = r.i32();
    this.maxEvents = r.i32();
    const size = r.vec();
    const t: Table = {
      w: size.x, h: size.y, ballRadius: r.f32(), plungerRest: r.vec(), plungerTravel: r.f32(), laneRadius: r.f32(),
      lanes: [], bumpers: [], flippers: [], segments: [],
    };
    for (let i = 0; i < lanes; i++) t.lanes.push(r.vec());
    for (let i = 0; i < bumpers; i++) t.bumpers.push({ pos: r.vec(), radius: r.f32() });
    for (let i = 0; i < 2; i++) {
      t.flippers.push({ pivot: r.vec(), length: r.f32(), baseRadius: r.f32(), tipRadius: r.f32() });
      r.f32(); r.f32(); // (rest, up: only the simulation needs them)
    }
    const count = r.i32();
    for (let i = 0; i < maxSegments; i++) {
      const seg = { a: r.vec(), b: r.vec(), kind: KINDS[r.i32()] ?? 'wall', id: r.i32() };
      if (i < count) t.segments.push(seg);
    }
    if (r.at !== r.words) throw new Error(`sim.wasm: Table is ${r.words} fields, sim.ts read ${r.at}: update readTable`);
    return t;
  }

  private readState(into?: State): State {
    const r = new Fields(this.wasm.memory, this.wasm.state_ptr(), this.wasm.state_size());
    const s = into ?? ({ events: [] as SimEvent[] } as State);
    s.ball = r.vec();
    s.vel = r.vec();
    s.flipperAngle = [r.f32(), r.f32()];
    s.plunger = r.f32();
    s.tiltMeter = r.f32();
    s.ballSave = r.f32();
    s.phase = r.i32();
    s.tilted = r.i32() !== 0;
    s.score = r.i32();
    s.bonus = r.i32();
    s.multiplier = r.i32();
    s.lanes = r.i32();
    s.targets = r.i32();
    s.bumperGlow = this.table.bumpers.map(() => r.f32());
    s.slingGlow = [r.f32(), r.f32()];
    const n = r.i32();
    s.events.length = 0;
    for (let i = 0; i < this.maxEvents; i++) {
      const e = { kind: r.i32(), x: r.f32(), y: r.f32(), value: r.i32() };
      if (i < n) s.events.push(e);
    }
    if (r.at !== r.words) throw new Error(`sim.wasm: State is ${r.words} fields, sim.ts read ${r.at}: update readState`);
    return s;
  }
}

// Load sim.wasm (next to the page)
export async function loadSim(url = 'sim.wasm'): Promise<Sim> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} (build it with \`make wasm\`)`);
  const module = await WebAssembly.compile(await res.arrayBuffer());
  // Odin's core:math asks the C maths library for sinf, cosf and the like; the browser's Math stands in
  const env: Record<string, (...args: number[]) => number> = {};
  for (const imp of WebAssembly.Module.imports(module)) {
    const fn = (Math as unknown as Record<string, unknown>)[imp.name.replace(/f$/, '')];
    if (imp.module !== 'env' || typeof fn !== 'function') throw new Error(`sim.wasm wants ${imp.module}.${imp.name}, which the page doesn't provide`);
    env[imp.name] = fn as (...args: number[]) => number;
  }
  const instance = await WebAssembly.instantiate(module, { env });
  return new Sim(instance.exports as unknown as Exports);
}
