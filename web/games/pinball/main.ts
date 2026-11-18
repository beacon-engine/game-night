// Pinball: the game flow. The lobby (with the computer playing the table behind it), turns (each
// player plays a ball, then the next player; a set number of balls each, like an arcade machine),
// results, saved records and the best scores. The table and its rules are written in Odin (odin/,
// built into sim.wasm; sim.ts talks to it), the drawing is in draw.ts.
import {
  $, backToHub, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, PerformanceGuard, playerKey, requireDevice, showManual, starsLabel, BIT,
  type Button, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { EV, loadSim, PHASE, TICK, type SimEvent } from './sim.ts';
import { View } from './draw.ts';
import { Sounds } from './sound.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['play'] as const, ['left', 'right', 'launch'] as const);
const sim = await loadSim();
const st = sim.state; // (updated in place by every step)
const saves = gameSaves();
const MAX_PLAYERS = 4;
const BALLS = [1, 3, 5];

// What we remember about each player, every night (see platform/saves.ts)
interface PlayerRecord { name: string; games: number; best: number; wins: number }
const freshRecord = (name: string): PlayerRecord => ({ name, games: 0, best: 0, wins: 0 });

// The best scores: one player's game each
interface HighScore { score: number; name: string; when: string }
const TABLE = 'high-scores';
const TABLE_SIZE = 10;
let table: HighScore[] = [];

type PlayerState = { record: PlayerRecord | null; earned: Earned | null; nudged: boolean };
const input = new Input({ state: (): PlayerState => ({ record: null, earned: null, nudged: false }) });
type Player = Pad<PlayerState>;

// The people in this game, in turn. `c` follows them if their phone drops and comes back.
interface Seat { c: Player; total: number }
let seats: Seat[] = [];
let turn = 0; // whose ball it is
let ball = 1; // which of each player's balls
const settings = { balls: 3 };

type Stage = 'lobby' | 'playing' | 'ballOver' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'playing';
let stageT = 0;
let demo = true; // the computer playing behind the lobby

const view = new View($<HTMLCanvasElement>('board'), sim.table);
const sound = new Sounds();
const guard = new PerformanceGuard({
  targetFps: 60,
  onStruggle: (level) => {
    view.lite = true;
    if (level > 1) layoutView(1);
  },
});
guard.watchCanvas($<HTMLCanvasElement>('board'));

const seat = () => seats[turn] as Seat | undefined;
const seatOf = (c: Player) => seats.find((s) => s.c.id === c.id);

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  demo = true;
  sim.autoplay(true);
  sim.startBall();
  view.flipperColor = '#f3f0e8';
  show('lobby');
  renderLobby();
}

function startGame() {
  const people = input.list.slice(0, MAX_PLAYERS);
  if (!people.length) {
    callout('Join first', '', 'Scan the code with your phone, or press a key', false, 2200, true);
    return;
  }
  sound.unlock();
  demo = false;
  seats = people.map((c) => ({ c, total: 0 }));
  for (const c of input.list) c.drain();
  turn = 0;
  ball = 1;
  show('hud');
  nextBall();
}

function nextBall() {
  const s = seat()!;
  sim.autoplay(false);
  // (their buttons as they are now: if they're still holding the one that started the game,
  // the simulation waits for them to let go before the plunger moves)
  sim.controls(false, false, controls.held(s.c, 'play', 'launch'));
  sim.startBall();
  stage = 'playing';
  stageT = 0;
  view.flipperColor = s.c.color;
  const which = `Ball ${ball} of ${settings.balls}`;
  callout(s.c.label, seats.length > 1 ? `${s.c.tag} · ${which}` : which, 'Hold Bolt, let go to launch', false, 2200, true);
  input.buzz(s.c, 120);
  renderHud();
}

// The ball's gone: its points (and its bonus, already in st.score) go on the player's total
function ballOver(paid: number) {
  const s = seat()!;
  s.total += st.score;
  stage = 'ballOver';
  stageT = 0;
  if (st.tilted) callout('Tilted', `${s.c.label} · ball ${ball}`, 'No bonus this ball', false, 2400);
  else callout(`Bonus ${paid.toLocaleString()}`, `${s.c.label} · ball ${ball}`, `${st.bonus.toLocaleString()} × ${st.multiplier}`, false, 2400);
  renderHud();
}

