import * as THREE from 'three';
import { buildStadium } from './stadium.js';
import { Match } from './match.js';
import { Input, BTN } from '/js/input.js';
import { Sfx } from './audio.js';
import { makeLabel, loadPlayerAssets } from './player.js';
import { loadControls } from '/js/controls.js';

const $ = (id) => document.getElementById(id);
const load = (f) => fetch(`/data/${f}.json`, { cache: 'no-store' }).then((r) => r.json());
const [settings, formations, clubs] = await Promise.all([load('settings'), load('formations'), load('teams')]);
const controls = await loadControls('football'); // which button does what: data/controls/football.json
const formation = formations[String(settings.playersPerSide)] || formations['5'];
await loadPlayerAssets(); // motion-captured player model (must be ready before any match)
const L = settings.pitch.length;
const W = settings.pitch.width;

// ------------------------------------------------------------- renderer --
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// retina at full 2x is a lot of pixels for a laptop GPU; 1.5x looks almost the same
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * (settings.renderScale || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.5, 900);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const stadium = buildStadium(scene, renderer, settings.pitch, settings.goal, clubs.slice(0, 4).map((c) => c.kit.shirt));
let timeOfDay = settings.timeOfDay === 'night' ? 'night' : 'day';
stadium.setTimeOfDay(timeOfDay);
const sfx = new Sfx();
addEventListener('pointerdown', () => { sfx.unlock(); $('sound').classList.add('hidden'); });
addEventListener('keydown', () => { sfx.unlock(); $('sound').classList.add('hidden'); });

// -------------------------------------------------------------- state ----
const COLORS = ['#38bdf8', '#f43f5e', '#facc15', '#a3e635', '#c084fc', '#fb923c', '#f472b6', '#2dd4bf'];
const app = { mode: 'lobby', home: 0, away: 1, match: null, fulltimeT: 0, menu: null };
const input = new Input();
const frontEnd = () => app.mode === 'lobby'; // menus, with a demo match behind
input.setKeymaps(controls.json.keyboard);
window.futbol = { app, input, renderer }; // handy for poking at the game from the console

input.onJoin = (c) => {
  if (c.slotted === undefined) {
    const used = new Set(input.list.filter((o) => o !== c && o.slotted).map((o) => o.slot));
    let s = 0;
    while (used.has(s)) s++;
    c.slot = s;
    c.slotted = true;
    c.color = COLORS[s % COLORS.length];
    const counts = [0, 0];
    for (const o of input.list) if (o !== c) counts[o.team]++;
    c.team = counts[0] <= counts[1] ? 0 : 1;
  }
  if (app.mode === 'match') app.match.addHuman(c);
  refreshLobby();
};
input.onLeave = (c) => {
  app.match?.removeHuman(c);
  c.slotted = undefined;
  refreshLobby();
};
input.onRename = () => refreshLobby();

function newMatch(demo) {
  app.match?.dispose();
  app.match = new Match({
    scene, settings, formation,
    clubs: [clubs[app.home], clubs[app.away]],
    controllers: demo ? [] : input.list,
    demo,
    onEvent,
    controls,
  });
}

function startMatch() {
  if (app.mode !== 'lobby') return;
  for (const c of input.list) { c.drain(); c.charge = -1; }
  app.mode = 'match';
  newMatch(false);
  $('lobby').classList.add('hidden');
  $('scoreboard').classList.remove('hidden');
  $('radar').classList.remove('hidden');
  refreshScoreboard();
  banner('KICK OFF', '', true, 1500);
}

function toLobby() {
  app.mode = 'lobby';
  app.menu = null;
  $('pause').classList.add('hidden');
  for (const c of input.list) { c.player = null; c.charge = -1; }
  newMatch(true);
  $('lobby').classList.remove('hidden');
  $('scoreboard').classList.add('hidden');
  $('radar').classList.add('hidden');
  $('chips').innerHTML = '';
  refreshLobby();
}

function cycleClub(team, d) {
  const key = team === 0 ? 'home' : 'away';
  const other = team === 0 ? app.away : app.home;
  let i = app[key];
  do i = (i + d + clubs.length) % clubs.length; while (i === other);
  app[key] = i;
  newMatch(true);
  refreshLobby();
}

