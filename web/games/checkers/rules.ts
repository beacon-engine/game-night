// The rules of checkers (English draughts), with no drawing: the board, legal moves (captures are
// compulsory, a jump goes on while it can, a man crowned mid-jump stops there), the end of the game,
// the draws, and each move's name as players write it (11-15, 22x15, 15x24x31).
// Only the 32 dark squares are used, numbered the standard way: 1-4 along the top of the diagram
// (Black's back row), 29-32 along the bottom (White's). Here a square is that number less one.

export type Color = 'b' | 'w';
export const MAN = 1, KING = 2, BLACK = 4, WHITE = 8;
// A piece is MAN or KING | its colour; 0 is an empty square
export const isKing = (p: number) => (p & KING) !== 0;
export const colorOf = (p: number): Color => (p & BLACK ? 'b' : 'w');
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const colorBit = (c: Color) => (c === 'w' ? WHITE : BLACK);

// Rows count down from the top of the diagram (Black's side, row 0); columns from the left (0-7).
// The dark squares are where row + column is odd.
export const rowOf = (s: number) => s >> 2;
export const colOf = (s: number) => ((s >> 2) & 1 ? 0 : 1) + 2 * (s & 3);
export const squareAt = (col: number, row: number) =>
  col < 0 || col > 7 || row < 0 || row > 7 || (col + row) % 2 === 0 ? -1 : row * 4 + (col >> 1);
export const squareName = (s: number) => String(s + 1);

// The four diagonal steps from each square, and the jumps (two steps). -1: off the board.
// Directions 0 and 1 go up the diagram (White's way forward), 2 and 3 down it (Black's).
const DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const STEP: number[][] = [], JUMP: number[][] = [];
for (let s = 0; s < 32; s++) {
  STEP.push(DIRS.map(([dc, dr]) => squareAt(colOf(s) + dc, rowOf(s) + dr)));
  JUMP.push(DIRS.map(([dc, dr]) => squareAt(colOf(s) + 2 * dc, rowOf(s) + 2 * dr)));
}
const FORWARD: Record<Color, number[]> = { w: [0, 1], b: [2, 3] };
const ALL = [0, 1, 2, 3];
const CROWN_ROW: Record<Color, number> = { w: 0, b: 7 };

export interface Move {
  from: number;
  path: number[]; // the squares it lands on, in order: one for a step, one per hop for a jump
  taken: number[]; // the squares of the pieces it jumps
  captured: number[]; // those pieces
  piece: number;
  crown: boolean; // a man reaching the far row
}
export const destOf = (m: Move) => m.path[m.path.length - 1];
export const sameMove = (a: Move, b: Move) => a.from === b.from && a.path.join() === b.path.join();

// How a game ended. winner null = a draw.
export interface Ending {
  why: 'noPieces' | 'noMoves' | 'forty' | 'repetition';
  winner: Color | null;
}

interface Undo { move: Move; quiet: number }

// Forty moves each (eighty turns) with no capture and no man moved is a draw
export const QUIET_LIMIT = 80;

// The usual way to write a position (as in PDN files): who's to move, then each side's squares, K for a king
export const START = 'B:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,11,12';

// Random numbers for each piece on each square, so a position has a quick key (for the computer's memory)
const KEYS = Array.from({ length: 32 * 16 }, () => (Math.random() * 2 ** 32) | 0);
const TURN_KEY = (Math.random() * 2 ** 32) | 0;

export class Draughts {
  board = new Uint8Array(32);
  turn: Color = 'b';
  quiet = 0; // turns since the last capture or man moved (the forty-move rule)
  hash = 0; // a key for the position (pieces and turn), kept up to date as moves are made
  readonly history: string[] = []; // the moves played, as written
  private undos: Undo[] = [];
  private seen = new Map<string, number>(); // how often each position has come up (played moves only)

  constructor(fen = START) {
    this.load(fen);
  }

  load(fen: string) {
    this.board.fill(0);
    const [turn, ...sides] = fen.trim().replace(/\.$/, '').split(':');
    this.turn = turn.trim().toUpperCase() === 'W' ? 'w' : 'b';
    for (const part of sides) {
      const side = part.trim()[0].toUpperCase() === 'W' ? WHITE : BLACK;
      for (const item of part.trim().slice(1).split(',')) {
        const t = item.trim();
        if (!t) continue;
        const king = t[0].toUpperCase() === 'K', n = Number(king ? t.slice(1) : t);
        if (n >= 1 && n <= 32) this.board[n - 1] = side | (king ? KING : MAN);
      }
    }
    this.quiet = 0;
    this.history.length = 0;
    this.undos = [];
    this.seen.clear();
    this.hash = this.turn === 'w' ? TURN_KEY : 0;
    for (let s = 0; s < 32; s++) if (this.board[s]) this.hash ^= KEYS[s * 16 + this.board[s]];
    this.remember();
  }

  fen() {
    const list = (bit: number) => [...this.board.keys()].filter((s) => this.board[s] & bit)
      .map((s) => (isKing(this.board[s]) ? 'K' : '') + (s + 1)).join(',');
    return `${this.turn.toUpperCase()}:W${list(WHITE)}:B${list(BLACK)}`;
  }

  clone() {
    const g = new Draughts(this.fen());
    g.quiet = this.quiet;
    return g;
  }

  count(c: Color) {
    let men = 0, kings = 0;
    for (const p of this.board) if (p & colorBit(c)) { if (isKing(p)) kings++; else men++; }
    return { men, kings };
  }

