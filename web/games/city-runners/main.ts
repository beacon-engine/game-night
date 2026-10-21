// City Runners: the game flow. Lobby (with computer runners going behind it), picking a look, the
// countdown, the run, results, saved records. The course is made up in course.ts, the running in
// run.ts, the 3D world in scene.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerColor, playerKey, requireDevice, shopItems, showManual,
  starsLabel, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { Course, ROUTES, todaySeed, type Power, type Tech } from './course.ts';
import { loadPeople, type Look } from './people.ts';
import { POWER_TIME, Run, TICK, type Out, type Runner, type RunnerSpec, type Stats } from './run.ts';
import { POWER_COLOR, World } from './scene.ts';
import { Sounds } from './sound.ts';

const device = await requireDevice(); // (simple 3D: not on the lightest screens)
// The runners to choose from (runners.json), as animated people (people.ts)
interface RunnerType extends Stats { id: string; name: string; about: string; body: Look['body']; skin: Look['skin']; tint: number; hair: string; beard?: boolean; top: string; legs: string }
const [{ runners: RUNNERS }] = await Promise.all([
  fetch('runners.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ runners: RunnerType[] }>),
  loadPeople(),
  document.fonts.load('900 100px "Big Shoulders Display"'), // (the signs are painted in it)
]);
const controls = await loadControls(['run'] as const, ['jump', 'slide'] as const);
const saves = gameSaves();
// Suits and trails bought with stars (shop.json); everyone also has their runner's own kit and a trail in their colour
interface Item { id: string; name: string; color: string }
const SHOP = await shopItems('city-runners');
const lookOf = (kind: string): Item[] => SHOP.filter((it) => it.extra.kind === kind && typeof it.extra.color === 'string')
  .map((it) => ({ id: it.id.slice('city-runners/'.length), name: it.name, color: it.extra.color as string }));
const OUTFITS = lookOf('outfit'), TRAILS = lookOf('trail');

// What we remember about each runner, and the furthest anyone has run
interface PlayerRecord { name: string; runs: number; wins: number; best: number; bestScore: number; coins: number; runner?: string; outfit?: string; trail?: string }
interface BestRun { distance: number; name: string }
const freshRecord = (name: string): PlayerRecord => ({ name, runs: 0, wins: 0, best: 0, bestScore: 0, coins: 0 });
let bestRun: BestRun | null = null;

interface Person {
  record: PlayerRecord | null;
  pick: number; // their runner (runners.json)
  outfits: Item[]; // what they own
  trails: Item[];
  outfit: number; // 0 = their runner's own top, then outfits[outfit - 1]
  trail: number; // 0 = their own colour, then trails[trail - 1]
  ready: boolean;
  newBest: boolean;
  earned: Earned | null;
}
const input = new Input({ state: (): Person => ({ record: null, pick: 0, outfits: [], trails: [], outfit: 0, trail: 0, ready: false, newBest: false, earned: null }) });
type Player = Pad<Person>;
const outfitOf = (c: Player) => c.outfits[c.outfit - 1] ?? { id: '', name: `${RUNNERS[c.pick].name}'s kit`, color: RUNNERS[c.pick].top };
const trailOf = (c: Player) => c.trails[c.trail - 1] ?? { id: '', name: 'Your colour', color: c.color };

// --- settings, chosen in the lobby --------------------------------------------------------------
const PACES = [{ name: 'Easy', base: 11 }, { name: 'Normal', base: 13 }, { name: 'Fast', base: 15.5 }];
const settings = { route: 0, course: 0, rivals: 1, pace: 1 }; // course: 0 today's, 1 a new one
const ROWS = ['route', 'course', 'rivals', 'pace'] as const;
let row = 0;

type Stage = 'lobby' | 'wardrobe' | 'countdown' | 'running' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'running';
let stageT = 0;
let run: Run;
let countShown = 0;
let lastOneCalled = false; // "last one running" has been said
let endT = -1; // seconds since the last person went out (-1: not yet)
const players = new Map<string, Player>(); // the people in this run, even if their phone has gone since

const world = new World($<HTMLCanvasElement>('world'), device.tv);
const sounds = new Sounds();
const maxFps = device.tv ? 30 : 60;
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle: (level) => { world.lowerDetail(level); world.resize(); callout('Keeping it smooth', 'Detail turned down'); },
});
guard.watchCanvas(world.renderer.domElement);

