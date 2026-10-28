// Stock Cars: the game flow. Lobby (with a race going on behind it), picking cars, the grid, the
// race, results, saved records. The tracks and cars are data (tracks.json, cars.json); the racing is
// shared with the other racing games (@racing: race.ts, the track's shape in track.ts, the models in
// cars.ts, the weather in weather.ts); the 3D world is in scene.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, PerformanceGuard, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { loadCars, type CarType } from '@racing/cars.ts';
import { Race, TICK, TOP, type Car, type CarSpec, type Hit } from '@racing/race.ts';
import { World } from './scene.ts';
import { Engines, type Driving, type Others } from '@racing/sound.ts';
import { Track, type TrackSpec } from '@racing/track.ts';
import { Tyre, TYRE_NAME } from '@racing/tyres.ts';
import { FORECASTS, Forecast, Weather } from '@world/weather.ts';

const device = await requireDevice(); // (simple 3D: not on the lightest screens)
const getJson = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);
const [{ tracks: TRACKS }, { cars: CARS }] = await Promise.all([
  getJson<{ tracks: TrackSpec[] }>('tracks.json'),
  getJson<{ cars: CarType[] }>('cars.json'),
  document.fonts.load('900 100px "Big Shoulders Display"'), // (the cars' numbers are painted in it)
]);
const models = await loadCars(CARS, device.tier === 'heavy' && !device.tv); // (clear coats where there's power to spare)
// Paint jobs bought with stars (shop.json); everyone also has their own player colour
interface Paint { id: string; name: string; color: string }
const PAINTS: Paint[] = (await shopItems('stock-cars')).filter((it) => typeof it.extra.color === 'string')
  .map((it) => ({ id: it.id.slice('stock-cars/'.length), name: it.name, color: it.extra.color as string }));
const controls = await loadControls(['drive'] as const, ['throttle', 'brake', 'lookBack'] as const);
const saves = gameSaves();

// What we remember about each driver, and the fastest lap at each track
interface PlayerRecord { name: string; races: number; wins: number; podiums: number; bestLap: number; car?: string; paint?: string }
interface LapRecord { time: number; name: string; car?: string }
const freshRecord = (name: string): PlayerRecord => ({ name, races: 0, wins: 0, podiums: 0, bestLap: 0 });
const lapRecords = new Map<string, LapRecord | null>();

interface Driver {
  record: PlayerRecord | null;
  pick: number; // the car (cars.json)
  ready: boolean;
  paints: Paint[]; // the paint jobs they own
  paint: number; // 0 = their own colour, then paints[paint - 1]
  tyre: Tyre; // what they start on (no pit stops here: it's for the whole race)
  lapRecord: boolean; // set the track's lap record this race
  earned: Earned | null; // stars from the last race
}
const input = new Input({ state: (): Driver => ({ record: null, pick: 0, ready: false, paints: [], paint: 0, tyre: Tyre.Slick, lapRecord: false, earned: null }) });
type Player = Pad<Driver>;
const paintOf = (c: Player) => c.paints[c.paint - 1] ?? { id: '', name: 'Your colour', color: c.color };

// --- settings, chosen in the lobby --------------------------------------------------------------
const LAPS = [3, 5, 10];
const LEVELS = [{ name: 'Easy', skill: 0.94 }, { name: 'Medium', skill: 0.975 }, { name: 'Hard', skill: 1 }];
// Rain only on a road course: a wet oval isn't raced (the banking's too slippery), so it's always dry
const SKIES = [Forecast.Dry, Forecast.Showers, Forecast.Rain];
const settings = { track: 0, rivals: 7, laps: 5, level: 1, weather: Forecast.Dry };
const ROWS = ['track', 'weather', 'rivals', 'laps', 'level'] as const;
let row = 0; // the lobby row being changed

