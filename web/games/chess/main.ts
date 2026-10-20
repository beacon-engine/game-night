// Chess: the game flow. Lobby, the game (cursors, picking up and putting down, promotion, clocks, the
// computer's turn), pause with a draw offer or resigning, results, saved records.
// The rules are in rules.ts, the computer player in ai.ts, the drawing in draw.ts.
import {
  $, backToHub, BIT, chip, escapeHtml, gameSaves, glyph, hostInfo, Input, keyCode, loadControls, manualOpen,
  manualPadInput, manualScreen, playerKey, requireDevice, showManual, type Button, type Pad, type PadScreen,
} from '@platform';
import { LEVELS, Thinker, wantsDraw } from './ai.ts';
import { pieceSvg, PROMOTIONS, View, type Scene } from './draw.ts';
import { Chess, fileOf, other, PIECE_NAME, rankOf, sq, typeOf, type Color, type Move } from './rules.ts';

const device = await requireDevice(); // (a light game: runs almost anywhere)
const controls = await loadControls(['play', 'drawOffer'] as const, ['move', 'cancel', 'accept', 'decline'] as const);
const saves = gameSaves();

// What we remember about each player. beat: wins against the computer at each strength (Easy, Medium, Hard).
interface PlayerRecord { name: string; games: number; wins: number; draws: number; losses: number; beat: number[] }
const freshRecord = (name: string): PlayerRecord => ({ name, games: 0, wins: 0, draws: 0, losses: 0, beat: [0, 0, 0] });

const input = new Input({ state: () => ({ record: null as PlayerRecord | null, cursor: sq(4, 1), hand: -1 }) });
type Player = Pad<{ record: PlayerRecord | null; cursor: number; hand: number }>; // hand: the square of the piece in hand (-1: none)

// --- settings, chosen in the lobby --------------------------------------------------------------
const CLOCKS = [0, 5, 10]; // minutes each (0: no clock)
const SIDES = ['White', 'Black', 'Random'];
const settings = { person: false, level: 1, side: 0, clock: 0 }; // person: against another person, not the computer
let personChosen = false; // (until someone changes it, the opponent follows how many phones have joined)
const ROWS = ['opponent', 'level', 'side', 'clock'] as const;
let row = 0;

// Who plays each colour: a person, or the computer at a strength
type Side = { player: Player } | { level: number };
const sides: Record<Color, Side> = { w: { level: 1 }, b: { level: 1 } };
const isPerson = (s: Side): s is { player: Player } => 'player' in s;
const sideOf = (p: Player) => (['w', 'b'] as const).find((c) => { const s = sides[c]; return isPerson(s) && s.player === p; }) ?? null;
const people = () => (['w', 'b'] as const).map((c) => sides[c]).filter(isPerson).map((s) => s.player);
const flipped = () => !isPerson(sides.w) && isPerson(sides.b); // (on your own as Black, Black is at the bottom)
const COLOR = { w: 'White', b: 'Black' };

type Stage = 'lobby' | 'playing' | 'paused' | 'offer' | 'ending' | 'results';
let stage: Stage = 'lobby';
let stageT = 0;
let game = new Chess();
let legal = game.moves();
let lastMove: Move | null = null;
let taken: Record<Color, number[]> = { w: [], b: [] }; // the piece types each side has taken
let clocks: Record<Color, number> | null = null; // seconds left
let thinker: Thinker | null = null;
let thinkFor = 0; // the computer's pause before moving, so its moves don't appear instantly
let promo: { player: Player; moves: Move[]; choice: number } | null = null; // a pawn reaching the far side
let pausedBy: Player | null = null;
let pauseRow = 0;
let offerTo: Color = 'b';
let result: { winner: Color | null; why: End } = { winner: null, why: 'agreed' };

// How a game can end: what the callout says, and the longer reason on the results
type End = 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | 'time' | 'resign' | 'agreed';
const ENDS: Record<End, [string, string]> = {
  checkmate: ['Checkmate', 'Checkmate'],
  stalemate: ['Stalemate', 'Stalemate: no legal move, but not in check'],
  fifty: ['Draw', 'Fifty moves each with no capture and no pawn moved'],
  repetition: ['Draw', 'The same position three times'],
  material: ['Draw', 'Not enough pieces left to checkmate'],
  time: ['Out of time', 'Out of time'],
  resign: ['Resigned', 'Resigned'],
  agreed: ['Draw agreed', 'Draw agreed'],
};

const view = new View($<HTMLCanvasElement>('board'));

// --- flow -------------------------------------------------------------------------------------------
const bySlot = (a: Player, b: Player) => a.slot - b.slot;

function toLobby() {
  stage = 'lobby';
  promo = null;
  thinker = null;
  show('lobby');
  renderLobby();
}