function afterBall() {
  if (++turn >= seats.length) {
    turn = 0;
    ball++;
  }
  if (ball > settings.balls) gameOver();
  else nextBall();
}

function gameOver() {
  stage = 'results';
  sim.autoplay(false);
  const ranked = [...seats].sort((a, b) => b.total - a.total);
  const winner = seats.length > 1 && ranked[0].total > ranked[1].total ? ranked[0] : null;
  const before = table[0]?.score ?? 0;
  const when = new Date().toISOString().slice(0, 10);
  const entries = seats.filter((s) => s.total > 0).map((s): HighScore => ({ score: s.total, name: s.c.label, when }));
  table = [...table, ...entries].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
  if (entries.some((e) => table.includes(e))) saves.set(TABLE, table);
  saveRecords(winner);
  payOut(winner, before);
  renderResults(entries);
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'playing' || stage === 'ballOver') { resumeTo = stage; stage = 'paused'; show('pause'); }
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = { ...freshRecord(c.label), ...((await saves.get<PlayerRecord>(playerKey(c))) ?? {}) };
  if (stage === 'lobby') renderLobby();
}

function saveRecords(winner: Seat | null) {
  for (const s of seats) {
    const r = s.c.record ?? freshRecord(s.c.label);
    r.name = s.c.label;
    r.games++;
    r.best = Math.max(r.best, s.total);
    if (s === winner) r.wins++;
    s.c.record = r;
    saves.set(playerKey(s.c), r);
  }
}

// Stars: for playing; for beating everyone else; and for a new best score on this table
function payOut(winner: Seat | null, before: number) {
  for (const s of seats) {
    s.c.earned = null;
    const why: EarnFor[] = ['played'];
    if (s === winner) why.push('won');
    if (s.total > before && s.total > 0) why.push('record');
    earnStars(s.c, why).then((got) => { s.c.earned = got; if (stage === 'results') renderResults(lastEntries); });
  }
}

input.onJoin = (c) => {
  loadRecord(c);
  const mine = seatOf(c); // (back after a dropped connection: take your seat back)
  if (mine) mine.c = c;
  if (stage === 'lobby') renderLobby();
};
input.onLeave = () => { if (stage === 'lobby') renderLobby(); };
input.onRename = () => { if (stage === 'lobby') renderLobby(); };
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Pinball');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX();
  if (stage === 'lobby' && fx) changeBalls(fx);
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    sound.unlock();
    if (ev.bit === BIT.bolt) confirm();
    else if (ev.bit === BIT.drop) back();
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
  }
}

function changeBalls(d: number) {
  const i = BALLS.indexOf(settings.balls);
  settings.balls = BALLS[Math.max(0, Math.min(BALLS.length - 1, i + d))];
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') startGame();
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused') toLobby();
}

