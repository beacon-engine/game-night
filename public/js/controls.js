// Button -> action mapping, loaded from /data/controls/<game>.json. Every game uses the same
// pad; the json says which button does which action in each situation ("context"), so the
// layout can be changed without touching code.
import { BUTTONS, SWIPE } from './input.js';

const NAMES = Object.fromEntries(Object.entries(BUTTONS).map(([k, v]) => [v, k]));

export class ControlMap {
  constructor(json = {}) {
    this.json = json;
    this.labelsOf = json.labels || {};
  }

  // action for a button in a context ('attack', 'defend', ...); swipe = the swipe variant
  action(ctx, bit, swipe = false) {
    const map = this.json[ctx];
    const name = NAMES[bit];
    if (!map || !name) return null;
    return (swipe && map[`${name}+swipe`]) || map[name] || null;
  }

  // does this button have a swipe variant here? (then its action waits for the release)
  hasSwipe(ctx, bit) {
    const map = this.json[ctx];
    return !!(map && map[`${NAMES[bit]}+swipe`]);
  }

  // is any button bound to this action currently held?
  held(c, ctx, action) {
    const map = this.json[ctx];
    if (!map) return false;
    for (const [key, a] of Object.entries(map)) {
      if (a !== action) continue;
      const [btn, mod] = key.split('+');
      if (c.held(BUTTONS[btn]) && (mod !== 'swipe' || c.held(SWIPE))) return true;
    }
    return false;
  }

  // labels for the pad: { cross: 'Pass', triangle: 'Through · swipe: Lofted through', ... }
  labels(ctx) {
    const map = this.json[ctx] || {};
    const out = {};
    for (const name of Object.keys(BUTTONS)) {
      const a = map[name], s = map[`${name}+swipe`];
      const la = a ? this.labelsOf[a] || a : '';
      const ls = s ? this.labelsOf[s] || s : '';
      out[name] = la && ls ? `${la} ⤴${ls.replace(la, '').trim() || ls}` : la || (ls ? `⤴${ls}` : '');
    }
    return out;
  }

  // the button(s) bound to an action, for help text: 'cross', 'triangle+swipe'
  buttonsFor(ctx, action) {
    return Object.entries(this.json[ctx] || {}).filter(([, a]) => a === action).map(([k]) => k);
  }
}

export async function loadControls(game) {
  const r = await fetch(`/data/controls/${game}.json`, { cache: 'no-store' });
  return new ControlMap(await r.json());
}
