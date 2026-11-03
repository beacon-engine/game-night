// Street Racing: the game flow. Lobby (with a race going on behind it), picking cars, the grid, the race
// across the city (any way you like: city.ts is the city, drive.ts the driving, the traffic, the lights and
// the police), results, saved records; the boost you fill by shaving past traffic, the computer drivers that
// don't let you get away, and on the screen the city's map with the quickest way from where you are, the
// next turn, how far to go, and everyone's name over their car. The races and cars are data (cities.json,
// cars.json); the 3D city is scene.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { loadCars, type CarType } from '@racing/cars.ts';
import { Engines, type Driving, type Others } from '@racing/sound.ts';
import { Tyre, TYRE_NAME } from '@racing/tyres.ts';
import { FORECASTS, Forecast, Weather } from '@world/weather.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { City, type CitySpec } from './city.ts';
import { Drive, TICK, TOP, type Car, type CarSpec, type Events } from './drive.ts';
import { loadPeople, World } from './scene.ts';

const device = await requireDevice(); // (3D: not on the lightest screens)
const getJson = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);
const [{ cities: CITIES }, { cars: CARS, traffic: TRAFFIC }] = await Promise.all([
  getJson<{ cities: CitySpec[] }>('cities.json'),
  getJson<{ cars: CarType[]; traffic: CarType[] }>('cars.json'),
  document.fonts.load('900 100px "Big Shoulders Display"'), // (the signs are painted in it)
]);
// The police car: quicker than anything you can buy, and heavy
const POLICE: CarType = { id: 'police', name: 'Police', model: 'vehicles/police', about: '', length: 5.2, top: 1.25, accel: 1.4, grip: 1.15, weight: 1.6 };
const draco = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/people/draco/'));
const [models, plane, helicopter] = await Promise.all([
  loadCars([...CARS, ...TRAFFIC, POLICE], device.tier === 'heavy' && !device.tv), // (clear coats where there's power to spare)
  draco.loadAsync('/cars/vehicles/airliner.glb').then((g) => g.scene, () => null),
  draco.loadAsync('/cars/vehicles/helicopter.glb').then((g) => g.scene, () => null),
  loadPeople(),
]);
// Paint jobs bought with stars (shop.json); everyone also has their own player colour
interface Paint { id: string; name: string; color: string }
const PAINTS: Paint[] = (await shopItems('street-racing')).filter((it) => typeof it.extra.color === 'string')
  .map((it) => ({ id: it.id.slice('street-racing/'.length), name: it.name, color: it.extra.color as string }));
const controls = await loadControls(['drive'] as const, ['throttle', 'brake', 'boost', 'lookBack'] as const);
const saves = gameSaves();

// What we remember about each driver, and the fastest time across each city
interface PlayerRecord { name: string; races: number; wins: number; podiums: number; bestLap: number; car?: string; paint?: string }
interface BestTime { time: number; name: string; car?: string }
const freshRecord = (name: string): PlayerRecord => ({ name, races: 0, wins: 0, podiums: 0, bestLap: 0 });
const bestTimes = new Map<string, BestTime | null>();

interface Driver {
  record: PlayerRecord | null;
  pick: number; // the car (cars.json)
  ready: boolean;
  paints: Paint[]; // the paint jobs they own
  paint: number; // 0 = their own colour, then paints[paint - 1]
  tyre: Tyre; // slicks or wets, for the whole race
  best: boolean; // set the city's best time this race
  earned: Earned | null; // stars from the last race
}
const input = new Input({ state: (): Driver => ({ record: null, pick: 0, ready: false, paints: [], paint: 0, tyre: Tyre.Slick, best: false, earned: null }) });
type Player = Pad<Driver>;
const paintOf = (c: Player) => c.paints[c.paint - 1] ?? { id: '', name: 'Your colour', color: c.color };

// --- settings, chosen in the lobby --------------------------------------------------------------
const LEVELS = [{ name: 'Easy', skill: 0.92 }, { name: 'Medium', skill: 0.96 }, { name: 'Hard', skill: 1 }];
const SKIES = [Forecast.Dry, Forecast.Showers, Forecast.Rain];
const TRAFFIC_LEVELS = [{ name: 'None', cars: 0 }, { name: 'Light', cars: 22 }, { name: 'Busy', cars: 44 }];
const settings = { city: 0, rivals: 5, traffic: 2, level: 1, weather: Forecast.Dry };
const ROWS = ['city', 'weather', 'rivals', 'traffic', 'level'] as const;
let row = 0; // the lobby row being changed

