// Rally: the game flow. Lobby (with a race going on behind it), picking cars, the grid, the race,
// results, saved records. The stages and cars are data (stages.json, cars.json); the land and road are
// built in stage.ts, the car physics is physics.ts, the racing and computer drivers race.ts, the 3D
// world scene.ts. The car models, their paint and the engine sound come from Stock Cars.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { loadCars } from '../stock-cars/cars.ts';
import { Engines } from '../stock-cars/sound.ts';
import { chassisOf, shapeOf, type RallyCar } from './chassis.ts';
import { TICK } from './physics.ts';
import { Race, type RaceEvents, type Racer, type RacerSpec } from './race.ts';
import { World } from './scene.ts';
import { Stage, type StageSpec } from './stage.ts';

const device = await requireDevice(); // (3D with a big stage: not on the lightest screens)
const getJson = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);
const [{ stages: STAGES }, { cars: CARS }] = await Promise.all([
  getJson<{ stages: StageSpec[] }>('stages.json'),
  getJson<{ cars: RallyCar[] }>('cars.json'),
  document.fonts.load('900 100px "Big Shoulders Display"'), // (the cars' numbers are painted in it)
]);
const models = await loadCars(CARS, device.tier === 'heavy' && !device.tv);
const shapes = new Map(CARS.map((t) => [t.id, shapeOf(models.get(t.id)!)]));
// Paint jobs bought with stars (shop.json); everyone also has their own player colour
interface Paint { id: string; name: string; color: string }
const PAINTS: Paint[] = (await shopItems('rally')).filter((it) => typeof it.extra.color === 'string')
  .map((it) => ({ id: it.id.slice('rally/'.length), name: it.name, color: it.extra.color as string }));
const controls = await loadControls(['drive'] as const, ['throttle', 'brake', 'handbrake', 'reset', 'lookBack'] as const);
const saves = gameSaves();

// What we remember about each driver, and the fastest lap of each stage
interface PlayerRecord { name: string; races: number; wins: number; podiums: number; bigAir: number; car?: string; paint?: string }
interface StageRecord { time: number; name: string; car?: string }
const freshRecord = (name: string): PlayerRecord => ({ name, races: 0, wins: 0, podiums: 0, bigAir: 0 });
const stageRecords = new Map<string, StageRecord | null>();

interface Driver {
  record: PlayerRecord | null;
  pick: number; // the car (cars.json)
  ready: boolean;
  paints: Paint[]; // the paint jobs they own
  paint: number; // 0 = their own colour, then paints[paint - 1]
  stageRecord: boolean; // set the stage's lap record this race
  earned: Earned | null; // stars from the last race
}
const input = new Input({ state: (): Driver => ({ record: null, pick: 0, ready: false, paints: [], paint: 0, stageRecord: false, earned: null }) });
type Player = Pad<Driver>;
const paintOf = (c: Player) => c.paints[c.paint - 1] ?? { id: '', name: 'Your colour', color: c.color };

// --- settings, chosen in the lobby --------------------------------------------------------------
const LAPS = [1, 2, 3, 5];
const LEVELS = [{ name: 'Easy', skill: 0.88 }, { name: 'Medium', skill: 0.94 }, { name: 'Hard', skill: 1 }];
const settings = { stage: 0, rivals: 3, laps: 2, level: 1 };
const ROWS = ['stage', 'rivals', 'laps', 'level'] as const;
let row = 0; // the lobby row being changed

type Step = 'lobby' | 'garage' | 'grid' | 'racing' | 'results' | 'paused';
let step: Step = 'lobby';
let resumeTo: Step = 'racing';
let stepT = 0;
let race: Race;
let flagT = -1; // seconds since the winner crossed the line (-1: not yet)
let countShown = 0;
const drivers = new Map<string, Player>(); // the people in this race, even if their phone has gone since
const flashes = new Map<Racer, { text: string; t: number }>(); // a message on that driver's screen
const notes = new Map<Racer, string>(); // the co-driver's next call, for each person

const stages = new Map<string, Stage>();
const stageSpec = () => STAGES[settings.stage];
const stage = () => {
  const spec = stageSpec();
  if (!stages.has(spec.id)) stages.set(spec.id, new Stage(spec));
  return stages.get(spec.id)!;
};
const stageRecord = () => stageRecords.get(stageSpec().id) ?? null;

