// Controllers: phones (over WebSocket) and two keyboard layouts for testing.
// PlayStation-style face buttons; SPRINT is set by pushing the stick past its ring
// LOFT: a swipe across triangle (on the phone) for a lofted through ball
export const BTN = { CROSS: 1, CIRCLE: 2, SQUARE: 4, TRIANGLE: 8, SPRINT: 16, L1: 32, R1: 64, LOFT: 128 };
// the button names used in the controls json files
export const BUTTONS = { cross: 1, circle: 2, square: 4, triangle: 8, l1: 32, r1: 64 };
export const SWIPE = BTN.LOFT;

export class Controller {
  constructor(id, kind, name) {
    this.id = id;
    this.kind = kind; // 'pad' | 'kb'
    this.name = name;
    this.x = 0; // stick right = +1
    this.y = 0; // stick up = +1
    this.buttons = 0;
    this.queue = [];
    this.connected = true;
    // assigned by the game
    this.team = 0;
    this.slot = 0;
    this.color = '#ffffff';
    this.player = null;
    this.charge = -1;
    this.lastSent = '';
    this.stickLatch = 0;
    this.stickLatchY = 0;
  }

  setState(x, y, b) {
    const diff = b ^ this.buttons;
    for (const bit of [1, 2, 4, 8, 16, 32, 64, 128]) if (diff & bit) this.queue.push({ bit, down: !!(b & bit) });
    this.x = Math.max(-1, Math.min(1, Number(x) || 0));
    this.y = Math.max(-1, Math.min(1, Number(y) || 0));
    this.buttons = b;
  }

  held(bit) {
    return (this.buttons & bit) !== 0;
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  // Returns -1/+1 once per flick of the stick left/right (for menus)
  flick() {
    if (Math.abs(this.x) < 0.4) this.stickLatch = 0;
    else if (!this.stickLatch && Math.abs(this.x) > 0.7) {
      this.stickLatch = Math.sign(this.x);
      return this.stickLatch;
    }
    return 0;
  }

  // -1/+1 once per flick up/down (menus): +1 = down the list
  flickY() {
    if (Math.abs(this.y) < 0.4) this.stickLatchY = 0;
    else if (!this.stickLatchY && Math.abs(this.y) > 0.7) {
      this.stickLatchY = -Math.sign(this.y);
      return this.stickLatchY;
    }
    return 0;
  }

  get label() {
    return this.name || (this.kind === 'kb' ? 'Keys' : 'Phone');
  }
}

// Keyboard layouts (for testing without phones) come from the game's controls json:
// { up, down, left, right, sprint, cross, circle, ..., 'triangle+swipe' }
const DEFAULT_KEYMAPS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', cross: 'KeyF', circle: 'KeyH', square: 'KeyG', triangle: 'KeyT', l1: 'KeyQ', r1: 'KeyE', sprint: 'ShiftLeft' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', cross: 'Comma', circle: 'Slash', square: 'Period', triangle: 'Semicolon', l1: 'KeyK', r1: 'KeyL', sprint: 'ShiftRight' },
];
const keysOf = (k) => Object.values(k);

// bits a key held down sets: a button, or a button plus the swipe flag
function bitsFor(name) {
  const [btn, mod] = name.split('+');
  if (btn === 'sprint') return BTN.SPRINT;
  const b = BUTTONS[btn] || 0;
  return b && mod === 'swipe' ? b | SWIPE : b;
}

export class Input {
  constructor() {
    this.controllers = new Map();
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onRename = () => {};
    this.onPause = () => {};
    this.keys = new Set();
    this.keymaps = DEFAULT_KEYMAPS;
    this.ws = null;
    this.connect();
    this.setupKeyboard();
  }

  get list() {
    return [...this.controllers.values()].filter((c) => c.connected);
  }

  connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'display' }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      let c = this.controllers.get(m.id);
      if (m.t === 'join') {
        if (!c) {
          c = new Controller(m.id, 'pad', m.name);
          this.controllers.set(m.id, c);
        } else {
          c.name = m.name || c.name;
        }
        c.connected = true;
        c.lastSent = '';
        this.onJoin(c);
      } else if (m.t === 'leave' && c) {
        c.connected = false;
        c.setState(0, 0, 0);
        c.queue = [];
        this.onLeave(c);
      } else if (m.t === 'in' && c) {
        c.setState(m.x, m.y, m.b | 0);
      } else if (m.t === 'pause' && c) {
        this.onPause(c);
      } else if (m.t === 'name' && c) {
        c.name = m.name;
        this.onRename(c);
      }
    };
    ws.onclose = () => setTimeout(() => this.connect(), 1000);
  }

  send(c, msg) {
    if (c.kind !== 'pad' || !this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ ...msg, to: c.id }));
  }

  setKeymaps(maps) {
    if (Array.isArray(maps) && maps.length) this.keymaps = maps;
  }

  setupKeyboard() {
    const update = (e, down) => {
      const all = new Set(this.keymaps.flatMap(keysOf));
      if (!all.has(e.code)) return;
      e.preventDefault();
      if (down) this.keys.add(e.code);
      else this.keys.delete(e.code);
      this.keymaps.forEach((km, i) => {
        if (!keysOf(km).includes(e.code)) return;
        const id = `kb${i + 1}`;
        let c = this.controllers.get(id);
        if (!c) {
          if (!down) return;
          c = new Controller(id, 'kb', `Keys ${i + 1}`);
          this.controllers.set(id, c);
          this.onJoin(c);
        }
        const k = (code) => (this.keys.has(code) ? 1 : 0);
        let x = k(km.right) - k(km.left);
        let y = k(km.up) - k(km.down);
        const d = Math.hypot(x, y);
        if (d > 1) { x /= d; y /= d; }
        let b = 0;
        for (const [name, code] of Object.entries(km)) if (this.keys.has(code)) b |= bitsFor(name);
        c.setState(x, y, b);
      });
    };
    addEventListener('keydown', (e) => !e.repeat && update(e, true));
    addEventListener('keyup', (e) => update(e, false));
    addEventListener('blur', () => {
      this.keys.clear();
      for (const c of this.controllers.values()) if (c.kind === 'kb') c.setState(0, 0, 0);
    });
  }
}