type Stage = 'lobby' | 'garage' | 'grid' | 'racing' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'racing';
let stageT = 0;
let drive: Drive;
let weather: Weather | null = null;
let flagT = -1; // seconds since the winner got there (-1: not yet)
let countShown = 0;
const drivers = new Map<string, Player>(); // the people in this race, even if their phone has gone since
const meters = new Map<Car, number>(); // each racer's boost, 0..1
const flashes = new Map<Car, { text: string; until: number }>(); // a message on a driver's own screen
const BOOST = 0.3; // extra top speed and pick-up while boosting
const BOOST_FOR = 3; // seconds a full meter lasts
// Keeping it a race: a computer driver behind the people gets a lift, one far ahead eases off
const CATCH_UP = 0.0016; // extra top speed per metre behind the leading person...
const CATCH_UP_MAX = 0.16; // ...up to this
const EASE_OFF = -0.06; // and this much less when it's more than 150 m ahead of everyone

const cities = new Map<string, City>();
const citySpec = () => CITIES[settings.city];
const city = () => {
  const spec = citySpec();
  if (!cities.has(spec.id)) cities.set(spec.id, new City(spec));
  return cities.get(spec.id)!;
};
const bestTime = () => bestTimes.get(citySpec().id) ?? null;

const world = new World($<HTMLCanvasElement>('world'));
world.setModels(models);
world.setAircraft(plane, helicopter);
const engines = new Engines();

const maxFps = device.tv ? 30 : 60;
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle: (level) => { world.lowerDetail(level); world.resize(); callout('Keeping it smooth', 'Detail turned down'); },
});
guard.watchCanvas(world.renderer.domElement);

// --- the field ------------------------------------------------------------------------------------
// The computer drivers: made-up names, plain colours, no sponsors
const RIVALS = ['Rook', 'Dash', 'Mako', 'Vega', 'Blaze', 'Juno', 'Rex', 'Nova', 'Kit', 'Ace', 'Lynx', 'Moss'];
const LIVERIES = ['#e8e6df', '#ff8a3d', '#3fd0ff', '#9b6bff', '#2a2f3d', '#c0c4cc', '#0f8a63', '#d94040', '#f2d03b', '#2f5bd8', '#ff5ecf', '#8a5a34'];
const TRAFFIC_PAINT = ['#c9ccd2', '#eef0f2', '#1c1f26', '#2c3e66', '#6e1f2a', '#b9ab8e', '#4a5058', '#7c8a6e'];

const statsOf = (type: CarType) => ({ top: type.top, accel: type.accel, grip: type.grip, weight: type.weight, length: type.length, width: models.get(type.id)!.width });
const personTyre = (c: Player): Tyre => (settings.weather === Forecast.Showers ? c.tyre : settings.weather === Forecast.Rain ? Tyre.Wet : Tyre.Slick);

function field(withPeople: boolean): CarSpec[] {
  const people: CarSpec[] = (withPeople ? input.list : []).map((c) => ({
    id: c.id, name: c.label, color: c.color, paint: paintOf(c).color, model: CARS[c.pick].id, kind: 'racer', ai: false, skill: 1, stats: statsOf(CARS[c.pick]),
  }));
  const taken = new Set(people.map((p) => p.color.toLowerCase()));
  const liveries = LIVERIES.filter((c) => !taken.has(c));
  const skill = LEVELS[settings.level].skill;
  const n = withPeople ? Math.max(settings.rivals, people.length ? 0 : 1) : 7;
  const rivals = Array.from({ length: n }, (_, i): CarSpec => {
    const type = CARS[Math.floor(Math.random() * CARS.length)];
    return { id: `cpu${i}`, name: RIVALS[i], color: liveries[i % liveries.length], model: type.id, kind: 'racer', ai: true, skill: skill + (Math.random() - 0.5) * 0.02, stats: statsOf(type) };
  });
  return shuffle([...people, ...rivals]); // (a random grid)
}

const trafficSpecs = (): CarSpec[] => TRAFFIC.map((type, i) => ({
  id: type.id, name: type.name, color: TRAFFIC_PAINT[i % TRAFFIC_PAINT.length], paint: TRAFFIC_PAINT[(i * 3) % TRAFFIC_PAINT.length], model: type.id, kind: 'traffic', ai: true, skill: 1, stats: statsOf(type),
}));
const policeSpec: CarSpec = { id: 'police', name: 'Police', color: '#2a6dff', model: 'police', kind: 'police', ai: true, skill: 1, stats: statsOf(POLICE) };

function newRace(withPeople: boolean) {
  const c = city();
  world.setCity(c, citySpec());
  world.clearCars();
  drive = new Drive(c, field(withPeople), trafficSpecs(), policeSpec);
  drive.trafficWanted = TRAFFIC_LEVELS[settings.traffic].cars;
  for (let i = 0; i < 60 * 8; i++) drive.step(false); // (the traffic gets going before the start)
  weather = settings.weather === Forecast.Dry ? null : new Weather(settings.weather, 200);
  meters.clear();
  flashes.clear();
  const slot = (car: Car) => input.list.find((p) => p.id === car.id)?.slot ?? 99;
  world.setViews(drive.racers.filter((car) => !car.spec.ai).sort((a, b) => slot(a) - slot(b))); // (P1 top left)
  buildHud();
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  stageT = 0;
  newRace(false); // the race behind the menu
  engines.silence();
  siren.set(0);
  show('lobby');
  renderLobby();
  loadBestTime();
}

