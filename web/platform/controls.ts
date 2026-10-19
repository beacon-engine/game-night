// What each pad button does in a game, from the game's controls.json. The pad is the same for
// every game; a game names its situations ("contexts", e.g. attack / defend) and its actions,
// and the json binds buttons to actions per context, so players can remap without code:
//
//   { "attack": { "cross": "pass", "triangle+swipe": "loftedThroughBall" },
//     "labels": { "pass": "Pass" } }
//
// `<button>+swipe` is a swipe across that button on the phone (a second action on it).
import type { Controller } from './input.ts';
import { BIT, BUTTONS, buttonOf, type Button } from './pad.ts';

export type Binding = Button | `${Button}+swipe`;
type Bindings<A extends string> = Partial<Record<Binding, A>>;

export class Controls<C extends string, A extends string> {
  constructor(
    private map: Record<C, Bindings<A>>,
    private names: Partial<Record<A, string>> = {},
  ) {}

  // The action a button triggers in a context; `swipe` picks its swipe variant
  action(ctx: C, bit: number, swipe = false): A | null {
    const btn = buttonOf(bit);
    if (!btn) return null;
    const m = this.map[ctx];
    return (swipe && m[`${btn}+swipe`]) || m[btn] || null;
  }

  // Does this button have a swipe variant here? (then its action waits for the release)
  hasSwipe(ctx: C, bit: number) {
    const btn = buttonOf(bit);
    return !!btn && !!this.map[ctx][`${btn}+swipe`];
  }

  // Is a button bound to this action held down right now?
  held(c: Controller, ctx: C, action: A) {
    return this.bindings(ctx).some(([key, a]) => {
      if (a !== action) return false;
      const [btn, mod] = key.split('+') as [Button, string?];
      return c.held(BIT[btn]) && (mod !== 'swipe' || c.held(BIT.swipe));
    });
  }

  name(action: A) {
    return this.names[action] ?? action;
  }

  // What each button says on the phone: 'Through ⤴Lofted' for a button with a swipe variant
  labels(ctx: C): Partial<Record<Button, string>> {
    const m = this.map[ctx];
    const out: Partial<Record<Button, string>> = {};
    for (const btn of BUTTONS) {
      const a = m[btn], s = m[`${btn}+swipe`];
      const la = a ? this.name(a) : '', ls = s ? this.name(s) : '';
      const label = la && ls ? `${la} ⤴${ls.replace(la, '').trim() || ls}` : la || (ls ? `⤴${ls}` : '');
      if (label) out[btn] = label;
    }
    return out;
  }

  bindings(ctx: C) {
    return Object.entries(this.map[ctx]) as [Binding, A][];
  }
}

// Load a game's controls.json (next to its index.html). Unknown contexts, buttons or actions
// are reported in the console and skipped, so a typo can't break the game.
export async function loadControls<const C extends string, const A extends string>(
  contexts: readonly C[],
  actions: readonly A[],
  url = 'controls.json',
): Promise<Controls<C, A>> {
  const json = (await fetch(url, { cache: 'no-store' }).then((r) => r.json())) as Record<string, unknown>;
  const warn = (msg: string) => console.warn(`[controls] ${url}: ${msg}`);
  const isAction = (a: unknown): a is A => actions.includes(a as A);
  const isBinding = (k: string): k is Binding => {
    const [btn, mod, ...rest] = k.split('+');
    return BUTTONS.includes(btn as Button) && (mod === undefined || mod === 'swipe') && !rest.length;
  };

  const map = {} as Record<C, Bindings<A>>;
  for (const ctx of contexts) {
    map[ctx] = {};
    const raw = (json[ctx] ?? {}) as Record<string, unknown>;
    for (const [key, a] of Object.entries(raw)) {
      if (!isBinding(key)) warn(`"${ctx}.${key}" is not a pad button`);
      else if (!isAction(a)) warn(`"${ctx}.${key}": unknown action "${a}"`);
      else map[ctx][key] = a;
    }
  }
  for (const key of Object.keys(json)) {
    if (!key.startsWith('_') && key !== 'labels' && !contexts.includes(key as C)) warn(`unknown context "${key}"`);
  }
  return new Controls(map, (json.labels ?? {}) as Partial<Record<A, string>>);
}
