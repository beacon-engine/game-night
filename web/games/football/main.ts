import * as THREE from 'three';
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, manualOpen, manualPadInput, manualScreen,
  PerformanceGuard, playerKey, requireDevice, showManual, starsLabel, type Button, type EarnFor, type PadScreen,
} from '@platform';
import { loadFootballControls, type Context } from './actions.ts';
import { Sfx } from './audio.ts';
import { Match, newHuman, type Human, type MatchEvent, type Player, type Team, type TeamSetup } from './match.ts';
import { loadPlayerAssets, makeLabel } from './player.ts';
import { buildStadium } from './stadium.ts';
import { cleanTactics, cycleTactic, DEFAULT_TACTICS, shapesFor, TACTIC_KEYS, tacticName, TACTICS, type Tactic, type Tactics } from './tactics.ts';
import { GRASS_DARKENS, WeatherLook } from '@world/precipitation.ts';
import { FORECASTS, Forecast, Weather } from '@world/weather.ts';
import { Footed, type CameraMode, type Club, type Formations, type PlayerData, type Settings, type TagMode, type TimeOfDay } from './types.ts';

// a heavy game: check this screen can take it before loading anything big (see game.json "needs")
const device = await requireDevice();

const load = <T>(file: string) => fetch(file, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);
const [settings, formations, clubs, controls] = await Promise.all([
  load<Settings>('settings.json'),
  load<Formations>('formations.json'),
  load<Club[]>('teams.json'),
  loadFootballControls(), // which button does what: controls.json
]);
const shapes = shapesFor(formations, settings.playersPerSide); // the first is the default
const SIZE = String(settings.playersPerSide);
const keepersOf = (club: Club) => club.players.filter((p) => p.pos === 'GK');
// every squad needs a keeper on the bench: a club in teams.json with only one gets a stand-in
for (const club of clubs) {
  for (const name of ['Reserve', 'Stand-in']) {
    if (keepersOf(club).length >= 2) break;
    const used = new Set(club.players.map((p) => p.number));
    let number = 13;
    while (used.has(number)) number++;
    club.players.push({ name, number, pos: 'GK', pace: 52, passing: 55, shooting: 30, tackling: 35, dribbling: 38, keeping: 64, stamina: 60 });
  }
}
// the brand fonts are drawn into textures (names, numbers, ad boards), so they must be loaded first
await Promise.all(['800 34px "Big Shoulders Display"', '600 16px Inter'].map((f) => document.fonts.load(f)));
await loadPlayerAssets(); // motion-captured player model (must be ready before any match)
const L = settings.pitch.length;
const W = settings.pitch.width;

// ------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('game'), antialias: true, powerPreference: 'high-performance' });
// retina at full 2x is a lot of pixels for a laptop GPU; 1.5x looks almost the same
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * (settings.renderScale || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.5, 900);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const stadium = buildStadium(scene, renderer, settings.pitch, settings.goal, clubs.slice(0, 4).map((c) => c.kit.shirt));
let timeOfDay: TimeOfDay = settings.timeOfDay === 'night' ? 'night' : 'day';
stadium.setTimeOfDay(timeOfDay);
const sfx = new Sfx();
for (const type of ['pointerdown', 'keydown'] as const) {
  addEventListener(type, () => { sfx.unlock(); $('sound').classList.add('hidden'); });
}

// -------------------------------------------------------------- state ----
type Mode = 'lobby' | 'match' | 'paused' | 'fulltime';
type MenuView = 'main' | 'subs' | 'tactics' | 'controls' | 'confirm';
interface Menu { cursor: number; view: MenuView; by: Human | null; confirm: 0 | 1; action?: 'restart' | 'quit' }
interface Subs { c: Human; team: Team; stage: 'off' | 'on'; cursor: number; off: Player | null }
interface TacticsView { c: Me; team: 0 | 1; row: number } // changing tactics from the pause menu

// How a side lines up: an index into `shapes`, its instructions, and who starts in goal
interface Plan { shape: number; tactics: Tactics; keeper: string }
const freshPlan = (club: Club): Plan => ({ shape: 0, tactics: DEFAULT_TACTICS, keeper: keepersOf(club)[0]?.name ?? '' });
// What a player's saves remember: their shape per side size, instructions, and keeper per club
interface Saved { shapes: Record<string, string>; tactics: Tactics; keepers: Record<string, string> }

const app = {
  mode: 'lobby' as Mode,
  home: 0, // club indexes
  away: 1,
  match: null as unknown as Match, // (made by toLobby() below, before the first frame)
  fulltimeT: 0,
  menu: null as Menu | null,
  subs: null as Subs | null,
  tac: null as TacticsView | null,
  plans: [freshPlan(clubs[0]), freshPlan(clubs[1])] as [Plan, Plan],
};
// row: where their cursor is in the lobby's team sheet; saved: what they chose last time
const input = new Input({ state: () => ({ ...newHuman(), row: 0, saved: null as Saved | null, loaded: false }) });
type Me = (typeof input.list)[number];
const saves = gameSaves();
const placed = new WeakSet<Human>(); // put on a team since they (re)joined
const frontEnd = () => app.mode === 'lobby'; // menus, with a demo match behind
Object.assign(window, { football: { app, input, renderer } }); // handy for poking at the game from the console