// Start: everyone picks a car first (on their own, the computer drivers just race)
function start() {
  if (!input.list.length) return startRace();
  stage = 'garage';
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
    c.best = false;
    c.earned = null;
  }
  newRace(true);
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
  siren.set(0);
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'grid' || stage === 'racing') { resumeTo = stage; stage = 'paused'; show('pause'); engines.silence(); siren.set(0); }
}

const people = () => drive.racers.filter((c) => !c.spec.ai);
const playerOf = (car: Car) => drivers.get(car.id);
const buzz = (car: Car, ms: number) => input.buzz(input.list.find((c) => c.id === car.id), ms);
const nameOf = (c: Car) => `<span style="color:${c.spec.ai ? 'var(--chalk)' : c.spec.color}">${escapeHtml(c.spec.name)}</span>`;

function onFinish(car: Car) {
  if (!car.spec.ai) {
    const best = bestTime();
    if (!best || car.finish! < best.time) {
      const next = { time: car.finish!, name: car.spec.name, car: CARS.find((t) => t.id === car.spec.model)?.name };
      bestTimes.set(citySpec().id, next);
      saves.set(`best-${citySpec().id}`, next);
      const who = playerOf(car);
      if (who) who.best = true;
      flashes.set(car, { text: `New record · ${fmt(car.finish!)}`, until: drive.t + 4 });
    }
  }
  if (flagT >= 0) return;
  flagT = 0;
  callout(`${nameOf(car)} wins`, `First to ${citySpec().to}`);
  buzz(car, 300);
}

function onEvents(ev: Events) {
  for (const h of ev.hits) {
    world.hit(h.car, h.x, h.z, h.strength);
    if (h.car.spec.ai || h.car.spec.kind !== 'racer') continue;
    buzz(h.car, Math.min(400, 40 + h.strength * 25));
    if (h.wall) engines.crunch(Math.min(1, h.strength / 8));
    else engines.thump(Math.min(1, h.strength / 8));
  }
  for (const c of ev.spun) if (!c.spec.ai && c.spec.kind === 'racer') buzz(c, 500);
  for (const c of ev.near) {
    meters.set(c, Math.min(1, (meters.get(c) ?? 0) + 0.25));
    if (!c.spec.ai) { flashes.set(c, { text: 'Near miss', until: drive.t + 1.2 }); buzz(c, 40); }
  }
  for (const c of ev.violation) if (!c.spec.ai) { flashes.set(c, { text: 'Ran a red light', until: drive.t + 2 }); buzz(c, 200); }
  for (const c of ev.chased) { callout(`Police after ${nameOf(c)}`, 'Ran a red light'); if (!c.spec.ai) buzz(c, 400); }
  for (const c of ev.pulledOver) { callout(`${nameOf(c)} pulled over`, 'Stopped by the police'); if (!c.spec.ai) buzz(c, 700); }
  for (const c of ev.escaped) if (!c.spec.ai) { flashes.set(c, { text: 'Lost the police', until: drive.t + 2.5 }); buzz(c, 120); }
  for (const c of ev.finished) onFinish(c);
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  const last = CARS.findIndex((t) => t.id === c.record?.car); // (the car they drove last time)
  if (last >= 0) c.pick = last;
  if (stage === 'lobby') renderLobby();
  loadPaints(c);
}

async function loadPaints(c: Player) {
  const owned = await ownedItems(c);
  const was = paintOf(c).id || c.record?.paint;
  c.paints = PAINTS.filter((p) => owned.includes(p.id));
  c.paint = c.paints.findIndex((p) => p.id === was) + 1; // (back to their own colour if it's not theirs)
  if (stage === 'garage') showroom();
}

