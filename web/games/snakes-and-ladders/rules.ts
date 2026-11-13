// Snakes and Ladders: the rules, no drawing. Where each square sits (numbered back and forth, row by
// row), the boards we offer and a random fair one, and a race: who's where, whose turn, what a roll does.

export const SIZE = 10;
export const LAST = 100; // home

// Where a square sits: its column (0 at the left) and row (0 at the bottom). Square 1 is bottom left,
// and each row runs the other way to the one below it: 10 is bottom right, and 11 sits on top of it.
export function cell(n: number) {
  const i = n - 1, row = Math.floor(i / SIZE), k = i % SIZE;
  return { col: row % 2 ? SIZE - 1 - k : k, row };
}

// A square's middle in board units (one square = 1), from the board's top left. Square 0 is the start,
// just off the board to the left of square 1.
export function centre(n: number) {
  if (n <= 0) return { x: -0.5, y: SIZE - 0.5 };
  const { col, row } = cell(n);
  return { x: col + 0.5, y: SIZE - 1 - row + 0.5 };
}

// A board: each snake goes from its head down to its tail, each ladder from its foot up to its top
export interface Board { id: string; name: string; about: string; snakes: [number, number][]; ladders: [number, number][] }

// Our own boards, laid out for this game (not copied from a printed one). Each is checked by problems()
// and comes out a quick race: 27 to 35 rolls each, on average (expectedRolls()).
export const BOARDS: Board[] = [
  {
    id: 'meadow', name: 'Meadow', about: 'Gentle: nine ladders, small snakes',
    ladders: [[3, 20], [4, 40], [14, 30], [26, 42], [33, 54], [56, 72], [61, 80], [63, 91], [84, 98]],
    snakes: [[15, 7], [41, 23], [46, 35], [69, 60], [79, 62], [89, 77], [94, 81]],
  },
  {
    id: 'jungle', name: 'Jungle', about: 'Even: eight of each',
    ladders: [[5, 44], [20, 43], [27, 47], [31, 48], [46, 77], [50, 90], [69, 89], [82, 96]],
    snakes: [[30, 15], [38, 17], [62, 25], [67, 52], [80, 40], [81, 45], [88, 76], [94, 78]],
  },
  {
    id: 'temple', name: 'Temple', about: 'Wild: huge climbs, huge falls',
    ladders: [[5, 41], [6, 37], [13, 45], [38, 80], [46, 84], [49, 95], [58, 99]],
    snakes: [[28, 3], [51, 12], [61, 18], [72, 48], [85, 62], [90, 70], [92, 54], [93, 36], [94, 56]],
  },
];

// --- checking a board ---------------------------------------------------------------------------------

// One snake or ladder, from where you land to where it takes you
interface Piece { kind: 'snake' | 'ladder'; a: number; z: number }
const pieces = (b: Board): Piece[] => [
  ...b.ladders.map(([a, z]) => ({ kind: 'ladder' as const, a, z })),
  ...b.snakes.map(([a, z]) => ({ kind: 'snake' as const, a, z })),
];
const named = (p: Piece) => `${p.kind} ${p.a}-${p.z}`;

// What's wrong with one piece on its own: its ends on the board but not the start or home, a snake going
// down and a ladder up, to another row
function badPiece(p: Piece) {
  if (Math.min(p.a, p.z) <= 1 || Math.max(p.a, p.z) >= LAST) return `${named(p)} touches the start or home`;
  if (p.kind === 'ladder' ? p.z <= p.a : p.z >= p.a) return `${named(p)} goes the wrong way`;
  if (cell(p.a).row === cell(p.z).row) return `${named(p)} stays on one row`;
  return '';
}

// What's wrong with two pieces together, so that every one can be read: no shared square; two ladders (or
// two snakes) never crossing or lying close alongside; no end hidden under the other kind's body
function badPair(p: Piece, q: Piece) {
  if ([p.a, p.z].some((n) => n === q.a || n === q.z)) return `${named(p)} and ${named(q)} share a square`;
  const sp = [centre(p.a), centre(p.z)] as const, sq = [centre(q.a), centre(q.z)] as const;
  if (p.kind === q.kind) return segGap(sp, sq) < 0.7 ? `${named(p)} and ${named(q)} cross or touch` : '';
  const under = [p.a, p.z].find((n) => pointGap(centre(n), sq) < 0.4) ?? [q.a, q.z].find((n) => pointGap(centre(n), sp) < 0.4);
  return under ? `square ${under} lies under ${named(p)} or ${named(q)}` : '';
}

// Whatever's wrong with a board, in words (none: it's fine)
export function problems(b: Board): string[] {
  const all = pieces(b), out = all.map(badPiece);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) out.push(badPair(all[i], all[j]));
  return out.filter(Boolean);
}