// ------------------------------------------------------------- events ----
function onEvent(e) {
  const demo = app.match?.demo;
  switch (e.type) {
    case 'kick': sfx.kick(e.power); break;
    case 'post': sfx.clang(); break;
    case 'save': sfx.ooh(); break;
    case 'foul': {
      sfx.whistle(e.penalty ? 2 : 1);
      if (demo) break;
      if (e.card) {
        banner(`<span class="card ${e.card}"></span>${e.card === 'red' ? 'RED CARD' : 'YELLOW CARD'}`,
          `${e.fouler.name} (${e.fouler.team.club.short})${e.penalty ? ' · PENALTY' : ''}`, false, 3200);
      } else {
        banner(e.penalty ? 'PENALTY!' : 'FOUL', `Foul by ${e.fouler.name}`, !e.penalty, 2000);
      }
      if (e.victim.human) input.send(e.victim.human, { t: 'buzz', ms: 150 });
      break;
    }
    case 'sub':
      if (!demo) banner('SUBSTITUTION', `${e.team.club.short}: ${e.on.name} on · ${e.off.name} off`, true, 2200);
      if (app.subs) renderSubs();
      break;
    case 'sendoff': if (!demo) banner('SENT OFF', `${e.player.name} (${e.player.team.club.short})`, true, 1800); break;
    case 'shot': if (!demo) sfx.ooh(); break;
    case 'buzz': input.send(e.controller, { t: 'buzz', ms: e.ms }); break;
    case 'tackle': if (e.controller) input.send(e.controller, { t: 'buzz', ms: 80 }); break;
    case 'kickoff': if (!demo) sfx.whistle(); break;
    case 'banner': if (!demo) { sfx.whistle(); banner(e.text, '', true, 1200); } break;
    case 'goal':
      sfx.roar();
      if (demo) break;
      banner('GOAL!', e.own ? `Own goal · ${e.team.club.name}` : `${e.scorer} · ${e.team.club.name}`, false, 3000);
      for (const c of e.team.humans) input.send(c, { t: 'buzz', ms: 300 });
      refreshScoreboard();
      break;
    case 'halftime': {
      sfx.whistle(2, true);
      const [h, a] = app.match.teams;
      banner('HALF TIME', `${h.club.short} ${h.score} - ${a.score} ${a.club.short} · teams change ends`, false, 3800);
      break;
    }
    case 'secondhalf': banner('SECOND HALF', '', true, 1500); break;
    case 'fulltime': {
      sfx.whistle(3, true);
      app.mode = 'fulltime';
      app.fulltimeT = 0;
      const [h, a] = app.match.teams;
      const res = h.score === a.score ? 'DRAW' : `${(h.score > a.score ? h : a).club.name} WIN`;
      banner('FULL TIME', `${h.club.short} ${h.score} - ${a.score} ${a.club.short} · ${res}`, false, 0);
      break;
    }
  }
}