// Stars for everyone who started: for finishing, a win or a podium (against someone), a record
function payOut() {
  const order = drive.standings(), against = order.length > 1;
  for (const c of drivers.values()) {
    const car = order.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1, why: EarnFor[] = ['played'];
    if (against && pos === 1) why.push('won');
    else if (against && pos <= 3) why.push('podium');
    if (c.best) why.push('record');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

async function loadBestTime() {
  const id = citySpec().id;
  if (bestTimes.has(id)) return;
  bestTimes.set(id, await saves.get<BestTime>(`best-${id}`));
  if (stage === 'lobby') renderLobby();
}

// everyone who started the race, including anyone whose phone dropped before the end
function saveRecords() {
  const order = drive.standings();
  for (const c of drivers.values()) {
    const car = order.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1;
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.races++;
    if (pos === 1) r.wins++;
    if (pos <= 3) r.podiums++;
    if (car.finish !== null && (!r.bestLap || car.finish < r.bestLap)) r.bestLap = car.finish;
    r.car = car.spec.model;
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
  // their car drives the rest of the way on its own
  const car = drive.racers.find((x) => x.id === c.id);
  if (car && stage !== 'lobby') car.spec.ai = true;
  if (stage === 'lobby') renderLobby();
  if (stage === 'garage') (input.list.length ? showroom() : toLobby());
};
input.onRename = () => stage === 'lobby' && renderLobby();
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Street Racing');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  if (stage === 'garage' && fx && !c.ready) {
    c.pick = (c.pick + fx + CARS.length) % CARS.length;
    showroom();
  }
  if (stage === 'garage' && fy && !c.ready && c.paints.length) {
    c.paint = (c.paint - fy + c.paints.length + 1) % (c.paints.length + 1); // (▲ = the previous one)
    showroom();
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.bolt) (stage === 'garage' ? toggleReady(c) : confirm());
    else if (ev.bit === BIT.drop) (stage === 'garage' && c.ready ? toggleReady(c) : back());
    else if (ev.bit === BIT.leaf && stage === 'garage' && !c.ready && settings.weather === Forecast.Showers) { c.tyre = c.tyre === Tyre.Wet ? Tyre.Slick : Tyre.Wet; showroom(); }
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
  if (key === 'city') { settings.city = (settings.city + d + CITIES.length) % CITIES.length; return toLobby(); }
  if (key === 'weather') { settings.weather = cycle(SKIES, settings.weather); return toLobby(); }
  if (key === 'traffic') { settings.traffic = Math.max(0, Math.min(TRAFFIC_LEVELS.length - 1, settings.traffic + d)); return toLobby(); }
  if (key === 'rivals') settings.rivals = Math.max(0, Math.min(9, settings.rivals + d));
  else settings.level = (settings.level + d + LEVELS.length) % LEVELS.length;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') start();
  else if (stage === 'garage') startRace(); // (Enter on the keyboard: go now)
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused' || stage === 'garage') toLobby();
}

// The phone's steering slider (or the arrow keys) steers; gas and brake are held (brake, stopped: reverse)
function driveInput(c: Player) {
  c.drain(); // (no presses to act on while driving: pause comes through onPause)
  const car = drive.racers.find((x) => x.id === c.id);
  if (!car || car.spec.ai || car.finish !== null) return;
  car.throttle = controls.held(c, 'drive', 'throttle') || c.y > 0.5 ? 1 : 0;
  car.brake = controls.held(c, 'drive', 'brake') || c.y < -0.5 ? 1 : 0;
  const boosting = controls.held(c, 'drive', 'boost') && (meters.get(car) ?? 0) > 0 && car.held <= 0;
  car.boost = boosting ? BOOST : 0;
  const x = Math.abs(c.x) < 0.05 ? 0 : c.x;
  car.steer = Math.sign(x) * Math.abs(x) ** 1.3; // (fine control near the middle)
  const view = world.views.find((v) => v.car === car);
  if (view) view.lookBack = controls.held(c, 'drive', 'lookBack');
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
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Street Racing', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'garage': return c.ready
      ? { ...base, labels: { drop: 'Change car' }, hint: 'Ready. Waiting for the others' }
      : { ...base, labels: { bolt: 'Ready', drop: 'Back', ...(settings.weather === Forecast.Showers ? { leaf: TYRE_NAME[c.tyre] } : {}) },
          hint: c.paints.length ? `◀▶ car: ${CARS[c.pick].name} · ▲▼ paint` : `◀▶ pick your car: ${CARS[c.pick].name}` };
    case 'results': return { ...base, labels: { bolt: 'Race again', drop: 'Lobby' }, hint: 'Race over' };
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const car = drive.racers.find((x) => x.id === c.id);
      if (!car) return { ...base, labels: {}, hint: 'You race next time' };
      const pos = ordinal(drive.standings().indexOf(car) + 1);
      if (car.finish !== null) return { ...base, labels: {}, hint: `You finished ${pos}` };
      const hint = car.held > 0 ? 'Pulled over by the police' : drive.chasing === car ? `${pos} · Police! Lose them` : `${pos} · ${nextTurn(car).text}`;
      return { ...base, layout: 'racing', labels: controls.labels('drive'), hint };
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
  const value = { city: citySpec().name, weather: FORECASTS[settings.weather].name, rivals: String(settings.rivals), traffic: TRAFFIC_LEVELS[settings.traffic].name, level: LEVELS[settings.level].name };
  const label = { city: 'Race', weather: 'Weather', rivals: 'Computer drivers', traffic: 'Traffic', level: 'Their pace' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  const rec = bestTime();
  $('trackAbout').textContent = `${citySpec().about} ${settings.weather === Forecast.Dry ? 'Dry all race.' : FORECASTS[settings.weather].about}`;
  $('record').textContent = rec ? `Record: ${fmt(rec.time)} by ${rec.name}${rec.car ? ` (${rec.car})` : ''}` : 'No record across this city yet. Set one.';
}

// Picking cars: each person's choice turning in their part of the screen
function showroom() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  world.showroom(list.map((c) => ({ model: models.get(CARS[c.pick].id)!, color: paintOf(c).color, tyre: personTyre(c) })));
  renderGarage();
}

function renderGarage() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.08, Math.min(1, (v - 0.82) / 0.4)) * 100)}%"></b></i></div>`;
  $('views').innerHTML = world.views.map((v, i) => {
    const c = list[i], t = CARS[c.pick], r = v.rect;
    return `<div class="view pick" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="card panel">${chip(c)}
        <div class="carname"><span class="glyph glyph-key">◀</span><h2>${escapeHtml(t.name)}</h2><span class="glyph glyph-key">▶</span></div>
        <p class="muted">${escapeHtml(t.about)}</p>
        <div class="paint"><i style="background:${paintOf(c).color}"></i>${escapeHtml(paintOf(c).name)}${c.paints.length
          ? ` <span class="faint">· ▲▼ ${c.paints.length + 1} paints</span>` : ' <span class="faint">· more in the shop on your phone</span>'}</div>
        ${settings.weather === Forecast.Showers ? `<div class="paint tyres"><i class="tread ${c.tyre}"></i>${TYRE_NAME[c.tyre]} <span class="faint">· ${glyph('leaf')} ${c.tyre === Tyre.Wet ? 'safe in the rain, slower in the dry' : 'quick in the dry, a handful in the rain'}</span></div>` : ''}
        ${bar('Top speed', t.top * 1.1)}${bar('Pick-up', t.accel)}${bar('Grip', t.grip)}${bar('Weight', t.weight * 0.85)}
        <div class="ready ${c.ready ? 'on' : ''}">${c.ready ? 'Ready' : `${glyph('bolt')} when you're happy`}</div>
      </div></div>`;
  }).join('');
  $('tower').classList.add('hidden');
}

// One box per view, laid over its part of the screen
function buildHud() {
  $('views').innerHTML = world.views.map((v, i) => {
    const r = v.rect, at = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
    const who = v.car ? playerOf(v.car) ?? input.list.find((c) => c.id === v.car!.id) : undefined;
    return `<div class="view ${v.car ? '' : 'tv'}" id="view${i}" style="${at}">
      <div class="pos"><b></b><span></span></div>${who ? `<div class="who">${chip(who)}</div>` : ''}
      <div class="lap"></div><div class="sky"></div><div class="speed"></div>${v.car ? `<div class="boost"><span>${glyph('star')} Boost</span><i><b></b></i></div><div class="turn"><b></b><span></span></div>` : ''}<div class="flash"></div>
      <div class="map"><canvas width="240" height="240"></canvas><span></span></div><div class="tags"></div><div class="cop">Police</div></div>`;
  }).join('');
  $('tower').classList.toggle('hidden', world.views.length > 1);
}

function updateHud() {
  const order = drive.standings(), leader = order[0];
  world.views.forEach((v, i) => {
    const el = document.getElementById(`view${i}`);
    if (!el) return;
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    drawMap(q('.map canvas') as HTMLCanvasElement, v.car ?? leader);
    if (!v.car) {
      q('.pos b').textContent = 'Race';
      q('.pos span').textContent = `${toGo(leader)} to go`;
      q('.map span').textContent = `${citySpec().start} → ${citySpec().to}`;
      return;
    }
    const car = v.car, pos = order.indexOf(car) + 1, turn = nextTurn(car);
    q('.pos b').textContent = ordinal(pos);
    q('.pos span').textContent = `of ${order.length}`;
    q('.lap').textContent = car.finish !== null ? 'Finished' : `${toGo(car)} to go`;
    q('.map span').textContent = `To ${citySpec().to}`;
    q('.speed').innerHTML = `${Math.round(car.v * 2.237)}<span>mph</span>`;
    q('.sky').textContent = weather ? weather.conditions : '';
    q('.turn').classList.toggle('hidden', car.finish !== null);
    q('.turn b').textContent = turn.arrow;
    q('.turn span').textContent = turn.text;
    q('.cop').classList.toggle('on', drive.chasing === car || car.held > 0);
    q('.cop').classList.toggle('blue', Math.floor(drive.t * 3) % 2 === 0);
    q('.cop').textContent = car.held > 0 ? `Pulled over · ${car.held.toFixed(1)} s` : 'Police';
    const meter = meters.get(car) ?? 0, boost = q('.boost');
    q('.boost b').style.width = `${Math.round(meter * 100)}%`;
    boost.classList.toggle('full', meter >= 1);
    boost.classList.toggle('on', car.boost > 0);
    const flash = q('.flash'), note = flashes.get(car);
    if (note && drive.t < note.until) { flash.textContent = note.text; flash.classList.add('show'); }
    else if (car.spinning > 0) { flash.textContent = 'Spun round!'; flash.classList.add('show'); }
    else flash.classList.remove('show');
  });
  if (world.views.length > 1) return;
  $('tower').innerHTML = order.map((c, i) => `<div class="row ${c.spec.ai ? '' : 'me'}" style="--pc:${c.spec.color}">
      <span class="num">${i + 1}</span><i></i><span>${escapeHtml(c.spec.name)}</span><span class="gap">${gapText(c, leader, i)}</span></div>`).join('');
}

function gapText(c: Car, leader: Car, i: number) {
  if (i === 0) return c.finish !== null ? fmt(c.finish) : 'Leader';
  if (c.finish !== null && leader.finish !== null) return `+${(c.finish - leader.finish).toFixed(1)}`;
  return `+${Math.max(0, Math.round(c.remaining - leader.remaining))} m`;
}

function renderResults() {
  const order = drive.standings(), win = order[0];
  $('winner').innerHTML = `${nameOf(win)} wins`;
  $('resultsTrack').textContent = `${citySpec().start} to ${citySpec().to}${weather ? ` · ${FORECASTS[weather.forecast].name}` : ''}`;
  $('standings').innerHTML = order.map((c, i) => {
    const human = playerOf(c);
    const who = human ? chip(human) : `<span class="chip" style="--pc:${c.spec.color}"><b>${i + 1}</b>${escapeHtml(c.spec.name)}</span>`;
    const time = c.finish !== null ? (i === 0 ? fmt(c.finish) : gapText(c, win, i)) : `${toGo(c)} to go`;
    return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${who}
      <span class="caption">${escapeHtml(CARS.find((t) => t.id === c.spec.model)?.name ?? '')}${human ? ` · ${escapeHtml(recordLine(human.record))}` : ''}${human?.earned?.earned ? ` · +${starsLabel(human.earned.earned)}` : ''}</span>
      <span class="time">${time}</span><span class="best"></span></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(html: string, sub = '') {
  $('callout').innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${html}</div>`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), 1800);
}

