// Grand Prix: the game flow. Lobby (with a race going on behind it), picking paint, the grid, the
// race with its pit stops, results, saved records. The circuits and cars are data (circuits.json,
// cars.json). The racing itself is shared with Stock Cars (@racing: race.ts, track.ts, cars.ts,
// weather.ts, sound.ts);
// what a Grand Prix adds is in gp.ts (the race), damage.ts (health, tyres, fuel, fire), pits.ts
// (the pit lane) and scene.ts (the circuit with its pits, flames and smoke).
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { loadCars, type CarType } from '@racing/cars.ts';
import { TICK, TOP, type Car, type CarSpec, type Hit } from '@racing/race.ts';
import { Engines, type Driving, type Others } from '@racing/sound.ts';
import { Track, type TrackSpec } from '@racing/track.ts';
import { TYRE_NAME } from '@racing/tyres.ts';
import { FORECASTS, Forecast, Weather } from '@world/weather.ts';
import { OUT_LABEL, type PitPlan } from './damage.ts';
import { GrandPrix, type Call } from './gp.ts';
import { World } from './scene.ts';

const device = await requireDevice(); // (3D: not on the lightest screens)
const getJson = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);
const [{ circuits: CIRCUITS }, { cars: CARS }] = await Promise.all([
  getJson<{ circuits: TrackSpec[] }>('circuits.json'),
  getJson<{ cars: CarType[] }>('cars.json'),
  document.fonts.load('900 100px "Big Shoulders Display"'), // (the cars' numbers are painted in it)
]);
const models = await loadCars(CARS, device.tier === 'heavy' && !device.tv); // (clear coats where there's power to spare)
interface Paint { id: string; name: string; color: string }
const PAINTS: Paint[] = (await shopItems('grand-prix')).filter((it) => typeof it.extra.color === 'string')
  .map((it) => ({ id: it.id.slice('grand-prix/'.length), name: it.name, color: it.extra.color as string }));
const controls = await loadControls(['drive'] as const, ['throttle', 'brake', 'lookBack', 'box'] as const);
const saves = gameSaves();

interface PlayerRecord { name: string; races: number; wins: number; podiums: number; bestLap: number; paint?: string }
interface LapRecord { time: number; name: string }
const freshRecord = (name: string): PlayerRecord => ({ name, races: 0, wins: 0, podiums: 0, bestLap: 0 });
const lapRecords = new Map<string, LapRecord | null>();

interface Driver {
  record: PlayerRecord | null;
  pick: number; // the car (cars.json)
  ready: boolean;
  paints: Paint[];
  paint: number; // 0 = their own colour, then paints[paint - 1]
  lapRecord: boolean;
  earned: Earned | null;
  told: Call | null; // the last pit call their screen showed
  pitRow: PitRow; // the line of the pit menu they're on
}
const input = new Input({ state: (): Driver => ({ record: null, pick: 0, ready: false, paints: [], paint: 0, lapRecord: false, earned: null, told: null, pitRow: PitRow.Tyres }) });
type Player = Pad<Driver>;
const paintOf = (c: Player) => c.paints[c.paint - 1] ?? { id: '', name: 'Your colour', color: c.color };

// --- settings, chosen in the lobby --------------------------------------------------------------
const LAPS = [5, 10, 15];
const LEVELS = [{ name: 'Easy', skill: 0.94 }, { name: 'Medium', skill: 0.975 }, { name: 'Hard', skill: 1 }];
// (circuits race in the rain on wet tyres, but not in snow)
const SKIES = [Forecast.Dry, Forecast.Showers, Forecast.Rain];
const settings = { circuit: 0, rivals: 9, laps: 10, level: 1, weather: Forecast.Dry };
const ROWS = ['circuit', 'weather', 'rivals', 'laps', 'level'] as const;
let row = 0;

type Stage = 'lobby' | 'garage' | 'grid' | 'racing' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'racing';
let stageT = 0;
let gp: GrandPrix;
let flagT = -1;
let countShown = 0;
const drivers = new Map<string, Player>();
const flashes = new Map<Car, { text: string; until: number }>(); // a message on a driver's own screen

const tracks = new Map<string, Track>();
const circuit = () => CIRCUITS[settings.circuit];
const track = () => {
  const spec = circuit();
  if (!tracks.has(spec.id)) tracks.set(spec.id, new Track(spec));
  return tracks.get(spec.id)!;
};
// the main straight either side of the line, where the pit lane goes: the lap's last and first straights
const straight = () => ({ before: circuit().lap!.at(-1)!.straight!, after: circuit().lap![0].straight! });
const lapRecord = () => lapRecords.get(circuit().id) ?? null;

