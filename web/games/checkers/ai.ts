// The computer player: an alpha-beta search over rules.ts, with a memory of positions it has already
// scored (a transposition table), scoring positions by material, kings, how far the men have come,
// the back row kept as a guard, and the centre. Jumps are always played out to the end, since they are
// forced. It thinks a few milliseconds per frame (Thinker.step), so the screen never freezes, even on
// a slow TV, and stops at a time limit with the best move it has.
import { colOf, isKing, rowOf, WHITE, type Color, type Draughts, type Move } from './rules.ts';

export const LEVELS = [
  { name: 'Easy', depth: 2, noise: 70, blunder: 0.2, ms: 400 }, // (short-sighted; sometimes just plays anything)
  { name: 'Medium', depth: 5, noise: 12, blunder: 0, ms: 900 },
  { name: 'Hard', depth: 40, noise: 0, blunder: 0, ms: 2000 }, // (as deep as it can in the time)
];

const MAN = 100, KING = 150;
const WIN = 100000;
const MAX_PLY = 64;

// How much a man is worth for each row it has come forward (0: still at home)
const ADVANCE = [0, 2, 4, 7, 11, 16, 22, 0];
// The middle of the board, for men and kings both
const CENTRE = (s: number) => {
  const c = colOf(s), r = rowOf(s);
  return c >= 2 && c <= 5 && r >= 2 && r <= 5 ? (c >= 3 && c <= 4 && r >= 3 && r <= 4 ? 8 : 4) : 0;
};
// The back-row squares that stop the other side crowning: 1 and 3 for Black, 30 and 32 for White (the bridge)
const BRIDGE = { b: [0, 2], w: [29, 31] };
const distance = (a: number, b: number) => Math.max(Math.abs(colOf(a) - colOf(b)), Math.abs(rowOf(a) - rowOf(b)));

// The position's score for the side to move, in hundredths of a man
export function evaluate(g: Draughts) {
  const b = g.board;
  const mat = { b: 0, w: 0 }, men = { b: 0, w: 0 }, kings: Record<Color, number[]> = { b: [], w: [] }, all: Record<Color, number[]> = { b: [], w: [] };
  let pos = 0; // (from Black's side)
  for (let s = 0; s < 32; s++) {
    const p = b[s];
    if (!p) continue;
    const c: Color = p & WHITE ? 'w' : 'b', sign = c === 'b' ? 1 : -1;
    all[c].push(s);
    if (isKing(p)) { mat[c] += KING; kings[c].push(s); pos += sign * CENTRE(s); continue; }
    mat[c] += MAN;
    men[c]++;
    const forward = c === 'b' ? rowOf(s) : 7 - rowOf(s);
    pos += sign * (ADVANCE[forward] + CENTRE(s) / 2);
  }
  const total = mat.b + mat.w;
  // the back row: a guard while the other side still has men that could be crowned
  for (const c of ['b', 'w'] as const) {
    const foe = c === 'b' ? 'w' : 'b', sign = c === 'b' ? 1 : -1;
    if (!men[foe] || total < 900) continue;
    for (const s of BRIDGE[c]) if (b[s] && !isKing(b[s]) && (b[s] & WHITE ? 'w' : 'b') === c) pos += sign * 12;
  }
  let score = mat.b - mat.w + pos;
  // ahead: swapping pieces helps, and kings should go and hunt down what's left
  const diff = mat.b - mat.w;
  if (diff) {
    score += Math.round((diff * 600) / total);
    const lead: Color = diff > 0 ? 'b' : 'w', foe: Color = diff > 0 ? 'w' : 'b';
    let chase = 0;
    for (const k of kings[lead]) chase += Math.min(...all[foe].map((s) => distance(k, s)), 8);
    score -= (lead === 'b' ? 1 : -1) * chase * 3;
  }
  return g.turn === 'b' ? score : -score;
}

// Would the computer (playing `c`) take a draw? Only when it's clearly worse.
export const wantsDraw = (g: Draughts, c: Color) => (g.turn === c ? 1 : -1) * evaluate(g) < -120;

// The memory: positions already searched, with how deep, the score, and the best move's place in the list
const TT_SIZE = 1 << 18;
const EXACT = 1, LOWER = 2, UPPER = 3;
class Memory {
  key = new Int32Array(TT_SIZE);
  depth = new Int8Array(TT_SIZE).fill(-1);
  score = new Int32Array(TT_SIZE);
  flag = new Uint8Array(TT_SIZE);
  best = new Int8Array(TT_SIZE);
}

