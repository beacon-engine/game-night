// Space Shooter: the game flow. Lobby (with a demo flown by the computer behind it), each stage's
// intro, the waves and the boss, a continue when the team is out of ships, the results and the high
// score table. The rules are in sim.ts, the drawing in scene.ts, the stages in stages.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { DIFFICULTY, Difficulty, STAGES, Weapon } from './stages.ts';
import { Phase, Sim, TICK, type Ship, type ShipSpec, type SimEvent } from './sim.ts';
import { loadModels, shipModel, View, WINGMAN_MODEL } from './scene.ts';
import { Sounds } from './sound.ts';

const device = await requireDevice();
const controls = await loadControls(['fly'] as const, ['fire', 'bomb', 'focus'] as const);
const saves = gameSaves();
const MAX_SHIPS = 4;
const TEST = new URLSearchParams(location.search); // (for testing: ?stage=2&at=96 starts at the second stage's boss)
const SKIP_TO = Number(TEST.get('at')) || 0;

// What we remember about each pilot, every night (see platform/saves.ts)
interface PilotRecord { name: string; games: number; best: number; stages: number; kills: number }
const freshRecord = (name: string): PilotRecord => ({ name, games: 0, best: 0, stages: 0, kills: 0 });

// The high score table: the team's score, who flew, how far, and on what
interface HighScore { score: number; crew: string[]; stage: number; continues: number; difficulty: Difficulty; when: string }
const TABLE = 'high-scores';
const TABLE_SIZE = 10;
let table: HighScore[] = [];

// Paint jobs from the shop (shop.json): the hull's colour
interface Hull { id: string; name: string; color: string }
let hulls: Hull[] = [];

type PilotState = { record: PilotRecord | null; earned: Earned | null; hull: string | null };
const input = new Input({ state: (): PilotState => ({ record: null, earned: null, hull: null }) });
type Pilot = Pad<PilotState>;

// --- settings, chosen in the lobby --------------------------------------------------------------
const DIFFS = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard];
const settings = { difficulty: Difficulty.Normal, wingmen: 1, start: Math.max(0, Math.min(2, (Number(TEST.get('stage')) || 1) - 1)) };
const ROWS = ['difficulty', 'wingmen', 'start'] as const;
let row = 0;

type Stage = 'lobby' | 'intro' | 'flying' | 'clear' | 'continue' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'flying';
let stageT = 0;
let sim: Sim;
let demo = true;
const CONTINUE_TIME = 10;
const INTRO_TIME = 3;
const CLEAR_TIME = 5;
const pilots = new Map<string, Pilot>(); // everyone who flew in this game, even if their phone has gone since

const view = new View($<HTMLCanvasElement>('view'));
const sound = new Sounds();
const guard = new PerformanceGuard({
  targetFps: 60,
  onStruggle: (level) => {
    if (level === 1) view.bloom = false;
    else view.renderer.setPixelRatio(1);
  },
});
guard.watchCanvas($<HTMLCanvasElement>('view'));

await loadModels();

// --- crews -------------------------------------------------------------------------------------------
const WINGMAN_NAMES = ['Vega', 'Orion', 'Lyra'];
const WINGMAN_COLORS = ['#9aa6b8', '#b8a89a', '#9ab8a8'];

function crew(withHumans: boolean): ShipSpec[] {
  const humans = withHumans ? input.list.slice(0, MAX_SHIPS) : [];
  const specs: ShipSpec[] = humans.map((c) => ({ id: c.id, name: c.label, color: c.color, ai: false, model: shipModel(c.slot), hull: hullOf(c) }));
  const wingmen = withHumans ? Math.min(settings.wingmen, MAX_SHIPS - specs.length) : 3;
  for (let i = 0; i < wingmen; i++) specs.push({ id: `cpu${i}`, name: WINGMAN_NAMES[i], color: WINGMAN_COLORS[i], ai: true, model: withHumans ? WINGMAN_MODEL : shipModel(i) });
  return specs;
}

const hullOf = (c: Pilot) => hulls.find((h) => h.id === c.hull)?.color;