let bannerTimer = 0;
function banner(text, sub, small, ms) {
  const el = $('banner');
  el.innerHTML = `<div class="${small ? 'small' : 'big'}">${text}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}`;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// --------------------------------------------------------------- HUD -----
function refreshScoreboard() {
  const [h, a] = app.match.teams;
  $('nameH').textContent = h.club.short;
  $('nameA').textContent = a.club.short;
  $('kitH').style.background = h.club.kit.shirt;
  $('kitA').style.background = a.club.kit.shirt;
  $('score').textContent = `${h.score} - ${a.score}`;
}

function updateClock() {
  const m = app.match;
  const secs = Math.floor((m.clock / m.duration) * 90 * 60);
  $('clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function updateChips() {
  const list = frontEnd() ? [] : input.list;
  const el = $('chips');
  if (el.children.length !== list.length) {
    el.innerHTML = list.map(() => '<div class="chip"><span class="tag"></span><span class="who"></span><span class="stats"></span><span class="sta" title="stamina"><div></div></span><span class="bar"><div></div></span></div>').join('');
  }
  list.forEach((c, i) => {
    const chip = el.children[i];
    const tag = chip.querySelector('.tag');
    tag.textContent = `P${c.slot + 1}`;
    tag.style.background = c.color;
    const pl = c.player;
    chip.querySelector('.who').textContent = `${c.label} · ${pl ? pl.name : '—'}`;
    const sta = chip.querySelector('.sta > div');
    const e = pl ? pl.energy : 0;
    sta.style.width = `${Math.round(e * 100)}%`;
    sta.style.background = e > 0.6 ? '#22c55e' : e > 0.35 ? '#facc15' : '#ef4444';
    chip.querySelector('.stats').textContent = pl
      ? `PAC ${pl.data.pace} SHO ${pl.data.shooting} PAS ${pl.data.passing} DRI ${pl.data.dribbling} TAC ${pl.data.tackling}`
      : '';
    chip.querySelector('.bar > div').style.width = c.charge >= 0 ? `${Math.min(1, c.charge / 0.9) * 100}%` : '0';
  });
}

const radar = $('radar').getContext('2d');
function drawRadar() {
  const m = app.match;
  const cw = 232, ch = 146, pad = 8;
  const sx = (cw - pad * 2) / L, sz = (ch - pad * 2) / W;
  const X = (x) => pad + (x + L / 2) * sx;
  const Z = (z) => pad + (z + W / 2) * sz;
  radar.clearRect(0, 0, cw, ch);
  radar.strokeStyle = '#ffffff66';
  radar.lineWidth = 1;
  radar.strokeRect(pad, pad, cw - pad * 2, ch - pad * 2);
  radar.beginPath();
  radar.moveTo(cw / 2, pad);
  radar.lineTo(cw / 2, ch - pad);
  radar.stroke();
  for (const t of m.teams) for (const p of t.players) {
    radar.fillStyle = t.club.kit.shirt;
    radar.beginPath();
    radar.arc(X(p.x), Z(p.z), 4, 0, Math.PI * 2);
    radar.fill();
    if (p.human) {
      radar.strokeStyle = p.human.color;
      radar.lineWidth = 2;
      radar.beginPath();
      radar.arc(X(p.x), Z(p.z), 6.5, 0, Math.PI * 2);
      radar.stroke();
    }
  }
  radar.fillStyle = '#fff';
  radar.fillRect(X(m.ball.x) - 2, Z(m.ball.z) - 2, 4, 4);
}

// ------------------------------------------------------ lobby screen -----
fetch('/info').then((r) => r.json()).then((info) => {
  $('url').textContent = info.padUrl;
  $('qr').innerHTML = info.qr;
});

for (const b of document.querySelectorAll('.club button')) {
  b.addEventListener('click', () => cycleClub(Number(b.dataset.team), Number(b.dataset.d)));
}
$('start').addEventListener('click', startMatch);
$('tod').addEventListener('click', () => {
  timeOfDay = timeOfDay === 'day' ? 'night' : 'day';
  stadium.setTimeOfDay(timeOfDay);
  $('tod').textContent = timeOfDay === 'day' ? '☀ DAY' : '🌙 NIGHT';
});

function refreshLobby() {
  const h = clubs[app.home], a = clubs[app.away];
  $('lnameH').textContent = h.name;
  $('lnameA').textContent = a.name;
  $('lkitH').style.background = `linear-gradient(${h.kit.shirt} 60%, ${h.kit.shorts} 60%)`;
  $('lkitA').style.background = `linear-gradient(${a.kit.shirt} 60%, ${a.kit.shorts} 60%)`;
  for (const [team, id] of [[0, 'humansH'], [1, 'humansA']]) {
    const hs = input.list.filter((c) => c.team === team);
    $(id).innerHTML = hs.length
      ? hs.map((c) => `<span style="background:${c.color}">P${c.slot + 1} ${escapeHtml(c.label)}</span>`).join('')
      : '<em>CPU</em>';
  }
}

function lobbyInput() {
  for (const c of input.list) {
    const f = c.flick();
    if (f) cycleClub(c.team, f);
    for (const ev of c.drain()) {
      if (!ev.down) continue;
      if (ev.bit === BTN.CROSS) startMatch();
      else if (ev.bit === BTN.SQUARE) { c.team = 1 - c.team; refreshLobby(); }
      else if (ev.bit === BTN.CIRCLE) return toHub();
    }
  }
}

// ---------------------------------------------------------- game select ---
// The game select page lives at / (public/index.html); the pads stay connected across pages.
function toHub() {
  location.href = '/';
}

addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && app.mode === 'lobby') startMatch();
  else if (e.code === 'Escape' && app.mode === 'lobby') toHub();
  else if ((e.code === 'Escape' || e.code === 'KeyP') && app.mode === 'match') togglePause(null);
  else if ((e.code === 'Escape' || e.code === 'KeyP') && app.mode === 'paused') menuBack();
  else if (e.code === 'Enter' && app.mode === 'paused') menuSelect(input.list[0] || null);
  else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && app.mode === 'paused' && !input.list.length) menuMove(e.code === 'ArrowUp' ? -1 : 1);
  else if (e.code === 'Escape' && app.mode === 'fulltime') toLobby();
});

