// Fireteam: the game flow. Lobby (with the squads fighting behind it), the briefing (the map, the plan),
// each step of the mission with its orders over the radio, the fighting (each player in his own view),
// retrying from the checkpoint when everyone's down, and the results. The rules are in sim.ts, the
// battlefield in map.ts, the drawing in scene.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, PerformanceGuard, playerKey, requireDevice, showManual, starsLabel,
  type Earned, type Pad, type PadScreen,
} from '@platform';
import { Gun } from '@armoury/armoury.ts';
import { BUILDINGS, FIELDS, Goal, Ground, height, Line, LZ, MAP, MISSION, OPERATION, PILOT, ROAD, RUNS, START, TRACK, type Step } from './map.ts';
import { Life, LOADOUTS, ORDER_NAME, Side, Sim, TICK, WEAPONS, type SimEvent, type Soldier } from './sim.ts';
import { loadWorld, View } from './scene.ts';
import { Sounds } from './sound.ts';

const device = await requireDevice();
const controls = await loadControls(['fight'] as const, ['fire', 'grenade', 'crouch', 'order', 'reload', 'swap', 'nvg'] as const);
const saves = gameSaves();
const MAX_PLAYERS = 4;
const TEST = new URLSearchParams(location.search); // (for testing: ?step=4 starts at the fourth step)

interface PlayerRecord { name: string; missions: number; won: number; kills: number; best: number }
const freshRecord = (name: string): PlayerRecord => ({ name, missions: 0, won: 0, kills: 0, best: 0 });

type PlayerState = { record: PlayerRecord | null; earned: Earned | null; gun: number; leafT: number; armed: { bit: number; swipe: boolean } | null };
const input = new Input({ state: (): PlayerState => ({ record: null, earned: null, gun: 0, leafT: -1, armed: null }) });
type Player = Pad<PlayerState>;

const settings = { mates: 2, start: Math.max(0, Math.min(MISSION.length - 1, (Number(TEST.get('step')) || 1) - 1)) };
const ROWS = ['mates', 'start'] as const;
let row = 0;

type Stage = 'lobby' | 'plan' | 'briefing' | 'fighting' | 'failed' | 'results' | 'paused';
let stage: Stage = 'lobby';
let resumeTo: Stage = 'fighting';
let stageT = 0;
let sim: Sim;
let demo = true;
const BRIEF_TIME = 3.5;
const players = new Map<string, Player>();

const world = await loadWorld();
const view = new View($<HTMLCanvasElement>('view'), world);
const sound = new Sounds();
const guard = new PerformanceGuard({ targetFps: 45, onStruggle: (level) => { if (level === 1) view.renderer.setPixelRatio(1); else view.renderer.shadowMap.enabled = false; view.layout(); } });
guard.watchCanvas($<HTMLCanvasElement>('view'));

const gunOf = (c: Player) => LOADOUTS[c.gun % LOADOUTS.length];
(globalThis as { fireteam?: unknown }).fireteam = { get sim() { return sim; }, view }; // (for looking into it while testing)

// --- flow ---------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  demo = true;
  sim = new Sim([{ id: 'demo1', name: 'Hollis', gun: Gun.Carbine, cast: 0 }, { id: 'demo2', name: 'Baker', gun: Gun.Carbine, cast: 3 }], 2, Math.floor(Math.random() * 4));
  view.setEyes([]);
  show('lobby');
  renderLobby();
  sound.ambience(false);
  globalThis.speechSynthesis?.cancel();
}

function start() {
  sound.unlock();
  demo = false;
  players.clear();
  const crew = input.list.slice(0, MAX_PLAYERS);
  for (const c of crew) players.set(c.id, c);
  sim = new Sim(crew.map((c) => ({ id: c.id, name: c.label, gun: gunOf(c), cast: c.slot })), settings.mates, settings.start);
  view.setEyes(sim.humans.map((s) => s.human!));
  for (const s of sim.humans) view.setNvg(s.human!, sim.dark > 0.6);
  // the briefing first (from the start of the mission), else straight in
  if (settings.start === 0) { stage = 'plan'; stageT = 0; renderPlan(); show('briefing'); }
  else { brief(); show('hud'); }
  sound.ambience(true);
}

