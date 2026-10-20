// The rules of chess, with no drawing: the board, legal moves (castling, en passant, promotion), check,
// checkmate, stalemate, the draws, and each move's name as players write it (SAN: Nf3, exd5, O-O, e8=Q+).
// The board is "0x88": square = rank * 16 + file, so a step off the board shows up as (square & 0x88).

export type Color = 'w' | 'b';
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 8, BLACK = 16;
// A piece is its type | its colour; 0 is an empty square
export const typeOf = (p: number) => p & 7;
export const colorOf = (p: number): Color => (p & BLACK ? 'b' : 'w');
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const colorBit = (c: Color) => (c === 'w' ? WHITE : BLACK);

export const sq = (file: number, rank: number) => rank * 16 + file;
export const fileOf = (s: number) => s & 7;
export const rankOf = (s: number) => s >> 4;
export const squareName = (s: number) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
export const PIECE_NAME = ['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'];
const LETTER = ' PNBRQK';

export interface Move {
  from: number;
  to: number;
  piece: number;
  captured: number; // the piece taken (0: none)
  promo: number; // the type a pawn becomes (0: not a promotion)
  flag: '' | 'double' | 'ep' | 'castle';
}

// How a game ended. winner null = a draw.
export interface Ending {
  why: 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material';
  winner: Color | null;
}

interface Undo { move: Move; castling: number; ep: number; halfmove: number }

const KNIGHT_STEPS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_STEPS = [1, -1, 16, -16, 17, 15, -17, -15];
const ROOK_DIRS = [1, -1, 16, -16];
const BISHOP_DIRS = [17, 15, -17, -15];
const PROMOTIONS = [QUEEN, ROOK, BISHOP, KNIGHT];