input.onJoin = (c) => {
  if (!placed.has(c)) {
    // join the side with fewer humans
    const counts = [0, 0];
    for (const o of input.list) if (o !== c) counts[o.team]++;
    c.team = counts[0] <= counts[1] ? 0 : 1;
    placed.add(c);
  }
  if (app.mode === 'match') app.match.addHuman(c);
  if (!c.loaded) {
    c.loaded = true;
    saves.get<Saved>(playerKey(c, 'tactics')).then((s) => {
      if (!s || c.saved) return; // (they already changed something while it loaded)
      c.saved = s;
      adopt(c);
    });
  }
  refreshLobby();
};
input.onLeave = (c) => {
  app.match.removeHuman(c);
  placed.delete(c);
  refreshLobby();
};
input.onRename = () => refreshLobby();
input.onPause = (c) => togglePause(c);

// The weather, chosen in the lobby (the match behind the menu has it too)
const SKIES = [Forecast.Dry, Forecast.Showers, Forecast.Rain, Forecast.Snow];
let forecast = Forecast.Dry;
const look = new WeatherLook(scene);
look.venue(stadium.grass, GRASS_DARKENS);

function newMatch(demo: boolean) {
  app.match?.dispose();
  const setup = (p: Plan): TeamSetup => ({ shape: shapes[p.shape].slots, tactics: p.tactics, keeper: p.keeper });
  app.match = new Match({
    scene, settings, controls, demo, onEvent,
    setups: [setup(app.plans[0]), setup(app.plans[1])],
    clubs: [clubs[app.home], clubs[app.away]],
    humans: demo ? [] : input.list,
  });
  const length = (settings.matchMinutes || 5) * 60;
  app.match.setWeather(forecast === Forecast.Dry ? null : new Weather(forecast, demo ? length * 4 : length));
  stadium.setSnow(forecast === Forecast.Snow);
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

function cycleClub(team: number, d: number) {
  const key = team === 0 ? 'home' : 'away';
  const other = team === 0 ? app.away : app.home;
  let i = app[key];
  do i = (i + d + clubs.length) % clubs.length; while (i === other);
  app[key] = i;
  app.plans[team].keeper = keeperFor(team as 0 | 1);
  newMatch(true);
  refreshLobby();
}

// ------------------------------------------------------------ tactics ----
// The team sheet: the lobby shows every row; mid-match the keeper changes through Substitutions
type Row = 'club' | 'shape' | 'keeper' | Tactic;
const LOBBY_ROWS: Row[] = ['club', 'shape', 'keeper', ...TACTIC_KEYS];
const MATCH_ROWS: Row[] = ['shape', ...TACTIC_KEYS];
const ROW_LABEL: Record<Row, string> = {
  club: 'Club', shape: 'Shape', keeper: 'In goal',
  ...(Object.fromEntries(TACTIC_KEYS.map((k) => [k, TACTICS[k].label])) as Record<Tactic, string>),
};
const clubOf = (team: number) => clubs[team === 0 ? app.home : app.away];

function rowValue(team: 0 | 1, row: Row) {
  const plan = app.plans[team];
  if (row === 'club') return clubOf(team).name;
  if (row === 'shape') return shapes[plan.shape].name;
  if (row === 'keeper') {
    const gk = keepersOf(clubOf(team)).find((k) => k.name === plan.keeper);
    return gk ? `${gk.name} (keeping ${gk.keeping ?? '-'})` : '—';
  }
  return tacticName(row, plan.tactics);
}

// Change one row of a side's plan: in the lobby (the match behind the menu follows it), or mid-match
function changePlan(team: 0 | 1, row: Row, d: number, by: Me | null) {
  const plan = app.plans[team];
  const t = app.match.teams[team];
  if (row === 'club') return cycleClub(team, d);
  if (row === 'shape') {
    plan.shape = (plan.shape + d + shapes.length) % shapes.length;
    app.match.setShape(t, shapes[plan.shape].slots);
  } else if (row === 'keeper') {
    const ks = keepersOf(clubOf(team));
    if (ks.length < 2 || app.mode !== 'lobby') return;
    const i = ks.findIndex((k) => k.name === plan.keeper);
    plan.keeper = ks[(i + d + ks.length) % ks.length].name;
    newMatch(true);
  } else {
    plan.tactics = cycleTactic(plan.tactics, row, d);
    t.instruct(plan.tactics);
  }
  if (by) remember(by);
  if (app.mode === 'lobby') refreshLobby();
  else renderPause();
}

// The keeper a side starts with: one of its players' saved choice for this club, or the first
function keeperFor(team: 0 | 1) {
  const club = clubOf(team);
  const ks = keepersOf(club);
  for (const c of input.list) {
    const name = c.team === team ? c.saved?.keepers?.[club.short] : undefined;
    if (ks.some((k) => k.name === name)) return name!;
  }
  return ks[0]?.name ?? '';
}

// A player alone on a side brings their saved plan with them
function adopt(c: Me) {
  const s = c.saved;
  if (!s || app.mode !== 'lobby' || input.list.some((o) => o !== c && o.team === c.team)) return;
  const plan = app.plans[c.team];
  const i = shapes.findIndex((f) => f.name === s.shapes?.[SIZE]);
  if (i >= 0) plan.shape = i;
  plan.tactics = cleanTactics(s.tactics);
  plan.keeper = keeperFor(c.team);
  newMatch(true);
  refreshLobby();
}

const saveTimers = new Map<Me, ReturnType<typeof setTimeout>>();
function remember(c: Me) {
  const plan = app.plans[c.team];
  const prev = c.saved;
  const saved: Saved = {
    shapes: { ...prev?.shapes, [SIZE]: shapes[plan.shape].name },
    tactics: plan.tactics,
    keepers: { ...prev?.keepers, [clubOf(c.team).short]: plan.keeper },
  };
  c.saved = saved;
  // (saved once they stop flicking through the options)
  clearTimeout(saveTimers.get(c));
  saveTimers.set(c, setTimeout(() => saves.set(playerKey(c, 'tactics'), saved), 800));
}

const cursorTag = (c: Me) => `<span class="ptag" style="background:${c.color}">${c.tag}</span>`;
const valueHtml = (team: 0 | 1, row: Row, sel: boolean) =>
  sel ? `<span class="arr">◀</span>${escapeHtml(rowValue(team, row))}<span class="arr">▶</span>` : escapeHtml(rowValue(team, row));

// ------------------------------------------------------------- events ----
function onEvent(e: MatchEvent) {
  const demo = app.match?.demo;
  switch (e.type) {
    case 'kick': sfx.kick(e.power); break;
    case 'post': sfx.clang(); break;
    case 'net': stadium.netHit(e.x, e.y, e.z, e.speed); break;
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
      input.buzz(e.victim.human, 150);
      break;
    }
    case 'sub':
      if (!demo) banner('SUBSTITUTION', `${e.team.club.short}: ${e.on.name} on · ${e.off.name} off`, true, 2200);
      if (app.subs) renderSubs();
      break;
    case 'sendoff': if (!demo) banner('SENT OFF', `${e.player.name} (${e.player.team.club.short})`, true, 1800); break;
    case 'shot': if (!demo) sfx.ooh(); break;
    case 'buzz': input.buzz(e.controller, e.ms); break;
    case 'tackle': input.buzz(e.controller, 80); break;
    case 'kickoff': if (!demo) sfx.whistle(); break;
    case 'banner': if (!demo) { sfx.whistle(); banner(e.text, '', true, 1200); } break;
    case 'goal':
      sfx.roar();
      if (demo) break;
      banner('<span class="hl-volt">Goal!</span>', e.own ? `Own goal · ${e.team.club.name}` : `${e.scorer} · ${e.team.club.name}`, false, 3000);
      for (const c of e.team.humans) input.buzz(c, 300);
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
      payOut(h, a);
      break;
    }
  }
}