// --- the runners ------------------------------------------------------------------------------------
const stats = (t: RunnerType): Stats => ({ agility: t.agility, spring: t.spring, grit: t.grit, reach: t.reach });
// a runner in their kit (or a suit from the shop), in shoes of their player colour
const look = (t: RunnerType, top: string, shoes: string): Look =>
  ({ body: t.body, skin: t.skin, tint: t.tint, hair: t.hair, beard: t.beard, top, legs: t.legs, shoes });

// The computer runners are the runners nobody's picked, in a random order
function field(withPeople: boolean): RunnerSpec[] {
  const list = withPeople ? [...input.list].sort((a, b) => a.slot - b.slot) : [];
  const people: RunnerSpec[] = list.map((c) => {
    const t = RUNNERS[c.pick];
    return { id: c.id, name: c.label, color: c.color, look: look(t, outfitOf(c).color, c.color), trail: trailOf(c).color, stats: stats(t), ai: false };
  });
  const used = new Set(list.map((c) => c.slot)), picked = new Set(list.map((c) => c.pick));
  const free = shuffle(RUNNERS.filter((_, i) => !picked.has(i)));
  const n = Math.min(free.length, withPeople ? settings.rivals : 3);
  const rivals: RunnerSpec[] = [];
  for (let slot = 0; rivals.length < n && slot < 16; slot++) {
    if (used.has(slot)) continue;
    const color = playerColor(slot), t = free[rivals.length];
    rivals.push({ id: `cpu${rivals.length}`, name: t.name, color, look: look(t, t.top, color), trail: color, stats: stats(t), ai: true });
  }
  return [...people, ...rivals];
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function newRun(withPeople: boolean) {
  const seed = withPeople && settings.course === 0 ? todaySeed() : Math.floor(Math.random() * 1e9);
  run = new Run(new Course(seed, PACES[settings.pace].base, ROUTES[settings.route]), field(withPeople));
  world.setRun(run);
  buildTags();
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  stageT = 0;
  newRun(false); // the computer runners behind the menu
  sounds.silence();
  show('lobby');
  renderLobby();
  loadBestRun();
}

// Start: everyone picks their runner first
function start() {
  if (!input.list.length) return callout('Join first', 'Scan the code with your phone');
  for (const c of input.list) { c.ready = false; loadLooks(c); }
  stage = 'wardrobe';
  newRun(true);
  renderWardrobe();
  show('hud');
}

function startRun() {
  players.clear();
  for (const c of input.list) { players.set(c.id, c); c.newBest = false; c.earned = null; c.drain(); }
  newRun(true);
  stage = 'countdown';
  stageT = 0;
  countShown = 0;
  lastOneCalled = false;
  endT = -1;
  $('wardrobe').innerHTML = '';
  show('hud');
}

function endRun() {
  stage = 'results';
  saveRecords();
  payOut();
  renderResults();
  show('results');
  sounds.silence();
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'countdown' || stage === 'running') { resumeTo = stage; stage = 'paused'; show('pause'); sounds.silence(); }
}

const human = (r: Runner) => !r.spec.ai;
const playerOf = (r: Runner) => players.get(r.id);
const buzz = (r: Runner, ms: number) => input.buzz(input.list.find((c) => c.id === r.id), ms);
const OUT_TEXT: Record<Out, string> = { crashed: 'crashed', fell: 'fell', caught: 'was caught by the drone' };

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  const last = RUNNERS.findIndex((t) => t.id === c.record?.runner); // (who they ran as last time)
  c.pick = last >= 0 ? last : c.slot % RUNNERS.length;
  if (stage === 'lobby') renderLobby();
  loadLooks(c);
}

async function loadLooks(c: Player) {
  const owned = await ownedItems(c);
  const wasOutfit = outfitOf(c).id || c.record?.outfit, wasTrail = trailOf(c).id || c.record?.trail;
  c.outfits = OUTFITS.filter((o) => owned.includes(o.id));
  c.trails = TRAILS.filter((o) => owned.includes(o.id));
  c.outfit = c.outfits.findIndex((o) => o.id === wasOutfit) + 1; // (back to the plain suit if it's not theirs)
  c.trail = c.trails.findIndex((o) => o.id === wasTrail) + 1;
  if (stage === 'wardrobe') { newRun(true); renderWardrobe(); }
}