type P = { x: number; y: number };
function pointGap(p: P, [a, b]: readonly [P, P]) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function crosses([a, b]: readonly [P, P], [c, d]: readonly [P, P]) {
  const side = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
// How close two straight lines come (0 if they cross)
function segGap(p: readonly [P, P], q: readonly [P, P]) {
  if (crosses(p, q)) return 0;
  return Math.min(pointGap(p[0], q), pointGap(p[1], q), pointGap(q[0], p), pointGap(q[1], p));
}

// Where landing on a square takes you (itself, if nothing's there)
export function jumps(b: Board) {
  const to = new Map<number, number>();
  for (const [a, z] of [...b.snakes, ...b.ladders]) to.set(a, z);
  return to;
}

// How many rolls one player needs, on average, to get home on this board (sixes not counted).
// Worked out exactly by repeating the sum until it settles: 100 squares, a few hundred passes.
export function expectedRolls(b: Board, exact = true) {
  const to = jumps(b), e = new Array<number>(LAST + 1).fill(0);
  const land = (n: number) => to.get(n) ?? n;
  for (let pass = 0; pass < 2000; pass++) {
    let moved = 0;
    for (let s = LAST - 1; s >= 0; s--) {
      let sum = 0;
      for (let d = 1; d <= 6; d++) {
        let n = s + d;
        if (n > LAST) n = exact ? 2 * LAST - n : LAST;
        sum += e[land(n)];
      }
      const v = 1 + sum / 6;
      moved = Math.max(moved, Math.abs(v - e[s]));
      e[s] = v;
    }
    if (moved < 1e-6) break;
  }
  return e[0];
}

// --- a random fair board ------------------------------------------------------------------------------

// The same seed always gives the same board
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FAIR = [27, 35]; // average rolls to get home (exact roll on) that make a fair, quick race, like our boards

// Eight ladders and eight snakes, placed one at a time where each fits with the ones already down, until the
// layout is fair: about as long a race as our own boards. The same seed always gives the same board.
export function randomBoard(seed = Math.floor(Math.random() * 2 ** 31)): Board {
  const r = rng(seed), int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  for (let tries = 0; tries < 400; tries++) {
    const placed: Piece[] = [];
    for (let i = 0; i < 800 && placed.length < 16; i++) {
      const ladder = i % 2 === 0 ? placed.filter((p) => p.kind === 'ladder').length < 8 : placed.filter((p) => p.kind === 'snake').length >= 8;
      const a = ladder ? int(2, 80) : int(18, 99);
      const p: Piece = ladder ? { kind: 'ladder', a, z: a + int(10, 38) } : { kind: 'snake', a, z: a - int(10, 45) };
      if (!badPiece(p) && placed.every((q) => !badPair(p, q))) placed.push(p);
    }
    if (placed.length < 16) continue;
    const b: Board = {
      id: 'random', name: 'Random', about: 'A new fair layout every game: eight ladders, eight snakes',
      ladders: placed.filter((p) => p.kind === 'ladder').map((p) => [p.a, p.z]),
      snakes: placed.filter((p) => p.kind === 'snake').map((p) => [p.a, p.z]),
    };
    const e = expectedRolls(b);
    if (e >= FAIR[0] && e <= FAIR[1]) return b;
  }
  return { ...BOARDS[0], id: 'random', name: 'Random' }; // (doesn't happen in practice: checked over thousands of seeds)
}

// --- a race -------------------------------------------------------------------------------------------

export interface Rules {
  exact: boolean; // you need the exact roll to land on home; too many and you bounce back
  sixes: boolean; // a six rolls again; three sixes in a row and you go back to where the turn began
  everyPlace: boolean; // play on after the winner, for every place (or stop at the first one home)
}

// What one roll does, step by step, for the animation
export type Step =
  | { kind: 'walk'; path: number[] } // square by square (a bounce walks up to home and back down)
  | { kind: 'ladder'; from: number; to: number }
  | { kind: 'snake'; from: number; to: number }
  | { kind: 'back'; from: number; to: number } // the third six
  | { kind: 'home'; place: number };

export interface Roll {
  who: number;
  die: number;
  from: number;
  steps: Step[];
  bounced: boolean;
  threeSixes: boolean;
  again: boolean; // they roll again
}

export class Race {
  pos: number[];
  home: number[] = []; // who got home, in order
  turn = 0;
  sixes = 0; // sixes in a row this turn
  private turnFrom = 0; // where this turn began (for the third six)
  private to: Map<number, number>;

  constructor(readonly board: Board, readonly players: number, readonly rules: Rules) {
    this.pos = new Array(players).fill(0);
    this.to = jumps(board);
  }

  get over() {
    return this.rules.everyPlace ? this.home.length >= this.players - 1 : this.home.length > 0;
  }

  // Everyone, best first: those home in the order they got there, then the rest by how far they got
  // (level: whoever was first in the turn order)
  standings() {
    const rest = [...Array(this.players).keys()].filter((i) => !this.home.includes(i)).sort((a, b) => this.pos[b] - this.pos[a] || a - b);
    return [...this.home, ...rest];
  }

  roll(die: number): Roll {
    const who = this.turn, from = this.pos[who], steps: Step[] = [];
    if (this.sixes === 0) this.turnFrom = from;
    const out: Roll = { who, die, from, steps, bounced: false, threeSixes: false, again: false };
    if (this.rules.sixes && die === 6 && ++this.sixes === 3) {
      out.threeSixes = true;
      if (from !== this.turnFrom) steps.push({ kind: 'back', from, to: this.turnFrom });
      this.pos[who] = this.turnFrom;
      this.next();
      return out;
    }
    let at = from + die;
    const path: number[] = [];
    for (let n = from + 1; n <= Math.min(at, LAST); n++) path.push(n);
    if (at > LAST) {
      if (this.rules.exact) {
        out.bounced = true;
        at = 2 * LAST - at;
        for (let n = LAST - 1; n >= at; n--) path.push(n);
      } else at = LAST;
    }
    steps.push({ kind: 'walk', path });
    const jump = this.to.get(at);
    if (jump !== undefined) {
      steps.push({ kind: jump > at ? 'ladder' : 'snake', from: at, to: jump });
      at = jump;
    }
    this.pos[who] = at;
    if (at === LAST) {
      this.home.push(who);
      steps.push({ kind: 'home', place: this.home.length });
      this.next();
      return out;
    }
    if (this.rules.sixes && die === 6) out.again = true;
    else this.next();
    return out;
  }

  // The next player still racing
  private next() {
    this.sixes = 0;
    if (this.over) return;
    do this.turn = (this.turn + 1) % this.players;
    while (this.home.includes(this.turn));
  }
}