// Stars for everyone who played the match, more for the winners; shown under the full-time score
function payOut(...teams: Team[]) {
  const paid: string[] = [];
  teams.forEach((t, i) => {
    const why: EarnFor[] = t.score > teams[1 - i].score ? ['played', 'won'] : ['played'];
    for (const c of t.humans) earnStars(c, why).then((got) => {
      if (!got?.earned || app.mode !== 'fulltime') return;
      paid.push(`${chip(c)} +${starsLabel(got.earned)}`);
      $('banner').querySelector('.stars')?.remove();
      $('banner').insertAdjacentHTML('beforeend', `<div class="sub stars">${paid.join(' ')}</div>`);
    });
  });
}

let bannerTimer = 0;
// `html` is trusted markup (our own text); `sub` is escaped
function banner(html: string, sub: string, small: boolean, ms: number) {
  const el = $('banner');
  el.innerHTML = `<div class="${small ? 'small' : 'big'}">${html}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}`;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --------------------------------------------------------------- HUD -----
const kitSwatch = (club: Club) => `linear-gradient(${club.kit.shirt} 60%, ${club.kit.shorts} 60%)`;
const energyColor = (e: number) => (e > 0.6 ? '#22c55e' : e > 0.35 ? '#facc15' : '#ef4444');

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
    el.innerHTML = list.map(() => '<div class="hud-row panel panel-glass"><span class="tag"></span><span class="who"></span><span class="stats"></span><span class="bars"><span class="sta" title="stamina"><div></div></span><span class="bar" title="shot power"><div></div></span></span></div>').join('');
  }
  list.forEach((c, i) => {
    const chip = el.children[i];
    const part = (sel: string) => chip.querySelector<HTMLElement>(sel)!;
    const tag = part('.tag');
    tag.textContent = c.tag;
    tag.style.background = c.color;
    const pl = c.player;
    part('.who').textContent = `${c.label} · ${pl ? pl.name : '—'}`;
    const e = pl ? pl.energy : 0;
    part('.sta > div').style.width = `${Math.round(e * 100)}%`;
    part('.sta > div').style.background = energyColor(e);
    part('.stats').textContent = pl
      ? `PAC ${pl.data.pace} SHO ${pl.data.shooting} PAS ${pl.data.passing} DRI ${pl.data.dribbling} TAC ${pl.data.tackling} · ${FOOT_TAG[pl.footed]}`
      : '';
    part('.bar > div').style.width = c.charge >= 0 ? `${Math.min(1, c.charge / 0.9) * 100}%` : '0';
  });
}

