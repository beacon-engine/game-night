// Bricks: the game flow. The lobby (with the computer playing a wall behind it), co-op (one wall,
// everyone's paddle along the bottom, wall after wall until the balls run out), versus (a wall each,
// the same one, first to clear it takes the round), results, saved records and the best scores.
// The rules are in sim.ts, the walls in levels.ts, the drawing in draw.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, PerformanceGuard, playerColor, playerKey, requireDevice, showManual, starsLabel,
  type Button, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { LEVELS, VERSUS_LEVELS } from './levels.ts';
import { Field, judgeRound, POWERS, ROUND_TIME, stepAll, TICK, type FieldEvent, type Paddle, type PaddleSpec } from './sim.ts';
import { View } from './draw.ts';
import { Sounds } from './sound.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['coop', 'versus'] as const, ['launch', 'send'] as const);
const saves = gameSaves();
const MAX_PADDLES = 4;
const LIVES = 3; // spare balls (co-op: the team's; versus: each player's, every round)

// What we remember about each player, every night (see platform/saves.ts)
interface PlayerRecord { name: string; games: number; best: number; walls: number; bricks: number; matches: number; wins: number }
const freshRecord = (name: string): PlayerRecord => ({ name, games: 0, best: 0, walls: 0, bricks: 0, matches: 0, wins: 0 });

// The best co-op scores: the team's score, who played, how many walls they cleared
interface HighScore { score: number; crew: string[]; walls: number; when: string }
const TABLE = 'high-scores';
const TABLE_SIZE = 10;
let table: HighScore[] = [];

type PlayerState = { record: PlayerRecord | null; earned: Earned | null };
const input = new Input({ state: (): PlayerState => ({ record: null, earned: null }) });
type Player = Pad<PlayerState>;

// --- settings, chosen in the lobby --------------------------------------------------------------
type Mode = 'coop' | 'versus';
const settings = { mode: 'coop' as Mode, cpu: 0, start: 0, target: 2 };
const ROWS: Record<Mode, readonly ('mode' | 'cpu' | 'start' | 'target')[]> = { coop: ['mode', 'cpu', 'start'], versus: ['mode', 'cpu', 'target'] };
let row = 0;

type Stage = 'lobby' | 'countdown' | 'playing' | 'clear' | 'roundOver' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'playing';
let stageT = 0;
let mode: Mode = 'coop'; // the game being played (settings.mode can change in the lobby)
let demo = true; // the computer playing behind the lobby
let fields: Field[] = [];
let walls = 0; // co-op: walls cleared this game
let round = 0; // versus
let countShown = 0;
const wins = new Map<string, number>(); // versus: rounds won, by paddle id
let specs: PaddleSpec[] = [];
const players = new Map<string, Player>(); // the people in this game, even if their phone has gone since

const view = new View($<HTMLCanvasElement>('board'));
const sound = new Sounds();
const guard = new PerformanceGuard({
  targetFps: 60,
  onStruggle: (level) => {
    view.lite = true;
    if (level > 1) layoutView(1);
  },
});
guard.watchCanvas($<HTMLCanvasElement>('board'));

// --- who plays -------------------------------------------------------------------------------------
const CPU_NAMES = ['Kit', 'Rook', 'Juno', 'Pax'];

function crew(withHumans: boolean): PaddleSpec[] {
  const humans = withHumans ? input.list.slice(0, MAX_PADDLES) : [];
  const out: PaddleSpec[] = humans.map((c) => ({ id: c.id, name: c.label, color: c.color, ai: false, tag: c.tag }));
  const want = !withHumans ? 2 : settings.mode === 'versus' ? Math.max(settings.cpu, 2 - out.length) : settings.cpu;
  const used = new Set(humans.map((c) => c.slot));
  for (let slot = 0, i = 0; i < want && out.length < MAX_PADDLES && slot < 8; slot++) {
    if (used.has(slot)) continue;
    // (partners play well; rivals can be beaten)
    const skill = !withHumans ? 1 : settings.mode === 'versus' ? 0.55 : 0.85;
    out.push({ id: `cpu${i}`, name: CPU_NAMES[i], color: playerColor(slot), ai: true, skill, tag: 'CPU' });
    i++;
  }
  return out;
}

