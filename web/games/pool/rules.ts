// Pool: the 8-ball rules. Given what happened on a shot (the table's events), say whether it was a foul, who
// shoots next, whether they have the cue ball in hand, and when the frame is over. No drawing here.
//
// The house rules, close to the world standard for 8-ball, with two simplifications for a sofa: no calling
// shots (any ball you pot counts, the 8 included), and an illegal break or the 8 on the break means a fresh rack.
//   - The break: from the kitchen (behind the head string). A legal break pots a ball or drives at least four
//     object balls to a cushion; otherwise it's racked again for the other player. The table stays open after it.
//   - Open table: hit any ball but the 8 first. The first ball you pot after the break makes it your group.
//   - Then hit one of your own balls first; when they're all down, the 8.
//   - After the cue ball hits a ball, something must be potted or touch a cushion.
//   - Fouls (in-off, nothing hit, wrong ball first, no cushion) give the other player the cue ball in hand,
//     anywhere. (In-off on the break: in hand in the kitchen.)
//   - Pot the 8 before your group is cleared, or foul while potting it, and you lose the frame.
import type { SimEvent, Table } from './physics.ts';

export type Group = 'solids' | 'stripes';
export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupOf = (n: number): Group | null => (n >= 1 && n <= 7 ? 'solids' : n >= 9 ? 'stripes' : null);
export const ballsOf = (g: Group) => (g === 'solids' ? SOLIDS : STRIPES);
export const otherGroup = (g: Group): Group => (g === 'solids' ? 'stripes' : 'solids');

export type Foul = 'in-off' | 'no-hit' | 'wrong-ball' | 'no-rail' | 'illegal-break';
export const FOUL_TEXT: Record<Foul, string> = {
  'in-off': 'The cue ball went in',
  'no-hit': 'Missed every ball',
  'wrong-ball': 'Hit the wrong ball first',
  'no-rail': 'Nothing hit a cushion',
  'illegal-break': 'Not enough balls to a cushion',
};

export type InHand = 'none' | 'kitchen' | 'anywhere';

export interface Frame {
  turn: 0 | 1; // who's shooting
  breaker: 0 | 1;
  breakShot: boolean;
  groups: [Group | null, Group | null]; // null both: an open table
  inHand: InHand;
  winner: 0 | 1 | null;
  shots: [number, number];
}

export const newFrame = (breaker: 0 | 1): Frame => ({
  turn: breaker, breaker, breakShot: true, groups: [null, null], inHand: 'kitchen', winner: null, shots: [0, 0],
});

// What a shot meant, for the callouts and the next turn
export interface Verdict {
  foul: Foul | null;
  potted: number[]; // object balls that went down
  assigned: Group | null; // the shooter's group, if this shot decided it
  keepTurn: boolean;
  rerack: 'same' | 'other' | null; // start the frame again; who breaks
  winner: 0 | 1 | null;
  why: string; // how the frame ended, or the reason for a re-rack
}

// The balls a player may hit first right now (and, with all their group down, that's the 8)
export function targets(f: Frame, t: Table, who = f.turn): number[] {
  const g = f.groups[who];
  if (!g) return [...SOLIDS, ...STRIPES].filter((n) => t.onTable(n));
  const left = ballsOf(g).filter((n) => t.onTable(n));
  return left.length ? left : [8];
}
export const onTheEight = (f: Frame, t: Table, who = f.turn) => !!f.groups[who] && targets(f, t, who)[0] === 8;

// Judge a finished shot. `t` is the table after it; `before`: was the shooter on the 8 when they shot.
export function judge(f: Frame, t: Table, events: SimEvent[], wasOnEight: boolean, legalFirst: number[]): Verdict {
  const me = f.turn, them = (1 - me) as 0 | 1;
  const pots = events.filter((e) => e.t === 'pot').map((e) => e.a);
  const potted = pots.filter((n) => n !== 0);
  const inOff = pots.includes(0);
  const eight = potted.includes(8);
  const first = events.find((e): e is Extract<SimEvent, { t: 'hit' }> => e.t === 'hit' && (e.a === 0 || e.b === 0));
  const firstBall = first ? (first.a === 0 ? first.b : first.a) : -1;
  const v: Verdict = { foul: null, potted, assigned: null, keepTurn: false, rerack: null, winner: null, why: '' };

  if (f.breakShot) {
    const railBalls = new Set(events.filter((e) => e.t === 'rail' && e.a !== 0).map((e) => e.a)).size;
    if (eight) return { ...v, rerack: inOff ? 'other' : 'same', why: 'The 8 went in on the break' };
    if (!potted.length && railBalls < 4) return { ...v, foul: 'illegal-break', rerack: 'other', why: 'Not enough balls to a cushion' };
    if (inOff) return { ...v, foul: 'in-off' };
    return { ...v, keepTurn: potted.length > 0 };
  }

  // the foul, if any (an in-off is the one players need to hear about most)
  if (inOff) v.foul = 'in-off';
  else if (!first) v.foul = 'no-hit';
  else if (!legalFirst.includes(firstBall)) v.foul = 'wrong-ball';
  else if (!potted.length && !events.some((e) => e.t === 'rail' && e.time >= first.time)) v.foul = 'no-rail';

  if (eight) {
    v.winner = wasOnEight && !v.foul ? me : them;
    v.why = !wasOnEight ? 'The 8 went in too early' : v.foul === 'in-off' ? 'The cue ball followed the 8 in' : v.foul ? 'A foul on the 8' : 'Potted the 8';
    return v;
  }
  if (v.foul) return v;
  const mine = f.groups[me];
  if (!mine) {
    // open table: the first ball down makes it your group
    const firstDown = potted.find((n) => groupOf(n));
    if (firstDown) { v.assigned = groupOf(firstDown); v.keepTurn = true; }
  } else v.keepTurn = potted.some((n) => groupOf(n) === mine);
  return v;
}

// Move the frame on after a verdict (not for a re-rack or the end: the game handles those)
export function advance(f: Frame, v: Verdict) {
  const me = f.turn;
  f.shots[me]++;
  if (v.assigned) {
    f.groups[me] = v.assigned;
    f.groups[1 - me] = otherGroup(v.assigned);
  }
  const wasBreak = f.breakShot;
  f.breakShot = false;
  if (v.winner !== null) { f.winner = v.winner; return; }
  if (v.keepTurn && !v.foul) { f.inHand = 'none'; return; }
  f.turn = (1 - me) as 0 | 1;
  f.inHand = v.foul ? (wasBreak ? 'kitchen' : 'anywhere') : 'none';
}
