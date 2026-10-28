// The battlefield: bocage country (small fields boxed in by tall earth-bank hedgerows), a farm, an
// orchard, a sunken lane, a crossroads and the woods beyond, as data (what's where), and the grid the
// rules use to know where you can walk, what you can see through, and where there's cover. No graphics:
// scene.ts builds the land from the same data.
//
// Metres. x is east, z is south (the camera looks north, so up the screen is -z). The squads start in
// the pasture to the south and fight their way north to the woods.

export const MAP = { w: 160, d: 144 }; // x from -80 to 80, z from -72 to 72
export const CELL = 1; // m: the grid's cell

export enum Style { Farmhouse = 'farmhouse', Barn = 'barn', Shed = 'shed', Cottage = 'cottage' }

// A building: a solid block you can't walk or see through (the fighting is round it, not in it). A ruin
// has lost its roof and some of its walls.
export interface Building { x: number; z: number; w: number; d: number; storeys: number; style: Style; ruined?: boolean; rot?: number }

// Lines across the land: a hedgerow (an earth bank with a thick hedge on it, taller than a man: you
// can't see, shoot or walk through it), a dry-stone wall (waist high: you can see over it; crouched
// behind it you're hard to hit), barbed wire (in the way, but no cover)
export enum Line { Hedge = 'hedge', Wall = 'wall', Wire = 'wire' }
export interface Run { kind: Line; points: [number, number][] }

// Things in the way (and to hide behind)
export enum Prop { Crates = 'crates', Barrels = 'barrels', Sandbags = 'sandbags', Logs = 'logs', Hay = 'hay', Cart = 'cart', Cross = 'cross', Gun = 'gun', Rocks = 'rocks', Stump = 'stump' }
export interface Thing { kind: Prop; x: number; z: number; rot?: number }

export enum Ground { Pasture = 'pasture', Wheat = 'wheat', Plough = 'plough', Woods = 'woods', Orchard = 'orchard' }
export interface Field { kind: Ground; x: number; z: number; w: number; d: number }
export enum Kind { Oak = 'oak', Ash = 'ash', Apple = 'apple' }
export interface Tree { x: number; z: number; size: number; kind: Kind }
export interface Area { x: number; z: number; w: number; d: number } // (centre and size)

// The mission, in order. Each step says what to do, where, and who's there to stop you.
export enum Goal { Reach = 'reach', Clear = 'clear', Rescue = 'rescue', Destroy = 'destroy', Hold = 'hold', Extract = 'extract' }
export interface Step {
  goal: Goal;
  title: string;
  about: string;
  at: { x: number; z: number; r: number }; // where (a reach point, the gun, the ground to hold)
  zone?: Area; // clear: every enemy inside it
  enemies: { x: number; z: number }[]; // waiting when the step starts
  waves?: { after: number; from: { x: number; z: number }[]; count: number }[]; // hold: who comes, when (s)
  hold?: number; // s to hold
  checkpoint: { x: number; z: number }; // where the fallen come back in
  dark: number; // how dark it is (1: the dead of night, 0: day); a hold's goes to `dawn` by its end
  dawn?: number;
  radio: { start: string; done: string }; // what command says over the radio as the step begins, and when it's done
}

// The operation, for the briefing
export const OPERATION = {
  name: 'Operation Nightjar',
  time: '04:10, local',
  about: 'A coalition helicopter came down in the hedgerow country last night. The pilot, Captain Reyes, ejected and was taken by the enemy; we believe they are holding him at a farm north of the pasture. They have an anti-aircraft gun dug in at the edge of the woods, so nothing can fly in for him until it is gone.',
  plan: 'Go in on foot before first light. Break their line at the first hedgerow, take the farm and get Reyes out, bring him down through the orchard and the sunken lane, knock out the AA gun, then hold the crossroads until the helicopter can land. Nobody gets left behind.',
};
export const PILOT = { x: -21.5, z: 14.5 }; // where they hold him
export const LZ = { x: -18, z: -27, r: 6 }; // where the helicopter lands

