// Checkers: the game flow. Lobby, the game (cursors, picking up a piece and putting it down hop by
// hop, the computer's turn, clocks), pause with a draw offer or resigning, results, saved records.
// The rules are in rules.ts, the computer player in ai.ts, the drawing in draw.ts.
import {
  $, backToHub, BIT, chip, earnStars, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, ownedItems, playerKey, requireDevice, shopItems, showManual, starsLabel,
  type Button, type EarnFor, type Earned, type Pad, type PadScreen,
} from '@platform';
import { LEVELS, Thinker, wantsDraw } from './ai.ts';
import { INK_BOARD, pieceSvg, setBoard, View, type Scene } from './draw.ts';
import { colOf, colorOf, Draughts, other, rowOf, sameMove, squareAt, type Color, type Move } from './rules.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['play', 'drawOffer'] as const, ['move', 'cancel', 'accept', 'decline'] as const);
const saves = gameSaves();

// What we remember about each player. beat: wins against the computer at each strength (Easy, Medium, Hard).
interface PlayerRecord { name: string; games: number; wins: number; draws: number; losses: number; beat: number[] }
const freshRecord = (name: string): PlayerRecord => ({ name, games: 0, wins: 0, draws: 0, losses: 0, beat: [0, 0, 0] });

// Board themes bought with stars (shop.json). Anyone at the table who owns one can choose it.
interface Board { id: string; name: string; light: string; dark: string }
const BOARDS: Board[] = [{ id: '', name: 'Ink', ...INK_BOARD }, ...(await shopItems('checkers'))
  .filter((it) => typeof it.extra.light === 'string' && typeof it.extra.dark === 'string')
  .map((it) => ({ id: it.id.slice('checkers/'.length), name: it.name, light: it.extra.light as string, dark: it.extra.dark as string }))];
const MIN_PLIES = 10; // stars only for a real game, not an instant resignation

interface Seat {
  record: PlayerRecord | null;
  cursor: number; // a dark square, 0-31
  col: number; // the column (on the screen) the cursor keeps to when it goes up and down
  hand: number; // the square of the piece in hand (-1: none)
  hops: number[]; // the squares it has hopped to so far, in a jump being entered
  boards: string[]; // board themes they own
  earned: Earned | null; // stars from the last game
}
const input = new Input({ state: (): Seat => ({ record: null, cursor: 21, col: 3, hand: -1, hops: [], boards: [], earned: null }) });
type Player = Pad<Seat>;

// --- settings, chosen in the lobby --------------------------------------------------------------
const CLOCKS = [0, 5, 10]; // minutes each (0: no clock)
const SIDES = ['Black', 'White', 'Random'];
const settings = { person: false, level: 1, side: 0, clock: 0, board: '' }; // person: against another person, not the computer
let personChosen = false; // (until someone changes it, the opponent follows how many phones have joined)
const ROWS = ['opponent', 'level', 'side', 'clock', 'board'] as const;
// the boards someone here owns (the ink board is everyone's)
const boards = () => BOARDS.filter((b) => !b.id || input.list.some((c) => c.boards.includes(b.id)));
const boardOf = () => boards().find((b) => b.id === settings.board) ?? BOARDS[0];
let row = 0;

// Who plays each colour: a person, or the computer at a strength
type Side = { player: Player } | { level: number };
const sides: Record<Color, Side> = { b: { level: 1 }, w: { level: 1 } };
const isPerson = (s: Side): s is { player: Player } => 'player' in s;
const sideOf = (p: Player) => (['b', 'w'] as const).find((c) => { const s = sides[c]; return isPerson(s) && s.player === p; }) ?? null;
const people = () => (['b', 'w'] as const).map((c) => sides[c]).filter(isPerson).map((s) => s.player);
// Black moves first and sits at the bottom, unless you're on your own as White
const flipped = () => !(isPerson(sides.w) && !isPerson(sides.b));
const COLOR = { b: 'Black', w: 'White' };

