// Pool: the game flow. Lobby, the match (frames of 8-ball: placing the cue ball, aiming, power and spin, the
// computer's turn, the balls running), pause, results, saved records and stars.
// The physics is in physics.ts, the rules in rules.ts, the computer player in ai.ts, the 3D table in view.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, PerformanceGuard, playerColor, playerKey, requireDevice, showManual, starsLabel,
  type Button, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { LEVELS, Planner, type Shot } from './ai.ts';
import { Sfx } from './audio.ts';
import { HEAD_X, L, R, Table, TICK, W } from './physics.ts';
import {
  advance, ballsOf, FOUL_TEXT, judge, newFrame, onTheEight, SOLIDS, STRIPES, targets, type Frame, type Group,
} from './rules.ts';
import { ballColor, View, type CamMode, type Look } from './view.ts';

const device = await requireDevice(); // (a standard 3D game: one table, sixteen balls)
await document.fonts.load('700 48px Inter'); // (the numbers on the balls are drawn with it)
const controls = await loadControls(['aim', 'place'] as const, ['shoot', 'cancel', 'spin', 'camera', 'fineLeft', 'fineRight', 'place'] as const);
const saves = gameSaves();

// What we remember about each player. beat: matches won against the computer at each strength.
interface PlayerRecord { name: string; matches: number; wins: number; losses: number; frames: number; bestRun: number; beat: number[] }
const freshRecord = (name: string): PlayerRecord => ({ name, matches: 0, wins: 0, losses: 0, frames: 0, bestRun: 0, beat: [0, 0, 0] });

interface Seat { record: PlayerRecord | null; earned: Earned | null }
const input = new Input({ state: (): Seat => ({ record: null, earned: null }) });
type Player = Pad<Seat>;

// --- settings, chosen in the lobby --------------------------------------------------------------------------
const FRAMES = [1, 3, 5]; // best of
const settings = { person: false, level: 1, frames: 0, breaks: 0, guide: 0 }; // breaks: P1, the other side, a coin toss
let personChosen = false; // (until someone changes it, the opponent follows how many phones have joined)
const ROWS = ['opponent', 'level', 'frames', 'breaks', 'guide'] as const;
let row = 0;

// The two sides of the table: a person (one phone each, or one phone passed between two people) or the computer
interface Side { player: Player | null; level: number; name: string; color: string }
let sides: [Side, Side] = [
  { player: null, level: 1, name: '', color: '' },
  { player: null, level: 1, name: '', color: '' },
];
const shared = () => !!sides[0].player && sides[0].player === sides[1].player; // one phone, passed round
const people = () => [...new Set(sides.map((s) => s.player).filter((p): p is Player => !!p))];

type Stage = 'lobby' | 'playing' | 'paused' | 'ending' | 'results';
// in a frame: placing the cue ball (in hand), aiming, the cue going through, the balls running, a moment after,
// the computer's turn, between frames
type Phase = 'place' | 'aim' | 'strike' | 'rolling' | 'after' | 'cpu' | 'between';
let stage: Stage = 'lobby';
let phase: Phase = 'aim';
let phaseT = 0;
let stageT = 0;

const table = new Table();
table.rack();
let frame: Frame = newFrame(0);
let score: [number, number] = [0, 0];
let firstBreaker: 0 | 1 = 0;
let matchWinner: 0 | 1 | null = null;
let endWhy = '';
let shots: [number, number] = [0, 0]; // across the match (stars only for a real game)
let run = 0; // balls potted in this visit to the table
let bestRuns: [number, number] = [0, 0];

// the shot being lined up
const SPINS = [['Centre', 0, 0], ['Follow', 0, 0.75], ['Draw', 0, -0.85], ['Stun', 0, -0.25], ['Left', -0.8, 0], ['Right', 0.8, 0]] as const;
const aim = { angle: 0, power: 0, charging: false, chargeT: 0, side: 0, height: 0, preset: 0, leafT: 0, leafMoved: false, fineT: 0 };
let camPref: 'aim' | 'top' = 'aim';
let lastShot = { wasOnEight: false, legal: [] as number[], speed: 0 };
let soundAt = 0; // events already played

// the computer's turn: thinking, then (if in hand) moving the cue ball, turning the cue, drawing it back
let planner: Planner | null = null;
let cpu: { shot: Shot; step: 'place' | 'turn' | 'pull'; t: number; fromX: number; fromY: number; fromAngle: number } | null = null;

let pausedBy: Player | null = null;
let pauseRow = 0;