// --- the level ------------------------------------------------------------------------------------------
export const LANE = { z: -14, w: 4.5 }; // the sunken lane, east to west between its hedgebanks

// The lie of the land (m): gentle rolls, rising toward the woods, and the sunken lane cut down between
// its banks. The rules don't use it (cover and sight come from what's on the land); the picture does.
export function height(x: number, z: number) {
  let h = 1.2 * Math.sin(x * 0.031 + 0.6) + 0.9 * Math.cos(z * 0.037 + 1.2) + 0.5 * Math.sin((x + z) * 0.052);
  h += Math.max(0, -z - 30) * 0.05;
  const off = Math.max(0, Math.abs(z - LANE.z) - LANE.w / 2);
  if (off < 2) h -= 1.3 * (1 - off / 2);
  for (const c of CRATERS) { // (a bowl, and its thrown-up rim)
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d < 1.5) h += d < 1 ? -0.55 * c.r * 0.35 * (1 - d * d) : 0.25 * Math.sin(((d - 1) / 0.5) * Math.PI) * (1.5 - d) * 2;
  }
  return h;
}

// The cart track north from the pasture, through the farm and the lane to the crossroads; the road
// past the crossroads, east to west
export const TRACK: [number, number][] = [
  [-6, 72], [-4, 56], [2, 44], [3, 30], [-2, 18], [-14, 8], [-22, 4], [-32, -4], [-8, -14], [4, -26], [8, -34], [8, -72],
];
export const ROAD: [number, number][] = [[-80, -32], [-40, -31], [0, -33], [8, -34], [40, -36], [80, -35]];
export const TRACK_W = 3, ROAD_W = 5;

export const BUILDINGS: Building[] = [
  // the farm
  { x: -36, z: 6, w: 13, d: 7.5, storeys: 2, style: Style.Farmhouse },
  { x: -50, z: 16, w: 15, d: 10, storeys: 1, style: Style.Barn, rot: 0.08 },
  { x: -24, z: 20, w: 8, d: 5, storeys: 1, style: Style.Shed },
  // at the crossroads
  { x: 20, z: -42, w: 9, d: 6.5, storeys: 1, style: Style.Cottage, ruined: true },
  { x: -10, z: -44, w: 8, d: 6, storeys: 1, style: Style.Cottage },
];

export const RUNS: Run[] = [
  // the bocage: field boundaries south of the farm, with gaps for the gates and the track
  { kind: Line.Hedge, points: [[-80, 50], [-12, 50]] },
  { kind: Line.Hedge, points: [[5, 50], [40, 50], [80, 49]] },
  { kind: Line.Hedge, points: [[-80, 33], [-30, 34], [-8, 33]] },
  { kind: Line.Hedge, points: [[9, 33], [46, 32]] },
  { kind: Line.Hedge, points: [[56, 32], [80, 31]] },
  { kind: Line.Hedge, points: [[-40, 50], [-41, 38]] },
  { kind: Line.Hedge, points: [[24, 50], [25, 37]] },
  { kind: Line.Hedge, points: [[52, 49], [53, 38]] },
  { kind: Line.Hedge, points: [[-66, 33], [-67, 0], [-70, -8]] },
  { kind: Line.Hedge, points: [[30, 27], [31, 12], [34, -4]] },
  { kind: Line.Hedge, points: [[10, 22], [24, 22]] },
  { kind: Line.Hedge, points: [[52, 18], [80, 17]] },
  // the sunken lane: a hedgebank each side, gaps where the track crosses
  { kind: Line.Hedge, points: [[-80, LANE.z + 3.2], [-18, LANE.z + 3.2]] },
  { kind: Line.Hedge, points: [[-4, LANE.z + 3.2], [80, LANE.z + 3.2]] },
  { kind: Line.Hedge, points: [[-80, LANE.z - 3.2], [-14, LANE.z - 3.2]] },
  { kind: Line.Hedge, points: [[0, LANE.z - 3.2], [80, LANE.z - 3.2]] },
  // the edge of the woods
  { kind: Line.Hedge, points: [[-80, -54], [-30, -53]] },
  { kind: Line.Hedge, points: [[46, -55], [80, -56]] },
  // the farmyard walls (the track comes in through the gate on the east side and out to the north)
  { kind: Line.Wall, points: [[-44, 28], [-60, 28], [-60, -2], [-40, -2]] },
  { kind: Line.Wall, points: [[-26, -2], [-18, -2], [-18, 1]] },
  { kind: Line.Wall, points: [[-18, 10], [-18, 28], [-34, 28]] },
  // the orchard's north wall, and the walls at the crossroads
  { kind: Line.Wall, points: [[-6, -4], [24, -4]] },
  { kind: Line.Wall, points: [[-26, -38], [-2, -38]] },
  { kind: Line.Wall, points: [[14, -38], [32, -38], [32, -48]] },
  // wire across the open ground before the woods, and along the first field
  { kind: Line.Wire, points: [[-24, -50], [2, -51]] },
  { kind: Line.Wire, points: [[16, -51], [40, -52]] },
  { kind: Line.Wire, points: [[-40, 38], [-20, 38]] },
];

