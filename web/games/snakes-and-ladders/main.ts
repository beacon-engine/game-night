// Snakes and Ladders: the game flow. Lobby (who's playing, the board, the rules), the race (rolling, then
// each move played out: hops, climbs, slides), the computer players' turns, pause, results, saved records.
// The rules are in rules.ts, the drawing in draw.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, playerColor, playerKey, requireDevice, showManual, starsLabel,
  type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { BOARDS, centre, expectedRolls, LAST, Race, randomBoard, type Board, type Roll } from './rules.ts';
import { View, type Die, type Token } from './draw.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['play'] as const, ['roll'] as const);
const saves = gameSaves();

// What we remember about each player
interface PlayerRecord { name: string; games: number; wins: number; podiums: number; ladders: number; snakes: number; longestSlide: number }
const freshRecord = (name: string): PlayerRecord => ({ name, games: 0, wins: 0, podiums: 0, ladders: 0, snakes: 0, longestSlide: 0 });

const input = new Input({ state: () => ({ record: null as PlayerRecord | null, earned: null as Earned | null }) });
type Player = Pad<{ record: PlayerRecord | null; earned: Earned | null }>;

// --- settings, chosen in the lobby --------------------------------------------------------------
const SEATS = 4; // at most four on the board
const settings = { rivals: 2, board: 0, exact: true, sixes: true, everyPlace: true }; // board: an index into BOARDS, or BOARDS.length for random
const ROWS = ['rivals', 'board', 'exact', 'sixes', 'places'] as const;
let row = 0;
let random = randomBoard(); // the random board on show in the lobby, played next
const boardOf = (): Board => (settings.board < BOARDS.length ? BOARDS[settings.board] : random);

// The people at the board (the first four to join), and how many computer players join them: at least
// enough for a race of two
const people = () => [...input.list].sort((a, b) => a.slot - b.slot).slice(0, SEATS);
const rivals = (humans = people().length) => Math.max(2 - humans, Math.min(settings.rivals, SEATS - humans));

// --- a race -------------------------------------------------------------------------------------------
// Everyone on the board, people and computer players, in turn order
interface Seat {
  name: string;
  color: string;
  n: number; // the number on their token: their player number (P1 is 1)
  player: Player | null; // null: a computer player
  ladders: number; // this game
  snakes: number;
  slide: number; // the longest slide this game
}
const CPU_NAMES = ['Pip', 'Moss', 'Juno', 'Dot'];

type Stage = 'lobby' | 'playing' | 'paused' | 'ending' | 'results';
let stage: Stage = 'lobby';
let stageT = 0;
let seats: Seat[] = [];
let race = new Race(BOARDS[0], 2, settings);
let shown: number[] = []; // the square each token is drawn on: behind the race while a move plays out

// A roll plays out as a list of moves, one after another
type Move =
  | { kind: 'die' } // the die tumbling
  | { kind: 'hop'; from: number; to: number } // one square
  | { kind: 'ladder'; from: number; to: number }
  | { kind: 'snake'; from: number; to: number; i: number }
  | { kind: 'back'; from: number; to: number } // the third six
  | { kind: 'home'; place: number }
  | { kind: 'rest' }; // a breath before the next turn
let moves: { m: Move; who: number; dur: number }[] = [];
let moveT = 0;
let roll: Roll | null = null;
let beat = 0; // how long the player whose turn it is has been waiting (a computer player rolls after a beat)
const CPU_BEAT = 0.55;
let waitingFor = -1; // whose roll we're waiting for (to buzz their phone once)
let die: Die = { value: 6, rolling: false, t: 1, color: '#f3f0e8' };

const view = new View($<HTMLCanvasElement>('board'));
const HOP = 0.13; // seconds a square

// --- flow -------------------------------------------------------------------------------------------
function toLobby() {
  stage = 'lobby';
  moves = [];
  view.setBoard(boardOf());
  show('lobby');
  renderLobby();
}