const view = new View($<HTMLCanvasElement>('table'));
const sfx = new Sfx();

// --- shot strength -------------------------------------------------------------------------------------------
// Power (0..1, what the meter shows) to the cue ball's speed. Curved, so soft shots get most of the meter.
const MAX_SPEED = 8.6;
const speedOf = (p: number) => 0.3 + (MAX_SPEED - 0.3) * p ** 1.6;
const powerOf = (v: number) => Math.max(0, Math.min(1, ((v - 0.3) / (MAX_SPEED - 0.3)) ** (1 / 1.6)));

// --- the flow -------------------------------------------------------------------------------------------------
const bySlot = (a: Player, b: Player) => a.slot - b.slot;
const groupName = (g: Group) => (g === 'solids' ? 'Solids' : 'Stripes');
const need = () => Math.ceil(FRAMES[settings.frames] / 2);

function toLobby() {
  stage = 'lobby';
  planner = null;
  cpu = null;
  table.rack();
  show('lobby');
  renderLobby();
  view.snap();
}

function start() {
  const here = [...input.list].sort(bySlot);
  if (!here.length) return callout('Join first', 'Scan the code, or press a key on the keyboard');
  const a = here[0];
  if (settings.person) {
    const b = here[1] ?? a; // (one phone: pass it between you)
    sides = [
      { player: a, level: 0, name: b === a ? 'Player 1' : a.label, color: a.color },
      { player: b, level: 0, name: b === a ? 'Player 2' : b.label, color: b === a ? playerColor(a.slot + 1) : b.color },
    ];
  } else {
    sides = [
      { player: a, level: 0, name: a.label, color: a.color },
      { player: null, level: settings.level, name: `Computer`, color: '#a6a4ae' },
    ];
  }
  firstBreaker = settings.breaks === 2 ? (Math.random() < 0.5 ? 0 : 1) : (settings.breaks as 0 | 1);
  newMatch();
}

// The same players, the other one breaking first
function rematch() {
  if (people().some((p) => !p.connected)) return toLobby();
  firstBreaker = (1 - firstBreaker) as 0 | 1;
  newMatch();
}

function newMatch() {
  score = [0, 0];
  shots = [0, 0];
  bestRuns = [0, 0];
  matchWinner = null;
  for (const p of people()) p.earned = null;
  for (const c of input.list) c.drain();
  stage = 'playing';
  show('hud');
  newFrameNow(firstBreaker);
}

function newFrameNow(breaker: 0 | 1) {
  table.rack();
  frame = newFrame(breaker);
  view.snap();
  beginTurn();
  callout(`Frame ${score[0] + score[1] + 1}`, `${sides[breaker].name} to break`, 1600);
}

const isCpu = (s: Side) => !s.player;
const shooter = () => sides[frame.turn];

// A new turn: the computer starts thinking, or the person aims (or places the cue ball first)
function beginTurn() {
  aim.charging = false;
  aim.power = 0;
  aim.side = aim.height = 0;
  aim.preset = 0;
  run = 0;
  soundAt = 0;
  const cue = table.cue;
  if (cue.state !== 'table') {
    Object.assign(cue, { state: 'table', vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, pocket: -1, fall: 0 });
    cue.x = HEAD_X - 0.25;
    cue.y = 0;
  }
  if (frame.inHand !== 'none' && !table.canPlace(cue.x, cue.y, frame.inHand === 'kitchen')) freeSpot();
  aimAtNearest();
  const s = shooter();
  if (isCpu(s)) {
    planner = new Planner(table.clone(), { ...frame, groups: [...frame.groups] as Frame['groups'], shots: [...frame.shots] as Frame['shots'] }, s.level);
    cpu = null;
    setPhase('cpu');
  } else {
    setPhase(frame.inHand !== 'none' ? 'place' : 'aim');
    input.buzz(s.player, 60);
  }
  renderHud();
}

// Point the cue at the nearest ball it may hit
function aimAtNearest() {
  const cue = table.cue;
  const near = targets(frame, table).map((n) => table.balls[n]).sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
  if (near) aim.angle = Math.atan2(near.y - cue.y, near.x - cue.x);
}

// somewhere free for the cue ball in hand
function freeSpot() {
  const kitchen = frame.inHand === 'kitchen';
  for (let r = 0; r < 1.2; r += 0.03) {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const x = HEAD_X - 0.25 + Math.cos(a) * r, y = Math.sin(a) * r;
      if (table.canPlace(x, y, kitchen)) { table.cue.x = x; table.cue.y = y; return; }
    }
  }
}