// Only the player whose ball it is plays; a flick of the stick nudges the table
function playInput() {
  for (const c of input.list) if (c.drain().some((ev) => ev.down)) sound.unlock();
  const s = seat();
  if (!s || stage !== 'playing') return sim.controls(false, false, false);
  const c = s.c;
  sim.autoplay(!c.connected); // (the computer looks after your ball until your phone is back)
  sim.controls(controls.held(c, 'play', 'left'), controls.held(c, 'play', 'right'), controls.held(c, 'play', 'launch'));
  const x = c.x || c.dpad.x, y = c.y || -c.dpad.y;
  const push = Math.hypot(x, y);
  if (push > 0.85 && !c.nudged) { c.nudged = true; sim.nudge(x, -y); }
  else if (push < 0.4) c.nudged = false;
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  sound.unlock();
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => sound.unlock());

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { label: c.tag, color: c.color, title: 'Pinball', accent: c.color };
  if (manualOpen()) return manualScreen({ ...base });
  switch (stage) {
    case 'lobby': return { ...base, layout: 'dpad', labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: `◀▶ balls each: ${settings.balls}` };
    case 'results': return { ...base, layout: 'dpad', labels: { bolt: 'Play again', drop: 'Lobby' }, hint: 'Game over' };
    case 'paused': return { ...base, layout: 'dpad', labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const s = seat()!;
      if (s.c.id !== c.id) {
        const mine = seatOf(c);
        const next = mine ? (seats.indexOf(mine) - turn + seats.length) % seats.length : 0;
        const hint = !mine ? 'Join the next game' : next === 1 ? "You're next" : `You play after ${next - 1} more`;
        return { ...base, layout: 'stick', labels: {}, hint: `${s.c.label} is playing · ${hint}` };
      }
      const inLane = st.phase === PHASE.inLane;
      const labels: Partial<Record<Button, string>> = {};
      for (const [btn, label] of Object.entries(controls.labels('play')) as [Button, string][]) {
        if (controls.action('play', BIT[btn]) !== 'launch' || inLane) labels[btn] = label;
      }
      const hint = st.tilted ? 'Tilt: wait for the ball' : inLane ? 'Hold Bolt, let go to launch' : 'Flick the stick to nudge';
      return { ...base, layout: 'stick', labels, hint, charge: inLane ? st.plunger : undefined };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
  layoutView();
}

// Where the table goes: right of the lobby's panel, or the middle of the screen with the HUD either side
function layoutView(maxDpr?: number) {
  const W = innerWidth, H = innerHeight;
  if (stage === 'lobby') {
    const side = document.querySelector('#lobby .side')!.getBoundingClientRect().right;
    view.layout({ x: side + 24, y: 16, w: W - side - 48, h: H - 96 }, maxDpr); // (above the legend)
  } else {
    view.layout({ x: 0, y: 12, w: W, h: H - 24 }, maxDpr);
    const room = Math.max(160, view.rect().x - 28);
    $('hudL').style.width = $('hudR').style.width = `${room}px`;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.games ? 'First game'
  : [`Best ${r.best.toLocaleString()}`, plural(r.games, 'game', 'games'), r.wins ? plural(r.wins, 'win', 'wins') : ''].filter(Boolean).join(' · ');

function hiRows(rows: HighScore[], mine: HighScore[] = []) {
  if (!rows.length) return '<p class="muted" style="margin:0">No scores yet. Be the first.</p>';
  return rows.map((h, i) => `<div class="hi ${mine.includes(h) ? 'me' : ''}"><span>${i + 1}</span>
    <span>${escapeHtml(h.name)}<span class="faint"> · ${h.when}</span></span><b>${h.score.toLocaleString()}</b></div>`).join('');
}

function renderLobby() {
  const people = input.list;
  $('players').innerHTML = people.length
    ? people.slice(0, MAX_PLAYERS).map((c) => `<div class="player">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
      + (people.length > MAX_PLAYERS ? `<p class="muted" style="margin:0">${people.length - MAX_PLAYERS} more play next game.</p>` : '')
    : '<p class="muted" style="margin:0">Join with your phone to play. Up to four players take turns on the table.</p>';
  $('settings').innerHTML = `<div class="setting sel"><span>Balls each</span><span class="value"><span class="glyph glyph-key">◀</span><b>${settings.balls}</b><span class="glyph glyph-key">▶</span></span></div>`;
  $('hiscores').innerHTML = hiRows(table.slice(0, 3));
}

function renderHud() {
  const s = seat();
  if (demo || !s) return;
  const live = (x: Seat) => x.total + (x === s && stage === 'playing' ? st.score : 0);
  $('turn').innerHTML = chip(s.c);
  $('score').textContent = live(s).toLocaleString();
  $('best').textContent = Math.max(table[0]?.score ?? 0, live(s)).toLocaleString();
  $('ballNo').innerHTML = `Ball ${ball} <span class="faint">of ${settings.balls}</span>`;
  $('mult').innerHTML = `${st.multiplier}×<small>bonus ${st.bonus.toLocaleString()}</small>`;
  $('scores').innerHTML = seats.map((x) => `<div class="seat ${x === s ? 'now' : ''}" style="--pc:${x.c.color}"><b>${escapeHtml(x.c.tag)}</b>
    <span class="n">${escapeHtml(x.c.label)}</span><span class="s">${live(x).toLocaleString()}</span></div>`).join('');
}

let lastEntries: HighScore[] = [];
function renderResults(entries: HighScore[]) {
  lastEntries = entries;
  const ranked = [...seats].sort((a, b) => b.total - a.total);
  const top = ranked[0];
  const earned = (c: Player) => (c.earned?.earned ? ` · +${starsLabel(c.earned.earned)}` : '');
  $('resultsWhy').textContent = seats.length > 1 ? 'Winner' : 'Game over';
  $('final').innerHTML = seats.length > 1
    ? `<span style="color:${top.c.color}">${escapeHtml(top.c.label)}</span> <span class="muted" style="font-size:0.45em">${top.total.toLocaleString()} points</span>`
    : `${top.total.toLocaleString()} <span class="muted" style="font-size:0.45em">points</span>`;
  $('standings').innerHTML = ranked.map((s, i) => `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${chip(s.c)}
    <span class="caption">${escapeHtml(recordLine(s.c.record))}${earned(s.c)}</span><b class="num">${s.total.toLocaleString()}</b></div>`).join('');
  $('table').innerHTML = `<div class="caption">Best scores</div>` + hiRows(table.slice(0, 5), entries);
}

let calloutTimer = 0;
function callout(big: string, sub = '', more = '', html = false, ms = 2200, small = false) {
  const el = $('callout');
  el.classList.toggle('small', small);
  el.innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${html ? big : escapeHtml(big)}</div>${more ? `<div class="sub">${escapeHtml(more)}</div>` : ''}`;
  el.classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- what happened ---------------------------------------------------------------------------------------
function react(e: SimEvent) {
  view.react(e, st);
  if (demo) return; // (the demo is quiet: it's behind the menu)
  const c = seat()?.c;
  switch (e.kind) {
    case EV.flip: sound.flip(); break;
    case EV.bumper: sound.bumper(); break;
    case EV.sling: sound.sling(); break;
    case EV.wall: sound.wall(e.value); break;
    case EV.lane: sound.lane(); break;
    case EV.lanesComplete: sound.fanfare(); callout(`${e.value}× bonus`, 'Lanes lit', '', false, 1500, true); break;
    case EV.target: sound.target(); break;
    case EV.targetsComplete: sound.fanfare(); callout('Jackpot', 'All targets', `+${e.value.toLocaleString()}`, false, 1800, true); if (c) input.buzz(c, 200); break;
    case EV.launch: sound.launch(e.value); break;
    case EV.ballSaved: sound.saved(); callout('Ball saved', '', 'Launch again', false, 1600, true); break;
    case EV.tiltWarning: sound.warning(); callout('Careful', 'Tilt warning', '', false, 1000, true); if (c) input.buzz(c, 150); break;
    case EV.tilt: sound.tilt(); callout('Tilt', '', 'The flippers are dead for this ball', false, 2000); if (c) input.buzz(c, 600); break;
    case EV.drain: sound.drain(); if (c) input.buzz(c, 250); break;
  }
}

// --- the loop -----------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

function tick() {
  if (stage === 'paused' || stage === 'results') return;
  stageT += TICK;
  if (demo) {
    sim.step();
    for (const e of st.events) react(e);
    if (st.phase === PHASE.drained) sim.startBall(); // (the demo goes on for ever)
    return;
  }
  if (stage === 'ballOver') {
    if (stageT >= 2.6) afterBall();
    return;
  }
  sim.step();
  for (const e of st.events) react(e);
  if (st.phase === PHASE.drained) ballOver(st.events.find((e) => e.kind === EV.drain)?.value ?? 0);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!demo && (stage === 'playing' || stage === 'ballOver')) playInput();
  else for (const c of input.list) menuInput(c);
  acc += dt;
  while (acc >= TICK) { tick(); acc -= TICK; }
  view.frame(stage === 'paused' ? 0 : dt, st);
  guard.frame(now);
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; renderHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
}

addEventListener('resize', () => layoutView());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('l1')} ${glyph('r1')} Flippers</span><span>${glyph('bolt')} Hold, let go: launch</span><span>${glyph('stick')} Flick: nudge</span>`;
$('pauseLegend').innerHTML = `<span>${glyph('bolt')} Resume</span><span>${glyph('drop')} Quit to the lobby</span>`;
for (const [id, btn] of [['backGlyph', 'drop'], ['startGlyph', 'bolt'], ['howtoGlyph', 'star'], ['againGlyph', 'bolt'], ['toLobbyGlyph', 'drop']] as const) $(id).outerHTML = glyph(btn);
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', startGame);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', startGame);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
for (const c of input.list) loadRecord(c);
saves.get<HighScore[]>(TABLE).then((t) => { table = t ?? []; if (stage === 'lobby') renderLobby(); });
toLobby();
requestAnimationFrame(frame);
