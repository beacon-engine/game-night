// Neon Trails: the game flow. Lobby (with a demo round behind it), rounds, results, saved records.
// The rules are in arena.ts, the drawing in draw.ts.
import {
  $, backToHub, BIT, chip, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, PerformanceGuard, playerColor, playerKey, requireDevice, showManual, type Pad, type PadScreen,
} from '@platform';
import { Arena, TICK, type Dir, type Rider, type RiderSpec } from './arena.ts';
import { View } from './draw.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['ride'] as const, ['boost', 'brake'] as const);
const saves = gameSaves();

// What we remember about each player, every night (see platform/saves.ts)
interface PlayerRecord { name: string; matches: number; wins: number; rounds: number; roundWins: number; streak: number; bestStreak: number }
const freshRecord = (name: string): PlayerRecord => ({ name, matches: 0, wins: 0, rounds: 0, roundWins: 0, streak: 0, bestStreak: 0 });

const input = new Input({ state: () => ({ record: null as PlayerRecord | null }) });
type Player = Pad<{ record: PlayerRecord | null }>;

// --- settings, chosen in the lobby --------------------------------------------------------------
const TARGETS = [3, 5, 7];
const settings = { rivals: 2, target: 5 }; // computer riders; round wins to take the match
const ROWS = ['rivals', 'target'] as const;
let row = 0; // the lobby row being changed

type Stage = 'lobby' | 'countdown' | 'riding' | 'roundOver' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'riding';
let stageT = 0;
let arena: Arena;
let round = 0;
let lastWinner: Rider | null = null;
let countShown = 0; // the countdown number on screen
const CLOSE_AFTER = 25; // seconds of riding before the walls start closing in
const CLOSE_EVERY = 1.5;
let nextClose = CLOSE_AFTER;
const scores = new Map<string, number>(); // round wins this match, by rider id
const names = new Map<string, RiderSpec>(); // everyone in this match, for the results
const players = new Map<string, Player>(); // the people in this match, even if their phone has gone since
const clears: { r: Rider; t: number }[] = []; // crashed trails, cleared after a moment

const view = new View($<HTMLCanvasElement>('board'));
const guard = new PerformanceGuard({
  targetFps: 60,
  onStruggle: (level) => {
    if (level === 1) view.glow = false;
    else view.layout(arena, 1);
    view.redrawTrails(arena);
  },
});
guard.watchCanvas($<HTMLCanvasElement>('board'));

// --- riders ---------------------------------------------------------------------------------------
const RIVAL_NAMES = ['Volt', 'Neon', 'Pulse', 'Flux', 'Arc', 'Ion'];

function riders(withHumans: boolean): RiderSpec[] {
  const humans: RiderSpec[] = withHumans ? input.list.map((c) => ({ id: c.id, name: c.label, color: c.color, ai: false })) : [];
  const usedSlots = new Set(input.list.map((c) => c.slot));
  const want = withHumans ? Math.max(settings.rivals, 2 - humans.length) : 4;
  const ai: RiderSpec[] = [];
  for (let slot = 0, i = 0; ai.length < want && slot < 16; slot++) {
    if (withHumans && usedSlots.has(slot)) continue;
    ai.push({ id: `cpu${i}`, name: RIVAL_NAMES[i % RIVAL_NAMES.length], color: playerColor(slot), ai: true });
    i++;
  }
  return [...humans, ...ai];
}

function newArena(specs: RiderSpec[]) {
  const big = specs.length > 4;
  arena = new Arena(big ? 112 : 96, big ? 63 : 54, specs);
  view.layout(arena);
  clears.length = 0;
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  newArena(riders(false)); // the demo behind the menu
  show('lobby');
  renderLobby();
}

function startMatch() {
  scores.clear();
  names.clear();
  players.clear();
  round = 0;
  nextRound();
  show('hud');
}

function nextRound() {
  round++;
  const specs = riders(true);
  for (const s of specs) { names.set(s.id, s); if (!scores.has(s.id)) scores.set(s.id, 0); }
  for (const c of input.list) players.set(c.id, c);
  newArena(specs);
  stage = 'countdown';
  stageT = 0;
  nextClose = CLOSE_AFTER;
  for (const c of input.list) c.drain();
  renderHud();
}