function setPhase(p: Phase) {
  phase = p;
  phaseT = 0;
}

// Let it go: the cue comes through, and at the end of its stroke the ball is struck
function shoot(speed: number, side: number, height: number) {
  lastShot = { wasOnEight: onTheEight(frame, table), legal: targets(frame, table), speed };
  aim.side = side;
  aim.height = height;
  aim.charging = false;
  setPhase('strike');
  renderHud();
}

function strikeNow() {
  table.strike(aim.angle, lastShot.speed, aim.side, aim.height);
  soundAt = 0;
  sfx.strike(lastShot.speed);
  shots[frame.turn]++;
  setPhase('rolling');
}

// Everything has stopped: what did that shot mean?
function shotOver() {
  const me = frame.turn, s = sides[me];
  const v = judge(frame, table, table.events, lastShot.wasOnEight, lastShot.legal);
  if (v.rerack) {
    callout('Rack again', `${v.why}. ${sides[v.rerack === 'same' ? me : 1 - me].name} breaks`, 2400);
    const breaker = (v.rerack === 'same' ? me : 1 - me) as 0 | 1;
    setPhase('between');
    nextFrame = () => { table.rack(); frame = newFrame(breaker); view.snap(); beginTurn(); };
    return;
  }
  const mine = frame.groups[me] ?? v.assigned;
  if (v.potted.length && !v.foul) run += v.potted.filter((n) => !mine || ballsOf(mine).includes(n) || n === 8).length;
  bestRuns[me] = Math.max(bestRuns[me], run);
  advance(frame, v);
  if (frame.winner !== null) return frameOver(frame.winner, v.why);
  if (v.foul) callout('Foul', `${FOUL_TEXT[v.foul]}. ${shooter().name}: ball in hand`, 2000);
  else if (v.assigned) callout(groupName(v.assigned), `${s.name} has the ${v.assigned}`, 1600);
  else if (frame.turn === me && !frame.breakShot && onTheEight(frame, table)) callout('On the 8', `${s.name} to pot the black`, 1400);
  for (const p of people()) if (frame.turn !== me) input.buzz(p, p === sides[frame.turn].player ? 80 : 0);
  setPhase('after');
  renderHud();
}

let nextFrame: (() => void) | null = null;

function frameOver(winner: 0 | 1, why: string) {
  score[winner]++;
  renderHud();
  for (const [i, s] of sides.entries()) if (s.player) input.buzz(s.player, i === winner ? 300 : 80);
  if (score[winner] >= need()) {
    matchWinner = winner;
    endWhy = why;
    stage = 'ending';
    stageT = 0;
    saveRecords();
    payOut();
    callout(`${sides[winner].name} wins`, why, 2600);
    setPhase('between');
    nextFrame = null;
    return;
  }
  callout(`${sides[winner].name} takes the frame`, why, 2400);
  setPhase('between');
  const breaker = (1 - frame.breaker) as 0 | 1; // (breaks alternate)
  nextFrame = () => newFrameNow(breaker);
}

function showResults() {
  stage = 'results';
  renderResults();
  show('results');
}

// --- pause: resume, concede the frame, quit ---------------------------------------------------------------------
// The side asking: the one who paused; against the computer, the person; otherwise (one phone, or the
// keyboard's Esc) whoever is shooting
const asker = (): 0 | 1 => {
  const i = pausedBy ? sides.findIndex((s) => s.player === pausedBy) : -1;
  if (shared()) return frame.turn;
  if (i >= 0) return i as 0 | 1;
  const person = sides.findIndex((s) => !isCpu(s));
  return sides.some(isCpu) && person >= 0 ? (person as 0 | 1) : frame.turn;
};
const pauseRows = () => [['resume', 'Resume'], ['concede', `Concede the frame (${sides[asker()].name})`], ['quit', 'Quit to the lobby']];

function pause(by: Player | null) {
  if (stage === 'paused') return resume();
  if (stage !== 'playing') return;
  stage = 'paused';
  pausedBy = by;
  pauseRow = 0;
  aim.charging = false;
  show('pause');
  renderPause();
}

function resume() {
  stage = 'playing';
  show('hud');
}

function choosePause() {
  const id = pauseRows()[pauseRow][0];
  if (id === 'resume') resume();
  else if (id === 'quit') toLobby();
  else {
    resume();
    if (phase === 'rolling' || phase === 'strike') table.settle();
    frameOver((1 - asker()) as 0 | 1, `${sides[asker()].name} conceded`);
  }
}