function brief() {
  stage = 'briefing';
  stageT = 0;
  const st = MISSION[sim.step];
  callout(st.title, `Step ${sim.step + 1} of ${MISSION.length}`, st.about, 4800);
  radio(st.radio.start);
}

function finish(won: boolean) {
  stage = 'results';
  sound.ambience(false);
  for (const c of players.values()) {
    const s = sim.soldiers.find((q) => q.human === c.id);
    const r = c.record ?? freshRecord(c.label);
    r.name = c.label; r.missions++; if (won) r.won++; r.kills += s?.kills ?? 0; r.best = Math.max(r.best, s?.kills ?? 0);
    c.record = r;
    saves.set(playerKey(c), r);
    c.earned = null;
    earnStars(c, won ? ['played', 'won'] : ['played']).then((e) => { c.earned = e; if (stage === 'results') renderResults(won); });
  }
  renderResults(won);
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = resumeTo; show('hud'); }
  else if (stage === 'briefing' || stage === 'fighting') { resumeTo = stage; stage = 'paused'; show('pause'); }
}

async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  c.gun = 0;
  if (stage === 'lobby') renderLobby();
}

input.onJoin = (c) => {
  loadRecord(c);
  if (!demo && (stage === 'fighting' || stage === 'briefing') && sim.humans.length < MAX_PLAYERS && !sim.humans.some((s) => s.human === c.id)) {
    sim.join({ id: c.id, name: c.label, gun: gunOf(c), cast: c.slot });
    players.set(c.id, c);
    view.setEyes(sim.humans.map((s) => s.human!));
  }
  if (stage === 'lobby') renderLobby();
};
input.onLeave = (c) => {
  if (!demo) { sim.leave(c.id); view.setEyes(sim.humans.map((s) => s.human!)); }
  if (stage === 'lobby') renderLobby();
};
input.onRename = () => { if (stage === 'lobby') renderLobby(); };
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Fireteam');

function menuInput(c: Player) {
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
    else if (ev.bit === BIT.leaf && stage === 'lobby') { c.gun = (c.gun + 1) % LOADOUTS.length; renderLobby(); }
  }
}

function change(d: number) {
  if (ROWS[row] === 'mates') settings.mates = Math.max(0, Math.min(3, settings.mates + d));
  else settings.start = (settings.start + d + MISSION.length) % MISSION.length;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby' || stage === 'results') start();
  else if (stage === 'plan') { brief(); show('hud'); }
  else if (stage === 'paused') togglePause();
  else if (stage === 'failed') { sim.retry(); brief(); show('hud'); }
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused' || stage === 'failed' || stage === 'plan') toLobby();
}

const LEAF_TAP = 0.3; // s: shorter is a tap (crouch / stand), longer is held (set the charge)