type Stage = 'lobby' | 'garage' | 'grid' | 'racing' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'racing';
let stageT = 0;
let race: Race;
let flagT = -1; // seconds since the winner took the flag (-1: not yet)
let countShown = 0;
const drivers = new Map<string, Player>(); // the people in this race, even if their phone has gone since
const lapShown = new Map<Car, number>(); // when each car's last lap time went up on its screen

const tracks = new Map<string, Track>();
const trackSpec = () => TRACKS[settings.track];
const track = () => {
  const spec = trackSpec();
  if (!tracks.has(spec.id)) tracks.set(spec.id, new Track(spec));
  return tracks.get(spec.id)!;
};
const lapRecord = () => lapRecords.get(trackSpec().id) ?? null;
const forecast = (): Forecast => (track().road ? settings.weather : Forecast.Dry);

const world = new World($<HTMLCanvasElement>('world'));
const engines = new Engines();

// A steady 30 on a TV is kinder than a ragged 60
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
const NUMBERS = [7, 11, 14, 17, 22, 28, 31, 42, 55, 63, 77, 91];

// Wets when it's raining from the start; for showers the people choose, and the computer drivers
// split: half gamble on slicks
const startTyre = (c: Car): Tyre => {
  const f = forecast();
  if (f === Forecast.Dry) return Tyre.Slick;
  if (f === Forecast.Rain) return Tyre.Wet;
  if (c.spec.ai) return c.spec.number % 2 ? Tyre.Wet : Tyre.Slick;
  const p = input.list.find((x) => x.id === c.id);
  return p ? personTyre(p) : Tyre.Slick;
};
const personTyre = (c: Player): Tyre => (forecast() === Forecast.Showers ? c.tyre : forecast() === Forecast.Rain ? Tyre.Wet : Tyre.Slick);

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
    skill: skill + (Math.random() - 0.5) * 0.012,
    car: carOf(i % 3 === 0 ? CARS[0] : CARS[Math.floor(Math.random() * CARS.length)]), // (mostly Stockers)
  }));
  return shuffle([...people, ...rivals]); // (a random grid)
}

function newRace(withPeople: boolean, laps: number) {
  world.setTrack(track());
  race = new Race(track(), field(withPeople), laps);
  // the weather, over about as long as the race will take (the one behind the menu runs on and on)
  const f = forecast();
  race.weather = f === Forecast.Dry ? null : new Weather(f, (Math.min(laps, 20) * track().length) / (TOP * 0.6));
  for (const c of race.cars) c.tyre = startTyre(c);
  world.setCars(race.cars, models);
  const slot = (c: Car) => input.list.find((p) => p.id === c.id)?.slot ?? 99;
  world.setViews(race.cars.filter((c) => !c.spec.ai).sort((a, b) => slot(a) - slot(b))); // (P1 top left)
  lapShown.clear();
  buildHud();
}

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  stageT = 0;
  newRace(false, 999); // the race behind the menu
  engines.silence();
  show('lobby');
  renderLobby();
  loadLapRecord();
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
    c.lapRecord = false;
    c.earned = null;
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

const people = () => race.cars.filter((c) => !c.spec.ai);
const playerOf = (car: Car) => drivers.get(car.id);
const buzz = (car: Car, ms: number) => input.buzz(input.list.find((c) => c.id === car.id), ms);

