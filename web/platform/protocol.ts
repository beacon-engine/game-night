// Messages on the /ws socket between pads (phones), the server and the display (the page on
// the TV). The Go server relays them (internal/server/relay.go): keep the two in sync.
import type { Button, PadLayout } from './pad.ts';

// Stick in [-1, 1] (y up = +1) and the held buttons as a bit mask (see BIT in pad.ts)
export interface PadInput {
  x: number;
  y: number;
  b: number;
}

// What a phone shows. The game sends one per player whenever it changes.
export interface PadScreen {
  layout?: PadLayout; // how the phone lets you steer on this screen (default 'stick'); see pad.ts
  label: string; // 'P1'
  color: string; // the player's colour
  title: string; // top bar, e.g. the club you're playing for
  accent: string; // top bar colour
  hint: string; // one line under the bar
  labels: Partial<Record<Button, string>>; // what each button does now; unlabelled ones are dimmed
  charge?: number; // 0..1: a power bar above the buttons, hidden when absent
}

export type PadToServer =
  | { t: 'hello'; role: 'pad'; id: string | null; name: string }
  | ({ t: 'in' } & PadInput)
  | { t: 'pause' }
  | { t: 'name'; name: string };

// What the display sends to one pad (the server forwards it to `to`)
export type DisplayToPad = ({ t: 'screen' } & PadScreen) | { t: 'buzz'; ms: number };

export type DisplayToServer = { t: 'hello'; role: 'display' } | (DisplayToPad & { to: string });

export type ServerToPad =
  | { t: 'welcome'; id: string; slot: number; display: boolean }
  | { t: 'display'; on: boolean }
  | DisplayToPad;

// Pad messages reach the display tagged with the pad's id. A pad keeps its slot (P1, P2...)
// across games and reconnects.
export type ServerToDisplay =
  | { t: 'join'; id: string; name: string; slot: number }
  | { t: 'leave'; id: string }
  | ({ t: 'in'; id: string } & PadInput)
  | { t: 'pause'; id: string }
  | { t: 'name'; id: string; name: string };

// Close code for a display that another screen took over: it should stay closed, not reconnect
export const CLOSE_REPLACED = 4000;

export const socketUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
