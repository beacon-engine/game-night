// Shift Bots: the game flow. The lobby (a bot on a plinth behind it, changing between car and robot),
// the garage (each person builds their bot: body, paint, finish, weapon, special), the fight (wave after
// wave, each of you in your part of the screen), the results. The bots are built in rig.ts from bots.json
// and painted in paint.ts; the garage is drawn in scene.ts, the fight in battle.ts; the rules are sim.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen, manualPadInput, manualScreen,
  ownedItems, PerformanceGuard, playerKey, requireDevice, showManual, starsLabel, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { arena, type Look } from './arena.ts';
import { Battle } from './battle.ts';
import { Sounds } from './sound.ts';
import { idle, Sim, SPECIAL, TICK, UPGRADES, upgradeCost, type Bot, type BotSpec, type Foe, type Kind, type SimEvent, type SpecialId, type WeaponId } from './sim.ts';
import { carList, carLoaded, loadCars, type Body } from './rig.ts';
import { World, type Pick } from './scene.ts';
import { FINISHES, HUES, SHADES, swatch, swatchName, type Livery } from './paint.ts';

interface Choice { id: string; name: string; about: string }
interface Stats { speed: number; armour: number; power: number; agility: number }
type BodyData = Body & { stats: Stats };

const device = await requireDevice();
const TEST = new URLSearchParams(location.search);
const { bodies: BODIES, weapons: WEAPONS, specials: SPECIALS } = await fetch('bots.json', { cache: 'no-store' })
  .then((r) => r.json() as Promise<{ bodies: BodyData[]; weapons: Choice[]; specials: Choice[] }>);
const CARS = await carList();
await loadCars([BODIES[0]]); // (the lobby's first; the rest as they're wanted)
const controls = await loadControls(['fight'] as const, ['fire', 'punch', 'shift', 'special', 'dodge'] as const);
const saves = gameSaves();
const rich = device.tier === 'heavy' && !device.tv; // (clear coats and flakes where there's power to spare)

// What each person has built, remembered for next time
interface Build { body: number; hue: number; shade: number; accent: number; finish: number; weapon: number; special: number }
const freshBuild = (slot: number): Build => ({ body: slot % BODIES.length, hue: [0, 8, 3, 5][slot % 4], shade: 2, accent: 12, finish: 1, weapon: 0, special: 0 });
interface Builder { build: Build; row: number; ready: boolean; robot: boolean; shopRow: number; shopped: boolean; owned: string[]; earned: Earned | null; best: Record<string, number> }
const input = new Input({ state: (): Builder => ({ build: freshBuild(0), row: 0, ready: false, robot: false, shopRow: 0, shopped: false, owned: [], earned: null, best: {} }) });
type Player = Pad<Builder>;

const ROWS = ['body', 'paint', 'shade', 'accent', 'finish', 'weapon', 'special'] as const;
type Row = typeof ROWS[number];
const ROW_NAME: Record<Row, string> = { body: 'Body', paint: 'Paint', shade: 'Shade', accent: 'Trim', finish: 'Finish', weapon: 'Weapon', special: 'Special' };
const accentOf = (hue: number) => swatch(hue, HUES[hue].h < 0 ? 4 : 1);
const liveryOf = (c: Player): Livery => ({ paint: swatch(c.build.hue, c.build.shade), accent: accentOf(c.build.accent), finish: FINISHES[c.build.finish].id, eyes: c.color });
const pickOf = (c: Player): Pick => ({ body: BODIES[c.build.body], livery: liveryOf(c), robot: c.robot });

// --- settings, chosen in the lobby --------------------------------------------------------------
const TERRAINS = [
  { id: 'quarry', name: 'Quarry', about: 'A gravel pit ringed by rock walls, boulders and pillars everywhere for cover.' },
  { id: 'desert', name: 'Desert canyon', about: 'Wide open red sand between huge mesas: room to drive, little to hide behind. The sand is loose.' },
  { id: 'city', name: 'Night city', about: 'Streets between tall blocks, parked cars and barriers to duck behind, under the street lamps.' },
  { id: 'snow', name: 'Snowfield', about: 'A frozen pass among the pines: robots keep their feet, cars slide round every turn.' },
];
const LEVELS = ['Easy', 'Normal', 'Hard'];
const settings = { terrain: 0, level: 1 };
const LOBBY_ROWS = ['terrain', 'level'] as const;
let lobbyRow = 0;

type Stage = 'lobby' | 'garage' | 'loading' | 'fight' | 'upgrade' | 'over' | 'paused';
let stage: Stage = 'lobby';
let sim: Sim | null = null;
let battle: Battle | null = null;
const botOf = new Map<string, Bot>(); // (each person's bot in this fight, by their id)
const world = new World($<HTMLCanvasElement>('world'), rich);
const sound = new Sounds();
const guard = new PerformanceGuard({ targetFps: device.tv ? 30 : 60, onStruggle: (level) => { if (level === 1) world.renderer.setPixelRatio(1); else world.renderer.shadowMap.enabled = false; world.resize(); } });
guard.watchCanvas(world.renderer.domElement);
(globalThis as { shiftBots?: unknown }).shiftBots = { world, input, get sim() { return sim; } }; // (for looking into it while testing)