function newSim(specs: ShipSpec[], stageIndex: number, carry?: Sim) {
  sim = new Sim(specs, settings.difficulty, stageIndex, carry);
  view.setStage(sim.stage.look);
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  demo = true;
  newSim(crew(false), Math.floor(Math.random() * STAGES.length));
  show('lobby');
  renderLobby();
  sound.drone(0);
}

function startGame() {
  sound.unlock();
  demo = false;
  pilots.clear();
  for (const c of input.list.slice(0, MAX_SHIPS)) pilots.set(c.id, c);
  newSim(crew(true), settings.start);
  if (SKIP_TO) sim.skipTo(SKIP_TO);
  intro();
  show('hud');
}

function intro() {
  stage = 'intro';
  stageT = 0;
  for (const c of input.list) c.drain();
  callout(sim.stage.name, `Stage ${sim.stageIndex + 1}${sim.round > 1 ? ` · Round ${sim.round}` : ''}`, sim.stage.about);
  renderHud();
}

function nextStage() {
  newSim(crew(true), sim.stageIndex + 1, sim);
  intro();
}

function gameOver(why: string) {
  stage = 'results';
  sound.drone(0);
  const entry: HighScore = {
    score: sim.teamScore, crew: sim.humans.map((s) => s.spec.name), stage: sim.stageIndex + 1,
    continues: sim.continues, difficulty: settings.difficulty, when: new Date().toISOString().slice(0, 10),
  };
  const before = table[0]?.score ?? 0;
  table = [...table, entry].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
  if (table.includes(entry)) saves.set(TABLE, table);
  saveRecords();
  payOut(entry.score > before && entry.score > 0);
  renderResults(why, entry);
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'intro' || stage === 'flying' || stage === 'clear') { resumeTo = stage; stage = 'paused'; show('pause'); }
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Pilot) {
  c.record = (await saves.get<PilotRecord>(playerKey(c))) ?? freshRecord(c.label);
  const owned = await ownedItems(c);
  c.hull = hulls.find((h) => owned.includes(h.id))?.id ?? null; // (their paint job, if they've bought one)
  if (stage === 'lobby') renderLobby();
}

function saveRecords() {
  for (const c of pilots.values()) {
    const s = sim.ships.find((q) => q.spec.id === c.id);
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.games++;
    r.best = Math.max(r.best, s?.score ?? 0);
    r.stages = Math.max(r.stages, sim.stageIndex + (sim.phase === Phase.Clear ? 1 : 0));
    r.kills += s?.kills ?? 0;
    c.record = r;
    saves.set(playerKey(c), r);
  }
}

// Stars: for flying, for clearing the first loop of stages, and for a new top score
function payOut(record: boolean) {
  const looped = sim.stageIndex >= STAGES.length;
  for (const c of pilots.values()) {
    c.earned = null;
    const why: EarnFor[] = ['played'];
    if (looped) why.push('won');
    if (record) why.push('record');
    earnStars(c, why).then((got) => { c.earned = got; if (stage === 'results') renderResults(lastWhy, lastEntry); });
  }
}

input.onJoin = (c) => {
  loadRecord(c);
  // join a game in progress: take a ship (or a wingman's)
  if (!demo && (stage === 'flying' || stage === 'intro') && !sim.ships.some((s) => s.spec.id === c.id)) {
    const humans = sim.ships.filter((s) => !s.ai && !s.out).length;
    if (humans < MAX_SHIPS) {
      const wing = sim.ships.find((s) => s.ai && !s.out);
      if (wing) sim.removeShip(wing.spec.id);
      sim.addShip({ id: c.id, name: c.label, color: c.color, ai: false, model: shipModel(c.slot), hull: hullOf(c) });
      pilots.set(c.id, c);
    }
  }
  if (stage === 'lobby') renderLobby();
};
input.onLeave = (c) => {
  if (!demo) sim.removeShip(c.id);
  if (stage === 'lobby') renderLobby();
};
input.onRename = () => (stage === 'lobby' ? renderLobby() : renderHud());
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Space Shooter');