type Stage = 'lobby' | 'playing' | 'paused' | 'offer' | 'ending' | 'results';
let stage: Stage = 'lobby';
let stageT = 0;
let game = new Draughts();
let legal = game.moves();
let lastMove: Move | null = null;
let clocks: Record<Color, number> | null = null; // seconds left
let thinker: Thinker | null = null;
let thinkFor = 0; // the computer's pause before moving, so its moves don't appear instantly
let afterMove: (() => void) | null = null; // a callout waiting for the move to finish playing out
let pausedBy: Player | null = null;
let pauseRow = 0;
let offerTo: Color = 'w';
let result: { winner: Color | null; why: End } = { winner: null, why: 'agreed' };

// How a game can end: what the callout says, and the longer reason on the results
type End = 'noPieces' | 'noMoves' | 'forty' | 'repetition' | 'time' | 'resign' | 'agreed';
const ENDS: Record<End, [string, string]> = {
  noPieces: ['Cleared', 'Every piece taken'],
  noMoves: ['Blocked', 'No move left to make'],
  forty: ['Draw', 'Forty moves each with no capture and no man moved'],
  repetition: ['Draw', 'The same position three times'],
  time: ['Out of time', 'Out of time'],
  resign: ['Resigned', 'Resigned'],
  agreed: ['Draw agreed', 'Draw agreed'],
};

const view = new View($<HTMLCanvasElement>('board'));

// --- flow -------------------------------------------------------------------------------------------
const bySlot = (a: Player, b: Player) => a.slot - b.slot;

function toLobby() {
  stage = 'lobby';
  thinker = null;
  afterMove = null;
  show('lobby');
  renderLobby();
  for (const c of input.list) loadBoards(c); // (they may have bought one on their phone)
}

function start() {
  const here = [...input.list].sort(bySlot);
  if (!here.length) return callout('Join first', 'Scan the code, or press a key on the keyboard');
  if (settings.person && here.length < 2) return callout('Two players', 'A second player needs to join');
  const first: Color = settings.side === 2 ? (Math.random() < 0.5 ? 'b' : 'w') : settings.side === 0 ? 'b' : 'w';
  sides[first] = { player: here[0] };
  sides[other(first)] = settings.person ? { player: here[1] } : { level: settings.level };
  newGame();
}

// The same players, colours swapped
function rematch() {
  if (people().some((p) => !p.connected)) return toLobby();
  [sides.b, sides.w] = [sides.w, sides.b];
  newGame();
}

function newGame() {
  game = new Draughts();
  legal = game.moves();
  setBoard(boardOf());
  for (const p of people()) p.earned = null;
  lastMove = null;
  thinker = null;
  afterMove = null;
  clocks = CLOCKS[settings.clock] ? { b: CLOCKS[settings.clock] * 60, w: CLOCKS[settings.clock] * 60 } : null;
  for (const c of ['b', 'w'] as const) {
    const s = sides[c];
    if (isPerson(s)) { setCursor(s.player, c === 'b' ? 9 : 22); s.player.hand = -1; s.player.hops = []; } // (on a man in the front row)
  }
  for (const c of input.list) c.drain();
  stage = 'playing';
  show('hud');
  renderHud();
}

function playMove(m: Move) {
  const mover = game.turn;
  game.play(m);
  legal = game.moves();
  lastMove = m;
  thinker = null;
  for (const p of people()) { p.hand = -1; p.hops = []; }
  view.play(m);
  const next = sides[game.turn];
  if (isPerson(next)) {
    input.buzz(next.player, 60);
    const must = mustTake();
    if (must.length === 1) setCursor(next.player, must[0]); // (only one piece can take: there it is)
  }
  const n = m.taken.length;
  afterMove = m.crown ? () => callout('Crowned', `${COLOR[mover]} has a king`, 1500)
    : n >= 2 ? () => callout(['', '', 'Double jump', 'Triple jump'][n] ?? `${n} in one go`, `${COLOR[mover]} takes ${n}`, 1300)
      : null;
  const end = game.ending();
  if (end) finish(end.winner, end.why);
  renderHud();
}

function finish(winner: Color | null, why: End) {
  stage = 'ending';
  stageT = 0;
  result = { winner, why };
  thinker = null;
  saveRecords();
  payOut();
  // (once the last move has played out)
  afterMove = () => (winner ? callout(`${COLOR[winner]} wins`, ENDS[why][1], 2400) : callout(ENDS[why][0], ENDS[why][1], 2400));
  for (const c of ['b', 'w'] as const) {
    const s = sides[c];
    if (isPerson(s)) input.buzz(s.player, winner === c ? 300 : 80);
  }
  renderHud();
}

