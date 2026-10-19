// Keyboard stand-ins for the phone pad (handy for testing, or two players on one laptop).
// Each layout is one pad. Values are KeyboardEvent.code names.
import type { Button } from './pad.ts';

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'sprint' | Button | `${Button}+swipe`;
export type Keymap = Partial<Record<KeyAction, string>>;

export const DEFAULT_KEYMAPS: Keymap[] = [
  {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft',
    cross: 'KeyF', circle: 'KeyH', square: 'KeyG', triangle: 'KeyT', 'triangle+swipe': 'KeyY', l1: 'KeyQ', r1: 'KeyE',
  },
  {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', sprint: 'ShiftRight',
    cross: 'Comma', circle: 'Slash', square: 'Period', triangle: 'Semicolon', 'triangle+swipe': 'Quote', l1: 'KeyK', r1: 'KeyL',
  },
];