const radar = $<HTMLCanvasElement>('radar').getContext('2d')!;
function drawRadar() {
  const m = app.match;
  const cw = 232, ch = 146, pad = 8;
  const sx = (cw - pad * 2) / L, sz = (ch - pad * 2) / W;
  const X = (x: number) => pad + (x + L / 2) * sx;
  const Z = (z: number) => pad + (z + W / 2) * sz;
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
hostInfo().then((info) => {
  $('url').textContent = info.padUrl;
  $('qr').innerHTML = info.qr;
});

for (const b of document.querySelectorAll<HTMLElement>('.club button')) {
  b.addEventListener('click', () => cycleClub(Number(b.dataset.team), Number(b.dataset.d)));
}
$('start').addEventListener('click', startMatch);
$('back').addEventListener('click', backToHub);
$('howto').addEventListener('click', howTo);
$('tod').addEventListener('click', () => {
  timeOfDay = timeOfDay === 'day' ? 'night' : 'day';
  stadium.setTimeOfDay(timeOfDay);
  look.venue(stadium.grass, GRASS_DARKENS); // (the cloud starts again from the new light)
  $('tod').textContent = timeOfDay === 'day' ? 'Day' : 'Night';
});
$('sky').addEventListener('click', () => {
  forecast = SKIES[(SKIES.indexOf(forecast) + 1) % SKIES.length];
  $('sky').textContent = FORECASTS[forecast].name;
  if (app.mode === 'lobby') newMatch(true);
});

const FOOT_TAG: Record<Footed, string> = { [Footed.Right]: 'R foot', [Footed.Left]: 'L foot', [Footed.Both]: 'Both feet' };

function refreshLobby() {
  const h = clubs[app.home], a = clubs[app.away];
  $('lnameH').textContent = h.name;
  $('lnameA').textContent = a.name;
  $('lkitH').style.background = kitSwatch(h);
  $('lkitA').style.background = kitSwatch(a);
  for (const [team, id] of [[0, 'H'], [1, 'A']] as const) {
    const hs = input.list.filter((c) => c.team === team);
    $(`humans${id}`).innerHTML = hs.length ? hs.map(chip).join('') : '<em>Computer</em>';
    const at = (row: Row) => hs.filter((c) => LOBBY_ROWS[c.row] === row);
    $(`cur${id}`).innerHTML = at('club').map(cursorTag).join('');
    $(`club${id}`).classList.toggle('sel', at('club').length > 0);
    const note = at('shape').length ? shapes[app.plans[team].shape].note : '';
    $(`plan${id}`).innerHTML = LOBBY_ROWS.slice(1).map((row) => `<div class="prow ${at(row).length ? 'sel' : ''}" data-team="${team}" data-row="${row}">
        <span class="caption">${ROW_LABEL[row]}${at(row).map(cursorTag).join('')}</span><b>${valueHtml(team, row, at(row).length > 0)}</b></div>`).join('') +
      (note ? `<div class="pnote">${escapeHtml(note)}</div>` : '');
    for (const el of $(`plan${id}`).querySelectorAll<HTMLElement>('.prow')) {
      el.addEventListener('click', () => changePlan(team, el.dataset.row as Row, 1, null));
    }
  }
}

function howTo() { showManual('', 'Football'); }

function lobbyInput() {
  for (const c of input.list) {
    if (manualPadInput(c)) continue;
    // ▲▼ walks down the team sheet, ◀ ▶ changes the row you're on
    const fy = c.flickY();
    if (fy) { c.row = (c.row + fy + LOBBY_ROWS.length) % LOBBY_ROWS.length; refreshLobby(); }
    const f = c.flickX();
    if (f) changePlan(c.team, LOBBY_ROWS[c.row], f, c);
    for (const ev of c.drain()) {
      if (!ev.down) continue;
      if (ev.bit === BIT.bolt) startMatch();
      else if (ev.bit === BIT.leaf) { c.team = c.team ? 0 : 1; refreshLobby(); adopt(c); }
      else if (ev.bit === BIT.drop) return backToHub();
      else if (ev.bit === BIT.star) howTo();
    }
  }
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && app.mode === 'lobby') howTo();
  else if (code === 'Enter' && app.mode === 'lobby') startMatch();
  else if (code === 'Escape' && app.mode === 'lobby') backToHub();
  else if ((code === 'Escape' || code === 'KeyP') && app.mode === 'match') togglePause(null);
  else if ((code === 'Escape' || code === 'KeyP') && app.mode === 'paused') menuBack();
  else if (code === 'Enter' && app.mode === 'paused') menuSelect(input.list[0] || null);
  else if ((code === 'ArrowUp' || code === 'ArrowDown') && app.mode === 'paused' && !input.list.length) menuMove(code === 'ArrowUp' ? -1 : 1);
  else if (code === 'Escape' && app.mode === 'fulltime') toLobby();
});