const world = new World($<HTMLCanvasElement>('world'));
const engines = new Engines();

const maxFps = device.tv ? 30 : 60;
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle: (level) => { world.lowerDetail(level); world.resize(); callout('Keeping it smooth', 'Detail turned down'); },
});
guard.watchCanvas(world.renderer.domElement);

// --- the field ------------------------------------------------------------------------------------
// The computer drivers: made-up names and teams' colours, no sponsors
const RIVALS = ['Orsi', 'Kade', 'Vale', 'Mira', 'Dune', 'Sato', 'Bram', 'Lio', 'Teo', 'Rhea', 'Nash'];
const LIVERIES = ['#e8e6df', '#ff8a3d', '#3fd0ff', '#9b6bff', '#2a2f3d', '#c0c4cc', '#0f8a63', '#d94040', '#f2d03b', '#2f5bd8', '#ff5ecf'];
const NUMBERS = [3, 5, 8, 12, 16, 21, 27, 33, 44, 63, 81];

const carOf = (type: CarType): CarSpec['car'] => ({ ...type, width: models.get(type.id)!.width });

function field(withPeople: boolean): CarSpec[] {
  const people: CarSpec[] = (withPeople ? input.list : []).map((c) => ({
    id: c.id, name: c.label, color: c.color, paint: paintOf(c).color, number: c.slot + 1, ai: false, skill: 1, car: carOf(CARS[c.pick]),
  }));
  const taken = new Set(people.map((p) => p.color.toLowerCase()));
  const liveries = LIVERIES.filter((c) => !taken.has(c));
  const skill = LEVELS[settings.level].skill;
  const n = withPeople ? Math.max(settings.rivals, people.length ? 0 : 1) : 11;
  const rivals = Array.from({ length: n }, (_, i): CarSpec => ({
    id: `cpu${i}`, name: RIVALS[i], color: liveries[i % liveries.length], number: NUMBERS[i], ai: true,
    skill: skill + (Math.random() - 0.5) * 0.012, car: carOf(CARS[i % CARS.length]),
  }));
  return shuffle([...people, ...rivals]);
}

function newRace(withPeople: boolean, laps: number) {
  // the weather, spread over about as long as the race will take (the one behind the menu runs on)
  const w = settings.weather === Forecast.Dry ? null : new Weather(settings.weather, (Math.min(laps, 20) * track().length) / (TOP * 0.7));
  gp = new GrandPrix(track(), field(withPeople), laps, straight(), withPeople, w);
  world.setTrack(track(), gp.pits);
  world.setCars(gp.all, models);
  const slot = (c: Car) => input.list.find((p) => p.id === c.id)?.slot ?? 99;
  world.setViews(gp.all.filter((c) => !c.spec.ai).sort((a, b) => slot(a) - slot(b)));
  flashes.clear();
  buildHud();
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  stageT = 0;
  newRace(false, 999); // the race behind the menu (no one retires from it)
  engines.silence();
  show('lobby');
  renderLobby();
  loadLapRecord();
}

function start() {
  if (!input.list.length) return startRace();
  stage = 'garage';
  for (const c of input.list) { c.ready = false; loadPaints(c); }
  showroom();
  show('hud');
}

function startRace() {
  drivers.clear();
  for (const c of input.list) {
    drivers.set(c.id, c);
    c.lapRecord = false;
    c.earned = null;
    c.told = null;
  }
  newRace(true, settings.laps);
  stage = 'grid';
  stageT = 0;
  flagT = -1;
  countShown = 0;
  for (const c of input.list) c.drain();
  show('hud');
}

function endRace() {
  stage = 'results';
  saveRecords();
  payOut();
  renderResults();
  show('results');
  engines.silence();
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'grid' || stage === 'racing') { resumeTo = stage; stage = 'paused'; show('pause'); engines.silence(); }
}

const people = () => gp.all.filter((c) => !c.spec.ai);
const playerOf = (car: Car) => drivers.get(car.id);
const buzz = (car: Car, ms: number) => input.buzz(input.list.find((c) => c.id === car.id), ms);
const flash = (car: Car, text: string, secs = 3) => flashes.set(car, { text, until: gp.t + secs });

