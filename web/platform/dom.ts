import { SYMBOL, type Button } from './pad.ts';

// An element by id. Pages are static html, so a missing one is a bug: fail loudly.
export function $<E extends HTMLElement = HTMLElement>(id: string): E {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as E;
}

export function escapeHtml(s: unknown) {
  return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// The key, as KeyboardEvent.code names it ('ArrowDown', 'Enter', 'KeyP'). Some browsers leave `code`
// empty: Android TV's WebView does for the remote's d-pad and OK. Then it's worked out from `key`.
// Read keys with this, not e.code.
export function keyCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key;
  if (k === ' ') return 'Space';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k; // ArrowUp, Enter, Escape, Backspace, Tab... are the same in both
}

// Markup for the brand components in /brand/brand.css, so every page draws them the same way.

// A pad button drawn small, in its colour: glyph('cross') is a blue ✕. 'dpad' and 'stick' for steering.
const GLYPH_TEXT = { ...SYMBOL, dpad: '✥', stick: 'STICK' };
export const glyph = (btn: Button | 'dpad' | 'stick') => `<span class="glyph glyph-${btn}">${GLYPH_TEXT[btn]}</span>`;

// A keyboard key, for help text: key('Enter')
export const key = (name: string) => `<span class="glyph glyph-key">${escapeHtml(name)}</span>`;

// A player: their colour, P1, their name
export const chip = (p: { tag: string; color: string; label: string }) =>
  `<span class="chip" style="--pc:${p.color}"><b>${p.tag}</b>${escapeHtml(p.label)}</span>`;