// ------------------------------------------------------------- pause ------
// A menu driven by the stick: ▲▼ to move, Bolt to choose, Drop to go back. Anyone can drive it.
const MENU = [
  { id: 'resume', label: 'Resume' },
  { id: 'subs', label: 'Substitutions' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'controls', label: 'Controls' },
  { id: 'camera', label: 'Camera', value: () => CAMERAS[camMode].label },
  { id: 'tags', label: 'Name tags', value: () => tagMode },
  { id: 'sound', label: 'Sound', value: () => (sfx.muted ? 'Off' : 'On') },
  { id: 'restart', label: 'Restart match' },
  { id: 'quit', label: 'Quit to menu' },
] as const;

function togglePause(by: Human | null) {
  if (app.mode === 'match') {
    app.mode = 'paused';
    app.subs = null;
    app.tac = null;
    app.menu = { cursor: 0, view: 'main', by, confirm: 0 };
    $('pause').classList.remove('hidden');
    renderPause();
  } else if (app.mode === 'paused') {
    app.mode = 'match';
    app.subs = null;
    app.tac = null;
    app.menu = null;
    $('pause').classList.add('hidden');
  }
  for (const c of input.list) { c.drain(); c.charge = -1; c.armed = null; }
}

function menuMove(d: number) {
  const M = app.menu;
  if (!M) return;
  if (M.view === 'main') M.cursor = (M.cursor + d + MENU.length) % MENU.length;
  else if (M.view === 'confirm') M.confirm = M.confirm ? 0 : 1;
  renderPause();
}

function menuBack() {
  const M = app.menu;
  if (!M) return;
  if (M.view === 'main') return togglePause(null);
  M.view = 'main';
  app.subs = null;
  app.tac = null;
  renderPause();
}