const world = new World($<HTMLCanvasElement>('world'));
const engines = new Engines();
// (the engine sound takes how much each car is sliding and whether it's in the air, and the nearest rival)
const updateEngines: (cars: { id: string; v: number; throttle: number; slip?: number; air?: boolean; pan?: number }[], others?: { near: number; v: number }) => void
  = engines.update.bind(engines);

// A steady 30 on a TV is kinder than a ragged 60
const maxFps = device.tv ? 30 : 60;
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle: (level) => { world.lowerDetail(level); world.resize(); callout('Keeping it smooth', 'Detail turned down'); },
});
guard.watchCanvas(world.renderer.domElement);

// --- the field ------------------------------------------------------------------------------------
// The computer drivers: made-up names, plain colours, no sponsors
const RIVALS = ['Kestrel', 'Tarn', 'Ember', 'Moss', 'Flint', 'Wren', 'Sable', 'Juno'];
const LIVERIES = ['#e8e6df', '#ff8a3d', '#3fd0ff', '#9b6bff', '#2a2f3d', '#0f8a63', '#d94040', '#f2d03b'];
const NUMBERS = [3, 8, 12, 19, 24, 33, 46, 58];

const specOf = (t: RallyCar) => ({ car: { id: t.id, name: t.name }, chassis: chassisOf(t, shapes.get(t.id)!) });

function field(withPeople: boolean): RacerSpec[] {
  const people: RacerSpec[] = (withPeople ? input.list : []).map((c) => ({
    id: c.id, name: c.label, color: c.color, paint: paintOf(c).color, number: c.slot + 1, ai: false, skill: 1, ...specOf(CARS[c.pick]),
  }));
  const taken = new Set(people.map((p) => p.color.toLowerCase()));
  const liveries = LIVERIES.filter((c) => !taken.has(c));
  const skill = LEVELS[settings.level].skill;
  const n = withPeople ? Math.max(settings.rivals, people.length ? 0 : 1) : 5;
  const rivals = Array.from({ length: n }, (_, i): RacerSpec => ({
    id: `cpu${i}`, name: RIVALS[i], color: liveries[i % liveries.length], number: NUMBERS[i], ai: true,
    skill: skill + (Math.random() - 0.5) * 0.02, ...specOf(CARS[Math.floor(Math.random() * CARS.length)]),
  }));
  // people at the back, so nobody has to fight their way out of a pack of computer drivers at the start
  return [...shuffle(rivals), ...people];
}

function newRace(withPeople: boolean, laps: number) {
  world.setStage(stage());
  race = new Race(stage(), field(withPeople), laps);
  world.setCars(race.racers, models);
  const slot = (r: Racer) => input.list.find((p) => p.id === r.id)?.slot ?? 99;
  world.setViews(race.racers.filter((r) => !r.spec.ai).sort((a, b) => slot(a) - slot(b))); // (P1 top left)
  flashes.clear();
  notes.clear();
  buildHud();
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  step = 'lobby';
  stepT = 0;
  newRace(false, 999); // the race behind the menu
  engines.silence();
  show('lobby');
  renderLobby();
  loadStageRecord();
}

// Start: everyone picks a car first (on their own, the computer drivers just race)
function start() {
  if (!input.list.length) return startRace();
  step = 'garage';
  for (const c of input.list) {
    c.ready = false;
    loadPaints(c); // (they may have just bought one on their phone)
  }
  showroom();
  show('hud');
}

function startRace() {
  drivers.clear();
  for (const c of input.list) {
    drivers.set(c.id, c);
    c.stageRecord = false;
    c.earned = null;
  }
  newRace(true, settings.laps);
  step = 'grid';
  stepT = 0;
  flagT = -1;
  countShown = 0;
  for (const c of input.list) c.drain();
  show('hud');
}

function endRace() {
  step = 'results';
  saveRecords();
  payOut();
  renderResults();
  show('results');
  engines.silence();
}