function showResults() {
  stage = 'results';
  renderResults();
  show('results');
}

// --- pause: resume, offer a draw, resign, quit -------------------------------------------------------
// Who's asking: the one who paused, or the only person playing, or (from the keyboard's Esc) whoever's turn it is
const asker = (): Color => (pausedBy && sideOf(pausedBy)) ?? (people().length === 1 ? sideOf(people()[0])! : game.turn);
const pauseRows = () => [['resume', 'Resume'], ['draw', 'Offer a draw'], ['resign', `Resign as ${COLOR[asker()]}`], ['quit', 'Quit to the lobby']];

function pause(by: Player | null) {
  if (stage === 'paused') return resume();
  if (stage !== 'playing') return;
  stage = 'paused';
  pausedBy = by;
  pauseRow = 0;
  show('pause');
  renderPause();
}

function resume() {
  stage = 'playing';
  show('hud');
}

function choosePause() {
  const id = pauseRows()[pauseRow][0], me = asker(), them = other(me), foe = sides[them];
  if (id === 'resume') resume();
  else if (id === 'resign') finish(them, 'resign');
  else if (id === 'quit') toLobby();
  else if (!isPerson(foe)) {
    if (wantsDraw(game, them)) finish(null, 'agreed');
    else { resume(); callout('No thanks', 'The computer plays on', 1600); }
  } else {
    stage = 'offer';
    offerTo = them;
    $('offerTitle').innerHTML = `<span style="color:${foe.player.color}">${COLOR[them]}</span>, a draw?`;
    $('offerLegend').innerHTML = `<span>${COLOR[me]} offers a draw. ${escapeHtml(foe.player.label)}:</span>
      <span>${glyph('bolt')} Accept</span><span>${glyph('drop')} Play on</span>`;
    show('offer');
  }
}

function answerDraw(yes: boolean) {
  if (yes) return finish(null, 'agreed');
  resume();
  callout('Play on', `${COLOR[offerTo]} said no to a draw`, 1600);
}

// --- saved records ----------------------------------------------------------------------------------
async function loadRecord(c: Player) {
  c.record = (await saves.get<PlayerRecord>(playerKey(c))) ?? freshRecord(c.label);
  if (stage === 'lobby') renderLobby();
  loadBoards(c);
}

async function loadBoards(c: Player) {
  c.boards = await ownedItems(c);
  if (stage === 'lobby') renderLobby();
}

// Stars for both people at the board: for playing a real game, and more for winning it
function payOut() {
  if (game.history.length < MIN_PLIES) return;
  for (const c of ['b', 'w'] as const) {
    const s = sides[c];
    if (!isPerson(s)) continue;
    const why: EarnFor[] = result.winner === c ? ['played', 'won'] : ['played'];
    earnStars(s.player, why).then((got) => {
      s.player.earned = got;
      if (stage === 'results') renderResults();
    });
  }
}