function menuInput(c: Pilot) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    sound.unlock();
    if (ev.bit === BIT.bolt) confirm();
    else if (ev.bit === BIT.drop) back();
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
  }
}

function change(d: number) {
  const r = ROWS[row];
  if (r === 'difficulty') settings.difficulty = DIFFS[(DIFFS.indexOf(settings.difficulty) + d + DIFFS.length) % DIFFS.length];
  else if (r === 'wingmen') settings.wingmen = Math.max(0, Math.min(3, settings.wingmen + d));
  else settings.start = (settings.start + d + STAGES.length) % STAGES.length;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') startGame();
  else if (stage === 'paused') togglePause();
  else if (stage === 'continue') takeContinue();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused') toLobby();
  else if (stage === 'continue') gameOver('Game over');
}

function takeContinue() {
  sim.continueGame();
  stage = 'flying';
  show('hud');
  callout('Continue', `${sim.continues} used`);
}

function flyInput(c: Pilot) {
  const s = sim.ships.find((q) => q.spec.id === c.id);
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    sound.unlock();
    if (s && controls.action('fly', ev.bit) === 'bomb') s.bombNow = true;
  }
  if (!s) return;
  s.moveX = c.x;
  s.moveY = c.y; // (stick up = +1 = up the screen)
  s.firing = controls.held(c, 'fly', 'fire');
  s.focus = controls.held(c, 'fly', 'focus');
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  sound.unlock();
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' || stage === 'continue' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => sound.unlock());

// --- the phones -------------------------------------------------------------------------------------
const WEAPON_NAME: Record<Weapon, string> = { [Weapon.Blaster]: 'Blaster', [Weapon.Spread]: 'Spread', [Weapon.Laser]: 'Laser', [Weapon.Missiles]: 'Missiles' };