// --- saved records and stars ---------------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  if (stage === 'lobby') renderLobby();
}

function saveRecords() {
  if (shared()) return; // (one phone for two people: whose win would it be?)
  sides.forEach((s, i) => {
    if (!s.player) return;
    const p = s.player, r = { ...freshRecord(p.label), ...p.record };
    r.name = p.label;
    r.matches++;
    r.frames += score[i];
    r.bestRun = Math.max(r.bestRun, bestRuns[i]);
    const foe = sides[1 - i];
    if (matchWinner === i) { r.wins++; if (isCpu(foe)) r.beat[foe.level]++; } else r.losses++;
    p.record = r;
    saves.set(playerKey(p), r);
  });
}

// Stars for everyone who played a real match, and more for winning it
function payOut() {
  for (const p of people()) {
    const mine = sides.map((s, i) => (s.player === p ? i : -1)).filter((i) => i >= 0);
    if (mine.reduce((n, i) => n + shots[i], 0) < 6) continue;
    const won = !shared() && matchWinner !== null && mine.includes(matchWinner);
    const why: EarnFor[] = won ? ['played', 'won'] : ['played'];
    earnStars(p, why).then((got) => {
      p.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function recordLine(r: PlayerRecord | null) {
  if (!r || !r.matches) return 'First match';
  const best = [2, 1, 0].find((l) => r.beat[l]);
  return `${plural(r.wins, 'win', 'wins')}, ${plural(r.losses, 'loss', 'losses')}`
    + (r.bestRun > 1 ? ` · best run ${r.bestRun}` : '')
    + (best !== undefined ? ` · beat ${LEVELS[best].name}` : '');
}

input.onJoin = (c) => {
  loadRecord(c);
  if (!personChosen) settings.person = input.list.length >= 2;
  if (stage === 'lobby') renderLobby();
};
input.onLeave = () => {
  if (!personChosen) settings.person = input.list.length >= 2;
  if (stage === 'lobby') renderLobby();
};
input.onRename = () => (stage === 'lobby' ? renderLobby() : renderHud());
input.onPause = (c) => pause(c);

// --- menus ---------------------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Pool');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) moveRow(fy);
    if (fx) change(fx);
  }
  if (stage === 'paused' && fy) { pauseRow = (pauseRow + fy + 3) % 3; renderPause(); }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.bolt) confirm();
    else if (ev.bit === BIT.drop) back();
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
  }
}

// The lobby's rows; the computer's strength is skipped when playing a person
function moveRow(d: number) {
  do row = (row + d + ROWS.length) % ROWS.length;
  while (ROWS[row] === 'level' && settings.person);
  renderLobby();
}

function change(d: number) {
  const turn = (n: number, of: number) => (n + d + of) % of;
  const r = ROWS[row];
  if (r === 'opponent') { settings.person = !settings.person; personChosen = true; }
  else if (r === 'level') settings.level = turn(settings.level, LEVELS.length);
  else if (r === 'frames') settings.frames = turn(settings.frames, FRAMES.length);
  else if (r === 'breaks') settings.breaks = turn(settings.breaks, 3);
  else settings.guide = turn(settings.guide, 2);
  renderLobby();
}

function confirm() {
  if (stage === 'lobby') start();
  else if (stage === 'results') rematch();
  else if (stage === 'paused') choosePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results') toLobby();
  else if (stage === 'paused') resume();
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'playing' || stage === 'paused' ? pause(null) : back());
  else if (code === 'KeyP') pause(null);
  else if (code === 'KeyM') callout(sfx.toggleMute() ? 'Sound off' : 'Sound on', '', 900);
});
for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => { sfx.unlock(); soundHint(); });