// --- where to go: the next turn on the quickest way from here, and how far there is to go ---------------------
function toGo(c: Car) {
  const m = Math.max(0, c.remaining);
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

function nextTurn(c: Car): { arrow: string; text: string } {
  const r = drive.city.route(c.x, c.z, c.h);
  if (!r.length) return { arrow: '↑', text: 'Find a street' };
  const f = drive.city.finish;
  let hx = Math.cos(c.h), hz = Math.sin(c.h);
  // (the way you're going, squared to the grid)
  if (Math.abs(hx) > Math.abs(hz)) { hx = Math.sign(hx); hz = 0; } else { hz = Math.sign(hz); hx = 0; }
  let px = c.x, pz = c.z, dist = 0;
  for (const n of r) {
    const dx = n.x - px, dz = n.z - pz, len = Math.hypot(dx, dz);
    const along = (dx * hx + dz * hz) / (len || 1);
    if (len > n.size && along < 0.7) {
      // (the way to it isn't the way you're pointing: turn round)
      if (n === r[0]) return { arrow: '↓', text: 'Turn round' };
    }
    dist += len;
    if (n === f) return { arrow: '🏁', text: `${citySpec().to.replace(/^the /, '')} in ${Math.round(dist / 10) * 10} m` };
    const next = r[r.indexOf(n) + 1];
    if (!next) break;
    const ox = Math.sign(next.x - n.x), oz = Math.sign(next.z - n.z), cross = hx * oz - hz * ox;
    if (ox !== hx || oz !== hz) {
      const m = Math.max(0, Math.round((dist - n.size / 2) / 10) * 10);
      const when = m <= 10 ? 'now' : `in ${m} m`;
      return cross > 0 ? { arrow: '↱', text: `Right ${when}` } : cross < 0 ? { arrow: '↰', text: `Left ${when}` } : { arrow: '↓', text: 'Turn round' };
    }
    px = n.x; pz = n.z;
  }
  return { arrow: '↑', text: 'Straight on' };
}

// --- the map: the city, the quickest way from where you are, everyone on it, the police, the finish --------------
const mapCache = new Map<City, HTMLCanvasElement>();
function drawMap(cv: HTMLCanvasElement, me: Car) {
  const c = drive.city, b = c.bounds, S = cv.width, g = cv.getContext('2d')!;
  const k = (S - 16) / Math.max(b.x1 - b.x0, b.z1 - b.z0), ox = (S - (b.x1 - b.x0) * k) / 2, oz = (S - (b.z1 - b.z0) * k) / 2;
  const X = (x: number) => ox + (x - b.x0) * k, Z = (z: number) => oz + (z - b.z0) * k;
  // (the streets and the river don't change: drawn once)
  if (!mapCache.has(c)) {
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const m = base.getContext('2d')!;
    m.fillStyle = 'rgba(10,12,18,0.82)';
    m.fillRect(0, 0, S, S);
    m.fillStyle = 'rgba(40,110,160,0.6)';
    m.fillRect(0, Z(c.river!.z0), S, (c.river!.z1 - c.river!.z0) * k);
    m.lineCap = 'square';
    for (const e of c.edges) {
      m.strokeStyle = e.kind === 'alley' ? 'rgba(243,240,232,0.28)' : 'rgba(243,240,232,0.5)';
      m.lineWidth = Math.max(1.2, e.width * k * (e.kind === 'avenue' || e.kind === 'bridge' ? 1.1 : 0.9));
      m.beginPath(); m.moveTo(X(e.a.x), Z(e.a.z)); m.lineTo(X(e.b.x), Z(e.b.z)); m.stroke();
    }
    for (const lot of c.lots) if (lot.park) { m.fillStyle = 'rgba(60,140,70,0.6)'; m.fillRect(X(lot.x0), Z(lot.z0), (lot.x1 - lot.x0) * k, (lot.z1 - lot.z0) * k); }
    mapCache.set(c, base);
  }
  g.clearRect(0, 0, S, S);
  g.drawImage(mapCache.get(c)!, 0, 0);
  // the quickest way from here
  const route = c.route(me.x, me.z, me.h);
  g.strokeStyle = '#d7ff3b';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(X(me.x), Z(me.z));
  for (const n of route) g.lineTo(X(n.x), Z(n.z));
  g.stroke();
  g.font = '700 18px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('🏁', X(c.finish.x), Z(c.finish.z));
  const dot = (car: Car, r: number, color: string) => { g.fillStyle = color; g.beginPath(); g.arc(X(car.x), Z(car.z), r, 0, Math.PI * 2); g.fill(); };
  for (const car of drive.racers) if (car !== me) dot(car, 3.5, car.spec.ai ? '#c0c4cc' : car.spec.color);
  if (drive.police.active) dot(drive.police, 4.5, Math.floor(drive.t * 4) % 2 ? '#ff2a3a' : '#2a6dff');
  // you: an arrow the way you're pointing
  g.save();
  g.translate(X(me.x), Z(me.z));
  g.rotate(me.h);
  g.fillStyle = me.spec.ai ? '#c0c4cc' : me.spec.color;
  g.strokeStyle = '#f3f0e8';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-2, 0); g.lineTo(-5, -5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// --- the names over the cars, in each view: who you're racing, and where they are ---------------------------
function placeTags() {
  const order = drive.standings();
  world.views.forEach((v, i) => {
    const box = document.querySelector<HTMLElement>(`#view${i} .tags`);
    if (!box) return;
    const html: string[] = [];
    for (const c of order) {
      if (c === v.car) continue;
      const at = world.screenOf(c, v);
      if (!at || at.dist > 170) continue;
      html.push(`<div class="tag" style="left:${(at.x * 100).toFixed(1)}%;top:${(at.y * 100).toFixed(1)}%;opacity:${Math.max(0.35, 1 - at.dist / 190).toFixed(2)};--pc:${c.spec.ai ? '#c0c4cc' : c.spec.color}"><b>${order.indexOf(c) + 1}</b>${escapeHtml(c.spec.name)}</div>`);
    }
    if (drive.police.active) { const at = world.screenOf(drive.police, v); if (at && at.dist < 200) html.push(`<div class="tag cop" style="left:${(at.x * 100).toFixed(1)}%;top:${(at.y * 100).toFixed(1)}%"><b>!</b>Police</div>`); }
    box.innerHTML = html.join('');
  });
}

// --- the TV camera: in the lobby it follows someone for a while ---------------------------------------
let tvCar: Car | null = null, tvT = 0;
function tvFocus(dt: number) {
  tvT -= dt;
  const order = drive.standings();
  if (!tvCar || tvT <= 0 || !order.includes(tvCar)) { tvCar = order[Math.floor(Math.random() * Math.min(3, order.length))]; tvT = 12; }
  return stage === 'lobby' ? tvCar : order[0];
}

// --- the boost, and the computer drivers' pace ----------------------------------------------------------
// The meter fills on near misses (in onEvents) and slowly in someone's slipstream; it empties while you hold
// Star. The computer drivers use theirs on long straights, and get a lift when they're behind the people.
function boosts() {
  let lead = Infinity;
  for (const p of people()) if (p.finish === null) lead = Math.min(lead, p.remaining);
  for (const c of drive.racers) {
    if (c.finish !== null) { c.boost = 0; continue; }
    let m = meters.get(c) ?? 0;
    const behindSomeone = drive.racers.some((o) => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 25 && ((o.x - c.x) * Math.cos(c.h) + (o.z - c.z) * Math.sin(c.h)) > 6);
    if (behindSomeone && c.v > 20) m += TICK * 0.05;
    let boosting = c.boost >= BOOST;
    if (c.spec.ai) boosting = m > 0 && (boosting || m > 0.6) && c.v > 25 && c.held <= 0;
    if (boosting) m -= TICK / BOOST_FOR;
    if (m <= 0) boosting = false;
    meters.set(c, Math.max(0, Math.min(1, m)));
    let lift = 0;
    if (c.spec.ai && Number.isFinite(lead)) {
      const behind = c.remaining - lead;
      lift = behind > 20 ? Math.min(CATCH_UP_MAX, (behind - 20) * CATCH_UP) : behind < -150 ? EASE_OFF : 0;
    }
    c.boost = (boosting ? BOOST : 0) + lift;
  }
  drive.police.boost = 0.2; // (the police always have a bit more)
}

// --- the loop -----------------------------------------------------------------------------------------
function tick() {
  stageT += TICK;
  if (stage === 'garage') return;
  weather?.step(drive.t, TICK);
  drive.wet = weather?.wet ?? 0;
  if (stage === 'grid') {
    const n = 3 - Math.floor(stageT / 0.9);
    if (n !== countShown) {
      countShown = n;
      callout(n > 0 ? String(n) : 'Go', n > 0 ? `To ${citySpec().to} · any way you like` : '');
      if (n <= 0) for (const c of people()) buzz(c, 120);
    }
    if (stageT >= 2.7) { stage = 'racing'; stageT = 0; }
    drive.step(false);
    return;
  }
  boosts();
  const ev = drive.step(true);
  if (stage === 'lobby') {
    for (const h of ev.hits) world.hit(h.car, h.x, h.z, h.strength);
    const first = drive.standings()[0];
    if (first.finish !== null && drive.t - first.finish > 6) newRace(false); // (the race behind the menu: again)
    return;
  }
  if (stage !== 'racing') return; // (the cool-down behind the results)
  onEvents(ev);
  if (flagT >= 0) flagT += TICK;
  const done = people().every((c) => c.finish !== null);
  if (flagT >= 0 && (done ? flagT > 3 : flagT > 40)) endRace(); // (stragglers get 40 s after the winner)
}

const MIN_FRAME = 1000 / maxFps - 1;
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

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
  world.render(dt, now, drive, tvFocus(dt), drive.standings()[0], weather);
  placeTags();
  const racing = stage === 'racing' || stage === 'grid', chased = drive.chasing;
  siren.set(stage === 'racing' && drive.police.active ? (chased && !chased.spec.ai ? 1 : 0.3) : 0);
  if (racing) {
    engines.update(people().filter((c) => c.finish === null).map(driving), pack());
    engines.weather(weather?.rain ?? 0, weather?.wet ?? 0);
  } else engines.update([]);
  hudT += dt;
  if (hudT > 0.1 && (racing || stage === 'paused')) { hudT = 0; updateHud(); }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
  guard.frame(now);
}

// What a person's car sounds like: how it's going, and which side of a split screen it's on
function driving(c: Car): Driving {
  const r = world.views.find((v) => v.car === c)?.rect;
  const slip = Math.abs(c.vx * -Math.sin(c.h) + c.vz * Math.cos(c.h));
  return { id: c.id, v: c.v, throttle: c.throttle, slip: slip * 0.3 + (c.spinning > 0 ? 3 : 0), scrape: c.scraping !== 0, pan: r ? (r.x + r.w / 2) * 2 - 1 : 0 };
}

// The car nearest to any person, for the sound of the traffic going by
function pack(): Others | undefined {
  let best: Others | undefined;
  for (const p of people()) for (const c of drive.cars) {
    if (c === p || !c.active) continue;
    const near = 1 - Math.hypot(c.x - p.x, c.z - p.z) / 50;
    if (near > (best?.near ?? 0)) best = { near, v: c.v };
  }
  return best;
}

// --- the siren, while the police are out (louder when they're after one of you) ------------------------------
const siren = new class {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  set(level: number) {
    if (!this.ctx) {
      if (!level) return;
      this.ctx = new AudioContext();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'triangle';
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
    }
    if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); return; }
    const now = this.ctx.currentTime;
    this.osc!.frequency.setTargetAtTime(Math.floor(now / 0.45) % 2 ? 960 : 720, now, 0.03);
    this.gain!.gain.setTargetAtTime(level * 0.05, now, 0.2);
  }
}();

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
$('legend').innerHTML = `<span>${glyph('stick')} Steer</span><span>${glyph('bolt')} Gas</span><span>${glyph('drop')} Brake / reverse</span><span>${glyph('star')} Boost</span><span>${glyph('r1')} Look back</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', start);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
world.resize();
engines.unlock(); // (works straight away in the TV app; elsewhere, on the first click or key)
(globalThis as { streetRacing?: unknown }).streetRacing = { world, get drive() { return drive; } }; // (for looking into it while testing)
toLobby();
requestAnimationFrame(frame);