async function loadBestRun() {
  if (bestRun) return;
  bestRun = await saves.get<BestRun>('best-run');
  if (stage === 'lobby') renderLobby();
}

// Stars for everyone who ran: for running, for outlasting everyone (when there was someone to beat), for a personal best
function payOut() {
  const order = run.standings(), against = run.runners.length > 1;
  for (const c of players.values()) {
    const r = run.runners.find((x) => x.id === c.id);
    if (!r) continue;
    const why: EarnFor[] = ['played'];
    if (against && order[0] === r) why.push('won');
    if (c.newBest) why.push('record');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

function saveRecords() {
  const order = run.standings(), against = run.runners.length > 1;
  for (const c of players.values()) {
    const r = run.runners.find((x) => x.id === c.id);
    if (!r) continue;
    const rec = c.record ?? freshRecord(c.label);
    const m = Math.floor(r.s);
    rec.name = c.label;
    rec.runs++;
    if (against && order[0] === r) rec.wins++;
    c.newBest = m > rec.best && rec.runs > 1;
    rec.best = Math.max(rec.best, m);
    rec.bestScore = Math.max(rec.bestScore, Math.floor(r.score));
    rec.coins += r.coins;
    rec.runner = RUNNERS[c.pick].id;
    rec.outfit = outfitOf(c).id || undefined;
    rec.trail = trailOf(c).id || undefined;
    c.record = rec;
    saves.set(playerKey(c), rec);
    if (!bestRun || m > bestRun.distance) {
      bestRun = { distance: m, name: c.label };
      saves.set('best-run', bestRun);
    }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.runs ? 'First run' :
  `Best ${r.best.toLocaleString()} m · ${plural(r.wins, 'win', 'wins')} from ${plural(r.runs, 'run', 'runs')}`;

input.onJoin = (c) => {
  loadRecord(c);
  if (stage === 'lobby') renderLobby();
  if (stage === 'wardrobe') { newRun(true); renderWardrobe(); }
};
input.onLeave = (c) => {
  // their runner carries on as a computer runner
  const r = run.runners.find((x) => x.id === c.id);
  if (r && stage !== 'lobby' && stage !== 'wardrobe') r.spec.ai = true;
  if (stage === 'lobby') renderLobby();
  if (stage === 'wardrobe') { if (input.list.length) { newRun(true); renderWardrobe(); } else toLobby(); }
};
input.onRename = () => stage === 'lobby' && renderLobby();
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'City Runners');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  if (stage === 'wardrobe' && !c.ready && (fx || fy)) {
    if (fx) c.pick = (c.pick + fx + RUNNERS.length) % RUNNERS.length;
    if (fy) c.outfit = (c.outfit - fy + c.outfits.length + 1) % (c.outfits.length + 1);
    newRun(true);
    renderWardrobe();
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.leaf && stage === 'wardrobe' && !c.ready && c.trails.length) {
      c.trail = (c.trail + 1) % (c.trails.length + 1);
      newRun(true);
      renderWardrobe();
    } else if (ev.bit === BIT.bolt) (stage === 'wardrobe' ? toggleReady(c) : confirm());
    else if (ev.bit === BIT.drop) (stage === 'wardrobe' && c.ready ? toggleReady(c) : back());
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
  }
}

function toggleReady(c: Player) {
  c.ready = !c.ready;
  renderWardrobe();
  if (input.list.every((p) => p.ready)) startRun();
}

function change(d: number) {
  const key = ROWS[row];
  if (key === 'route') {
    settings.route = (settings.route + d + ROUTES.length) % ROUTES.length;
    newRun(false); // (the run behind the menu moves to the new route)
  } else if (key === 'course') settings.course = 1 - settings.course;
  else if (key === 'rivals') settings.rivals = Math.max(0, Math.min(3, settings.rivals + d));
  else settings.pace = (settings.pace + d + PACES.length) % PACES.length;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') start();
  else if (stage === 'wardrobe') startRun(); // (Enter on the keyboard: go now)
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused' || stage === 'wardrobe') toLobby();
}

// One tap, one move: ◀ ▶ change lanes, ▲ jumps, ▼ slides (and Bolt and Drop jump and slide too)
function runInput(c: Player) {
  const fx = c.flickX(), fy = c.flickY();
  const events = c.drain();
  const r = run.runners.find((x) => x.id === c.id);
  if (!r || r.out || stage !== 'running') return;
  if (fx) run.move(r, fx);
  if (fy < 0) run.jump(r);
  else if (fy > 0) run.duck(r);
  for (const ev of events) {
    if (!ev.down) continue;
    const a = controls.action('run', ev.bit);
    if (a === 'jump') run.jump(r);
    else if (a === 'slide') run.duck(r);
  }
}

addEventListener('keydown', (e) => {
  sounds.unlock();
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' || stage === 'wardrobe' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => sounds.unlock());

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'City Runners', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'wardrobe': return c.ready
      ? { ...base, labels: { drop: 'Change' }, hint: 'Ready. Waiting for the others' }
      : { ...base, labels: { bolt: 'Ready', drop: 'Back', ...(c.trails.length ? { leaf: 'Trail' } : {}) },
        hint: `◀▶ runner: ${RUNNERS[c.pick].name}${c.outfits.length ? ' · ▲▼ suit' : ''}` };
    case 'results': return { ...base, labels: { bolt: 'Run again', drop: 'Lobby' }, hint: 'Run over' };
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const r = run.runners.find((x) => x.id === c.id);
      if (!r) return { ...base, labels: {}, hint: 'You run next time' };
      if (r.out) return { ...base, labels: {}, hint: `Out at ${Math.floor(r.s)} m · ${plural(r.coins, 'coin', 'coins')}` };
      const ahead = run.course.crossingAhead(r.s, run.speed * 4); // (about four seconds' warning)
      const hint = stage === 'countdown' ? 'Find your tag on the screen'
        : r.hang?.kind === 'rope' ? 'Swing! ▲ late in the swing to reach the next rope'
        : ahead ? `Crossing: ${ahead.map((t) => (t ? TECH_NAME[t] : '·')).join(' | ')}`
        : `${Math.floor(r.s)} m · ◀▶ lanes · ▲ jump · ▼ slide`;
      return { ...base, labels: controls.labels('run'), hint };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
}

function renderLobby() {
  const people = input.list;
  $('runners').innerHTML = people.length
    ? people.map((c) => `<div class="runner">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to run. On your own? Run against the computer, or for distance.</p>';
  const value = { route: ROUTES[settings.route].name, course: settings.course ? 'A new one' : "Today's", rivals: String(settings.rivals), pace: PACES[settings.pace].name };
  const label = { route: 'Route', course: 'Course', rivals: 'Computer runners', pace: 'Start speed' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  $('routeAbout').textContent = ROUTES[settings.route].about;
  $('record').textContent = bestRun ? `Furthest run: ${bestRun.distance.toLocaleString()} m by ${bestRun.name}` : 'Nobody has set a distance here yet.';
}

// Picking runners: a card each, over the runners standing on the first roof
function renderWardrobe() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  const bar = (label: string, v: number, lo: number, hi: number) =>
    `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.08, Math.min(1, (v - lo) / (hi - lo))) * 100)}%"></b></i></div>`;
  $('wardrobe').innerHTML = list.map((c) => {
    const t = RUNNERS[c.pick];
    return `<div class="look panel">${chip(c)}
      <div class="name"><span class="glyph glyph-key">◀</span><h2>${escapeHtml(t.name)}</h2><span class="glyph glyph-key">▶</span></div>
      <p class="muted">${escapeHtml(t.about)}</p>
      ${bar('Agility', t.agility, 0.7, 1.35)}${bar('Spring', t.spring, 0.85, 1.18)}${bar('Grit', t.grit, 0.6, 1.45)}${bar('Reach', t.reach, 0.6, 2.3)}
      <div class="row"><span><i style="background:${outfitOf(c).color}"></i>${escapeHtml(outfitOf(c).name)}</span><span class="faint">${c.outfits.length ? '▲▼' : 'more in the shop'}</span></div>
      <div class="row"><span><i style="background:${trailOf(c).color === 'rainbow' ? 'linear-gradient(90deg,#f55,#fd3,#3d8,#3bf,#a6f)' : trailOf(c).color}"></i>${escapeHtml(trailOf(c).name)}</span><span class="faint">${c.trails.length ? glyph('leaf') : ''}</span></div>
      <div class="ready ${c.ready ? 'on' : ''}">${c.ready ? 'Ready' : `${glyph('bolt')} when you're happy`}</div></div>`;
  }).join('');
  $('board').innerHTML = '';
}