// Longer jumps first, then crowning (and before them all, whatever the memory says was best)
const order = (moves: Move[]) => moves.sort((a, b) => b.taken.length - a.taken.length || Number(b.crown) - Number(a.crown));

export class Thinker {
  private g: Draughts;
  private level: (typeof LEVELS)[number];
  private run: Generator<void, Move | null>;
  private mem = new Memory();
  private sliceEnd = 0;
  private deadline: number;
  private nodes = 0;
  private depth = 0;
  private stop = false;
  move: Move | null = null; // decided
  done = false;

  constructor(game: Draughts, level: number) {
    this.g = game.clone(); // (its own board: the search moves pieces about between frames)
    this.level = LEVELS[level];
    this.deadline = performance.now() + this.level.ms;
    this.run = this.think();
  }

  // Think for up to `ms` milliseconds. True once the move is decided (in `move`).
  step(ms: number) {
    if (this.done) return true;
    this.sliceEnd = performance.now() + ms;
    const r = this.run.next();
    if (r.done) { this.move = r.value; this.done = true; }
    return this.done;
  }

  // Iterative deepening: search 1 move ahead, then 2... keeping the best move of the last full search
  private *think(): Generator<void, Move | null> {
    const g = this.g, L = this.level, moves = order(g.moves());
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0]; // (nothing to think about)
    if (Math.random() < L.blunder) return moves[Math.floor(Math.random() * moves.length)];
    const noise = new Map(moves.map((m) => [m, (Math.random() - 0.5) * 2 * L.noise])); // (variety, and mistakes on Easy)
    let best = moves[0];
    for (this.depth = 1; this.depth <= L.depth; this.depth++) {
      let alpha = -Infinity, found: Move | null = null;
      for (const m of moves) {
        g.make(m);
        // (with noise, a slightly worse move can still come out best: so search a little wider)
        const score = -(yield* this.search(this.depth - 1, -WIN - 1, -alpha + 2 * L.noise, 1)) + noise.get(m)!;
        g.undo();
        if (this.stop) break;
        if (score > alpha) { alpha = score; found = m; }
      }
      if (this.stop || !found) break; // (out of time: keep the last full search's choice)
      best = found;
      moves.splice(moves.indexOf(best), 1);
      moves.unshift(best); // (searched first next time: it makes the cut-offs work)
      if (Math.abs(alpha) > WIN / 2) break; // (a win or a loss found: no need to look further)
    }
    return best;
  }

  private *search(depth: number, alpha: number, beta: number, ply: number): Generator<void, number> {
    if (++this.nodes % 512 === 0) {
      if (this.depth > 1 && performance.now() > this.deadline) this.stop = true;
      if (performance.now() > this.sliceEnd) yield; // (back to the frame; carry on next time)
    }
    if (this.stop) return 0;
    const g = this.g, listed = g.moves();
    if (!listed.length) return -WIN + ply; // (no move, or no pieces: lost)
    // A jump is never the end of the search: the side to move has to take, so play it out first.
    // And a single possible move costs nothing to look past.
    const forced = listed[0].taken.length > 0 || listed.length === 1;
    if (depth <= 0 && (!forced || ply >= MAX_PLY)) return evaluate(g);
    if (forced && ply < MAX_PLY && depth < 1) depth = 1;

    // what the memory knows
    const m = this.mem, i = g.hash & (TT_SIZE - 1), check = g.hash;
    let first: Move | undefined;
    if (m.key[i] === check && m.depth[i] >= 0) {
      first = listed[m.best[i]];
      if (m.depth[i] >= depth) {
        const s = m.score[i];
        if (m.flag[i] === EXACT) return s;
        if (m.flag[i] === LOWER && s >= beta) return s;
        if (m.flag[i] === UPPER && s <= alpha) return s;
      }
    }
    const moves = order([...listed]);
    if (first) moves.unshift(...moves.splice(moves.indexOf(first), 1));
    const start = alpha;
    let bestScore = -Infinity, bestMove: Move = moves[0];
    for (const mv of moves) {
      g.make(mv);
      const score = -(yield* this.search(depth - 1, -beta, -alpha, ply + 1));
      g.undo();
      if (this.stop) return 0;
      if (score > bestScore) { bestScore = score; bestMove = mv; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    // remember it (the best move by its place in the list as moves() makes it, which is always the same)
    m.key[i] = check;
    m.depth[i] = Math.min(depth, 127);
    m.score[i] = bestScore;
    m.flag[i] = bestScore <= start ? UPPER : bestScore >= beta ? LOWER : EXACT;
    m.best[i] = listed.indexOf(bestMove);
    return bestScore;
  }
}