function endRound() {
  const alive = arena.alive;
  lastWinner = alive.length === 1 ? alive[0] : null;
  if (lastWinner) scores.set(lastWinner.id, (scores.get(lastWinner.id) ?? 0) + 1);
  stage = 'roundOver';
  stageT = 0;
  renderHud();
  callout(lastWinner ? `<span style="color:${lastWinner.color}">${escapeHtml(lastWinner.name)}</span> takes it` : 'Nobody survived', 'Round ' + round);
  for (const c of input.list) input.buzz(c, lastWinner?.id === c.id ? 200 : 40);
}

function endMatch(champion: string) {
  stage = 'results';
  saveRecords(champion);
  renderResults(champion);
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'countdown' || stage === 'riding' || stage === 'roundOver') { resumeTo = stage; stage = 'paused'; show('pause'); }
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  if (stage === 'lobby') renderLobby();
}

// everyone who rode in the match, including anyone whose phone dropped before the end
function saveRecords(champion: string) {
  for (const c of players.values()) {
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.matches++;
    r.rounds += round;
    r.roundWins += scores.get(c.id) ?? 0;
    if (c.id === champion) { r.wins++; r.streak++; r.bestStreak = Math.max(r.bestStreak, r.streak); }
    else r.streak = 0;
    c.record = r;
    saves.set(playerKey(c), r);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.matches ? 'First ride' :
  `${plural(r.wins, 'win', 'wins')} from ${plural(r.matches, 'match', 'matches')}${r.bestStreak > 1 ? ` · best run ${r.bestStreak} in a row` : ''}`;

input.onJoin = (c) => { loadRecord(c); if (stage === 'lobby') renderLobby(); else renderHud(); };
input.onLeave = (c) => {
  const r = arena.riders.find((x) => x.id === c.id);
  if (r?.alive) { r.alive = false; view.crash(r); clears.push({ r, t: 0.5 }); }
  if (stage === 'lobby') renderLobby();
};
input.onRename = () => (stage === 'lobby' ? renderLobby() : renderHud());
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Neon Trails');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.cross) confirm();
    else if (ev.bit === BIT.circle) back();
    else if (ev.bit === BIT.triangle && stage === 'lobby') howTo();
  }
}

function change(d: number) {
  if (ROWS[row] === 'rivals') settings.rivals = Math.max(0, Math.min(6, settings.rivals + d));
  else settings.target = TARGETS[(TARGETS.indexOf(settings.target) + d + TARGETS.length) % TARGETS.length];
  renderLobby();
}

function confirm() {
  if (stage === 'lobby') startMatch();
  else if (stage === 'results') startMatch();
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused') toLobby();
}

const DIR_OF: Record<string, Dir> = { up: 0, right: 1, down: 2, left: 3 };

