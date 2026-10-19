// Keyboard stand-ins for the phone pad (handy for testing, or two players on one laptop).
// Each layout is one pad. Values are KeyboardEvent.code names.
import type { Button } from './pad.ts';

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'sprint' | Button | `${Button}+swipe`;
export type Keymap = Partial<Record<KeyAction, string>>;

export const DEFAULT_KEYMAPS: Keymap[] = [
  {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft',
    bolt: 'KeyF', drop: 'KeyH', leaf: 'KeyG', star: 'KeyT', 'star+swipe': 'KeyY', l1: 'KeyQ', r1: 'KeyE',
  },
  {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', sprint: 'ShiftRight',
    bolt: 'Comma', drop: 'Slash', leaf: 'Period', star: 'Semicolon', 'star+swipe': 'Quote', l1: 'KeyK', r1: 'KeyL',
  },
];