function menuSelect(c: Human | null) {
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
    case 'subs': case 'tactics': {
      const who = c && placed.has(c) ? (c as Me) : input.list[0];
      if (!who) { banner('NO PLAYERS', 'Join with a pad to make changes', true, 1200); break; }
      M.view = item.id;
      if (item.id === 'subs') openSubs(who);
      else app.tac = { c: who, team: who.team, row: 0 };
      break;
    }
    case 'controls': M.view = 'controls'; break;
    case 'camera': camMode = next(CAM_ORDER, camMode); break;
    case 'tags': tagMode = next(TAG_MODES, tagMode); break;
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

function controlsTable() {
  const ctxs: [Context, string][] = [['attack', 'With the ball'], ['defend', 'Without the ball'], ['throwIn', 'Throw-in']];
  return `<div class="ctl-grid">${ctxs.map(([ctx, title]) => `<div class="ctl-col"><h4 class="caption">${title}</h4>${
    controls.bindings(ctx).map(([key, a]) => {
      const [btn, mod] = key.split('+') as [Button, string?];
      return `<div class="ctl-row">${glyph(btn)}${mod ? '<span class="swipe">swipe</span>' : ''}<span>${escapeHtml(controls.name(a))}</span></div>`;
    }).join('')}</div>`).join('')}</div>
    <div class="ctl-note">Stick: move · push past the ring: sprint · to the side just after a kick: bend it. Remap in <code>games/football/controls.json</code></div>`;
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
    <div class="ps-team"><span class="kit" style="background:${h.club.kit.shirt}"></span>${escapeHtml(h.club.name)}</div>
    <div class="ps-score num">${h.score}<i>–</i>${a.score}<small>${mins}'</small></div>
    <div class="ps-team">${escapeHtml(a.club.name)}<span class="kit" style="background:${a.club.kit.shirt}"></span></div>`;
  $('pStats').style.setProperty('--home', h.club.kit.shirt);
  $('pStats').style.setProperty('--away', a.club.kit.shirt);
  // one stat row: the bars split by share, or by `pct` (home's share) when given
  const stat = (label: string, x: number | string, y: number | string, pct?: number) => {
    const share = pct ?? (+x + +y ? (+x / (+x + +y)) * 100 : 50);
    return `<div class="pst"><b>${x}</b><div class="pbar"><i style="width:${share}%"></i></div><span class="caption">${label}</span><div class="pbar r"><i style="width:${100 - share}%"></i></div><b>${y}</b></div>`;
  };
  $('pStats').innerHTML = stat('Possession', `${ph}%`, `${100 - ph}%`, ph) + stat('Shots', h.stats.shots, a.stats.shots) +
    stat('Fouls', h.stats.fouls, a.stats.fouls) + stat('Subs left', h.subsLeft, a.subsLeft);
  $('pausedBy').textContent = M.by ? `Paused by ${M.by.tag} ${M.by.label}` : '';
  $('pMenu').innerHTML = MENU.map((it, i) => `<div class="mi ${i === M.cursor ? 'sel' : ''}" data-i="${i}">
      <span>${it.label}</span>${'value' in it ? `<em>${escapeHtml(it.value())}</em>` : ''}</div>`).join('');
  for (const el of $('pMenu').children as HTMLCollectionOf<HTMLElement>) {
    el.addEventListener('click', () => { M.cursor = Number(el.dataset.i); M.view = 'main'; app.subs = app.tac = null; menuSelect(input.list[0] || null); });
  }
  const side = $('pSide');
  side.className = 'pside panel';
  if (M.view === 'controls') side.innerHTML = `<h3 class="h3">Controls</h3>${controlsTable()}`;
  else if (M.view === 'confirm') side.innerHTML = `<h3 class="h3">${M.action === 'quit' ? 'Quit to the lobby?' : 'Restart the match?'}</h3>
      <p>The score so far will be lost.</p><div class="confirm"><div class="mi ${M.confirm === 0 ? 'sel' : ''}">No</div><div class="mi ${M.confirm === 1 ? 'sel' : ''}">Yes</div></div>`;
  else if (M.view === 'tactics' && app.tac) side.innerHTML = tacticsPane(app.tac);
  else if (M.view === 'subs') side.innerHTML = '';
  else side.className = 'pside panel hidden';
  renderSubs();
  $('pHelp').innerHTML = M.view === 'tactics'
    ? `<span>${glyph('dpad')} ▲▼ choose · ◀ ▶ change</span><span>${glyph('bolt')} Next option</span><span>${glyph('drop')} Back</span>`
    : `<span>${glyph('dpad')} Choose</span><span>${glyph('bolt')} Select</span><span>${glyph('drop')} ${M.view === 'main' ? 'Resume' : 'Back'}</span>`;
}

function tacticsPane(T: TacticsView) {
  const team = app.match.teams[T.team];
  const gk = team.players.find((p) => p.role === 'GK');
  const rows = MATCH_ROWS.map((row, i) => `<div class="mi tac ${i === T.row ? 'sel' : ''}"><span>${ROW_LABEL[row]}</span><em>${valueHtml(T.team, row, i === T.row)}</em></div>`).join('');
  const note = MATCH_ROWS[T.row] === 'shape' ? shapes[app.plans[T.team].shape].note : '';
  return `<h3 class="h3">Tactics · ${escapeHtml(team.club.name)}</h3>${rows}
    <p class="tnote">${note ? escapeHtml(note) : '&nbsp;'}</p>
    <p class="faint">In goal: ${escapeHtml(gk?.name ?? '—')}. To change keeper, use Substitutions (a keeper only comes off for a keeper).</p>`;
}

// --------------------------------------------------------- substitutions --
// From the pause menu: pick who comes off, then who comes on.
function openSubs(c: Human) {
  app.subs = { c, team: app.match.teams[c.team], stage: 'off', cursor: 0, off: null };
}

function subsInput(S: Subs, bit: number) {
  if (bit === BIT.drop) {
    if (S.stage === 'on' && S.off) { S.stage = 'off'; S.cursor = S.team.players.indexOf(S.off); }
    else { app.subs = null; if (app.menu) app.menu.view = 'main'; }
  } else if (bit === BIT.bolt) {
    if (S.stage === 'off') {
      S.off = S.team.players[S.cursor];
      if (S.team.subsLeft > 0 && S.team.bench.length) { S.stage = 'on'; S.cursor = 0; }
    } else if (S.off) {
      const inData: PlayerData | undefined = S.team.bench[S.cursor];
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
  const bar = (v: number) => `<span class="sbar"><i style="width:${Math.round(v * 100)}%;background:${energyColor(v)}"></i></span>`;
  const on = S.team.players.map((p, i) => `<div class="srow ${S.stage === 'off' && i === S.cursor ? 'sel' : ''} ${p === S.off ? 'off' : ''}">
      <b>${p.number}</b> ${escapeHtml(p.name)} <em>${p.role}</em> ${bar(p.energy)}</div>`).join('');
  // a keeper only swaps for a keeper: grey out who can't come on for the man going off
  const fits = (d: PlayerData) => !S.off || (S.off.role === 'GK') === (d.pos === 'GK');
  const bench = S.team.bench.map((d, i) => `<div class="srow ${S.stage === 'on' && i === S.cursor ? 'sel' : ''} ${S.stage === 'on' && !fits(d) ? 'no' : ''}">
      <b>${d.number}</b> ${escapeHtml(d.name)} <em>${d.pos}</em> <small>PAC ${d.pace} DRI ${d.dribbling} STA ${d.stamina ?? '-'}</small></div>`).join('') || '<div class="srow"><em>No one left</em></div>';
  el.innerHTML = `<div class="shead"><span class="h3">${escapeHtml(S.team.club.name)}</span><span class="caption">${S.team.subsLeft} changes left</span></div>
    <div class="scols"><div><h4 class="caption">On the pitch ${S.stage === 'off' ? '· <span class="hl-volt">who comes off?</span>' : ''}</h4>${on}</div>
    <div><h4 class="caption">Bench ${S.stage === 'on' ? '· <span class="hl-volt">who comes on?</span>' : ''}</h4>${bench}</div></div>`;
}

function pauseInput() {
  for (const c of input.list) {
    const f = c.flickY();
    const S = app.subs, T = app.tac;
    if (S) {
      if (f && S.c === c) {
        const n = S.stage === 'off' ? S.team.players.length : S.team.bench.length;
        S.cursor = (S.cursor + f + n) % Math.max(1, n);
        renderPause();
      }
    } else if (T) {
      if (T.c === c) {
        if (f) { T.row = (T.row + f + MATCH_ROWS.length) % MATCH_ROWS.length; renderPause(); }
        const fx = c.flickX();
        if (fx) changePlan(T.team, MATCH_ROWS[T.row], fx, c);
      }
    } else if (f) menuMove(f);
    else if (app.menu?.view === 'confirm' && c.flickX()) menuMove(1);
    for (const ev of c.drain()) {
      if (!ev.down || app.mode !== 'paused') continue;
      if (app.subs) { if (app.subs.c === c) subsInput(app.subs, ev.bit); continue; }
      if (app.tac) {
        if (app.tac.c !== c) continue;
        if (ev.bit === BIT.bolt) changePlan(app.tac.team, MATCH_ROWS[app.tac.row], 1, c);
        else if (ev.bit === BIT.drop) menuBack();
        continue;
      }
      if (ev.bit === BIT.bolt) menuSelect(c);
      else if (ev.bit === BIT.drop) menuBack();
    }
  }
}

// ----------------------------------------------------------- pad sync ----
// What each phone shows: menus, or what the buttons do right now in the match
function padScreen(c: Me): PadScreen {
  const club = clubs[c.team === 0 ? app.home : app.away];
  // menus use the d-pad; the match uses the stick
  const screen = { layout: 'dpad' as const, label: c.tag, color: c.color, title: club.name, accent: club.kit.shirt };
  if (app.mode === 'lobby') {
    if (manualOpen()) return manualScreen(screen);
    const row = LOBBY_ROWS[c.row];
    return {
      ...screen,
      labels: { bolt: 'Kick off', drop: 'Games', leaf: 'Swap side', star: 'How to play' },
      hint: `◀ ▶ ${ROW_LABEL[row]}: ${rowValue(c.team, row)} · ▲▼ choose`,
    };
  }
  if (app.mode === 'paused') {
    const T = app.tac;
    const mine = (!app.subs || app.subs.c === c) && (!T || T.c === c);
    const hint = app.subs ? (mine ? 'Substitutions: ▲▼ to choose' : 'Substitutions…')
      : T ? (mine ? `◀ ▶ ${ROW_LABEL[MATCH_ROWS[T.row]]}: ${rowValue(T.team, MATCH_ROWS[T.row])} · ▲▼ choose` : 'Tactics…')
      : 'Paused: ▲▼ to choose';
    return {
      ...screen,
      labels: mine ? { bolt: T ? 'Change' : 'Select', drop: app.menu?.view === 'main' ? 'Resume' : 'Back' } : {},
      hint,
    };
  }
  if (app.mode === 'fulltime') {
    const [h, a] = app.match.teams;
    return { ...screen, labels: { bolt: 'Menu' }, hint: `Full time: ${h.club.short} ${h.score} - ${a.score} ${a.club.short}` };
  }
  const p = c.player;
  return {
    ...screen,
    layout: 'stick',
    labels: controls.labels(p ? app.match.humanContext(p) : 'defend'),
    hint: p ? `${p.name} #${p.number}` : '',
    charge: c.charge >= 0 ? Math.round(Math.min(1, c.charge / 0.9) * 10) / 10 : undefined,
  };
}