function onLap(car: Car) {
  if (car.laps === gp.laps - 1 && gp.laps > 1 && gp.standings()[0] === car) callout('Final lap', 'White flag');
  if (car.spec.ai) return;
  flash(car, `Lap ${fmt(car.lastLap)}${car.lastLap === car.bestLap ? ' · best' : ''}`, 4);
  const record = lapRecord();
  if (!record || car.lastLap < record.time) {
    const next = { time: car.lastLap, name: car.spec.name };
    lapRecords.set(circuit().id, next);
    saves.set(`lap-record-${circuit().id}`, next);
    callout(fmt(car.lastLap), `New lap record · ${car.spec.name}`);
    const who = playerOf(car);
    if (who) who.lapRecord = true;
    buzz(car, 150);
  }
}

function onFinish(car: Car) {
  if (flagT >= 0) return;
  flagT = 0;
  callout(`<span style="color:${car.spec.ai ? 'var(--chalk)' : car.spec.color}">${escapeHtml(car.spec.name)}</span> wins`, 'Chequered flag');
  buzz(car, 300);
}

function onHit(h: Hit, wall: boolean) {
  world.hit(h.car, h.d, h.strength);
  if (h.car.spec.ai) return;
  buzz(h.car, Math.min(400, 40 + h.strength * 25));
  if (wall) engines.crunch(Math.min(1, h.strength / 8));
  else engines.thump(Math.min(1, h.strength / 8));
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  if (stage === 'lobby') renderLobby();
  loadPaints(c);
}

async function loadPaints(c: Player) {
  const owned = await ownedItems(c);
  const was = paintOf(c).id || c.record?.paint;
  c.paints = PAINTS.filter((p) => owned.includes(p.id));
  c.paint = c.paints.findIndex((p) => p.id === was) + 1;
  if (stage === 'garage') showroom();
}