function paddleOf(id: string): { f: Field; p: Paddle } | null {
  for (const f of fields) for (const p of f.paddles) if (p.spec.id === id) return { f, p };
  return null;
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  demo = true;
  newDemo();
  show('lobby');
  renderLobby();
}

function newDemo() {
  fields = [new Field({ specs: crew(false), level: Math.floor(Math.random() * LEVELS.length), lives: 99 })];
  stageT = 0;
  layoutView();
}

function startGame() {
  sound.unlock();
  demo = false;
  mode = settings.mode;
  players.clear();
  for (const c of input.list.slice(0, MAX_PADDLES)) players.set(c.id, c);
  specs = crew(true);
  for (const c of input.list) c.drain();
  show('hud');
  if (mode === 'versus') {
    wins.clear();
    for (const s of specs) wins.set(s.id, 0);
    round = 0;
    nextRound();
  } else {
    walls = 0;
    newWall(settings.start, 0);
  }
}

// Co-op: the next wall (the score, the lives and the paddles' points carry on)
function newWall(level: number, loop: number, carry?: Field) {
  fields = [new Field({ specs, level, loop, lives: carry?.lives ?? LIVES, carry })];
  stage = 'playing';
  stageT = 0;
  layoutView();
  callout(LEVELS[level].name, `Wall ${walls + 1}${loop ? ` · round ${loop + 1}` : ''}`, 'Bolt to launch');
  renderHud();
}

function wallCleared() {
  const f = fields[0];
  const bonus = 1000 + 250 * walls;
  f.score += bonus;
  walls++;
  stage = 'clear';
  stageT = 0;
  sound.clear();
  callout('Wall cleared', `Bonus +${bonus.toLocaleString()}`);
  for (const c of players.values()) input.buzz(c, 120);
  renderHud();
}

function nextWall() {
  const f = fields[0];
  const next = f.levelIndex + 1;
  newWall(next % LEVELS.length, f.loop + (next >= LEVELS.length ? 1 : 0), f);
}

// Versus: everyone gets the same wall
function nextRound() {
  round++;
  const level = VERSUS_LEVELS[(round - 1 + Math.floor(Math.random() * VERSUS_LEVELS.length)) % VERSUS_LEVELS.length];
  fields = specs.map((s) => new Field({ specs: [s], level, lives: LIVES, versus: true }));
  stage = 'countdown';
  stageT = 0;
  countShown = 0;
  view.info.clear();
  layoutView();
  renderHud();
}

function endRound(winner: Field | null) {
  const id = winner?.paddles[0].spec.id;
  if (id) wins.set(id, (wins.get(id) ?? 0) + 1);
  stage = 'roundOver';
  stageT = 0;
  const p = winner?.paddles[0];
  const why = !winner ? '' : winner.cleared ? 'First to clear the wall' : fields.filter((f) => !f.over).length === 1 && fields.some((f) => f.over) ? 'Last one with a ball' : 'Most of the wall broken';
  callout(p ? `<span style="color:${p.spec.color}">${escapeHtml(p.spec.name)}</span> takes it` : 'A draw', `Round ${round}${why ? ` · ${why}` : ''}`, '', true);
  if (winner) sound.clear();
  for (const c of players.values()) input.buzz(c, c.id === id ? 220 : 40);
  renderHud();
}

function gameOver() {
  stage = 'results';
  const f = fields[0];
  const entry: HighScore = { score: f.score, crew: specs.filter((s) => !s.ai).map((s) => s.name), walls, when: new Date().toISOString().slice(0, 10) };
  const before = table[0]?.score ?? 0;
  if (entry.crew.length) {
    table = [...table, entry].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
    if (table.includes(entry)) saves.set(TABLE, table);
  }
  saveRecords(null);
  payOut(null, entry.score > before && entry.score > 0);
  renderResults(entry);
  show('results');
}

function endMatch(champion: string) {
  stage = 'results';
  saveRecords(champion);
  payOut(champion, false);
  renderResults();
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'countdown' || stage === 'playing' || stage === 'clear' || stage === 'roundOver') { resumeTo = stage; stage = 'paused'; show('pause'); }
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = { ...freshRecord(c.label), ...((await saves.get<PlayerRecord>(playerKey(c))) ?? {}) };
  if (stage === 'lobby') renderLobby();
}