export const THINGS: Thing[] = [
  // the outpost behind the first hedge
  { kind: Prop.Sandbags, x: -4, z: 30, rot: 0 }, { kind: Prop.Sandbags, x: 7, z: 30, rot: 0.2 },
  { kind: Prop.Logs, x: 16, z: 29 }, { kind: Prop.Crates, x: -14, z: 30 },
  // the farmyard
  { kind: Prop.Cart, x: -30, z: 15, rot: 0.6 }, { kind: Prop.Hay, x: -44, z: 25 }, { kind: Prop.Hay, x: -40.5, z: 25.5 },
  { kind: Prop.Barrels, x: -26, z: 2 }, { kind: Prop.Sandbags, x: -34, z: 0.5, rot: 0 }, { kind: Prop.Crates, x: -54, z: 6 },
  { kind: Prop.Logs, x: -56, z: 24, rot: 1.6 },
  // the orchard and the sunken lane
  { kind: Prop.Stump, x: 6, z: 18 }, { kind: Prop.Rocks, x: 18, z: -7 }, { kind: Prop.Crates, x: -30, z: LANE.z + 0.6 },
  { kind: Prop.Sandbags, x: 22, z: LANE.z + 1.3, rot: 0 }, { kind: Prop.Cart, x: 40, z: LANE.z, rot: 1.5 },
  // the crossroads
  { kind: Prop.Cross, x: 2, z: -29 }, { kind: Prop.Cart, x: 15, z: -30, rot: -0.4 }, { kind: Prop.Sandbags, x: -2, z: -40, rot: 0 },
  { kind: Prop.Sandbags, x: 10, z: -40, rot: 0.3 }, { kind: Prop.Barrels, x: -6, z: -30 }, { kind: Prop.Rocks, x: 28, z: -30 },
  // (the position they dug at the crossroads, facing the woods: ours to hold at the end)
  { kind: Prop.Sandbags, x: 5, z: -37, rot: 0 }, { kind: Prop.Sandbags, x: 0.5, z: -35.5, rot: 0.9 }, { kind: Prop.Sandbags, x: 9.5, z: -35.5, rot: -0.9 },
  { kind: Prop.Sandbags, x: 13, z: -33, rot: -1.5 }, { kind: Prop.Crates, x: 6, z: -33.5 },
  // the field gun at the edge of the woods
  { kind: Prop.Gun, x: 30, z: -61, rot: 0.2 }, { kind: Prop.Sandbags, x: 26, z: -58, rot: 1.2 }, { kind: Prop.Sandbags, x: 34, z: -58, rot: -1.2 },
  { kind: Prop.Crates, x: 36, z: -63 }, { kind: Prop.Crates, x: 24, z: -64 },
];