  // Every legal move for the side to move: if any piece can take, only the captures (complete jumps)
  moves(): Move[] {
    const caps = this.captures();
    return caps.length ? caps : this.steps();
  }

  // Can the side to move take something? (Then it must.)
  canCapture() {
    const b = this.board, me = colorBit(this.turn);
    for (let s = 0; s < 32; s++) {
      const p = b[s];
      if (!(p & me)) continue;
      for (const d of isKing(p) ? ALL : FORWARD[this.turn]) {
        const over = STEP[s][d], to = JUMP[s][d];
        if (to >= 0 && !b[to] && b[over] && !(b[over] & me)) return true;
      }
    }
    return false;
  }

  // Every complete jump: each hop over an enemy piece onto an empty square, going on for as long as it can.
  // Pieces jumped stay on the board until the move is over (they can't be jumped twice), and the
  // jumping piece is lifted off its first square (so a king can come back through it).
  captures(): Move[] {
    const out: Move[] = [], b = this.board, us = this.turn, me = colorBit(us);
    const hop = (from: number, at: number, piece: number, path: number[], taken: number[]) => {
      let more = false;
      for (const d of isKing(piece) ? ALL : FORWARD[us]) {
        const over = STEP[at][d], to = JUMP[at][d];
        if (to < 0 || b[to] || !b[over] || b[over] & me || taken.includes(over)) continue;
        more = true;
        path.push(to);
        taken.push(over);
        // a man that reaches the far row is crowned, and the move ends there
        if (!isKing(piece) && rowOf(to) === CROWN_ROW[us]) record(from, piece, path, taken, true);
        else hop(from, to, piece, path, taken);
        path.pop();
        taken.pop();
      }
      if (!more && path.length) record(from, piece, path, taken, false);
    };
    const record = (from: number, piece: number, path: number[], taken: number[], crown: boolean) =>
      out.push({ from, path: [...path], taken: [...taken], captured: taken.map((s) => b[s]), piece, crown });
    for (let s = 0; s < 32; s++) {
      const p = b[s];
      if (!(p & me)) continue;
      b[s] = 0;
      hop(s, s, p, [], []);
      b[s] = p;
    }
    return out;
  }

  // The plain moves: one step diagonally forwards (a king: any way) onto an empty square
  private steps(): Move[] {
    const out: Move[] = [], b = this.board, us = this.turn, me = colorBit(us);
    for (let s = 0; s < 32; s++) {
      const p = b[s];
      if (!(p & me)) continue;
      for (const d of isKing(p) ? ALL : FORWARD[us]) {
        const to = STEP[s][d];
        if (to < 0 || b[to]) continue;
        out.push({ from: s, path: [to], taken: [], captured: [], piece: p, crown: !isKing(p) && rowOf(to) === CROWN_ROW[us] });
      }
    }
    return out;
  }

  make(m: Move) {
    const b = this.board, to = destOf(m), now = m.crown ? (m.piece & (BLACK | WHITE)) | KING : m.piece;
    this.undos.push({ move: m, quiet: this.quiet });
    b[m.from] = 0;
    this.hash ^= KEYS[m.from * 16 + m.piece];
    for (let i = 0; i < m.taken.length; i++) { b[m.taken[i]] = 0; this.hash ^= KEYS[m.taken[i] * 16 + m.captured[i]]; }
    b[to] = now;
    this.hash ^= KEYS[to * 16 + now] ^ TURN_KEY;
    this.quiet = m.taken.length || !isKing(m.piece) ? 0 : this.quiet + 1;
    this.turn = other(this.turn);
  }

  undo() {
    const u = this.undos.pop();
    if (!u) return;
    const b = this.board, m = u.move, to = destOf(m);
    this.hash ^= KEYS[to * 16 + b[to]] ^ TURN_KEY;
    b[to] = 0;
    for (let i = 0; i < m.taken.length; i++) { b[m.taken[i]] = m.captured[i]; this.hash ^= KEYS[m.taken[i] * 16 + m.captured[i]]; }
    b[m.from] = m.piece;
    this.hash ^= KEYS[m.from * 16 + m.piece];
    this.quiet = u.quiet;
    this.turn = other(this.turn);
  }

  // A move as written: from-to for a step, from x each landing square for a jump (9x18x27)
  name(m: Move) {
    return m.taken.length ? [m.from, ...m.path].map(squareName).join('x') : `${squareName(m.from)}-${squareName(destOf(m))}`;
  }

  // Make a move in the game itself (not the computer's search): named, and counted for repetition
  play(m: Move) {
    const name = this.name(m);
    this.make(m);
    this.history.push(name);
    this.remember();
    return name;
  }

  // Has the game ended? (for the side to move)
  ending(): Ending | null {
    const { men, kings } = this.count(this.turn);
    if (!men && !kings) return { why: 'noPieces', winner: other(this.turn) };
    if (!this.moves().length) return { why: 'noMoves', winner: other(this.turn) };
    if (this.quiet >= QUIET_LIMIT) return { why: 'forty', winner: null };
    if ((this.seen.get(this.key()) ?? 0) >= 3) return { why: 'repetition', winner: null };
    return null;
  }

  private key() {
    return `${this.board.join(',')}|${this.turn}`;
  }

  private remember() {
    const k = this.key();
    this.seen.set(k, (this.seen.get(k) ?? 0) + 1);
  }
}