function saveRecords(champion: string | null) {
  for (const c of players.values()) {
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    if (mode === 'coop') {
      const p = paddleOf(c.id)?.p;
      r.games++;
      r.best = Math.max(r.best, fields[0]?.score ?? 0);
      r.walls = Math.max(r.walls, walls);
      r.bricks += p?.bricks ?? 0;
    } else {
      r.matches++;
      if (c.id === champion) r.wins++;
    }
    c.record = r;
    saves.set(playerKey(c), r);
  }
}

// Stars: for playing; for five walls in one co-op game, or for taking a versus match; and for a new best score
function payOut(champion: string | null, record: boolean) {
  for (const c of players.values()) {
    c.earned = null;
    const why: EarnFor[] = ['played'];
    if (mode === 'coop' ? walls >= 5 : c.id === champion) why.push('won');
    if (record) why.push('record');
    earnStars(c, why).then((got) => { c.earned = got; if (stage === 'results') renderResults(lastEntry); });
  }
}

input.onJoin = (c) => {
  loadRecord(c);
  const mine = paddleOf(c.id); // (back after a dropped connection: take your paddle back)
  if (mine && !demo) mine.p.spec.ai = false;
  if (stage === 'lobby') renderLobby();
};
input.onLeave = (c) => {
  const mine = paddleOf(c.id); // (the computer looks after their paddle until they're back)
  if (mine && !demo) { mine.p.spec.ai = true; mine.p.spec.skill = 0.8; }
  if (stage === 'lobby') renderLobby();
};
input.onRename = (c) => {
  const mine = paddleOf(c.id);
  if (mine) mine.p.spec.name = c.label;
  if (stage === 'lobby') renderLobby();
};
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Bricks');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    const rows = ROWS[settings.mode];
    if (fy) { row = (row + fy + rows.length) % rows.length; renderLobby(); }
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
  const r = ROWS[settings.mode][row];
  if (r === 'mode') settings.mode = settings.mode === 'coop' ? 'versus' : 'coop';
  else if (r === 'cpu') settings.cpu = Math.max(0, Math.min(3, settings.cpu + d));
  else if (r === 'start') settings.start = (settings.start + d + LEVELS.length) % LEVELS.length;
  else settings.target = Math.max(1, Math.min(3, settings.target + d));
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

