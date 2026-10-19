// The phone pad every game shares: a stick and six buttons in the PlayStation layout.
// Games don't change the pad; they decide what each button does (see controls.ts) and
// label the ones they use. Unlabelled buttons are dimmed on the phone.

export const BUTTONS = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1'] as const;
export type Button = (typeof BUTTONS)[number];

// Bits of PadInput.b. `sprint`: the stick is pushed past its ring. `swipe`: the finger slid
// across a face button while holding it (a second action on the same button).
export const BIT = { cross: 1, circle: 2, square: 4, triangle: 8, sprint: 16, l1: 32, r1: 64, swipe: 128 } as const;
export type Bit = (typeof BIT)[keyof typeof BIT];
export const ALL_BITS = Object.values(BIT);
export const FACE_BITS = BIT.cross | BIT.circle | BIT.square | BIT.triangle;

export const SYMBOL: Record<Button, string> = { cross: '✕', circle: '○', square: '□', triangle: '△', l1: 'L1', r1: 'R1' };

export const buttonOf = (bit: number): Button | undefined => BUTTONS.find((b) => BIT[b] === bit);

// Player colours by slot. Slots come from the server, so P1 is the same colour in every game.
const COLORS = ['#38bdf8', '#f43f5e', '#facc15', '#a3e635', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];
export const playerColor = (slot: number) => COLORS[slot % COLORS.length];