// ------------------------------------------------------------- pause ------
// A menu driven by the stick: ▲▼ to move, ✕ to choose, ○ to go back. Anyone can drive it.
const MENU = [
  { id: 'resume', label: 'Resume' },
  { id: 'subs', label: 'Substitutions' },
  { id: 'controls', label: 'Controls' },
  { id: 'camera', label: 'Camera', value: () => CAMERAS[camMode].label },
  { id: 'tags', label: 'Name tags', value: () => tagMode },
  { id: 'sound', label: 'Sound', value: () => (sfx.muted ? 'Off' : 'On') },
  { id: 'restart', label: 'Restart match' },
  { id: 'quit', label: 'Quit to menu' },
];

function togglePause(by) {
  if (app.mode === 'match') {
    app.mode = 'paused';
    app.subs = null;
    app.menu = { cursor: 0, view: 'main', by, confirm: 0 };
    $('pause').classList.remove('hidden');
    renderPause();
  } else if (app.mode === 'paused') {
    app.mode = 'match';
    app.subs = null;
    app.menu = null;
    $('pause').classList.add('hidden');
  }
  for (const c of input.list) { c.drain(); c.charge = -1; c.armed = null; }
}
input.onPause = (c) => togglePause(c);

function menuMove(d) {
  const M = app.menu;
  if (!M) return;
  if (M.view === 'main') M.cursor = (M.cursor + d + MENU.length) % MENU.length;
  else if (M.view === 'confirm') M.confirm = 1 - M.confirm;
  renderPause();
}

function menuBack() {
  const M = app.menu;
  if (!M) return;
  if (M.view === 'main') return togglePause(null);
  M.view = 'main';
  app.subs = null;
  renderPause();
}

function menuSelect(c) {
  const M = app.menu;
  if (!M) return;
  if (M.view === 'confirm') {
    if (M.confirm === 1) { if (M.action === 'quit') toLobby(); else restartMatch(); return; }
    M.view = 'main';
    return renderPause();
  }
  if (M.view !== 'main') return;
  const item = MENU[M.cursor];
  switch (item.id) {
    case 'resume': return togglePause(null);
    case 'subs': {
      const who = c && c.slotted ? c : input.list[0];
      if (!who) { banner('NO PLAYERS', 'Join with a pad to make changes', true, 1200); break; }
      M.view = 'subs';
      openSubs(who);
      break;
    }
    case 'controls': M.view = 'controls'; break;
    case 'camera': camMode = CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]; break;
    case 'tags': tagMode = TAG_MODES[(TAG_MODES.indexOf(tagMode) + 1) % TAG_MODES.length]; break;
    case 'sound': sfx.toggleMute(); break;
    case 'restart': case 'quit': M.view = 'confirm'; M.action = item.id; M.confirm = 0; break;
  }
  renderPause();
}

function restartMatch() {
  app.mode = 'lobby';
  app.menu = null;
  $('pause').classList.add('hidden');
  startMatch();
}