function togglePause() {
  if (step === 'paused') { step = resumeTo; show('hud'); }
  else if (step === 'grid' || step === 'racing') { resumeTo = step; step = 'paused'; show('pause'); engines.silence(); }
}

const people = () => race.racers.filter((r) => !r.spec.ai);
const playerOf = (r: Racer) => drivers.get(r.id);
const buzz = (r: Racer, ms: number) => input.buzz(input.list.find((c) => c.id === r.id), ms);
const flash = (r: Racer, text: string) => flashes.set(r, { text, t: race.t });

function onLap(r: Racer) {
  if (r.laps === race.laps - 1 && race.laps > 1 && race.standings()[0] === r) callout('Final lap', 'White flag');
  if (r.spec.ai) return;
  flash(r, `Lap ${fmt(r.lastLap)}${r.lastLap === r.bestLap && r.laps > 1 ? ' · best' : ''}`);
  const record = stageRecord();
  if (!record || r.lastLap < record.time) {
    const next = { time: r.lastLap, name: r.spec.name, car: r.spec.car.name };
    stageRecords.set(stageSpec().id, next);
    saves.set(`stage-record-${stageSpec().id}`, next);
    callout(fmt(r.lastLap), `Stage record · ${r.spec.name}`);
    const who = playerOf(r);
    if (who) who.stageRecord = true;
    buzz(r, 150);
  }
}

function onFinish(r: Racer) {
  if (flagT >= 0) return;
  flagT = 0;
  callout(`<span style="color:${r.spec.ai ? 'var(--chalk)' : r.spec.color}">${escapeHtml(r.spec.name)}</span> wins`, 'Chequered flag');
  buzz(r, 300);
}

// What happened this tick, to the people: hits, landings and being put back on the road
function onEvents(ev: RaceEvents) {
  for (const h of ev.hits) {
    world.hit(h.racer, h.strength);
    if (h.racer.spec.ai || h.strength < 2.5) continue;
    buzz(h.racer, Math.min(400, 40 + h.strength * 25));
    if (h.kind === 'ground' || h.kind === 'post') engines.crunch(Math.min(1, h.strength / 8));
    else engines.thump(Math.min(1, h.strength / 8));
  }
  for (const l of ev.landings) {
    world.land(l.racer, l.impact);
    if (l.racer.spec.ai) continue;
    if (l.impact > 3) { engines.thump(Math.min(1, l.impact / 9)); buzz(l.racer, Math.min(300, l.impact * 30)); }
    if (l.air > 0.7) flash(l.racer, `${l.air > 1.4 ? 'Huge' : 'Big'} air · ${l.air.toFixed(1)} s`);
  }
  for (const r of ev.reset) if (!r.spec.ai) flash(r, r.why === 'flipped' ? 'Back on your wheels' : 'Back on the road');
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  const last = CARS.findIndex((t) => t.id === c.record?.car); // (the car they drove last time)
  if (last >= 0) c.pick = last;
  if (step === 'lobby') renderLobby();
  loadPaints(c);
}

async function loadPaints(c: Player) {
  const owned = await ownedItems(c);
  const was = paintOf(c).id || c.record?.paint;
  c.paints = PAINTS.filter((p) => owned.includes(p.id));
  c.paint = c.paints.findIndex((p) => p.id === was) + 1; // (back to their own colour if it's not theirs)
  if (step === 'garage') showroom();
}

// Stars for everyone who started: for finishing, a win or a podium (against someone), a stage record
function payOut() {
  const order = race.standings(), against = race.racers.length > 1;
  for (const c of drivers.values()) {
    const r = race.racers.find((x) => x.id === c.id);
    if (!r) continue;
    const pos = order.indexOf(r) + 1, why: EarnFor[] = ['played'];
    if (against && pos === 1) why.push('won');
    else if (against && pos <= 3) why.push('podium');
    if (c.stageRecord) why.push('record');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (step === 'results') renderResults();
    });
  }
}

async function loadStageRecord() {
  const id = stageSpec().id;
  if (stageRecords.has(id)) return;
  stageRecords.set(id, await saves.get<StageRecord>(`stage-record-${id}`));
  if (step === 'lobby') renderLobby();
}