// A tag over each runner's head, and a box for each along the top
function buildTags() {
  $('tags').innerHTML = run.runners.map((r, i) => {
    const c = input.list.find((p) => p.id === r.id);
    return `<div class="tag ${r.spec.ai ? 'cpu' : ''}" id="tag${i}" style="--pc:${r.spec.color}">${escapeHtml(c ? c.tag : r.spec.name)}</div>`;
  }).join('');
  $('board').innerHTML = run.runners.map((r, i) => `<div class="lane" id="lane${i}" style="--pc:${r.spec.color}"><b>${escapeHtml(r.spec.name)}</b>
      <span class="m"></span><span class="coins"></span><span class="pw"></span><span class="warn"></span></div>`).join('');
}

const TECH_NAME: Record<Tech, string> = { zip: 'Zip (fast)', balance: 'Rail (safe)', ropes: 'Ropes' };
const POWER_NAME: Record<Power, string> ={ magnet: 'Magnet', boots: 'Boots', shield: 'Shield', double: '×2' };

function updateHud() {
  run.runners.forEach((r, i) => {
    const el = document.getElementById(`lane${i}`);
    if (!el) return;
    el.classList.toggle('out', !!r.out);
    el.querySelector('.m')!.innerHTML = `${Math.floor(Math.max(0, r.s)).toLocaleString()}<small>m</small>`;
    el.querySelector('.coins')!.textContent = `${r.coins} coins`;
    el.querySelector('.pw')!.innerHTML = r.out ? '' : (Object.keys(r.powers) as Power[]).filter((p) => r.powers[p] > 0)
      .map((p) => `<i style="background:${POWER_COLOR[p]}">${POWER_NAME[p]}${p === 'shield' ? '' : ` ${Math.ceil(r.powers[p])}`}</i>`).join('');
    el.querySelector('.warn')!.textContent = r.out ? outWord(r.out) : r.drone > 0 ? 'Drone!' : '';
  });
}