// --- playing: the shooter's pad --------------------------------------------------------------------------------------
function playInput(c: Player, dt: number) {
  const events = c.drain();
  if (phase === 'place') return placeInput(c, events, dt);
  if (phase !== 'aim') return;
  const spinHeld = controls.held(c, 'aim', 'spin');
  const sprint = c.held(BIT.sprint);
  if (spinHeld) {
    // holding Spin: the stick moves where the tip meets the ball
    aim.leafT += dt;
    if (Math.hypot(c.x, c.y) > 0.3) aim.leafMoved = true;
    aim.side += c.x * dt * 1.6;
    aim.height += c.y * dt * 1.6;
    const r = Math.hypot(aim.side, aim.height);
    if (r > 1) { aim.side /= r; aim.height /= r; }
  } else {
    // the stick turns the cue: gently near the middle, quickly pushed all the way (and past the ring)
    aim.angle -= c.x * Math.abs(c.x) * (sprint ? 1.6 : 0.5) * dt;
  }
  // fine aim: a tap is a twentieth of a degree; held, it creeps
  const fine = (controls.held(c, 'aim', 'fineLeft') ? 1 : 0) - (controls.held(c, 'aim', 'fineRight') ? 1 : 0);
  if (fine) { aim.fineT += dt; if (aim.fineT > 0.3) aim.angle += fine * (Math.PI / 180) * 1.2 * dt; } else aim.fineT = 0;
  if (aim.charging) {
    // the power swings up and back down until you let go
    aim.chargeT += dt;
    aim.power = 1 - Math.abs(((aim.chargeT / 1.4) % 2) - 1);
  }
  for (const ev of events) {
    const a = controls.action('aim', ev.bit);
    if (ev.down) {
      if (a === 'shoot') { aim.charging = true; aim.chargeT = 0; aim.power = 0; }
      else if (a === 'cancel') {
        if (aim.charging) { aim.charging = false; aim.power = 0; }
        else if (frame.inHand !== 'none') setPhase('place');
      } else if (a === 'spin') { aim.leafT = 0; aim.leafMoved = false; }
      else if (a === 'camera') camPref = camPref === 'aim' ? 'top' : 'aim';
      else if (a === 'fineLeft') aim.angle += (Math.PI / 180) * 0.05;
      else if (a === 'fineRight') aim.angle -= (Math.PI / 180) * 0.05;
    } else if (a === 'shoot' && aim.charging) {
      if (aim.power > 0.01) shoot(speedOf(aim.power), aim.side, aim.height);
      else aim.charging = false;
    } else if (a === 'spin' && !aim.leafMoved && aim.leafT < 0.35) {
      // a tap of Spin: the next of the usual spins
      aim.preset = (aim.preset + 1) % SPINS.length;
      aim.side = SPINS[aim.preset][1];
      aim.height = SPINS[aim.preset][2];
    }
  }
}

// Ball in hand: the stick slides the cue ball about; Place puts it down (if it's somewhere it may go)
function placeInput(c: Player, events: { bit: number; down: boolean }[], dt: number) {
  const kitchen = frame.inHand === 'kitchen';
  const cue = table.cue, speed = c.held(BIT.sprint) ? 1.1 : 0.45;
  cue.x = Math.max(-L / 2 + R, Math.min(kitchen ? HEAD_X : L / 2 - R, cue.x + c.x * speed * dt));
  cue.y = Math.max(-W / 2 + R, Math.min(W / 2 - R, cue.y + c.y * speed * dt));
  for (const ev of events) {
    if (!ev.down) continue;
    const a = controls.action('place', ev.bit);
    if (a === 'place') {
      if (table.canPlace(cue.x, cue.y, kitchen)) { setPhase('aim'); aimAtNearest(); }
      else input.buzz(c, 40);
    } else if (a === 'camera') camPref = camPref === 'aim' ? 'top' : 'aim';
  }
}

// --- the computer's turn ---------------------------------------------------------------------------------------------
function cpuStep(dt: number) {
  if (!cpu) {
    if (!planner!.step(device.tv ? 5 : 8) || phaseT < 0.8) return;
    const shot = planner!.shot!;
    cpu = { shot, step: shot.place ? 'place' : 'turn', t: 0, fromX: table.cue.x, fromY: table.cue.y, fromAngle: aim.angle };
    if (shot.place) aim.angle = Math.atan2(shot.place.y - table.cue.y, shot.place.x - table.cue.x);
    aim.side = shot.side;
    aim.height = shot.height;
    return;
  }
  cpu.t += dt;
  const ease = (k: number) => k * k * (3 - 2 * k);
  if (cpu.step === 'place') {
    const k = ease(Math.min(1, cpu.t / 0.8)), p = cpu.shot.place!;
    table.cue.x = cpu.fromX + (p.x - cpu.fromX) * k;
    table.cue.y = cpu.fromY + (p.y - cpu.fromY) * k;
    if (k >= 1) { cpu.step = 'turn'; cpu.t = 0; cpu.fromAngle = aim.angle; }
  } else if (cpu.step === 'turn') {
    let d = cpu.shot.angle - cpu.fromAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // (the short way round)
    const k = ease(Math.min(1, cpu.t / (0.4 + Math.abs(d) * 0.35)));
    aim.angle = cpu.fromAngle + d * k;
    if (k >= 1) { cpu.step = 'pull'; cpu.t = 0; aim.charging = true; }
  } else {
    const target = powerOf(cpu.shot.speed), k = Math.min(1, cpu.t / 0.9);
    aim.power = target * ease(k);
    if (cpu.t > 1.15) {
      aim.angle = cpu.shot.angle;
      shoot(cpu.shot.speed, cpu.shot.side, cpu.shot.height);
      planner = null;
      cpu = null;
    }
  }
}