// --- the lobby: one bot after another on the plinth, changing as it turns -----------------------------
let attract = { i: 0, t: 0 };
function attractPick(i: number): Pick {
  const hue = [0, 3, 8, 12, 5, 1][i % 6];
  return { body: BODIES[i % BODIES.length], livery: { paint: swatch(hue, hue === 12 ? 1 : 2), accent: accentOf(12), finish: FINISHES[i % 3].id, eyes: '#d7ff3b' }, robot: false };
}

function toLobby() {
  endFight();
  stage = 'lobby';
  for (const c of input.list) { c.ready = false; c.robot = false; }
  attract = { i: 0, t: 0 };
  world.garage([attractPick(0)], 0.17);
  show('lobby');
  renderLobby();
}

function toGarage() {
  endFight();
  stage = 'garage';
  for (const c of input.list) { c.ready = false; c.row = 0; }
  show('garage');
  garage();
}

function garage() {
  const list = players();
  if (!list.length) return toLobby();
  const bodies = list.map((c) => BODIES[c.build.body]);
  if (!bodies.every((b) => carLoaded(b.model))) { // (fetch the cars first, then come back)
    renderGarage();
    void loadCars(bodies).then(() => { if (stage === 'garage') garage(); });
    return;
  }
  world.garage(list.map(pickOf), list.length > 2 ? 0.2 : 0.16);
  renderGarage();
}

const players = () => [...input.list].sort((a, b) => a.slot - b.slot);

// --- people -------------------------------------------------------------------------------------------
async function loadBuild(c: Player) {
  c.build = freshBuild(c.slot);
  const saved = await saves.get<Partial<Build>>(playerKey(c));
  if (saved) c.build = { ...c.build, ...saved };
  const b = c.build;
  b.body %= BODIES.length; b.hue %= HUES.length; b.accent %= HUES.length; b.shade %= SHADES.length;
  b.finish %= FINISHES.length; b.weapon %= WEAPONS.length; b.special %= SPECIALS.length;
  if (stage === 'garage') garage();
  else renderLobby();
}
const saveBuild = (c: Player) => saves.set(playerKey(c), c.build);
// The finishes this person can use: the free ones, and those they've bought
const finishesOf = (c: Player) => FINISHES.map((f, i) => ({ ...f, i })).filter((f) => !f.shop || c.owned.includes(f.id));
async function loadOwned(c: Player) {
  c.owned = await ownedItems(c);
  c.best = (await saves.get<Record<string, number>>(playerKey(c, 'best'))) ?? {};
  if (!finishesOf(c).some((f) => f.i === c.build.finish)) c.build.finish = 0; // (not theirs: back to gloss)
  if (stage === 'garage') garage();
}

input.onJoin = (c) => {
  void loadBuild(c).then(() => loadOwned(c));
  if (stage === 'lobby') renderLobby();
};
input.onLeave = (c) => {
  if (stage === 'garage') garage();
  else if (stage === 'lobby') renderLobby();
  else { const b = botOf.get(c.id); if (b) b.ctl = idle(); } // (their bot stands still)
};
input.onPause = () => togglePause();
input.onRename = () => (stage === 'lobby' ? renderLobby() : renderGarage());

// --- input ----------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Shift Bots');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { lobbyRow = (lobbyRow + fy + LOBBY_ROWS.length) % LOBBY_ROWS.length; renderLobby(); }
    if (fx) {
      if (LOBBY_ROWS[lobbyRow] === 'terrain') settings.terrain = (settings.terrain + fx + TERRAINS.length) % TERRAINS.length;
      else settings.level = (settings.level + fx + LEVELS.length) % LEVELS.length;
      renderLobby();
    }
  }
  if (stage === 'upgrade' && !c.shopped && fy) { c.shopRow = (c.shopRow + fy + UPGRADES.length) % UPGRADES.length; renderShop(); }
  if (stage === 'garage' && !c.ready) {
    if (fy) { c.row = (c.row + fy + ROWS.length) % ROWS.length; renderGarage(); }
    if (fx) change(c, fx);
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (stage === 'lobby') {
      if (ev.bit === BIT.bolt) toGarage();
      else if (ev.bit === BIT.drop) backToHub();
      else if (ev.bit === BIT.star) howTo();
    } else if (stage === 'upgrade') {
      if (ev.bit === BIT.bolt && !c.shopped) shop(c);
      else if (ev.bit === BIT.drop) { c.shopped = !c.shopped; renderShop(); if (players().every((p) => p.shopped)) endBreak(); }
    } else if (stage === 'over') {
      if (ev.bit === BIT.bolt) void startFight();
      else if (ev.bit === BIT.drop) toGarage();
    } else if (stage === 'paused') {
      if (ev.bit === BIT.bolt) togglePause();
      else if (ev.bit === BIT.drop) toGarage();
    } else if (stage === 'garage') {
      if (ev.bit === BIT.bolt && !c.ready) toggleReady(c);
      else if (ev.bit === BIT.drop) (c.ready ? toggleReady(c) : toLobby());
      else if (ev.bit === BIT.leaf) { c.robot = !c.robot; world.transform(players().indexOf(c), c.robot); renderGarage(); }
      else if (ev.bit === BIT.star) howTo();
    }
  }
}