export const FIELDS: Field[] = [
  { kind: Ground.Pasture, x: 0, z: 61, w: 160, d: 22 },
  { kind: Ground.Wheat, x: -60, z: 42, w: 40, d: 15 },
  { kind: Ground.Plough, x: 12, z: 42, w: 22, d: 14 },
  { kind: Ground.Wheat, x: 64, z: 40, w: 30, d: 15 },
  { kind: Ground.Pasture, x: 54, z: 6, w: 48, d: 30 },
  { kind: Ground.Orchard, x: 8, z: 8, w: 30, d: 22 },
  { kind: Ground.Plough, x: -48, z: -40, w: 40, d: 20 },
  { kind: Ground.Wheat, x: 56, z: -44, w: 44, d: 14 },
  { kind: Ground.Woods, x: 0, z: -66, w: 160, d: 14 },
];

// Shell craters (scenery; their rims are low cover you can crouch in)
export const CRATERS: { x: number; z: number; r: number }[] = [
  { x: 14, z: 36, r: 2.4 }, { x: -22, z: 43, r: 2 }, { x: 42, z: 24, r: 3 }, { x: -12, z: -26, r: 2.6 }, { x: 22, z: -26, r: 2.2 },
  { x: 40, z: -46, r: 3 }, { x: -20, z: -46, r: 2.4 }, { x: 46, z: 8, r: 2.2 }, { x: -60, z: 40, r: 2 }, { x: 2, z: -46, r: 2.8 },
];

export const START = { x: -2, z: 64 };

export const MISSION: Step[] = [
  {
    goal: Goal.Clear, title: 'Break the hedgerow line', about: 'An enemy outpost is dug in behind the first hedgerow. Get through the gap by the track and clear it, quietly if you can: they are slower to see you in the dark.',
    at: { x: 0, z: 30, r: 0 }, zone: { x: 0, z: 30, w: 90, d: 10 }, checkpoint: START, dark: 1,
    enemies: [{ x: -4, z: 28 }, { x: 7, z: 28 }, { x: 16, z: 27 }, { x: -14, z: 28 }, { x: 22, z: 30 }, { x: -24, z: 30 }],
    radio: { start: 'Nightjar, Overlord. You are cleared in. Outpost behind the first hedgerow, six to eight of them. Go.', done: 'Overlord copies, outpost down. The farm is north-west of you. Reyes is in there.' },
  },
  {
    goal: Goal.Rescue, title: 'Rescue the pilot', about: 'They are holding Captain Reyes in the farmyard, by the shed. Clear the farm, then get to him: he will stay with whoever reaches him first.',
    at: { x: PILOT.x, z: PILOT.z, r: 2.5 }, zone: { x: -38, z: 12, w: 46, d: 34 }, checkpoint: { x: 2, z: 38 }, dark: 1,
    enemies: [{ x: -36, z: -1 }, { x: -30, z: 12 }, { x: -46, z: 4 }, { x: -22, z: 25 }, { x: -38, z: 23 }, { x: -54, z: 9 }, { x: -24, z: -0.5 }, { x: -21, z: 6 }],
    radio: { start: 'Nightjar, the farm is guarded. Reyes is by the shed. Keep him alive.', done: 'Overlord, we have Reyes. He is hurt but walking.' },
  },
  {
    goal: Goal.Reach, title: 'Down to the sunken lane', about: 'Bring Reyes through the orchard and down into the sunken lane, out of sight of the woods. Keep him close.',
    at: { x: -10, z: LANE.z, r: 6 }, checkpoint: { x: -26, z: 12 }, dark: 0.95,
    enemies: [{ x: 6, z: -2 }, { x: 14, z: -7 }, { x: 22, z: LANE.z - 0.5 }, { x: -26, z: LANE.z }, { x: 12, z: LANE.z - 6 }, { x: 28, z: 2 }],
    radio: { start: 'Nightjar, a patrol is moving in the orchard. Get Reyes into the lane.', done: 'Good. Now that AA gun: nothing flies in while it is there.' },
  },
  {
    goal: Goal.Destroy, title: 'Knock out the AA gun', about: 'Their anti-aircraft gun is dug in at the edge of the woods. Get to it and set a charge (hold Leaf beside it). Leave Reyes in cover, or bring him: he follows you.',
    at: { x: 30, z: -61, r: 3.4 }, checkpoint: { x: -10, z: LANE.z }, dark: 0.9,
    enemies: [{ x: -4, z: -42 }, { x: 10, z: -42 }, { x: 12, z: -46 }, { x: 24, z: -55 }, { x: 36, z: -55 }, { x: 20, z: -60 }, { x: 40, z: -60 }, { x: -16, z: -40 }],
    radio: { start: 'The gun is at the edge of the woods, north-east. Set the charge and get clear.', done: 'Gun is down. Dustoff is inbound, ninety seconds. Hold the crossroads.' },
  },
  {
    goal: Goal.Hold, title: 'Hold the landing zone', about: 'They know where we are. Hold the crossroads until the helicopter is in: it lands just west of you, by the road.',
    at: { x: 6, z: -32, r: 14 }, hold: 90, checkpoint: { x: 6, z: -24 }, enemies: [], dark: 0.85, dawn: 0.35,
    waves: [
      { after: 6, from: [{ x: -40, z: -57 }, { x: 54, z: -59 }], count: 5 },
      { after: 38, from: [{ x: 76, z: -36 }, { x: -76, z: -32 }], count: 6 },
      { after: 66, from: [{ x: -20, z: -57 }, { x: 16, z: -58 }, { x: 76, z: -24 }], count: 7 },
    ],
    radio: { start: 'Dustoff is ninety seconds out. Enemy moving on you from the woods and the road. Hold.', done: 'Nightjar, Dustoff is on the ground. Get Reyes aboard.' },
  },
  {
    goal: Goal.Extract, title: 'Get to the helicopter', about: 'The helicopter is down by the road. Get Reyes aboard, and everyone with him.',
    at: { x: LZ.x, z: LZ.z, r: LZ.r }, checkpoint: { x: 2, z: -26 }, enemies: [{ x: -40, z: -40 }, { x: 30, z: -44 }, { x: -50, z: -26 }], dark: 0.35,
    radio: { start: 'Dustoff is down. Move!', done: 'All aboard. Overlord, Nightjar is out, with the package. Good work.' },
  },
];

