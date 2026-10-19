// The phone pad every game shares: four face buttons in a diamond (Bolt at the bottom, Drop right,
// Leaf left, Star top: Beacon Arcade's own icons, see icons.ts), two shoulder buttons, and a way to steer.
// Games don't build their own pad; they pick a layout for each screen (PadScreen.layout), decide
// what each button does (see controls.ts) and label the ones they use. Unlabelled buttons are dimmed.
//
//   'dpad'    four arrow buttons: one tap, one step. Menus, the game select page, grid games.
//   'stick'   a floating analog stick (past its ring = sprint). Running about: football, brawlers.
//   'racing'  slide to steer (analog, springs back), throttle and brake pedals, small extra buttons.
//
// Every layout sends the same thing (PadInput): the stick or steering as x/y, buttons as bits.
export type PadLayout = 'dpad' | 'stick' | 'racing';

export const BUTTONS = ['bolt', 'drop', 'leaf', 'star', 'l1', 'r1'] as const;
export type Button = (typeof BUTTONS)[number];

// Bits of PadInput.b. `sprint`: the stick is pushed past its ring. `swipe`: the finger slid
// across a face button while holding it (a second action on the same button). up/down/left/right:
// the d-pad (in the racing layout, the pedals are bolt = throttle and drop = brake).
export const BIT = {
  bolt: 1, drop: 2, leaf: 4, star: 8, sprint: 16, l1: 32, r1: 64, swipe: 128,
  up: 256, down: 512, left: 1024, right: 2048,
} as const;
export type Bit = (typeof BIT)[keyof typeof BIT];
export const ALL_BITS = Object.values(BIT);
export const FACE_BITS = BIT.bolt | BIT.drop | BIT.leaf | BIT.star;
export const DPAD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const; // (screen directions)

// What to call each button, for players ("press Bolt")
export const BUTTON_NAME: Record<Button, string> = { bolt: 'Bolt', drop: 'Drop', leaf: 'Leaf', star: 'Star', l1: 'L1', r1: 'R1' };

export const buttonOf = (bit: number): Button | undefined => BUTTONS.find((b) => BIT[b] === bit);

// Player colours by slot. Slots come from the server, so P1 is the same colour in every game.
// From the brand (brand/README.md): the pad colours first, then four more that stay distinct on a TV.
const COLORS = ['#4c8dff', '#ff4d5a', '#ffc23d', '#2ee59d', '#a97bff', '#ff8a3d', '#ff5ecf', '#3fd7e8'];
export const playerColor = (slot: number) => COLORS[slot % COLORS.length];