// Stars for everyone who started: for finishing, a win or a podium (against someone), a lap record
function payOut() {
  const order = gp.standings(), against = gp.all.length > 1;
  for (const c of drivers.values()) {
    const car = gp.all.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1, finished = car.finish !== null, why: EarnFor[] = ['played'];
    if (against && finished && pos === 1) why.push('won');
    else if (against && finished && pos <= 3) why.push('podium');
    if (c.lapRecord) why.push('record');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

async function loadLapRecord() {
  const id = circuit().id;
  if (lapRecords.has(id)) return;
  lapRecords.set(id, await saves.get<LapRecord>(`lap-record-${id}`));
  if (stage === 'lobby') renderLobby();
}

function saveRecords() {
  const order = gp.standings();
  for (const c of drivers.values()) {
    const car = gp.all.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1, finished = car.finish !== null;
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.races++;
    if (finished && pos === 1) r.wins++;
    if (finished && pos <= 3) r.podiums++;
    if (car.bestLap && (!r.bestLap || car.bestLap < r.bestLap)) r.bestLap = car.bestLap;
    r.paint = paintOf(c).id || undefined;
    c.record = r;
    saves.set(playerKey(c), r);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.races ? 'First race' :
  `${plural(r.wins, 'win', 'wins')} from ${plural(r.races, 'race', 'races')}`;

input.onJoin = (c) => {
  loadRecord(c);
  if (stage === 'lobby') renderLobby();
  if (stage === 'garage') showroom();
};
input.onLeave = (c) => {
  // their car finishes the race on its own
  const car = gp.all.find((x) => x.id === c.id);
  if (car && stage !== 'lobby') { car.spec.ai = true; car.lane = 0; }
  if (stage === 'lobby') renderLobby();
  if (stage === 'garage') (input.list.length ? showroom() : toLobby());
};
input.onRename = () => stage === 'lobby' && renderLobby();
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Grand Prix');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  if (stage === 'garage' && fx && !c.ready && CARS.length > 1) {
    c.pick = (c.pick + fx + CARS.length) % CARS.length;
    showroom();
  }
  if (stage === 'garage' && (fy || (fx && CARS.length === 1)) && !c.ready && c.paints.length) {
    c.paint = (c.paint - (fy || -fx) + c.paints.length + 1) % (c.paints.length + 1);
    showroom();
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.bolt) (stage === 'garage' ? toggleReady(c) : confirm());
    else if (ev.bit === BIT.drop) (stage === 'garage' && c.ready ? toggleReady(c) : back());
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
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
  if (key === 'circuit') {
    settings.circuit = (settings.circuit + d + CIRCUITS.length) % CIRCUITS.length;
    return toLobby();
  }
  if (key === 'weather') {
    settings.weather = cycle(SKIES, settings.weather);
    return toLobby(); // (the race behind the menu gets it too)
  }
  if (key === 'rivals') settings.rivals = Math.max(0, Math.min(11, settings.rivals + d));
  else if (key === 'laps') settings.laps = cycle(LAPS, settings.laps);
  else settings.level = (settings.level + d + LEVELS.length) % LEVELS.length;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') start();
  else if (stage === 'garage') startRace();
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused' || stage === 'garage') toLobby();
}

// Steer with the slider (or the arrow keys); gas and brake are held; the box button calls you in
// --- the pit stop: on the way down the pit lane, choose what the crew does --------------------------
enum PitRow { Tyres, Fuel, Repair }
const PIT_ROWS = [PitRow.Tyres, PitRow.Fuel, PitRow.Repair];
const PIT_ROW_NAME: Record<PitRow, string> = { [PitRow.Tyres]: 'Tyres', [PitRow.Fuel]: 'Fuel', [PitRow.Repair]: 'Repairs' };

function pitValue(car: Car, plan: PitPlan, row: PitRow) {
  const k = gp.cond.get(car)!;
  switch (row) {
    case PitRow.Tyres: return plan.tyres ? `New ${TYRE_NAME[plan.tyres].toLowerCase()}` : `Keep (${Math.round((1 - k.tyres) * 100)}% left)`;
    case PitRow.Fuel: {
      const finish = Math.abs(plan.fuel - gp.fuelToFinish(car)) < 0.05;
      return plan.fuel ? `+${plan.fuel.toFixed(1)} laps${finish ? ' (to the flag)' : ''}` : 'None';
    }
    case PitRow.Repair: return k.health >= 100 ? 'Nothing to mend' : plan.repair ? `Mend (${Math.round(k.health)}% now)` : 'Leave it';
  }
}

function pitInput(c: Player, car: Car, plan: PitPlan) {
  c.drain();
  const fy = c.flickY(), fx = c.flickX();
  if (fy) c.pitRow = PIT_ROWS[(PIT_ROWS.indexOf(c.pitRow) - fy + PIT_ROWS.length) % PIT_ROWS.length]; // (▲ = the one above)
  if (!fx) return;
  const cycle = <T>(list: T[], v: T) => list[(Math.max(0, list.indexOf(v)) + fx + list.length) % list.length];
  if (c.pitRow === PitRow.Tyres) plan.tyres = cycle(gp.tyreChoices(), plan.tyres);
  else if (c.pitRow === PitRow.Fuel) {
    const list = gp.fuelChoices(car);
    plan.fuel = list[(nearest(list, plan.fuel) + fx + list.length) % list.length];
  } else if (gp.cond.get(car)!.health < 100) plan.repair = !plan.repair;
}

const nearest = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);

function driveInput(c: Player) {
  const car = gp.all.find((x) => x.id === c.id);
  const plan = car && !car.spec.ai ? gp.openPlan(car) : null;
  if (car && plan) return pitInput(c, car, plan); // (the limiter drives down the pit lane)
  for (const ev of c.drain()) {
    if (!ev.down || !car || controls.action('drive', ev.bit) !== 'box') continue;
    toggleBox(car);
  }
  if (!car || car.spec.ai || car.finish !== null || gp.isOut(car)) return;
  car.throttle = controls.held(c, 'drive', 'throttle') || c.y > 0.5 ? 1 : 0;
  car.brake = controls.held(c, 'drive', 'brake') || c.y < -0.5 ? 1 : 0;
  const x = Math.abs(c.x) < 0.05 ? 0 : c.x;
  car.steer = Math.sign(x) * Math.abs(x) ** 1.3;
  const view = world.views.find((v) => v.car === car);
  if (view) view.lookBack = controls.held(c, 'drive', 'lookBack');
}

function toggleBox(car: Car) {
  if (stage !== 'racing' || gp.inPits(car) || gp.isOut(car) || car.finish !== null) return;
  if (gp.boxCall.has(car)) { gp.boxCall.delete(car); flash(car, 'Staying out'); }
  else { gp.boxCall.add(car); flash(car, 'Box this lap: keep left for the pit lane'); }
}

addEventListener('keydown', (e) => {
  engines.unlock();
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' || stage === 'garage' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => engines.unlock());

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Grand Prix', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'garage': return c.ready
      ? { ...base, labels: { drop: 'Change' }, hint: 'Ready. Waiting for the others' }
      : { ...base, labels: { bolt: 'Ready', drop: 'Back' }, hint: c.paints.length ? `◀▶ paint: ${paintOf(c).name}` : 'More paint in the shop on your phone' };
    case 'results': return { ...base, labels: { bolt: 'Race again', drop: 'Lobby' }, hint: 'Race over' };
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const car = gp.all.find((x) => x.id === c.id);
      if (!car) return { ...base, labels: {}, hint: 'You race next time' };
      const pos = ordinal(gp.standings().indexOf(car) + 1), k = gp.cond.get(car)!;
      if (k.out) return { ...base, labels: {}, hint: `${OUT_LABEL[k.out]}. Watch the rest` };
      if (car.finish !== null) return { ...base, labels: {}, hint: `You finished ${pos}` };
      const plan = gp.openPlan(car);
      if (plan) {
        return { ...base, layout: 'dpad', labels: {},
          hint: `Pit stop · ▲▼ ${PIT_ROW_NAME[c.pitRow]}: ${pitValue(car, plan, c.pitRow)} ◀▶ · ${k.time(plan).toFixed(1)} s stopped` };
      }
      const wait = gp.pits.waiting(car);
      const status = k.burning ? 'ON FIRE: box now' : wait !== null ? `In the box: ${wait.toFixed(1)} s`
        : gp.inPits(car) ? 'Pit lane' : gp.boxCall.has(car) ? 'Boxing this lap: keep left' : gp.call(car) ? `Box this lap: ${gp.call(car)}` : '';
      return {
        ...base, layout: 'racing', labels: controls.labels('drive'),
        hint: `${pos} · lap ${Math.min(car.laps + 1, gp.laps)}/${gp.laps} · car ${Math.round(k.health)}% · ${gp.weather ? `${gp.weather.conditions}, ${TYRE_NAME[k.tyre].toLowerCase()}` : 'tyres'} ${Math.round((1 - k.tyres) * 100)}% · fuel ${k.fuel.toFixed(1)} laps${status ? ` · ${status}` : ''}`,
      };
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
  const value = { circuit: circuit().name, weather: FORECASTS[settings.weather].name, rivals: String(settings.rivals), laps: `${settings.laps} laps`, level: LEVELS[settings.level].name };
  const label = { circuit: 'Circuit', weather: 'Weather', rivals: 'Computer drivers', laps: 'Race', level: 'Their pace' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  const rec = lapRecord(), stops = Math.max(0, Math.ceil(settings.laps / 7) - 1);
  $('trackAbout').textContent = `${circuit().about} ${FORECASTS[settings.weather].about}${settings.weather === Forecast.Showers ? ' Box for wets when it comes, and for slicks when it dries.' : ''}`;
  $('record').textContent = `${rec ? `Lap record: ${fmt(rec.time)} by ${rec.name}.` : 'No lap record here yet. Set one.'} ${settings.laps} laps: ${stops ? `at least ${plural(stops, 'stop', 'stops')} for fuel` : 'no stop needed for fuel'}.`;
}

function showroom() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  world.setTrack(track(), gp.pits);
  world.showroom(list.map((c) => ({ model: models.get(CARS[c.pick].id)!, color: paintOf(c).color, number: c.slot + 1 })));
  renderGarage();
}

function renderGarage() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  $('views').innerHTML = world.views.map((v, i) => {
    const c = list[i], t = CARS[c.pick], r = v.rect;
    return `<div class="view pick" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="card panel">${chip(c)}
        <div class="carname">${CARS.length > 1 ? '<span class="glyph glyph-key">◀</span>' : ''}<h2>${escapeHtml(t.name)}</h2>${CARS.length > 1 ? '<span class="glyph glyph-key">▶</span>' : ''}</div>
        <p class="muted">${escapeHtml(t.about)}</p>
        <div class="paint"><i style="background:${paintOf(c).color}"></i>${escapeHtml(paintOf(c).name)}${c.paints.length
          ? ` <span class="faint">· ${CARS.length > 1 ? '▲▼' : '◀▶'} ${c.paints.length + 1} paints</span>` : ' <span class="faint">· more in the shop on your phone</span>'}</div>
        <div class="ready ${c.ready ? 'on' : ''}">${c.ready ? 'Ready' : `${glyph('bolt')} when you're happy`}</div>
      </div></div>`;
  }).join('');
  $('tower').classList.add('hidden');
}

// One box per view, laid over its part of the screen: position, lap, speed, and the car's condition
function buildHud() {
  $('views').innerHTML = world.views.map((v, i) => {
    const r = v.rect, at = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
    const who = v.car ? playerOf(v.car) ?? input.list.find((c) => c.id === v.car!.id) : undefined;
    return `<div class="view ${v.car ? '' : 'tv'}" id="view${i}" style="${at}">
      <div class="pos"><b></b><span></span></div>${who ? `<div class="who">${chip(who)}</div>` : ''}
      <div class="lap"></div><div class="sky"></div><div class="speed"></div>
      ${v.car ? `<div class="state panel"><div class="meter health"><span>Car</span><i><b></b></i></div>
        <div class="meter tyres"><span>Tyres</span><i><b></b></i></div><div class="meter fuel"><span>Fuel</span><i><b></b></i><em></em></div>
        <div class="box"></div></div><div class="pitplan panel"></div>` : ''}
      <div class="flash"></div></div>`;
  }).join('');
  $('tower').classList.toggle('hidden', world.views.length > 1);
}

const tone = (v: number) => (v > 0.6 ? 'var(--chalk)' : v > 0.3 ? '#ffc23d' : '#ff4d4d');

// The pit menu, over the driver's view while they're in the pit lane: what the crew will do (they
// change it on their phone, or with the arrows), and then the crew at work
function renderPitPlan(el: HTMLElement, car: Car) {
  const plan = gp.plans.get(car), open = gp.openPlan(car), wait = gp.pits.waiting(car), who = playerOf(car);
  const show = !!plan && (!!open || wait !== null);
  el.classList.toggle('show', show);
  if (!show || !plan) return;
  const k = gp.cond.get(car)!, row = who?.pitRow;
  el.innerHTML = `<span class="eyebrow">${open ? 'Pit stop · ▲▼ choose · ◀▶ change' : 'The crew is on it'}</span>
    ${PIT_ROWS.map((r) => `<div class="pitrow ${open && r === row ? 'sel' : ''}"><span>${PIT_ROW_NAME[r]}</span><b>${escapeHtml(pitValue(car, plan, r))}</b></div>`).join('')}
    ${k.burning ? '<div class="pitrow alert"><span>Fire</span><b>Putting it out</b></div>' : ''}
    <div class="pittime">${open ? `${k.time(plan).toFixed(1)} s in the box · ${Math.round(gp.pits.toBox(car))} m to go` : `${(wait ?? 0).toFixed(1)} s`}</div>`;
}

function updateHud() {
  const order = gp.standings(), leader = order[0];
  world.views.forEach((v, i) => {
    const el = document.getElementById(`view${i}`);
    if (!el) return;
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    if (!v.car) {
      q('.pos b').textContent = 'Race';
      q('.pos span').textContent = `lap ${Math.min(leader.laps + 1, gp.laps)} of ${gp.laps}`;
      return;
    }
    const car = v.car, pos = order.indexOf(car) + 1, k = gp.cond.get(car)!;
    q('.pos b').textContent = k.out ? 'Out' : ordinal(pos);
    q('.pos span').textContent = k.out ? OUT_LABEL[k.out] : `of ${order.length}`;
    q('.lap').textContent = car.finish !== null ? 'Finished' : `Lap ${Math.min(car.laps + 1, gp.laps)} / ${gp.laps}`;
    q('.speed').innerHTML = `${Math.round(car.v * 3.6)}<span>km/h</span>`;
    const meter = (cls: string, v: number) => { const b = q(`.${cls} b`); b.style.width = `${Math.round(v * 100)}%`; b.style.background = tone(v); };
    meter('health', k.health / 100);
    meter('tyres', 1 - k.tyres);
    q('.tyres span').textContent = gp.weather ? TYRE_NAME[k.tyre] : 'Tyres';
    q('.sky').textContent = gp.weather?.conditions ?? '';
    meter('fuel', k.fuel / 7);
    q('.fuel em').textContent = `${k.fuel.toFixed(1)} laps`;
    const wait = gp.pits.waiting(car), call = gp.call(car);
    const entry = gp.toPitEntry(car);
    q('.box').textContent = k.out ? '' : k.burning ? 'On fire: box now' : wait !== null ? `Box · ${wait.toFixed(1)} s` : gp.inPits(car) ? 'Pit lane'
      : gp.boxCall.has(car) ? (entry > 0 && entry < 600 ? `Pit entry ${Math.round(entry)} m: keep left` : 'Boxing this lap') : call ? `Box this lap? ${call}` : '';
    renderPitPlan(q('.pitplan'), car);
    q('.box').classList.toggle('alert', k.burning || (!!call && !gp.boxCall.has(car)));
    // the pit wall's call, once, when it changes
    const who = playerOf(car);
    if (who && call !== who.told) { who.told = call; if (call && !gp.boxCall.has(car)) { flash(car, `Box this lap: ${call}`); buzz(car, 200); } }
    const f = flashes.get(car), fl = q('.flash');
    if (car.spinning > 0 && !k.out) { fl.textContent = 'Spun round!'; fl.classList.add('show'); return; }
    fl.classList.toggle('show', !!f && gp.t < f.until);
    if (f) fl.textContent = f.text;
  });
  if (world.views.length > 1) return;
  $('tower').innerHTML = order.map((c, i) => {
    const k = gp.cond.get(c)!, h = k.health / 100;
    const gap = k.out ? 'Out' : gp.inPits(c) ? 'Pit' : gapText(c, leader, i);
    return `<div class="row ${c.spec.ai ? '' : 'me'} ${k.out ? 'out' : ''}" style="--pc:${c.spec.color}">
      <span class="num">${i + 1}</span><i></i><span>${escapeHtml(c.spec.name)}${k.burning ? ' 🔥' : ''}</span>
      <span class="hp"><b style="width:${Math.round(h * 100)}%;background:${tone(h)}"></b></span><span class="gap">${gap}</span></div>`;
  }).join('');
}

function gapText(c: Car, leader: Car, i: number) {
  if (i === 0) return c.finish !== null ? fmt(c.finish) : 'Leader';
  if (c.finish !== null && leader.finish !== null) return `+${(c.finish - leader.finish).toFixed(1)}`;
  const behind = leader.dist - c.dist;
  if (behind >= gp.track.length) return `+${plural(Math.floor(behind / gp.track.length), 'lap', 'laps')}`;
  return `+${(behind / Math.max(c.v, 20)).toFixed(1)}`;
}

function renderResults() {
  const order = gp.standings(), win = order[0];
  $('winner').innerHTML = `<span style="color:${win.spec.ai ? 'var(--chalk)' : win.spec.color}">${escapeHtml(win.spec.name)}</span> wins`;
  $('resultsTrack').textContent = `${gp.track.name} · ${plural(gp.laps, 'lap', 'laps')}${gp.weather ? ` · ${FORECASTS[gp.weather.forecast].name}` : ''}`;
  $('standings').innerHTML = order.map((c, i) => {
    const human = playerOf(c), k = gp.cond.get(c)!;
    const who = human ? chip(human) : `<span class="chip" style="--pc:${c.spec.color}"><b>${c.spec.number}</b>${escapeHtml(c.spec.name)}</span>`;
    const time = k.out ? 'DNF' : i === 0 ? (c.finish !== null ? fmt(c.finish) : '') : gapText(c, win, i);
    const about = [k.out ? OUT_LABEL[k.out] : '', plural(gp.stopped.get(c)!, 'stop', 'stops'), human ? recordLine(human.record) : '',
      human?.earned?.earned ? `+${starsLabel(human.earned.earned)}` : ''].filter(Boolean).join(' · ');
    return `<div class="standing ${i === 0 ? 'first' : ''} ${k.out ? 'out' : ''}"><span class="num">${k.out ? '–' : i + 1}</span>${who}
      <span class="caption">${about}</span>
      <span class="time">${time}</span><span class="best">${c.bestLap ? `best ${fmt(c.bestLap)}` : ''}</span></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(html: string, sub = '') {
  $('callout').innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${html}</div>`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), 1800);
}

// --- the TV camera: in the lobby it picks out a battle and stays on it for a while ---------------------
let tvCar: Car | null = null, tvT = 0;
function tvFocus(dt: number) {
  tvT -= dt;
  const running = gp.race.cars;
  if (!tvCar || tvT <= 0 || !running.includes(tvCar)) {
    const order = gp.standings().filter((c) => running.includes(c));
    const battles = order.filter((c, i) => i > 0 && Math.abs(gp.track.gap(order[i - 1].dist, c.dist)) < 12);
    tvCar = battles.length ? battles[Math.floor(Math.random() * battles.length)] : order[0] ?? gp.all[0];
    tvT = 9;
  }
  return stage === 'lobby' ? tvCar : gp.standings()[0];
}

// --- the loop -----------------------------------------------------------------------------------------
function tick() {
  stageT += TICK;
  if (stage === 'garage') return;
  if (stage === 'grid') {
    const n = 3 - Math.floor(stageT / 0.9);
    if (n !== countShown) {
      countShown = n;
      callout(n > 0 ? String(n) : 'Go', n > 0 ? 'Hold the gas' : '');
      if (n <= 0) for (const c of people()) buzz(c, 120);
    }
    if (stageT >= 2.7) { stage = 'racing'; stageT = 0; }
    gp.step(false);
    return;
  }
  const ev = gp.step(true);
  for (const h of ev.wall) if (stage !== 'racing' || h.car.spec.ai) world.hit(h.car, h.d, h.strength);
  for (const h of ev.contact) if (stage !== 'racing' || h.car.spec.ai) world.hit(h.car, h.d, h.strength);
  if (stage !== 'racing') return;
  for (const h of ev.wall) if (!h.car.spec.ai) onHit(h, true);
  for (const h of ev.contact) if (!h.car.spec.ai) onHit(h, false);
  for (const c of ev.spun) if (!c.spec.ai) buzz(c, 500);
  for (const { car, damage } of ev.hurt) if (!car.spec.ai && damage >= 8) flash(car, `Damage: car ${Math.round(gp.cond.get(car)!.health)}%`);
  for (const c of ev.fire) {
    callout(`<span style="color:${c.spec.ai ? 'var(--chalk)' : c.spec.color}">${escapeHtml(c.spec.name)}</span> is on fire`, 'Fire');
    if (!c.spec.ai) { flash(c, 'Fire! Box now', 5); buzz(c, 600); }
  }
  for (const c of ev.out) {
    const k = gp.cond.get(c)!;
    callout(`<span style="color:${c.spec.ai ? 'var(--chalk)' : c.spec.color}">${escapeHtml(c.spec.name)}</span> is out`, OUT_LABEL[k.out!]);
    if (!c.spec.ai) buzz(c, 800);
  }
  for (const c of ev.pitDone) if (!c.spec.ai) { flash(c, 'Go go go'); buzz(c, 150); }
  for (const c of ev.lap) onLap(c);
  for (const c of ev.finished) onFinish(c);
  if (flagT >= 0) flagT += TICK;
  const done = people().every((c) => c.finish !== null || gp.isOut(c));
  if (flagT >= 0 && (done ? flagT > 3 : flagT > 30)) endRace();
  if (flagT < 0 && gp.all.every((c) => gp.isOut(c))) endRace(); // (nobody left running)
}

const MIN_FRAME = 1000 / maxFps - 1;
let acc = 0, last = performance.now(), padT = 0, hudT = 0;
const look = { burning: (c: Car) => gp.cond.get(c)!.burning, out: (c: Car) => gp.isOut(c), inPits: (c: Car) => gp.inPits(c) };

function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'grid' || stage === 'racing' ? driveInput(c) : menuInput(c));
  if (stage !== 'paused') {
    acc += dt;
    while (acc >= TICK) { tick(); acc -= TICK; }
  }
  world.render(dt, tvFocus(dt), look, gp.weather);
  const racing = stage === 'racing' || stage === 'grid';
  if (racing) {
    engines.update(people().filter((c) => c.finish === null && !gp.isOut(c)).map(driving), pack());
    engines.weather(gp.weather?.rain ?? 0, gp.weather?.wet ?? 0);
  } else engines.update([]);
  hudT += dt;
  if (hudT > 0.1 && (racing || stage === 'paused')) { hudT = 0; updateHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
  guard.frame(now);
}

function driving(c: Car): Driving {
  const r = world.views.find((v) => v.car === c)?.rect;
  return { id: c.id, v: c.v, throttle: gp.inPits(c) ? 0.3 : c.throttle, slip: Math.abs(c.slide) + Math.abs(c.knock), scrape: c.scraping !== 0, pan: r ? (r.x + r.w / 2) * 2 - 1 : 0 };
}

function pack(): Others | undefined {
  let best: Others | undefined;
  for (const p of people()) for (const c of gp.race.cars) {
    if (!c.spec.ai) continue;
    const near = 1 - Math.hypot(gp.track.gap(c.dist, p.dist), c.d - p.d) / 50;
    if (near > (best?.near ?? 0)) best = { near, v: c.v };
  }
  return best;
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
$('legend').innerHTML = `<span>${glyph('stick')} Steer</span><span>${glyph('bolt')} Gas</span><span>${glyph('drop')} Brake</span><span>${glyph('l1')} Box</span><span>${glyph('r1')} Look back</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', start);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
world.resize();
engines.unlock();
toLobby();
requestAnimationFrame(frame);
