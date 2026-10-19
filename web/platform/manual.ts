// A game's manual: "How to play", the same in every game. The words are the game's manual.json; the
// controls come from its controls.json (so they can't go out of date):
//
//   { "intro": "What it is, in a sentence or two.",
//     "inspiredBy": "Where the idea comes from (optional).",
//     "goal": "How you win.",
//     "howToPlay": ["A step.", "Another step."],
//     "steering": "Turn with the arrows (optional: how you move, which isn't a button)",
//     "tips": ["Optional."] }
//
// showManual(url, name) opens it over the page; the game select page and game lobbies offer it on △.
import { escapeHtml, glyph, keyCode } from './dom.ts';
import type { Controller } from './input.ts';
import { BIT, BUTTONS, type Button } from './pad.ts';
import type { PadScreen } from './protocol.ts';

export interface Manual {
  intro: string;
  inspiredBy?: string;
  goal: string;
  howToPlay: string[];
  steering?: string;
  tips?: string[];
}

// controls.json, as far as the manual needs it: situations, button -> action, and action names
type ControlsFile = Record<string, Record<string, string>> & { labels?: Record<string, string> };

const getJson = <T>(url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);

// gameUrl: the game's folder ('/games/neon-trails/'), or '' for the page's own folder
export async function loadManual(gameUrl = '') {
  const [manual, controls] = await Promise.all([getJson<Manual>(`${gameUrl}manual.json`), getJson<ControlsFile>(`${gameUrl}controls.json`)]);
  return manual && { manual, controls };
}

// "attack" -> "Attack", "throwIn" -> "Throw in"
const title = (ctx: string) => ctx.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c) => ` ${c.toLowerCase()}`);

function controlsHtml(c: ControlsFile | null, steering?: string) {
  const contexts = c ? Object.keys(c).filter((k) => !k.startsWith('_') && k !== 'labels') : [];
  const rows = (ctx: string) => Object.entries(c![ctx]).map(([key, action]) => {
    const [btn, mod] = key.split('+') as [Button, string?];
    if (!BUTTONS.includes(btn)) return '';
    return `<div class="m-row">${glyph(btn)}${mod ? '<span class="tag">swipe</span>' : ''}<span>${escapeHtml(c!.labels?.[action] ?? action)}</span></div>`;
  }).join('');
  return `${steering ? `<div class="m-row">${glyph('dpad')}<span>${escapeHtml(steering)}</span></div>` : ''}
    <div class="m-ctx">${contexts.map((ctx) => `<div>${contexts.length > 1 ? `<h4 class="caption">${escapeHtml(title(ctx))}</h4>` : ''}${rows(ctx)}</div>`).join('')}</div>`;
}

export function manualHtml(name: string, { manual: m, controls }: { manual: Manual; controls: ControlsFile | null }) {
  const list = (items: string[], ordered = false) =>
    `<${ordered ? 'ol' : 'ul'}>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  return `<span class="eyebrow">How to play</span>
    <h1 class="h1">${escapeHtml(name)}</h1>
    <p class="m-intro">${escapeHtml(m.intro)}${m.inspiredBy ? ` <span class="faint">${escapeHtml(m.inspiredBy)}</span>` : ''}</p>
    <div class="m-cols">
      <section><h3 class="h3">The goal</h3><p>${escapeHtml(m.goal)}</p>
        <h3 class="h3">Playing</h3>${list(m.howToPlay, true)}
        ${m.tips?.length ? `<h3 class="h3">Tips</h3>${list(m.tips)}` : ''}</section>
      <section><h3 class="h3">Controls</h3>${controlsHtml(controls, m.steering)}
        <p class="faint m-note">On a phone, the buttons also say what they do as you play.</p></section>
    </div>`;
}

const STYLE = `
  .manual { position: fixed; inset: 0; z-index: 90; overflow-y: auto; padding: 6vh 7vw; background: rgb(7 8 11 / 0.96); }
  .manual .h1 { margin: 10px 0 12px; }
  .manual .m-intro { font-size: 18px; max-width: 62ch; margin: 0 0 26px; color: var(--chalk); }
  .manual .m-cols { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 48px; }
  .manual .h3 { margin: 22px 0 8px; } .manual section > .h3:first-child { margin-top: 0; }
  .manual p, .manual li { color: var(--chalk-2); font-size: 16px; line-height: 1.55; }
  .manual ol, .manual ul { margin: 0; padding-left: 1.2em; } .manual li { margin: 4px 0; }
  .manual .m-ctx { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-top: 6px; }
  .manual .m-ctx h4 { margin: 4px 0 6px; }
  .manual .m-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; font-size: 15px; }
  .manual .m-note { font-size: 13px; margin-top: 18px; }
  .manual .close { position: fixed; right: 7vw; top: 6vh; }
  @media (max-width: 800px) { .manual .m-cols { grid-template-columns: 1fr; } }
  @media (max-height: 640px) { .manual { padding: 4vh 5vw; } .manual p, .manual li { font-size: 14px; } }`;

let open: { close: () => void } | null = null;
export const manualOpen = () => !!open;

// Open the manual over the page. Closes on ○ (the game calls closeManual), Esc, or the button.
export async function showManual(gameUrl: string, name: string) {
  if (open) return;
  const data = await loadManual(gameUrl);
  if (!data) return;
  if (!document.getElementById('manual-style')) {
    const s = document.createElement('style');
    s.id = 'manual-style';
    s.textContent = STYLE;
    document.head.append(s);
  }
  const el = document.createElement('div');
  el.className = 'manual grid-bg';
  el.innerHTML = `${manualHtml(name, data)}<button class="btn close">${glyph('circle')} Close</button>`;
  const onKey = (e: KeyboardEvent) => {
    const k = keyCode(e);
    if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); closeManual(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); scrollManual(k === 'ArrowDown' ? 1 : -1); }
  };
  addEventListener('keydown', onKey, true);
  el.querySelector('.close')!.addEventListener('click', closeManual);
  document.body.append(el);
  open = { close: () => { removeEventListener('keydown', onKey, true); el.remove(); open = null; } };
}

export function closeManual() {
  open?.close();
}

// for the d-pad: a long manual scrolls
export function scrollManual(d: number) {
  document.querySelector('.manual')?.scrollBy({ top: d * 160, behavior: 'smooth' });
}

// While the manual is open, a phone scrolls it (▲▼) and closes it (○ or △), and the game behind
// it gets nothing. Call it first in the game's input loop: true = it took this pad's input.
export function manualPadInput(c: Controller) {
  if (!open) return false;
  const fy = c.flickY();
  if (fy) scrollManual(fy);
  for (const ev of c.drain()) if (ev.down && (ev.bit === BIT.circle || ev.bit === BIT.triangle)) closeManual();
  return true;
}

// What the phones show while the manual is open
export const manualScreen = (s: Omit<PadScreen, 'labels' | 'hint' | 'layout'>): PadScreen =>
  ({ ...s, layout: 'dpad', labels: { circle: 'Close' }, hint: 'How to play: ▲▼ to scroll' });