// ------------------------------------------- name tags + player markers ----
const next = <T>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];
const TAG_MODES: TagMode[] = ['all', 'active', 'none']; // active: controlled players + ball carrier
let tagMode: TagMode = settings.nameTags && TAG_MODES.includes(settings.nameTags) ? settings.nameTags : 'all';

interface Marker { key: string; group: THREE.Group; ring: THREE.Mesh; label: THREE.Sprite }
const markers = new Map<Human, Marker>();
const ringGeo = new THREE.RingGeometry(0.6, 0.82, 32);
ringGeo.rotateX(-Math.PI / 2);

function marker(c: Human) {
  const name = c.player ? c.player.name.toUpperCase() : '';
  const key = `${c.tag}|${name}`;
  let m = markers.get(c);
  if (m?.key === key) return m;
  if (m) scene.remove(m.group);
  const group = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.95, depthWrite: false }));
  ring.position.y = 0.03;
  ring.renderOrder = 2;
  const label = makeLabel(`${c.tag} ${name}`, { bg: c.color, height: 0.016 });
  group.add(ring, label);
  scene.add(group);
  m = { key, group, ring, label };
  markers.set(c, m);
  return m;
}

let t = 0;
function updateMarkers() {
  const m = app.match;
  const active = new Set<Human>(!frontEnd() ? input.list.filter((c) => c.player) : []);
  for (const [c, mk] of markers) mk.group.visible = active.has(c);
  for (const c of active) {
    const mk = marker(c);
    const p = c.player!;
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
interface Cam { label: string; full?: boolean; fov?: number; height: number; back: number; followZ?: number; lookZ?: number }
const CAMERAS: Record<CameraMode, Cam> = {
  // sees the whole width of the pitch (touchline to touchline) and pans along its length
  full: { label: 'FULL-WIDTH CAM', full: true, height: 30, back: 28 },
  broadcast: { label: 'BROADCAST CAM', fov: 19, height: 13, back: 46, followZ: 0.45, lookZ: 0.9 },
  wide: { label: 'WIDE CAM', fov: 24, height: 30, back: 66, followZ: 0.25, lookZ: 0.7 },
  close: { label: 'CLOSE CAM', fov: 22, height: 9, back: 30, followZ: 0.6, lookZ: 0.95 },
};
const CAM_ORDER = Object.keys(CAMERAS) as CameraMode[];
let camMode: CameraMode = settings.camera && settings.camera in CAMERAS ? settings.camera : 'full';
const cam = { x: 0, z: 0, vx: 0, vz: 0, zoom: 1 };

function updateCamera(dt: number) {
  const m = app.match;
  const b = m.ball;
  const cfg = CAMERAS[camMode];
  // lead the play a little in the direction the ball is travelling
  const tx = THREE.MathUtils.clamp(b.x + b.vx * 0.35, -L / 2 + 6, L / 2 - 6);
  const tz = THREE.MathUtils.clamp(b.z + b.vz * 0.2, -W / 2, W / 2);
  // critically damped follow (smooth, no overshoot)
  const w = 3.2;
  for (const [p, v, target] of [['x', 'vx', tx], ['z', 'vz', tz]] as const) {
    cam[v] += (w * w * (target - cam[p]) - 2 * w * cam[v]) * dt;
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
  camera.fov = cfg.fov!;
  camera.updateProjectionMatrix();
  camera.position.set(cam.x, cfg.height * cam.zoom, cam.z * cfg.followZ! + W / 2 + (cfg.back - W / 2) * cam.zoom);
  camera.lookAt(cam.x, 0, cam.z * cfg.lookZ!);
}

addEventListener('keydown', (e) => {
  const code = keyCode(e);
  if (code === 'KeyC') {
    camMode = next(CAM_ORDER, camMode);
    banner(CAMERAS[camMode].label, '', true, 900);
  } else if (code === 'KeyM') {
    banner(sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '', true, 900);
  } else if (code === 'KeyN') {
    tagMode = next(TAG_MODES, tagMode);
    banner(`NAMES: ${tagMode.toUpperCase()}`, '', true, 900);
  }
});

// --------------------------------------------------------------- loop ----
const STEP = 1 / 60;
let acc = 0, last = performance.now(), hudT = 0;

function step(dt: number) {
  t += dt;
  if (app.mode === 'lobby') lobbyInput();
  if (app.mode === 'paused') return pauseInput();
  if (app.mode === 'fulltime') {
    app.fulltimeT += dt;
    for (const c of input.list) for (const ev of c.drain()) {
      if (ev.down && app.fulltimeT > 2 && ev.bit === BIT.bolt) return toLobby();
    }
  }
  app.match.update(dt);
}

// Cap the frame rate: on a 120Hz screen the browser would otherwise draw twice as often
// as it needs to (and spin the laptop's fans up). On a TV, a steady 30 is kinder than a ragged 60.
const maxFps = Math.min(settings.maxFps || 60, device.tv ? 30 : 60);
const MIN_FRAME = 1000 / maxFps - 1;

// If it can't keep up: lower the resolution, then drop shadows, then stop rather than grind
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle(level) {
    if (level === 1) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
      resize();
    } else {
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = false; });
    }
    banner('Keeping it smooth', 'Turned the detail down a little', true, 1800);
  },
});
guard.watchCanvas(renderer.domElement);
function frame(now: number) {
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
  look.update(dt, app.match.weatherNow);
  updateCamera(dt);
  updateMarkers();
  hudT += dt;
  if (hudT > 0.05) {
    hudT = 0;
    for (const c of input.list) input.show(c, padScreen(c));
    if (!frontEnd()) {
      updateClock();
      updateChips();
      drawRadar();
    }
  }
  renderer.render(scene, camera);
  guard.frame(now);
}

$('help').innerHTML = `<h4 class="caption">Controls</h4>${controlsTable()}`;
toLobby();
requestAnimationFrame(frame);