// --- the fixed step -------------------------------------------------------------------------------------------------
function step(dt: number) {
  for (const c of input.list) {
    if (stage === 'playing' && shooter().player === c) playInput(c, dt);
    else if (stage === 'playing') c.drain();
    else menuInput(c);
  }
  if (stage === 'ending' && (stageT += dt) > 3) showResults();
  if (stage !== 'playing') return;
  phaseT += dt;
  if (phase === 'cpu') cpuStep(dt);
  else if (phase === 'strike' && phaseT > 0.09) strikeNow();
  else if (phase === 'rolling') {
    table.tick();
    playSounds();
    if (!table.moving()) shotOver();
  } else if (phase === 'after' && phaseT > 0.7) beginTurn();
  else if (phase === 'between' && phaseT > 2.6) { nextFrame?.(); nextFrame = null; }
}

function playSounds() {
  const ev = table.events;
  for (; soundAt < ev.length; soundAt++) {
    const e = ev[soundAt];
    if (e.t === 'hit') sfx.click(e.speed);
    else if (e.t === 'rail') sfx.cushion(e.speed);
    else { sfx.pocket(); renderHud(); }
  }
}

// --- the phones -----------------------------------------------------------------------------------------------------
function labels(ctx: 'aim' | 'place', names: Partial<Record<string, string>>) {
  const out: Partial<Record<Button, string>> = {};
  for (const [key, action] of controls.bindings(ctx)) if (names[action] && !key.includes('+')) out[key as Button] = names[action];
  return out;
}

function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Pool', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': {
      const i = sides.findIndex((s) => s.player === c);
      const hint = i < 0 || shared() ? `${sides[matchWinner ?? 0].name} won` : matchWinner === i ? 'You won!' : 'You lost this one';
      return { ...base, labels: { bolt: 'Rematch', drop: 'Lobby' }, hint };
    }
    case 'paused': return { ...base, labels: { bolt: 'Choose', drop: 'Resume' }, hint: 'Paused: ▲▼ choose' };
    case 'ending': return { ...base, labels: {}, hint: 'Match over' };
    default: {
      const s = shooter();
      const title = shared() ? `Pool · ${s.name}` : 'Pool';
      if (s.player !== c) return { ...base, title, labels: {}, hint: isCpu(s) ? 'The computer is at the table' : `${s.name} is at the table` };
      if (phase === 'place') {
        return { ...base, title, layout: 'stick', labels: labels('place', { place: 'Put it here', camera: 'Camera' }), hint: frame.inHand === 'kitchen' ? 'In hand: behind the line' : 'Ball in hand: put it anywhere' };
      }
      if (phase !== 'aim') return { ...base, title, labels: {}, hint: 'Watch it go…' };
      const spin = spinName();
      return {
        ...base, title, layout: 'stick',
        labels: labels('aim', {
          shoot: aim.charging ? 'Let go to shoot' : 'Hold to shoot', cancel: aim.charging ? 'Cancel' : frame.inHand !== 'none' ? 'Move cue ball' : '',
          spin: `Spin: ${spin}`, camera: camPref === 'aim' ? 'Overhead' : 'Behind cue', fineLeft: 'Fine ◀', fineRight: 'Fine ▶',
        }),
        hint: aim.charging ? 'Let go of Bolt to shoot' : 'Stick: aim · hold Spin + stick: tip',
        ...(aim.charging ? { charge: aim.power } : {}),
      };
    }
  }
}

function spinName() {
  const p = SPINS[aim.preset];
  if (Math.abs(p[1] - aim.side) < 0.01 && Math.abs(p[2] - aim.height) < 0.01) return p[0];
  if (Math.hypot(aim.side, aim.height) < 0.08) return 'Centre';
  const v = aim.height > 0.15 ? 'Top' : aim.height < -0.15 ? 'Low' : '';
  const h = aim.side > 0.15 ? 'right' : aim.side < -0.15 ? 'left' : '';
  return [v, h].filter(Boolean).join(' ') || 'Centre';
}

// --- screens -------------------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(id === 'hud' && screen === 'pause'));
  soundHint();
}

