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

// Markup for the brand components in /brand/brand.css, so every page draws them the same way.

// A pad button drawn small, in its colour: glyph('cross') is a blue ✕. 'dpad' and 'stick' for steering.
const GLYPH_TEXT = { ...SYMBOL, dpad: '✥', stick: 'STICK' };
export const glyph = (btn: Button | 'dpad' | 'stick') => `<span class="glyph glyph-${btn}">${GLYPH_TEXT[btn]}</span>`;

// A keyboard key, for help text: key('Enter')
export const key = (name: string) => `<span class="glyph glyph-key">${escapeHtml(name)}</span>`;

// A player: their colour, P1, their name
export const chip = (p: { tag: string; color: string; label: string }) =>
  `<span class="chip" style="--pc:${p.color}"><b>${p.tag}</b>${escapeHtml(p.label)}</span>`;