function change(c: Player, d: number) {
  const b = c.build, wrap = (v: number, n: number) => (v + d + n) % n;
  switch (ROWS[c.row]) {
    case 'body': b.body = wrap(b.body, BODIES.length); break;
    case 'paint': b.hue = wrap(b.hue, HUES.length); break;
    case 'shade': b.shade = wrap(b.shade, SHADES.length); break;
    case 'accent': b.accent = wrap(b.accent, HUES.length); break;
    case 'finish': { const list = finishesOf(c), at = Math.max(0, list.findIndex((f) => f.i === b.finish)); b.finish = list[(at + d + list.length) % list.length].i; break; }
    case 'weapon': b.weapon = wrap(b.weapon, WEAPONS.length); break;
    case 'special': b.special = wrap(b.special, SPECIALS.length); break;
  }
  void saveBuild(c);
  garage();
}

function toggleReady(c: Player) {
  c.ready = !c.ready;
  renderGarage();
  if (players().every((p) => p.ready)) void startFight();
}

// --- the fight -------------------------------------------------------------------------------------------
// The enemy: scouts drive the small quick cars, troopers the saloons, brutes the big ones, lancers the long
// grand tourers; the Hauler is the armoured off-roader, twice the size. All in gunmetal, eyes red.
const ENEMIES: Record<Foe, string[]> = {
  scout: ['sport-lp', 'azura', 'nfr'], trooper: ['thunderbolt', 'sedan', 'shc', 'kiri'], brute: ['suv', 'lightbody'],
  lancer: ['gt-coupe', 'cheetah'], hauler: ['wyvern'],
};
const FOE_NAME: Record<Foe, string> = { scout: 'Scout', trooper: 'Trooper', brute: 'Brute', lancer: 'Lancer', hauler: 'The Hauler' };
const FOE_WEAPON: Record<Foe, WeaponId> = { scout: 'blaster', trooper: 'blaster', brute: 'blaster', lancer: 'blaster', hauler: 'cannon' };
const GUNMETAL = ['#3a3d44', '#2b2f36', '#4a4440', '#30343c'];

function specOf(body: BodyData, id: string, name: string, side: 'us' | 'them', kind: Kind, weapon: WeaponId): BotSpec {
  return {
    id, name, side, kind, body: body.id, ...body.stats, weapon,
    shiftTime: body.robot.shift ?? 0.9, height: body.robot.height, length: CARS.find((c) => c.id === body.model)?.length ?? 4.6,
  };
}
const bodyById = (id: string) => BODIES.find((b) => b.id === id)!;

async function startFight() {
  const list = players();
  if (!list.length) return;
  stage = 'loading';
  show(null);
  callout('Rolling out', 'Loading the battleground');
  const enemyBodies = Object.values(ENEMIES).flat().map(bodyById);
  await loadCars([...list.map((c) => BODIES[c.build.body]), ...enemyBodies]);
  endFight();
  const specs = list.map((c) => ({ ...specOf(BODIES[c.build.body], c.id, c.label, 'us', 'player', WEAPONS[c.build.weapon].id as WeaponId),
    special: SPECIALS[c.build.special].id as SpecialId }));
  const enemies = Object.fromEntries((Object.keys(ENEMIES) as Foe[]).map((k) => [k, ENEMIES[k].map((id) => ({
    ...specOf(bodyById(id), id, FOE_NAME[k], 'them', k, FOE_WEAPON[k]), ...(k === 'hauler' ? { scale: 1.8 } : {}),
  }))])) as Record<Foe, BotSpec[]>;
  sim = new Sim(arena(TERRAINS[settings.terrain].id as Look), specs, settings.level, enemies);
  if (TEST.get('wave')) sim.startAt(Number(TEST.get('wave'))); // (testing: ?wave=5 starts at the fifth)
  for (const b of sim.humans) botOf.set(b.spec.id, b);
  const liveries = new Map(list.map((c) => [c.id, liveryOf(c)]));
  battle = new Battle(world.renderer, rich, (b) => bodyById(b.spec.body), (b) => liveries.get(b.spec.id) ?? enemyLivery(b));
  await battle.setup(sim.arena);
  battle.setViews(sim.humans);
  for (const c of list) c.ready = false;
  stage = 'fight';
  acc = 0;
  buildHud();
  show('hud');
  callout('Get ready', 'They\'re coming');
}