function soundHint() {
  $('sound').classList.toggle('hidden', sfx.ready || stage !== 'lobby');
}

function renderLobby() {
  const here = [...input.list].sort(bySlot);
  $('players').innerHTML = here.length
    ? here.map((c) => `<div class="who">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to play. On your own? Take on the computer.</p>';
  const one = here[0] ? escapeHtml(here[0].label) : 'P1';
  const two = settings.person ? (here[1] ? escapeHtml(here[1].label) : 'Player 2') : 'Computer';
  const label = { opponent: 'Opponent', level: 'Computer', frames: 'Match', breaks: 'First break', guide: 'Aim guide' };
  const value = {
    opponent: settings.person ? (here.length >= 2 ? 'A person' : 'Pass the phone') : 'Computer',
    level: LEVELS[settings.level].name,
    frames: FRAMES[settings.frames] === 1 ? 'One frame' : `Best of ${FRAMES[settings.frames]}`,
    breaks: [one, two, 'Coin toss'][settings.breaks],
    guide: settings.guide ? 'Short' : 'Long',
  };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r === 'level' && settings.person ? 'off' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${value[r]}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
}

// A ball as a small flat disc for the HUD
const pip = (n: number, down: boolean) => {
  const col = ballColor(n), cls = `pip${down ? ' down' : ''}`;
  return n > 8 ? `<span class="${cls} stripe" style="--c:${col}"></span>` : `<span class="${cls}" style="--c:${col}"></span>`;
};

function renderHud() {
  sides.forEach((s, i) => {
    const el = $(`card${i}`), g = frame.groups[i];
    const turn = stage !== 'lobby' && frame.turn === i;
    el.classList.toggle('turn', turn);
    const who = s.player && !shared() ? chip(s.player) : `<span class="chip" style="--pc:${s.color}"><b>${isCpu(s) ? 'CPU' : `P${i + 1}`}</b>${escapeHtml(isCpu(s) ? LEVELS[s.level].name : s.name)}</span>`;
    const balls = g ? ballsOf(g).map((n) => pip(n, !table.onTable(n))).join('') + pip(8, !table.onTable(8)) : '';
    const what = g ? groupName(g) : frame.breakShot ? (frame.breaker === i ? 'Breaks' : '') : 'Open table';
    el.innerHTML = `<div class="top">${who}<b class="frames num">${score[i]}</b></div>
      <div class="group"><span class="caption">${what}</span><span class="pips">${balls}</span></div>`;
  });
  $('match').textContent = FRAMES[settings.frames] === 1 ? 'One frame' : `Best of ${FRAMES[settings.frames]}`;
  // potted so far, along the bottom of the scoreboard (until the groups are decided)
  const down = [...SOLIDS, ...STRIPES].filter((n) => !table.onTable(n) && table.balls[n].state === 'potted');
  $('potted').innerHTML = !frame.groups[0] && down.length ? down.map((n) => pip(n, false)).join('') : '';
  renderStatus();
}

function renderStatus() {
  const s = shooter();
  let line = '';
  if (stage === 'playing') {
    if (phase === 'cpu') line = `${LEVELS[s.level].name} computer is lining up a shot`;
    else if (phase === 'place') line = `${s.name}: ball in hand${frame.inHand === 'kitchen' ? ', behind the line' : ''}`;
    else if (phase === 'aim') line = frame.breakShot ? `${s.name} to break` : onTheEight(frame, table) ? `${s.name} is on the 8` : `${s.name} to shoot`;
  }
  $('status').textContent = line;
}

// The power meter and the spin dial: every frame while aiming
function renderMeters() {
  const showIt = stage === 'playing' && (phase === 'aim' || phase === 'strike' || (phase === 'cpu' && !!cpu));
  $('meters').classList.toggle('hidden', !showIt);
  if (!showIt) return;
  $('powerFill').style.width = `${(aim.power * 100).toFixed(1)}%`;
  $('powerText').textContent = aim.power ? `${Math.round(aim.power * 100)}%` : phase === 'aim' ? 'Hold to shoot' : '';
  const dot = $('spinDot');
  dot.style.left = `${50 + aim.side * 30}%`;
  dot.style.top = `${50 - aim.height * 30}%`;
  $('spinName').textContent = spinName();
}

function renderPause() {
  $('pauseRows').innerHTML = pauseRows().map(([, label], i) =>
    `<div class="setting ${i === pauseRow ? 'sel' : ''}"><span>${escapeHtml(label)}</span></div>`).join('');
  $('pauseLegend').innerHTML = `<span>${glyph('dpad')} Choose</span><span>${glyph('bolt')} OK</span><span>${glyph('drop')} Resume</span>`;
}

function renderResults() {
  const w = matchWinner ?? 0;
  $('why').textContent = `${score[0]}–${score[1]} · ${endWhy}`;
  $('winner').innerHTML = `<span class="hl-volt">${escapeHtml(sides[w].name)}</span> wins`;
  $('standings').innerHTML = sides.map((s, i) => {
    const who = s.player && !shared() ? chip(s.player) : `<span class="chip" style="--pc:${s.color}"><b>${isCpu(s) ? 'CPU' : `P${i + 1}`}</b>${escapeHtml(isCpu(s) ? LEVELS[s.level].name : s.name)}</span>`;
    const line = isCpu(s) ? 'The computer' : shared() ? `Best run ${bestRuns[i]}` : recordLine(s.player!.record);
    const got = s.player?.earned?.earned && (!shared() || i === 0) ? ` +${starsLabel(s.player.earned.earned)}` : '';
    return `<div class="standing ${i === w ? 'first' : ''}">${who}<b class="num">${score[i]}</b>
      <span class="caption faint">${escapeHtml(line)}${got}</span><b>${i === w ? 'Win' : 'Loss'}</b></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(big: string, line = '', ms = 1800) {
  $('callout').innerHTML = `<div class="big">${escapeHtml(big)}</div>${line ? `<div class="line">${escapeHtml(line)}</div>` : ''}`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), ms);
}

