// The phone controller. The same pad for every game: a floating stick on the left, the four
// face buttons and two shoulder buttons on the right. The game decides what they say.
import {
  $, BIT, buyItem, hostInfo, CLOSE_REPLACED, escapeHtml, FACE_BITS, keepAwake, shopItems, socketUrl, starsLabel, starsOf,
  type Button, type PadLayout, type PadScreen, type PadToServer, type ServerToPad, type ShopItem,
} from '@platform';

keepAwake(); // a phone in someone's hands mid-game shouldn't dim and lock

const STICK_R = 60; // px from the centre to full tilt
const STEER_R = 90; // the steering slider (racing) is wider and only goes sideways
const store = {
  get: (k: string) => { try { return localStorage.getItem(`gamenight.${k}`) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`gamenight.${k}`, v); } catch { /* private mode */ } },
};

// Arriving from the plain pad to tilt to steer (see the Tilt button): HTTPS is another origin with
// its own storage, so the player and their name come along in the address.
const handoff = new URLSearchParams(location.hash.slice(1));
if (handoff.has('tilt')) {
  for (const k of ['id', 'name']) if (handoff.get(k)) store.set(k, handoff.get(k)!);
  store.set('tilt', '1');
  history.replaceState(null, '', location.pathname + location.search);
}

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
        starsOf(id).then((info) => info && setBalance(info.balance, info.owned));
        break;
      case 'display': setDisplay(m.on); break;
      case 'screen': show(m); break;
      case 'buzz': navigator.vibrate?.(m.ms || 40); break;
      case 'stars':
        setBalance(m.balance);
        if (m.earned > 0) earned(m.earned);
        break;
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
  stickHelp();
}

