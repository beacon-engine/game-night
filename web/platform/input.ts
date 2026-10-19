// Controllers on the display side: phones (over the server's WebSocket) and keyboard layouts.
// A game adds its own per-player state with `state`, e.g.
//   const input = new Input({ state: () => ({ team: 0, score: 0 }) });
//   input.list[0].team   // typed
import { DEFAULT_KEYMAPS, type KeyAction, type Keymap } from './keyboard.ts';
import { ALL_BITS, BIT, DPAD, type Bit, playerColor } from './pad.ts';
import { keyCode } from './dom.ts';
import { CLOSE_REPLACED, socketUrl, type DisplayToServer, type PadScreen, type ServerToDisplay } from './protocol.ts';

export interface PadEvent {
  bit: Bit;
  down: boolean;
}

export class Controller {
  x = 0; // stick right = +1
  y = 0; // stick up = +1
  buttons = 0;
  connected = true;
  lastScreen = '';
  private queue: PadEvent[] = [];
  private steps: [number, number][] = []; // d-pad taps not yet read by flickX/flickY
  private latchX = 0;
  private latchY = 0;

  constructor(
    readonly id: string,
    readonly kind: 'pad' | 'keyboard',
    public name: string,
    public slot: number,
  ) {}

  get color() { return playerColor(this.slot); }
  get tag() { return `P${this.slot + 1}`; }
  get label() { return this.name || (this.kind === 'keyboard' ? 'Keys' : 'Phone'); }

  setState(x: number, y: number, b: number) {
    const diff = b ^ this.buttons;
    for (const bit of ALL_BITS) if (diff & bit) this.queue.push({ bit, down: !!(b & bit) });
    for (const [dir, step] of Object.entries(DPAD)) {
      const bit = BIT[dir as keyof typeof DPAD];
      if (diff & b & bit) this.steps.push([...step]);
    }
    this.x = Math.max(-1, Math.min(1, Number(x) || 0));
    this.y = Math.max(-1, Math.min(1, Number(y) || 0));
    this.buttons = b;
  }

  held(bit: number) {
    return (this.buttons & bit) !== 0;
  }

  // Button presses and releases since the last call
  drain() {
    const q = this.queue;
    this.queue = [];
    this.steps = []; // (anything a menu hasn't read by now is stale)
    return q;
  }

  // The d-pad (or the arrow keys) as a direction: -1, 0 or 1 on each axis, y down = +1
  get dpad() {
    const h = (bit: number) => (this.held(bit) ? 1 : 0);
    return { x: h(BIT.right) - h(BIT.left), y: h(BIT.down) - h(BIT.up) };
  }

  // -1/+1 once per d-pad tap or flick of the stick left/right (for menus)
  flickX() {
    const i = this.steps.findIndex(([dx]) => dx);
    if (i >= 0) return (this.latchX = this.steps.splice(i, 1)[0][0]); // (a key is a tap and a push of the stick: count it once)
    if (Math.abs(this.x) < 0.4) this.latchX = 0;
    else if (!this.latchX && Math.abs(this.x) > 0.7) return (this.latchX = Math.sign(this.x));
    return 0;
  }

  // -1/+1 once per d-pad tap or flick up/down (menus): +1 = down the list
  flickY() {
    const i = this.steps.findIndex(([, dy]) => dy);
    if (i >= 0) return (this.latchY = this.steps.splice(i, 1)[0][1]);
    if (Math.abs(this.y) < 0.4) this.latchY = 0;
    else if (!this.latchY && Math.abs(this.y) > 0.7) return (this.latchY = -Math.sign(this.y));
    return 0;
  }
}

export type Pad<T> = Controller & T; // a controller with the game's state for its player

export interface InputOptions<T> {
  state?: () => T; // the game's own fields on each player
  keyboard?: Keymap[] | false; // keyboard pads (default: two layouts), or none
}

export class Input<T extends object = object> {
  onJoin: (c: Pad<T>) => void = () => {};
  onLeave: (c: Pad<T>) => void = () => {};
  onRename: (c: Pad<T>) => void = () => {};
  onPause: (c: Pad<T>) => void = () => {};
  // Another screen opened Beacon Arcade and took the phones. By default this page says so.
  onReplaced: () => void = showReplaced;

  private controllers = new Map<string, Pad<T>>();
  private ws: WebSocket | null = null;
  private keys = new Set<string>();
  private state: () => T;

  constructor({ state = () => ({}) as T, keyboard = DEFAULT_KEYMAPS }: InputOptions<T> = {}) {
    this.state = state;
    this.connect();
    this.hangUpOnLeave();
    if (keyboard) this.listenKeyboard(keyboard);
  }

  // connected controllers
  get list(): Pad<T>[] {
    return [...this.controllers.values()].filter((c) => c.connected);
  }

  // Update a player's phone (only sent when it changed)
  show(c: Controller, screen: PadScreen) {
    const json = JSON.stringify(screen);
    if (c.kind !== 'pad' || json === c.lastScreen) return;
    c.lastScreen = json;
    this.send({ t: 'screen', ...screen, to: c.id });
  }