function enemyLivery(b: Bot): Livery {
  let h = 0;
  for (const ch of b.spec.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  if (b.spec.kind === 'hauler') return { paint: '#1d1f24', accent: '#b01818', finish: 'metallic', eyes: '#ff2a2a' };
  return { paint: GUNMETAL[Math.abs(h) % GUNMETAL.length], accent: '#8a1c1c', finish: 'metallic', eyes: '#ff2a2a' };
}

function endFight() {
  battle?.dispose();
  battle = null;
  sim = null;
  botOf.clear();
}

function togglePause() {
  if (stage === 'fight') { stage = 'paused'; show('pause'); }
  else if (stage === 'paused') { stage = 'fight'; show('hud'); }
}

// A person's stick, turned to match their camera (up is away from it), and their buttons
function fightInput(c: Player) {
  if (manualPadInput(c)) return;
  const b = botOf.get(c.id);
  if (!b || !battle) { c.drain(); return; }
  const yaw = battle.camYaw(b), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const x = Math.abs(c.x) < 0.12 ? 0 : c.x, y = Math.abs(c.y) < 0.12 ? 0 : c.y;
  b.ctl.x = fx * y - fz * x;
  b.ctl.z = fz * y + fx * x;
  // as a car (or changing into one), it's driven like the racing games: across steers, up is the gas, back brakes and reverses
  const asCar = b.target === 0 || b.shift <= 0;
  // (Fire on its own is the boost, flat out ahead)
  const boost = controls.held(c, 'fight', 'fire') && Math.abs(y) < 0.2;
  b.ctl.drive = asCar ? { steer: Math.sign(x) * Math.abs(x) ** 1.3, gas: boost ? 1 : y } : undefined;
  b.ctl.fire = controls.held(c, 'fight', 'fire');
  b.ctl.run = c.held(BIT.sprint); // (the stick pushed past its ring, or Shift)
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    const a = controls.action('fight', ev.bit);
    if (a === 'punch') b.ctl.punch = true;
    else if (a === 'shift') b.ctl.shift = true;
    else if (a === 'dodge') b.ctl.dodge = true;
    else if (a === 'special') b.ctl.special = true;
  }
}

// What happened in the fight, for the people: callouts, buzzes, the end
function react(e: SimEvent) {
  battle?.react(e);
  if (sim) {
    // (heard from the nearest of you)
    const where = 'bot' in e && e.bot ? e.bot : 'x' in e ? e : null, us = sim.humans;
    const dist = where ? Math.min(...us.map((h) => Math.hypot(h.x - where.x, h.z - where.z))) : 0;
    const mine = 'bot' in e && !!e.bot && e.bot.spec.side === 'us';
    sound.play(e, dist, mine, 'bot' in e && e.bot ? e.bot.spec.shiftTime : 0.8);
  }
  const person = (b: Bot) => input.list.find((c) => c.id === b.spec.id);
  switch (e.t) {
    case 'wave': callout(e.boss ? 'The Hauler' : `Wave ${e.n}`, e.boss ? `Wave ${e.n}: bring it down` : `${sim!.remaining} coming in`); break;
    case 'cleared': startBreak(e.n); break;
    case 'revived': { const c = person(e.bot); if (c) input.buzz(c, 200); callout(`${e.bot.spec.name} is back up`); break; }
    case 'hit': if (e.bot?.spec.side === 'us') { const c = person(e.bot); if (c) input.buzz(c, 30); } break;
    case 'ram': { const c = person(e.bot) ?? person(e.by); if (c) input.buzz(c, 120); break; }
    case 'down': { const c = person(e.bot); if (c) input.buzz(c, 500); callout(`${e.bot.spec.name} is down`, sim!.humans.length > 1 ? 'Stand by them to get them up' : 'Hold on'); break; }
    case 'over': endOfFight(); break;
  }
}

// --- between waves: spending scrap ----------------------------------------------------------------------
// The fight holds still while everyone picks their upgrades on their phone (▲▼ choose, Bolt buy, Drop
// done); it carries on when you're all done, or after half a minute
const BREAK_TIME = 30;
let breakLeft = 0;
function startBreak(n: number) {
  stage = 'upgrade';
  breakLeft = BREAK_TIME;
  for (const c of input.list) { c.shopped = false; c.shopRow = 0; }
  callout(`Wave ${n} cleared`, 'Spend your scrap');
  show('shop');
  renderShop();
}

function shop(c: Player) {
  const b = botOf.get(c.id);
  if (!b || !sim) return;
  if (sim.buy(b, UPGRADES[c.shopRow].id)) input.buzz(c, 40);
  renderShop();
}