const BTN_SYM = { cross: '✕', circle: '○', square: '□', triangle: '△', l1: 'L1', r1: 'R1' };
function controlsTable() {
  const ctxs = [['attack', 'With the ball'], ['defend', 'Without the ball'], ['throwIn', 'Throw-in']];
  return `<div class="ctl-grid">${ctxs.map(([ctx, title]) => `<div class="ctl-col"><h4>${title}</h4>${
    Object.entries(controls.json[ctx] || {}).map(([k, a]) => {
      const [btn, mod] = k.split('+');
      return `<div class="ctl-row"><span class="bsym b-${btn}">${BTN_SYM[btn] || btn}</span>${mod ? '<span class="swipe">swipe</span>' : ''}<span>${escapeHtml(controls.labelsOf[a] || a)}</span></div>`;
    }).join('')}</div>`).join('')}</div>
    <div class="ctl-note">Stick: move · push past the ring: sprint. Remap in <code>data/controls/football.json</code></div>`;
}

function renderPause() {
  const M = app.menu;
  if (!M) return;
  const m = app.match;
  const [h, a] = m.teams;
  const total = (h.stats.poss + a.stats.poss) || 1;
  const ph = Math.round((h.stats.poss / total) * 100);
  const mins = Math.floor((m.clock / m.duration) * 90);
  $('pHead').innerHTML = `
    <div class="ps-team"><span class="kit" style="background:linear-gradient(${h.club.kit.shirt} 60%, ${h.club.kit.shorts} 60%)"></span>${escapeHtml(h.club.name)}</div>
    <div class="ps-score">${h.score}<i>–</i>${a.score}<small>${mins}'</small></div>
    <div class="ps-team r">${escapeHtml(a.club.name)}<span class="kit" style="background:linear-gradient(${a.club.kit.shirt} 60%, ${a.club.kit.shorts} 60%)"></span></div>`;
  const stat = (label, x, y, pct) => `<div class="pst"><b>${x}</b><div class="pbar"><i style="width:${pct ?? (x + y ? (x / (x + y)) * 100 : 50)}%"></i></div><span>${label}</span><div class="pbar r"><i style="width:${pct !== undefined ? 100 - pct : x + y ? (y / (x + y)) * 100 : 50}%"></i></div><b>${y}</b></div>`;
  $('pStats').innerHTML = stat('Possession', `${ph}%`, `${100 - ph}%`, ph) + stat('Shots', h.stats.shots, a.stats.shots) +
    stat('Fouls', h.stats.fouls, a.stats.fouls) + stat('Subs left', h.subsLeft, a.subsLeft);
  $('pausedBy').textContent = M.by ? `Paused by P${M.by.slot + 1} ${M.by.label}` : '';
  $('pMenu').innerHTML = MENU.map((it, i) => `<div class="mi ${i === M.cursor ? 'sel' : ''}" data-i="${i}">
      <span>${it.label}</span>${it.value ? `<em>${escapeHtml(String(it.value()))}</em>` : ''}</div>`).join('');
  for (const el of $('pMenu').children) el.addEventListener('click', () => { M.cursor = Number(el.dataset.i); M.view = 'main'; app.subs = null; menuSelect(input.list[0] || null); });
  const side = $('pSide');
  side.className = 'pside';
  if (M.view === 'controls') side.innerHTML = `<h3>CONTROLS</h3>${controlsTable()}`;
  else if (M.view === 'confirm') side.innerHTML = `<h3>${M.action === 'quit' ? 'QUIT TO MENU?' : 'RESTART MATCH?'}</h3>
      <p>The score so far will be lost.</p><div class="confirm"><div class="mi ${M.confirm === 0 ? 'sel' : ''}">No</div><div class="mi ${M.confirm === 1 ? 'sel' : ''}">Yes</div></div>`;
  else if (M.view === 'subs') side.innerHTML = '';
  else side.className = 'pside hidden';
  renderSubs();
  $('pHelp').innerHTML = M.view === 'main'
    ? '<b>▲▼</b> choose · <b>✕</b> select · <b>○</b> resume'
    : '<b>▲▼</b> choose · <b>✕</b> select · <b>○</b> back';
}