const outWord = (o: Out) => ({ crashed: 'Crashed', fell: 'Fell', caught: 'Caught' })[o];

// Each frame: the tags follow the runners
function placeTags() {
  run.runners.forEach((r, i) => {
    const el = document.getElementById(`tag${i}`);
    if (!el) return;
    const at = r.out ? null : world.screenOf(r);
    el.style.display = at && stage !== 'wardrobe' ? '' : 'none';
    if (at) { el.style.left = `${at.x * 100}%`; el.style.top = `${at.y * 100}%`; }
  });
}

function renderResults() {
  const order = run.standings(), win = order[0], solo = run.runners.length === 1;
  $('resultsWhat').textContent = solo ? 'Run over' : 'Last one running';
  $('winner').innerHTML = solo ? `${Math.floor(win.s).toLocaleString()} m`
    : `<span style="color:${win.spec.color}">${escapeHtml(win.spec.name)}</span> wins`;
  $('standings').innerHTML = order.map((r, i) => {
    const p = playerOf(r);
    const who = p ? chip(p) : `<span class="chip" style="--pc:${r.spec.color}"><b>CPU</b>${escapeHtml(r.spec.name)}</span>`;
    const note = [r.out ? outWord(r.out) : 'Still running', p ? recordLine(p.record) : '', p?.newBest ? 'New best' : ''].filter(Boolean).join(' · ');
    return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${who}
      <span class="caption">${escapeHtml(note)}${p?.earned?.earned ? ` · +${starsLabel(p.earned.earned)}` : ''}</span>
      <span class="d">${Math.floor(r.s).toLocaleString()} m</span><span class="c">${plural(r.coins, 'coin', 'coins')}</span><span class="sc">${Math.floor(r.score).toLocaleString()} pts</span></div>`;
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
function tick() {
  stageT += TICK;
  if (stage === 'wardrobe') return;
  if (stage === 'countdown') {
    const n = 3 - Math.floor(stageT / 0.8);
    if (n !== countShown) {
      countShown = n;
      callout(n > 0 ? String(n) : 'Run', n > 0 ? 'Get ready' : '');
      if (n <= 0) for (const r of run.runners) if (human(r)) buzz(r, 120);
    }
    if (stageT >= 2.4) { stage = 'running'; stageT = 0; }
    run.step(false);
    return;
  }
  const ev = run.step(true);
  if (stage === 'lobby') {
    if (!run.alive.length) newRun(false); // (the computer runners go again)
    return;
  }
  if (stage !== 'running') return; // (the results: anyone still going carries on behind them)
  const people = (rs: Runner[]) => rs.filter(human);
  if (people(ev.jumped).length) sounds.jump();
  if (people(ev.coin).length) sounds.coin();
  for (const { r, power } of ev.power) if (human(r)) { sounds.power(); buzz(r, 80); callout(POWER_NAME[power], `${r.spec.name}${POWER_TIME[power] ? ` · ${POWER_TIME[power]} s` : ' · saves you once'}`); }
  for (const r of ev.stumbled) if (human(r)) { sounds.stumble(); buzz(r, 250); }
  for (const r of ev.shielded) if (human(r)) { sounds.shield(); buzz(r, 150); }
  for (const r of ev.out) {
    if (human(r)) { sounds.out(); buzz(r, 500); }
    callout(`<span style="color:${r.spec.color}">${escapeHtml(r.spec.name)}</span>`, `${OUT_TEXT[r.out!]} at ${Math.floor(r.s)} m`);
  }
  // the last one running (when there was someone to beat)
  const alive = run.alive;
  if (!lastOneCalled && run.runners.length > 1 && alive.length === 1) {
    lastOneCalled = true;
    const r = alive[0];
    callout(`<span style="color:${r.spec.color}">${escapeHtml(r.spec.name)}</span> wins`, 'Last one running');
    buzz(r, 300);
  }
  // once every person is out, it's over (any computer runners still going outlasted them)
  if (endT < 0 && !alive.some(human)) endT = 0;
  if (endT >= 0 && (endT += TICK) > 1.6) endRun();
}

const MIN_FRAME = 1000 / maxFps - 1;
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'countdown' || stage === 'running' ? runInput(c) : menuInput(c));
  if (stage !== 'paused') {
    acc += dt;
    while (acc >= TICK) { tick(); acc -= TICK; }
  }
  world.facing = stage === 'wardrobe';
  world.render(run, dt, now);
  if (stage !== 'lobby' && stage !== 'results') placeTags();
  const racing = stage === 'running';
  let danger = 0;
  if (racing) for (const r of run.runners) if (human(r) && !r.out) danger = Math.max(danger, Math.min(1, r.drone / 7));
  sounds.whine(danger);
  hudT += dt;
  if (hudT > 0.1 && (racing || stage === 'countdown' || stage === 'paused')) { hudT = 0; updateHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
  guard.frame(now);
}

// --- start ----------------------------------------------------------------------------------------------
addEventListener('resize', () => world.resize());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('back').innerHTML = `${glyph('drop')} Games`;
$('start').innerHTML = `${glyph('bolt')} Start`;
$('howto').innerHTML = `${glyph('star')} How to play`;
$('again').innerHTML = `${glyph('bolt')} Run again`;
$('toLobby').innerHTML = `${glyph('drop')} Lobby`;
$('pauseLegend').innerHTML = `<span>${glyph('bolt')} Resume</span><span>${glyph('drop')} Quit to the lobby</span>`;
$('legend').innerHTML = `<span>${glyph('dpad')} Lanes, jump, slide</span><span>${glyph('bolt')} Jump</span><span>${glyph('drop')} Slide</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', start);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
world.resize();
sounds.unlock(); // (works straight away in the TV app; elsewhere, on the first click or key)
toLobby();
requestAnimationFrame(frame);