function rideInput(c: Player) {
  const r = arena.riders.find((x) => x.id === c.id);
  const fx = c.flickX(), fy = c.flickY(); // d-pad taps, stick flicks, arrow keys
  for (const ev of c.drain()) if (ev.down && controls.action('ride', ev.bit) === 'boost' && r) arena.boost(r);
  if (!r?.alive) return;
  if (fx) arena.turn(r, DIR_OF[fx > 0 ? 'right' : 'left']);
  if (fy) arena.turn(r, DIR_OF[fy > 0 ? 'down' : 'up']);
  r.braking = controls.held(c, 'ride', 'brake');
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Neon Trails', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { cross: 'Start', circle: 'Games', triangle: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': return { ...base, labels: { cross: 'Rematch', circle: 'Lobby' }, hint: 'Match over' };
    case 'paused': return { ...base, labels: { cross: 'Resume', circle: 'Quit' }, hint: 'Paused' };
    default: {
      const r = arena.riders.find((x) => x.id === c.id);
      const hint = !r ? 'You ride next round' : r.alive ? `Round ${round}: turn with the arrows` : 'Out! Next round soon';
      return { ...base, labels: controls.labels('ride'), hint };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
}

function renderLobby() {
  const people = input.list;
  $('riders').innerHTML = people.length
    ? people.map((c) => `<div class="rider">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to ride. On your own? The computer riders will take you on.</p>';
  const value = (r: (typeof ROWS)[number]) => (r === 'rivals' ? String(settings.rivals) : `First to ${settings.target}`);
  const label = { rivals: 'Computer riders', target: 'Match' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${value(r)}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
}

function renderHud() {
  const ids = [...scores.keys()];
  $('scores').innerHTML = ids.map((id) => {
    const n = names.get(id)!, s = scores.get(id) ?? 0;
    const pips = Array.from({ length: settings.target }, (_, i) => `<i class="${i < s ? 'on' : ''}"></i>`).join('');
    const out = arena.riders.find((r) => r.id === id)?.alive === false;
    return `<div class="score ${out ? 'out' : ''}" style="--pc:${n.color}"><b>${escapeHtml(n.name)}</b><span class="pips">${pips}</span></div>`;
  }).join('');
  $('round').textContent = `Round ${round}`;
}

function renderResults(champion: string) {
  const c = names.get(champion)!;
  $('champion').innerHTML = `<span style="color:${c.color}">${escapeHtml(c.name)}</span> wins`;
  const order = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  $('standings').innerHTML = order.map(([id, s], i) => {
    const n = names.get(id)!, human = players.get(id);
    return `<div class="standing ${id === champion ? 'first' : ''}"><span class="num">${i + 1}</span>
      ${human ? chip(human) : `<span class="chip" style="--pc:${n.color}"><b>CPU</b>${escapeHtml(n.name)}</span>`}
      <span class="caption">${human ? escapeHtml(recordLine(human.record)) : ''}</span><b class="num">${s}</b></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(html: string, sub = '') {
  $('callout').innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${html}</div>`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), 1800);
}

// --- the loop -----------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), padT = 0;

function tick() {
  if (stage === 'paused') return;
  stageT += TICK;
  for (const c of clears) {
    c.t -= TICK;
    if (c.t <= 0) { arena.clearTrail(c.r); view.redrawTrails(arena); }
  }
  for (let i = clears.length - 1; i >= 0; i--) if (clears[i].t <= 0) clears.splice(i, 1);

  if (stage === 'countdown') {
    const n = 3 - Math.floor(stageT / 0.8);
    if (n !== countShown) { countShown = n; callout(n > 0 ? String(n) : 'Go'); }
    if (stageT >= 2.4) { stage = 'riding'; stageT = 0; }
    return;
  }
  if (stage === 'roundOver') {
    if (stageT < 2.2) return;
    const best = [...scores.entries()].find(([, s]) => s >= settings.target);
    return best ? endMatch(best[0]) : nextRound();
  }
  if (stage !== 'riding' && stage !== 'lobby') return;

  // sudden death: rounds can't go on for ever
  if (stage === 'riding' && stageT >= nextClose) {
    if (nextClose === CLOSE_AFTER) callout('The walls are closing in');
    nextClose += CLOSE_EVERY;
    for (const r of arena.closeIn()) { view.crash(r); input.buzz(input.list.find((c) => c.id === r.id), 160); }
    view.paintWalls(arena);
    renderHud();
  }
  const { moved, crashed } = arena.step();
  for (const r of moved) view.paint(r);
  for (const r of crashed) {
    view.crash(r);
    clears.push({ r, t: 0.5 });
    input.buzz(input.list.find((c) => c.id === r.id), 160);
  }
  if (crashed.length && stage === 'riding') renderHud();
  if (arena.alive.length <= 1) {
    if (stage === 'lobby') newArena(riders(false)); // the demo goes round again
    else endRound();
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'riding' || stage === 'countdown' ? rideInput(c) : menuInput(c));
  // once every human is out, the computer riders finish the round at triple speed
  const humansOut = stage === 'riding' && arena.riders.some((r) => !r.ai) && !arena.alive.some((r) => !r.ai);
  acc += dt * (humansOut ? 3 : 1);
  while (acc >= TICK) { tick(); acc -= TICK; }
  view.frame(arena, dt, acc / TICK);
  guard.frame(now);
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
}

addEventListener('resize', () => view.layout(arena));
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('dpad')} Turn</span><span>${glyph('cross')} Boost</span><span>${glyph('circle')} Brake (hold)</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', startMatch);
$('howto').addEventListener('click', howTo);
$('rematch').addEventListener('click', startMatch);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
toLobby();
requestAnimationFrame(frame);