function stickHelp() {
  $('stick-help').innerHTML = layout !== 'racing' ? 'Touch &amp; drag to move<br>past the ring to sprint'
    : !tiltOn ? 'Slide sideways to steer'
    : tiltLive ? 'Turn the phone to steer' : 'Tap here to start tilt';
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
  if (stickId !== null || (tiltOn && layout === 'racing')) return;
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

// --- Tilt to steer (racing) -------------------------------------------------------------------
// Hold the phone like a wheel: the steering is how far "up" leans off the top of the screen, which
// doesn't care how far back the phone is tipped. Phones only hand out the motion sensors on HTTPS,
// so on the plain pad the Tilt button first moves over to the server's HTTPS side.
const TILT_LOCK = 35; // degrees of turn for full lock
const TILT_DEAD = 3; // degrees either side of straight that still count as straight
const secure = location.protocol === 'https:';
let tiltOn = secure && store.get('tilt') === '1';
let tiltLive = false; // the sensor is talking to us
let gx = 0, gy = 0; // gravity across the screen (x right, y up), smoothed

function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity;
  if (g?.x == null || g.y == null) return;
  if (!tiltLive) { tiltLive = true; stickHelp(); }
  // the sensor's axes are the phone's (portrait); turn them to the screen's as it's held
  const a = ((screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
  gx += (g.x * Math.cos(a) - g.y * Math.sin(a) - gx) * 0.3;
  gy += (g.x * Math.sin(a) + g.y * Math.cos(a) - gy) * 0.3;
  if (!tiltOn || layout !== 'racing' || $('shop').classList.contains('open')) return;
  if (Math.hypot(gx, gy) < 2) return; // lying flat: there's no wheel to read
  // (some phones report the vector the other way round: past a quarter turn, that's what it is)
  let deg = (Math.atan2(gx, gy) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg < -90) deg += 180;
  // turning right leans "up" to the left of the screen
  const steer = -Math.sign(deg) * Math.min(1, Math.max(0, Math.abs(deg) - TILT_DEAD) / (TILT_LOCK - TILT_DEAD));
  stick.x = Math.round(steer * 50) / 50; // (in steps, so a shaky hand doesn't send a stream of messages)
  stick.y = 0;
  $('wheel').style.transform = `rotate(${stick.x * TILT_LOCK}deg)`;
  flush();
}

// Needs a tap on iPhone (it asks the player); false if motion access isn't given.
async function startTilt() {
  const ask = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
  try {
    if (ask && (await ask.call(DeviceMotionEvent)) !== 'granted') return false;
  } catch {
    return false; // not from a tap, or turned down
  }
  addEventListener('devicemotion', onMotion);
  return true;
}

function setTilt(on: boolean) {
  tiltOn = on;
  store.set('tilt', on ? '1' : '');
  document.body.classList.toggle('tilting', on);
  $('tilt').classList.toggle('on', on);
  stick.x = 0;
  $('wheel').style.transform = '';
  flush();
  stickHelp();
}

async function tryTilt(tapped = true) {
  if (await startTilt()) {
    // no reading soon after: there's no sensor to read
    setTimeout(() => {
      if (tiltOn && !tiltLive) { setTilt(false); $('stick-help').textContent = "This phone can't tilt to steer"; }
    }, 1500);
  } else if (tiltOn && tapped) {
    $('stick-help').textContent = 'Motion access was refused. Close the browser and try again.';
  }
}

$('tilt').addEventListener('click', () => {
  navigator.vibrate?.(12);
  if (secure) {
    setTilt(!tiltOn);
    if (tiltOn && !tiltLive) tryTilt();
    return;
  }
  releaseStick();
  $('tilt-sheet').classList.add('open');
});
$('tilt-cancel').addEventListener('click', () => $('tilt-sheet').classList.remove('open'));
$('tilt-go').addEventListener('click', async () => {
  const { tiltUrl } = await hostInfo().catch(() => ({ tiltUrl: '' }));
  if (!tiltUrl) {
    $('tilt-sheet').classList.remove('open');
    $('stick-help').textContent = "Tilt to steer is off on this game's computer";
    return;
  }
  location.href = `${tiltUrl}#${new URLSearchParams({ tilt: '1', id: id ?? '', name })}`;
});
// on iPhone the sensor has to be asked for from a tap
zone.addEventListener('click', () => { if (tiltOn && !tiltLive && layout === 'racing') tryTilt(); });
if (tiltOn) {
  setTilt(true);
  tryTilt(false); // (fine without a tap on Android; on iPhone the first tap does it)
}

// --- Stars and the shop ---------------------------------------------------------------------
// Stars are earned in the games (the server tells us); the shop is here on the phone, so buying
// never holds up the game on the TV.
let balance = 0;
let owned: string[] = [];
let shop: ShopItem[] = [];
let sure = ''; // the item whose Buy was tapped once: tap again to buy

function setBalance(n: number, mine?: string[]) {
  balance = n;
  if (mine) owned = mine;
  $('stars').innerHTML = starsLabel(n);
  $('ov-shop').innerHTML = `Shop ${starsLabel(n)}`;
  $('ov-shop').hidden = false;
  $('shop-balance').innerHTML = starsLabel(n);
}

let earnedTimer = 0;
function earned(n: number) {
  $('earned').innerHTML = `+${starsLabel(n)}`;
  $('earned').classList.add('show');
  navigator.vibrate?.([30, 60, 30]);
  clearTimeout(earnedTimer);
  earnedTimer = window.setTimeout(() => $('earned').classList.remove('show'), 3000);
}

async function openShop() {
  // let go of everything first, so nothing stays held in the game
  buttons = 0;
  for (const el of document.querySelectorAll('.down')) el.classList.remove('down');
  releaseStick();
  sure = '';
  $('shop').classList.add('open');
  $('shop-list').innerHTML = '<p class="muted">Opening the shop…</p>';
  const [items, info] = await Promise.all([shopItems(), id ? starsOf(id) : null]);
  shop = items;
  if (info) setBalance(info.balance, info.owned);
  renderShop();
}

function renderShop(msg = '') {
  const games = [...new Set(shop.map((it) => it.gameName))];
  $('shop-list').innerHTML = `<p class="caption faint" id="shop-msg">${escapeHtml(msg) || 'Earn stars by playing. They buy looks, never an advantage.'}</p>` +
    (shop.length ? games.map((g) => `<h3>${escapeHtml(g)}</h3><div class="items">${shop.filter((it) => it.gameName === g).map(item).join('')}</div>`).join('')
      : '<p class="muted">Nothing on sale yet.</p>');
}

function item(it: ShopItem) {
  const mine = owned.includes(it.id);
  const colors = (it.extra.colors as string[] | undefined) ?? (typeof it.extra.color === 'string' ? [it.extra.color] : []);
  const sw = colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : colors[0] ?? '';
  const label = mine ? 'Yours' : sure === it.id ? 'Buy?' : starsLabel(it.price);
  return `<div class="item ${mine ? 'owned' : ''}">
      <span class="swatch" style="${sw ? `--sw:${escapeHtml(sw)}` : ''}"></span>
      <span><b>${escapeHtml(it.name)}</b>${it.extra.about ? `<small>${escapeHtml(it.extra.about)}</small>` : ''}</span>
      <button class="btn buy ${sure === it.id ? 'sure' : ''}" data-item="${escapeHtml(it.id)}" ${mine ? 'disabled' : ''}>${label}</button>
    </div>`;
}

$('shop-list').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.buy');
  const it = shop.find((x) => x.id === btn?.dataset.item);
  if (!it || !id || owned.includes(it.id)) return;
  if (balance < it.price) {
    sure = '';
    return renderShop(`${it.name} needs ${it.price - balance} more stars. Keep playing!`);
  }
  if (sure !== it.id) {
    sure = it.id;
    return renderShop(`Tap again to buy ${it.name}`);
  }
  sure = '';
  const res = await buyItem(id, it.id);
  if (typeof res === 'string') return renderShop(res);
  setBalance(res.balance, res.owned);
  navigator.vibrate?.(40);
  renderShop(`${it.name} is yours. Pick it in ${it.gameName}.`);
});
$('stars').addEventListener('click', openShop);
$('ov-shop').addEventListener('click', (e) => { e.stopPropagation(); openShop(); }); // (also while waiting for the game)
$('shop-close').addEventListener('click', () => $('shop').classList.remove('open'));

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
  if (tiltOn && !tiltLive) tryTilt();
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