function saveRecords() {
  for (const c of ['b', 'w'] as const) {
    const s = sides[c], foe = sides[other(c)];
    if (!isPerson(s)) continue;
    const p = s.player, r = p.record ?? freshRecord(p.label);
    r.name = p.label;
    r.games++;
    if (!result.winner) r.draws++;
    else if (result.winner !== c) r.losses++;
    else { r.wins++; if (!isPerson(foe)) r.beat[foe.level]++; }
    p.record = r;
    saves.set(playerKey(p), r);
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
function recordLine(r: PlayerRecord | null) {
  if (!r || !r.games) return 'First game';
  const best = [2, 1, 0].find((l) => r.beat[l]); // (the strongest computer they've beaten)
  return `${plural(r.wins, 'win', 'wins')}, ${plural(r.draws, 'draw', 'draws')}, ${plural(r.losses, 'loss', 'losses')}`
    + (best !== undefined ? ` · beat ${LEVELS[best].name} ${times(r.beat[best])}` : '');
}

input.onJoin = (c) => {
  loadRecord(c);
  if (!personChosen) settings.person = input.list.length >= 2;
  if (stage === 'lobby') renderLobby();
  else renderHud();
};
input.onLeave = () => {
  if (!personChosen) settings.person = input.list.length >= 2;
  if (stage === 'lobby') renderLobby();
};
input.onRename = () => (stage === 'lobby' ? renderLobby() : renderHud());
input.onPause = (c) => pause(c);

// --- input ------------------------------------------------------------------------------------------
const howTo = () => showManual('', 'Checkers');

function menuInput(c: Player) {
  if (manualPadInput(c)) return;
  const fx = c.flickX(), fy = c.flickY();
  if (stage === 'lobby') {
    if (fy) moveRow(fy);
    if (fx) change(fx);
  }
  if (stage === 'paused' && fy) { pauseRow = (pauseRow + fy + 4) % 4; renderPause(); }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    if (stage === 'offer') {
      const a = sideOf(c) === offerTo ? controls.action('drawOffer', ev.bit) : null; // (only the one asked can answer)
      if (a) answerDraw(a === 'accept');
    } else if (ev.bit === BIT.bolt) confirm();
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
  if (ROWS[row] === 'opponent') { settings.person = !settings.person; personChosen = true; }
  else if (ROWS[row] === 'level') settings.level = turn(settings.level, LEVELS.length);
  else if (ROWS[row] === 'side') settings.side = turn(settings.side, SIDES.length);
  else if (ROWS[row] === 'clock') settings.clock = turn(settings.clock, CLOCKS.length);
  else {
    const list = boards();
    settings.board = list[turn(Math.max(0, list.indexOf(boardOf())), list.length)].id;
    setBoard(boardOf());
  }
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

// The cursor only stands on the dark squares. On the screen: ◀▶ go to the next dark square along the
// row; ▲▼ go one row up or down, zig-zagging round the column you last chose; a diagonal flick goes
// straight there. With a piece in hand, the arrows go from one square it can land on to the next.
const screenCol = (s: number) => (flipped() ? 7 - colOf(s) : colOf(s));
const screenRow = (s: number) => (flipped() ? 7 - rowOf(s) : rowOf(s));
const onScreen = (x: number, y: number) => (flipped() ? squareAt(7 - x, 7 - y) : squareAt(x, y));

function setCursor(c: Player, s: number) {
  c.cursor = s;
  c.col = screenCol(s);
}

function moveCursor(c: Player, fx: number, fy: number) {
  const x = screenCol(c.cursor), y = screenRow(c.cursor);
  // holding a piece: an arrow goes straight to the nearest square it can go to that way
  if (c.hand >= 0) {
    const ahead = targets(c).map((t) => ({ t, dx: screenCol(t) - x, dy: screenRow(t) - y }))
      .map((o) => ({ ...o, along: o.dx * fx + o.dy * fy, across: Math.abs(o.dx * fy - o.dy * fx) }))
      .filter((o) => o.along > 0).sort((a, b) => a.along + 2 * a.across - (b.along + 2 * b.across));
    if (ahead.length) return setCursor(c, ahead[0].t);
  }
  if (fx && fy) { const t = onScreen(x + fx, y + fy); if (t >= 0) setCursor(c, t); return; }
  if (fx) { const t = onScreen(x + 2 * fx, y); if (t >= 0) setCursor(c, t); return; }
  const near = [x - 1, x + 1].filter((nx) => onScreen(nx, y + fy) >= 0)
    .sort((a, b) => Math.abs(a - c.col) - Math.abs(b - c.col) || Math.abs(a - 3.5) - Math.abs(b - 3.5));
  if (near.length) c.cursor = onScreen(near[0], y + fy);
}

function playInput(c: Player) {
  const fx = c.flickX(), fy = c.flickY();
  if (fx || fy) moveCursor(c, fx, fy);
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    const a = controls.action('play', ev.bit);
    if (a === 'move') act(c);
    else if (a === 'cancel') stepBack(c);
  }
}

// The moves the piece in hand can still make, given the hops entered so far
const options = (c: Player) => legal.filter((m) => m.from === c.hand && c.hops.every((q, i) => m.path[i] === q));
// Where it can hop to next
const targets = (c: Player) => [...new Set(options(c).map((m) => m.path[c.hops.length]))];
// The pieces that can take (and so must: captures are compulsory)
const mustTake = () => (legal[0]?.taken.length ? [...new Set(legal.map((m) => m.from))] : []);

// Bolt: pick up a piece, put it down on a square it can go to (a jump that can go on, goes on), or put it back
function act(c: Player) {
  if (sideOf(c) !== game.turn || view.sliding) return input.buzz(c, 40);
  const at = c.cursor;
  if (c.hand >= 0) {
    const next = options(c).filter((m) => m.path[c.hops.length] === at);
    if (next.length) {
      c.hops.push(at);
      const done = next.find((m) => m.path.length === c.hops.length);
      if (done) return playMove(done);
      const t = targets(c);
      if (t.length === 1) setCursor(c, t[0]); // (only one way on: the cursor goes there)
      return;
    }
    if (c.hops.length) return input.buzz(c, 40); // (half way through a jump: it has to go on)
    if (at === c.hand) { c.hand = -1; return; }
  }
  if (legal.some((m) => m.from === at)) {
    c.hand = at;
    c.hops = [];
    const t = targets(c);
    if (t.length === 1) setCursor(c, t[0]);
    return;
  }
  input.buzz(c, 40);
  if (mustTake().length && game.board[at] && colorOf(game.board[at]) === game.turn) callout('You must take', 'A piece that can jump has to', 1300);
}

// Drop: back one hop, or put the piece back
function stepBack(c: Player) {
  if (c.hops.length) { c.hops.pop(); setCursor(c, c.hops.length ? c.hops[c.hops.length - 1] : c.hand); }
  else if (c.hand >= 0) { setCursor(c, c.hand); c.hand = -1; }
}

addEventListener('keydown', (e) => {
  if (manualOpen()) return;
  const code = keyCode(e);
  if (code === 'KeyI' && stage === 'lobby') howTo();
  else if (code === 'Enter') confirm();
  else if (code === 'Escape') (stage === 'playing' || stage === 'paused' ? pause(null) : stage === 'offer' ? answerDraw(false) : back());
  else if (code === 'KeyP') pause(null);
});

// --- the computer and the clocks ----------------------------------------------------------------------
function computerTurn(dt: number) {
  const s = sides[game.turn];
  if (isPerson(s) || view.sliding) return;
  if (!thinker) { thinker = new Thinker(game, s.level); thinkFor = 0.5 + Math.random() * 0.5; }
  thinkFor -= dt;
  if (!thinker.step(device.tv ? 6 : 8) || thinkFor > 0) return; // (a few ms a frame, so the screen stays smooth)
  const m = thinker.move!;
  playMove(legal.find((x) => sameMove(x, m))!);
}

function tickClock(dt: number) {
  if (!clocks || !game.history.length) return; // (the clocks start with Black's first move)
  const c = game.turn;
  clocks[c] = Math.max(0, clocks[c] - dt);
  if (!clocks[c]) finish(other(c), 'time');
}

const clockText = (t: number) => (t < 10 ? t.toFixed(1) : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

// --- the phones -------------------------------------------------------------------------------------
// The labels for a context, by action, wherever controls.json put them
function labels(ctx: 'play' | 'drawOffer', names: Partial<Record<string, string>>) {
  const out: Partial<Record<Button, string>> = {};
  for (const [key, action] of controls.bindings(ctx)) if (names[action] && !key.includes('+')) out[key as Button] = names[action];
  return out;
}

function padScreen(c: Player): PadScreen {
  const me = sideOf(c);
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: me && stage !== 'lobby' ? `Checkers · ${COLOR[me]}` : 'Checkers', accent: c.color };
  if (manualOpen()) return manualScreen(base);
  switch (stage) {
    case 'lobby': return { ...base, labels: { bolt: 'Start', drop: 'Games', star: 'How to play' }, hint: '▲▼ choose · ◀▶ change' };
    case 'results': {
      const hint = !me ? 'Game over' : !result.winner ? 'A draw' : result.winner === me ? 'You won!' : 'You lost this one';
      return { ...base, labels: { bolt: 'Rematch', drop: 'Lobby' }, hint };
    }
    case 'paused': return { ...base, labels: { bolt: 'Choose', drop: 'Resume' }, hint: 'Paused: ▲▼ choose' };
    case 'offer': return me === offerTo
      ? { ...base, labels: controls.labels('drawOffer'), hint: `${COLOR[other(me)]} offers a draw` }
      : { ...base, labels: {}, hint: `Waiting for ${COLOR[offerTo]} to answer` };
    case 'ending': return { ...base, labels: {}, hint: ENDS[result.why][0] };
    default: {
      if (!me) return { ...base, labels: {}, hint: 'Watching' };
      if (me !== game.turn) return { ...base, labels: {}, hint: isPerson(sides[game.turn]) ? `Waiting for ${COLOR[game.turn]}` : 'The computer is thinking' };
      if (c.hops.length) return { ...base, labels: labels('play', { move: 'Hop', cancel: 'Back a hop' }), hint: 'Keep jumping: where next?' };
      if (c.hand >= 0) return { ...base, labels: labels('play', { move: 'Put down', cancel: 'Put back' }), hint: mustTake().length ? 'Jump where?' : 'Move it where?' };
      return { ...base, labels: labels('play', { move: 'Pick up' }), hint: mustTake().length ? 'You must take: pick a piece that can jump' : 'Your move: pick a piece' };
    }
  }
}

// --- screens ------------------------------------------------------------------------------------------
function show(screen: 'lobby' | 'hud' | 'results' | 'pause' | 'offer') {
  for (const id of ['lobby', 'hud', 'results', 'pause', 'offer']) $(id).classList.toggle('hidden', id !== screen && !(id === 'hud' && screen !== 'lobby'));
  layout();
}

// Fit the board into its space on this screen
function layout() {
  const r = $(stage === 'lobby' ? 'lobbyBoard' : 'boardArea').getBoundingClientRect();
  view.layout({ x: r.left, y: r.top, w: r.width, h: r.height });
}

function renderLobby() {
  const here = [...input.list].sort(bySlot);
  $('players').innerHTML = here.length
    ? here.map((c) => `<div class="who">${chip(c)}<span class="caption faint">${escapeHtml(recordLine(c.record))}</span></div>`).join('')
    : '<p class="muted" style="margin:0">Join with your phone to play. On your own? Take on the computer.</p>';
  const label = {
    opponent: 'Opponent', level: 'Computer', clock: 'Clock', board: 'Board',
    side: settings.person && here.length >= 2 ? `${escapeHtml(here[0].label)} plays` : 'Play as',
  };
  const value = {
    opponent: settings.person ? 'A person' : 'Computer', level: LEVELS[settings.level].name,
    side: SIDES[settings.side], clock: CLOCKS[settings.clock] ? `${CLOCKS[settings.clock]} min` : 'None',
    board: escapeHtml(boardOf().name),
  };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r === 'level' && settings.person ? 'off' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${value[r]}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
}

function card(c: Color) {
  const s = sides[c], mine = c === game.turn && stage === 'playing';
  const who = isPerson(s) ? chip(s.player) : `<span class="chip" style="--pc:var(--chalk-2)"><b>CPU</b>${LEVELS[s.level].name}</span>`;
  const { men, kings } = game.count(c), left = men + kings, theirs = game.count(other(c)), lead = left - theirs.men - theirs.kings;
  const pieces = pieceSvg(true, c).repeat(kings) + pieceSvg(false, c).repeat(men);
  const note = !mine ? '' : !isPerson(s) ? 'Thinking…' : legal[0]?.taken.length ? 'To move · must take' : 'To move';
  return `<div class="top">${who}<span class="caption">${COLOR[c]}</span></div>
    ${clocks ? `<div class="clock num" data-c="${c}">${clockText(clocks[c])}</div>` : ''}
    <div class="left"><span class="count num">${left}</span><span class="caption faint">${kings ? `${plural(kings, 'king', 'kings')} · ` : ''}${plural(men, 'man', 'men')}</span>${lead > 0 ? `<span class="lead">+${lead}</span>` : ''}</div>
    <div class="taken">${pieces}</div>
    <div class="caption note">${note}</div>`;
}

function renderHud() {
  const bottom: Color = flipped() ? 'b' : 'w', top = other(bottom);
  for (const [id, c] of [['topCard', top], ['bottomCard', bottom]] as const) {
    $(id).innerHTML = card(c);
    $(id).classList.toggle('turn', c === game.turn && stage === 'playing');
  }
  const h = game.history, rows: string[] = [];
  for (let i = 0; i < h.length; i += 2) {
    const name = (j: number) => (j >= h.length ? '' : j === h.length - 1 ? `<b>${h[j]}</b>` : h[j]);
    rows.push(`<div class="mv"><span class="num faint">${i / 2 + 1}.</span><span>${name(i)}</span><span>${name(i + 1)}</span></div>`);
  }
  $('moves').innerHTML = rows.slice(-12).join('') || '<p class="faint" style="margin:0">No moves yet. Black goes first.</p>';
}

function renderClocks() {
  if (!clocks) return;
  for (const el of document.querySelectorAll<HTMLElement>('.clock')) {
    const t = clocks[el.dataset.c as Color];
    el.textContent = clockText(t);
    el.classList.toggle('low', t < 20);
  }
}

function renderPause() {
  $('pauseRows').innerHTML = pauseRows().map(([, label], i) =>
    `<div class="setting ${i === pauseRow ? 'sel' : ''}"><span>${label}</span></div>`).join('');
  $('pauseLegend').innerHTML = `<span>${glyph('dpad')} Choose</span><span>${glyph('bolt')} OK</span><span>${glyph('drop')} Resume</span>`;
}

function renderResults() {
  const w = result.winner;
  $('why').textContent = w && result.why === 'resign' ? `${COLOR[other(w)]} resigned`
    : w && result.why === 'noPieces' ? `${COLOR[other(w)]} has no pieces left`
      : w && result.why === 'noMoves' ? `${COLOR[other(w)]} has no move left` : ENDS[result.why][1];
  $('winner').innerHTML = w ? `<span class="hl-volt">${COLOR[w]}</span> wins` : 'A draw';
  $('standings').innerHTML = (['b', 'w'] as const).map((c) => {
    const s = sides[c];
    const who = isPerson(s) ? chip(s.player) : `<span class="chip" style="--pc:var(--chalk-2)"><b>CPU</b>${LEVELS[s.level].name}</span>`;
    const line = isPerson(s) ? recordLine(s.player.record) : 'The computer';
    const got = isPerson(s) && s.player.earned?.earned ? ` +${starsLabel(s.player.earned.earned)}` : '';
    return `<div class="standing ${c === w ? 'first' : ''}">${who}<span class="caption">${COLOR[c]}</span>
      <span class="caption faint">${escapeHtml(line)}${got}</span><b>${!w ? 'Draw' : c === w ? 'Win' : 'Loss'}</b></div>`;
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
function scene(): Scene {
  const inGame = stage === 'playing' || stage === 'paused' || stage === 'offer';
  const mover = sides[game.turn], holder = inGame && isPerson(mover) && mover.player.hand >= 0 ? mover.player : null;
  const must = inGame && isPerson(mover) ? mustTake() : [];
  return {
    game, flipped: flipped(), lastMove,
    held: holder && { from: holder.hand, hops: holder.hops, taken: options(holder)[0]?.taken.slice(0, holder.hops.length) ?? [], color: holder.color },
    targets: holder ? targets(holder) : [],
    must: must.length && isPerson(mover) ? { squares: must, color: mover.player.color } : null,
    cursors: inGame ? people().filter((p) => p.connected).map((p) => ({ sq: p.cursor, color: p.color, active: sideOf(p) === game.turn })) : [],
  };
}

let last = performance.now(), padT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'playing' ? playInput(c) : menuInput(c));
  if (stage === 'playing') { tickClock(dt); computerTurn(dt); }
  if (afterMove && !view.sliding) { const f = afterMove; afterMove = null; f(); }
  if (stage === 'ending' && !view.sliding && (stageT += dt) > 2.8) showResults();
  view.frame(scene(), now);
  padT += dt;
  if (padT > 0.05) {
    padT = 0;
    renderClocks();
    for (const c of input.list) input.show(c, padScreen(c));
  }
}

addEventListener('resize', layout);
hostInfo().then((info) => { $('url').textContent = info.padUrl; $('qr').innerHTML = info.qr; });
$('legend').innerHTML = `<span>${glyph('dpad')} Move your square</span><span>${glyph('bolt')} Pick up, put down, hop</span><span>${glyph('drop')} Back a hop, put back</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('rematch').addEventListener('click', rematch);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
toLobby();
requestAnimationFrame(frame);