function start() {
  const here = people();
  if (!here.length) return callout('Join first', 'Scan the code, or press a key on the keyboard');
  // the computer players take the colours (and numbers) nobody's using
  const used = new Set(input.list.map((c) => c.slot)), cpus: Seat[] = [];
  for (let slot = 0; cpus.length < rivals(here.length); slot++) {
    if (used.has(slot)) continue;
    cpus.push({ name: CPU_NAMES[cpus.length], color: playerColor(slot), n: slot + 1, player: null, ladders: 0, snakes: 0, slide: 0 });
  }
  const all: Seat[] = [...here.map((c) => ({ name: c.label, color: c.color, n: c.slot + 1, player: c, ladders: 0, snakes: 0, slide: 0 })), ...cpus];
  // a random turn order: it's a game of luck from the first roll
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  seats = all;
  for (const c of here) c.earned = null;
  race = new Race(boardOf(), seats.length, { ...settings });
  shown = seats.map(() => 0);
  moves = [];
  roll = null;
  beat = 0;
  waitingFor = -1;
  die = { value: 6, rolling: false, t: 1, color: seats[0].color };
  view.setBoard(race.board);
  for (const c of input.list) c.drain();
  stage = 'playing';
  show('hud');
  renderHud();
}

// Play again: the same board, unless it's random (then a new one)
function again() {
  if (settings.board === BOARDS.length) random = randomBoard();
  start();
}

function finish() {
  stage = 'ending';
  stageT = 0;
  saveRecords();
  payOut();
  renderHud();
}

function showResults() {
  stage = 'results';
  renderResults();
  show('results');
}

function togglePause() {
  if (stage === 'paused') { stage = 'playing'; show('hud'); }
  else if (stage === 'playing') { stage = 'paused'; show('pause'); }
}

// --- a turn -------------------------------------------------------------------------------------------
const seatOf = (c: Player) => seats.findIndex((s) => s.player === c);
// A seat a person is playing from a connected phone (otherwise the computer rolls for it)
const personAt = (i: number) => !!seats[i]?.player?.connected;
const ready = () => stage === 'playing' && !moves.length && !race.over;
// Whose turn it is on screen: the one whose roll is playing out, or else the one to roll next
const current = () => (moves.length ? moves[0].who : race.over ? -1 : race.turn);

function throwDie() {
  const who = race.turn, seat = seats[who];
  const r = race.roll(1 + Math.floor(Math.random() * 6));
  roll = r;
  beat = 0;
  die = { value: r.die, rolling: true, t: 0, color: seat.color };
  const queue = (m: Move, dur: number) => moves.push({ m, who, dur });
  queue({ kind: 'die' }, 0.6);
  for (const st of r.steps) {
    if (st.kind === 'walk') st.path.forEach((to, k) => queue({ kind: 'hop', from: k ? st.path[k - 1] : r.from, to }, HOP));
    else if (st.kind === 'ladder') queue(st, 0.35 + distance(st.from, st.to) * 0.12);
    else if (st.kind === 'snake') queue({ ...st, i: race.board.snakes.findIndex(([a]) => a === st.from) }, 0.55 + distance(st.from, st.to) * 0.13);
    else if (st.kind === 'back') queue(st, 0.6);
    else queue(st, 1);
  }
  queue({ kind: 'rest' }, r.again ? 0.15 : 0.25);
  renderHud();
}

const distance = (a: number, b: number) => { const p = centre(a), q = centre(b); return Math.hypot(p.x - q.x, p.y - q.y); };
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