// --------------------------------------------------------- substitutions --
// From the pause menu: pick who comes off, then who comes on.
function openSubs(c) {
  const team = app.match.teams[c.team];
  app.subs = { c, team, stage: 'off', cursor: 0, off: null };
}

function subsInput(ev) {
  const S = app.subs;
  if (ev.bit === BTN.CIRCLE) {
    if (S.stage === 'on') { S.stage = 'off'; S.cursor = S.team.players.indexOf(S.off); }
    else { app.subs = null; app.menu.view = 'main'; }
  } else if (ev.bit === BTN.CROSS) {
    if (S.stage === 'off') {
      S.off = S.team.players[S.cursor];
      if (S.team.subsLeft > 0 && S.team.bench.length) { S.stage = 'on'; S.cursor = 0; }
    } else {
      const inData = S.team.bench[S.cursor];
      // a keeper can only be replaced by a keeper (and only a keeper goes in goal)
      if (inData && (S.off.slot.role === 'GK') === (inData.pos === 'GK')) {
        app.match.substitute(S.team, S.off, inData);
        S.stage = 'off';
        S.cursor = 0;
      }
    }
  }
  renderPause();
}

function renderSubs() {
  const el = $('subs');
  const S = app.subs;
  if (!S) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const bar = (v) => `<span class="sbar"><i style="width:${Math.round(v * 100)}%;background:${v > 0.6 ? '#22c55e' : v > 0.35 ? '#facc15' : '#ef4444'}"></i></span>`;
  const on = S.team.players.map((p, i) => `<div class="srow ${S.stage === 'off' && i === S.cursor ? 'sel' : ''} ${p === S.off ? 'off' : ''}">
      <b>${p.number}</b> ${escapeHtml(p.name)} <em>${p.role}</em> ${bar(p.energy)}</div>`).join('');
  const bench = S.team.bench.map((d, i) => `<div class="srow ${S.stage === 'on' && i === S.cursor ? 'sel' : ''}">
      <b>${d.number}</b> ${escapeHtml(d.name)} <em>${d.pos}</em> <small>PAC ${d.pace} DRI ${d.dribbling} STA ${d.stamina ?? '-'}</small></div>`).join('') || '<div class="srow"><em>No one left</em></div>';
  el.innerHTML = `<div class="shead">${escapeHtml(S.team.club.name)} · substitutions left: ${S.team.subsLeft}</div>
    <div class="scols"><div><h4>ON THE PITCH ${S.stage === 'off' ? '— who comes off?' : ''}</h4>${on}</div>
    <div><h4>BENCH ${S.stage === 'on' ? '— who comes on?' : ''}</h4>${bench}</div></div>`;
}

function pauseInput() {
  for (const c of input.list) {
    const f = c.flickY();
    if (app.subs) {
      if (f && app.subs.c === c) {
        const n = app.subs.stage === 'off' ? app.subs.team.players.length : app.subs.team.bench.length;
        app.subs.cursor = (app.subs.cursor + f + n) % Math.max(1, n);
        renderPause();
      }
    } else if (f) menuMove(f);
    else if (app.menu?.view === 'confirm' && c.flick()) menuMove(1);
    for (const ev of c.drain()) {
      if (!ev.down || app.mode !== 'paused') continue;
      if (app.subs) { if (app.subs.c === c) subsInput(ev); continue; }
      if (ev.bit === BTN.CROSS) menuSelect(c);
      else if (ev.bit === BTN.CIRCLE) menuBack();
    }
  }
}