function padScreen(c: Pilot): PadScreen {
  const base = { label: c.tag, color: c.color, title: 'Space Shooter', accent: c.color };
  if (manualOpen()) return manualScreen({ ...base });
  switch (stage) {
    case 'lobby': return { ...base, layout: 'dpad', labels: { bolt: 'Launch', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': return { ...base, layout: 'dpad', labels: { bolt: 'Fly again', drop: 'Lobby' }, hint: `Final score ${sim.teamScore.toLocaleString()}` };
    case 'paused': return { ...base, layout: 'dpad', labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    case 'continue': return { ...base, layout: 'dpad', labels: { bolt: 'Continue', drop: 'End' }, hint: `Continue? ${Math.ceil(CONTINUE_TIME - stageT)}` };
    default: {
      const s = sim.ships.find((q) => q.spec.id === c.id);
      const hint = !s ? 'The crew is full: you fly next game'
        : s.out ? 'Out of ships' : !s.alive ? 'Back in a moment'
        : `${WEAPON_NAME[s.weapon]} ${s.level} · bombs ${s.bombs}${s.shield ? ' · shield' : ''}`;
      return { ...base, layout: 'stick', labels: controls.labels('fly'), hint };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause' | 'continue') {
  const ids = { lobby: 'lobby', hud: 'hud', results: 'results', pause: 'pause', continue: 'cont' };
  for (const [k, id] of Object.entries(ids)) {
    const keepHud = (screen === 'pause' || screen === 'continue') && k === 'hud';
    $(id).classList.toggle('hidden', k !== screen && !keepHud);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PilotRecord | null) => !r || !r.games ? 'First flight' : `Best ${r.best.toLocaleString()} · ${plural(r.games, 'game', 'games')}`;

function hiRows(rows: HighScore[], mine?: HighScore) {
  if (!rows.length) return '<p class="muted" style="margin:0">No scores yet. Be the first.</p>';
  return rows.map((h, i) => `<div class="hi ${h === mine ? 'me' : ''}"><span>${i + 1}</span>
    <span>${escapeHtml(h.crew.join(', ') || 'Wingmen')}<span class="faint"> · stage ${h.stage}${h.continues ? ` · ${plural(h.continues, 'continue', 'continues')}` : ''} · ${DIFFICULTY[h.difficulty].name}</span></span>
    <b>${h.score.toLocaleString()}</b></div>`).join('');
}

function renderLobby() {
  const people = input.list;
  $('pilots').innerHTML = people.length
    ? people.slice(0, MAX_SHIPS).map((c) => `<div class="pilot">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
      + (people.length > MAX_SHIPS ? `<p class="muted" style="margin:0">${people.length - MAX_SHIPS} more can take over a ship next game.</p>` : '')
    : '<p class="muted" style="margin:0">Join with your phone to fly. On your own? Take a computer wingman or two.</p>';
  const value = (r: (typeof ROWS)[number]) =>
    r === 'difficulty' ? DIFFICULTY[settings.difficulty].name : r === 'wingmen' ? String(settings.wingmen) : `${settings.start + 1}. ${STAGES[settings.start].name}`;
  const label = { difficulty: 'Difficulty', wingmen: 'Computer wingmen', start: 'Start at' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value(r))}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  $('hiscores').innerHTML = hiRows(table.slice(0, 5));
}

let hudKey = '';
function renderHud() {
  const s = sim;
  $('score').textContent = s.teamScore.toLocaleString();
  $('hiscore').textContent = Math.max(table[0]?.score ?? 0, s.teamScore).toLocaleString();
  $('stagename').textContent = `${s.stageIndex + 1}. ${s.stage.name}`;
  $('lives').innerHTML = Array.from({ length: Math.min(12, s.lives) }, () => '<i></i>').join('') + (s.lives > 12 ? `<b>+${s.lives - 12}</b>` : '');
  const m = s.multiplier;
  $('chain').className = m > 1 ? 'on' : '';
  $('chain').innerHTML = m > 1 ? `×${m}<small>chain ${s.chain}</small>` : '';
  const key = s.ships.map((p) => `${p.spec.id}${p.score}${p.weapon}${p.level}${p.bombs}${p.alive}${p.out}${p.shield}`).join('|');
  if (key !== hudKey) {
    hudKey = key;
    $('crew').innerHTML = s.ships.filter((p) => !(p.ai && p.out)).map((p) => `<div class="crew ${p.alive ? '' : 'down'}" style="--pc:${p.spec.color}">
      <b>${p.ai ? 'CPU' : escapeHtml(input.list.find((c) => c.id === p.spec.id)?.tag ?? '')}</b><span class="n">${escapeHtml(p.spec.name)}</span>
      <span class="w">${WEAPON_NAME[p.weapon]} ${'▮'.repeat(p.level)}${p.shield ? ' ◆' : ''}</span><span class="b">${'●'.repeat(p.bombs)}</span>
      <span class="s">${p.score.toLocaleString()}</span></div>`).join('');
  }
  const b = s.boss;
  $('bossbar').classList.toggle('on', !!b && !b.dead && b.t > 1);
  if (b && !b.dead) {
    const total = b.parts.reduce((t, p) => t + p.max, 0);
    const left = b.parts.reduce((t, p) => t + Math.max(0, p.hp), 0);
    $('bossname').textContent = b.coreOpen ? `${b.def.name}: the core is open` : b.def.name;
    $('bosshp').style.width = `${total ? (left / total) * 100 : 0}%`;
  }
}

let lastWhy = '', lastEntry: HighScore | undefined;
function renderResults(why: string, entry?: HighScore) {
  lastWhy = why;
  lastEntry = entry;
  $('resultsWhy').textContent = why;
  $('final').innerHTML = `${sim.teamScore.toLocaleString()} <span class="muted" style="font-size:0.45em">points · stage ${sim.stageIndex + 1}</span>`;
  $('crewstats').innerHTML = sim.ships.filter((s) => !s.ai).map((s) => {
    const c = pilots.get(s.spec.id);
    return `<div class="stat">${c ? chip(c) : escapeHtml(s.spec.name)}<span>${s.score.toLocaleString()} pts · ${plural(s.kills, 'kill', 'kills')} · ${plural(s.deaths, 'ship lost', 'ships lost')}</span>${c?.earned?.earned ? `<span>+${starsLabel(c.earned.earned)}</span>` : ''}</div>`;
  }).join('');
  $('table').innerHTML = `<div class="caption">High scores</div>` + hiRows(table, entry);
}

let calloutTimer = 0;
function callout(big: string, sub = '', more = '', warn = false, ms = 2400) {
  const el = $('callout');
  el.innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${escapeHtml(big)}</div>${more ? `<div class="sub">${escapeHtml(more)}</div>` : ''}`;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// --- what happened ---------------------------------------------------------------------------------------
function react(e: SimEvent) {
  view.react(e);
  if (demo) return; // (the demo is quiet: it's behind the menu)
  const buzz = (s: Ship, ms: number) => input.buzz(input.list.find((c) => c.id === s.spec.id), ms);
  switch (e.type) {
    case 'fire': if (e.ship.weapon !== Weapon.Laser) sound.shot(); break;
    case 'hit': sound.hit(); break;
    case 'explode': sound.explode(e.size); break;
    case 'pickup': sound.pickup(); buzz(e.ship, 30); if (e.kind === 'life') sound.life(); break;
    case 'shield': sound.shield(); buzz(e.ship, 80); break;
    case 'down': sound.down(); buzz(e.ship, 300); break;
    case 'bomb': sound.bomb(); buzz(e.ship, 120); break;
    case 'warning': sound.warning(); callout('Warning', 'Something big is coming', '', true, 3000); break;
    case 'bossIn': callout(sim.stage.boss.name, '', '', false, 1800); break;
    case 'coreOpen': callout('The core is open', '', 'Hit it now', false, 1600); break;
    case 'clear': sound.clear(); callout('Stage clear', `Bonus +${e.bonus.toLocaleString()}`, '', false, 3500); break;
    case 'chain': sound.chain(); break;
  }
}

// --- the loop -----------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

function tick() {
  if (stage === 'paused' || stage === 'results' || stage === 'continue') return;
  stageT += TICK;
  if (stage === 'intro' && stageT >= INTRO_TIME) { stage = 'flying'; stageT = 0; }
  sim.step();
  for (const e of sim.events) react(e);
  if (demo) {
    // the demo goes on for ever: the next stage, or the same one again
    if (sim.phase === Phase.Clear && sim.phaseT > CLEAR_TIME) newSim(crew(false), sim.stageIndex + 1, sim);
    return;
  }
  if (sim.phase === Phase.Clear && stage === 'flying') { stage = 'clear'; stageT = 0; }
  if (stage === 'clear' && stageT >= CLEAR_TIME) nextStage();
  if (sim.over && stage === 'flying') { stage = 'continue'; stageT = 0; show('continue'); }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const flying = stage === 'flying' || stage === 'intro' || stage === 'clear';
  for (const c of input.list) (flying ? flyInput(c) : menuInput(c));
  if (stage === 'continue') {
    stageT += dt;
    $('contcount').textContent = String(Math.max(0, Math.ceil(CONTINUE_TIME - stageT)));
    if (stageT >= CONTINUE_TIME) gameOver('Game over');
  }
  acc += dt;
  while (acc >= TICK) { tick(); acc -= TICK; }
  if (stage !== 'paused') view.frame(sim, dt);
  guard.frame(now);
  hudT += dt;
  if (hudT > 0.1 && !demo) { hudT = 0; renderHud(); }
  if (!demo) sound.drone(stage === 'flying' ? Math.min(1, 0.3 + sim.bullets.length / 120 + (sim.boss ? 0.4 : 0)) : 0);
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
}

addEventListener('resize', () => view.layout());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('stick')} Fly</span><span>${glyph('bolt')} Fire (hold)</span><span>${glyph('drop')} Bomb</span><span>${glyph('leaf')} Focus (hold: slow, tight)</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', startGame);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', startGame);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);

shopItems('space-shooter').then((items) => {
  hulls = items.map((it) => ({ id: it.id.split('/')[1], name: it.name, color: String(it.extra.color ?? '#ffffff') }));
  for (const c of input.list) loadRecord(c);
});
saves.get<HighScore[]>(TABLE).then((t) => { table = t ?? []; if (stage === 'lobby') renderLobby(); });
toLobby();
requestAnimationFrame(frame);