// A move starting: callouts, buzzes, the stats
function begin(m: Move, who: number) {
  const seat = seats[who], name = seat.name;
  if (m.kind === 'hop' && m.from === LAST && roll?.bounced) callout('Bounce!', `${name} needed a ${LAST - roll.from}`, 1200);
  else if (m.kind === 'ladder') {
    seat.ladders++;
    callout(`Up ${m.to - m.from}!`, `${name} climbs to ${m.to}`, 1300);
    buzz(seat, 80);
  } else if (m.kind === 'snake') {
    const drop = m.from - m.to;
    seat.snakes++;
    seat.slide = Math.max(seat.slide, drop);
    callout(`Down ${drop}!`, drop >= 30 ? `${name} falls all the way to ${m.to}` : `${name} slides to ${m.to}`, 1500);
    buzz(seat, drop >= 30 ? 400 : 200);
  } else if (m.kind === 'home') {
    callout(m.place === 1 ? `${name} wins!` : 'Home!', m.place === 1 ? 'First one home' : `${name} is ${ordinal(m.place)}`, 1800);
    buzz(seat, 300);
  }
}

// A move done: the token is where it was going
function end(m: Move, who: number) {
  if (m.kind === 'die') {
    die.rolling = false;
    die.t = 0;
    if (roll?.threeSixes) callout('Three sixes!', roll.from === race.pos[who] ? 'That turn ends here' : `${seats[who].name} goes back to ${race.pos[who] || 'the start'}`, 1500);
  } else if (m.kind === 'hop' || m.kind === 'ladder' || m.kind === 'snake' || m.kind === 'back') shown[who] = m.to;
  renderHud();
}

function step(dt: number) {
  if (moves.length) {
    const { m, who, dur } = moves[0];
    if (moveT === 0) begin(m, who);
    moveT += dt;
    if (moveT >= dur) {
      moves.shift();
      moveT = 0;
      end(m, who);
      if (!moves.length && race.over) finish();
    }
    return;
  }
  if (race.over) return;
  const who = race.turn;
  if (personAt(who)) {
    if (waitingFor !== who) { waitingFor = who; buzz(seats[who], 60); renderHud(); }
    return;
  }
  waitingFor = -1;
  beat += dt;
  if (beat >= CPU_BEAT) throwDie();
}

const buzz = (s: Seat, ms: number) => { if (s.player?.connected) input.buzz(s.player, ms); };

// Where each token is drawn this frame: on its square, or part way through its move
function tokens(): Token[] {
  const cur = moves[0], u = cur ? Math.min(1, moveT / cur.dur) : 0;
  const ease = (t: number) => t * t * (3 - 2 * t);
  return seats.map((s, i): Token => {
    const t: Token = { color: s.color, n: s.n, sq: shown[i], active: i === current() };
    if (!cur || cur.who !== i) return t;
    const m = cur.m, lerp = (a: number, b: number, f: number) => { const p = centre(a), q = centre(b); return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }; };
    if (m.kind === 'hop') { t.at = lerp(m.from, m.to, ease(u)); t.lift = Math.sin(Math.PI * u) * 0.28; }
    else if (m.kind === 'ladder') {
      // rung by rung: a quick pull up each rung, a breath, the next
      const rungs = Math.max(2, Math.round(distance(m.from, m.to) / 0.3)), f = u * rungs, k = Math.floor(f);
      t.at = lerp(m.from, m.to, Math.min(1, (k + ease(Math.min(1, (f - k) * 1.6))) / rungs));
      t.lift = 0.1;
    } else if (m.kind === 'snake') { t.at = view.onSnake(m.i, u < 0.12 ? 0 : ease((u - 0.12) / 0.88)); t.lift = 0.04; }
    else if (m.kind === 'back') { t.at = lerp(m.from, m.to, ease(u)); t.lift = Math.sin(Math.PI * u) * 0.8; }
    else if (m.kind === 'home') t.lift = Math.abs(Math.sin(u * Math.PI * 3)) * 0.25 * (1 - u);
    return t;
  });
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  if (stage === 'lobby') renderLobby();
}

// A podium needs three on the board, and isn't last place
const podium = (place: number) => place >= 2 && place <= 3 && place < seats.length && seats.length >= 3;