  buzz(c: Controller | null | undefined, ms: number) {
    if (c?.kind === 'pad') this.send({ t: 'buzz', ms, to: c.id });
  }

  private send(msg: DisplayToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // (Re)connect a controller in a slot, creating it the first time
  private attach(id: string, kind: Controller['kind'], name: string, slot: number): Pad<T> {
    let c = this.controllers.get(id);
    if (!c) {
      c = Object.assign(new Controller(id, kind, name, slot), this.state());
      this.controllers.set(id, c);
    }
    c.name = name || c.name;
    c.slot = slot;
    c.connected = true;
    c.lastScreen = '';
    return c;
  }

  private freeSlot() {
    const used = new Set(this.list.map((c) => c.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }

  private connect() {
    const ws = new WebSocket(socketUrl());
    this.ws = ws;
    ws.onopen = () => this.send({ t: 'hello', role: 'display' });
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (e.code === CLOSE_REPLACED) {
        this.ws = null;
        this.onReplaced();
      } else setTimeout(() => this.connect(), 1000);
    };
    ws.onmessage = (ev) => this.receive(JSON.parse(ev.data) as ServerToDisplay);
  }

  // Leaving the page (to another game, or the hub): hang up now so the next page takes over
  // cleanly. The browser may otherwise keep this page, and its socket, frozen in its cache.
  private hangUpOnLeave() {
    addEventListener('pagehide', () => {
      const ws = this.ws;
      this.ws = null;
      ws?.close();
    });
    addEventListener('pageshow', (e) => { if (e.persisted && !this.ws) this.connect(); });
  }

  private receive(m: ServerToDisplay) {
    if (m.t === 'join') {
      // the server owns pad slots: a keyboard pad sitting in this one moves over
      const bumped = this.list.find((k) => k.kind === 'keyboard' && k.slot === m.slot);
      const c = this.attach(m.id, 'pad', m.name, m.slot);
      if (bumped) bumped.slot = this.freeSlot();
      this.onJoin(c);
      return;
    }
    const c = this.controllers.get(m.id);
    if (!c) return;
    if (m.t === 'leave') {
      c.connected = false;
      c.setState(0, 0, 0);
      c.drain();
      this.onLeave(c);
    } else if (m.t === 'in') c.setState(m.x, m.y, m.b | 0);
    else if (m.t === 'pause') this.onPause(c);
    else if (m.t === 'name') {
      c.name = m.name;
      this.onRename(c);
    }
  }

  private listenKeyboard(keymaps: Keymap[]) {
    const layoutOf = new Map<string, number>(); // key code -> layout
    keymaps.forEach((km, i) => { for (const code of Object.values(km)) layoutOf.set(code, i); });

    const update = (e: KeyboardEvent, down: boolean) => {
      const code = keyCode(e);
      const i = layoutOf.get(code);
      if (i === undefined) return;
      e.preventDefault();
      if (down) this.keys.add(code);
      else this.keys.delete(code);
      const id = `kb${i + 1}`;
      let c = this.controllers.get(id);
      if (!c?.connected) {
        if (!down) return;
        c = this.attach(id, 'keyboard', `Keys ${i + 1}`, this.freeSlot());
        this.onJoin(c);
      }
      const km = keymaps[i];
      const k = (a: KeyAction) => (km[a] && this.keys.has(km[a]) ? 1 : 0);
      let x = k('right') - k('left');
      let y = k('up') - k('down');
      const d = Math.hypot(x, y);
      if (d > 1) { x /= d; y /= d; }
      let b = 0;
      for (const [action, code] of Object.entries(km) as [KeyAction, string][]) {
        const [btn, mod] = action.split('+');
        if (!this.keys.has(code) || !(btn in BIT)) continue; // (up/down/left/right are the stick)
        b |= BIT[btn as keyof typeof BIT] | (mod === 'swipe' ? BIT.swipe : 0);
      }
      c.setState(x, y, b);
    };
    addEventListener('keydown', (e) => !e.repeat && update(e, true));
    addEventListener('keyup', (e) => update(e, false));
    addEventListener('blur', () => {
      this.keys.clear();
      for (const c of this.controllers.values()) if (c.kind === 'keyboard') c.setState(0, 0, 0);
    });
  }
}

// A notice over the page, in the brand's style (needs /brand/brand.css)
function showReplaced() {
  const el = document.createElement('div');
  el.className = 'panel';
  el.style.cssText = 'position:fixed;inset:auto 24px 24px auto;z-index:99;max-width:360px;padding:18px 20px;display:flex;flex-direction:column;gap:12px';
  el.innerHTML = `<div class="h3">Open on another screen</div>
    <div class="muted" style="font-size:14px">Beacon Arcade was opened somewhere else, so the phones went there.</div>
    <button class="btn btn-primary" style="align-self:flex-start">Use this screen</button>`;
  el.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(el);
}