function endBreak() {
  if (stage !== 'upgrade' || !sim) return;
  stage = 'fight';
  sim.breakT = 3;
  show('hud');
}

function renderShop() {
  if (!battle || !sim) return;
  $('shopTime').textContent = `${Math.ceil(breakLeft)} s`;
  $('shopViews').innerHTML = battle.views.map((v) => {
    const r = v.rect, c = input.list.find((p) => p.id === v.bot.spec.id), b = v.bot;
    if (!c) return '';
    return `<div class="bay" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="card panel small shop">
        <div class="head">${chip(c)}<span class="ready ${c.shopped ? 'on' : ''}">${c.shopped ? 'Done' : `${b.scrap} scrap`}</span></div>
        <div class="rows">${UPGRADES.map((u, i) => {
          const cost = upgradeCost(b.up[u.id]), can = b.scrap >= cost;
          return `<div class="row ${i === c.shopRow && !c.shopped ? 'sel' : ''} ${can ? '' : 'dim'}"><span class="k">${u.name} ${'●'.repeat(b.up[u.id])}</span>
            <span class="v"><b>${cost}</b></span><span class="about faint">${u.about}</span></div>`;
        }).join('')}</div>
        <p class="faint" style="margin:0">${glyph('bolt')} Buy · ${glyph('drop')} Done</p>
      </div></div>`;
  }).join('');
}

function endOfFight() {
  if (!sim) return;
  stage = 'over';
  const wave = sim.wave, where = TERRAINS[settings.terrain].id;
  // stars for everyone who fought; more for getting further on this battleground than ever before
  for (const b of sim.humans) {
    const c = input.list.find((p) => p.id === b.spec.id);
    if (!c) continue;
    const why: EarnFor[] = ['played'];
    if (wave > (c.best[where] ?? 0) && wave > 1) { why.push('record'); c.best[where] = wave; void saves.set(playerKey(c, 'best'), c.best); }
    c.earned = null;
    earnStars(c, why).then((got) => { c.earned = got; if (stage === 'over') renderResults(); });
  }
  renderResults();
  show('results');
}

function renderResults() {
  if (!sim) return;
  const wave = sim.wave, where = TERRAINS[settings.terrain].id;
  $('resultsWhere').textContent = TERRAINS[settings.terrain].name;
  $('resultsTitle').textContent = wave > 1 ? `You held out to wave ${wave}` : 'Overrun in the first wave';
  $('resultsList').innerHTML = sim.humans.map((b) => {
    const c = input.list.find((p) => p.id === b.spec.id);
    const best = c?.best[where] ?? 0, earned = c?.earned?.earned ? ` · +${starsLabel(c.earned.earned)}` : '';
    return `<div class="standing">${c ? chip(c) : escapeHtml(b.spec.name)}<span>${escapeHtml(bodyById(b.spec.body).name)}<span class="faint"> · best here: wave ${best}${earned}</span></span>
      <span class="num">${b.kills} <small>wrecked</small></span><span class="num">${b.scrap} <small>scrap</small></span></div>`;
  }).join('');
}

addEventListener('pointerdown', () => sound.unlock());
addEventListener('keydown', (e) => {
  sound.unlock();
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter' && stage === 'lobby') toGarage();
  else if (code === 'KeyP' || (code === 'Escape' && (stage === 'fight' || stage === 'paused'))) togglePause();
  else if (code === 'Escape') (stage === 'lobby' ? backToHub() : toLobby());
});

// --- the phones -----------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Shift Bots', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  if (stage === 'lobby') return { ...base, labels: { bolt: 'Build', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
  if (stage === 'loading') return { ...base, labels: {}, hint: 'Rolling out…' };
  if (stage === 'over') return { ...base, labels: { bolt: 'Again', drop: 'Garage' }, hint: 'Fight over' };
  if (stage === 'upgrade') {
    const b = botOf.get(c.id);
    return c.shopped ? { ...base, labels: { drop: 'Back' }, hint: 'Done. Waiting for the others' }
      : { ...base, labels: { bolt: 'Buy', drop: 'Done' }, hint: `▲▼ choose · ${b?.scrap ?? 0} scrap` };
  }
  if (stage === 'paused') return { ...base, labels: { bolt: 'Resume', drop: 'Garage' }, hint: 'Paused' };
  if (stage === 'fight') {
    const b = botOf.get(c.id);
    if (!b) return { ...base, labels: {}, hint: 'You join the next fight' };
    if (b.down) return { ...base, layout: 'stick', labels: {}, hint: sim && sim.humans.length > 1 ? 'Down: a friend can get you up' : 'Down' };
    const labels = controls.labels('fight');
    const car = b.target === 0, special = b.spec.special ? SPECIAL[b.spec.special].name : '';
    return { ...base, layout: 'stick', labels: car ? { bolt: 'Boost', leaf: 'Robot' } : { ...labels, leaf: 'Car', star: b.special >= 1 ? special : `${special} ${Math.floor(b.special * 100)}%` },
      hint: `${car ? 'Car' : 'Robot: push all the way to run'} · armour ${Math.round((b.hp / b.maxHp) * 100)}%` };
  }
  return c.ready
    ? { ...base, labels: { drop: 'Change' }, hint: 'Ready. Waiting for the others' }
    : { ...base, labels: { bolt: 'Ready', drop: 'Back', leaf: c.robot ? 'Car' : 'Robot', star: 'How to play' }, hint: `▲▼ ${ROW_NAME[ROWS[c.row]].toLowerCase()} · ◀▶ change` };
}