function fightInput(c: Player, dt: number) {
  const s = sim.soldiers.find((q) => q.human === c.id);
  const act = (a: string | null) => {
    if (!s || !a) return;
    if (a === 'grenade') s.throwNow = true;
    else if (a === 'reload') s.reloadNow = true;
    else if (a === 'swap') s.swapNow = true;
    else if (a === 'order') sim.cycleOrder(s);
    else if (a === 'nvg') { view.setNvg(c.id, !view.nvg(c.id)); sound.nvg(view.nvg(c.id)); }
  };
  for (const ev of c.drain()) {
    sound.unlock();
    if (ev.bit === BIT.sprint) continue;
    if (ev.bit === BIT.swipe) { if (ev.down && c.armed) c.armed.swipe = true; continue; }
    if (ev.down) {
      // a button with a swipe variant waits for its release, to see if it was swiped
      if (controls.hasSwipe('fight', ev.bit)) { c.armed = { bit: ev.bit, swipe: c.held(BIT.swipe) }; continue; }
      const a = controls.action('fight', ev.bit);
      if (a === 'crouch') c.leafT = 0;
      else act(a);
    } else if (c.armed && c.armed.bit === ev.bit) {
      act(controls.action('fight', ev.bit, c.armed.swipe));
      c.armed = null;
    } else if (controls.action('fight', ev.bit) === 'crouch') {
      if (s && c.leafT >= 0 && c.leafT < LEAF_TAP) sim.toggleCrouch(s);
      c.leafT = -1;
    }
  }
  if (!s) return;
  if (c.leafT >= 0) c.leafT += dt;
  s.useHeld = c.leafT >= LEAF_TAP;
  // the stick moves him the way his camera looks: up is ahead, right is to its right
  const yaw = view.camYaw(c.id);
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);
  s.moveX = fx * c.y - fz * c.x;
  s.moveZ = fz * c.y + fx * c.x;
  s.sprint = c.held(BIT.sprint);
  s.firing = controls.held(c, 'fight', 'fire');
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  sound.unlock();
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' || stage === 'failed' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});
addEventListener('pointerdown', () => sound.unlock());

// --- the demo behind the menu: the computer plays the players' part ---------------------------------------
const demoPaths = new Map<Soldier, { x: number; z: number }[]>();
function demoPilot(h: Soldier) {
  if (!h.alive) return;
  const st = sim.current;
  if (!st) return;
  let goal: { x: number; z: number } = objectiveAt(st);
  const foes = sim.axisAlive();
  if ((st.goal === Goal.Clear || st.goal === Goal.Rescue) && foes.length) goal = foes.reduce((a, b) => (Math.hypot(a.x - h.x, a.z - h.z) < Math.hypot(b.x - h.x, b.z - h.z) ? a : b));
  let p = demoPaths.get(h);
  if (!p || !p.length || Math.random() < 0.01) { p = sim.grid.path(h.x, h.z, goal.x, goal.z) ?? []; demoPaths.set(h, p); }
  if (p.length && Math.hypot(p[0].x - h.x, p[0].z - h.z) < 0.8) p.shift();
  const nx = p.length ? p[0].x - h.x : 0, nz = p.length ? p[0].z - h.z : 0, d = Math.hypot(nx, nz) || 1;
  const stop = !!h.target && Math.random() < 0.97 || (st.goal === Goal.Hold && Math.hypot(goal.x - h.x, goal.z - h.z) < 8);
  h.moveX = stop ? 0 : nx / d; h.moveZ = stop ? 0 : nz / d;
  h.firing = !!h.target;
  h.crouched = !!h.target;
  h.useHeld = st.goal === Goal.Destroy;
}

// Where a step sends you (the marker on the screen)
function objectiveAt(st: Step) {
  if (st.goal === Goal.Rescue) return sim.pilot ? { x: sim.pilot.x, z: sim.pilot.z } : { x: PILOT.x, z: PILOT.z };
  if (st.goal === Goal.Clear) return { x: st.zone!.x, z: st.zone!.z };
  return { x: st.at.x, z: st.at.z };
}