// ----------------------------------------------------------- pad sync ----
function syncPads() {
  for (const c of input.list) {
    if (c.kind !== 'pad') continue;
    const club = clubs[c.team === 0 ? app.home : app.away];
    let labels, hint;
    const none = { cross: '', circle: '', square: '', triangle: '', l1: '', r1: '' };
    if (app.mode === 'lobby') {
      labels = { ...none, cross: 'Kick off', circle: 'Games', square: 'Swap side' };
      hint = 'Stick ◀ ▶ changes your club';
    } else if (app.mode === 'paused') {
      const mine = !app.subs || app.subs.c === c;
      labels = mine ? { ...none, cross: 'Select', circle: app.menu?.view === 'main' ? 'Resume' : 'Back' } : none;
      hint = app.subs ? (mine ? 'Substitutions: stick ▲▼ to choose' : 'Substitutions…') : 'Paused: stick ▲▼ to choose';
    } else if (app.mode === 'fulltime') {
      labels = { ...none, cross: 'Menu' };
      const [h, a] = app.match.teams;
      hint = `Full time: ${h.club.short} ${h.score} - ${a.score} ${a.club.short}`;
    } else {
      const m = app.match;
      const has = c.player && m.ball.owner === c.player;
      const throwIn = has && c.player.frozen && m.setPieceKind === 'throw';
      labels = controls.labels(throwIn ? 'throwIn' : has ? 'attack' : 'defend');
      hint = c.player ? `${c.player.name} #${c.player.number}` : '';
    }
    const msg = {
      t: 'pad', label: `P${c.slot + 1}`, color: c.color, club: club.name, clubColor: club.kit.shirt,
      labels, hint, charge: c.charge >= 0 ? Math.round(Math.min(1, c.charge / 0.9) * 10) / 10 : -1,
    };
    const s = JSON.stringify(msg);
    if (s !== c.lastSent) {
      c.lastSent = s;
      input.send(c, msg);
    }
  }
}

// ------------------------------------------- name tags + player markers ----
// nameTags: 'all' | 'active' (controlled players + ball carrier) | 'none'
const TAG_MODES = ['all', 'active', 'none'];
let tagMode = TAG_MODES.includes(settings.nameTags) ? settings.nameTags : 'all';
const markers = new Map();
const ringGeo = new THREE.RingGeometry(0.6, 0.82, 32);
ringGeo.rotateX(-Math.PI / 2);

function marker(c) {
  const name = c.player ? c.player.name.toUpperCase() : '';
  const key = `${c.slot}|${c.color}|${name}`;
  let m = markers.get(c);
  if (m && m.key === key) return m;
  if (m) scene.remove(m.group);
  const group = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.95, depthWrite: false }));
  ring.position.y = 0.03;
  ring.renderOrder = 2;
  const label = makeLabel(`P${c.slot + 1} ${name}`, { bg: c.color, height: 0.016 });
  group.add(ring, label);
  scene.add(group);
  m = { key, group, ring, label };
  markers.set(c, m);
  return m;
}

let t = 0;
function updateMarkers() {
  const m = app.match;
  const active = new Set(!frontEnd() ? input.list.filter((c) => c.player) : []);
  for (const [c, mk] of markers) mk.group.visible = active.has(c);
  for (const c of active) {
    const mk = marker(c);
    const p = c.player;
    mk.group.visible = true;
    mk.ring.position.set(p.x, 0.03, p.z);
    mk.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    mk.label.position.set(p.x, 2.2, p.z);
  }
  const showAll = !frontEnd() && tagMode === 'all';
  for (const p of m.all) {
    p.model.tag.visible = !frontEnd() && !p.human && (showAll || (tagMode === 'active' && m.ball.owner === p));
  }
}

// ------------------------------------------------------------- camera ----
const CAMERAS = {
  // sees the whole width of the pitch (touchline to touchline) and pans along its length
  full: { label: 'FULL-WIDTH CAM', full: true, height: 30, back: 28 },
  broadcast: { label: 'BROADCAST CAM', fov: 19, height: 13, back: 46, followZ: 0.45, lookZ: 0.9 },
  wide: { label: 'WIDE CAM', fov: 24, height: 30, back: 66, followZ: 0.25, lookZ: 0.7 },
  close: { label: 'CLOSE CAM', fov: 22, height: 9, back: 30, followZ: 0.6, lookZ: 0.95 },
};
const CAM_ORDER = Object.keys(CAMERAS);
let camMode = CAMERAS[settings.camera] ? settings.camera : 'full';
const cam = { x: 0, z: 0, vx: 0, vz: 0, zoom: 1 };

