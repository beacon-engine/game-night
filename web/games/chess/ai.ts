// The computer player: an alpha-beta search over rules.ts, scoring positions by material and where
// each piece stands (piece-square tables). It thinks a few milliseconds per frame (Thinker.step), so
// the screen never freezes, even on a slow TV, and stops at a time limit with the best move it has.
import { colorOf, fileOf, KING, PAWN, rankOf, typeOf, type Chess, type Color, type Move } from './rules.ts';

export const LEVELS = [
  { name: 'Easy', depth: 1, quiesce: false, noise: 90, blunder: 0.15, ms: 500 }, // (misses replies; sometimes just plays anything)
  { name: 'Medium', depth: 2, quiesce: true, noise: 20, blunder: 0, ms: 1000 },
  { name: 'Hard', depth: 4, quiesce: true, noise: 0, blunder: 0, ms: 1500 },
];

const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000;

// Where each piece likes to stand, from White's side with rank 8 at the top (the well-known
// "simplified evaluation" tables). Black reads them upside down.
const T = (s: string) => s.trim().split(/[\s,]+/).map(Number);
const TABLE: number[][] = [[], T(`
  0 0 0 0 0 0 0 0  50 50 50 50 50 50 50 50  10 10 20 30 30 20 10 10  5 5 10 25 25 10 5 5
  0 0 0 20 20 0 0 0  5 -5 -10 0 0 -10 -5 5  5 10 10 -20 -20 10 10 5  0 0 0 0 0 0 0 0`), T(`
  -50 -40 -30 -30 -30 -30 -40 -50  -40 -20 0 0 0 0 -20 -40  -30 0 10 15 15 10 0 -30  -30 5 15 20 20 15 5 -30
  -30 0 15 20 20 15 0 -30  -30 5 10 15 15 10 5 -30  -40 -20 0 5 5 0 -20 -40  -50 -40 -30 -30 -30 -30 -40 -50`), T(`
  -20 -10 -10 -10 -10 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 10 10 5 0 -10  -10 5 5 10 10 5 5 -10
  -10 0 10 10 10 10 0 -10  -10 10 10 10 10 10 10 -10  -10 5 0 0 0 0 5 -10  -20 -10 -10 -10 -10 -10 -10 -20`), T(`
  0 0 0 0 0 0 0 0  5 10 10 10 10 10 10 5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5
  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  0 0 0 5 5 0 0 0`), T(`
  -20 -10 -10 -5 -5 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 5 5 5 0 -10  -5 0 5 5 5 5 0 -5
  0 0 5 5 5 5 0 -5  -10 5 5 5 5 5 0 -10  -10 0 5 0 0 0 0 -10  -20 -10 -10 -5 -5 -10 -10 -20`), T(`
  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30
  -20 -30 -30 -40 -40 -30 -30 -20  -10 -20 -20 -20 -20 -20 -20 -10  20 20 0 0 0 0 20 20  20 30 10 0 0 10 30 20`)];
// In the endgame the king comes out to the middle
const KING_LATE = T(`
  -50 -40 -30 -20 -20 -30 -40 -50  -30 -20 -10 0 0 -10 -20 -30  -30 -10 20 30 30 20 -10 -30  -30 -10 30 40 40 30 -10 -30
  -30 -10 30 40 40 30 -10 -30  -30 -10 20 30 30 20 -10 -30  -30 -30 0 0 0 0 -30 -30  -50 -30 -30 -30 -30 -30 -30 -50`);

// The position's score for the side to move, in hundredths of a pawn
export function evaluate(g: Chess) {
  let score = 0, heavy = 0;
  const kings: number[] = [];
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = g.board[s];
    if (!p) continue;
    const t = typeOf(p), white = colorOf(p) === 'w';
    if (t === KING) { kings.push(s); continue; }
    if (t !== PAWN) heavy += VALUE[t];
    const i = (white ? 7 - rankOf(s) : rankOf(s)) * 8 + fileOf(s);
    score += (white ? 1 : -1) * (VALUE[t] + TABLE[t][i]);
  }
  for (const s of kings) {
    const white = colorOf(g.board[s]) === 'w', i = (white ? 7 - rankOf(s) : rankOf(s)) * 8 + fileOf(s);
    score += (white ? 1 : -1) * (heavy <= 1300 ? KING_LATE : TABLE[KING])[i];
  }
  return g.turn === 'w' ? score : -score;
}

// Would the computer (playing `c`) take a draw? Only when it's clearly worse.
export const wantsDraw = (g: Chess, c: Color) => (g.turn === c ? 1 : -1) * evaluate(g) < -150;

// Captures first, the most valuable victim by the least valuable attacker (MVV-LVA), then promotions
const order = (moves: Move[]) => moves.sort((a, b) => rank(b) - rank(a));
const rank = (m: Move) => (m.captured ? VALUE[typeOf(m.captured)] * 10 - VALUE[typeOf(m.piece)] / 10 : 0) + VALUE[m.promo];

export class Thinker {
  private g: Chess;
  private level: (typeof LEVELS)[number];
  private run: Generator<void, Move | null>;
  private sliceEnd = 0;
  private deadline: number;
  private nodes = 0;
  private depth = 0;
  private stop = false;
  move: Move | null = null; // decided
  done = false;

  constructor(game: Chess, level: number) {
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
    if (Math.random() < L.blunder) return moves[Math.floor(Math.random() * moves.length)];
    const noise = new Map(moves.map((m) => [m, (Math.random() - 0.5) * 2 * L.noise])); // (variety, and mistakes on Easy)
    let best = moves[0];
    for (this.depth = 1; this.depth <= L.depth; this.depth++) {
      let alpha = -Infinity, found: Move | null = null;
      for (const m of moves) {
        g.make(m);
        // (with noise, a slightly worse move can still come out best: so search a little wider)
        const score = -(yield* this.search(this.depth - 1, -Infinity, -alpha + 2 * L.noise, 1)) + noise.get(m)!;
        g.undo();
        if (this.stop) break;
        if (score > alpha) { alpha = score; found = m; }
      }
      if (this.stop || !found) break; // (out of time: keep the last full search's choice)
      best = found;
      moves.splice(moves.indexOf(best), 1);
      moves.unshift(best); // (searched first next time: it makes the cut-offs work)
      if (alpha > MATE / 2) break; // (a mate found: no need to look further)
    }
    return best;
  }

  private *search(depth: number, alpha: number, beta: number, ply: number): Generator<void, number> {
    if (++this.nodes % 256 === 0) {
      if (this.depth > 1 && performance.now() > this.deadline) this.stop = true;
      if (performance.now() > this.sliceEnd) yield; // (back to the frame; carry on next time)
    }
    if (this.stop) return 0;
    if (depth <= 0) return this.level.quiesce ? this.quiesce(alpha, beta, 0) : evaluate(this.g);
    const moves = order(this.g.moves());
    if (!moves.length) return this.g.inCheck() ? -MATE + ply : 0;
    for (const m of moves) {
      this.g.make(m);
      const score = -(yield* this.search(depth - 1, -beta, -alpha, ply + 1));
      this.g.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // At the end of the search, play out the captures, so it doesn't stop halfway through an exchange
  private quiesce(alpha: number, beta: number, ply: number): number {
    this.nodes++;
    const stand = evaluate(this.g);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (ply >= 6) return alpha;
    for (const m of order(this.g.moves(true))) {
      this.g.make(m);
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.g.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}
