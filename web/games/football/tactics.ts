// Team shapes (formations.json) and team instructions. The instructions are small nudges to how the
// computer players stand (Match.shapeTarget) and decide (Match.aiCarrier), so a match stays fun:
// no setting turns a side into a wall or a rabble.
import type { FormationSlot, Formations, Shape } from './types.ts';

export const TACTICS = {
  style: { label: 'With the ball', options: { possession: 'Keep the ball', balanced: 'Mix it up', direct: 'Get it forward', counter: 'Hit on the break' } },
  line: { label: 'Back line', options: { deep: 'Sit deep', normal: 'Normal', high: 'Push up' } },
  press: { label: 'Closing down', options: { low: 'Stand off', normal: 'Normal', high: 'Hunt the ball' } },
  width: { label: 'Width', options: { narrow: 'Stay narrow', normal: 'Normal', wide: 'Stretch wide' } },
} as const;

export type Tactic = keyof typeof TACTICS;
export type Tactics = { -readonly [K in Tactic]: keyof (typeof TACTICS)[K]['options'] };
export const TACTIC_KEYS = Object.keys(TACTICS) as Tactic[];
export const DEFAULT_TACTICS: Tactics = { style: 'balanced', line: 'normal', press: 'normal', width: 'normal' };

const optionsOf = (k: Tactic) => Object.keys(TACTICS[k].options) as Tactics[Tactic][];
export const tacticName = (k: Tactic, t: Tactics) => (TACTICS[k].options as Record<string, string>)[t[k]];

// Only known values survive (a save from an older version, or a hand-edited one)
export function cleanTactics(raw: unknown): Tactics {
  const t = { ...DEFAULT_TACTICS };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const k of TACTIC_KEYS) if (optionsOf(k).includes(r[k] as never)) (t as Record<Tactic, unknown>)[k] = r[k];
  return t;
}

export function cycleTactic(t: Tactics, k: Tactic, d: number): Tactics {
  const opts = optionsOf(k);
  return { ...t, [k]: opts[(opts.indexOf(t[k]) + d + opts.length) % opts.length] };
}

// The numbers behind the instructions. Shifts are shares of the pitch length.
export interface Tune {
  line: number; // the whole block steps up (+) or drops off (-)
  defCap: number; // furthest up the pitch the back line ever goes
  holdUp: number; // out of possession, forwards stay this much higher (ready to break)
  compact: number; // out of possession: squeezes the gaps between the lines (<1 = tighter)
  support: number; // in possession: lines spread out (+) and men push on, or stay close (-)
  push: number; // how far beyond the ball forwards run when we have it
  width: number; // how far apart the players stand across the pitch
  pressRange: number; // nearest man goes to the ball only within this share of the pitch (or in our half)...
  pressAlways: boolean; // ...unless he always does
  pressPair: boolean; // a second man joins the press when the ball is in their half
  tackle: number; // how keen to go in
  goalKickPress: number; // chance of pushing up on their goal kicks
  forwardPass: number; // chance per decision of a forward pass when one is on...
  forwardMargin: number; // ...and how safe it has to be
  safePass: number; // chance per decision of a simple pass to keep it moving
  goalKickLong: number; // chance our keeper just kicks it long
  shootRange: number; // furthest (m) they'll try a shot from
  shootKeen: number; // how readily they shoot once in range
  breakT: number; // seconds after winning the ball that the team runs forward together
}

const STYLE = {
  possession: { support: -0.04, push: 0.02, forwardPass: 0.07, forwardMargin: 0.4, safePass: 0.34, goalKickLong: 0.05, shootRange: 22, shootKeen: 0.8, holdUp: 0, line: 0, breakT: 0 },
  balanced: { support: 0, push: 0.04, forwardPass: 0.12, forwardMargin: 0.3, safePass: 0.22, goalKickLong: 0.2, shootRange: 26, shootKeen: 1, holdUp: 0, line: 0, breakT: 0 },
  direct: { support: 0.04, push: 0.08, forwardPass: 0.24, forwardMargin: 0.2, safePass: 0.12, goalKickLong: 0.5, shootRange: 29, shootKeen: 1.25, holdUp: 0, line: 0, breakT: 0 },
  counter: { support: 0.02, push: 0.07, forwardPass: 0.16, forwardMargin: 0.25, safePass: 0.18, goalKickLong: 0.35, shootRange: 27, shootKeen: 1.1, holdUp: 0.06, line: -0.03, breakT: 5 },
};
const LINE = { deep: { line: -0.05, defCap: 0.55 }, normal: { line: 0, defCap: 0.62 }, high: { line: 0.05, defCap: 0.68 } };
const PRESS = {
  low: { pressRange: 0.1, pressAlways: false, pressPair: false, tackle: 0.8, goalKickPress: 0.15, compact: 0.9, line: -0.02 },
  normal: { pressRange: 0, pressAlways: true, pressPair: false, tackle: 1, goalKickPress: 0.4, compact: 1, line: 0 },
  high: { pressRange: 0, pressAlways: true, pressPair: true, tackle: 1.2, goalKickPress: 0.7, compact: 0.95, line: 0.02 },
};
const WIDTH = { narrow: 0.86, normal: 1, wide: 1.14 };

export function tune(t: Tactics): Tune {
  const s = STYLE[t.style], l = LINE[t.line], p = PRESS[t.press];
  return { ...s, ...p, defCap: l.defCap, line: s.line + l.line + p.line, width: WIDTH[t.width] };
}

// formations.json: per side size, either a list of named shapes, or (the older form) just one list of slots
export function shapesFor(formations: Formations, size: number): Shape[] {
  const raw = formations[String(size)] ?? formations['5'];
  if (!Array.isArray(raw) || !raw.length) return [];
  if ('slots' in raw[0]) return (raw as Shape[]).filter((f) => f.slots?.[0]?.role === 'GK');
  const slots = raw as FormationSlot[];
  const n = (r: string) => slots.filter((s) => s.role === r).length;
  return [{ name: [n('DEF'), n('MID'), n('FWD')].filter(Boolean).join('-'), slots }];
}