// everyone who started the race, including anyone whose phone dropped before the end
function saveRecords() {
  const order = race.standings();
  for (const c of drivers.values()) {
    const r = race.racers.find((x) => x.id === c.id);
    if (!r) continue;
    const pos = order.indexOf(r) + 1;
    const rec = c.record ?? freshRecord(c.label);
    rec.name = c.label;
    rec.races++;
    if (pos === 1) rec.wins++;
    if (pos <= 3) rec.podiums++;
    rec.bigAir = Math.max(rec.bigAir, r.bigAir);
    rec.car = r.spec.car.id;
    rec.paint = paintOf(c).id || undefined;
    c.record = rec;
    saves.set(playerKey(c), rec);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.races ? 'First rally' :
  `${plural(r.wins, 'win', 'wins')} from ${plural(r.races, 'race', 'races')}${r.bigAir > 0.5 ? ` · biggest air ${r.bigAir.toFixed(1)} s` : ''}`;

input.onJoin = (c) => {
  loadRecord(c);
  if (step === 'lobby') renderLobby();
  if (step === 'garage') showroom();
};
input.onLeave = (c) => {
  // their car finishes the race on its own
  const r = race.racers.find((x) => x.id === c.id);
  if (r && step !== 'lobby') r.spec.ai = true;
  if (step === 'lobby') renderLobby();
  if (step === 'garage') (input.list.length ? showroom() : toLobby());
};
input.onRename = () => step === 'lobby' && renderLobby();
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Rally');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (step === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  if (step === 'garage' && fx && !c.ready) {
    c.pick = (c.pick + fx + CARS.length) % CARS.length;
    showroom();
  }
  if (step === 'garage' && fy && !c.ready && c.paints.length) {
    c.paint = (c.paint - fy + c.paints.length + 1) % (c.paints.length + 1); // (▲ = the previous one)
    showroom();
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.bolt) (step === 'garage' ? toggleReady(c) : confirm());
    else if (ev.bit === BIT.drop) (step === 'garage' && c.ready ? toggleReady(c) : back());
    else if (ev.bit === BIT.star && step === 'lobby') howTo();
  }
}

function toggleReady(c: Player) {
  c.ready = !c.ready;
  renderGarage();
  if (input.list.every((p) => p.ready)) startRace();
}

function change(d: number) {
  const cycle = <T>(list: T[], v: T) => list[(list.indexOf(v) + d + list.length) % list.length];
  const key = ROWS[row];
  if (key === 'stage') {
    settings.stage = (settings.stage + d + STAGES.length) % STAGES.length;
    return toLobby(); // (the race behind the menu moves to the new stage)
  }
  if (key === 'rivals') settings.rivals = Math.max(0, Math.min(RIVALS.length - 3, settings.rivals + d));
  else if (key === 'laps') settings.laps = cycle(LAPS, settings.laps);
  else settings.level = (settings.level + d + LEVELS.length) % LEVELS.length;
  renderLobby();
}

function confirm() {
  if (step === 'lobby' || step === 'results') start();
  else if (step === 'garage') startRace(); // (Enter on the keyboard: go now)
  else if (step === 'paused') togglePause();
}

function back() {
  if (step === 'lobby') backToHub();
  else if (step === 'results' || step === 'paused' || step === 'garage') toLobby();
}

// The phone's steering slider (or the arrow keys) steers; gas, brake and handbrake are held
function driveInput(c: Player) {
  const r = race.racers.find((x) => x.id === c.id);
  for (const ev of c.drain()) if (ev.down && r && controls.action('drive', ev.bit) === 'reset' && step === 'racing') r.wantsReset = true;
  if (!r || r.spec.ai || r.finish !== null) return;
  const car = r.car;
  car.throttle = controls.held(c, 'drive', 'throttle') || c.y > 0.5 ? 1 : 0;
  car.brake = controls.held(c, 'drive', 'brake') || c.y < -0.5 ? 1 : 0;
  car.handbrake = controls.held(c, 'drive', 'handbrake') ? 1 : 0;
  const x = Math.abs(c.x) < 0.05 ? 0 : c.x;
  car.steer = Math.sign(x) * Math.abs(x) ** 1.3; // (fine control near the middle)
  const view = world.views.find((v) => v.racer === r);
  if (view) view.lookBack = controls.held(c, 'drive', 'lookBack');
}