// Stars for every person who raced: for playing, and more for winning or a podium
function payOut() {
  const order = race.standings();
  for (const s of seats) {
    const c = s.player;
    if (!c) continue;
    const place = order.indexOf(seats.indexOf(s)) + 1, why: EarnFor[] = ['played'];
    if (place === 1) why.push('won');
    else if (podium(place)) why.push('podium');
    earnStars(c, why).then((got) => {
      c.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

function saveRecords() {
  const order = race.standings();
  for (const s of seats) {
    const c = s.player;
    if (!c) continue;
    const place = order.indexOf(seats.indexOf(s)) + 1, r = c.record ?? freshRecord(c.label);
    r.name = c.label;
    r.games++;
    if (place === 1) r.wins++;
    else if (podium(place)) r.podiums++;
    r.ladders += s.ladders;
    r.snakes += s.snakes;
    r.longestSlide = Math.max(r.longestSlide, s.slide);
    c.record = r;
    saves.set(playerKey(c), r);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const recordLine = (r: PlayerRecord | null) => !r || !r.games ? 'First game'
  : `${plural(r.wins, 'win', 'wins')} from ${plural(r.games, 'game', 'games')}${r.longestSlide ? ` · longest slide ${r.longestSlide}` : ''}`;

input.onJoin = (c) => { loadRecord(c); if (stage === 'lobby') renderLobby(); else renderHud(); };
input.onLeave = () => (stage === 'lobby' ? renderLobby() : renderHud());
input.onRename = (c) => {
  for (const s of seats) if (s.player === c) s.name = c.label;
  if (stage === 'lobby') renderLobby(); else renderHud();
};
input.onPause = () => togglePause();

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Snakes and Ladders');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) { row = (row + fy + ROWS.length) % ROWS.length; renderLobby(); }
    if (fx) change(fx);
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (ev.bit === BIT.bolt) confirm();
    else if (ev.bit === BIT.drop) back();
    else if (ev.bit === BIT.star && stage === 'lobby') howTo();
  }
}

function change(d: number) {
  const r = ROWS[row];
  if (r === 'rivals') settings.rivals = Math.max(0, Math.min(SEATS - 1, rivals() + d));
  else if (r === 'board') {
    settings.board = (settings.board + d + BOARDS.length + 1) % (BOARDS.length + 1);
    if (settings.board === BOARDS.length) random = randomBoard(); // (a fresh one each time it's picked)
    view.setBoard(boardOf());
  } else if (r === 'exact') settings.exact = !settings.exact;
  else if (r === 'sixes') settings.sixes = !settings.sixes;
  else settings.everyPlace = !settings.everyPlace;
  renderLobby();
}

function confirm() {
  if (stage === 'lobby') start();
  else if (stage === 'results') again();
  else if (stage === 'paused') togglePause();
}

function back() {
  if (stage === 'lobby') backToHub();
  else if (stage === 'results' || stage === 'paused') toLobby();
}

// On your turn, Bolt rolls. Nothing else to do: the race plays itself out.
function playInput(c: Player) {
  for (const ev of c.drain()) {
    if (!ev.down || controls.action('play', ev.bit) !== 'roll') continue;
    if (ready() && seatOf(c) === race.turn) throwDie();
    else input.buzz(c, 30);
  }
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'lobby' || stage === 'results' ? back() : togglePause());
  else if (code === 'KeyP') togglePause();
});

// --- the phones -------------------------------------------------------------------------------------
function padScreen(c: Player): PadScreen {
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: 'Snakes and Ladders', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  const i = seatOf(c);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': {
      const place = race.standings().indexOf(i) + 1;
      return { ...base, labels: { bolt: 'Play again', drop: 'Lobby' }, hint: i < 0 ? 'Game over' : place === 1 ? 'You won!' : `You came ${ordinal(place)}` };
    }
    case 'paused': return { ...base, labels: { bolt: 'Resume', drop: 'Quit' }, hint: 'Paused' };
    default: {
      if (i < 0) return { ...base, labels: {}, hint: 'Watching: the board is full' };
      const home = race.home.indexOf(i);
      if (home >= 0 && shown[i] === LAST) return { ...base, labels: {}, hint: `Home! You came ${ordinal(home + 1)}` };
      if (stage === 'playing' && race.turn === i && !moves.length) return { ...base, labels: controls.labels('play'), hint: `Your roll! You're on ${shown[i] || 'the start'}` };
      if (current() === i) return { ...base, labels: {}, hint: 'Moving…' };
      return { ...base, labels: {}, hint: `${seats[current()]?.name ?? 'Someone'} is rolling · you're on ${shown[i] || 'the start'}` };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause') {
  for (const id of ['lobby', 'hud', 'results', 'pause']) $(id).classList.toggle('hidden', id !== screen && !(id === 'hud' && screen !== 'lobby'));
  layout();
}

// Fit the board (and the die) into their places on this screen
function layout() {
  const box = (id: string) => { const r = $(id).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  view.layout(box(stage === 'lobby' ? 'lobbyBoard' : 'boardArea'), stage === 'lobby' ? undefined : box('dieArea'));
}

const onOff = (b: boolean) => (b ? 'On' : 'Off');
function renderLobby() {
  const here = people();
  $('players').innerHTML = here.length
    ? here.map((c) => `<div class="who">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
      + (input.list.length > SEATS ? `<p class="faint" style="margin:0">Four play at a time: the rest watch.</p>` : '')
    : '<p class="muted" style="margin:0">Join with your phone to play. On your own? The computer players will race you.</p>';
  const b = boardOf();
  const label = { rivals: 'Computer players', board: 'Board', exact: 'Exact roll to finish', sixes: 'Six rolls again', places: 'Play for' };
  const value = {
    rivals: String(rivals()), board: escapeHtml(b.name), exact: onOff(settings.exact), sixes: onOff(settings.sixes),
    places: settings.everyPlace ? 'Every place' : 'The win',
  };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${value[r]}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
  $('lobbyAbout').innerHTML = `${escapeHtml(b.about)}<br>About ${Math.round(expectedRolls(b, settings.exact))} rolls each to get home`;
}

function renderHud() {
  const home = new Map(race.home.map((who, k) => [who, k + 1]));
  $('seats').innerHTML = seats.map((s, i) => {
    const place = shown[i] === LAST ? home.get(i) : undefined, mine = i === current();
    const who = s.player ? (s.player.connected ? s.player.tag : `${s.player.tag} · away`) : 'Computer';
    const where = place ? `<small>Home</small>${ordinal(place)}` : shown[i] ? `<small>Square</small>${shown[i]}` : '<small>Start</small>–';
    return `<div class="seat ${mine ? 'turn' : ''} ${place ? 'done' : ''}" style="--pc:${s.color}">
      <span class="disc">${s.n}</span>
      <span class="name"><b>${escapeHtml(s.name)}</b><span class="caption">${mine ? (moves.length ? 'Moving' : 'To roll') : who}</span></span>
      <span class="where num">${where}</span></div>`;
  }).join('');
  // under the die: who's rolling, and what the roll means
  const named = (s: Seat) => `<span style="color:${s.color}">${escapeHtml(s.name)}</span>`;
  const sub = (text: string) => `<span class="sub">${text}</span>`;
  const seat = seats[race.turn], again = roll?.again && roll.who === race.turn;
  let note = '';
  if (stage === 'ending') note = 'Game over';
  else if (moves.length && roll) {
    const what = die.rolling ? '' : roll.threeSixes ? 'Three sixes!' : roll.again ? 'Six! Roll again' : roll.bounced ? 'Too many: bounce' : '';
    note = `${named(seats[roll.who])} ${die.rolling ? 'rolls' : `rolled ${roll.die}`}${sub(what)}`;
  } else if (seat && personAt(race.turn)) note = named(seat) + sub(`${again ? 'Again! ' : ''}${glyph('bolt')} to roll`);
  else if (seat) note = named(seat) + sub(`${again ? 'Again! ' : ''}${seat.player ? 'Away: rolling for them' : 'Rolling…'}`);
  $('dieNote').innerHTML = note;
  const rules = [settings.exact ? 'Exact roll to finish' : 'Any roll finishes', settings.sixes ? 'six rolls again' : 'no extra rolls'];
  $('rulesLine').textContent = `${race.board.name} · ${rules.join(' · ')}`;
}

function renderResults() {
  const order = race.standings(), first = seats[order[0]];
  $('winner').innerHTML = `<span style="color:${first.color}">${escapeHtml(first.name)}</span> wins`;
  $('standings').innerHTML = order.map((i, k) => {
    const s = seats[i], c = s.player, place = k + 1;
    const who = c ? chip(c) : `<span class="chip" style="--pc:${s.color}"><b>CPU</b>${escapeHtml(s.name)}</span>`;
    const stats = `${plural(s.ladders, 'ladder', 'ladders')}, ${plural(s.snakes, 'snake', 'snakes')}${s.slide >= 20 ? ` · fell ${s.slide}` : ''}`;
    const got = c?.earned?.earned ? ` · +${starsLabel(c.earned.earned)}` : '';
    const where = race.pos[i] === LAST ? 'Home' : `Square ${race.pos[i]}`;
    return `<div class="standing ${place === 1 ? 'first' : ''}"><span class="place">${ordinal(place)}</span>${who}
      <span class="caption faint">${escapeHtml(stats)}${got}</span><b>${where}</b></div>`;
  }).join('');
}

let calloutTimer = 0;
function callout(big: string, line = '', ms = 1800) {
  const r = view.rect; // (across the board)
  Object.assign($('callout').style, { left: `${r.x}px`, width: `${r.size}px`, top: `${r.y + r.size * 0.36}px` });
  $('callout').innerHTML = `<div class="big">${escapeHtml(big)}</div>${line ? `<div class="line">${escapeHtml(line)}</div>` : ''}`;
  $('callout').classList.add('show');
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => $('callout').classList.remove('show'), ms);
}

// --- the loop -----------------------------------------------------------------------------------------
let last = performance.now(), padT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'playing' ? playInput(c) : menuInput(c));
  // once no person is still racing, the computer players finish at triple speed
  const fast = !seats.some((s, i) => personAt(i) && !race.home.includes(i)) ? 3 : 1;
  if (stage === 'playing' || stage === 'ending') {
    step(dt * fast);
    die.t += dt * fast;
  }
  if (stage === 'ending' && (stageT += dt) > 2.2) showResults();
  // while the die tumbles, a new face every few hundredths of a second
  const face = die.rolling ? 1 + (Math.floor(die.t / 0.07) * 7 + die.value) % 6 : die.value;
  if (seats[current()]) die.color = seats[current()].color; // (in the colour of whoever's turn it is)
  const inRace = stage !== 'lobby';
  const lobbyTokens = people().map((c): Token => ({ color: c.color, n: c.slot + 1, sq: 0, active: false }));
  const ring = moves[0]?.m.kind === 'hop' ? (roll?.steps.find((s) => s.kind === 'walk') as { path: number[] } | undefined)?.path.at(-1) ?? -1 : -1;
  view.frame({ tokens: inRace ? tokens() : lobbyTokens, die: inRace ? { ...die, value: face } : null, ring }, now);
  padT += dt;
  if (padT > 0.05) {
    padT = 0;
    for (const c of input.list) input.show(c, padScreen(c));
  }
}

addEventListener('resize', layout);
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('rematch').addEventListener('click', again);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
document.fonts.ready.then(() => view.paint()); // (the numbers and labels in the brand's fonts)
toLobby();
requestAnimationFrame(frame);