// --- screens ----------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'garage' | 'hud' | 'shop' | 'results' | 'pause' | null) {
  for (const id of ['lobby', 'garage', 'hud', 'shop', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !((screen === 'pause' || screen === 'shop') && id === 'hud'));
}

// One box per view in the fight: who, their armour, as a car the boost; the wave across the top
function buildHud() {
  if (!battle) return;
  $('views').innerHTML = battle.views.map((v, i) => {
    const r = v.rect, c = input.list.find((p) => p.id === v.bot.spec.id);
    return `<div class="view" id="view${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="me">${c ? chip(c) : ''}<span class="mode"></span></div>
      <div class="downed hidden"></div>
      <div class="bars"><div class="bar armour"><b></b></div><div class="bar boost"><b></b></div><div class="bar special"><b></b><span></span></div></div>
      <div class="scrap"></div><canvas class="radar" width="200" height="200"></canvas></div>`;
  }).join('');
}

// The radar in the corner of each view: turned so your camera's forward is up; you in the middle, your
// team in their colours, the enemy red (the Hauler bigger), scrap, the rocks near you and the edge of the
// battleground; an arrow on its rim to the nearest enemy when there's none on it
const RADAR = 75; // m from the middle to the rim
function drawRadars() {
  if (!sim || !battle) return;
  battle.views.forEach((v, i) => {
    const cv = document.querySelector<HTMLCanvasElement>(`#view${i} .radar`);
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const W = cv.width, R = W / 2 - 6, me = v.bot, yaw = battle!.camYaw(me), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const at = (x: number, z: number): [number, number] => {
      const dx = x - me.x, dz = z - me.z;
      return [W / 2 + ((-fz * dx + fx * dz) / RADAR) * R, W / 2 - ((fx * dx + fz * dz) / RADAR) * R];
    };
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,12,18,0.72)'; g.fill();
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (const k of [0.33, 0.66]) { g.beginPath(); g.arc(W / 2, W / 2, R * k, 0, Math.PI * 2); g.stroke(); }
    // the edge of the battleground
    const [cx, cy] = at(0, 0);
    g.beginPath(); g.arc(cx, cy, (sim!.arena.radius / RADAR) * R, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (const r of sim!.arena.rocks) {
      if (Math.hypot(r.x - me.x, r.z - me.z) > RADAR + r.r) continue;
      const [x, y] = at(r.x, r.z), s = Math.max(1.5, (r.r / RADAR) * R);
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#d7ff3b';
    for (const d of sim!.drops) { const [x, y] = at(d.x, d.z); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
    let nearest: Bot | null = null, nd = Infinity;
    for (const b of sim!.foes) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (d < nd) { nd = d; nearest = b; }
      if (d > RADAR) continue;
      const [x, y] = at(b.x, b.z), boss = b.spec.kind === 'hauler';
      g.fillStyle = '#ff4433'; g.beginPath(); g.arc(x, y, boss ? 7 : 3.5, 0, Math.PI * 2); g.fill();
    }
    for (const b of sim!.humans) {
      if (b === me) continue;
      const c = input.list.find((p) => p.id === b.spec.id), [x, y] = at(b.x, b.z);
      g.fillStyle = b.down ? '#888' : c?.color ?? '#fff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // you: an arrowhead the way you're facing
    const face = me.yaw - yaw;
    g.save(); g.translate(W / 2, W / 2); g.rotate(-face);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
    // the nearest enemy, off the radar: an arrow on the rim and how far
    if (nearest && nd > RADAR) {
      const [x, y] = at(nearest.x, nearest.z), a = Math.atan2(y - W / 2, x - W / 2);
      g.save(); g.translate(W / 2 + Math.cos(a) * (R - 8), W / 2 + Math.sin(a) * (R - 8)); g.rotate(a);
      g.fillStyle = '#ff4433'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -7); g.lineTo(-6, 7); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = '#ff8a80'; g.font = '600 14px Inter, sans-serif'; g.textAlign = 'center';
      g.fillText(`${Math.round(nd)} m`, W / 2 + Math.cos(a) * (R - 30), W / 2 + Math.sin(a) * (R - 30) + 5);
    }
    g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2; g.stroke();
  });
}

function updateHud() {
  if (!sim || !battle) return;
  const together = sim.humans.length > 1;
  $('wave').innerHTML = sim.wave ? `<b>Wave ${sim.wave}</b><span>${sim.remaining} left</span>` : '<b>Get ready</b>';
  const boss = sim.boss;
  $('boss').classList.toggle('hidden', !boss);
  if (boss) ($('boss').querySelector('b') as HTMLElement).style.width = `${(boss.hp / boss.maxHp) * 100}%`;
  battle.views.forEach((v, i) => {
    const el = document.getElementById(`view${i}`);
    if (!el) return;
    const b = v.bot;
    (el.querySelector('.armour b') as HTMLElement).style.width = `${(b.hp / b.maxHp) * 100}%`;
    el.querySelector('.armour')!.classList.toggle('low', b.hp < b.maxHp * 0.3);
    (el.querySelector('.boost b') as HTMLElement).style.width = `${b.boost * 100}%`;
    el.querySelector('.boost')!.classList.toggle('hidden', b.target !== 0);
    el.querySelector('.mode')!.textContent = b.down ? 'Down' : b.changing ? 'Changing' : b.car ? 'Car' : 'Robot';
    el.querySelector('.scrap')!.textContent = `${b.scrap} scrap · ${b.kills} wrecked`;
    const sp = el.querySelector('.special')!;
    (sp.querySelector('b') as HTMLElement).style.width = `${b.special * 100}%`;
    sp.classList.toggle('full', b.special >= 1);
    sp.querySelector('span')!.textContent = b.spec.special ? SPECIAL[b.spec.special].name : '';
    const downed = el.querySelector('.downed')!;
    downed.classList.toggle('hidden', !b.down);
    if (b.down) downed.textContent = together ? (b.revive > 0 ? `Getting back up… ${Math.floor(b.revive * 100)}%` : 'Down: a friend can get you up') : 'Down';
  });
}

function renderLobby() {
  const people = players();
  $('players').innerHTML = people.length
    ? people.map((c) => `<div class="player">${chip(c)}<span class="caption faint">${escapeHtml(BODIES[c.build.body].name)}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to build your bot. One to four of you, all on the same side.</p>';
  const value = { terrain: TERRAINS[settings.terrain].name, level: LEVELS[settings.level] };
  const label = { terrain: 'Battleground', level: 'Difficulty' };
  $('settings').innerHTML = LOBBY_ROWS.map((r, i) => `<div class="setting ${i === lobbyRow ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value[r])}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  $('terrainAbout').textContent = TERRAINS[settings.terrain].about;
}

// Each person's card over their bay: the rows they're choosing from, and the bot's numbers
function renderGarage() {
  const list = players();
  const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.08, Math.min(1, (v - 0.6) / 0.9)) * 100)}%"></b></i></div>`;
  $('bays').innerHTML = world.bays.map((bay, i) => {
    const c = list[i];
    if (!c) return '';
    const b = c.build, body = BODIES[b.body], r = bay.rect;
    const row = (key: Row, value: string, extra = '') => `<div class="row ${ROWS[c.row] === key && !c.ready ? 'sel' : ''}">
      <span class="k">${ROW_NAME[key]}</span><span class="v"><span class="glyph glyph-key">◀</span><b>${value}</b><span class="glyph glyph-key">▶</span></span>${extra}</div>`;
    const swatches = (n: number, at: number, colour: (j: number) => string) =>
      `<div class="swatches">${Array.from({ length: n }, (_, j) => `<i class="${j === at ? 'on' : ''}" style="background:${colour(j)}"></i>`).join('')}</div>`;
    return `<div class="bay" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%">
      <div class="card panel ${list.length > 1 ? 'small' : ''}">
        <div class="head">${chip(c)}<span class="ready ${c.ready ? 'on' : ''}">${c.ready ? 'Ready' : `${glyph('leaf')} ${c.robot ? 'Car' : 'Robot'}`}</span></div>
        <h2>${escapeHtml(body.name)}</h2>
        <div class="stats">${bar('Speed', body.stats.speed)}${bar('Armour', body.stats.armour)}${bar('Power', body.stats.power)}${bar('Agility', body.stats.agility)}${bar('Change', 2.1 - (body.robot.shift ?? 0.9))}</div>
        <div class="rows">
          ${row('body', escapeHtml(body.name))}
          ${row('paint', escapeHtml(swatchName(b.hue, b.shade)), swatches(HUES.length, b.hue, (j) => swatch(j, b.shade)))}
          ${row('shade', SHADES[b.shade], swatches(SHADES.length, b.shade, (j) => swatch(b.hue, j)))}
          ${row('accent', escapeHtml(HUES[b.accent].h < 0 ? 'Black' : HUES[b.accent].name), swatches(HUES.length, b.accent, accentOf))}
          ${row('finish', FINISHES[b.finish].name, finishesOf(c).length < FINISHES.length ? '<span class="faint more">More finishes in the shop on your phone</span>' : '')}
          ${row('weapon', escapeHtml(WEAPONS[b.weapon].name))}
          ${row('special', escapeHtml(SPECIALS[b.special].name))}
        </div>
        <p class="muted about">${escapeHtml(aboutRow(c))}</p>
        <p class="faint credit">${escapeHtml(creditOf(body))}</p>
      </div></div>`;
  }).join('');
}