addEventListener('keydown', (e) => {
  engines.unlock();
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && step === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (step === 'lobby' || step === 'results' || step === 'garage' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => engines.unlock());

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Rally', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (step) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'garage': return c.ready
      ? { ...base, labels: { drop: 'Change car' }, hint: 'Ready. Waiting for the others' }
      : { ...base, labels: { bolt: 'Ready', drop: 'Back' }, hint: c.paints.length ? `◀▶ car: ${CARS[c.pick].name} · ▲▼ paint` : `◀▶ pick your car: ${CARS[c.pick].name}` };
    case 'results': return { ...base, labels: { bolt: 'Race again', drop: 'Lobby' }, hint: 'Race over' };
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const r = race.racers.find((x) => x.id === c.id);
      if (!r) return { ...base, labels: {}, hint: 'You race next time' };
      const pos = ordinal(race.standings().indexOf(r) + 1);
      if (r.finish !== null) return { ...base, labels: {}, hint: `You finished ${pos}` };
      return { ...base, layout: 'racing', labels: controls.labels('drive'), hint: `${pos} · ${notes.get(r) ?? ''}` };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
}

function renderLobby() {
  const list = input.list;
  $('drivers').innerHTML = list.length
    ? list.map((c) => `<div class="driver">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to drive. On your own? Race the computer drivers.</p>';
  const value = { stage: stageSpec().name, rivals: String(settings.rivals), laps: plural(settings.laps, 'lap', 'laps'), level: LEVELS[settings.level].name };
  const label = { stage: 'Stage', rivals: 'Computer drivers', laps: 'Race', level: 'Their pace' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  const rec = stageRecord(), km = (stage().length / 1000).toFixed(1);
  $('stageAbout').textContent = `${stageSpec().about} ${km} km.`;
  $('record').textContent = rec ? `Stage record: ${fmt(rec.time)} by ${rec.name}${rec.car ? ` (${rec.car})` : ''}` : 'No stage record yet. Set one.';
}

// Picking cars: each person's choice turning in their part of the screen
function showroom() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  world.setStage(stage());
  world.showroom(list.map((c) => ({ model: models.get(CARS[c.pick].id)!, color: paintOf(c).color, number: c.slot + 1 })));
  renderGarage();
}

function renderGarage() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.08, Math.min(1, (v - 0.72) / 0.6)) * 100)}%"></b></i></div>`;
  $('views').innerHTML = world.views.map((v, i) => {
    const c = list[i], t = CARS[c.pick], r = v.rect;
    return `<div class="view pick" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="card panel">${chip(c)}
        <div class="carname"><span class="glyph glyph-key">◀</span><h2>${escapeHtml(t.name)}</h2><span class="glyph glyph-key">▶</span></div>
        <p class="muted">${escapeHtml(t.about)}</p>
        <div class="paint"><i style="background:${paintOf(c).color}"></i>${escapeHtml(paintOf(c).name)}${c.paints.length
          ? ` <span class="faint">· ▲▼ ${c.paints.length + 1} paints</span>` : ' <span class="faint">· more in the shop on your phone</span>'}</div>
        ${bar('Top speed', t.top)}${bar('Pick-up', t.accel)}${bar('Grip', t.grip)}${bar('Weight', t.weight * 0.85)}${bar('Soak', t.ride)}
        <div class="ready ${c.ready ? 'on' : ''}">${c.ready ? 'Ready' : `${glyph('bolt')} when you're happy`}</div>
      </div></div>`;
  }).join('');
  $('tower').classList.add('hidden');
}

// One box per view, laid over its part of the screen
function buildHud() {
  $('views').innerHTML = world.views.map((v, i) => {
    const r = v.rect, at = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
    const who = v.racer ? playerOf(v.racer) ?? input.list.find((c) => c.id === v.racer!.id) : undefined;
    return `<div class="view ${v.racer ? '' : 'tv'}" id="view${i}" style="${at}">
      <div class="pos"><b></b><span></span></div>${who ? `<div class="who">${chip(who)}</div>` : ''}
      <div class="lap"></div><div class="note"></div><div class="speed"></div><div class="flash"></div></div>`;
  }).join('');
  $('tower').classList.toggle('hidden', world.views.length > 1);
}

function updateHud() {
  const order = race.standings(), leader = order[0];
  world.views.forEach((v, i) => {
    const el = document.getElementById(`view${i}`);
    if (!el) return;
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    if (!v.racer) {
      q('.pos b').textContent = 'Rally';
      q('.pos span').textContent = `lap ${Math.min(leader.laps + 1, race.laps)} of ${race.laps}`;
      return;
    }
    const r = v.racer, pos = order.indexOf(r) + 1;
    q('.pos b').textContent = ordinal(pos);
    q('.pos span').textContent = `of ${order.length}`;
    q('.lap').textContent = r.finish !== null ? 'Finished' : `Lap ${Math.min(r.laps + 1, race.laps)} / ${race.laps}`;
    q('.speed').innerHTML = `${Math.round(r.car.speed * 3.6)}<span>km/h</span>`;
    q('.note').textContent = r.finish === null && step === 'racing' ? notes.get(r) ?? '' : '';
    const f = flashes.get(r), box = q('.flash');
    const lost = r.lost > 0.6 && r.finish === null;
    box.classList.toggle('show', lost || (!!f && race.t - f.t < 3));
    box.textContent = lost ? (r.car.upright < 0.3 ? 'Upside down' : 'Off the stage') : f?.text ?? '';
  });
  if (world.views.length > 1) return;
  $('tower').innerHTML = order.map((r, i) => `<div class="row ${r.spec.ai ? '' : 'me'}" style="--pc:${r.spec.color}">
      <span class="num">${i + 1}</span><i></i><span>${escapeHtml(r.spec.name)}</span><span class="gap">${gapText(r, leader, i)}</span></div>`).join('');
}

function gapText(r: Racer, leader: Racer, i: number) {
  if (i === 0) return r.finish !== null ? fmt(r.finish) : 'Leader';
  if (r.finish !== null && leader.finish !== null) return `+${(r.finish - leader.finish).toFixed(1)}`;
  const behind = leader.dist - r.dist;
  if (behind >= race.stage.length) return `+${plural(Math.floor(behind / race.stage.length), 'lap', 'laps')}`;
  return `+${(behind / Math.max(r.car.speed, 15)).toFixed(1)}`;
}

function renderResults() {
  const order = race.standings(), win = order[0];
  $('winner').innerHTML = `<span style="color:${win.spec.ai ? 'var(--chalk)' : win.spec.color}">${escapeHtml(win.spec.name)}</span> wins`;
  $('resultsStage').textContent = `${race.stage.spec.name} · ${plural(race.laps, 'lap', 'laps')}`;
  $('standings').innerHTML = order.map((r, i) => {
    const human = playerOf(r);
    const who = human ? chip(human) : `<span class="chip" style="--pc:${r.spec.color}"><b>${r.spec.number}</b>${escapeHtml(r.spec.name)}</span>`;
    const time = i === 0 ? (r.finish !== null ? fmt(r.finish) : '') : gapText(r, win, i);
    const extra = [r.bigAir > 0.5 ? `air ${r.bigAir.toFixed(1)} s` : '', r.resets ? plural(r.resets, 'rescue', 'rescues') : ''].filter(Boolean).join(' · ');
    return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${who}
      <span class="caption">${escapeHtml(r.spec.car.name)}${extra ? ` · ${extra}` : ''}${human?.earned?.earned ? ` · +${starsLabel(human.earned.earned)}` : ''}</span>
      <span class="time">${time}</span><span class="best">${r.bestLap ? `best ${fmt(r.bestLap)}` : ''}</span></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(html: string, sub = '') {
  $('callout').innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${html}</div>`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), 1800);
}

// --- the roadside camera: in the lobby it picks a car and stays with it for a while -------------------
let tvRacer: Racer | null = null, tvT = 0;
function tvFocus(dt: number) {
  tvT -= dt;
  if (!tvRacer || tvT <= 0 || !race.racers.includes(tvRacer)) {
    tvRacer = race.racers[Math.floor(Math.random() * race.racers.length)];
    tvT = 14;
  }
  return step === 'lobby' ? tvRacer : race.standings()[0];
}

// --- the loop -----------------------------------------------------------------------------------------
function tick() {
  stepT += TICK;
  if (step === 'garage') return;
  if (step === 'grid') {
    const n = 3 - Math.floor(stepT / 0.9);
    if (n !== countShown) {
      countShown = n;
      callout(n > 0 ? String(n) : 'Go', n > 0 ? 'Hold the gas' : '');
      if (n <= 0) for (const r of people()) buzz(r, 120);
    }
    if (stepT >= 2.7) { step = 'racing'; stepT = 0; }
    race.step(false);
    return;
  }
  const ev = race.step(true);
  if (step !== 'racing') { for (const h of ev.hits) world.hit(h.racer, h.strength); for (const l of ev.landings) world.land(l.racer, l.impact); return; }
  onEvents(ev);
  for (const r of ev.lap) onLap(r);
  for (const r of ev.finished) onFinish(r);
  if (flagT >= 0) flagT += TICK;
  const done = people().every((r) => r.finish !== null);
  if (flagT >= 0 && (done ? flagT > 3 : flagT > 45)) endRace(); // (stragglers get 45 s after the winner)
}

// The engines: each person's car, panned toward their part of the screen, and the nearest rival
function sound() {
  const racing = step === 'racing' || step === 'grid';
  if (!racing) return updateEngines([]);
  const mine = people().filter((r) => r.finish === null);
  const cars = mine.map((r) => {
    const v = world.views.find((x) => x.racer === r);
    return {
      id: r.id, v: r.car.speed, throttle: r.car.throttle, air: r.car.touching === 0,
      slip: r.car.wheels.reduce((s, w) => Math.max(s, w.contact ? w.slip : 0), 0),
      pan: v && world.views.length > 1 ? (v.rect.x + v.rect.w / 2) * 2 - 1 : 0,
    };
  });
  let near = 0, nearV = 0;
  for (const r of race.racers) {
    if (!r.spec.ai) continue;
    for (const m of mine) {
      const close = 1 - r.car.p.distanceTo(m.car.p) / 60;
      if (close > near) { near = close; nearV = r.car.speed; }
    }
  }
  updateEngines(cars, near > 0 ? { near, v: nearV } : undefined);
}

const MIN_FRAME = 1000 / maxFps - 1;
let acc = 0, last = performance.now(), padT = 0, hudT = 0, noteT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (step === 'grid' || step === 'racing' ? driveInput(c) : menuInput(c));
  if (step !== 'paused') {
    acc += dt;
    while (acc >= TICK) { tick(); acc -= TICK; }
  }
  world.render(dt, tvFocus(dt));
  sound();
  noteT += dt;
  if (noteT > 0.4 && step === 'racing') { noteT = 0; for (const r of people()) notes.set(r, race.stage.note(r.s)); }
  hudT += dt;
  const racing = step === 'racing' || step === 'grid';
  if (hudT > 0.1 && (racing || step === 'paused')) { hudT = 0; updateHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
  guard.frame(now);
}

// --- helpers ------------------------------------------------------------------------------------------
function fmt(t: number) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// --- start ----------------------------------------------------------------------------------------------
addEventListener('resize', () => world.resize());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('back').innerHTML = `${glyph('drop')} Games`;
$('start').innerHTML = `${glyph('bolt')} Start`;
$('howto').innerHTML = `${glyph('star')} How to play`;
$('again').innerHTML = `${glyph('bolt')} Race again`;
$('toLobby').innerHTML = `${glyph('drop')} Lobby`;
$('pauseLegend').innerHTML = `<span>${glyph('bolt')} Resume</span><span>${glyph('drop')} Quit to the lobby</span>`;
$('legend').innerHTML = `<span>${glyph('stick')} Steer</span><span>${glyph('bolt')} Gas</span><span>${glyph('drop')} Brake</span><span>${glyph('leaf')} Handbrake</span><span>${glyph('l1')} Back on the road</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', start);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
world.resize();
engines.unlock(); // (works straight away in the TV app; elsewhere, on the first click or key)
toLobby();
requestAnimationFrame(frame);