// Trees: the orchard's apples in rows, oaks and ashes standing in the hedgerows, the woods. (None where
// someone has to stand.)
export const TREES: Tree[] = (() => {
  const t: Tree[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) t.push({ x: -5 + i * 6.5 + rnd() - 0.5, z: 1 + j * 5.2 + rnd() - 0.5, size: 0.8 + rnd() * 0.3, kind: Kind.Apple });
  for (const r of RUNS) {
    if (r.kind !== Line.Hedge) continue;
    for (let k = 0; k + 1 < r.points.length; k++) {
      const [ax, az] = r.points[k], [bx, bz] = r.points[k + 1];
      const n = Math.floor(Math.hypot(bx - ax, bz - az) / 13);
      for (let i = 0; i < n; i++) if (rnd() < 0.55) {
        const u = (i + 0.5 + (rnd() - 0.5) * 0.6) / n;
        t.push({ x: ax + (bx - ax) * u, z: az + (bz - az) * u, size: 0.9 + rnd() * 0.5, kind: rnd() < 0.6 ? Kind.Oak : Kind.Ash });
      }
    }
  }
  for (let i = 0; i < 50; i++) t.push({ x: -78 + rnd() * 156, z: -61 - rnd() * 10, size: 1 + rnd() * 0.5, kind: rnd() < 0.5 ? Kind.Oak : Kind.Ash });
  const keep = [...MISSION.flatMap((s) => [...s.enemies, ...(s.waves ?? []).flatMap((w) => w.from), s.checkpoint, s.at]), ...THINGS];
  return t.filter((q) => keep.every((p) => Math.hypot(q.x - p.x, q.z - p.z) > 4) && !(Math.abs(q.x - 8) < 4 && q.z < -36));
})();

// --- the grid --------------------------------------------------------------------------------------------
// Each cell: can you walk on it; does it stop sight (and bullets) for someone standing; does it give
// low cover (stops bullets at someone crouched behind it)
export const enum Cell { Open = 0, Solid = 1, Low = 2 }