// Castling rights are bits (K Q k q). A move from or to a king's or rook's home square loses some for good.
const RIGHTS: Record<string, number> = { K: 1, Q: 2, k: 4, q: 8 };
const LOSES = new Uint8Array(128);
LOSES[sq(4, 0)] = 3; LOSES[sq(7, 0)] = 1; LOSES[sq(0, 0)] = 2;
LOSES[sq(4, 7)] = 12; LOSES[sq(7, 7)] = 4; LOSES[sq(0, 7)] = 8;

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Chess {
  board = new Uint8Array(128);
  turn: Color = 'w';
  castling = 0;
  ep = -1; // the square a pawn can be taken on en passant (-1: none)
  halfmove = 0; // moves since the last capture or pawn move (the fifty-move rule)
  fullmove = 1;
  kings = { w: -1, b: -1 };
  readonly history: string[] = []; // the moves played, in SAN
  private undos: Undo[] = [];
  private seen = new Map<string, number>(); // how often each position has come up (played moves only)

  constructor(fen = START) {
    this.load(fen);
  }

  load(fen: string) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    this.board.fill(0);
    placement.split('/').forEach((row, i) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { file += Number(ch); continue; }
        const type = ' pnbrqk'.indexOf(ch.toLowerCase());
        const s = sq(file++, 7 - i);
        this.board[s] = type | (ch === ch.toLowerCase() ? BLACK : WHITE);
        if (type === KING) this.kings[colorOf(this.board[s])] = s;
      }
    });
    this.turn = turn === 'b' ? 'b' : 'w';
    this.castling = [...(castling ?? '')].reduce((r, ch) => r | (RIGHTS[ch] ?? 0), 0);
    this.ep = ep && ep !== '-' ? sq(ep.charCodeAt(0) - 97, Number(ep[1]) - 1) : -1;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.history.length = 0;
    this.undos = [];
    this.seen.clear();
    this.remember();
  }

  fen() {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[sq(f, r)];
        if (!p) { empty++; continue; }
        if (empty) row += empty;
        empty = 0;
        const ch = ' pnbrqk'[typeOf(p)];
        row += p & WHITE ? ch.toUpperCase() : ch;
      }
      rows.push(row + (empty || ''));
    }
    const castling = Object.keys(RIGHTS).filter((k) => this.castling & RIGHTS[k]).join('') || '-';
    return `${rows.join('/')} ${this.turn} ${castling} ${this.ep < 0 ? '-' : squareName(this.ep)} ${this.halfmove} ${this.fullmove}`;
  }

  clone() {
    return new Chess(this.fen());
  }

  // Is square s attacked by a piece of colour `by`?
  attacked(s: number, by: Color) {
    const b = this.board, me = colorBit(by);
    const back = by === 'w' ? -16 : 16; // (a pawn attacks forwards, so look behind s for one)
    for (const d of [back - 1, back + 1]) { const t = s + d; if (!(t & 0x88) && b[t] === (me | PAWN)) return true; }
    for (const d of KNIGHT_STEPS) { const t = s + d; if (!(t & 0x88) && b[t] === (me | KNIGHT)) return true; }
    for (const d of KING_STEPS) { const t = s + d; if (!(t & 0x88) && b[t] === (me | KING)) return true; }
    const slides = (dirs: number[], piece: number) => dirs.some((d) => {
      for (let t = s + d; !(t & 0x88); t += d) if (b[t]) return b[t] === (me | piece) || b[t] === (me | QUEEN);
      return false;
    });
    return slides(ROOK_DIRS, ROOK) || slides(BISHOP_DIRS, BISHOP);
  }

  inCheck(c = this.turn) {
    return this.attacked(this.kings[c], other(c));
  }

  // Every legal move for the side to move (onlyCaptures: just the captures, for the computer's search)
  moves(onlyCaptures = false) {
    const us = this.turn;
    return this.pseudo(onlyCaptures).filter((m) => {
      this.make(m);
      const ok = !this.inCheck(us);
      this.undo();
      return ok;
    });
  }

  // Moves that follow how the pieces move, before checking they don't leave the king in check
  private pseudo(onlyCaptures: boolean): Move[] {
    const out: Move[] = [], b = this.board, us = this.turn, me = colorBit(us);
    const add = (from: number, to: number, flag: Move['flag'] = '', captured = b[to]) =>
      out.push({ from, to, piece: b[from], captured, promo: 0, flag });
    const pawnTo = (from: number, to: number) => {
      if (rankOf(to) !== (us === 'w' ? 7 : 0)) return add(from, to);
      for (const promo of PROMOTIONS) out.push({ from, to, piece: b[from], captured: b[to], promo, flag: '' });
    };

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) { from += 7; continue; }
      const p = b[from];
      if (!(p & me)) continue;
      const type = typeOf(p);
      if (type === PAWN) {
        const up = us === 'w' ? 16 : -16, one = from + up;
        if (!onlyCaptures && !b[one]) {
          pawnTo(from, one);
          if (rankOf(from) === (us === 'w' ? 1 : 6) && !b[one + up]) add(from, one + up, 'double');
        }
        for (const to of [one - 1, one + 1]) {
          if (to & 0x88) continue;
          if (b[to] && !(b[to] & me)) pawnTo(from, to);
          else if (to === this.ep) add(from, to, 'ep', (me ^ (WHITE | BLACK)) | PAWN);
        }
      } else if (type === KNIGHT || type === KING) {
        for (const d of type === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
          const to = from + d;
          if (!(to & 0x88) && !(b[to] & me) && (!onlyCaptures || b[to])) add(from, to);
        }
      } else {
        const dirs = type === ROOK ? ROOK_DIRS : type === BISHOP ? BISHOP_DIRS : KING_STEPS;
        for (const d of dirs) {
          for (let to = from + d; !(to & 0x88); to += d) {
            if (b[to] & me) break;
            if (!onlyCaptures || b[to]) add(from, to);
            if (b[to]) break;
          }
        }
      }
    }

    // Castling: rights still there, the squares between empty, and the king not in check,
    // nor crossing or landing on an attacked square
    if (!onlyCaptures && this.castling) {
      const home = us === 'w' ? 0 : 0x70, them = other(us), k = home + 4;
      const ok = (bit: number, rook: number, empty: number[], safe: number[]) =>
        this.castling & bit && b[home + rook] === (me | ROOK) && empty.every((f) => !b[home + f])
        && !this.attacked(k, them) && safe.every((f) => !this.attacked(home + f, them));
      if (ok(us === 'w' ? 1 : 4, 7, [5, 6], [5, 6])) add(k, home + 6, 'castle');
      if (ok(us === 'w' ? 2 : 8, 0, [1, 2, 3], [3, 2])) add(k, home + 2, 'castle');
    }
    return out;
  }

  make(m: Move) {
    const b = this.board, us = this.turn;
    this.undos.push({ move: m, castling: this.castling, ep: this.ep, halfmove: this.halfmove });
    b[m.to] = m.promo ? (m.piece & (WHITE | BLACK)) | m.promo : m.piece;
    b[m.from] = 0;
    if (m.flag === 'ep') b[m.to + (us === 'w' ? -16 : 16)] = 0;
    if (m.flag === 'castle') {
      const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rt] = b[rf];
      b[rf] = 0;
    }
    if (typeOf(m.piece) === KING) this.kings[us] = m.to;
    this.castling &= ~(LOSES[m.from] | LOSES[m.to]);
    this.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
    this.halfmove = typeOf(m.piece) === PAWN || m.captured ? 0 : this.halfmove + 1;
    if (us === 'b') this.fullmove++;
    this.turn = other(us);
  }

  undo() {
    const u = this.undos.pop();
    if (!u) return;
    const b = this.board, m = u.move, us = (this.turn = other(this.turn));
    b[m.from] = m.piece;
    b[m.to] = m.flag === 'ep' ? 0 : m.captured;
    if (m.flag === 'ep') b[m.to + (us === 'w' ? -16 : 16)] = m.captured;
    if (m.flag === 'castle') {
      const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rf] = b[rt];
      b[rt] = 0;
    }
    if (typeOf(m.piece) === KING) this.kings[us] = m.from;
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    if (us === 'b') this.fullmove--;
  }

  // A move's name in SAN. Call it before the move is made.
  san(m: Move, legal = this.moves()) {
    let s: string;
    const type = typeOf(m.piece), to = squareName(m.to);
    if (m.flag === 'castle') s = m.to > m.from ? 'O-O' : 'O-O-O';
    else if (type === PAWN) s = (m.captured ? 'abcdefgh'[fileOf(m.from)] + 'x' : '') + to + (m.promo ? '=' + LETTER[m.promo] : '');
    else {
      // another piece of the same kind could go there too: say which by its file, its rank, or both
      const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      const file = 'abcdefgh'[fileOf(m.from)], rank = String(rankOf(m.from) + 1);
      const which = !rivals.length ? '' : !rivals.some((o) => fileOf(o.from) === fileOf(m.from)) ? file
        : !rivals.some((o) => rankOf(o.from) === rankOf(m.from)) ? rank : file + rank;
      s = LETTER[type] + which + (m.captured ? 'x' : '') + to;
    }
    this.make(m);
    const check = this.inCheck(), mate = check && !this.moves().length;
    this.undo();
    return s + (mate ? '#' : check ? '+' : '');
  }

  // Make a move in the game itself (not the computer's search): named, and counted for repetition
  play(m: Move) {
    const san = this.san(m);
    this.make(m);
    this.history.push(san);
    this.remember();
    return san;
  }

  // Has the game ended? (for the side to move)
  ending(): Ending | null {
    if (!this.moves().length) return this.inCheck() ? { why: 'checkmate', winner: other(this.turn) } : { why: 'stalemate', winner: null };
    if (this.halfmove >= 100) return { why: 'fifty', winner: null };
    if ((this.seen.get(this.key()) ?? 0) >= 3) return { why: 'repetition', winner: null };
    if (this.dead()) return { why: 'material', winner: null };
    return null;
  }

  // Nobody can ever checkmate: bare kings, a king and one bishop or knight against a bare king,
  // or only bishops, all on squares of one colour
  private dead() {
    const minors: number[] = [];
    for (let s = 0; s < 128; s++) {
      const t = typeOf(this.board[s]);
      if (s & 0x88 || !t || t === KING) continue;
      if (t !== KNIGHT && t !== BISHOP) return false;
      minors.push(s);
    }
    const shade = (s: number) => (fileOf(s) + rankOf(s)) % 2;
    return minors.length <= 1 || (minors.every((s) => typeOf(this.board[s]) === BISHOP) && minors.every((s) => shade(s) === shade(minors[0])));
  }

  // Could this side still checkmate? (For a clock running out: if the other side can't win, it's a draw.)
  canMate(c: Color) {
    let minors = 0, theirs = 0;
    for (let s = 0; s < 128; s++) {
      const p = this.board[s], t = typeOf(p);
      if (s & 0x88 || !t || t === KING) continue;
      if (colorOf(p) !== c) theirs++;
      else if (t === KNIGHT || t === BISHOP) minors++;
      else return true;
    }
    return minors > 1 || (minors === 1 && theirs > 0); // (a lone minor piece needs the other side to box its own king in)
  }

  // The position as repetition sees it: the pieces, who's to move, castling, and en passant
  // (only when a capture there is actually possible)
  private key() {
    const ep = this.ep >= 0 && this.pseudo(true).some((m) => m.flag === 'ep') ? this.ep : -1;
    return `${this.board.join(',')}|${this.turn}${this.castling}|${ep}`;
  }

  private remember() {
    const k = this.key();
    this.seen.set(k, (this.seen.get(k) ?? 0) + 1);
  }
}