function start() {
  const here = [...input.list].sort(bySlot);
  if (!here.length) return callout('Join first', 'Scan the code, or press a key on the keyboard');
  if (settings.person && here.length < 2) return callout('Two players', 'A second player needs to join');
  const first: Color = settings.side === 2 ? (Math.random() < 0.5 ? 'w' : 'b') : settings.side === 0 ? 'w' : 'b';
  sides[first] = { player: here[0] };
  sides[other(first)] = settings.person ? { player: here[1] } : { level: settings.level };
  newGame();
}

// The same players, colours swapped
function rematch() {
  if (people().some((p) => !p.connected)) return toLobby();
  [sides.w, sides.b] = [sides.b, sides.w];
  newGame();
}

function newGame() {
  game = new Chess();
  legal = game.moves();
  lastMove = null;
  thinker = null;
  promo = null;
  taken = { w: [], b: [] };
  clocks = CLOCKS[settings.clock] ? { w: CLOCKS[settings.clock] * 60, b: CLOCKS[settings.clock] * 60 } : null;
  for (const c of ['w', 'b'] as const) {
    const s = sides[c];
    if (isPerson(s)) { s.player.cursor = sq(4, c === 'w' ? 1 : 6); s.player.hand = -1; } // (on the king's pawn)
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
  promo = null;
  if (m.captured) taken[mover].push(typeOf(m.captured));
  for (const p of people()) p.hand = -1;
  view.slide(m);
  const next = sides[game.turn];
  if (isPerson(next)) input.buzz(next.player, 60);
  const end = game.ending();
  if (end) finish(end.winner, end.why);
  else if (game.inCheck()) callout('Check', `${COLOR[game.turn]} must get out of it`, 1300);
  renderHud();
}

function finish(winner: Color | null, why: End) {
  stage = 'ending';
  stageT = 0;
  result = { winner, why };
  promo = null;
  thinker = null;
  saveRecords();
  callout(ENDS[why][0], winner ? `${COLOR[winner]} wins` : 'A draw', 2400);
  for (const c of ['w', 'b'] as const) {
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
}

function saveRecords() {
  for (const c of ['w', 'b'] as const) {
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
const howTo = () => showManual('', 'Chess');
const clamp = (n: number) => Math.max(0, Math.min(7, n));

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
  else settings.clock = turn(settings.clock, CLOCKS.length);
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

function playInput(c: Player) {
  const fx = c.flickX(), fy = c.flickY();
  if (promo?.player === c) { if (fx) promo.choice = (promo.choice + fx + 4) % 4; }
  else if (fx || fy) {
    const d = flipped() ? -1 : 1; // (the arrows move the cursor the way they point on the screen)
    c.cursor = sq(clamp(fileOf(c.cursor) + fx * d), clamp(rankOf(c.cursor) - fy * d));
  }
  for (const ev of c.drain()) {
    if (!ev.down) continue;
    const a = controls.action('play', ev.bit);
    if (a === 'move') act(c);
    else if (a === 'cancel') { if (promo?.player === c) promo = null; else c.hand = -1; }
  }
}

// Bolt: pick up a piece, put it down on a square it can go to, or put it back
function act(c: Player) {
  if (promo?.player === c) return playMove(promo.moves.find((m) => m.promo === PROMOTIONS[promo!.choice])!);
  if (sideOf(c) !== game.turn || view.sliding) return input.buzz(c, 40);
  const at = c.cursor;
  if (c.hand >= 0) {
    const to = legal.filter((m) => m.from === c.hand && m.to === at);
    if (to.length > 1) { promo = { player: c, moves: to, choice: 0 }; return; } // (four moves: one per piece it can become)
    if (to.length) return playMove(to[0]);
    if (at === c.hand) { c.hand = -1; return; }
  }
  if (legal.some((m) => m.from === at)) c.hand = at;
  else input.buzz(c, 40);
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
  playMove(legal.find((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)!);
}

function tickClock(dt: number) {
  if (!clocks || !game.history.length) return; // (the clocks start with White's first move)
  const c = game.turn;
  clocks[c] = Math.max(0, clocks[c] - dt);
  if (!clocks[c]) finish(game.canMate(other(c)) ? other(c) : null, 'time'); // (no win on time without the pieces to mate)
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
  const base = { layout: 'dpad' as const, label: c.tag, color: c.color, title: me && stage !== 'lobby' ? `Chess · ${COLOR[me]}` : 'Chess', accent: c.color };
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
      if (promo?.player === c) return { ...base, labels: labels('play', { move: 'Choose', cancel: 'Cancel' }), hint: 'The pawn becomes? ◀▶ to choose' };
      if (c.hand >= 0) return { ...base, labels: labels('play', { move: 'Put down', cancel: 'Put back' }), hint: `Move the ${PIECE_NAME[typeOf(game.board[c.hand])]} where?` };
      return { ...base, labels: labels('play', { move: 'Pick up' }), hint: game.inCheck() ? 'Check! Your move: pick a piece' : 'Your move: pick a piece' };
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
    opponent: 'Opponent', level: 'Computer', clock: 'Clock',
    side: settings.person && here.length >= 2 ? `${escapeHtml(here[0].label)} plays` : 'Play as',
  };
  const value = {
    opponent: settings.person ? 'A person' : 'Computer', level: LEVELS[settings.level].name,
    side: SIDES[settings.side], clock: CLOCKS[settings.clock] ? `${CLOCKS[settings.clock]} min` : 'None',
  };
  $('settings').innerHTML = ROWS.map((r, i) => `<div class="setting ${i === row ? 'sel' : ''} ${r === 'level' && settings.person ? 'off' : ''}">
      <span>${label[r]}</span><span class="value"><span class="glyph glyph-key">◀</span><b>${value[r]}</b><span class="glyph glyph-key">▶</span></span></div>`).join('');
}

const VALUE = [0, 1, 3, 3, 5, 9, 0];
function card(c: Color) {
  const s = sides[c], mine = c === game.turn && stage === 'playing';
  const who = isPerson(s) ? chip(s.player) : `<span class="chip" style="--pc:var(--chalk-2)"><b>CPU</b>${LEVELS[s.level].name}</span>`;
  const lead = taken[c].reduce((n, t) => n + VALUE[t], 0) - taken[other(c)].reduce((n, t) => n + VALUE[t], 0);
  const pieces = [...taken[c]].sort((a, b) => b - a).map((t) => pieceSvg(t, other(c))).join('');
  const note = !mine ? '' : isPerson(s) ? 'To move' : 'Thinking…';
  return `<div class="top">${who}<span class="caption">${COLOR[c]}</span></div>
    ${clocks ? `<div class="clock num" data-c="${c}">${clockText(clocks[c])}</div>` : ''}
    <div class="taken">${pieces}${lead > 0 ? `<span class="lead">+${lead}</span>` : ''}</div>
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
    const san = (j: number) => (j >= h.length ? '' : j === h.length - 1 ? `<b>${h[j]}</b>` : h[j]);
    rows.push(`<div class="mv"><span class="num faint">${i / 2 + 1}.</span><span>${san(i)}</span><span>${san(i + 1)}</span></div>`);
  }
  $('moves').innerHTML = rows.slice(-12).join('') || '<p class="faint" style="margin:0">No moves yet</p>';
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
  $('why').textContent = w && result.why === 'resign' ? `${COLOR[other(w)]} resigned` : ENDS[result.why][1];
  $('winner').innerHTML = w ? `<span class="hl-volt">${COLOR[w]}</span> wins` : 'A draw';
  $('standings').innerHTML = (['w', 'b'] as const).map((c) => {
    const s = sides[c];
    const who = isPerson(s) ? chip(s.player) : `<span class="chip" style="--pc:var(--chalk-2)"><b>CPU</b>${LEVELS[s.level].name}</span>`;
    const line = isPerson(s) ? recordLine(s.player.record) : 'The computer';
    return `<div class="standing ${c === w ? 'first' : ''}">${who}<span class="caption">${COLOR[c]}</span>
      <span class="caption faint">${escapeHtml(line)}</span><b>${!w ? 'Draw' : c === w ? 'Win' : 'Loss'}</b></div>`;
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
  return {
    game, flipped: flipped(), lastMove,
    held: holder && { sq: holder.hand, color: holder.color },
    targets: holder ? legal.filter((m) => m.from === holder.hand) : [],
    cursors: inGame ? people().filter((p) => p.connected).map((p) => ({ sq: p.cursor, color: p.color, active: sideOf(p) === game.turn })) : [],
    promo: promo && { side: game.turn, choice: promo.choice, color: promo.player.color },
  };
}

let last = performance.now(), padT = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of input.list) (stage === 'playing' ? playInput(c) : menuInput(c));
  if (stage === 'playing') { tickClock(dt); computerTurn(dt); }
  if (stage === 'ending' && (stageT += dt) > 2.6) showResults();
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
$('legend').innerHTML = `<span>${glyph('dpad')} Move your square</span><span>${glyph('bolt')} Pick up, put down</span><span>${glyph('drop')} Put back</span>`;
$('back').addEventListener('click', backToHub);
$('start').addEventListener('click', start);
$('howto').addEventListener('click', howTo);
$('rematch').addEventListener('click', rematch);
$('toLobby').addEventListener('click', toLobby);
document.body.classList.toggle('tv', device.tv);
toLobby();
requestAnimationFrame(frame);
