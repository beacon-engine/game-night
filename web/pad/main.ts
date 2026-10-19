// The phone controller. The same pad for every game: a floating stick on the left, the four
// face buttons and two shoulder buttons on the right. The game decides what they say.
import { $, BIT, CLOSE_REPLACED, FACE_BITS, socketUrl, type Button, type PadLayout, type PadScreen, type PadToServer, type ServerToPad } from '@platform';

const STICK_R = 60; // px from the centre to full tilt
const STEER_R = 90; // the steering slider (racing) is wider and only goes sideways
const store = {
  get: (k: string) => { try { return localStorage.getItem(`gamenight.${k}`) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`gamenight.${k}`, v); } catch { /* private mode */ } },
};

let id: string | null = store.get('id') || null;
let name = store.get('name');
if (name) $('name').textContent = name;

const stick = { x: 0, y: 0 };
let buttons = 0;
let sprinting = false;
let ws: WebSocket | null = null;
let displayOn = false;
let lastSent = '';

// --- Connection ------------------------------------------------------------------------
function send(msg: PadToServer) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(socketUrl());
  ws.onopen = () => send({ t: 'hello', role: 'pad', id, name });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data) as ServerToPad;
    switch (m.t) {
      case 'welcome':
        id = m.id;
        store.set('id', id);
        $('me').textContent = `P${m.slot + 1}`;
        $('dot').classList.add('on');
        setDisplay(m.display);
        lastSent = '';
        flush();
        break;
      case 'display': setDisplay(m.on); break;
      case 'screen': show(m); break;
      case 'buzz': navigator.vibrate?.(m.ms || 40); break;
    }
  };
  ws.onclose = (e) => {
    $('dot').classList.remove('on');
    if (e.code === CLOSE_REPLACED) {
      // this pad is open in another tab: let that one play (tapping the overlay takes it back)
      ws = null;
      showOverlay('Open in another tab<small>Tap to use this one instead</small>');
      return;
    }
    showOverlay('Reconnecting…<small>Lost the connection to the game</small>');
    setTimeout(connect, 1000);
  };
}

function setDisplay(on: boolean) {
  displayOn = on;
  if (on) hideOverlay();
  else showOverlay('Waiting for the game<small>Open Beacon Arcade on the TV or laptop</small>');
}
function showOverlay(html: string) { $('ov-text').innerHTML = html; $('overlay').style.display = 'flex'; }
function hideOverlay() { $('overlay').style.display = 'none'; }

const buttonEls = [...document.querySelectorAll<HTMLElement>('[data-button]')];
let layout: PadLayout = 'stick';

// The game picks the layout per screen. Switching lets go of everything, so nothing stays held.
function setLayout(next: PadLayout) {
  if (next === layout) return;
  layout = next;
  document.body.dataset.layout = next;
  buttons = 0;
  for (const el of document.querySelectorAll('.down')) el.classList.remove('down');
  releaseStick();
  $('stick-help').innerHTML = next === 'racing' ? 'Slide sideways to steer' : 'Touch &amp; drag to move<br>past the ring to sprint';
  $('stick-help').hidden = false;
}

