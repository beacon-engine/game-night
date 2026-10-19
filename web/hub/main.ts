// Game select: every folder in games/ with a game.json shows up here (see web/games/README.md).
import { $, BIT, canRun, chip, deviceProfile, escapeHtml, glyph, hostInfo, Input, key, keyCode, listGames, thisDevice, type GameInfo } from '@platform';

const [all, device] = await Promise.all([listGames(), deviceProfile()]);
// too much for this screen: shown, but not playable here
const tooHeavy = (g: GameInfo) => !canRun(device.tier, g.needs);
const playable = (g: GameInfo) => g.status === 'ready' && !tooHeavy(g);
const here = thisDevice(device); // 'this TV' / 'this device'
// grouped by category, in the order they first appear (games come sorted by their "order")
const categories = [...new Set(all.map((g) => g.category))];
const games = categories.flatMap((c) => all.filter((g) => g.category === c));
let sel = Math.max(0, games.findIndex((g) => g.id === remembered()));
let leaving = false;

// Phones only: the keyboard drives this page directly (see the keydown handler)
const input = new Input({ keyboard: false });
input.onJoin = input.onLeave = input.onRename = renderPlayers;

// --- the library ------------------------------------------------------------------------
function renderLibrary() {
  $('library').innerHTML = categories.map((cat) => `
    <section class="section">
      <header><span class="eyebrow">${escapeHtml(cat)}</span><hr class="rule"><span class="caption faint">${games.filter((g) => g.category === cat).length}</span></header>
      <div class="tiles">${games.map((g, i) => (g.category === cat ? tile(g, i) : '')).join('')}</div>
    </section>`).join('');
  for (const el of document.querySelectorAll<HTMLElement>('.tile')) {
    const i = Number(el.dataset.i);
    el.addEventListener('click', () => { select(i); play(); });
    el.addEventListener('mouseenter', () => select(i));
  }
}

function tile(g: GameInfo, i: number) {
  const icon = g.iconUrl
    ? `<span class="icon" style="--icon:url('${g.iconUrl}')"></span>`
    : `<span class="emoji">${escapeHtml(g.icon)}</span>`;
  const note = tooHeavy(g) ? `Not on ${here}` : g.status === 'soon' ? 'Soon' : '';
  return `<button class="tile frame ${g.status} ${tooHeavy(g) ? 'unsupported' : ''}" data-i="${i}">
      <span class="top">${icon}<span class="caption faint num">${String(i + 1).padStart(2, '0')}</span></span>
      <span><span class="name">${escapeHtml(g.name)}</span>${note ? `<div class="caption faint">${note}</div>` : ''}</span>
    </button>`;
}

// --- the feature (what's selected) ----------------------------------------------------------
function select(i: number, scroll = false) {
  if (i === sel && document.querySelector('.tile.sel')) return;
  sel = i;
  for (const el of document.querySelectorAll('.tile')) el.classList.toggle('sel', Number((el as HTMLElement).dataset.i) === i);
  const g = games[i];
  if (!g) return;
  const ready = playable(g);
  $('fIcon').style.setProperty('--icon', g.iconUrl ? `url('${g.iconUrl}')` : 'none');
  $('fIcon').classList.toggle('soon', !ready);
  $('fTitle').textContent = g.name;
  $('fTitle').classList.toggle('soon', !ready);
  $('fTagline').textContent = g.tagline;
  $('fPlayers').textContent = `${g.players} players`;
  $('fStatus').textContent = ready ? 'Ready to play' : tooHeavy(g) ? `Not on ${here}` : 'Coming soon';
  $('fStatus').classList.toggle('tag-volt', ready);
  $('fWhy').textContent = tooHeavy(g) ? `${cap(here)} isn't powerful enough for ${g.name}. Play it on a laptop, or pick another game.` : '';
  const btn = $<HTMLButtonElement>('play');
  btn.disabled = !ready;
  btn.innerHTML = ready ? `${glyph('cross')} Play` : tooHeavy(g) ? 'Not available' : 'Coming soon';
  if (scroll) document.querySelector('.tile.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderPlayers() {
  const pads = input.list;
  $('players').innerHTML = pads.length ? pads.map(chip).join('') : '<em>No one has joined yet</em>';
}

let bannerTimer = 0;
function banner(text: string) {
  $('banner').textContent = text;
  $('banner').classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('banner').classList.remove('show'), 1400);
}

function play() {
  const g = games[sel];
  if (!g || leaving) return;
  if (tooHeavy(g)) return banner(`${g.name} isn't available on ${here}`);
  if (g.status !== 'ready') return banner(`${g.name} is coming soon`);
  leaving = true;
  remember(g.id);
  document.body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => { location.href = g.url; }, 220);
}

// Move like a d-pad, by where the tiles are on screen: sideways within a row, up and down
// to the nearest tile in the next row (across sections too)
function move(dx: number, dy: number) {
  const tiles = [...document.querySelectorAll<HTMLElement>('.tile')];
  const box = (el: HTMLElement) => el.getBoundingClientRect();
  const cur = box(tiles[sel]);
  if (dx) {
    const next = sel + dx;
    if (next >= 0 && next < tiles.length) select(next, true);
    return;
  }
  const cx = cur.left + cur.width / 2;
  let best = -1, bestScore = Infinity;
  tiles.forEach((el, i) => {
    const b = box(el);
    const ahead = dy > 0 ? b.top - cur.bottom : cur.top - b.bottom;
    if (ahead < -1) return; // not in that direction
    const score = ahead * 4 + Math.abs(b.left + b.width / 2 - cx);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best >= 0) select(best, true);
}

// --- phones -------------------------------------------------------------------------------
function syncPads() {
  const g = games[sel];
  const ready = !!g && playable(g);
  for (const c of input.list) {
    input.show(c, {
      layout: 'dpad', label: c.tag, color: c.color, title: 'Game Night', accent: '#d7ff3b',
      hint: g ? `${g.name}${ready ? '' : tooHeavy(g) ? ` (not on ${here})` : ' (coming soon)'}` : '',
      labels: ready ? { cross: 'Play' } : {},
    });
  }
}

function tick() {
  requestAnimationFrame(tick);
  for (const c of input.list) {
    const fx = c.flickX(), fy = c.flickY();
    if (fx || fy) move(fx, fy);
    for (const ev of c.drain()) if (ev.down && ev.bit === BIT.cross) play();
  }
  syncPads();
}

const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
addEventListener('keydown', (e) => {
  const code = keyCode(e);
  if (code === 'Enter' || code === 'Space') { e.preventDefault(); play(); }
  else if (KEYS[code]) { e.preventDefault(); move(...KEYS[code]); }
});
$('play').addEventListener('click', play);

// the last game played starts selected (per browser; fine if storage is unavailable)
function remembered() {
  try { return localStorage.getItem('lastGame'); } catch { return null; }
}
function remember(id: string) {
  try { localStorage.setItem('lastGame', id); } catch { /* private mode */ }
}

$('legend').innerHTML = [
  `<span>${glyph('dpad')} Choose</span>`,
  `<span>${glyph('cross')} Play</span>`,
  `<span class="keys">${key('←')}${key('→')}${key('↑')}${key('↓')} ${key('Enter')} Keyboard</span>`,
].join('');
hostInfo().then((info) => {
  $('url').textContent = info.padUrl;
  $('qr').innerHTML = info.qr;
  $('version').textContent = `game-night ${info.version}`;
});
function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

document.body.classList.toggle('tv', device.tv);
renderLibrary();
select(sel, true);
renderPlayers();
requestAnimationFrame(tick);