function updateCamera(dt) {
  const m = app.match;
  const b = m.ball;
  const cfg = CAMERAS[camMode];
  // lead the play a little in the direction the ball is travelling
  const tx = THREE.MathUtils.clamp(b.x + b.vx * 0.35, -L / 2 + 6, L / 2 - 6);
  const tz = THREE.MathUtils.clamp(b.z + b.vz * 0.2, -W / 2, W / 2);
  // critically damped follow (smooth, no overshoot)
  const w = 3.2;
  for (const [p, v, target] of [['x', 'vx', tx], ['z', 'vz', tz]]) {
    const acc = w * w * (target - cam[p]) - 2 * w * cam[v];
    cam[v] += acc * dt;
    cam[p] += cam[v] * dt;
  }
  const goalCam = m.state === 'goal' && m.stateT > 0.6;
  cam.zoom += ((goalCam ? 0.55 : 1) - cam.zoom) * Math.min(1, dt * 1.2);
  if (cfg.full) {
    // fit both touchlines in view: fov spans the angles down to the near and far lines
    const h = cfg.height, zc = W / 2 + cfg.back;
    const aNear = Math.atan2(h, zc - (W / 2 + 3));
    const aFar = Math.atan2(h, zc - (-W / 2 - 3));
    const mid = (aNear + aFar) / 2;
    camera.fov = THREE.MathUtils.radToDeg(aNear - aFar) * 1.08;
    camera.updateProjectionMatrix();
    // The near touchline is closest to the camera, so least of it fits across the screen.
    // Let the camera pan far enough that the near corner flags come into view at each end.
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const nearDepth = Math.hypot(h, zc - (W / 2 + 3)) * Math.cos(aNear - mid);
    const xMax = Math.max(0, L / 2 + 4 - nearDepth * tanH * 0.96);
    const x = THREE.MathUtils.clamp(cam.x, -xMax, xMax);
    camera.position.set(x, h, zc);
    camera.lookAt(x, 0, zc - h / Math.tan(mid));
    return;
  }
  camera.fov = cfg.fov;
  camera.updateProjectionMatrix();
  camera.position.set(cam.x, cfg.height * cam.zoom, cam.z * cfg.followZ + W / 2 + (cfg.back - W / 2) * cam.zoom);
  camera.lookAt(cam.x, 0, cam.z * cfg.lookZ);
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') {
    camMode = CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length];
    banner(CAMERAS[camMode].label, '', true, 900);
  } else if (e.code === 'KeyM') {
    banner(sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', true, 900);
  } else if (e.code === 'KeyN') {
    tagMode = TAG_MODES[(TAG_MODES.indexOf(tagMode) + 1) % TAG_MODES.length];
    banner(`NAMES: ${tagMode.toUpperCase()}`, '', true, 900);
  }
});

// --------------------------------------------------------------- loop ----
const STEP = 1 / 60;
let acc = 0, last = performance.now(), hudT = 0;

function step(dt) {
  t += dt;
  if (app.mode === 'lobby') lobbyInput();
  if (app.mode === 'paused') return pauseInput();
  if (app.mode === 'fulltime') {
    app.fulltimeT += dt;
    for (const c of input.list) for (const ev of c.drain()) {
      if (ev.down && app.fulltimeT > 2 && ev.bit === BTN.CROSS) { toLobby(); return; }
    }
  }
  app.match.update(dt);
}

// Cap the frame rate: on a 120Hz screen the browser would otherwise draw twice as often
// as it needs to (and spin the laptop's fans up).
const MIN_FRAME = 1000 / (settings.maxFps || 60) - 1;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
  }
  stadium.update(dt, app.match.state === 'goal' ? 1 : 0);
  updateCamera(dt);
  updateMarkers();
  hudT += dt;
  if (hudT > 0.05) {
    hudT = 0;
    syncPads();
    if (!frontEnd()) {
      updateClock();
      updateChips();
      drawRadar();
    }
  }
  renderer.render(scene, camera);
}

toLobby();
requestAnimationFrame(frame);