function show(s: PadScreen) {
  setLayout(s.layout ?? 'stick');
  const root = document.documentElement.style;
  root.setProperty('--accent', s.accent || 'var(--volt)');
  root.setProperty('--me', s.color || 'var(--chalk)');
  $('me').textContent = s.label || 'P?';
  $('title').textContent = s.title || '';
  $('hint').textContent = s.hint || '';
  for (const el of buttonEls) {
    const label = s.labels[el.dataset.button as Button] ?? '';
    el.querySelector('.lbl')!.textContent = label;
    el.classList.toggle('unused', !label);
  }
  const charge = s.charge ?? -1;
  $('power').style.display = charge >= 0 ? 'block' : 'none';
  ($('power').firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, charge)) * 100}%`;
}

function flush() {
  const msg = JSON.stringify({ t: 'in', x: +stick.x.toFixed(3), y: +stick.y.toFixed(3), b: buttons | (sprinting ? BIT.sprint : 0) });
  if (msg === lastSent || ws?.readyState !== WebSocket.OPEN) return;
  lastSent = msg;
  ws.send(msg);
}

// --- Stick (floating: it appears where the thumb lands) ---------------------------------
const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob');
let stickId: number | null = null, ox = 0, oy = 0;

zone.addEventListener('pointerdown', (e) => {
  if (stickId !== null) return;
  stickId = e.pointerId;
  zone.setPointerCapture(e.pointerId);
  const r = zone.getBoundingClientRect();
  ox = e.clientX - r.left;
  oy = e.clientY - r.top;
  for (const el of [base, knob]) { el.hidden = false; el.style.left = `${ox}px`; el.style.top = `${oy}px`; }
  $('stick-help').hidden = true;
});
zone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  const r = zone.getBoundingClientRect();
  let dx = e.clientX - r.left - ox, dy = e.clientY - r.top - oy;
  if (layout === 'racing') {
    // steering: sideways only, no sprint
    dx = Math.max(-STEER_R, Math.min(STEER_R, dx));
    knob.style.left = `${ox + dx}px`;
    stick.x = dx / STEER_R;
    stick.y = 0;
    return flush();
  }
  const d = Math.hypot(dx, dy);
  sprinting = d > STICK_R * 1.25;
  if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
  knob.style.left = `${ox + dx}px`;
  knob.style.top = `${oy + dy}px`;
  base.classList.toggle('sprint', sprinting);
  stick.x = dx / STICK_R;
  stick.y = -dy / STICK_R; // up = +1
  flush();
});
function releaseStick() {
  stickId = null;
  sprinting = false;
  base.hidden = knob.hidden = true;
  base.classList.remove('sprint');
  stick.x = stick.y = 0;
  flush();
}
const endStick = (e: PointerEvent) => { if (e.pointerId === stickId) releaseStick(); };
zone.addEventListener('pointerup', endStick);
zone.addEventListener('pointercancel', endStick);

// --- Buttons (face, shoulders, pedals and the d-pad arrows) ----------------------------------
const pressables = [
  ...buttonEls.map((el) => [el, BIT[el.dataset.button as Button]] as const),
  ...[...document.querySelectorAll<HTMLElement>('[data-dir]')].map((el) => [el, BIT[el.dataset.dir as 'up' | 'down' | 'left' | 'right']] as const),
];
for (const [el, bit] of pressables) {
  let sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('down');
    sx = e.clientX;
    sy = e.clientY;
    buttons |= bit;
    navigator.vibrate?.(12);
    flush();
  });
  // a swipe across a held face button = its swipe variant (e.g. a lofted through ball)
  if (bit & FACE_BITS) el.addEventListener('pointermove', (e) => {
    if (!(buttons & bit) || buttons & BIT.swipe) return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 28) { buttons |= BIT.swipe; navigator.vibrate?.(20); flush(); }
  });
  const up = () => {
    el.classList.remove('down');
    buttons &= ~bit;
    if (!(buttons & FACE_BITS)) buttons &= ~BIT.swipe;
    flush();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// --- Bar ----------------------------------------------------------------------------------
$('name').addEventListener('click', () => {
  const n = prompt('Your name', name);
  if (n === null) return;
  name = n.trim().slice(0, 12);
  $('name').textContent = name || 'Set name';
  store.set('name', name);
  send({ t: 'name', name });
});

$('pause').addEventListener('click', () => {
  navigator.vibrate?.(20);
  send({ t: 'pause' });
});

$('overlay').addEventListener('click', () => {
  document.documentElement.requestFullscreen?.().catch(() => {});
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  if (!ws) connect();
  else if (displayOn) hideOverlay();
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
// leaving the page: hang up now (the close handler reconnects if the page comes back)
addEventListener('pagehide', () => ws?.close());
addEventListener('pageshow', (e) => { if (e.persisted && !ws) connect(); });
// Resend the state now and then, so a dropped message never leaves a button "stuck"
setInterval(() => { lastSent = ''; flush(); }, 500);

connect();