// Who made the car (CC BY: their name goes with it)
function creditOf(body: Body) {
  const c = CARS.find((x) => x.id === body.model)?.credit;
  return c ? `Car: "${c.title}" by ${c.by} (${c.licence.replace(/ \(.*\)$/, '')})` : '';
}

// What the row being changed means
function aboutRow(c: Player) {
  const b = c.build;
  switch (ROWS[c.row]) {
    case 'finish': return FINISHES[b.finish].about;
    case 'weapon': return WEAPONS[b.weapon].about;
    case 'special': return SPECIALS[b.special].about;
    default: return BODIES[b.body].about;
  }
}

let calloutTimer = 0;
function callout(big: string, small = '') {
  $('callout').innerHTML = `<div class="big">${escapeHtml(big)}</div>${small ? `<div class="eyebrow">${escapeHtml(small)}</div>` : ''}`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = window.setTimeout(() => $('callout').classList.remove('show'), 2400);
}

// --- the loop ---------------------------------------------------------------------------------------------
const MIN_FRAME = 1000 / (device.tv ? 30 : 60) - 1;
let last = performance.now(), padT = 0, hudT = 0, acc = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'fight' ? fightInput(c) : menuInput(c));
  if (stage === 'upgrade') {
    breakLeft -= dt;
    if (breakLeft <= 0) endBreak();
  }
  if (stage === 'fight' && sim) {
    acc += dt;
    while (acc >= TICK) { sim.step(); for (const e of sim.events) react(e); acc -= TICK; }
  }
  if (stage === 'lobby') {
    // every few seconds: stand up, fold back down, and on to the next bot
    attract.t += dt;
    const rig = world.bays[0]?.rig;
    if (rig && attract.t > 3.2 && attract.t < 7.4) rig.transform(1);
    if (rig && attract.t > 7.4) rig.transform(0);
    const next = attractPick(attract.i + 1);
    if (attract.t > 6 && !carLoaded(next.body.model)) void loadCars([next.body]); // (fetched while this one shows)
    if (attract.t > 9.8 && carLoaded(next.body.model)) { attract = { i: attract.i + 1, t: 0 }; world.garage([next], 0.17); }
  }
  if (stage === 'fight' && sim) sound.drive(sim.humans.filter((b) => b.alive).map((b) => ({ id: b.spec.id, speed: b.speed, car: 1 - b.shift, boosting: b.boosting })));
  else sound.silence();
  if (battle && sim && (stage === 'fight' || stage === 'upgrade' || stage === 'paused' || stage === 'over')) battle.render(stage === 'fight' || stage === 'upgrade' ? dt : 0, sim);
  else world.render(dt);
  hudT += dt;
  if (stage === 'fight' || stage === 'upgrade') drawRadars();
  if (hudT > 0.1 && (stage === 'fight' || stage === 'upgrade')) { hudT = 0; updateHud(); if (stage === 'upgrade') $('shopTime').textContent = `${Math.ceil(breakLeft)} s`; }
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
  guard.frame(now);
}

