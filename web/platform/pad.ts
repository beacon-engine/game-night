// The phone pad every game shares: six buttons in the PlayStation layout, plus a way to steer.
// Games don't build their own pad; they pick a layout for each screen (PadScreen.layout), decide
// what each button does (see controls.ts) and label the ones they use. Unlabelled buttons are dimmed.
//
//   'dpad'    four arrow buttons: one tap, one step. Menus, the game select page, grid games.
//   'stick'   a floating analog stick (past its ring = sprint). Running about: football, brawlers.
//   'racing'  slide to steer (analog, springs back), throttle and brake pedals, small extra buttons.
//
// Every layout sends the same thing (PadInput): the stick or steering as x/y, buttons as bits.
export type PadLayout = 'dpad' | 'stick' | 'racing';

export const BUTTONS = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1'] as const;
export type Button = (typeof BUTTONS)[number];

// Bits of PadInput.b. `sprint`: the stick is pushed past its ring. `swipe`: the finger slid
// across a face button while holding it (a second action on the same button). up/down/left/right:
// the d-pad (in the racing layout, the pedals are cross = throttle and circle = brake).
export const BIT = {
  cross: 1, circle: 2, square: 4, triangle: 8, sprint: 16, l1: 32, r1: 64, swipe: 128,
  up: 256, down: 512, left: 1024, right: 2048,
} as const;
export type Bit = (typeof BIT)[keyof typeof BIT];
export const ALL_BITS = Object.values(BIT);
export const FACE_BITS = BIT.cross | BIT.circle | BIT.square | BIT.triangle;
export const DPAD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const; // (screen directions)

export const SYMBOL: Record<Button, string> = { cross: '✕', circle: '○', square: '□', triangle: '△', l1: 'L1', r1: 'R1' };

export const buttonOf = (bit: number): Button | undefined => BUTTONS.find((b) => BIT[b] === bit);

// Player colours by slot. Slots come from the server, so P1 is the same colour in every game.
// From the brand (brand/README.md): the pad colours first, then four more that stay distinct on a TV.
const COLORS = ['#4c8dff', '#ff4d5a', '#ffc23d', '#2ee59d', '#a97bff', '#ff8a3d', '#ff5ecf', '#3fd7e8'];
export const playerColor = (slot: number) => COLORS[slot % COLORS.length];