// --- the phones -------------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { label: c.tag, color: c.color, title: 'Fireteam', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, layout: 'dpad', labels: { bolt: 'Start', drop: 'Games', star: 'How to play', leaf: WEAPONS[gunOf(c)].name }, hint: `▲▼ choose · ◀▶ change · Leaf: your rifle` };
    case 'plan': return { ...base, layout: 'dpad', labels: { bolt: 'Move out', drop: 'Lobby' }, hint: OPERATION.name };
    case 'results': return { ...base, layout: 'dpad', labels: { bolt: 'Again', drop: 'Lobby' }, hint: sim.won ? 'Mission done' : 'Mission over' };
    case 'paused': return { ...base, layout: 'dpad', labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    case 'failed': return { ...base, layout: 'dpad', labels: { bolt: 'Retry', drop: 'Lobby' }, hint: failWhy };
    default: {
      const s = sim.soldiers.find((q) => q.human === c.id);
      if (!s) return { ...base, layout: 'stick', labels: {}, hint: 'The squads are full: you fight next time' };
      const hint = s.life === Life.Down ? `Down: a friend can help you up (${Math.ceil(s.downT)}s)` : s.life === Life.Dead ? 'Out of the fight'
        : `${s.weapon.name} ${s.reloadT > 0 ? 'reloading' : `${s.ammo}/${s.weapon.mag}`} · grenades ${s.grenades} · squad: ${ORDER_NAME[s.order]}`;
      return { ...base, layout: 'stick', labels: controls.labels('fight'), hint };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause' | 'failed' | 'briefing') {
  for (const id of ['lobby', 'hud', 'results', 'pause', 'failed', 'briefing']) {
    const keep = (screen === 'pause' || screen === 'failed') && id === 'hud';
    $(id).classList.toggle('hidden', id !== screen && !keep);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.missions ? 'First mission' : `${plural(r.won, 'mission done', 'missions done')} · ${plural(r.kills, 'enemy', 'enemies')} down`;

function renderLobby() {
  const people = input.list;
  $('crew').innerHTML = people.length
    ? people.slice(0, MAX_PLAYERS).map((c) => `<div class="pilot">${chip(c)}<span class="gun">${glyph('leaf')} ${escapeHtml(WEAPONS[gunOf(c)].name)}</span><span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to fight. Each of you leads your own squad, in your own view.</p>';
  const value = (r: (typeof ROWS)[number]) => (r === 'mates' ? String(settings.mates) : `${settings.start + 1}. ${MISSION[settings.start].title}`);
  const label = { mates: 'Squad-mates each', start: 'Start at' };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}"><span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${escapeHtml(value(r))}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
}

// The briefing: the map, with each step marked on it, and the plan
function renderPlan() {
  $('opName').textContent = OPERATION.name;
  $('opTime').textContent = OPERATION.time;
  $('opAbout').textContent = OPERATION.about;
  $('opPlan').textContent = OPERATION.plan;
  $('opSteps').innerHTML = MISSION.map((st) => `<li>${escapeHtml(st.title)}</li>`).join('');
  const cv = $<HTMLCanvasElement>('map'), g = cv.getContext('2d')!;
  const k = cv.width / MAP.w;
  const X = (x: number) => (x + MAP.w / 2) * k, Z = (z: number) => (z + MAP.d / 2) * k;
  g.fillStyle = '#28331f'; g.fillRect(0, 0, cv.width, cv.height);
  const FILL: Record<Ground, string> = { [Ground.Pasture]: '#2f3d24', [Ground.Wheat]: '#4a4628', [Ground.Plough]: '#3b3124', [Ground.Woods]: '#1b2617', [Ground.Orchard]: '#2c3a22' };
  for (const f of FIELDS) { g.fillStyle = FILL[f.kind]; g.fillRect(X(f.x - f.w / 2), Z(f.z - f.d / 2), f.w * k, f.d * k); }
  const line = (pts: [number, number][], w: number, col: string, dash: number[] = []) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = g.lineJoin = 'round'; g.setLineDash(dash);
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); g.setLineDash([]);
  };
  line(TRACK, 2.5 * k, '#6b5a43'); line(ROAD, 4 * k, '#77684f');
  for (const r of RUNS) line(r.points, r.kind === Line.Hedge ? 2.4 * k : r.kind === Line.Wall ? 1 * k : 0.6 * k, r.kind === Line.Hedge ? '#152010' : r.kind === Line.Wall ? '#8b8576' : '#9a9a9a', r.kind === Line.Wire ? [4, 4] : []);
  for (const b of BUILDINGS) { g.fillStyle = b.ruined ? '#5b5149' : '#a3988a'; g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k); }
  // the route and the steps
  const marks = MISSION.map((st) => (st.goal === Goal.Rescue ? PILOT : st.goal === Goal.Clear ? { x: st.zone!.x, z: st.zone!.z } : st.at));
  line([[START.x, START.z], ...marks.map((m) => [m.x, m.z] as [number, number])], 3, 'rgba(255,210,61,0.7)', [10, 8]);
  g.font = `800 ${Math.round(4.2 * k)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  marks.forEach((m, i) => {
    g.fillStyle = '#ffd23d'; g.beginPath(); g.arc(X(m.x), Z(m.z), 3.4 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0d0f14'; g.fillText(String(i + 1), X(m.x), Z(m.z) + 1);
  });
  g.fillStyle = '#4c8dff'; g.beginPath(); g.moveTo(X(START.x), Z(START.z) - 3 * k); g.lineTo(X(START.x) - 2.5 * k, Z(START.z) + 2.5 * k); g.lineTo(X(START.x) + 2.5 * k, Z(START.z) + 2.5 * k); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(X(LZ.x) - 3 * k, Z(LZ.z) - 3 * k, 6 * k, 6 * k);
  g.fillStyle = '#ffffff'; g.fillText('H', X(LZ.x), Z(LZ.z) + 1);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `700 ${Math.round(2.6 * k)}px system-ui, sans-serif`; g.textAlign = 'left';
  g.fillText('N ↑', 10, 18);
}

// Each player's view: the step and how far it is, a marker over it, his weapon, his health, his squad
function renderViews() {
  const st = sim.current;
  const out: string[] = [];
  for (const v of view.views) {
    const s = sim.soldiers.find((q) => q.human === v.id);
    const c = input.list.find((q) => q.id === v.id);
    if (!s || !st) continue;
    const r = v.rect;
    const at = objectiveAt(st);
    const dist = Math.round(Math.hypot(at.x - s.x, at.z - s.z));
    let progress = `${dist} m`;
    if (st.goal === Goal.Hold) progress = `${Math.max(0, Math.ceil((st.hold ?? 60) - sim.held))}s until the helicopter is in`;
    else if (st.goal === Goal.Clear) {
      const z = st.zone!;
      progress = `${plural(sim.axisAlive().filter((q) => Math.abs(q.x - z.x) < z.w / 2 && Math.abs(q.z - z.z) < z.d / 2).length, 'enemy', 'enemies')} left · ${dist} m`;
    } else if (st.goal === Goal.Destroy && dist < 6) progress = sim.chargeProgress > 0 ? `Setting the charge ${Math.round(sim.chargeProgress * 100)}%` : 'Hold Leaf beside the gun';
    else if (st.goal === Goal.Extract && sim.pilot) progress = `${dist} m · Reyes ${Math.round(Math.hypot(sim.pilot.x - LZ.x, sim.pilot.z - LZ.z))} m from it`;
    // the marker: over the place, or at the edge of the view toward it
    const p = view.project(v.id, at.x, height(at.x, at.z) + 2.2, at.z);
    let mx = p.x - r.x, my = p.y - r.y, edge = false;
    if (!p.front || mx < 30 || mx > r.w - 30 || my < 60 || my > r.h - 40) {
      edge = true;
      const cx = r.w / 2, cy = r.h / 2;
      let dx = mx - cx, dy = my - cy;
      if (!p.front) { dx = -dx; dy = Math.abs(dy) + 1; }
      const k = Math.min((r.w / 2 - 34) / Math.max(1, Math.abs(dx)), (r.h / 2 - 60) / Math.max(1, Math.abs(dy)));
      mx = cx + dx * k; my = cy + dy * k;
    }
    const hp = Math.max(0, s.hp) / 100;
    const mates = sim.soldiers.filter((m) => m.leader === s && !m.pilot);
    const nvg = view.nvg(v.id);
    // who else is on our side, tagged
    const tags: string[] = [];
    for (const q of sim.soldiers) {
      if (q === s || q.side !== Side.Allies || q.life === Life.Dead) continue;
      if (!q.human && !q.pilot && q.life !== Life.Down) continue;
      const tp = view.project(v.id, q.x, height(q.x, q.z) + 2.1, q.z);
      if (!tp.front || tp.x < r.x || tp.x > r.x + r.w || tp.y < r.y || tp.y > r.y + r.h) continue;
      const qc = input.list.find((o) => o.id === q.human);
      const down = q.life === Life.Down;
      const text = down ? `${escapeHtml(q.spec.name)} down · ${q.reviveT > 0 ? `${Math.round((q.reviveT / 3) * 100)}%` : `${Math.ceil(q.downT)}s`}` : escapeHtml(qc?.tag ?? q.spec.name);
      tags.push(`<div class="tag ${down ? 'down' : ''}" style="left:${tp.x - r.x}px;top:${tp.y - r.y}px;--pc:${q.pilot ? '#ffd23d' : qc?.color ?? '#9aa'}">${text}</div>`);
    }
    out.push(`<div class="pv" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">
      <div class="obj"><div class="t">${escapeHtml(st.title)}</div><div class="p">${escapeHtml(progress)}</div></div>
      ${tags.join('')}
      <div class="mark ${edge ? 'edge' : ''}" style="left:${mx}px;top:${my}px"><i></i><span>${dist} m</span></div>
      <div class="cross ${s.target ? 'on' : ''}"></div>
      <div class="me" style="--pc:${c?.color ?? '#fff'}"><b>${escapeHtml(c?.tag ?? '')}</b><div><div class="n">${escapeHtml(s.spec.name)} · ${escapeHtml(ORDER_NAME[s.order])} ${mates.filter((m) => m.alive).length}/${mates.length}</div><div class="hp"><i style="width:${hp * 100}%"></i></div></div></div>
      <div class="ammo"><div class="w">${escapeHtml(s.weapon.name)}${nvg ? ' · NVG' : ''}</div><div class="a">${s.reloadT > 0 ? '…' : s.ammo}<small> / ${s.weapon.mag}</small></div><div class="x">${'●'.repeat(s.grenades)} grenades</div></div>
    </div>`);
  }
  $('views').innerHTML = out.join('');
}

function renderResults(won: boolean) {
  $('resultsWhy').textContent = won ? 'Mission done' : 'Mission over';
  $('final').textContent = won ? 'Reyes is home' : `Reached step ${sim.step + 1}: ${MISSION[sim.step]?.title ?? ''}`;
  $('stats').innerHTML = sim.humans.map((s) => {
    const c = players.get(s.human!);
    return `<div class="stat">${c ? chip(c) : escapeHtml(s.spec.name)}<span>${plural(s.kills, 'enemy', 'enemies')} down</span>${c?.earned?.earned ? `<span>+${starsLabel(c.earned.earned)}</span>` : ''}</div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(big: string, sub = '', more = '', ms = 2400) {
  const el = $('callout');
  el.innerHTML = `${sub ? `<span class="eyebrow">${escapeHtml(sub)}</span>` : ''}<div class="big">${escapeHtml(big)}</div>${more ? `<div class="sub">${escapeHtml(more)}</div>` : ''}`;
  el.classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Command on the radio: a click, then the voice (the browser's own speech, where it has one)
function radio(text: string) {
  if (demo) return;
  sound.radio();
  const synth = globalThis.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const voice = voices.find((v) => /en[-_](US|GB)/.test(v.lang) && /male|daniel|alex|fred/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  u.rate = 1.05; u.pitch = 0.85; u.volume = 0.9;
  setTimeout(() => synth.speak(u), 250);
}

// --- what happened ------------------------------------------------------------------------------------------------
let failWhy = 'Everyone is down';
function react(e: SimEvent) {
  view.react(e);
  if (demo) return;
  const camDist = (x: number, z: number) => Math.hypot(view.listener.x - x, view.listener.z - z);
  const buzz = (s: Soldier, ms: number) => { if (s.human) input.buzz(input.list.find((c) => c.id === s.human), ms); };
  switch (e.type) {
    case 'shot': sound.shot(camDist(e.from.x, e.from.z), !e.from.weapon.auto); break;
    case 'whizz': sound.whizz(); break;
    case 'bang': sound.bang(camDist(e.x, e.z)); break;
    case 'reload': if (e.who.human) sound.reload(); break;
    case 'swap': if (e.who.human) sound.reload(); break;
    case 'stab': sound.stab(camDist(e.who.x, e.who.z)); break;
    case 'hurt': if (e.who.human) { sound.hurt(); buzz(e.who, 60); } break;
    case 'down': if (e.who.human || e.who.pilot) { callout(`${e.who.spec.name} is down`, '', e.who.pilot ? 'Get to Reyes: stand beside him to help him up' : 'Get to him: stand beside him to help him up', 2400); buzz(e.who, 400); } break;
    case 'order': sound.order(); callout(ORDER_NAME[e.order], `${e.leader.spec.name}'s squad`, '', 1200); break;
    case 'flare': sound.flare(camDist(e.flare.x, e.flare.z)); break;
    case 'rescued': callout('Reyes is with you', '', `He stays with ${e.by.spec.name}`, 2200); break;
    case 'helo': if (e.phase === 'inbound') callout('Dustoff inbound', '', '', 1800); break;
    case 'done': sound.step(); radio(MISSION[e.index].radio.done); break;
    case 'step': if (e.index > settings.start || stage === 'fighting') setTimeout(() => { if (stage === 'fighting' || stage === 'briefing') brief(); }, 3200); break;
    case 'blown': callout('The AA gun is down', '', '', 2000); break;
    case 'won': sound.won(); setTimeout(() => finish(true), 5000); break;
    case 'failed':
      failWhy = e.why === 'pilot' ? 'Reyes is dead' : 'Everyone is down';
      $('failWhy').textContent = failWhy;
      stage = 'failed'; show('failed'); break;
  }
}

// --- the loop --------------------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), padT = 0, hudT = 0;

function tick() {
  if (stage === 'paused' || stage === 'results' || stage === 'failed' || stage === 'plan') return;
  stageT += TICK;
  if (stage === 'briefing' && stageT > BRIEF_TIME) stage = 'fighting';
  if (demo) for (const h of sim.humans) demoPilot(h);
  sim.stepTick();
  for (const e of sim.events) react(e);
  if (demo && (sim.won || sim.failed)) toLobby();
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const fighting = !demo && (stage === 'fighting' || stage === 'briefing');
  for (const c of input.list) (fighting ? fightInput(c, dt) : menuInput(c));
  acc += dt;
  while (acc >= TICK) { tick(); acc -= TICK; }
  if (stage !== 'paused') view.frame(sim, dt);
  sound.rotor(sim.helo !== 'away' && !demo ? Math.max(0.15, 1 - Math.hypot(view.listener.x - LZ.x, view.listener.z - LZ.z) / 120) : 0);
  guard.frame(now);
  // first light: goggles off (they'd only dazzle now)
  if (!demo && sim.dark < 0.5) for (const v of view.views) if (v.nvg) { view.setNvg(v.id, false); sound.nvg(false); }
  if (!demo && stage !== 'plan') {
    hudT += dt;
    if (hudT > 0.05) { hudT = 0; renderViews(); }
  } else $('views').innerHTML = '';
  padT += dt;
  if (padT > 0.05) { padT = 0; for (const c of input.list) input.show(c, padScreen(c)); }
}

addEventListener('resize', () => view.layout());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('stick')} Move (past the ring: sprint)</span><span>${glyph('bolt')} Fire (close up: knife)</span><span>${glyph('leaf')} Crouch · hold: set a charge</span><span>${glyph('drop')} Grenade</span><span>${glyph('r1')} Rifle / pistol</span><span>${glyph('star')} Squad orders · swipe: night vision</span><span>${glyph('l1')} Reload</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('again').addEventListener('click', start);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
toLobby();
requestAnimationFrame(frame);