function onLap(car: Car) {
  if (car.laps === race.laps - 1 && race.laps > 1 && race.standings()[0] === car) callout('Final lap', 'White flag');
  if (car.spec.ai) return;
  lapShown.set(car, race.t);
  const record = lapRecord();
  if (!record || car.lastLap < record.time) {
    const next = { time: car.lastLap, name: car.spec.name, car: car.stats.name };
    lapRecords.set(trackSpec().id, next);
    saves.set(`lap-record-${trackSpec().id}`, next);
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

// Sparks for every hit; sound and a buzz when it's one of the people
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

// Stars for everyone who started: for finishing, a win or a podium (against someone), a lap record
function payOut() {
  const order = race.standings(), against = race.cars.length > 1;
  for (const c of drivers.values()) {
    const car = race.cars.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1, why: EarnFor[] = ['played'];
    if (against && pos === 1) why.push('won');
    else if (against && pos <= 3) why.push('podium');
    if (c.lapRecord) why.push('record');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

async function loadLapRecord() {
  const id = trackSpec().id;
  if (lapRecords.has(id)) return;
  lapRecords.set(id, await saves.get<LapRecord>(`lap-record-${id}`));
  if (stage === 'lobby') renderLobby();
}

// everyone who started the race, including anyone whose phone dropped before the end
function saveRecords() {
  const order = race.standings();
  for (const c of drivers.values()) {
    const car = race.cars.find((x) => x.id === c.id);
    if (!car) continue;
    const pos = order.indexOf(car) + 1;
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.races++;
    if (pos === 1) r.wins++;
    if (pos <= 3) r.podiums++;
    if (car.bestLap && (!r.bestLap || car.bestLap < r.bestLap)) r.bestLap = car.bestLap;
    r.car = car.stats.id;
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
  const car = race.cars.find((x) => x.id === c.id);
  if (car && stage !== 'lobby') { car.spec.ai = true; car.lane = 0; }
  if (stage === 'lobby') renderLobby();
  if (stage === 'garage') (input.list.length ? showroom() : toLobby());
};
input.onRename = () => stage === 'lobby' && renderLobby();
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Stock Cars');

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
    else if (ev.bit === BIT.leaf && stage === 'garage' && !c.ready && forecast() === Forecast.Showers) { c.tyre = c.tyre === Tyre.Wet ? Tyre.Slick : Tyre.Wet; showroom(); }
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
  if (key === 'track') {
    settings.track = (settings.track + d + TRACKS.length) % TRACKS.length;
    return toLobby(); // (the race behind the menu moves to the new track)
  }
  if (key === 'weather') {
    if (!track().road) return; // (ovals are dry)
    settings.weather = cycle(SKIES, settings.weather);
    return toLobby(); // (the race behind the menu gets the weather too)
  }
  if (key === 'rivals') settings.rivals = Math.max(0, Math.min(11, settings.rivals + d));
  else if (key === 'laps') settings.laps = cycle(LAPS, settings.laps);
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

// The phone's steering slider (or the arrow keys) steers; gas and brake are held
function driveInput(c: Player) {
  c.drain(); // (no presses to act on while driving: pause comes through onPause)
  const car = race.cars.find((x) => x.id === c.id);
  if (!car || car.spec.ai || car.finish !== null) return;
  car.throttle = controls.held(c, 'drive', 'throttle') || c.y > 0.5 ? 1 : 0;
  car.brake = controls.held(c, 'drive', 'brake') || c.y < -0.5 ? 1 : 0;
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
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Stock Cars', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'garage': return c.ready
      ? { ...base, labels: { drop: 'Change car' }, hint: 'Ready. Waiting for the others' }
      : { ...base, labels: { bolt: 'Ready', drop: 'Back', ...(forecast() === Forecast.Showers ? { leaf: TYRE_NAME[c.tyre] } : {}) },
          hint: c.paints.length ? `◀▶ car: ${CARS[c.pick].name} · ▲▼ paint` : `◀▶ pick your car: ${CARS[c.pick].name}` };
    case 'results': return { ...base, labels: { bolt: 'Race again', drop: 'Lobby' }, hint: 'Race over' };
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      const car = race.cars.find((x) => x.id === c.id);
      if (!car) return { ...base, labels: {}, hint: 'You race next time' };
      const pos = ordinal(race.standings().indexOf(car) + 1);
      if (car.finish !== null) return { ...base, labels: {}, hint: `You finished ${pos}` };
      return { ...base, layout: 'racing', labels: controls.labels('drive'), hint: `${pos} · lap ${Math.min(car.laps + 1, race.laps)} of ${race.laps}` };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(screen === 'pause' && id === 'hud'));
}

function renderLobby() {
  const people = input.list;
  $('drivers').innerHTML = people.length
    ? people.map((c) => `<div class="driver">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to drive. On your own? Race the computer drivers.</p>';
  const value = { track: trackSpec().name, weather: track().road ? FORECASTS[settings.weather].name : 'Dry (oval)', rivals: String(settings.rivals), laps: `${settings.laps} laps`, level: LEVELS[settings.level].name };
  const label = { track: 'Track', weather: 'Weather', rivals: 'Computer drivers', laps: 'Race', level: 'Their pace' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  const rec = lapRecord();
  $('trackAbout').textContent = `${trackSpec().about} ${track().road ? FORECASTS[settings.weather].about : 'Ovals are only raced in the dry.'}`;
  $('record').textContent = rec ? `Lap record: ${fmt(rec.time)} by ${rec.name}${rec.car ? ` (${rec.car})` : ''}` : 'No lap record here yet. Set one.';
}

// Picking cars: each person's choice turning in their part of the screen
function showroom() {
  const list = [...input.list].sort((a, b) => a.slot - b.slot);
  world.setTrack(track());
  world.showroom(list.map((c) => ({ model: models.get(CARS[c.pick].id)!, color: paintOf(c).color, number: c.slot + 1, tyre: personTyre(c) })));
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
        ${forecast() === Forecast.Showers ? `<div class="paint tyres"><i class="tread ${c.tyre}"></i>${TYRE_NAME[c.tyre]} <span class="faint">· ${glyph('leaf')} ${c.tyre === Tyre.Wet ? 'safe in the rain, slower in the dry' : 'quick in the dry, a handful in the rain'}</span></div>` : ''}
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
      <div class="lap"></div><div class="sky"></div><div class="speed"></div><div class="tow">Draft</div><div class="flash"></div></div>`;
  }).join('');
  $('tower').classList.toggle('hidden', world.views.length > 1);
}

function updateHud() {
  const order = race.standings(), leader = order[0];
  world.views.forEach((v, i) => {
    const el = document.getElementById(`view${i}`);
    if (!el) return;
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    if (!v.car) {
      q('.pos b').textContent = 'Race';
      q('.pos span').textContent = `lap ${Math.min(leader.laps + 1, race.laps)} of ${race.laps}`;
      return;
    }
    const car = v.car, pos = order.indexOf(car) + 1;
    q('.pos b').textContent = ordinal(pos);
    q('.pos span').textContent = `of ${order.length}`;
    q('.lap').textContent = car.finish !== null ? 'Finished' : `Lap ${Math.min(car.laps + 1, race.laps)} / ${race.laps}`;
    q('.speed').innerHTML = `${Math.round(car.v * 2.237)}<span>mph</span>`;
    q('.sky').textContent = race.weather ? `${race.weather.conditions} · ${TYRE_NAME[car.tyre]}` : '';
    q('.tow').classList.toggle('on', car.tow > 0.015 && car.v > 20 && car.finish === null);
    const shown = lapShown.get(car), flash = q('.flash');
    if (car.spinning > 0) { flash.textContent = 'Spun round!'; flash.classList.add('show'); return; }
    flash.classList.toggle('show', shown !== undefined && race.t - shown < 4);
    if (shown !== undefined) flash.textContent = `Lap ${fmt(car.lastLap)}${car.lastLap === car.bestLap ? ' · best' : ''}`;
  });
  if (world.views.length > 1) return;
  $('tower').innerHTML = order.map((c, i) => `<div class="row ${c.spec.ai ? '' : 'me'}" style="--pc:${c.spec.color}">
      <span class="num">${i + 1}</span><i></i><span>${escapeHtml(c.spec.name)}</span><span class="gap">${gapText(c, leader, i)}</span></div>`).join('');
}

function gapText(c: Car, leader: Car, i: number) {
  if (i === 0) return c.finish !== null ? fmt(c.finish) : 'Leader';
  if (c.finish !== null && leader.finish !== null) return `+${(c.finish - leader.finish).toFixed(1)}`;
  const behind = leader.dist - c.dist;
  if (behind >= race.track.length) return `+${plural(Math.floor(behind / race.track.length), 'lap', 'laps')}`;
  return `+${(behind / Math.max(c.v, 20)).toFixed(1)}`;
}

function renderResults() {
  const order = race.standings(), win = order[0];
  $('winner').innerHTML = `<span style="color:${win.spec.ai ? 'var(--chalk)' : win.spec.color}">${escapeHtml(win.spec.name)}</span> wins`;
  $('resultsTrack').textContent = `${race.track.name} · ${plural(race.laps, 'lap', 'laps')}${race.weather ? ` · ${FORECASTS[race.weather.forecast].name}` : ''}`;
  $('standings').innerHTML = order.map((c, i) => {
    const human = playerOf(c);
    const who = human ? chip(human) : `<span class="chip" style="--pc:${c.spec.color}"><b>${c.spec.number}</b>${escapeHtml(c.spec.name)}</span>`;
    const time = i === 0 ? (c.finish !== null ? fmt(c.finish) : '') : gapText(c, win, i);
    return `<div class="standing ${i === 0 ? 'first' : ''}"><span class="num">${i + 1}</span>${who}
      <span class="caption">${escapeHtml(c.stats.name)}${human ? ` · ${escapeHtml(recordLine(human.record))}` : ''}${human?.earned?.earned ? ` · +${starsLabel(human.earned.earned)}` : ''}</span>
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
  if (!tvCar || tvT <= 0 || !race.cars.includes(tvCar)) {
    const order = race.standings();
    const battles = order.filter((c, i) => i > 0 && Math.abs(race.track.gap(order[i - 1].dist, c.dist)) < 12);
    tvCar = battles.length ? battles[Math.floor(Math.random() * battles.length)] : order[0];
    tvT = 9;
  }
  return stage === 'lobby' ? tvCar : race.standings()[0];
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
    race.step(false);
    return;
  }
  const ev = race.step(true);
  for (const h of ev.wall) if (stage !== 'racing' || h.car.spec.ai) world.hit(h.car, h.d, h.strength);
  for (const h of ev.contact) if (stage !== 'racing' || h.car.spec.ai) world.hit(h.car, h.d, h.strength);
  if (stage !== 'racing') return; // (the lobby's race, or the cool-down lap behind the results)
  for (const h of ev.wall) if (!h.car.spec.ai) onHit(h, true);
  for (const h of ev.contact) if (!h.car.spec.ai) onHit(h, false);
  for (const c of ev.spun) if (!c.spec.ai) buzz(c, 500);
  for (const c of ev.lap) onLap(c);
  for (const c of ev.finished) onFinish(c);
  if (flagT >= 0) flagT += TICK;
  const done = people().every((c) => c.finish !== null);
  if (flagT >= 0 && (done ? flagT > 3 : flagT > 30)) endRace(); // (stragglers get 30 s after the winner)
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
  world.render(dt, tvFocus(dt), race.weather);
  const racing = stage === 'racing' || stage === 'grid';
  if (racing) {
    engines.update(people().filter((c) => c.finish === null).map(driving), pack());
    engines.weather(race.weather?.rain ?? 0, race.weather?.wet ?? 0);
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
  return { id: c.id, v: c.v, throttle: c.throttle, slip: Math.abs(c.slide) + Math.abs(c.knock), scrape: c.scraping !== 0, pan: r ? (r.x + r.w / 2) * 2 - 1 : 0 };
}

// The computer car nearest to any person, for the sound of the pack going by
function pack(): Others | undefined {
  let best: Others | undefined;
  for (const p of people()) for (const c of race.cars) {
    if (!c.spec.ai) continue;
    const near = 1 - Math.hypot(race.track.gap(c.dist, p.dist), c.d - p.d) / 50;
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
$('legend').innerHTML = `<span>${glyph('stick')} Steer</span><span>${glyph('bolt')} Gas</span><span>${glyph('drop')} Brake</span><span>${glyph('r1')} Look back</span>`;
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