const GW = MAP.w / CELL, GD = MAP.d / CELL;

export class Grid {
  readonly cells = new Uint8Array(GW * GD);
  readonly cover: { x: number; z: number; low: boolean }[] = []; // places to fight from

  constructor() {
    for (const b of BUILDINGS) this.rect(b.x, b.z, b.w, b.d, Cell.Solid, b.rot ?? 0);
    for (const r of RUNS) for (let i = 0; i + 1 < r.points.length; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      if (r.kind === Line.Hedge) this.line(a[0], a[1], b[0], b[1], Cell.Solid, 2.2);
      else this.line(a[0], a[1], b[0], b[1], Cell.Low, r.kind === Line.Wall ? 0.8 : 0.5); // (wire: in the way, and low)
    }
    for (const t of THINGS) {
      const [w, d, c] = THING_SIZE[t.kind];
      this.rect(t.x, t.z, w, d, c, t.rot ?? 0);
    }
    for (const t of TREES) this.rect(t.x, t.z, 0.8, 0.8, Cell.Solid, 0);
    for (const c of CRATERS) this.ring(c.x, c.z, c.r);
    // the edges of the map
    for (let i = 0; i < GW; i++) { this.set(i, 0, Cell.Solid); this.set(i, GD - 1, Cell.Solid); }
    for (let j = 0; j < GD; j++) { this.set(0, j, Cell.Solid); this.set(GW - 1, j, Cell.Solid); }
    this.findCover();
  }

  private idx(x: number, z: number) {
    const i = Math.floor((x + MAP.w / 2) / CELL), j = Math.floor((z + MAP.d / 2) / CELL);
    return i < 0 || j < 0 || i >= GW || j >= GD ? -1 : j * GW + i;
  }
  private set(i: number, j: number, c: Cell) { this.cells[j * GW + i] = c; }

  at(x: number, z: number): Cell {
    const k = this.idx(x, z);
    return k < 0 ? Cell.Solid : (this.cells[k] as Cell);
  }
  walkable(x: number, z: number) { return this.at(x, z) === Cell.Open; }

  private mark(x: number, z: number, c: Cell) {
    const k = this.idx(x, z);
    if (k < 0) return;
    if (this.cells[k] === Cell.Solid) return;
    this.cells[k] = c;
  }