// --- start --------------------------------------------------------------------------------------------------
addEventListener('resize', () => { world.resize(); battle?.resize(); if (stage === 'garage') renderGarage(); });
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('back').innerHTML = `${glyph('drop')} Games`;
$('start').innerHTML = `${glyph('bolt')} Build your bot`;
$('howto').innerHTML = `${glyph('star')} How to play`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', toGarage);
$('howto').addEventListener('click', howTo);
$('again').innerHTML = `${glyph('bolt')} Fight again`;
$('toGarage').innerHTML = `${glyph('drop')} Garage`;
$('again').addEventListener('click', () => void startFight());
$('toGarage').addEventListener('click', toGarage);
$('pauseLegend').innerHTML = `<span>${glyph('bolt')} Resume</span><span>${glyph('drop')} Back to the garage</span>`;
document.body.classList.toggle('tv', device.tv);
sound.unlock(); // (works straight away in the TV app; elsewhere, on the first click or key)

if (TEST.has('showroom')) {
  // every body at once, as cars or robots or anywhere between (?showroom&t=0.5&only=2&yaw=0.6)
  const only = TEST.get('only'), list = only ? [BODIES[+only]] : BODIES;
  await loadCars(list);
  world.showroom(list, (i) => attractPick(only ? +only : i).livery, Number(TEST.get('t') ?? 0), Number(TEST.get('yaw') ?? 0.7));
  show(null);
  stage = 'garage';
} else toLobby();
world.resize();
requestAnimationFrame(frame);
