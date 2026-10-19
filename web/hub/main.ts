// Game select: every folder in games/ with a game.json shows up here (see README, "Adding a game").
import { $, BIT, escapeHtml, hostInfo, Input, listGames, type GameInfo } from '@platform';

const games: GameInfo[] = await listGames();
let sel = Math.max(0, games.findIndex((g) => g.id === remembered()));
let leaving = false;

// Phones only: the keyboard drives this page directly (see the keydown handler)
const input = new Input({ keyboard: false });
input.onJoin = input.onLeave = input.onRename = renderPlayers;

function render() {
  $('games').innerHTML = games.map((g, i) => `
    <button class="game ${g.status} ${i === sel ? 'sel' : ''}" data-i="${i}">
      <div class="gicon">${escapeHtml(g.icon)}</div><div class="gname">${escapeHtml(g.name)}</div>
      <div class="gtag">${escapeHtml(g.tagline)}</div>
      ${g.players ? `<div class="gplayers">${escapeHtml(g.players)} players</div>` : ''}
      ${g.status === 'soon' ? '<div class="gsoon">COMING SOON</div>' : ''}
    </button>`).join('');
  for (const el of $('games').children as HTMLCollectionOf<HTMLElement>) {
    const i = Number(el.dataset.i);
    el.addEventListener('click', () => { sel = i; play(); });
    el.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; render(); } });
  }
}

function renderPlayers() {
  const pads = input.list;
  $('players').innerHTML = pads.length
    ? pads.map((c) => `<span style="background:${c.color}">${c.tag} ${escapeHtml(c.label)}</span>`).join('')
    : '<em>No pads connected yet</em>';
}

let bannerTimer = 0;
function banner(text: string) {
  $('banner').firstElementChild!.textContent = text;
  $('banner').classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('banner').classList.remove('show'), 1200);
}

function play() {
  const g = games[sel];
  if (!g || leaving) return;
  render();
  if (g.status !== 'ready') return banner(`${g.name.toUpperCase()}: coming soon`);
  leaving = true;
  remember(g.id);
  $('games').children[sel].classList.add('go');
  setTimeout(() => { location.href = g.url; }, 300);
}

// Move the selection like a d-pad over the wrapped grid of cards
function move(dx: number, dy: number) {
  if (!games.length) return;
  let i = sel + dx;
  if (dy) {
    const cards = [...$('games').children] as HTMLElement[];
    const perRow = cards.filter((c) => c.offsetTop === cards[sel].offsetTop).length || 1;
    i = sel + dy * perRow;
    if (i < 0 || i >= games.length) return;
  }
  sel = (i + games.length) % games.length;
  render();
}

function syncPads() {
  const hint = games[sel] ? `${games[sel].name}: stick picks a game` : '';
  for (const c of input.list) {
    input.show(c, { label: c.tag, color: c.color, title: 'Game Night', accent: '#1d4ed8', hint, labels: { cross: 'Play' } });
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
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); play(); }
  else if (KEYS[e.code]) { e.preventDefault(); move(...KEYS[e.code]); }
});

// the last game played starts selected (per browser; fine if storage is unavailable)
function remembered() {
  try { return localStorage.getItem('lastGame'); } catch { return null; }
}
function remember(id: string) {
  try { localStorage.setItem('lastGame', id); } catch { /* private mode */ }
}

hostInfo().then((info) => {
  $('url').textContent = info.padUrl;
  $('qr').innerHTML = info.qr;
});
render();
renderPlayers();
requestAnimationFrame(tick);