  private rect(cx: number, cz: number, w: number, d: number, c: Cell, rot: number) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const r = Math.hypot(w, d) / 2 + 1;
    for (let x = cx - r; x <= cx + r; x += CELL / 2) for (let z = cz - r; z <= cz + r; z += CELL / 2) {
      const dx = x - cx, dz = z - cz;
      const u = dx * cs + dz * sn, v = -dx * sn + dz * cs;
      if (Math.abs(u) <= w / 2 && Math.abs(v) <= d / 2) this.mark(x, z, c);
    }
  }

  private line(x1: number, z1: number, x2: number, z2: number, c: Cell, thick: number) {
    const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (CELL / 2));
    for (let i = 0; i <= n; i++) {
      const x = x1 + ((x2 - x1) * i) / n, z = z1 + ((z2 - z1) * i) / n;
      for (let a = -thick / 2; a <= thick / 2; a += CELL / 2) {
        // thickness across the line
        const len = Math.hypot(x2 - x1, z2 - z1) || 1;
        this.mark(x + (-(z2 - z1) / len) * a, z + ((x2 - x1) / len) * a, c);
      }
    }
  }

  // A crater's rim: a broken ring of low cover
  private ring(cx: number, cz: number, r: number) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) if (Math.sin(a * 3 + cx) < 0.6) this.mark(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Cell.Low);
  }

  // Places beside walls, hedges, houses and props: where a soldier can take cover
  private findCover() {
    for (let j = 1; j < GD - 1; j++) for (let i = 1; i < GW - 1; i++) {
      if (this.cells[j * GW + i] !== Cell.Open) continue;
      let low = false, solid = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = this.cells[(j + dj) * GW + i + di];
        if (c === Cell.Low) low = true;
        if (c === Cell.Solid) solid = true;
      }
      if ((low || solid) && (i + j) % 2 === 0) this.cover.push({ x: -MAP.w / 2 + (i + 0.5) * CELL, z: -MAP.d / 2 + (j + 0.5) * CELL, low });
    }
  }

  // Can someone at a see someone at b? Solid cells block; low cover blocks only if the target is
  // crouched right behind it (`crouched`), in which case it returns 'covered'
  sight(ax: number, az: number, bx: number, bz: number, crouched = false): 'clear' | 'covered' | 'blocked' {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / (CELL / 2)));
    let covered = false;
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      const c = this.at(x, z);
      if (c === Cell.Solid) return 'blocked';
      if (c === Cell.Low) {
        const toTarget = d * (1 - i / n);
        if (crouched && toTarget < 2.2) covered = true;
      }
    }
    return covered ? 'covered' : 'clear';
  }

  // The way from a to b, round everything (A* over the grid), as points every few metres
  path(ax: number, az: number, bx: number, bz: number, limit = 120000): { x: number; z: number }[] | null {
    const start = this.idx(ax, az), goal = this.nearestOpen(bx, bz);
    if (start < 0 || goal < 0) return null;
    const g = new Float32Array(GW * GD).fill(Infinity), from = new Int32Array(GW * GD).fill(-1);
    const open = new Heap();
    const h = (k: number) => Math.hypot((k % GW) - (goal % GW), Math.floor(k / GW) - Math.floor(goal / GW));
    g[start] = 0;
    open.push(start, h(start));
    let steps = 0;
    while (open.size && steps++ < limit) {
      const k = open.pop();
      if (k === goal) break;
      const i = k % GW, j = Math.floor(k / GW);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue;
        const nk = nj * GW + ni;
        if (this.cells[nk] !== Cell.Open) continue;
        if (di && dj && (this.cells[j * GW + ni] !== Cell.Open || this.cells[nj * GW + i] !== Cell.Open)) continue; // (no cutting corners)
        const cost = g[k] + (di && dj ? 1.414 : 1);
        if (cost < g[nk]) { g[nk] = cost; from[nk] = k; open.push(nk, cost + h(nk)); }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const out: { x: number; z: number }[] = [];
    for (let k = goal, n = 0; k !== start && k >= 0; k = from[k], n++) {
      if (n % 3 === 0) out.push({ x: -MAP.w / 2 + ((k % GW) + 0.5) * CELL, z: -MAP.d / 2 + (Math.floor(k / GW) + 0.5) * CELL });
    }
    out.reverse();
    if (out.length) out[out.length - 1] = { x: bx, z: bz };
    return out;
  }

  private nearestOpen(x: number, z: number) {
    for (let r = 0; r < 6; r++) for (let a = 0; a < 8; a++) {
      const k = this.idx(x + Math.cos((a * Math.PI) / 4) * r, z + Math.sin((a * Math.PI) / 4) * r);
      if (k >= 0 && this.cells[k] === Cell.Open) return k;
    }
    return -1;
  }
}

// How much ground each prop takes (m: across, along), and whether you can see over it
export const THING_SIZE: Record<Prop, [number, number, Cell]> = {
  [Prop.Crates]: [1.8, 1.6, Cell.Low], [Prop.Barrels]: [1.8, 1.6, Cell.Low], [Prop.Sandbags]: [3.4, 1, Cell.Low],
  [Prop.Logs]: [3.2, 1.2, Cell.Low], [Prop.Hay]: [2.2, 2.2, Cell.Solid], [Prop.Cart]: [3.2, 1.8, Cell.Low],
  [Prop.Cross]: [1.2, 1.2, Cell.Solid], [Prop.Gun]: [3.2, 4.6, Cell.Low], [Prop.Rocks]: [2.4, 2, Cell.Low], [Prop.Stump]: [1.1, 1.1, Cell.Low],
};

// A min-heap of grid cells by cost (for the path search)
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