function playInput(c: Player) {
  const mine = paddleOf(c.id);
  for (const ev of c.drain()) {
    if (!ev.down || !mine) continue;
    sound.unlock();
    const action = controls.action(mode, ev.bit);
    if (action === 'launch') mine.p.launch = true;
    else if (action === 'send') mine.p.use = true;
  }
  if (!mine || mine.p.spec.ai) return;
  const p = mine.p;
  p.move = c.x || c.dpad.x;
  p.sprint = c.held(BIT.sprint);
  p.fire = controls.held(c, mode, 'launch');
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
const powerLine = (f: Field, p: Paddle) => [
  p.wideT ? `Wide ${Math.ceil(p.wideT)}` : '', p.laserT ? `Laser ${Math.ceil(p.laserT)}` : '', p.catchT ? `Catch ${Math.ceil(p.catchT)}` : '',
  f.slowT ? `Slow ${Math.ceil(f.slowT)}` : '', p.shrinkT ? `Shrunk ${Math.ceil(p.shrinkT)}` : '',
].filter(Boolean).join(' · ');

function padScreen(c: Player): PadScreen {
  const base = { label: c.tag, color: c.color, title: 'Bricks', accent: c.color };
  if (manualOpen()) return manualScreen({ ...base });
  switch (stage) {
    case 'lobby': return { ...base, layout: 'dpad', labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': return { ...base, layout: 'dpad', labels: { bolt: 'Play again', drop: 'Lobby' }, hint: mode === 'coop' ? `Final score ${fields[0].score.toLocaleString()}` : 'Match over' };
    case 'paused': return { ...base, layout: 'dpad', labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const mine = paddleOf(c.id);
      if (!mine) return { ...base, layout: 'stick', labels: {}, hint: 'Four are playing: you play next game' };
      const { f, p } = mine;
      // the buttons say what they'd do right now
      const labels: Partial<Record<Button, string>> = {};
      for (const [btn, label] of Object.entries(controls.labels(mode)) as [Button, string][]) {
        const action = controls.action(mode, BIT[btn]);
        if (action === 'launch') labels[btn] = f.balls.some((b) => b.stuck === p) ? 'Launch' : p.laserT ? 'Fire' : label;
        else if (action === 'send' && p.stored) labels[btn] = `Send ${POWERS[p.stored].name}`;
      }
      const hint = f.over ? 'Out of balls: wait for the round' : stage === 'countdown' ? 'Get ready' : powerLine(f, p) || (mode === 'coop' ? `Your points ${p.score.toLocaleString()}` : `${f.left} bricks to go`);
      return { ...base, layout: 'stick', labels, hint };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
  $('coophud').classList.toggle('hidden', mode !== 'coop');
  $('vshud').classList.toggle('hidden', mode !== 'versus');
  layoutView();
}

// Where the fields go: right of the lobby's panel, the middle of the screen in co-op (the HUD on
// either side), under the round bar in versus
function layoutView(maxDpr?: number) {
  const W = innerWidth, H = innerHeight;
  if (stage === 'lobby') {
    const side = document.querySelector('#lobby .side')!.getBoundingClientRect().right;
    view.header = false;
    view.layout(fields, { x: side + 24, y: 24, w: W - side - 48, h: H - 110 }, maxDpr); // (above the legend)
  } else if (mode === 'versus') {
    view.header = true;
    view.layout(fields, { x: 16, y: 60, w: W - 32, h: H - 72 }, maxDpr);
  } else {
    view.header = false;
    view.layout(fields, { x: 0, y: 14, w: W, h: H - 28 }, maxDpr);
    const r = fields[0] && view.rect(fields[0]);
    if (r) {
      const room = Math.max(150, r.x - 28);
      $('hudL').style.width = $('hudR').style.width = `${room}px`;
    }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || (!r.games && !r.matches) ? 'First game'
  : [r.games ? `Best ${r.best.toLocaleString()}` : '', r.walls ? plural(r.walls, 'wall', 'walls') : '', r.matches ? `${plural(r.wins, 'win', 'wins')} in versus` : ''].filter(Boolean).join(' · ');

function hiRows(rows: HighScore[], mine?: HighScore) {
  if (!rows.length) return '<p class="muted" style="margin:0">No scores yet. Be the first.</p>';
  return rows.map((h, i) => `<div class="hi ${h === mine ? 'me' : ''}"><span>${i + 1}</span>
    <span>${escapeHtml(h.crew.join(', '))}<span class="faint"> · ${plural(h.walls, 'wall', 'walls')}</span></span><b>${h.score.toLocaleString()}</b></div>`).join('');
}

function renderLobby() {
  const people = input.list;
  $('players').innerHTML = people.length
    ? people.slice(0, MAX_PADDLES).map((c) => `<div class="player">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
      + (people.length > MAX_PADDLES ? `<p class="muted" style="margin:0">${people.length - MAX_PADDLES} more play next game.</p>` : '')
    : '<p class="muted" style="margin:0">Join with your phone to play. On your own? Add a computer partner, or take one on in versus.</p>';
  const rows = ROWS[settings.mode];
  row = Math.min(row, rows.length - 1);
  const label = { mode: 'Mode', cpu: settings.mode === 'coop' ? 'Computer partners' : 'Computer rivals', start: 'Start at', target: 'Match' };
  const value = (r: (typeof rows)[number]) =>
    r === 'mode' ? (settings.mode === 'coop' ? 'Co-op' : 'Versus')
    : r === 'cpu' ? String(settings.mode === 'versus' ? Math.max(settings.cpu, 2 - Math.min(people.length, 2)) : settings.cpu)
    : r === 'start' ? `${settings.start + 1}. ${LEVELS[settings.start].name}` : `First to ${settings.target}`;
  $('settings').innerHTML = rows.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value(r))}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  $('hiscores').innerHTML = hiRows(table.slice(0, 3));
}

let hudKey = '';
function renderHud() {
  if (demo) return;
  if (mode === 'coop') {
    const f = fields[0];
    if (!f) return;
    $('score').textContent = f.score.toLocaleString();
    $('best').textContent = Math.max(table[0]?.score ?? 0, f.score).toLocaleString();
    $('wall').innerHTML = `<span class="faint">Wall ${walls + 1}${f.loop ? ` · round ${f.loop + 1}` : ''}</span><br>${escapeHtml(f.level.name)}`;
    $('lives').innerHTML = Array.from({ length: Math.min(9, f.lives) }, () => '<i></i>').join('');
    $('left').textContent = plural(f.left, 'brick', 'bricks') + ' to go';
    const combo = Math.max(0, ...f.balls.map((b) => b.combo));
    const mult = Math.min(8, 1 + Math.floor(combo / 5));
    $('combo').className = combo >= 3 ? 'on' : '';
    $('combo').innerHTML = combo >= 3 ? `${combo}<small>combo${mult > 1 ? ` · ×${mult}` : ''}</small>` : '';
    const key = f.paddles.map((p) => `${p.spec.id}${p.spec.name}${p.score}${Math.ceil(p.wideT)}${Math.ceil(p.laserT)}${Math.ceil(p.catchT)}${p.spec.ai}`).join('|') + Math.ceil(f.slowT);
    if (key !== hudKey) {
      hudKey = key;
      $('crew').innerHTML = f.paddles.map((p) => {
        const powers = (['wideT', 'laserT', 'catchT'] as const).filter((k) => p[k] > 0)
          .map((k) => { const pw = POWERS[k === 'wideT' ? 'wide' : k === 'laserT' ? 'laser' : 'catch']; return `<span class="pw" style="--pw:${pw.color}">${pw.letter}<i style="width:${(p[k] / pw.time) * 100}%"></i></span>`; }).join('');
        return `<div class="crew" style="--pc:${p.spec.color}"><b>${escapeHtml(p.spec.tag ?? '')}</b><span class="n">${escapeHtml(p.spec.name)}</span><span class="s">${p.score.toLocaleString()}</span><span class="pws">${powers}</span></div>`;
      }).join('') + (f.slowT ? `<div class="slow">Slow ball ${Math.ceil(f.slowT)}s</div>` : '');
    }
  } else {
    const left = Math.max(0, ROUND_TIME - (stage === 'playing' ? stageT : 0));
    $('vsround').textContent = `Round ${round}`;
    $('vstarget').textContent = `First to ${settings.target}`;
    $('vstime').textContent = stage === 'playing' || stage === 'paused' ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '';
    $('vstime').classList.toggle('low', left < 20);
    for (const f of fields) {
      const p = f.paddles[0], c = players.get(p.spec.id);
      view.info.set(f, { wins: wins.get(p.spec.id) ?? 0, target: settings.target, tag: c?.tag ?? 'CPU', banner: f.cleared ? 'Clear' : f.over ? 'Out' : undefined });
    }
  }
}

let lastEntry: HighScore | undefined;
function renderResults(entry?: HighScore) {
  lastEntry = entry;
  const earned = (c?: Player) => (c?.earned?.earned ? ` · +${starsLabel(c.earned.earned)}` : '');
  if (mode === 'coop') {
    const f = fields[0];
    $('resultsWhy').textContent = 'Out of balls';
    $('final').innerHTML = `${f.score.toLocaleString()} <span class="muted" style="font-size:0.45em">points · ${plural(walls, 'wall', 'walls')} cleared</span>`;
    $('standings').innerHTML = [...f.paddles].sort((a, b) => b.score - a.score).map((p, i) => {
      const c = players.get(p.spec.id);
      return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${c ? chip(c) : `<span class="chip" style="--pc:${p.spec.color}"><b>CPU</b>${escapeHtml(p.spec.name)}</span>`}
        <span class="caption">${plural(p.bricks, 'brick', 'bricks')} · best combo ${p.bestCombo}${earned(c)}</span><b class="num">${p.score.toLocaleString()}</b></div>`;
    }).join('');
    $('table').innerHTML = `<div class="caption">Best scores</div>` + hiRows(table.slice(0, 5), entry);
  } else {
    const order = [...wins.entries()].sort((a, b) => b[1] - a[1]);
    const champ = specs.find((s) => s.id === order[0][0])!;
    $('resultsWhy').textContent = 'Champion';
    $('final').innerHTML = `<span style="color:${champ.color}">${escapeHtml(champ.name)}</span> wins`;
    $('standings').innerHTML = order.map(([id, w], i) => {
      const s = specs.find((q) => q.id === id)!, c = players.get(id);
      return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${c ? chip(c) : `<span class="chip" style="--pc:${s.color}"><b>CPU</b>${escapeHtml(s.name)}</span>`}
        <span class="caption">${c ? escapeHtml(recordLine(c.record)) : ''}${earned(c)}</span><b class="num">${w}</b></div>`;
    }).join('');
    $('table').innerHTML = '';
  }
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
function react(f: Field, e: FieldEvent) {
  view.react(f, e);
  if (demo) return; // (the demo is quiet: it's behind the menu)
  const who = (p: Paddle) => players.get(p.spec.id);
  switch (e.type) {
    case 'paddle': sound.paddle(); break;
    case 'wall': sound.wall(); break;
    case 'hit': sound.tough(); break;
    case 'break': sound.brick(e.combo); break;
    case 'steel': sound.steel(); break;
    case 'boom': sound.boom(); break;
    case 'laser': sound.laser(); break;
    case 'launch': sound.launch(); break;
    case 'pickup': sound.pickup(); if (e.power === 'life') sound.life(); input.buzz(who(e.paddle), 40); break;
    case 'lost': if (f.balls.length) sound.lost(); break;
    case 'life': case 'out':
      sound.lost();
      for (const p of f.paddles) input.buzz(who(p), 250);
      if (e.type === 'life' && mode === 'coop') callout(f.lives ? `${plural(f.lives + 1, 'ball', 'balls')} left` : 'Last ball', 'Ball lost', '', false, 1400, true);
      break;
    case 'junk': sound.junk(); for (const p of f.paddles) input.buzz(who(p), 120); break;
    case 'shrunk': for (const p of f.paddles) input.buzz(who(p), 80); break;
    case 'sent': sound.launch(); break;
    case 'combo': if (e.mult >= 3) input.buzz(who(f.paddles[0]), 20); break;
  }
}

// --- the loop -----------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

function tick() {
  if (stage === 'paused' || stage === 'results') return;
  stageT += TICK;
  if (demo) {
    stepAll(fields);
    for (const f of fields) for (const e of f.events) react(f, e);
    const f = fields[0];
    if ((f.cleared || f.over) && stageT > 1.5) newDemo(); // (the demo goes on for ever)
    else if (!f.cleared && !f.over) stageT = 0;
    return;
  }
  if (stage === 'countdown') {
    const n = 3 - Math.floor(stageT / 0.7);
    if (n !== countShown) { countShown = n; callout(n > 0 ? String(n) : 'Go', n === 3 ? `Round ${round} · ${fields[0].level.name}` : '', '', false, 700); sound.count(n <= 0); }
    if (stageT >= 2.1) { stage = 'playing'; stageT = 0; }
    return;
  }
  if (stage === 'clear') { if (stageT >= 2.8) nextWall(); return; }
  if (stage === 'roundOver') {
    if (stageT < 2.8) return;
    const best = [...wins.entries()].find(([, w]) => w >= settings.target);
    return best ? endMatch(best[0]) : nextRound();
  }
  stepAll(fields);
  for (const f of fields) for (const e of f.events) react(f, e);
  if (mode === 'coop') {
    const f = fields[0];
    if (f.cleared) wallCleared();
    else if (f.over) gameOver();
  } else {
    const j = judgeRound(fields, stageT);
    if (j.over) endRound(j.winner);
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const playing = !demo && (stage === 'playing' || stage === 'countdown' || stage === 'clear' || stage === 'roundOver');
  for (const c of input.list) (playing ? playInput(c) : menuInput(c));
  acc += dt;
  while (acc >= TICK) { tick(); acc -= TICK; }
  view.frame(stage === 'paused' ? 0 : dt);
  guard.frame(now);
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; renderHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
}

addEventListener('resize', () => layoutView());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('stick')} Move</span><span>${glyph('bolt')} Launch · fire the laser</span><span>${glyph('drop')} Send (versus)</span>`;
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