// --- the loop --------------------------------------------------------------------------------------------------------
function look(): Look {
  if (stage === 'lobby' || stage === 'results') return { cam: 'lobby', aim: aim.angle, cue: null, guide: null, inHand: null };
  const human = !isCpu(shooter());
  let cam: CamMode = camPref;
  if (phase === 'place' || (phase === 'cpu' && cpu?.step === 'place')) cam = 'top';
  else if (phase === 'cpu' && !cpu) cam = 'watch';
  else if (phase === 'rolling' || phase === 'after' || phase === 'between') cam = camPref === 'top' ? 'top' : 'watch';
  if (stage === 'ending') cam = 'watch';
  const aiming = phase === 'aim' || phase === 'strike' || (phase === 'cpu' && !!cpu && cpu.step !== 'place');
  const legal = targets(frame, table);
  return {
    cam,
    aim: aim.angle,
    cue: aiming ? { pull: aim.power, side: aim.side, height: aim.height, strike: phase === 'strike' ? Math.min(1, phaseT / 0.09) : 0 } : null,
    guide: aiming && (human || phase === 'cpu') ? { legal: (n) => legal.includes(n), long: settings.guide === 0 && !frame.breakShot } : null,
    inHand: phase === 'place' || (phase === 'cpu' && cpu?.step === 'place') ? { ok: table.canPlace(table.cue.x, table.cue.y, frame.inHand === 'kitchen'), kitchen: frame.inHand === 'kitchen' } : null,
  };
}

const maxFps = device.tv ? 30 : 60;
const MIN_FRAME = 1000 / maxFps - 1;
// If it can't keep up: fewer pixels, then no shadows, then stop rather than grind
const guard = new PerformanceGuard({
  targetFps: maxFps,
  onStruggle(level) {
    if (level === 1) view.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else view.renderer.shadowMap.enabled = false;
    view.resize();
  },
});
guard.watchCanvas(view.renderer.domElement);

let acc = 0, last = performance.now(), padT = 0;
function frameLoop(now: number) {
  requestAnimationFrame(frameLoop);
  if (now - last < MIN_FRAME) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  sfx.frame();
  while (acc >= TICK) {
    step(TICK);
    acc -= TICK;
  }
  view.frame(dt, table, look());
  renderMeters();
  padT += dt;
  if (padT > 0.05) {
    padT = 0;
    if (stage === 'playing') renderStatus();
    for (const c of input.list) input.show(c, padScreen(c));
  }
  guard.frame(now);
}

addEventListener('resize', () => view.resize());
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('stick')} Aim</span><span>${glyph('bolt')} Hold, let go to shoot</span>`
  + `<span>${glyph('leaf')} Spin</span><span>${glyph('star')} Camera</span><span>${glyph('l1')}${glyph('r1')} Fine aim</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('rematch').addEventListener('click', rematch);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
sfx.unlock(); // (where sound may start on its own, like the TV app, it does)
toLobby();
requestAnimationFrame(frameLoop);
