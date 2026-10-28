// Match simulation: players, ball physics, rules (fouls, cards, set pieces), human control and AI.
import * as THREE from 'three';
import type { Weather } from '@world/weather.ts';
import { BIT, type Pad } from '@platform';
import type { Action, Context, FootballControls } from './actions.ts';
import { KICK_CONTACT, PlayerModel, type Strike, type BodyState, type Card, type Fall, type Foot, type SkillKind } from './player.ts';
import { DEFAULT_TACTICS, tune, type Tactics, type Tune } from './tactics.ts';
import { Footed, type Club, type DribbleStyle, type FormationSlot, type Kit, type PlayerData, type Settings, type Stat } from './types.ts';

// ------------------------------------------------------------------- types --
// A person playing, on a pad: the platform's controller plus what the match tracks for them
export interface HumanState {
  team: 0 | 1;
  player: Player | null; // the footballer they control
  charge: number; // shot power building up while the button is held, or -1
  chargeBit: number; // the button doing the charging
  armed: { bit: number; ctx: Context; swipe: boolean } | null; // waiting to see if a press becomes a swipe
  pressing: boolean; // holding "teammate press"
}
export type Human = Pad<HumanState>;
export const newHuman = (): HumanState => ({ team: 0, player: null, charge: -1, chargeBit: 0, armed: null, pressing: false });

interface Point { x: number; z: number }
type Aim = Point | null; // stick direction on the pitch, or none

interface Motion { x: number; y: number; z: number; vx: number; vy: number; vz: number; curl?: number } // (curl: see CURL)

export interface Ball extends Motion {
  owner: Player | null;
  lastTouch: Team;
  lastPlayer: Player | null;
  inNet: boolean;
  footBy: Team | null; // kicked (or thrown in) deliberately by this team: their keeper can't handle it
}

export type MatchState = 'play' | 'goal' | 'out' | 'halftime' | 'fulltime';
export type SetPieceKind = 'kickoff' | 'freekick' | 'penalty' | 'corner' | 'goalkick' | 'throw';

export type MatchEvent =
  | { type: 'kick'; power: number }
  | { type: 'post' }
  | { type: 'net'; x: number; y: number; z: number; speed: number } // the ball hit the net (it billows)
  | { type: 'shot' }
  | { type: 'save'; parry?: boolean; block?: boolean }
  | { type: 'tackle'; controller: Human | null }
  | { type: 'buzz'; controller: Human; ms: number }
  | { type: 'skill'; kind: SkillKind; player: Player }
  | { type: 'foul'; fouler: Player; victim: Player; card: Card | null; penalty: boolean }
  | { type: 'sendoff'; player: Player }
  | { type: 'sub'; team: Team; off: Player; on: Player }
  | { type: 'banner'; text: string }
  | { type: 'kickoff'; team: Team }
  | { type: 'goal'; team: Team; scorer?: string; own: boolean }
  | { type: 'halftime' }
  | { type: 'secondhalf' }
  | { type: 'fulltime' };

// A shot's fate, decided the moment it's struck; the keeper then acts it out
interface ShotPlan {
  gk: Player;
  z: number;
  y: number;
  tArrive: number;
  diveAt: number;
  outcome: 'wide' | 'beaten' | 'parry' | 'catch';
  reach: number;
}

interface PassPlan { tgt: Player; tx: number; tz: number; lob: boolean; margin: number }
interface KickOptions { angle?: number; arrive?: number }

interface Referee {
  x: number; z: number; vx: number; vz: number; facing: number;
  point: number; // pointing at the spot, for this long
  card: Card | null;
  cardT: number;
  cardFor: Player | null;
  model: PlayerModel;
}

// dead balls the taker runs up to (the rest are tapped or thrown from where he stands)
const RUN_UP: SetPieceKind[] = ['freekick', 'penalty', 'corner', 'goalkick'];

// ------------------------------------------------------------------ physics --
const GRAV = 9.81;
const DRAG = 0.012; // quadratic air drag (a real football is ~0.01-0.015 per metre)

// Bend (the Magnus effect): a ball struck with spin swerves sideways, by `curl` m/s² at full pace
// (less as it slows), the spin fading in the air and quickly once it's rolling. You put it on by
// holding the stick to one side just after you strike it (`window` s); the computer curls some of its
// shots round the keeper.
const CURL = { most: 7, rate: 22, window: 0.4, pace: 14, decay: 0.35, rolling: 2.5, bounce: 0.6, ai: 4.5, aiChance: 0.4 };

// Striking it where you aren't facing: up to `free` rad off is a normal pass or shot (the hips turn
// into it); past that, the further round it is the more it costs: less pace, more error, and a
// stumble after a really awkward one. Before a strike, the player turns toward where it's going
// (`turn` rad/s) and strikes once he's within `turned` of it, or after `hurry` s of turning anyway.
const BALANCE = { free: 0.6, error: 2, spread: 0.22, power: 0.3, stumble: 0.55, stumbleT: 0.35, turn: 10, turned: 1.2, hurry: { human: 0.35, ai: 0.45 }, giveUp: 1.2 };
const ROLL_A = 0.7, ROLL_B = 0.13; // rolling resistance on grass: decel = A + B * speed

const SNOW_BALL = '#ff7a1a';

// How close a body part has to be to the ball for it to touch it (m, centre to the part)
const CONTACT = {
  foot: 0.5, // a kick: the boot to the ball, across the ground
  set: 0.55, // the ball must be this close to where the boot will meet it before the swing starts
  again: 1.0, // further than that at the strike, but within this: he steps in and swings again (any further, he missed it)
  head: 0.32, chest: 0.36, thigh: 0.34, // controlling a ball in the air
  reachReceiver: 0.12, // the intended receiver stretches a little further for it
  snap: 0.2, // m the ball may be drawn onto the boot as it's struck (more would show)
};

// Where each part that takes a ball out of the air is on a player of height 1 (m up, m in front)
const PARTS = { head: { up: 1.72, fwd: 0.05 }, chest: { up: 1.3, fwd: 0.14 }, thigh: { up: 0.78, fwd: 0.2 } } as const;

// The pitch as the weather has left it (setPitch). A wet pitch is quicker: the ball skids on and
// keeps its pace, and bounces lower. Snow holds the ball up: it rolls short and hardly bounces.
// Players lose a little footing on either. Shared by the real ball and every prediction of it.
const PITCH = {
  dry: { rollA: ROLL_A, rollB: ROLL_B, bounce: 0.62, skid: 0.87, footing: 1 },
  soaked: { rollA: ROLL_A * 0.6, rollB: ROLL_B * 0.75, bounce: 0.5, skid: 0.95, footing: 0.88 },
  snow: { rollA: ROLL_A * 2.4, rollB: ROLL_B * 1.6, bounce: 0.32, skid: 0.7, footing: 0.84 },
};
const pitch = { ...PITCH.dry };

export function setPitch(w: Weather | null) {
  if (w?.snow) return void Object.assign(pitch, PITCH.snow);
  const k = w?.wet ?? 0, d = PITCH.dry, s = PITCH.soaked;
  for (const key of Object.keys(d) as (keyof typeof d)[]) pitch[key] = d[key] + (s[key] - d[key]) * k;
}
export const BALL_R = 0.12;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const tmpV = new THREE.Vector3();
const NET_FELT = 1.5; // m/s: slower than this into the net, it just drops

// Advance a free ball one step: gravity, air drag, bounces, rolling resistance.
// Used both for the real ball and for predicting where a kick will go.
function ballStep(b: Motion, dt: number) {
  if (b.curl) {
    // swerve across its line of flight (to its right for a positive curl)
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.5) {
      const a = b.curl * Math.min(1, sp / CURL.pace) * dt;
      const ux = b.vx / sp, uz = b.vz / sp;
      b.vx += uz * a;
      b.vz -= ux * a;
      const k = Math.hypot(b.vx, b.vz);
      b.vx *= sp / k; // (it bends the ball's path; it doesn't speed it up)
      b.vz *= sp / k;
    }
    const rolling = b.y <= BALL_R + 0.005 && b.vy === 0;
    b.curl *= Math.max(0, 1 - dt * (rolling ? CURL.rolling : CURL.decay));
    if (Math.abs(b.curl) < 0.05) b.curl = 0;
  }
  if (b.y > BALL_R + 0.005 || b.vy > 0) {
    const v = Math.hypot(b.vx, b.vy, b.vz);
    const k = Math.min(0.5, DRAG * v * dt);
    b.vx -= b.vx * k;
    b.vy -= b.vy * k;
    b.vz -= b.vz * k;
    b.vy -= GRAV * dt;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  if (b.y < BALL_R) {
    b.y = BALL_R;
    if (b.vy < -0.6) {
      // grass gives back a bit over half the vertical speed and takes a little pace off,
      // so a dropping ball bounces several times in shrinking hops and runs on
      const e = pitch.bounce - Math.min(0.12, -b.vy * 0.008);
      b.vy = -b.vy * Math.max(0.1, e);
      b.vx *= pitch.skid;
      b.vz *= pitch.skid;
      if (b.curl) b.curl *= CURL.bounce;
    } else b.vy = 0;
  }
  if (b.y <= BALL_R + 0.005 && b.vy === 0) {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - (pitch.rollA + pitch.rollB * sp) * dt);
      b.vx *= ns / sp;
      b.vz *= ns / sp;
    }
  }
}

// Distance a lofted ball travels before its first bounce
function loftRange(v: number, ang: number, y0: number) {
  const s = { x: 0, y: y0, z: 0, vx: v * Math.cos(ang), vy: v * Math.sin(ang), vz: 0 };
  for (let i = 0; i < 400; i++) {
    ballStep(s, 1 / 60);
    if (i > 3 && s.y <= BALL_R + 0.005) return s.x;
  }
  return s.x;
}

// Launch speed for a lofted ball at a given elevation to land `d` metres away
function loftSpeed(d: number, ang: number, y0 = BALL_R) {
  let lo = 2, hi = 45;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (loftRange(mid, ang, y0) < d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Speed a ground pass needs to cover `d` metres and still be moving at `arrive` m/s
function groundSpeed(d: number, arrive: number) {
  const dist = (v0: number) => (v0 - arrive) / pitch.rollB - (pitch.rollA / (pitch.rollB * pitch.rollB)) * Math.log((pitch.rollA + pitch.rollB * v0) / (pitch.rollA + pitch.rollB * arrive));
  let lo = arrive, hi = 34;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (dist(mid) < d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Vertical launch speed so a ball struck at horizontal speed vh is at height h after d metres
function shotVy(d: number, vh: number, h: number, y0 = BALL_R) {
  const heightAt = (vy: number) => {
    const s = { x: 0, y: y0, z: 0, vx: vh, vy, vz: 0 };
    for (let i = 0; i < 300 && s.x < d; i++) ballStep(s, 1 / 60);
    return s.y;
  };
  let lo = -2, hi = 14;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) < h) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const REF_KIT: Kit = { shirt: '#111111', shorts: '#111111', socks: '#111111', number: '#facc15', trim: '#facc15', pattern: 'plain' };

// ------------------------------------------------------------------- teams --
export class Team {
  opp!: Team; // set once both teams exist
  side: number; // +1: attacking toward +x
  score = 0;
  players: Player[] = []; // on the pitch
  bench: PlayerData[] = [];
  humans: Human[] = [];
  subsLeft = 5;
  autoSubs = 0; // made by the AI manager
  stats = { poss: 0, shots: 0, onTarget: 0, fouls: 0, passes: 0 };
  tactics: Tactics = DEFAULT_TACTICS;
  tune: Tune = tune(DEFAULT_TACTICS); // what the instructions mean for the AI
  wonAt = -99; // when we last won the ball off them (for breaking forward)

  constructor(readonly idx: 0 | 1, readonly club: Club) {
    this.side = idx === 0 ? 1 : -1; // home attacks +x
  }

  instruct(t: Tactics) {
    this.tactics = t;
    this.tune = tune(t);
  }
}

export class Player {
  readonly name: string;
  readonly number: number;
  readonly model: PlayerModel;
  readonly maxSpeed: number; // pace: about 7.0 m/s at 60 up to 8.4 m/s at 100
  readonly mass: number; // kg: bigger builds and physical defenders are heavier; decides who wins a bump
  // how he carries the ball: 'close' (little touches), 'knock' (push it into space and race onto
  // it) or 'balanced'. Can be set per player in teams.json.
  readonly style: DribbleStyle;
  readonly footed: Footed; // his better foot (teams.json "foot"), or both
  striking: Footed.Left | Footed.Right = Footed.Right; // the foot this kick is with
  strikeKind: Strike = 'kick'; // a kick or a pass (which strike the model plays)
  human: Human | null = null;

  x = 0; z = 0; vx = 0; vz = 0;
  facing = 0;
  wantX = 0; wantZ = 0; wantSprint = false; // where the stick (or the AI) wants him to go
  pvx = 0; pvz = 0; af = 0; al = 0; // last velocity, smoothed acceleration (for leaning)
  faceMove = false;

  // stamina: energy runs down with running (faster for low-stamina players) and recovers when easing off
  energy = 1;
  energyCap = 1;

  kickCd = 0; touchCd = 0; aerialCd = 0; pressCd = 0; skillCd = 0; // cooldowns
  aiT = Math.random() * 0.4; // AI thinks again when this runs out
  holdT = 0; gatherT = 0; // keeper: holding the ball / gathering it into the gloves
  frozen = false; // taking a set piece
  runup: { fn: () => void } | null = null;
  // A strike on its way: `started` once he's on the ball and facing near enough where it's going (`to`),
  // and then the ball goes `t` s later, as the boot meets it
  windup: { t: number; fn: () => void; reachable?: boolean; again?: boolean; started: boolean; to: Point | null; waitT: number } | null = null;
  wall: Point | null = null; // his place in a free-kick wall
  wallJumping = false;
  jumpT = 0; jumpY = 0;
  yellows = 0;

  tackleT = 0; tackleLen = 0; tackleDone = false; slide = false; slideSide = 1;
  lx = 0; lz = 0; // tackle lunge velocity
  downT = 0;
  fall: Fall | null = null;
  diveT = 0; diveDir = 0; diveSpeed = 0; dived = false;
  staggerT = 0; burstT = 0;
  skillT = 0; skillKind: SkillKind = 'stepover';
  turnTo: number | undefined;
  cutT = 0; cutSide = 1;

  // (the slot changes when the team changes shape; the keeper's never does)
  constructor(readonly team: Team, readonly idx: number, readonly data: PlayerData, public slot: FormationSlot, kit: Kit) {
    this.name = data.name;
    this.number = data.number;
    this.maxSpeed = 5.0 + (data.pace / 100) * 3.4;
    this.style = data.style || (data.dribbling >= 86 ? 'close' : data.pace >= 86 ? 'knock' : 'balanced');
    this.model = new PlayerModel({ kit, number: data.number, name: data.name, gk: this.role === 'GK', seed: idx * 7 + team.idx * 31 + data.number * 3 + data.name.length });
    this.mass = 72 * this.model.build ** 3 * (0.88 + 0.24 * (data.tackling ?? 60) / 100);
    this.footed = data.foot ?? footedFor(data.name, data.number);
  }
  get role() { return this.slot.role; }
  get dirX() { return Math.sin(this.facing); }
  get dirZ() { return Math.cos(this.facing); }
  stat(k: Stat) { return (this.data[k] ?? 60) / 100; }

  // Which foot to strike with: the one on the side the ball is, if it's clearly to one side;
  // otherwise his better foot. A one-footed player still opens up his body to use his good foot
  // some of the time, rather than his weak one.
  pickFoot(bx: number, bz: number): Footed.Left | Footed.Right {
    const strong = this.footed === Footed.Left ? Footed.Left : Footed.Right;
    // (his right, facing `facing`, is (-cos, sin))
    const side = (bx - this.x) * -Math.cos(this.facing) + (bz - this.z) * Math.sin(this.facing);
    if (Math.abs(side) < FOOT.middle) return strong;
    const natural = side > 0 ? Footed.Right : Footed.Left;
    if (natural === strong || this.footed === Footed.Both) return natural;
    return Math.random() < FOOT.wrapAround ? strong : natural;
  }

  // How much worse this kick is than with his best foot: the error grows, the power drops
  get footError() { return this.footed === Footed.Both ? FOOT.bothError : this.striking === this.footed ? 1 : FOOT.weakError; }
  get footPower() { return this.footed === Footed.Both || this.striking === this.footed ? 1 : FOOT.weakPower; }
}

// The weaker foot: how much it costs, and when a player uses it
const FOOT = {
  middle: 0.12, // m: the ball nearer his middle than this, he uses his good foot
  wrapAround: 0.45, // the ball on his weak side: how often he wraps his good foot round it anyway
  weakError: 1.8, // × the error in a pass or shot with the weaker foot
  weakPower: 0.88, // × the pace on it
  bothError: 1.08, // a two-footed player is nearly as good with either
};

// A player with no foot given in teams.json: about three in four right-footed, one in five left,
// a few with both, the same every time for the same player
function footedFor(name: string, number: number): Footed {
  let h = number * 2654435761;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  return r < 0.06 ? Footed.Both : r < 0.28 ? Footed.Left : Footed.Right;
}

// How a side lines up: its shape, its instructions and who starts in goal (a name; else the first keeper)
export interface TeamSetup {
  shape: FormationSlot[];
  tactics: Tactics;
  keeper?: string;
}

export interface MatchOptions {
  scene: THREE.Scene;
  settings: Settings;
  setups: [TeamSetup, TeamSetup];
  clubs: [Club, Club];
  controls: FootballControls;
  humans?: Human[];
  demo?: boolean; // the attract-mode match behind the menus: no clock, no banners
  onEvent?: (e: MatchEvent) => void;
}

export class Match {
  readonly L: number; // pitch length and width
  readonly W: number;
  readonly GW: number; // goal width and height
  readonly GH: number;
  readonly k: number; // markings scale on small pitches
  readonly boxD: number; // penalty box depth and half-width
  readonly boxW: number;
  readonly skill: number; // AI skill 0..1
  readonly duration: number; // seconds of play
  readonly demo: boolean;
  readonly teams: [Team, Team];
  readonly ball: Ball;
  readonly ref: Referee;
  all: Player[]; // everyone on the pitch

  clock = 0; // match time played (seconds)
  simT = 0; // time since the match was created
  private weather: Weather | null = null; // none: a dry day
  state: MatchState = 'play';
  stateT = 0;
  secondHalf = false;
  setPieceKind: SetPieceKind | null = null;

  private readonly scene: THREE.Scene;
  private readonly controls: FootballControls;
  private readonly onEvent: (e: MatchEvent) => void;
  private readonly ballMesh: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private passTo: Player | null = null; // the intended receiver of the ball in flight
  private passPlan: PassPlan | null = null;
  private shotPlan: ShotPlan | null = null;
  private pending: { kind: SetPieceKind; team: Team; x: number; z: number } | null = null; // restart to come
  private spot: Point | null = null; // where the dead ball sits
  private spotBack = 0; // how far behind it the taker stands
  private sendOffNext: Player | null = null;
  private lastConceded: Team;
  private gkFeet = false; // the keeper has a back-pass at his feet (no hands)
  private gkRelease: { t: number; gk: Player } | null = null;
  private gkPress = false; // goal kicks: does the other side push up to press it?
  private gkLongAnyway = false;
  private kickT = 0;
  private curlBy: { human: Human; t: number } | null = null; // who can still bend the ball they've just struck
  private switchT = 0;
  private path: (Point & { t: number; y: number })[] = []; // where the loose ball will be
  private chasers = new Set<Player>();
  private covers = new Set<Player>();
  private marks = new Map<Player, Player>();

  constructor({ scene, settings, setups, clubs, controls, humans = [], demo = false, onEvent = () => {} }: MatchOptions) {
    this.controls = controls;
    this.scene = scene;
    this.L = settings.pitch.length;
    this.W = settings.pitch.width;
    this.GW = settings.goal.width;
    this.GH = settings.goal.height;
    this.k = Math.min(1, this.L / 105);
    this.boxD = 16.5 * this.k;
    this.boxW = 20.15 * this.k;
    this.skill = settings.aiSkill ?? 0.6;
    this.duration = (settings.matchMinutes || 5) * 60;
    this.demo = demo;
    this.onEvent = onEvent;

    this.teams = [new Team(0, clubs[0]), new Team(1, clubs[1])];
    this.teams[0].opp = this.teams[1];
    this.teams[1].opp = this.teams[0];
    this.lastConceded = this.teams[1];
    for (const t of this.teams) {
      const club = t.club;
      const setup = setups[t.idx];
      t.instruct(setup.tactics);
      // fill each formation slot with an unused player of that position if possible
      const pool = [...club.players];
      const pick = (role: FormationSlot['role']) => {
        let i = role === 'GK' ? pool.findIndex((pl) => pl.pos === 'GK' && pl.name === setup.keeper) : -1;
        if (i < 0) i = pool.findIndex((pl) => pl.pos === role);
        if (i < 0) i = pool.findIndex((pl) => pl.pos !== 'GK');
        if (i < 0) i = 0;
        return pool.splice(i, 1)[0];
      };
      setup.shape.forEach((slot, i) => {
        const data = pick(slot.role);
        const kit = slot.role === 'GK' ? club.gk : club.kit;
        const p = new Player(t, i, data, slot, kit);
        scene.add(p.model.root);
        t.players.push(p);
      });
      t.bench = pool; // everyone not picked is on the bench
    }
    this.all = this.teams.flatMap((t) => t.players);

    // referee
    const model = new PlayerModel({ kit: REF_KIT, number: '', name: 'REFEREE', gk: false, seed: 4242, referee: true });
    model.tag.visible = false;
    scene.add(model.root);
    this.ref = { x: 0, z: -8, vx: 0, vz: 0, facing: 0, point: 0, card: null, cardT: 0, cardFor: null, model };

    // classic 32-panel ball: black patches around the 12 icosahedron vertices
    const bg = new THREE.IcosahedronGeometry(BALL_R, 4);
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position;
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < ico.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
      if (!dirs.some((d) => d.distanceTo(v) < 0.01)) dirs.push(v);
    }
    const pos = bg.attributes.position, cols: number[] = [], v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const near = Math.max(...dirs.map((d) => d.dot(v)));
      const c = near > 0.93 ? 0.06 : 0.97;
      cols.push(c, c, c);
    }
    bg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.ballMesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }));
    this.ballMesh.castShadow = true;
    const bs = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false }));
    bs.rotation.x = -Math.PI / 2;
    this.ballShadow = bs;
    scene.add(this.ballMesh, bs);
    this.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, owner: null, lastTouch: this.teams[0], lastPlayer: null, inNet: false, footBy: null };

    for (const c of humans) this.addHuman(c);
    this.kickoff(this.teams[0]);
  }

  dispose() {
    for (const p of this.all) this.scene.remove(p.model.root);
    this.scene.remove(this.ballMesh, this.ballShadow, this.ref.model.root);
  }

  // ---------------------------------------------------------------- humans --
  addHuman(c: Human) {
    const t = this.teams[c.team];
    if (!t.humans.includes(c)) t.humans.push(c);
    c.player = null;
    c.charge = -1;
    this.ensureHumans();
  }

  removeHuman(c: Human) {
    for (const t of this.teams) t.humans = t.humans.filter((h) => h !== c);
    if (c.player) c.player.human = null;
    c.player = null;
  }

  assign(c: Human | null, p: Player) {
    if (!c || c.player === p || p.role === 'GK') return;
    const other = p.human;
    const old = c.player;
    if (old) old.human = null;
    if (other) {
      other.player = old;
      if (old) old.human = other;
    }
    c.player = p;
    p.human = c;
  }

  ensureHumans() {
    for (const t of this.teams) {
      for (const c of t.humans) {
        if (c.player && c.player.team === t && t.players.includes(c.player)) continue;
        c.player = null;
        const free = t.players.filter((p) => p.role !== 'GK' && !p.human);
        if (!free.length) continue;
        free.sort((a, b) => this.distBall(a) - this.distBall(b));
        this.assign(c, free[0]);
      }
    }
  }

  distBall(p: Point) {
    return Math.hypot(this.ball.x - p.x, this.ball.z - p.z);
  }

  switchPlayer(c: Human) {
    const t = this.teams[c.team];
    const cands = t.players.filter((p) => p !== c.player && p.role !== 'GK' && !p.human);
    if (!cands.length) return;
    // closest to the ball, with a bonus for being goal-side of it
    const b = this.ball;
    const score = (p: Player) => this.distBall(p) - ((b.x - p.x) * t.side > 0 ? 3 : 0);
    cands.sort((a, b2) => score(a) - score(b2));
    this.assign(c, cands[0]);
  }

  // Which context of the controls json applies to this player right now
  humanContext(p: Player): Context {
    const b = this.ball;
    if (b.owner === p) return p.frozen && this.setPieceKind === 'throw' ? 'throwIn' : 'attack';
    return 'defend';
  }

  handleHuman(c: Human, dt: number) {
    const p = c.player;
    if (!p) return;
    const b = this.ball;
    let sx = c.x, sy = c.y;
    const mag = Math.hypot(sx, sy);
    if (mag > 1) { sx /= mag; sy /= mag; }
    // camera looks toward -z: stick up = away from camera
    p.wantX = mag > 0.12 ? sx : 0;
    p.wantZ = mag > 0.12 ? -sy : 0;
    p.wantSprint = c.held(BIT.sprint);
    const aim = mag > 0.25 ? { x: sx / Math.min(1, mag), z: -sy / Math.min(1, mag) } : null;
    const teamHas = b.owner?.team === p.team;
    const ctx = this.humanContext(p);
    const ctl = this.controls;
    c.pressing = !teamHas && ctl.held(c, 'defend', 'teammatePress');

    // aftertouch: just after you strike it, the stick held across its line bends it that way
    const cb = this.curlBy;
    if (cb && cb.human === c && !b.owner && this.simT - cb.t < CURL.window && mag > 0.25) {
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 2) {
        const across = (sx * (b.vz / sp) - -sy * (b.vx / sp)) / Math.max(1, mag); // the stick along the ball's right
        b.curl = clamp((b.curl ?? 0) + across * CURL.rate * dt, -CURL.most, CURL.most);
      }
    }

    // pass receiver assist: run onto the ball if the stick is idle
    if (mag <= 0.12 && this.passTo === p && !b.owner) this.receive(p);
    if (this.state !== 'play') {
      c.drain();
      c.charge = -1;
      c.armed = null;
      return;
    }

    // press (held): close down the ball, goal-side, and go in when it's in reach
    p.pressCd = p.pressCd - dt;
    if (!teamHas && ctl.held(c, 'defend', 'press')) this.humanPress(p);

    for (const ev of c.drain()) {
      if (ev.bit === BIT.sprint) continue;
      if (ev.bit === BIT.swipe) {
        if (ev.down && c.armed) c.armed.swipe = true;
        continue;
      }
      if (ev.down) {
        if (p.windup) continue;
        // a button with a swipe variant waits for the release, to see if it was swiped
        if (ctl.hasSwipe(ctx, ev.bit)) { c.armed = { bit: ev.bit, ctx, swipe: c.held(BIT.swipe) }; continue; }
        const action = ctl.action(ctx, ev.bit);
        if (action) this.humanAction(c, p, action, aim, ev.bit);
      } else if (c.armed && c.armed.bit === ev.bit) {
        const { ctx: actx, swipe } = c.armed;
        c.armed = null;
        if (actx === this.humanContext(p)) {
          const action = ctl.action(actx, ev.bit, swipe);
          if (action) this.humanAction(c, p, action, aim, ev.bit);
        }
      } else if (c.charge >= 0 && c.chargeBit === ev.bit) {
        // shot released
        if (b.owner === p) {
          const pw = Math.min(1, c.charge / 0.9);
          this.act(p, () => this.shoot(p, aim, pw), 'kick', this.goalOf(p));
        }
        c.charge = -1;
      }
    }
    if (c.charge >= 0) {
      if (b.owner !== c.player) c.charge = -1;
      else c.charge += dt;
    }
  }

  // One action from the controls json
  humanAction(c: Human, p: Player, action: Action, aim: Aim, bit: number) {
    const b = this.ball;
    const has = b.owner === p;
    switch (action) {
      case 'pass': if (has) this.act(p, () => this.pass(p, aim, false), 'pass', this.aimPoint(p, aim)); break;
      case 'longPass': if (has) this.act(p, () => this.pass(p, aim, true), 'kick', this.aimPoint(p, aim)); break;
      case 'throughBall': if (has) this.act(p, () => this.throughBall(p, aim, false), 'pass', this.aimPoint(p, aim, true)); break;
      case 'loftedThroughBall': if (has) this.act(p, () => this.throughBall(p, aim, true), 'kick', this.aimPoint(p, aim, true)); break;
      case 'shoot': if (has) { c.charge = 0; c.chargeBit = bit; } break; // hold for power, fires on release
      case 'shortThrow': if (has) this.act(p, () => this.throwIn(p, aim, false), 'throw'); break;
      case 'longThrow': if (has) this.act(p, () => this.throwIn(p, aim, true), 'throw'); break;
      case 'stepOver': if (has) this.skillMove(p, 'stepover', aim); break;
      case 'dragBack': if (has) this.skillMove(p, 'dragback', aim); break;
      case 'switchPlayer': if (!has) this.switchPlayer(c); break;
      case 'tackle': if (!has) this.humanTackle(p, aim); break;
      case 'slideTackle': if (!has) this.tackle(p, true, aim); break;
      case 'standingTackle': if (!has) this.tackle(p, false, aim); break;
      case 'press': if (!has && this.distBall(p) < 1.5) this.humanPress(p); break;
    }
  }

  // Tackle button: a standing tackle when the ball is right there, a slide when it's a few
  // metres off (aimed at where the ball is going, unless the stick says otherwise)
  humanTackle(p: Player, aim: Aim) {
    const b = this.ball;
    if (b.owner?.team === p.team) return;
    const d = this.distBall(p);
    const lead = Math.min(0.4, d / 12);
    const tx = b.x + (b.owner ? b.owner.vx : b.vx) * lead - p.x, tz = b.z + (b.owner ? b.owner.vz : b.vz) * lead - p.z;
    const tl = Math.hypot(tx, tz) || 1;
    const toBall = { x: tx / tl, z: tz / tl };
    if (d < 1.8) {
      this.tackle(p, false, toBall);
      p.pressCd = 0.8;
    } else if (d < 5.5) {
      const useStick = aim && aim.x * toBall.x + aim.z * toBall.z > 0.5;
      this.tackle(p, true, useStick ? aim : toBall);
    }
  }

  // Pressing: run at the ball (staying goal-side of it) and jockey; stab at it when in reach
  humanPress(p: Player) {
    const b = this.ball;
    if (p.tackleT > 0 || p.downT > 0 || p.frozen) return;
    const o = b.owner || b;
    const ownGx = -p.team.side * this.L / 2;
    const gdx = ownGx - o.x, gdz = -o.z, gd = Math.hypot(gdx, gdz) || 1;
    const d = this.distBall(p);
    const lead = d > 4 ? 0.35 : 0.1;
    const off = Math.min(0.8, d * 0.15);
    this.go(p, b.x + (o.vx || 0) * lead + (gdx / gd) * off, b.z + (o.vz || 0) * lead + (gdz / gd) * off, d > 2.5, 0.6);
    if (d < 1.3 && p.pressCd <= 0) {
      p.pressCd = 0.9;
      p.facing = Math.atan2(b.x - p.x, b.z - p.z);
      this.tackle(p, false);
    }
  }

  // Step-over: the leg circles round the ball and the body feints one way; defenders in front
  // can be wrong-footed. Drag-back: the sole rolls the ball back under you and you turn away.
  skillMove(p: Player, kind: SkillKind, aim: Aim = null) {
    const b = this.ball;
    if (b.owner !== p || p.skillT > 0 || p.frozen || p.windup) return;
    if (Math.hypot(b.x - p.x, b.z - p.z) > 1.1) return; // it has to be at your feet
    const lat = p.wantX * Math.cos(p.facing) - p.wantZ * Math.sin(p.facing);
    const side = lat >= 0 ? 1 : -1;
    p.skillKind = kind;
    p.skillT = kind === 'stepover' ? 0.5 : 0.45;
    p.model.skill(kind, side);
    if (kind === 'dragback') {
      b.vx = -p.dirX * 2.6;
      b.vz = -p.dirZ * 2.6;
      // turn back, or toward where the stick points if it points away from goal
      p.turnTo = aim && (aim.x * p.dirX + aim.z * p.dirZ) < 0.3 ? Math.atan2(aim.x, aim.z) : p.facing + Math.PI;
      p.touchCd = 0.5;
    } else {
      b.vx = p.vx * 0.3;
      b.vz = p.vz * 0.3;
      p.touchCd = 0.55;
      p.turnTo = undefined;
      for (const o of p.team.opp.players) {
        const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
        if (d > 3.5 || dx * p.dirX + dz * p.dirZ < 0) continue;
        // a good dribbler against a so-so defender usually sells it
        if (Math.random() < 0.35 + (p.stat('dribbling') - o.stat('tackling')) * 1.2 + 0.2) {
          o.staggerT = 0.55;
          o.tackleT = 0;
        }
      }
    }
    this.onEvent({ type: 'skill', kind, player: p });
  }

  // Start a kick, a pass or a throw: the animation winds up, the ball leaves a moment later
  // `to`: where it's going, if known: he turns to face it first
  act(p: Player, fn: () => void, anim: Strike | 'throw' = 'kick', to: Point | null = null) {
    if (this.ball.owner !== p || p.windup || p.runup) return;
    // dead-ball kicks are taken with a run-up: he jogs in from a few paces back and strikes it on the move
    if (anim !== 'throw' && p.frozen && this.setPieceKind && RUN_UP.includes(this.setPieceKind)) {
      p.runup = { fn };
      p.strikeKind = 'kick';
      p.striking = p.footed === Footed.Left ? Footed.Left : Footed.Right; // (a dead ball: his better foot)
      return;
    }
    const throwing = anim === 'throw';
    p.windup = { t: throwing ? 0.17 : KICK_CONTACT, fn, started: throwing, to, waitT: 0 };
    if (throwing) p.model.throwBall();
    else {
      // (the strike itself starts once he's on the ball: see the windup in step)
      p.strikeKind = anim;
      p.striking = p.pickFoot(this.ball.x, this.ball.z);
    }
  }

  // The weather for this match (none: dry). In the snow the ball is orange, so it can be seen.
  setWeather(w: Weather | null) {
    this.weather = w;
    (this.ballMesh.material as THREE.MeshStandardMaterial).color.set(w?.snow ? SNOW_BALL : '#ffffff');
  }
  get weatherNow() { return this.weather; }

  // ------------------------------------------------------------ main loop --
  update(dt: number) {
    const b = this.ball;
    this.stateT += dt;
    this.simT += dt;
    this.weather?.step(this.simT, dt);
    setPitch(this.weather); // (every step: another match may have left the pitch wet)

    if (this.state === 'play' && !this.demo && !this.anyFrozen()) {
      this.clock += dt;
      const holder = b.owner ? b.owner.team : b.lastTouch;
      if (holder?.stats) holder.stats.poss += dt;
      if (!this.secondHalf && this.clock >= this.duration / 2) {
        this.clock = this.duration / 2;
        this.state = 'halftime';
        this.stateT = 0;
        b.owner = null;
        this.onEvent({ type: 'halftime' });
      } else if (this.clock >= this.duration) {
        this.clock = this.duration;
        this.state = 'fulltime';
        this.stateT = 0;
        b.owner = null;
        this.onEvent({ type: 'fulltime' });
      }
    }
    if (this.state === 'halftime' && this.stateT > 4) {
      this.secondHalf = true;
      for (const t of this.teams) t.side = -t.side;
      for (const p of this.all) p.energy = Math.min(p.energyCap, p.energy + 0.2); // half-time breather
      this.kickoff(this.teams[1]);
      this.onEvent({ type: 'secondhalf' });
    }
    if (this.state === 'goal' && this.stateT > 3.2) this.kickoff(this.lastConceded);
    if (this.state === 'out' && this.stateT > 0.95 && this.stateT - dt <= 0.95) this.autoSubs();
    if (this.state === 'out' && this.stateT > 1.0 && this.pending) {
      const { kind, team, x, z } = this.pending;
      this.setPiece(kind, team, x, z);
    }
    if (this.shotPlan && (this.simT > this.shotPlan.tArrive + 0.5 || b.owner)) this.shotPlan = null;

    this.ensureHumans();
    this.autoSwitch(dt);
    for (const t of this.teams) for (const c of t.humans) this.handleHuman(c, dt);
    this.predictPath();
    this.pickRoles();
    for (const p of this.all) if (!p.human) this.ai(p, dt);
    for (const p of this.all) this.movePlayer(p, dt);
    this.separate();
    this.keepAway();
    this.updateBall(dt);
    if (this.state === 'play') this.checkPickup();
    this.updateRef(dt);

    const plan = this.shotPlan;
    for (const p of this.all) {
      const sp = Math.hypot(p.vx, p.vz);
      const fwd = p.vx * p.dirX + p.vz * p.dirZ;
      const isGK = p.role === 'GK';
      let reach: BodyState['reach'] = null;
      if (isGK && plan && plan.gk === p && p.diveT <= 0 && plan.tArrive - this.simT < 0.5) {
        reach = plan.y > 1.65 ? 'high' : plan.y < 0.6 ? 'low' : 'mid';
      }
      const ownGoalDist = Math.hypot(b.x + p.team.side * this.L / 2, b.z);
      p.model.root.position.set(p.x, p.jumpY || 0, p.z);
      p.model.root.rotation.y = p.facing;
      p.model.update(dt, {
        speed: sp,
        vf: fwd,
        vl: p.vx * Math.cos(p.facing) - p.vz * Math.sin(p.facing),
        af: p.af,
        al: p.al,
        tackle: p.tackleT > 0 && !p.slide,
        slideSide: p.slideSide,
        tired: clamp((0.7 - p.energy) / 0.45, 0, 1),
        slide: p.tackleT > 0 && p.slide,
        down: p.downT > 0 && !(p.tackleT > 0) && !p.diveDir && !p.fall,
        fall: p.fall,
        wallJump: p.jumpT > 0 && !!p.wallJumping,
        dive: p.diveDir ? Math.sign(Math.sin(p.facing) * p.diveDir) || 1 : 0,
        holding: this.inHands(p) && !p.windup,
        reach,
        gkReady: isGK && b.owner !== p && !reach && p.diveT <= 0 && sp < 2.5 && ownGoalDist < 32 && this.state === 'play',
        throwHold: b.owner === p && p.frozen && this.setPieceKind === 'throw' && !p.windup,
        look: angDiff(Math.atan2(b.x - p.x, b.z - p.z), p.facing),
        celebrate: this.state === 'goal' && p.team !== this.lastConceded && this.stateT < 3,
      });
    }
    this.ballMesh.position.set(b.x, b.y, b.z);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.05) {
      const axis = new THREE.Vector3(b.vz, 0, -b.vx).normalize();
      this.ballMesh.rotateOnWorldAxis(axis, (sp * dt) / BALL_R);
    }
    this.ballShadow.position.set(b.x, 0.03, b.z);
    const s = clamp(1 - b.y / 8, 0.4, 1);
    this.ballShadow.scale.set(s, s, s);
  }

  anyFrozen() {
    return this.all.some((p) => p.frozen);
  }

  movePlayer(p: Player, dt: number) {
    p.kickCd = Math.max(0, p.kickCd - dt);
    p.downT = Math.max(0, p.downT - dt);
    p.diveT = Math.max(0, p.diveT - dt);
    if (p.fall) {
      p.fall.t += dt;
      if (p.fall.t >= p.fall.total) p.fall = null;
    }
    if (p.jumpT > 0) {
      p.jumpT -= dt;
      p.jumpY = Math.max(0, Math.sin(Math.PI * (1 - p.jumpT / 0.55))) * 0.42;
    } else p.jumpY = 0;
    p.aerialCd = Math.max(0, p.aerialCd - dt);
    p.skillCd -= dt;
    p.staggerT -= dt;
    p.burstT -= dt;
    if (p.skillT > 0) {
      p.skillT -= dt;
      if (p.skillKind === 'dragback' && p.turnTo !== undefined) {
        p.facing += clamp(angDiff(p.turnTo, p.facing), -9 * dt, 9 * dt); // turn away with it
      }
      if (p.skillT <= 0) {
        p.burstT = p.skillKind === 'stepover' ? 0.6 : 0.3; // explode out of the move
        p.touchCd = 0;
      }
    }
    // energy: sprinting drains it, jogging a little, walking lets it come back; the ceiling
    // slowly drops over the match. Low stamina players drain faster.
    if (this.state === 'play') {
      const sp0 = Math.hypot(p.vx, p.vz);
      const drainK = 1.4 - p.stat('stamina') * 0.8;
      if (sp0 > p.maxSpeed * 0.82) p.energy -= 0.008 * drainK * dt;
      else if (sp0 > 3) p.energy -= 0.0028 * drainK * dt;
      else p.energy += 0.0035 * dt;
      p.energyCap = Math.max(0.55, p.energyCap - 0.0004 * dt);
      p.energy = clamp(p.energy, 0, p.energyCap);
    }
    if (!(p.jumpT > 0)) p.wallJumping = false;
    if (p.downT <= 0) p.diveDir = 0;
    if (p.windup && !p.windup.started) {
      // Getting to it and lining up: the swing only starts once the ball is at his feet (it may be a
      // stride ahead after a touch) and he's turned near enough to where it's going, so nobody kicks
      // thin air, and a pass back is played after turning with the ball, not by spinning on the spot
      const w = p.windup, b = this.ball;
      w.waitT += dt;
      const spot = this.strikeSpot(p);
      const reachable = b.owner !== p || this.inHands(p) || Math.hypot(b.x - spot.x, b.z - spot.z) < CONTACT.set;
      w.reachable = reachable;
      const off = w.to ? Math.abs(angDiff(Math.atan2(w.to.x - p.x, w.to.z - p.z), p.facing)) : 0;
      const hurry = p.human ? BALANCE.hurry.human : BALANCE.hurry.ai;
      if (reachable && (off < BALANCE.turned || w.waitT > hurry)) {
        w.started = true;
        w.t = KICK_CONTACT;
        p.model.kick(p.striking, p.strikeKind);
      } else if (w.waitT > BALANCE.giveUp) p.windup = null; // couldn't get there: no kick
    } else if (p.windup) {
      p.windup.t -= dt;
      // it's struck when the swinging foot meets it: not before, and never from a distance
      const b = this.ball, spot = this.strikeSpot(p);
      const reachable = b.owner !== p || p.frozen || p.role === 'GK' || Math.hypot(b.x - spot.x, b.z - spot.z) < CONTACT.again;
      p.windup.reachable = reachable;
      if (p.windup.t < -0.6 && !reachable) p.windup = null; // couldn't get there: no kick
      else if (p.windup.t <= 0 && reachable) {
        const foot = p.model.strikingFootWorld(tmpV);
        const gap = Math.hypot(foot.x - b.x, foot.z - b.z);
        if (gap > CONTACT.foot && gap < CONTACT.again && !p.windup.again && !p.frozen) {
          // not there yet: he steps onto it and swings again, meeting it this time
          p.windup.again = true;
          p.windup.t = KICK_CONTACT;
          p.model.kick(p.striking, p.strikeKind);
        } else {
          const fn = p.windup.fn;
          p.windup = null;
          // the ball sits against the boot as it's struck (the last few centimetres)
          if (gap > BALL_R && b.owner === p) {
            const k = Math.min(gap - BALL_R, CONTACT.snap) / gap;
            b.x += (foot.x - b.x) * k;
            b.z += (foot.z - b.z) * k;
          }
          if (this.ball.owner === p && this.state === 'play') fn();
        }
      }
    }
    const owner = this.ball.owner === p;

    if (p.tackleT > 0) {
      p.tackleT -= dt;
      const k = Math.max(0, p.tackleT / p.tackleLen);
      const f = p.slide ? k * k : 0.3 + 0.7 * k;
      p.vx = p.lx * f;
      p.vz = p.lz * f;
      this.resolveTackle(p);
      if (p.tackleT <= 0 && p.slide) this.knockDown(p, 'side', 0.9).side = p.slideSide;
    } else if (p.diveT > 0) {
      p.vx *= 0.85;
      p.vz = p.diveDir * p.diveSpeed;
    } else if (p.runup && this.spot) {
      // run up to the dead ball, to where his standing foot goes beside it; the strike starts as he
      // arrives (he slows to a stop through it, so it starts a little before)
      const at = p.model.strikeSpot(p.strikeKind, p.striking);
      const fx = p.dirX, fz = p.dirZ;
      const tx = this.spot.x - (fx * at.z + fz * at.x), tz = this.spot.z - (fz * at.z - fx * at.x);
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const sp = Math.min(5.2, Math.hypot(p.vx, p.vz) + 9 * dt, d * 4 + 0.6);
      p.vx = (dx / (d || 1)) * sp;
      p.vz = (dz / (d || 1)) * sp;
      p.facing += clamp(angDiff(Math.atan2(this.spot.x - p.x, this.spot.z - p.z), p.facing), -6 * dt, 6 * dt);
      if (d < Math.max(0.15, sp * KICK_CONTACT * 0.35)) {
        p.windup = { t: KICK_CONTACT, fn: p.runup.fn, started: true, to: null, waitT: 0 };
        p.runup = null;
        p.model.kick(p.striking, p.strikeKind);
      }
    } else if (p.frozen && p.windup && !p.windup.started && this.ball.owner === p && !this.inHands(p)) {
      // a dead ball with no run-up (a kick-off, a short free kick): a step to put it beside his standing foot
      const spot = this.strikeSpot(p), b = this.ball;
      const dx = b.x - spot.x, dz = b.z - spot.z, d = Math.hypot(dx, dz);
      const sp = Math.min(2, d * 5);
      p.vx = d > 0.01 ? (dx / d) * sp : 0;
      p.vz = d > 0.01 ? (dz / d) * sp : 0;
    } else if (p.downT > 0 || p.frozen || this.state === 'fulltime' || this.state === 'halftime') {
      p.vx *= Math.max(0, 1 - dt * 8);
      p.vz *= Math.max(0, 1 - dt * 8);
      if (p.frozen && Math.hypot(p.wantX, p.wantZ) > 0.3) {
        p.facing += angDiff(Math.atan2(p.wantX, p.wantZ), p.facing) * Math.min(1, dt * 8);
      }
    } else {
      // momentum: speed and direction change separately, like a person running
      // tired legs: slower, and a spent player can barely sprint
      const fresh = 0.8 + 0.2 * p.energy;
      const canSprint = p.wantSprint && p.energy > 0.12;
      let max = p.maxSpeed * (canSprint ? 1 : 0.68) * fresh * (0.6 + 0.4 * pitch.footing);
      // with the ball: dribbling decides how much pace you keep (knock-and-run types lose least)
      if (owner) max *= (0.78 + 0.2 * p.stat('dribbling')) * (p.style === 'knock' ? 1.06 : p.style === 'close' ? 0.97 : 1);
      if (p.windup && p.windup.reachable !== false) max *= p.windup.started ? 0.3 : 0.45;
      if (p.skillT > 0) max = p.skillKind === 'stepover' ? Math.min(max, 2.2) : Math.min(max, 1.2);
      if (p.staggerT > 0) max = Math.min(max, 1.5); // wrong-footed
      if (p.burstT > 0) max *= 1.06;
      if (this.state === 'goal') max *= 0.6;
      let mx = p.wantX, mz = p.wantZ;
      const dribbling = owner && !p.frozen && !this.inHands(p);
      if (dribbling) {
        // Running with the ball, you run to the ball; where you want to go decides the next
        // touch (see dribble). Aim to arrive just behind it on the line you want to take.
        const b = this.ball;
        const im = Math.hypot(p.wantX, p.wantZ);
        const ix = im > 0.2 ? p.wantX / im : p.dirX, iz = im > 0.2 ? p.wantZ / im : p.dirZ;
        // run straight along the ball's own line (not beside it): that's what keeps the run
        // straight; the stick only decides where the next touch sends it
        const bs = Math.hypot(b.vx, b.vz);
        const ux = bs > 0.5 ? b.vx / bs : ix, uz = bs > 0.5 ? b.vz / bs : iz;
        let tx = b.x + b.vx * 0.15 - ux * 0.3, tz = b.z + b.vz * 0.15 - uz * 0.3;
        if (p.windup) {
          // lining up a strike: step in so the ball is beside the standing foot
          const at = p.model.strikeSpot(p.strikeKind, p.striking);
          tx = b.x - (p.dirX * at.z + p.dirZ * at.x);
          tz = b.z - (p.dirZ * at.z - p.dirX * at.x);
        }
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        const urge = d > 0.8 ? 1 : Math.max(Math.min(1, im), d / 0.8);
        mx = d > 0.05 ? (dx / d) * urge : 0;
        mz = d > 0.05 ? (dz / d) * urge : 0;
        if (p.skillT > 0) { mx *= 0.3; mz *= 0.3; } // mid skill: the feet are busy
      }
      const wm = Math.min(1, Math.hypot(mx, mz));
      const tSpeed = wm * max;
      const cSpeed = Math.hypot(p.vx, p.vz);
      const cDir = cSpeed > 0.05 ? Math.atan2(p.vx, p.vz) : p.facing;
      const tDir = wm > 0.02 ? Math.atan2(mx, mz) : cDir;
      const turn = angDiff(tDir, cDir);
      // You can only corner as hard as grip and balance allow (~0.6-0.8 g), so the faster
      // you're going the wider you turn, and a sharp change of direction means braking first.
      // The player you control gets a lot more grip and punch than strict physics would give:
      // it has to go where the stick says, now, or it feels like steering a boat.
      const H = p.human;
      const grip = H
        ? (owner ? 16 + 6 * p.stat('dribbling') : 20 + 6 * p.stat('pace'))
        : owner ? 5.5 + 2.5 * p.stat('dribbling') : 6.5 + 2.5 * p.stat('pace');
      const omega = Math.min(H ? 14 : 6.5, grip / Math.max(cSpeed, 0.5));
      const dir = cDir + clamp(turn, -omega * dt, omega * dt);
      let want = tSpeed;
      const at = Math.abs(turn);
      if (at > 2.2) want *= H ? 0.5 : 0.1; // reversing: stop, turn, go
      else if (at > 0.6) want *= 1 - (H ? 0.3 : 0.55) * ((at - 0.6) / 1.6);
      const accel = (H ? 12 : 6) * (0.75 + 0.5 * p.stat('pace')) * (0.8 + 0.2 * p.energy) * (p.burstT > 0 ? 1.6 : 1) * pitch.footing;
      const decel = H ? 16 : 9;
      const spd = want > cSpeed ? Math.min(want, cSpeed + accel * dt) : Math.max(want, cSpeed - decel * dt);
      p.vx = Math.sin(dir) * spd;
      p.vz = Math.cos(dir) * spd;
    }

    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.x = clamp(p.x, -this.L / 2 - 3, this.L / 2 + 3);
    p.z = clamp(p.z, -this.W / 2 - 3, this.W / 2 + 3);

    // Facing: run where you're going; at low speed (jockeying, shuffling across) keep eyes on the ball
    const sp = Math.hypot(p.vx, p.vz);
    if (p.tackleT <= 0 && p.diveT <= 0 && p.downT <= 0 && !p.frozen) {
      const toBall = Math.atan2(this.ball.x - p.x, this.ball.z - p.z);
      p.faceMove = p.faceMove ? sp > 3.0 : sp > 4.0; // hysteresis so nobody flickers between the two
      let target = null;
      const lining = p.windup && !p.windup.started ? p.windup.to : null;
      if (p.windup?.started && !p.frozen) target = null; // mid-swing: the body's committed
      else if (lining) target = Math.atan2(lining.x - p.x, lining.z - p.z); // turning to strike it
      else if (owner) target = sp > 0.3 ? Math.atan2(p.vx, p.vz) : null;
      else if (p.faceMove || (p.human && p.wantSprint && sp > 0.4)) target = Math.atan2(p.vx, p.vz);
      else target = toBall;
      if (target !== null) {
        const rate = lining ? BALANCE.turn : owner ? 7 : p.faceMove ? 7 : 5;
        p.facing += clamp(angDiff(target, p.facing), -rate * dt, rate * dt);
      }
    }
    // the taker at a dead ball stands behind it, wherever he's aiming
    if (p.frozen && this.spot && this.ball.owner === p && this.setPieceKind !== 'throw' && !p.runup && !p.windup) {
      p.x = this.spot.x - p.dirX * this.spotBack;
      p.z = this.spot.z - p.dirZ * this.spotBack;
    }
    // accelerations (for leaning into runs and turns)
    const k = Math.min(1, dt * 6);
    const ax = (p.vx - p.pvx) / dt, az = (p.vz - p.pvz) / dt;
    p.pvx = p.vx;
    p.pvz = p.vz;
    p.af = p.af + (ax * p.dirX + az * p.dirZ - p.af) * k;
    p.al = p.al + (ax * Math.cos(p.facing) - az * Math.sin(p.facing) - p.al) * k;
  }

  // Bodies colliding: they bounce off each other (partly elastic), trading momentum by weight.
  // A hard enough impact can knock the lighter player over (a fair shoulder-to-shoulder, no foul).
  separate() {
    const ps = this.all;
    const R = 0.62;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const dx = c.x - a.x, dz = c.z - a.z;
      const d = Math.hypot(dx, dz);
      // teammates in a wall stand shoulder to shoulder
      if (a.wall && c.wall) continue;
      if (d < 0.001 || d >= R) continue;
      const nx = dx / d, nz = dz / d;
      // a dead-ball taker (or a man on the floor) stays put; otherwise split by weight
      const ia = a.frozen || a.downT > 0 ? 0 : 1 / a.mass, ic = c.frozen || c.downT > 0 ? 0 : 1 / c.mass;
      const isum = ia + ic || 1;
      a.x -= nx * (R - d) * (ia / isum); a.z -= nz * (R - d) * (ia / isum);
      c.x += nx * (R - d) * (ic / isum); c.z += nz * (R - d) * (ic / isum);
      const vn = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz; // < 0 = closing
      if (vn >= 0 || !(ia + ic)) continue;
      const e = 0.35;
      const jImp = (-(1 + e) * vn) / (ia + ic);
      a.vx -= jImp * ia * nx; a.vz -= jImp * ia * nz;
      c.vx += jImp * ic * nx; c.vz += jImp * ic * nz;
      if (this.state !== 'play') continue;
      const impact = -vn;
      const light = a.mass <= c.mass ? a : c, heavy = light === a ? c : a;
      if (light.downT > 0 || light.frozen || light.role === 'GK') continue;
      if (impact > 6 && Math.random() < (impact - 6) * 0.04 * (heavy.mass / light.mass) ** 2) {
        this.knockDown(light, 'trip', 1.3, heavy);
        if (this.ball.owner === light) {
          const b = this.ball;
          b.owner = null;
          b.vx = light.vx * 0.6 + rand(-1.5, 1.5);
          b.vz = light.vz * 0.6 + rand(-1.5, 1.5);
          light.kickCd = 0.5;
        }
      } else if (impact > 2.5) {
        light.staggerT = Math.max(light.staggerT, 0.25); // knocked off balance for a moment
      }
    }
  }

  // At set pieces, opponents must stand back from the ball (and everyone out of the box for a penalty).
  // Opponents also can't stand on top of a keeper holding the ball.
  keepAway() {
    const o = this.ball.owner;
    if (o && this.inHands(o)) {
      for (const q of o.team.opp.players) {
        const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz);
        if (d < 2 && d > 0.01) { q.x = o.x + (dx / d) * 2; q.z = o.z + (dz / d) * 2; }
      }
    }
    const taker = this.all.find((p) => p.frozen);
    if (!taker) return;
    const b = this.ball;
    const kind = this.setPieceKind;
    const R = kind === 'throw' ? 3 : kind === 'goalkick' ? 0 : 9.15 * this.k;
    for (const p of taker.team.opp.players) {
      if (kind === 'penalty' && p.role === 'GK') continue;
      if (p.wall) continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        const nx = d > 0.01 ? dx / d : -taker.team.side, nz = d > 0.01 ? dz / d : 0;
        p.x = b.x + nx * R;
        p.z = b.z + nz * R;
      }
    }
    if (kind === 'goalkick') {
      for (const p of taker.team.opp.players) {
        if (this.inBoxOf(taker.team, p.x, p.z)) p.x = -taker.team.side * (this.L / 2 - this.boxD - 1);
      }
    }
    if (kind === 'penalty') {
      const s = taker.team.side, gx = s * this.L / 2;
      for (const p of this.all) {
        if (p === taker || (p.role === 'GK' && p.team !== taker.team)) continue;
        if ((gx - p.x) * s < this.boxD + 1 && Math.abs(p.z) < this.boxW + 1) p.x = gx - s * (this.boxD + 1.2);
      }
    }
  }

  // ------------------------------------------------------------------ ball --
  updateBall(dt: number) {
    const b = this.ball;
    const { L, GW, GH } = this;

    if (b.owner) {
      const p = b.owner;
      b.vy = 0;
      if (this.inHands(p) || (p.frozen && this.setPieceKind === 'throw')) {
        // in the hands
        p.model.handsWorld(tmpV);
        const k = p.gatherT > 0 ? Math.min(1, dt * 14) : 1;
        if (p.gatherT > 0) p.gatherT -= dt;
        b.x += (tmpV.x + p.dirX * 0.06 - b.x) * k;
        b.y += (Math.max(BALL_R, tmpV.y) - b.y) * k;
        b.z += (tmpV.z + p.dirZ * 0.06 - b.z) * k;
        b.vx = b.vz = 0;
        return;
      }
      b.y = BALL_R;
      if (p.frozen) {
        // dead ball: it stays on its spot (the taker moves around it to aim)
        if (this.spot) { b.x = this.spot.x; b.z = this.spot.z; }
        b.vx = b.vz = 0;
        return;
      }
      this.dribble(p, dt);
      this.checkLines();
      return;
    }

    const px = b.x;
    ballStep(b, dt);

    // Posts and crossbar
    for (const s of [-1, 1]) {
      const gx = s * L / 2;
      for (const pz of [-GW / 2, GW / 2]) {
        const dx = b.x - gx, dz = b.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < BALL_R + 0.07 && b.y < GH + 0.07) {
          const nx = dx / d, nz = dz / d;
          const vn = b.vx * nx + b.vz * nz;
          if (vn < 0) {
            b.vx -= 1.75 * vn * nx;
            b.vz -= 1.75 * vn * nz;
            this.onEvent({ type: 'post' });
          }
          b.x = gx + nx * (BALL_R + 0.08);
          b.z = pz + nz * (BALL_R + 0.08);
        }
      }
      if (Math.abs(b.z) < GW / 2) {
        const dx = b.x - gx, dy = b.y - GH;
        const d = Math.hypot(dx, dy);
        if (d < BALL_R + 0.07) {
          const nx = dx / d, ny = dy / d;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= 1.75 * vn * nx;
            b.vy -= 1.75 * vn * ny;
            this.onEvent({ type: 'post' });
          }
          b.x = gx + nx * (BALL_R + 0.08);
          b.y = GH + ny * (BALL_R + 0.08);
        }
      }
    }

    // Crossed the goal line under the bar: it's in the net, let it ripple to a stop
    if (!b.inNet && Math.abs(px) <= L / 2 && Math.abs(b.x) > L / 2 && Math.abs(b.z) < GW / 2 && b.y < GH) b.inNet = true;
    if (b.inNet) {
      const back = L / 2 + 1.8;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      let hit = false;
      if (Math.abs(b.x) > back) { b.x = Math.sign(b.x) * back; b.vx *= -0.2; b.vz *= 0.5; hit = true; }
      if (b.y > GH - BALL_R) { b.y = GH - BALL_R; b.vy = -Math.abs(b.vy) * 0.2; hit = true; }
      if (Math.abs(b.z) > GW / 2 - BALL_R) { b.z = Math.sign(b.z) * (GW / 2 - BALL_R); b.vz *= -0.2; hit = true; }
      if (hit && sp > NET_FELT) this.onEvent({ type: 'net', x: b.x, y: b.y, z: b.z, speed: sp });
      b.curl = 0;
    }
    this.checkLines();
  }

  // Close control with real touches: the ball rolls ahead and gets knocked on again
  // Running with the ball: it rolls freely between touches; each touch knocks it the way
  // the player wants to go. Touch size depends on his style, speed and whether he's sprinting.
  dribble(p: Player, dt: number) {
    const b = this.ball;
    // the ball rolls on the grass like any other ball
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    const bs = Math.hypot(b.vx, b.vz);
    if (bs > 0) {
      const ns = Math.max(0, bs - (pitch.rollA + pitch.rollB * bs) * dt);
      b.vx *= ns / bs;
      b.vz *= ns / bs;
    }
    const sp = Math.hypot(p.vx, p.vz);
    const fx = p.dirX, fz = p.dirZ;
    // where he wants to take it: the stick / AI direction, else straight on
    let wx = p.wantX, wz = p.wantZ;
    const wm = Math.hypot(wx, wz);
    if (wm < 0.2) { wx = fx; wz = fz; } else { wx /= wm; wz /= wm; }
    let footX = p.x + fx * 0.35, footZ = p.z + fz * 0.35;
    if (p.windup && !p.frozen) {
      // setting it for a strike: where the boot will meet it, beside the standing foot
      const at = p.model.strikeSpot(p.strikeKind, p.striking);
      footX = p.x + fx * at.z + fz * at.x;
      footZ = p.z + fz * at.z - fx * at.x;
    }
    const dFoot = Math.hypot(b.x - footX, b.z - footZ);
    const ahead = (b.x - p.x) * fx + (b.z - p.z) * fz;
    const ballAng = bs > 0.8 ? Math.abs(angDiff(Math.atan2(b.vx, b.vz), Math.atan2(wx, wz))) : 0;
    p.touchCd -= dt;
    const skill = p.stat('dribbling');
    let touchFoot: Foot | null = null;

    if ((wm < 0.2 && sp < 1.2) || (p.windup && dFoot < 2.5)) {
      // standing on it / shielding, or setting it for a strike: the ball settles at the feet
      // (cushioned, not snapped)
      if (dFoot < 1.0) {
        b.vx = b.vx * 0.85 + (footX - b.x) * 3;
        b.vz = b.vz * 0.85 + (footZ - b.z) * 3;
      }
    } else if (p.skillT <= 0 && p.touchCd <= 0 && dFoot < 0.9 && (ahead < 0.75 || ballAng > 0.55 || bs < 0.5) &&
        (touchFoot = this.footOnBall(p, ahead)) !== null) {
      const sprinting = p.wantSprint || sp > p.maxSpeed * 0.85;
      let push;
      // close control keeps it almost at running pace (ball stays under the body);
      // knock-and-run sends it well ahead to sprint onto
      if (p.style === 'close') push = sp * 1.0 + 0.3;
      else if (p.style === 'knock') push = sp * 1.3 + 1.0;
      else push = sp * 1.08 + 0.5;
      if (sprinting) push *= p.style === 'close' ? 1.1 : p.style === 'knock' ? 1.5 : 1.25;
      // you can only take the ball as sharply as you can turn and follow it
      // carry on along the ball's own line, bending it toward where he wants to go
      // (basing it on his running direction made every touch over-correct: the zig-zag)
      const runDir = bs > 1 ? Math.atan2(b.vx, b.vz) : sp > 0.5 ? Math.atan2(p.vx, p.vz) : Math.atan2(wx, wz);
      let maxCut = sp > 5 ? 0.55 : sp > 3 ? 0.8 : sp > 1.5 ? 1.3 : Math.PI;
      if (p.human) maxCut = Math.min(Math.PI, maxCut * 2); // you can turn with it when you want to
      const cut = clamp(angDiff(Math.atan2(wx, wz), runDir), -maxCut, maxCut);
      if (Math.abs(cut) > 0.35) push = Math.min(push, sp * 0.9 + 1.0); // a cut is a softer touch
      // touch quality: weaker dribblers' touches vary more in weight and direction
      push *= 1 + (1 - skill) * 0.5 * rand(-1, 1);
      const ang = runDir + cut + (1 - skill) * 0.12 * rand(-1, 1); // small, honest error, no zig-zag
      b.vx = Math.sin(ang) * push;
      b.vz = Math.cos(ang) * push;
      p.touchCd = (p.style === 'close' ? 0.14 : 0.2) * (p.human ? 0.7 : 1);
      p.model.touch(touchFoot);
    }
    // overran it: it's loose (and anyone can nick it)
    if (Math.hypot(b.x - p.x, b.z - p.z) > (p.human ? 4 : 3.2)) {
      b.owner = null;
      p.kickCd = 0.25;
    }
  }

  // Which foot (0/1) is on the ball right now, or -1. The running cycle brings each foot through;
  // a touch only happens when one actually gets there (or the ball is right under him).
  footOnBall(p: Player, ahead: number): Foot | null {
    const b = this.ball;
    let best: Foot | null = null, bd = p.human ? 0.55 : 0.4; // a bit of help for the player you control
    for (const i of [0, 1] as const) {
      p.model.footWorld(i, tmpV);
      const d = Math.hypot(tmpV.x - b.x, tmpV.z - b.z);
      if (d < bd) { bd = d; best = i; }
    }
    if (best === null && ahead < 0.2) {
      // ball got under him: whichever foot is nearer plays it
      const d0 = p.model.footWorld(0, tmpV).distanceTo(new THREE.Vector3(b.x, tmpV.y, b.z));
      const d1 = p.model.footWorld(1, tmpV).distanceTo(new THREE.Vector3(b.x, tmpV.y, b.z));
      best = d0 < d1 ? 0 : 1;
    }
    return best;
  }

  checkLines() {
    const b = this.ball;
    const { L, W, GW, GH } = this;
    if (this.state !== 'play') return;
    if (Math.abs(b.x) > L / 2 + BALL_R) {
      const s = Math.sign(b.x);
      if (b.inNet || (b.owner && Math.abs(b.z) < GW / 2 && b.y < GH)) {
        this.goal(this.attacking(s));
      } else {
        const attackers = this.attacking(s);
        if (b.lastTouch === attackers) {
          this.out('goalkick', attackers.opp, 0, 0, 'GOAL KICK');
        } else {
          this.out('corner', attackers, s * (L / 2 - 0.4), Math.sign(b.z || 1) * (W / 2 - 0.4), 'CORNER');
        }
      }
    } else if (Math.abs(b.z) > W / 2 + BALL_R && (b.owner || b.vz * Math.sign(b.z) >= 0)) {
      // (a throw-in starts outside the line but is travelling in: that's not out)
      const x = clamp(b.x, -L / 2 + 1, L / 2 - 1);
      this.out('throw', b.lastTouch.opp, x, Math.sign(b.z) * (W / 2), 'THROW-IN');
    }
  }

  // the team attacking the goal at this end (s = +1 / -1)
  attacking(s: number) {
    return this.teams[0].side === s ? this.teams[0] : this.teams[1];
  }

  // the keeper has it in his hands (not at his feet from a back-pass, not a dead ball)
  inHands(p: Player) {
    return p.role === 'GK' && this.ball.owner === p && this.inOwnBox(p) && !p.frozen && !this.gkFeet;
  }

  inOwnBox(p: Player) {
    return this.inBoxOf(p.team, p.x, p.z);
  }

  // inside the penalty area that `team` defends
  inBoxOf(team: Team, x: number, z: number) {
    const gx = -team.side * this.L / 2;
    return Math.abs(x - gx) < this.boxD && Math.abs(z) < this.boxW;
  }

  // ----------------------------------------------------------- touches ----
  checkPickup() {
    const b = this.ball;
    if (b.owner) {
      // a heavy touch can be nicked by an opponent
      const o = b.owner;
      if (o.frozen || this.inHands(o)) return;
      if (Math.hypot(b.x - o.x, b.z - o.z) < 0.85) return;
      for (const q of o.team.opp.players) {
        if (q.kickCd > 0 || q.downT > 0 || q.frozen) continue;
        if (Math.hypot(b.x - q.x, b.z - q.z) < 0.55) {
          q.model.touch();
          this.gain(q);
          this.onEvent({ type: 'tackle', controller: o.human });
          return;
        }
      }
      return;
    }
    const plan = this.shotPlan;
    let best = null, bd = Infinity;
    for (const p of this.all) {
      if (p.kickCd > 0 || (p.downT > 0 && p.diveT <= 0) || p.frozen) continue;
      if (p.tackleT > 0 && p.slide) continue;
      const rel = this.gkRelease;
      if (rel && p.team !== rel.gk.team && this.simT - rel.t < 0.4 && Math.hypot(p.x - rel.gk.x, p.z - rel.gk.z) < 2.5) continue;
      // back-pass: the keeper has to use his feet (so: outfield reach and height)
      const gk = p.role === 'GK' && this.inOwnBox(p) && b.footBy !== p.team;
      // a keeper who has been beaten doesn't get a hand to it
      if (gk && plan && plan.gk === p && (plan.outcome === 'beaten' || plan.outcome === 'wide')) continue;
      const reach = gk ? (p.diveT > 0 ? 1.15 : 0.95) : this.passTo === p ? 1.05 : 0.8;
      const maxH = gk ? 2.6 : b.y > BALL_R + 0.06 || b.vy !== 0 ? 0.45 : 0.95;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < reach && b.y < maxH && d < bd) { best = p; bd = d; }
    }
    if (!best) return this.checkAerial();
    const sp = Math.hypot(b.vx, b.vy, b.vz);

    if (best.role === 'GK' && this.inOwnBox(best) && b.footBy !== best.team) {
      if (plan && plan.gk === best) {
        this.shotPlan = null;
        if (plan.outcome === 'parry') return this.parry(best);
        this.onEvent({ type: 'save' });
        return this.gain(best);
      }
      // crosses / through balls: usually claimed
      const chance = clamp(1.05 - sp / 32 + (best.stat('keeping') - 0.75), 0.4, 0.95);
      if (b.lastTouch !== best.team && Math.random() > chance) return this.parry(best);
      return this.gain(best);
    }
    if (plan && b.lastTouch !== best.team && sp > 12 && Math.random() < 0.7) {
      // block: the shot deflects off the defender
      const s2 = best.team.side;
      b.vx = -b.vx * rand(0.1, 0.4) + (Math.random() < 0.5 ? -s2 * rand(2, 6) : 0);
      b.vz = b.vz * 0.4 + rand(-6, 6);
      b.vy = rand(1, 4);
      b.lastTouch = best.team;
      b.lastPlayer = best;
      b.footBy = null; // a deflection
      best.kickCd = 0.4;
      this.shotPlan = null;
      this.onEvent({ type: 'save', parry: true, block: true });
      return;
    }
    if (sp > 16 && b.lastTouch !== best.team && Math.random() > 0.35 + best.stat('dribbling') * 0.5) {
      // heavy touch: ball bounces off
      b.vx *= -0.3;
      b.vz = b.vz * 0.3 + rand(-3, 3);
      best.kickCd = 0.35;
      b.lastTouch = best.team;
      b.lastPlayer = best;
      return;
    }
    this.gain(best);
  }

  // Balls between waist and head height: headers, chest control or clearances
  // A ball arriving above foot height: head it, chest it, or take it on the thigh.
  // Controlling it means cushioning it so it drops at your feet, not snapping it there.
  checkAerial() {
    const b = this.ball;
    if (b.y < 0.45 || b.y > 2.35) return;
    let best = null, bd = Infinity;
    const rel = this.gkRelease;
    for (const p of this.all) {
      if (p.role === 'GK' || p.kickCd > 0 || p.downT > 0 || p.frozen || p.tackleT > 0 || p.aerialCd > 0) continue;
      if (rel && p.team !== rel.gk.team && this.simT - rel.t < 0.4 && Math.hypot(p.x - rel.gk.x, p.z - rel.gk.z) < 2.5) continue;
      // it has to reach the head, the chest or the thigh itself, not just come near him
      const d = Math.hypot(b.x - p.x, b.z - p.z), tall = p.model.build;
      const extra = this.passTo === p ? CONTACT.reachReceiver : 0;
      for (const part of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
        const g = Math.hypot(d - PARTS[part].fwd * tall, b.y - PARTS[part].up * tall);
        if (g < CONTACT[part] + extra && g < bd) { bd = g; best = p; }
      }
    }
    if (!best) return;
    const p = best;
    const s = p.team.side;
    const gx = s * this.L / 2;
    const inOppBox = this.inBoxOf(p.team.opp, p.x, p.z);
    const meant = this.passTo === p || b.lastTouch === p.team;
    p.aerialCd = 0.4;
    p.facing = Math.atan2(-b.vx, -b.vz);
    if (b.y >= 1.55) {
      if (inOppBox && Math.abs(gx - p.x) < 14) {
        // header at goal (rising for it)
        const tz = rand(-1, 1) * (this.GW / 2 - 0.4);
        const dx = gx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        const v = 11 + p.stat('shooting') * 6;
        p.facing = Math.atan2(dx, dz);
        p.jumpT = 0.45;
        p.model.control('head');
        this.kickBall(p, (dx / d) * v, rand(-2, 2.5), (dz / d) * v, true);
        this.onEvent({ type: 'shot' });
        this.planSave(p.team.opp, false);
        return;
      }
      if (this.inOwnBox(p) || !meant) {
        // clearing header
        p.jumpT = 0.45;
        p.model.control('head');
        this.kickBall(p, s * rand(8, 13), rand(4, 7), rand(-5, 5), true);
        return;
      }
    }
    // cushion it down: the better your touch, the closer it drops
    const kind = b.y >= 1.55 ? 'head' : b.y >= 1.0 ? 'chest' : 'thigh';
    const skill = p.stat('dribbling');
    const heavy = 1 + (1 - skill) * 1.4 * Math.random();
    const im = Math.hypot(p.wantX, p.wantZ);
    const a = (im > 0.2 ? Math.atan2(p.wantX, p.wantZ) : p.facing) + (1 - skill) * 0.5 * rand(-1, 1);
    const out = (kind === 'head' ? 1.4 : kind === 'chest' ? 1.0 : 0.7) * heavy;
    b.vx = Math.sin(a) * out + p.vx * 0.6;
    b.vz = Math.cos(a) * out + p.vz * 0.6;
    b.vy = kind === 'head' ? 1.4 : kind === 'chest' ? 0.9 : -0.4;
    b.lastTouch = p.team;
    b.lastPlayer = p;
    b.footBy = kind === 'thigh' ? b.footBy : null; // headed or chested to the keeper is allowed
    p.kickCd = 0;
    p.model.control(kind);
    if (meant || Math.random() < 0.5 + skill * 0.4) this.passTo = p; // he'll be first to it as it drops
  }

  parry(gk: Player) {
    const b = this.ball;
    const s = gk.team.side;
    const side = Math.sign(b.z - gk.z) || (Math.random() < 0.5 ? -1 : 1);
    if (b.y > 1.8) {
      // fingertips over the bar
      b.vx *= 0.3;
      b.vy = 5.5;
      b.vz = b.vz * 0.3 + side * 1.2;
    } else if (Math.random() < 0.55) {
      // turned round the post: usually ends up behind for a corner
      b.vx = -s * rand(1.5, 4);
      b.vz = side * rand(4, 8);
      b.vy = rand(1, 3);
    } else {
      // pushed back out into the box
      b.vx = s * rand(2, 5);
      b.vz = side * rand(3, 7);
      b.vy = rand(1.5, 4);
    }
    b.lastTouch = gk.team;
    b.lastPlayer = gk;
    gk.kickCd = 0.8;
    this.shotPlan = null;
    this.onEvent({ type: 'save', parry: true });
  }

  gain(p: Player) {
    const b = this.ball;
    // keeper receiving a deliberate kick from his own player: feet only
    this.gkFeet = p.role === 'GK' && b.footBy === p.team;
    b.footBy = null;
    if (b.lastTouch !== p.team && !this.spot) p.team.wonAt = this.simT; // won in open play (not a restart)
    b.owner = p;
    b.lastTouch = p.team;
    b.lastPlayer = p;
    b.inNet = false;
    p.holdT = 0;
    p.gatherT = 0.22; // (keeper only) the ball is drawn into the gloves over a moment
    if (!this.inHands(p)) {
      // first touch: cushion it and set it in front, better players with a softer touch
      const sp = Math.hypot(p.vx, p.vz);
      const im = Math.hypot(p.wantX, p.wantZ);
      const a = (im > 0.2 ? Math.atan2(p.wantX, p.wantZ) : p.facing) + (1 - p.stat('dribbling')) * 0.3 * rand(-1, 1);
      const v = (sp * 0.9 + 0.8) * (1 + (1 - p.stat('dribbling')) * 0.6 * rand(-0.3, 1));
      b.vx = Math.sin(a) * v;
      b.vz = Math.cos(a) * v;
      b.vy = 0;
      b.y = Math.min(b.y, BALL_R + 0.05);
      p.touchCd = 0.18;
      // the foot nearer the ball reaches out for it (further if he's stretching)
      const f0 = p.model.footWorld(0, tmpV).distanceTo(new THREE.Vector3(b.x, tmpV.y, b.z));
      const f1 = p.model.footWorld(1, tmpV).distanceTo(new THREE.Vector3(b.x, tmpV.y, b.z));
      p.model.touch(f0 < f1 ? 0 : 1, clamp((Math.min(f0, f1) - 0.3) / 0.6, 0, 1));
    }
    p.aiT = rand(0.15, 0.35);
    for (const q of this.all) if (q !== p) q.windup = null;
    this.passTo = null;
    this.shotPlan = null;
    if (!p.human && p.role !== 'GK' && p.team.humans.length) {
      const c = [...p.team.humans].sort((a, c2) => dist(a.player, p) - dist(c2.player, p))[0];
      this.assign(c, p);
    }
    if (p.human) this.onEvent({ type: 'buzz', controller: p.human, ms: 25 });
    function dist(a: Player | null, q: Player) { return a ? Math.hypot(a.x - q.x, a.z - q.z) : 999; }
  }

  kickBall(p: Player, vx: number, vy: number, vz: number, keepPos = false, curl = 0) {
    const b = this.ball;
    const fromHands = this.inHands(p);
    b.owner = null; // the ball is struck from wherever it is: it never jumps to the foot
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.curl = curl;
    this.curlBy = p.human ? { human: p.human, t: this.simT } : null;
    if (fromHands) this.gkRelease = { t: this.simT, gk: p };
    // back-pass rule: a deliberate kick (or throw-in) by a teammate means the keeper can't handle it
    b.footBy = !keepPos && p.role !== 'GK' ? p.team : null;
    this.gkFeet = false;
    b.lastTouch = p.team;
    b.lastPlayer = p;
    this.kickT = this.simT;
    p.kickCd = 0.3;
    if (p.frozen) {
      p.frozen = false;
      this.setPieceKind = null;
      this.spot = null;
      for (const q of this.all) {
        if (q.wall && Math.hypot(q.x - q.wall.x, q.z - q.wall.z) < 1.2) { q.jumpT = 0.55; q.wallJumping = true; }
        q.wall = null;
      }
    }
    p.holdT = 0;
    this.shotPlan = null;
    this.onEvent({ type: 'kick', power: Math.hypot(vx, vy, vz) });
  }

  // Where the ball should be for the strike he's lining up (world x, z): beside his standing foot
  strikeSpot(p: Player): Point {
    const at = p.model.strikeSpot(p.strikeKind, p.striking);
    return { x: p.x + p.dirX * at.z + p.dirZ * at.x, z: p.z + p.dirZ * at.z - p.dirX * at.x };
  }

  // The goal he's attacking (its middle)
  goalOf(p: Player): Point { return { x: p.team.side * this.L / 2, z: 0 }; }

  // Where a pass the player you control is about to play will go: along the stick if it's held, or
  // to whoever the pass would pick (through balls: ahead of the runner)
  aimPoint(p: Player, aim: Aim, through = false): Point | null {
    if (aim) return { x: p.x + aim.x * 10, z: p.z + aim.z * 10 };
    if (through) return { x: p.x + p.team.side * 10, z: p.z };
    const m = this.passTarget(p, null);
    return m ? { x: m.x, z: m.z } : null;
  }

  // How well he can strike it this way (`dir`) from the way he's facing: an error multiplier, extra
  // spread (rad), and how much of the pace he gets on it. A really awkward one leaves him stumbling.
  // He turns as far into it as the hips allow.
  balance(p: Player, dir: number) {
    const off = Math.abs(angDiff(dir, p.facing));
    const k = clamp((off - BALANCE.free) / (Math.PI - BALANCE.free), 0, 1);
    if (k > BALANCE.stumble) p.staggerT = Math.max(p.staggerT, BALANCE.stumbleT);
    p.facing += clamp(angDiff(dir, p.facing), -BALANCE.free, BALANCE.free);
    return { error: 1 + BALANCE.error * k, spread: BALANCE.spread * k * rand(-1, 1), power: 1 - BALANCE.power * k };
  }

  // Kick to a point on the ground, rolled or lofted
  kickTo(p: Player, tx: number, tz: number, lob: boolean, tgt: Player | null, errScale = 1, opts: KickOptions = {}) {
    // passes are aimed to stay on the pitch
    tx = clamp(tx, -this.L / 2 + 2, this.L / 2 - 2);
    tz = clamp(tz, -this.W / 2 + 2.5, this.W / 2 - 2.5);
    let dx = tx - p.x, dz = tz - p.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    const bal = this.balance(p, Math.atan2(dx, dz));
    const miss = (1 - p.stat('passing')) * errScale * p.footError * bal.error;
    const ang = Math.atan2(dx, dz) + miss * 0.15 * rand(-1, 1) + bal.spread;
    dx = Math.sin(ang);
    dz = Math.cos(ang);
    if (lob) {
      // chips go up steeply, long balls are driven flatter; aim to land just short of the man
      const el = opts.angle ?? (d < 15 ? 0.62 : d < 30 ? 0.5 : 0.42);
      const v = loftSpeed(d * 0.95, el) * (1 + miss * 0.12 * rand(-1, 1)) * (0.5 + 0.5 * p.footPower) * bal.power;
      this.kickBall(p, dx * v * Math.cos(el), v * Math.sin(el), dz * v * Math.cos(el));
    } else {
      // longer passes are struck harder so they still arrive with zip
      const v = Math.min(30, groundSpeed(d, opts.arrive ?? Math.min(12, 7 + d * 0.15))) * bal.power;
      this.kickBall(p, dx * v, 0, dz * v);
    }
    this.passTo = tgt;
    if (tgt && p.human && tgt.role !== 'GK') this.assign(p.human, tgt);
  }

  // Nearest opponent distance: how "open" a spot is
  openness(team: Team, x: number, z: number) {
    let d = Infinity;
    for (const o of team.opp.players) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
    return d;
  }

  // Will this pass get through? Race the ball along its route against every opponent
  // (with a human reaction time), and check the receiver can get to where it ends up.
  // Returns the safety margin in seconds: positive = the ball gets there first.
  passSafety(p: Player, tx: number, tz: number, lob: boolean, receiver: Player | null) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    const ux = dx / d, uz = dz / d;
    const samples = [];
    let T;
    if (lob) {
      // a lofted ball can only be cut out where it comes down
      T = 0.6 + d * 0.03;
      samples.push([d * 0.85, T * 0.9], [d, T]);
    } else {
      const arrive = Math.min(12, 7 + d * 0.15);
      let v = Math.min(30, groundSpeed(d, arrive)), sDone = 0, t = 0, next = 1.5;
      for (let i = 0; i < 400 && sDone < d; i++) {
        const st = 0.03;
        sDone += v * st;
        v = Math.max(0.5, v - (pitch.rollA + pitch.rollB * v) * st);
        t += st;
        if (sDone >= next) { samples.push([Math.min(sDone, d), t]); next += 1.5; }
      }
      T = t;
    }
    let margin = Infinity;
    for (const [sd, t] of samples) {
      const px = p.x + ux * sd, pz = p.z + uz * sd;
      for (const o of p.team.opp.players) {
        if (o.downT > 0.3) continue;
        const dist = Math.max(0, Math.hypot(o.x - px, o.z - pz) - 0.9); // a leg's reach
        const tO = 0.18 + dist / (o.maxSpeed * 0.95); // assume a sharp defender
        margin = Math.min(margin, tO - t);
      }
    }
    if (receiver) {
      const tR = Math.max(0, Math.hypot(receiver.x - tx, receiver.z - tz) - 0.8) / (receiver.maxSpeed * 0.85);
      margin = Math.min(margin, T + 0.4 - tR);
    }
    return margin;
  }

  // Lead a pass into the receiver's run: where he'll be when the ball arrives
  leadPoint(p: Player, m: Player, lob: boolean): [number, number] {
    const d0 = Math.hypot(m.x - p.x, m.z - p.z);
    let T;
    if (lob) T = 0.6 + d0 * 0.03;
    else {
      const arrive = Math.min(12, 7 + d0 * 0.15);
      const v0 = Math.min(30, groundSpeed(d0, arrive));
      T = Math.log((pitch.rollA + pitch.rollB * v0) / (pitch.rollA + pitch.rollB * arrive)) / pitch.rollB;
    }
    return [m.x + m.vx * T * 0.7, m.z + m.vz * T * 0.7];
  }

  // Best teammate to pass to: in roughly the aimed direction for a human, or the best
  // option for the AI. `lob` true/false forces the kind of pass; undefined lets the AI choose.
  // Leaves the chosen plan in this.passPlan.
  passTarget(p: Player, aim: Aim, { forwardOnly = false, lob }: { forwardOnly?: boolean; lob?: boolean } = {}) {
    const ax = aim ? aim.x : p.dirX, az = aim ? aim.z : p.dirZ;
    const s = p.team.side;
    let best = null, bs = Infinity, plan = null;
    for (const m of p.team.players) {
      if (m === p) continue;
      const dx = m.x - p.x, dz = m.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 50) continue;
      if (forwardOnly && dx * s < 6) continue;
      const ang = Math.abs(angDiff(Math.atan2(dx, dz), Math.atan2(ax, az)));
      if (aim && ang > 1.1) continue;
      // try the pass along the ground and (if it's far enough) in the air; keep the safer
      const kinds = lob === undefined ? (d > 14 ? [false, true] : [false]) : [lob];
      let groundMargin = -Infinity;
      for (const k of kinds) {
        // only go in the air when the ball along the ground isn't on (lofted balls are harder to control)
        if (k && lob === undefined && groundMargin > 0.25) continue;
        const [tx, tz] = this.leadPoint(p, m, k);
        const margin = this.passSafety(p, tx, tz, k, m);
        if (!k) groundMargin = margin;
        let score = d * 0.03 + (aim ? ang * 2.2 : 0) - clamp(margin, -1, 1.2) * 2.5 + (k ? 1.5 : 0);
        if (!aim) {
          score -= dx * s * 0.05; // prefer forward options
          if (m.role === 'GK') score += 3;
        }
        if (score < bs) { bs = score; best = m; plan = { tgt: m, tx, tz, lob: k, margin }; }
      }
    }
    this.passPlan = plan;
    return best;
  }

  pass(p: Player, aim: Aim, lob: boolean) {
    this.passTarget(p, aim, { lob });
    this.playPass(p, this.passPlan, aim, lob);
  }

  // Play a planned pass (or into space along the aim if there's nobody to find)
  playPass(p: Player, plan: PassPlan | null, aim: Aim = null, lob = false) {
    if (plan && plan.tgt && p.team.players.includes(plan.tgt)) {
      // refresh the lead in case the receiver changed course during the wind-up
      const [tx, tz] = this.leadPoint(p, plan.tgt, plan.lob);
      this.kickTo(p, tx, tz, plan.lob, plan.tgt);
    } else {
      const ax = aim ? aim.x : p.dirX, az = aim ? aim.z : p.dirZ;
      this.kickTo(p, p.x + ax * 16, p.z + az * 16, lob, null);
    }
  }

  // Ball into space in front of a runner, who sprints onto it
  throughBall(p: Player, aim: Aim, lofted = false) {
    const s = p.team.side;
    const ax = aim ? aim.x : s, az = aim ? aim.z : 0;
    const aimAng = Math.atan2(ax, az);
    let best = null, bs = Infinity;
    for (const m of p.team.players) {
      if (m === p || m.role === 'GK') continue;
      const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
      if (d < 4 || d > 45) continue;
      const ang = Math.abs(angDiff(Math.atan2(dx, dz), aimAng));
      if (ang > 1.0) continue;
      const sc = ang * 2 - dx * s * 0.05 + d * 0.01 - Math.min(this.openness(p.team, m.x, m.z), 8) * 0.15;
      if (sc < bs) { bs = sc; best = m; }
    }
    let tx, tz;
    if (best) {
      const d = Math.hypot(best.x - p.x, best.z - p.z);
      const lead = clamp(5 + d * 0.12, 5, 11);
      // the lead follows the stick, biased a little toward goal
      let ux = s * 0.35 + ax * 0.65, uz = az * 0.8;
      const ul = Math.hypot(ux, uz) || 1;
      tx = best.x + (ux / ul) * lead;
      tz = best.z + (uz / ul) * lead;
    } else {
      tx = p.x + ax * 18;
      tz = p.z + az * 18;
    }
    tx = clamp(tx, -this.L / 2 + 1, this.L / 2 - 1);
    tz = clamp(tz, -this.W / 2 + 1, this.W / 2 - 1);
    // along the ground, or lofted over the defence (a little longer, to drop into the runner's path)
    if (lofted) this.kickTo(p, tx + (tx - p.x) * 0.08, tz + (tz - p.z) * 0.08, true, best, 1.0, { angle: 0.5 });
    else this.kickTo(p, tx, tz, false, best, 0.8, { arrive: 5 });
  }

  // Throw from the hands to a spot (throw-ins and keeper throws)
  throwTo(p: Player, tx: number, tz: number, tgt: Player | null, flat = false) {
    const b = this.ball;
    tz = clamp(tz, -this.W / 2 + 2, this.W / 2 - 2);
    const dx = tx - b.x, dz = tz - b.z;
    const d = Math.max(2, Math.hypot(dx, dz));
    const el = flat ? 0.15 : 0.55;
    const v = Math.min(19, loftSpeed(d * 0.95, el, b.y));
    p.facing = Math.atan2(dx, dz);
    this.kickBall(p, (dx / d) * v * Math.cos(el), v * Math.sin(el), (dz / d) * v * Math.cos(el), true);
    if (p.role !== 'GK') b.footBy = p.team; // a throw-in to your own keeper counts as a back-pass
    this.passTo = tgt;
    if (tgt && p.human && tgt.role !== 'GK') this.assign(p.human, tgt);
  }

  throwIn(p: Player, aim: Aim, long: boolean) {
    let tgt = this.passTarget(p, aim);
    if (tgt && long && Math.hypot(tgt.x - p.x, tgt.z - p.z) < 10) tgt = null;
    let tx, tz;
    if (tgt) {
      tx = tgt.x + tgt.vx * 0.6;
      tz = tgt.z + tgt.vz * 0.6;
    } else {
      const ax = aim ? aim.x : p.dirX, az = aim ? aim.z : p.dirZ;
      const d = long ? 22 : 12;
      tx = p.x + ax * d;
      tz = p.z + az * d;
    }
    this.throwTo(p, tx, clamp(tz, -this.W / 2 + 1, this.W / 2 - 1), tgt);
  }

  // Cross into the box toward the best-placed teammate (or the penalty spot area)
  cross(p: Player) {
    const s = p.team.side;
    const gx = s * this.L / 2;
    let best = null, bs = -Infinity;
    for (const m of p.team.players) {
      if (m === p || m.role === 'GK' || !this.inBoxOf(p.team.opp, m.x, m.z)) continue;
      const sc = this.openness(p.team, m.x, m.z) - Math.abs(m.z) * 0.15;
      if (sc > bs) { bs = sc; best = m; }
    }
    const tx = best ? best.x + best.vx * 0.8 : gx - s * rand(6, 11) * this.k;
    const tz = best ? best.z + best.vz * 0.8 : rand(-5, 5);
    this.kickTo(p, tx, tz, true, best, 1.4, { angle: 0.44 });
  }

  // Hoof it upfield
  clear(p: Player) {
    const s = p.team.side;
    this.kickTo(p, p.x + s * rand(28, 40), clamp(p.z * 0.5 + rand(-12, 12), -this.W / 2 + 4, this.W / 2 - 4), true, null, 2, { angle: 0.6 });
  }

  shoot(p: Player, aim: Aim, power: number) {
    p.team.stats.shots++;
    const penalty = this.setPieceKind === 'penalty' && p.frozen;
    const s = p.team.side;
    const gx = s * this.L / 2;
    // aim across the goal with the stick's sideways component
    const aimZ = aim ? clamp(aim.z * 1.6, -1, 1) : rand(-0.7, 0.7);
    const tz = aimZ * (this.GW / 2 - 0.3);
    const dx = gx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const sk = p.stat('shooting');
    const speed0 = (15 + power * 15 * (0.65 + 0.35 * sk)) * p.footPower;
    // finishing isn't perfect: error grows with distance, pressure and blasting it
    const pressure = this.openness(p.team, p.x, p.z) < 2.5 ? 0.035 : 0;
    const bal = penalty ? { error: 1, spread: 0, power: 1 } : this.balance(p, Math.atan2(dx, dz));
    const err = (0.05 + (1 - sk) * 0.3 + pressure + Math.max(0, power - 0.8) * 0.2 + Math.min(0.05, d / 700)) * p.footError * bal.error;
    // the computer sometimes bends one round the keeper: aimed outside the post and curled in
    let curl = 0, aimAng = Math.atan2(dx, dz);
    if (!p.human && !penalty && Math.abs(tz) > 1 && Math.random() < CURL.aiChance) {
      curl = CURL.ai * Math.sign(tz * Math.sin(aimAng));
      const T = d / (15 + power * 15), drift = 0.5 * CURL.ai * T * T; // how far it bends on the way
      aimAng -= Math.sign(curl) * drift / d; // (aimed that far out the other way)
    }
    const ang = aimAng + (rand(-1, 1) + rand(-1, 1)) * 0.5 * err * (penalty ? 0.5 : 1) + bal.spread;
    // height as it reaches the goal: driven low by default, rising with power (and over the bar if you lean back on it)
    let h = 0.25 + power * 1.4 + rand(-0.3, 0.3) + Math.max(0, power - 0.85) * 3;
    h = Math.max(0.15, h);
    const speed = speed0 * bal.power;
    const vy = Math.min(9, shotVy(d, speed, h));
    this.kickBall(p, Math.sin(ang) * speed, vy, Math.cos(ang) * speed, false, curl);
    this.passTo = null;
    this.onEvent({ type: 'shot' });
    this.planSave(p.team.opp, penalty);
  }

  // Decide the keeper's fate the moment a shot is struck: where it crosses the line,
  // how far the keeper must dive, how long he has. Then the keeper acts it out.
  planSave(defTeam: Team, penalty: boolean) {
    const b = this.ball;
    const gk = defTeam.players.find((q) => q.role === 'GK');
    if (!gk) return;
    const gx = -defTeam.side * this.L / 2;
    if (Math.abs(b.vx) < 1 || (gx - b.x) * b.vx <= 0) return;
    // fly the ball forward: where does it pass the keeper, and where does it cross the line?
    const sim = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, curl: b.curl };
    const dirX = Math.sign(b.vx);
    let t = 0, atKeeper = null, atLine = null;
    for (let i = 0; i < 200 && !atLine; i++) {
      ballStep(sim, 1 / 60);
      t += 1 / 60;
      if (!atKeeper && (sim.x - gk.x) * dirX >= 0) atKeeper = { t, z: sim.z, y: sim.y };
      if ((sim.x - gx) * dirX >= 0) atLine = { t, z: sim.z, y: sim.y };
      if (Math.hypot(sim.vx, sim.vz) < 0.5) break;
    }
    if (!atLine) return; // it won't reach the goal
    if (!atKeeper) atKeeper = atLine;
    const onTarget = Math.abs(atLine.z) < this.GW / 2 - 0.05 && atLine.y < this.GH - 0.05;
    // what matters for the save is where the ball passes the keeper, not the goal line:
    // a keeper off his line has narrowed the angle
    t = Math.max(0.05, atKeeper.t);
    const z = atKeeper.z;
    const y = Math.max(0.3, atKeeper.y);
    const kp = gk.stat('keeping');
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const reaction = penalty ? 0.05 : clamp(0.3 - kp * 0.12 + rand(0, 0.12), 0.12, 0.4);
    const need = Math.abs(z - gk.z);
    let reach = 0.9 + Math.min(2.5, Math.max(0, t - reaction) * 7) * (0.7 + 0.4 * kp);
    if (y > 1.9) reach -= 0.35; // top corners are hard
    let outcome: ShotPlan['outcome'], diveZ = z;
    if (!onTarget) outcome = 'wide';
    else if (penalty) {
      const guess = [-1, 0, 1][Math.floor(Math.random() * 3)];
      const zone = Math.abs(z) < 1.2 ? 0 : Math.sign(z);
      diveZ = guess * 2.4;
      outcome = guess === zone && Math.random() < 0.45 + kp * 0.3 ? 'parry' : 'beaten';
    } else if (need > reach) outcome = 'beaten';
    else {
      const margin = 1 - need / reach;
      // more time to see it = easier save; long-range efforts rarely beat a keeper
      const saveP = clamp(0.68 + margin * 0.4 + (kp - 0.75) * 1.2 - Math.max(0, speed - 26) * 0.02 + clamp((t - 0.4) * 0.9, 0, 0.35), 0.2, 0.97);
      if (Math.random() > saveP) outcome = 'beaten';
      else outcome = need < 0.8 && speed < 28 && Math.random() < 0.55 + kp * 0.3 ? 'catch' : 'parry';
    }
    gk.dived = false;
    this.shotPlan = { gk, z: diveZ, y, tArrive: this.simT + t, diveAt: this.simT + reaction, outcome, reach };
  }

  tackle(p: Player, slide: boolean, aim: Aim = null) {
    if (p.tackleT > 0 || p.downT > 0 || p.frozen || p.kickCd > 0.15 || p.staggerT > 0) return;
    p.slideSide = Math.random() < 0.5 ? -1 : 1;
    if (aim) p.facing = Math.atan2(aim.x, aim.z);
    p.slide = slide;
    p.tackleLen = p.tackleT = slide ? 0.6 : 0.38;
    p.tackleDone = false;
    // a slide carries your run-up a couple of metres; a standing tackle is a short step and a stab
    const cs = Math.hypot(p.vx, p.vz);
    const sp = slide ? Math.max(cs, 5) + 2.5 : Math.min(6, cs + 1.2);
    p.lx = p.dirX * sp;
    p.lz = p.dirZ * sp;
  }

  resolveTackle(p: Player) {
    if (p.tackleDone) return;
    const b = this.ball;
    const o = b.owner;
    // body contact with the man (for fouls) or the ball (for a clean tackle)
    const dBall = Math.hypot(b.x - p.x - p.dirX * 0.45, b.z - p.z - p.dirZ * 0.45);
    const reach = p.slide ? 1.1 : 0.8;
    if (!o) {
      if (p.slide && dBall < reach && b.y < 1) {
        p.tackleDone = true;
        this.kickBall(p, p.lx * 0.8, 1, p.lz * 0.8, true); // poke a loose ball away
      }
      return;
    }
    if (o.team === p.team || o.frozen) return;
    const dMan = Math.hypot(o.x - p.x, o.z - p.z);
    if (dBall > reach && dMan > reach) return;
    p.tackleDone = true;
    if (this.inHands(o)) return this.foul(p, o, false); // you can't challenge a keeper holding the ball
    // tackling from behind = facing the same way as the man on the ball
    const fromBehind = Math.cos(angDiff(p.facing, o.facing)) > 0.45;
    const chance = clamp(0.5 + (p.stat('tackling') - o.stat('dribbling')) * 0.8 + (p.slide ? 0.12 : 0) - (fromBehind ? 0.25 : 0), 0.15, 0.88);
    const won = dBall <= reach && Math.random() < chance;
    const foulP = won
      ? (fromBehind && p.slide ? 0.35 : 0.02)
      : (p.slide ? 0.3 : 0.06) + (fromBehind ? 0.18 : 0);
    if (Math.random() < foulP) return this.foul(p, o, fromBehind);
    if (!won) return;
    o.kickCd = 0.6;
    if (p.slide) {
      this.knockDown(o, 'trip', 1.6, p);
      b.owner = null;
      b.vx = p.lx * 0.5 + rand(-2, 2);
      b.vz = p.lz * 0.5 + rand(-2, 2);
      b.vy = 1.5;
      b.lastTouch = p.team;
      b.lastPlayer = p;
    } else if (Math.random() < 0.55) {
      this.gain(p); // clean: comes away with it
    } else {
      // poked loose
      b.owner = null;
      b.vx = p.dirX * 3 + rand(-2, 2);
      b.vz = p.dirZ * 3 + rand(-2, 2);
      b.vy = 0.5;
      b.lastTouch = p.team;
      b.lastPlayer = p;
    }
    this.onEvent({ type: 'tackle', controller: o.human });
  }

  // ---------------------------------------------------------- restarts ----
  foul(f: Player, v: Player, fromBehind: boolean) {
    f.team.stats.fouls++;
    const b = this.ball;
    this.knockDown(v, 'trip', 1.9, f);
    v.vx = v.vz = 0;
    b.owner = null;
    b.vx *= 0.2;
    b.vz *= 0.2;
    let card: Card | null = null;
    const r = Math.random();
    if (f.slide && fromBehind) card = r < 0.04 ? 'red' : r < 0.85 ? 'yellow' : null; // reckless
    else if (f.slide) card = r < 0.3 ? 'yellow' : null;
    else if (fromBehind) card = r < 0.2 ? 'yellow' : null;
    else card = r < 0.08 ? 'yellow' : null;
    // cynical foul to stop an attack in its tracks
    if (!card && (v.x * v.team.side) > -this.L * 0.05 && Math.random() < 0.15) card = 'yellow';
    if (card === 'yellow') {
      f.yellows++;
      if (f.yellows >= 2) card = 'red';
    }
    if (card) {
      this.ref.card = card;
      this.ref.cardT = 3.2;
      this.ref.cardFor = f;
    }
    const penalty = this.inBoxOf(f.team, v.x, v.z);
    this.state = 'out';
    this.stateT = card ? -2.6 : -1; // time for the referee to get there (and book him)
    this.passTo = null;
    this.shotPlan = null;
    this.pending = penalty
      ? { kind: 'penalty', team: v.team, x: 0, z: 0 } // (the spot is worked out in setPiece)
      : { kind: 'freekick', team: v.team, x: v.x, z: v.z };
    this.sendOffNext = card === 'red' ? f : null;
    this.ref.point = 2.5;
    this.onEvent({ type: 'foul', fouler: f, victim: v, card, penalty });
  }

  // Bring a bench player on for `out`. He takes the same position in the formation.
  substitute(team: Team, out: Player, inData: PlayerData) {
    if (team.subsLeft <= 0 || !team.players.includes(out)) return null;
    const bi = team.bench.indexOf(inData);
    if (bi < 0) return null;
    team.bench.splice(bi, 1);
    team.subsLeft--;
    const kit = out.slot.role === 'GK' ? team.club.gk : team.club.kit;
    const p = new Player(team, out.idx, inData, out.slot, kit);
    // comes on from the halfway line on the near touchline
    p.x = 0;
    p.z = this.W / 2 + 0.5;
    p.facing = Math.PI;
    team.players[team.players.indexOf(out)] = p;
    this.all[this.all.indexOf(out)] = p;
    this.scene.remove(out.model.root);
    this.scene.add(p.model.root);
    if (this.ball.owner === out) this.ball.owner = null;
    if (this.passTo === out) this.passTo = null;
    if (out.human) {
      const c = out.human;
      out.human = null;
      c.player = null;
      if (p.role !== 'GK') this.assign(c, p);
    }
    this.onEvent({ type: 'sub', team, off: out, on: p });
    return p;
  }

  // A new shape mid-match: each outfield player takes the free place nearest his old one,
  // preferring his own position (a defender stays at the back if there's room there)
  setShape(team: Team, shape: FormationSlot[]) {
    const cost = (p: Player, s: FormationSlot) => Math.abs(p.slot.x - s.x) * 2 + Math.abs(p.slot.z - s.z) * 0.5 +
      (p.data.pos === s.role ? 0 : 0.6) + (p.slot.role === s.role ? 0 : 0.2);
    const pairs: [number, Player, FormationSlot][] = [];
    for (const p of team.players) if (p.role !== 'GK') for (const s of shape.slice(1)) pairs.push([cost(p, s), p, s]);
    pairs.sort((a, b) => a[0] - b[0]);
    const done = new Set<Player | FormationSlot>();
    for (const [, p, s] of pairs) {
      if (done.has(p) || done.has(s)) continue;
      p.slot = s;
      done.add(p).add(s);
    }
  }

  // AI managers: at a stoppage in the second half, swap out a tired player for a fresh one
  autoSubs() {
    if (!this.secondHalf || this.demo) return;
    for (const t of this.teams) {
      if (t.humans.length || t.autoSubs >= 3 || t.subsLeft <= 0 || !t.bench.length) continue;
      const tired = t.players.filter((p) => p.role !== 'GK' && p.energy < 0.5).sort((a, c) => a.energy - c.energy)[0];
      if (!tired) continue;
      const fresh = t.bench.find((d) => d.pos === tired.role) || t.bench.find((d) => d.pos !== 'GK');
      if (!fresh) continue;
      if (this.substitute(t, tired, fresh)) t.autoSubs++;
    }
  }

  sendOff(p: Player) {
    const t = p.team;
    t.players = t.players.filter((q) => q !== p);
    this.all = this.all.filter((q) => q !== p);
    this.scene.remove(p.model.root);
    if (p.human) {
      p.human.player = null;
      p.human = null;
    }
    if (this.passTo === p) this.passTo = null;
  }

  goal(team: Team) {
    team.score++;
    this.lastConceded = team.opp;
    this.state = 'goal';
    this.stateT = 0;
    this.ball.owner = null;
    this.passTo = null;
    this.shotPlan = null;
    const scorer = this.ball.lastTouch === team ? this.ball.lastPlayer : null;
    this.onEvent({ type: 'goal', team, scorer: scorer?.name, own: !scorer });
  }

  out(kind: SetPieceKind, team: Team, x: number, z: number, label: string) {
    this.state = 'out';
    this.stateT = 0;
    this.ball.owner = null;
    this.pending = { kind, team, x, z };
    this.passTo = null;
    this.shotPlan = null;
    this.onEvent({ type: 'banner', text: label });
  }

  // Put a player on the floor: 'trip' (stumbles forward, lies there, gets up) or 'side' (after a slide)
  knockDown(p: Player, kind: Fall['kind'], total: number, by: Player | null = null) {
    p.downT = total;
    // fall to the side the challenge came from
    let side = Math.random() < 0.5 ? -1 : 1;
    if (by) side = Math.sign((by.x - p.x) * Math.cos(p.facing) - (by.z - p.z) * Math.sin(p.facing)) || side;
    p.fall = { kind, t: 0, total, side };
    return p.fall;
  }

  resetPlayerStates() {
    for (const p of this.all) {
      p.frozen = false; p.tackleT = 0; p.diveT = 0; p.diveDir = 0; p.wall = null; p.runup = null;
      if (p.downT > 0.8) {
        // skip ahead to getting up rather than popping upright
        p.downT = 0.8;
        if (p.fall) p.fall.t = Math.max(p.fall.t, p.fall.total - 0.8);
      }
    }
  }

  setPiece(kind: SetPieceKind, team: Team, x: number, z: number) {
    const b = this.ball;
    if (this.sendOffNext) {
      this.onEvent({ type: 'sendoff', player: this.sendOffNext });
      this.sendOff(this.sendOffNext);
      this.sendOffNext = null;
      this.ensureHumans();
    }
    this.state = 'play';
    this.stateT = 0;
    b.vx = b.vy = b.vz = 0;
    b.inNet = false;
    this.resetPlayerStates();
    const s = team.side;
    const gx = s * this.L / 2;

    if (kind === 'goalkick') {
      // ball on the ground in the six-yard box; the keeper takes it
      const gk = team.players.find((p) => p.role === 'GK') || team.players[0];
      x = -s * (this.L / 2 - 5.5 * this.k * 0.8);
      z = rand(-1, 1) * 4 * this.k;
      b.x = x; b.z = z; b.y = BALL_R;
      gk.facing = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      gk.x = x - gk.dirX * 2.4;
      gk.z = z;
      this.spot = { x, z };
      this.spotBack = 2.4;
      this.gain(gk);
      gk.frozen = true;
      gk.aiT = rand(1.2, 1.8);
      this.setPieceKind = 'goalkick';
      this.gkPress = Math.random() < team.opp.tune.goalKickPress; // does the other side push up to press it?
      this.gkLongAnyway = Math.random() < team.tune.goalKickLong; // or the keeper just fancies it long
      return;
    }
    if (kind === 'penalty') {
      x = gx - s * 11 * this.k;
      z = 0;
    }
    b.x = x; b.z = z; b.y = BALL_R;
    // direction the taker faces
    let ix, iz;
    if (kind === 'throw') { ix = 0; iz = -Math.sign(z); }
    else if (kind === 'corner') { ix = -Math.sign(x) * 0.6; iz = -Math.sign(z); }
    else { ix = gx - x; iz = -z * 0.3; }
    const il = Math.hypot(ix, iz) || 1;
    ix /= il; iz /= il;

    const outfield = team.players.filter((p) => p.role !== 'GK');
    let taker: Player;
    if (kind === 'penalty') {
      // a human takes it if there is one, otherwise the best finisher
      const human = team.humans.find((c) => c.player)?.player;
      taker = human ?? [...outfield].sort((a, c) => c.stat('shooting') - a.stat('shooting'))[0];
    } else {
      outfield.sort((a, c) => Math.hypot(a.x - x, a.z - z) - Math.hypot(c.x - x, c.z - z));
      taker = outfield[0];
    }
    // takers step back a few paces to run onto the ball (throw-ins: on the line)
    const back = kind === 'penalty' ? 2.8 : kind === 'freekick' ? 2.6 : kind === 'corner' ? 1.8 : kind === 'throw' ? 0.35 : 0.55;
    taker.x = x - ix * back;
    taker.z = z - iz * back;
    this.spot = { x, z };
    this.spotBack = back;
    taker.vx = taker.vz = 0;
    taker.facing = Math.atan2(ix, iz);
    if (team.humans.length && !taker.human) this.assign(team.humans[0], taker);
    this.gain(taker);
    taker.frozen = true;
    taker.aiT = kind === 'penalty' ? rand(1.2, 1.8) : rand(0.9, 1.4);
    this.setPieceKind = kind;
    if (taker.human) taker.human.charge = -1;

    if (kind === 'penalty') {
      const gk = team.opp.players.find((p) => p.role === 'GK');
      if (gk) { gk.x = gx - s * 0.3; gk.z = 0; gk.facing = s > 0 ? -Math.PI / 2 : Math.PI / 2; }
    }
    if (kind === 'freekick' && Math.hypot(gx - x, z) < 35) this.buildWall(team.opp, x, z, gx);
  }

  buildWall(def: Team, x: number, z: number, gx: number) {
    const dx = gx - x, dz = 0 - z;
    const d = Math.hypot(dx, dz);
    const ux = dx / d, uz = dz / d;
    const R = 9.15 * this.k;
    const cx = x + ux * R, cz = z + uz * R;
    // more men in the wall the closer and more central the free kick
    const central = Math.abs(z) < 12;
    const n = d < 22 ? (central ? 5 : 4) : d < 28 ? (central ? 4 : 3) : 2;
    const cands = def.players.filter((p) => p.role !== 'GK' && !p.human)
      .sort((a, c) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(c.x - cx, c.z - cz))
      .slice(0, n);
    // the wall covers the near-post side; the keeper takes the other half
    const shift = Math.sign(z || 1) * 0.35;
    cands.forEach((p, i) => {
      const off = (i - (n - 1) / 2) * 0.62 + shift;
      p.wall = { x: cx - uz * off, z: cz + ux * off }; // they run there (see ai)
    });
  }

  kickoff(team: Team) {
    const b = this.ball;
    this.state = 'play';
    this.stateT = 0;
    this.passTo = null;
    this.shotPlan = null;
    b.x = b.z = 0; b.y = BALL_R;
    b.vx = b.vy = b.vz = 0;
    b.owner = null;
    b.inNet = false;
    this.resetPlayerStates();
    for (const t of this.teams) for (const p of t.players) {
      const nx = Math.min(p.slot.x, 0.42);
      p.x = t.side * (nx * this.L - this.L / 2);
      p.z = p.slot.z * this.W * 0.35;
      p.vx = p.vz = 0;
      p.facing = t.side > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.downT = 0; p.kickCd = 0;
    }
    const fwds = team.players.filter((p) => p.role === 'FWD');
    const outfield = team.players.filter((p) => p.role !== 'GK');
    const taker = fwds[0] || outfield[outfield.length - 1];
    const mate = fwds[1] || outfield.find((p) => p !== taker && p.role === 'MID') || outfield[0];
    taker.x = -team.side * 0.5;
    taker.z = 0;
    this.spot = { x: 0, z: 0 };
    this.spotBack = 0.5;
    mate.x = -team.side * 1.5;
    mate.z = 2;
    if (team.humans.length) this.assign(team.humans[0], taker);
    this.gain(taker);
    taker.frozen = true;
    taker.aiT = rand(0.8, 1.2);
    this.setPieceKind = 'kickoff';
    this.ref.x = -6;
    this.ref.z = -10;
    this.onEvent({ type: 'kickoff', team });
  }

  // ---------------------------------------------------------------- referee --
  updateRef(dt: number) {
    const r = this.ref, b = this.ball;
    // keep ~12m from the ball on a diagonal, out of the passing lanes
    let tx = clamp(b.x - Math.sign(b.x || 1) * 7, -this.L / 2 + 4, this.L / 2 - 4);
    let tz = clamp(b.z + (b.z > 0 ? -10 : 10), -this.W / 2 + 2, this.W / 2 - 2);
    r.cardT = Math.max(0, r.cardT - dt);
    let showing = false;
    if (r.cardT > 0 && r.cardFor) {
      // run over to the offender and show him the card
      const f = r.cardFor;
      const dx = r.x - f.x, dz = r.z - f.z, dd = Math.hypot(dx, dz) || 1;
      tx = f.x + (dx / dd) * 2;
      tz = f.z + (dz / dd) * 2;
      showing = dd < 3.5 || r.cardT < 1.6;
    }
    r.model.showCard(showing ? r.card : null);
    const dx = tx - r.x, dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    const speed = d > 9 ? 6.8 : d > 2 ? 3.6 : 0;
    const wx = d > 0.01 ? (dx / d) * speed : 0, wz = d > 0.01 ? (dz / d) * speed : 0;
    const k = Math.min(1, dt * 4);
    r.vx += (wx - r.vx) * k;
    r.vz += (wz - r.vz) * k;
    r.x += r.vx * dt;
    r.z += r.vz * dt;
    const sp = Math.hypot(r.vx, r.vz);
    const look = showing && r.cardFor ? r.cardFor : b;
    const target = sp > 3.5 ? Math.atan2(r.vx, r.vz) : Math.atan2(look.x - r.x, look.z - r.z);
    r.facing += clamp(angDiff(target, r.facing), -8 * dt, 8 * dt);
    r.point = Math.max(0, r.point - dt);
    const fwd = r.vx * Math.sin(r.facing) + r.vz * Math.cos(r.facing);
    r.model.root.position.set(r.x, 0, r.z);
    r.model.root.rotation.y = r.facing;
    const lat = r.vx * Math.cos(r.facing) - r.vz * Math.sin(r.facing);
    r.model.update(dt, { speed: sp, vf: fwd, vl: lat, point: r.point > 0 && !showing, card: showing });
  }

  // ---------------------------------------------------------------- AI ----
  // Per frame: who presses the ball, who covers, who marks whom
  pickRoles() {
    const b = this.ball;
    this.chasers = new Set();
    this.covers = new Set();
    this.marks = new Map();
    if (this.state !== 'play') return;
    for (const t of this.teams) {
      if (b.owner?.team === t) continue;
      if (b.owner && this.inHands(b.owner)) continue; // let the keeper have it
      if (b.owner?.frozen) {
        if (this.setPieceKind !== 'kickoff' && this.setPieceKind !== 'penalty') this.assignMarkers(t, 16);
        continue;
      }
      const cands = t.players.filter((p) => p.role !== 'GK' && !p.human && p.downT <= 0 && !p.wall);
      if (!cands.length) continue;
      // just after the other side plays a pass, defenders haven't reacted yet
      if (!b.owner && b.lastTouch !== t && this.simT - this.kickT < 0.25) continue;
      const tgt = b.owner || b;
      const dist = (p: Player) => Math.hypot(tgt.x - p.x, tgt.z - p.z);
      cands.sort((p, q) => dist(p) - dist(q));
      // if a human is already closest, the AI only covers
      const humanClose = t.humans.some((c) => c.player && dist(c.player) < dist(cands[0]));
      // standing off: only go to the ball once it's close, or in our half (a loose ball, always)
      const tu = t.tune;
      const press = tu.pressAlways || !b.owner || dist(cands[0]) < tu.pressRange * this.L || tgt.x * t.side < 0;
      if (!humanClose && press) this.chasers.add(cands[0]);
      // a human asking for team press (R1), or hunting the ball in their half: a teammate joins in
      const pair = tu.pressPair && b.owner && tgt.x * t.side > 0 && dist(cands[1] || cands[0]) < this.L * 0.15;
      if ((t.humans.some((c) => c.pressing) || pair) && b.owner) this.chasers.add(humanClose ? cands[0] : cands[1] || cands[0]);
      const second = humanClose ? cands[0] : cands[1];
      // in our half, a second man covers (goal-side of the ball, not on it)
      if (second && tgt.x * t.side < this.L * 0.1) this.covers.add(second);
      this.assignMarkers(t, 13);
    }
  }

  assignMarkers(t: Team, range: number) {
    const b = this.ball;
    const markers = t.players.filter((p) => p.role !== 'GK' && p.role !== 'FWD' && !p.human && !this.chasers.has(p) && !this.covers.has(p) && !p.wall);
    const targets = t.opp.players.filter((o) => o.role !== 'GK' && o !== b.owner);
    const taken = new Set();
    markers.sort((a, c) => (a.role === 'DEF' ? 0 : 1) - (c.role === 'DEF' ? 0 : 1));
    for (const p of markers) {
      const [sx, sz] = this.shapeTarget(p, false);
      let best = null, bd = p.role === 'DEF' ? range : range * 0.75;
      for (const o of targets) {
        if (taken.has(o)) continue;
        // only bother with opponents in front of our goal-side half of the pitch
        const d = Math.hypot(o.x - sx, o.z - sz);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { taken.add(best); this.marks.set(p, best); }
    }
  }

  // Swap human control on defence when someone else is much closer
  autoSwitch(dt: number) {
    this.switchT -= dt;
    if (this.switchT > 0) return;
    this.switchT = 0.6;
    const b = this.ball;
    for (const t of this.teams) {
      if (b.owner?.team === t) continue;
      if (this.passTo && this.passTo.team === t) continue;
      for (const c of t.humans) {
        if (!c.player || c.player.tackleT > 0) continue;
        const mine = this.distBall(c.player);
        if (mine < 10) continue;
        const better = t.players.find((p) => p.role !== 'GK' && !p.human && this.distBall(p) < mine - 7);
        if (better) this.switchPlayer(c);
      }
    }
  }

  // Move toward a spot. `ease` is how far out to start slowing down: positioning eases in,
  // but going to meet the ball you run straight through it.
  go(p: Player, tx: number, tz: number, sprint: boolean, ease = 2.5) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) { p.wantX = p.wantZ = 0; p.wantSprint = false; return; }
    const k = Math.min(1, d / ease) / d;
    p.wantX = dx * k;
    p.wantZ = dz * k;
    p.wantSprint = sprint;
  }

  // Where the loose ball will be over the next 3 seconds (recomputed each frame)
  predictPath() {
    const b = this.ball;
    this.path = [];
    if (b.owner) return;
    const s = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz };
    for (let i = 1; i <= 180; i++) {
      ballStep(s, 1 / 60);
      if (i % 6 === 0) this.path.push({ t: i / 60, x: s.x, y: s.y, z: s.z });
    }
  }

  // How the intended receiver meets a pass: get the body in line with the ball and let it
  // come (stepping toward it a little), rather than charging at it and missing it to one side.
  receive(p: Player) {
    const b = this.ball;
    const sp = Math.hypot(b.vx, b.vz);
    if ((b.y > 1.0 || b.vy > 0.5) && this.path && this.path.length) {
      // in the air: get under it where it drops to chest height, and wait for it there
      let land = null;
      for (let i = 1; i < this.path.length; i++) {
        const q = this.path[i];
        if (q.y < 1.1 && q.y < this.path[i - 1].y) { land = q; break; }
      }
      if (land) return this.go(p, land.x, land.z, Math.hypot(land.x - p.x, land.z - p.z) > 4, 1.2);
    }
    if (sp < 2) {
      const [ix, iz] = this.intercept(p);
      return this.go(p, ix, iz, true, 1.0);
    }
    const ux = b.vx / sp, uz = b.vz / sp;
    const along = (p.x - b.x) * ux + (p.z - b.z) * uz;
    if (along > 0.5) {
      const fx = b.x + ux * along, fz = b.z + uz * along;
      const lateral = Math.hypot(p.x - fx, p.z - fz);
      const tBall = along / (sp * 0.85);
      const tMe = lateral / (p.maxSpeed * 0.8) + 0.15;
      if (tMe < tBall) {
        const step = Math.min(along * 0.25, 2.5);
        return this.go(p, fx - ux * step, fz - uz * step, lateral > 3, 1.2);
      }
    }
    const [ix, iz] = this.intercept(p);
    this.go(p, ix, iz, true, 0.6);
  }

  // First point on the ball's path a player can get to while it's playable (below head height)
  intercept(p: Player): [number, number] {
    const b = this.ball;
    if (!this.path || !this.path.length || Math.hypot(b.vx, b.vz) < 1.5) return [b.x, b.z];
    for (const q of this.path) {
      if (q.y > 2.0) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) <= p.maxSpeed * q.t * 0.9 + 0.7) return [q.x, q.z];
    }
    const last = this.path[this.path.length - 1];
    return [last.x, last.z];
  }

  ai(p: Player, dt: number) {
    const b = this.ball;
    const t = p.team;
    p.aiT -= dt;
    p.wantSprint = false;

    if (this.state === 'goal') {
      if (p.team !== this.lastConceded && this.stateT < 3 && p === this.ball.lastPlayer) {
        this.go(p, t.side * this.L / 2 - t.side * 3, Math.sign(p.z || 1) * this.W / 2, true);
      } else this.go(p, p.x * 0.98, p.z * 0.98, false);
      return;
    }
    if (this.state === 'fulltime' || this.state === 'halftime') { p.wantX = p.wantZ = 0; return; }
    if (b.owner === p && p.frozen) return this.aiSetPiece(p); // incl. the keeper's goal kicks
    if (p.role === 'GK') return this.aiKeeper(p, dt);
    if (b.owner === p) return this.aiCarrier(p);
    if (p.wall && b.owner?.frozen) return this.go(p, p.wall.x, p.wall.z, Math.hypot(p.wall.x - p.x, p.wall.z - p.z) > 3, 1.2);
    if (this.state === 'out') {
      const [sx, sz] = this.shapeTarget(p, false);
      return this.go(p, sx, sz, false);
    }

    const teamHas = b.owner?.team === t;
    if (this.passTo === p && !b.owner) return this.receive(p);
    // read a pass meant for the man I'm marking
    const mark = this.marks.get(p);
    if (mark && !b.owner && this.passTo === mark) {
      const [ix, iz] = this.intercept(p);
      if (Math.hypot(ix - p.x, iz - p.z) + 1.5 < Math.hypot(ix - mark.x, iz - mark.z)) return this.go(p, ix, iz, true, 0.6);
    }
    if (this.chasers.has(p)) {
      if (b.owner) {
        const o = b.owner;
        // approach goal-side, then lunge
        const ownGx = -t.side * this.L / 2;
        const gdx = ownGx - o.x, gdz = -o.z, gd = Math.hypot(gdx, gdz) || 1;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        const lead = d > 4 ? 0.4 : 0.15;
        // go for the ball (it's out in front of the dribbler), staying goal-side
        this.go(p, b.x + o.vx * lead + (gdx / gd) * Math.min(1.2, d * 0.2), b.z + o.vz * lead + (gdz / gd) * Math.min(1.2, d * 0.2), d > 2.5);
        if (Math.hypot(b.x - p.x, b.z - p.z) < 1.5 && p.aiT <= 0) {
          p.aiT = rand(0.5, 1.1) / (0.5 + this.skill);
          // jockey, and go in when the ball is exposed or he's running at us
          const exposed = Math.hypot(b.x - o.x, b.z - o.z) > 0.6;
          const frontOn = Math.cos(angDiff(p.facing, o.facing)) < -0.2;
          const pTackle = (exposed ? 0.7 : 0.25) * (frontOn ? 1 : 0.5) * (0.6 + this.skill * 0.6) * t.tune.tackle;
          if (Math.random() < pTackle) {
            p.facing = Math.atan2(b.x - p.x, b.z - p.z);
            this.tackle(p, Math.random() < (frontOn ? 0.08 : 0.15));
          }
        }
      } else {
        const [ix, iz] = this.intercept(p);
        this.go(p, ix, iz, true, 0.6);
      }
      return;
    }
    if (this.covers.has(p)) {
      const tgt = b.owner || b;
      const ownGx = -t.side * this.L / 2;
      const gdx = ownGx - tgt.x, gdz = -tgt.z, gd = Math.hypot(gdx, gdz) || 1;
      return this.go(p, tgt.x + (gdx / gd) * 5, tgt.z + (gdz / gd) * 5, true);
    }
    const [sx, sz] = this.shapeTarget(p, teamHas);
    if (mark) {
      // goal-side of my man, blended with my place in the shape
      const ownGx = -t.side * this.L / 2;
      const gdx = ownGx - mark.x, gdz = -mark.z, gd = Math.hypot(gdx, gdz) || 1;
      const mx = mark.x + (gdx / gd) * 1.8, mz = mark.z + (gdz / gd) * 1.8;
      const w = this.setPieceKind === 'corner' || this.setPieceKind === 'freekick' ? 0.95 : 0.7;
      const tx = mx * w + sx * (1 - w), tz = mz * w + sz * (1 - w);
      return this.go(p, tx, tz, Math.hypot(tx - p.x, tz - p.z) > 4);
    }
    this.go(p, sx, sz, Math.hypot(sx - p.x, sz - p.z) > (teamHas && this.breaking(t) && p.role !== 'DEF' ? 2 : 7));
  }

  // Just won the ball, and told to hit on the break: the team runs forward together
  breaking(t: Team) {
    return this.simT - t.wonAt < t.tune.breakT && this.ball.owner?.team === t;
  }

  // Where a player should stand: the team moves as a compact block that follows the ball
  shapeTarget(p: Player, teamHas: boolean): [number, number] {
    const { L, W } = this;
    const s = p.team.side;
    const b = this.ball;
    const gx = s * L / 2;

    // set pieces near goal: attackers flood the box, defenders drop onto the six-yard line area
    if (this.setPieceKind === 'corner' || this.setPieceKind === 'penalty') {
      const taker = b.owner;
      if (taker && taker.frozen) {
        const attacking = taker.team === p.team;
        const goalX = attacking ? gx : -gx;
        const dir = attacking ? s : -s;
        if (this.setPieceKind === 'penalty') {
          return [goalX - dir * (this.boxD + 1.5 + (p.idx % 3)), clamp(p.slot.z * this.boxW, -this.boxW, this.boxW)];
        }
        if (attacking) {
          if (p.role === 'DEF' && p.idx % 2 === 0) return [-s * L * 0.05, p.slot.z * W * 0.3]; // stay back
          const lane = (p.idx * 37) % 9;
          return [goalX - dir * (5 + (lane % 4) * 2.2) * this.k, ((lane - 4) * 1.8) * this.k];
        }
        return [goalX - dir * (3 + (p.role === 'DEF' ? 0 : 3)) * this.k, p.slot.z * this.boxW * 0.6];
      }
    }

    if (this.setPieceKind === 'goalkick' && b.owner?.frozen && b.owner.team === p.team && p.role === 'DEF') {
      // centre-backs split to the corners of the box, full-backs push wide
      // (centre-backs drop inside the box, which opponents can't enter until it's taken)
      const wide = Math.abs(p.slot.z) > 0.5;
      return wide
        ? [s * (0.22 * L - L / 2), Math.sign(p.slot.z) * W * 0.4]
        : [s * (6 * this.k - L / 2), Math.sign(p.slot.z || 1) * this.boxW * 0.7];
    }
    let bt = clamp((b.x * s + L / 2) / L, 0, 1); // ball progress toward their goal (0 = our goal line)
    // facing a goal kick, the team drops into a mid-block; only the forwards stay up to press
    if (this.setPieceKind === 'goalkick' && !this.gkPress && b.owner?.frozen && b.owner.team !== p.team && p.role !== 'FWD') bt = Math.min(bt, 0.62);
    const tu = p.team.tune;
    const breaking = teamHas && this.breaking(p.team);
    const compact = teamHas ? 0.9 + tu.support : 0.68 * tu.compact;
    let nx = 0.5 + (p.slot.x - 0.42) * compact + (bt - 0.5) * 0.8 + (teamHas ? 0.07 + tu.support * 0.5 : -0.07) + tu.line;
    if (!teamHas && p.role === 'FWD') nx += tu.holdUp; // someone to hit on the break
    if (breaking && p.role !== 'DEF') nx += 0.06;
    if (p.role === 'DEF') {
      if (!teamHas) nx = Math.min(nx, bt - 0.05); // always goal-side of the ball
      nx = Math.min(nx, tu.defCap);
    }
    if (p.role === 'FWD' && teamHas) nx = Math.max(nx, bt + tu.push + (breaking ? 0.06 : 0));
    nx = clamp(nx, 0.05, 0.93);
    // width matters most with the ball; without it a narrow side still tucks in a little
    const spread = (teamHas ? 0.84 : 0.6) * (teamHas ? tu.width : 1 + (tu.width - 1) * 0.5);
    let tz = p.slot.z * (W / 2) * spread + b.z * (teamHas ? 0.2 : 0.38);
    tz += Math.sin(this.simT * 0.5 + p.idx * 1.7) * 1.0; // let the shape breathe

    let tx = s * (nx * L - L / 2);
    const o = b.owner;
    if (teamHas && o && o !== p) {
      // support: offer an angle instead of crowding the man on the ball...
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < 7) tz += Math.sign(p.z - o.z || 1) * (7 - d);
      // ...and drift away from whoever is marking you, into space
      let near = null, nd = 4;
      for (const q of p.team.opp.players) {
        const dq = Math.hypot(q.x - tx, q.z - tz);
        if (dq < nd) { nd = dq; near = q; }
      }
      if (near) {
        const ax = tx - near.x, az = tz - near.z, al = Math.hypot(ax, az) || 1;
        tx += (ax / al) * (4 - nd);
        tz += (az / al) * (4 - nd);
      }
    }
    return [clamp(tx, -L / 2 + 1, L / 2 - 1), clamp(tz, -W / 2 + 1.5, W / 2 - 1.5)];
  }

  aiSetPiece(p: Player) {
    p.wantX = p.wantZ = 0;
    if (p.aiT > 0) return;
    const s = p.team.side, gx = s * this.L / 2;
    const kind = this.setPieceKind;
    const dGoal = Math.hypot(gx - p.x, p.z);
    if (kind === 'corner') return this.act(p, () => this.cross(p), 'kick', { x: this.goalOf(p).x - p.team.side * 8, z: 0 });
    if (kind === 'goalkick') {
      // wait for the defenders to get into position (a few seconds at most)
      const defs = p.team.players.filter((m) => m.role === 'DEF');
      const set = defs.every((m) => { const [tx, tz] = this.shapeTarget(m, true); return Math.hypot(tx - m.x, tz - m.z) < 3; });
      if (!set && this.stateT < 4.5) return;
      // play it short if a defender is free; if they're pressing high, go long
      const pressing = p.team.opp.players.filter((o) => Math.abs(o.x - p.x) < 25).length;
      if (pressing <= 4 && !this.gkLongAnyway) {
        let best = null, bd = 0;
        for (const m of p.team.players) {
          if (m.role !== 'DEF') continue;
          const open = this.openness(p.team, m.x, m.z);
          if (open > 5 && open > bd && this.passSafety(p, m.x, m.z, false, m) > 0.25) { bd = open; best = m; }
        }
        if (best) return this.act(p, () => this.kickTo(p, best.x, best.z, false, best), 'pass', best);
      }
      // long: toward a forward or midfielder in the middle third
      const fwd = p.team.players.filter((m) => m.role === 'FWD' || m.role === 'MID').sort((a, c) => (c.x - a.x) * s)[0];
      const tx = fwd ? fwd.x : p.x + s * 45, tz = fwd ? fwd.z : rand(-12, 12);
      return this.act(p, () => this.kickTo(p, tx, tz, true, fwd, 1.5, { angle: 0.45 }), 'kick', { x: tx, z: tz });
    }
    if (kind === 'throw') return this.act(p, () => this.throwIn(p, null, false), 'throw');
    if (kind === 'penalty') {
      return this.act(p, () => this.shoot(p, { x: 0, z: Math.random() < 0.5 ? rand(-1, -0.45) : rand(0.45, 1) }, rand(0.55, 0.8)), 'kick', this.goalOf(p));
    }
    if (kind === 'freekick') {
      const set = p.team.opp.players.every((q) => !q.wall || Math.hypot(q.x - q.wall.x, q.z - q.wall.z) < 0.8);
      if (!set && this.stateT < 6.5) return;
    }
    if (kind === 'freekick' && dGoal < 30 && Math.abs(p.z) < 20) {
      return this.act(p, () => this.shoot(p, { x: 0, z: Math.random() < 0.5 ? rand(-1, -0.5) : rand(0.5, 1) }, rand(0.6, 0.85)), 'kick', this.goalOf(p));
    }
    if (kind === 'kickoff') {
      const mate = p.team.players.filter((m) => m !== p && m.role !== 'GK').sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
      if (mate) return this.act(p, () => this.kickTo(p, mate.x, mate.z, false, mate, 0.2), 'pass', mate);
    }
    this.passTarget(p, null);
    const plan = this.passPlan;
    if (plan) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
    this.act(p, () => this.clear(p), 'kick', { x: p.x + p.team.side * 30, z: p.z });
  }

  aiCarrier(p: Player) {
    const { L, W } = this;
    const s = p.team.side;
    const gx = s * L / 2;
    if (p.frozen) return this.aiSetPiece(p);

    // dribble toward goal, drifting central as we get close
    const toLine = (gx - p.x) * s;
    let dx = s, dz = toLine < 30 ? -p.z * 0.04 : 0;
    let near = null, nd = Infinity;
    for (const o of p.team.opp.players) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < nd) { nd = d; near = o; }
    }
    if (near && nd < 6) {
      const ox = (near.x - p.x) / nd, oz = (near.z - p.z) / nd;
      if (ox * dx + oz * dz > 0) {
        const side = ox * dz - oz * dx > 0 ? -1 : 1; // go round the other side
        const push = 1.2 * (6 - nd) / 6;
        const ndx = dx - oz * side * push, ndz = dz + ox * side * push;
        dx = ndx; dz = ndz;
      }
    }
    // a skilful dribbler cuts sharply away from a defender closing in front of him
    p.cutT -= 1 / 60;
    if (near && nd < 2.6 && p.cutT <= -0.6 && Math.random() < 0.05 + p.stat('dribbling') * 0.08) {
      const ox = near.x - p.x, oz = near.z - p.z;
      p.cutSide = ox * dz - oz * dx > 0 ? -1 : 1;
      p.cutT = 0.4;
    }
    if (p.cutT > 0) {
      const a = Math.atan2(dx, dz) + p.cutSide * (p.style === 'close' ? 1.25 : 0.95);
      dx = Math.sin(a);
      dz = Math.cos(a);
    }
    if (Math.abs(p.z) > W / 2 - 3) dz -= Math.sign(p.z) * 0.7; // keep off the touchline
    const dl = Math.hypot(dx, dz) || 1;
    p.wantX += (dx / dl - p.wantX) * 0.15;
    p.wantZ += (dz / dl - p.wantZ) * 0.15;
    const tu = p.team.tune;
    const breaking = this.breaking(p.team);
    p.wantSprint = nd > 3.5 && (toLine > 14 || breaking);
    // a defender squaring up in front: try to beat him with a skill
    if (near && nd < 2.4 && p.skillCd <= 0 && (near.x - p.x) * s > 0) {
      p.skillCd = rand(1.5, 3);
      const sk = p.stat('dribbling'), r = Math.random();
      if (p.style === 'close' && r < 0.3) return this.skillMove(p, 'dragback');
      if (sk > 0.76 && r < 0.25 + (sk - 0.76) * 2) return this.skillMove(p, 'stepover');
    }

    const dGoal = Math.hypot(gx - p.x, p.z);
    if (dGoal < 9 && Math.abs(p.z) < 8 && p.kickCd <= 0) {
      return this.act(p, () => this.shoot(p, { x: 0, z: Math.random() < 0.5 ? rand(-0.8, -0.3) : rand(0.3, 0.8) }, rand(0.3, 0.55)), 'kick', this.goalOf(p));
    }
    if (p.aiT > 0) return;
    p.aiT = rand(0.25, 0.45);

    // under pressure deep in our own half: get rid of it
    if (toLine > L * 0.72 && nd < 3.5 && (p.role === 'DEF' || Math.random() < 0.3)) {
      this.passTarget(p, null);
      const plan = this.passPlan;
      if (plan && plan.margin > 0.2) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
      return this.act(p, () => this.clear(p), 'kick', { x: p.x + p.team.side * 30, z: p.z });
    }
    // shoot (how far out, and how keen, depends on how we're told to play)
    if (dGoal < tu.shootRange && Math.abs(p.z) < 18) {
      const pShoot = Math.min(0.95, (dGoal < 11 ? 0.9 : dGoal < 17 ? 0.4 : 0.1) * tu.shootKeen);
      if (Math.random() < pShoot) {
        const aimZ = Math.random() < 0.5 ? rand(-0.85, -0.2) : rand(0.2, 0.85);
        return this.act(p, () => this.shoot(p, { x: 0, z: aimZ }, clamp(0.35 + dGoal / 40 + rand(0, 0.2), 0.3, 0.92)), 'kick', this.goalOf(p));
      }
    }
    // cross from wide in the final third
    if (toLine < 24 && Math.abs(p.z) > W * 0.26 && Math.random() < 0.55) return this.act(p, () => this.cross(p), 'kick', { x: this.goalOf(p).x - p.team.side * 8, z: 0 });
    // pressed: find a pass that will actually get there; if there isn't one, keep the ball
    if (nd < 2.4 && Math.random() < 0.6) {
      this.passTarget(p, null);
      const plan = this.passPlan;
      if (plan && plan.margin > 0.2) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
    }
    // a forward pass when one is clearly on (on the break, look for it first)
    if (Math.random() < (breaking ? 0.45 : tu.forwardPass)) {
      this.passTarget(p, null, { forwardOnly: true });
      const plan = this.passPlan;
      if (plan && plan.margin > (breaking ? 0.15 : tu.forwardMargin)) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
    }
    // outside the final third, keep the ball moving with simple safe passes
    if (toLine > 30 && !breaking && Math.random() < tu.safePass) {
      this.passTarget(p, null);
      const plan = this.passPlan;
      if (plan && plan.margin > 0.35) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
    }
    // blocked in front: recycle it to someone free
    const ahead = p.team.opp.players.some((o) => (o.x - p.x) * s > 0 && (o.x - p.x) * s < 5 && Math.abs(o.z - p.z) < 3);
    if (ahead && Math.random() < 0.25) {
      this.passTarget(p, null);
      const plan = this.passPlan;
      if (plan && plan.margin > 0.35) return this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
    }
  }

  aiKeeper(p: Player, dt: number) {
    const b = this.ball;
    const s = p.team.side;
    const gx = -s * this.L / 2;
    const GW = this.GW;

    if (b.owner === p && this.gkFeet) {
      // back-pass at his feet: no hands, so play it on (or clear it if he's being closed down)
      p.wantX = p.wantZ = 0;
      p.holdT += dt;
      if (p.holdT > 0.35 && this.state === 'play' && !p.windup) {
        const pressed = this.openness(p.team, p.x, p.z) < 6;
        this.passTarget(p, null);
        const plan = this.passPlan;
        if (plan && plan.margin > 0.3 && !pressed) this.act(p, () => this.playPass(p, plan), 'pass', plan ? { x: plan.tx, z: plan.tz } : null);
        else this.act(p, () => this.kickTo(p, p.x + s * rand(35, 50), rand(-18, 18), true, null, 2));
      }
      return;
    }
    if (b.owner === p) {
      p.wantX = p.wantZ = 0;
      p.holdT += dt;
      p.facing += angDiff(s > 0 ? Math.PI / 2 : -Math.PI / 2, p.facing) * 0.1;
      if (p.holdT > 1.2 && this.state === 'play') {
        const tgt = this.passTarget(p, null);
        if (tgt && this.openness(p.team, tgt.x, tgt.z) > 6 && Math.hypot(tgt.x - p.x, tgt.z - p.z) < 26) {
          this.act(p, () => this.throwTo(p, tgt.x + tgt.vx * 0.5, tgt.z + tgt.vz * 0.5, tgt, true), 'throw');
        } else if (tgt && this.openness(p.team, tgt.x, tgt.z) > 6) {
          this.act(p, () => this.kickTo(p, tgt.x, tgt.z, true, tgt), 'kick', tgt);
        } else {
          this.act(p, () => this.kickTo(p, p.x + s * rand(35, 50), rand(-15, 15), true, null, 2));
        }
      }
      return;
    }

    // penalty: stay on the line until it's struck
    if (this.setPieceKind === 'penalty' && b.owner?.frozen && b.owner.team !== p.team) {
      return this.go(p, gx + s * 0.3, 0, false);
    }

    // a shot is coming: act out the planned save
    const plan = this.shotPlan;
    if (plan && plan.gk === p) {
      p.wantX = p.wantZ = 0;
      if (!p.dived && this.simT >= plan.diveAt && p.diveT <= 0) {
        p.dived = true;
        const dz = plan.z - p.z;
        const remain = Math.max(0.2, plan.tArrive - this.simT);
        if (Math.abs(dz) > 0.55) {
          // the body travels so the hands (about 0.9m out) meet the ball, limited by reach
          const travel = Math.min(Math.abs(dz) - 0.6, plan.reach - 0.6);
          p.diveDir = Math.sign(dz);
          p.diveSpeed = clamp(travel / remain, 2, 9);
          p.diveT = Math.min(0.75, remain + 0.15);
          p.downT = p.diveT + 0.6;
          p.facing = s > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      } else if (!p.dived) {
        this.go(p, p.x, clamp(plan.z, p.z - 0.5, p.z + 0.5), false);
      }
      return;
    }

    // narrow the angle: on the line between ball and goal centre, further out when the ball is close
    const bdx = b.x - gx, bdz = b.z;
    const bd = Math.hypot(bdx, bdz) || 1;
    const out = clamp(1 + (40 - bd) * 0.06, 1, 3.5);
    let tx = gx + (bdx / bd) * out;
    let tz = clamp((bdz / bd) * out, -GW / 2 + 0.4, GW / 2 - 0.4);
    let sprint = false;
    const inBox = Math.abs(b.x - gx) < this.boxD * 0.7 && Math.abs(b.z) < this.boxW * 0.8;
    if (inBox && !b.owner && Math.hypot(b.vx, b.vz) < 14) {
      const myD = this.distBall(p);
      const theirs = Math.min(...p.team.opp.players.map((o) => this.distBall(o)));
      if (myD < theirs + 1) { tx = b.x; tz = b.z; sprint = true; } // come and claim it
    } else if (inBox && b.owner && b.owner.team !== p.team && Math.hypot(b.x - gx, b.z) < 13) {
      // one-on-one: rush out and smother at the striker's feet
      tx = b.x; tz = b.z; sprint = true;
      if (this.distBall(p) < 1.4 && p.aiT <= 0) {
        p.aiT = 0.35;
        if (Math.random() < 0.35 + p.stat('keeping') * 0.3) {
          p.diveDir = Math.sign(b.z - p.z) || 1;
          p.diveT = 0.25;
          p.diveSpeed = 2;
          p.downT = 0.8;
          b.owner.kickCd = 0.6;
          this.onEvent({ type: 'save' });
          this.gain(p);
          return;
        }
      }
    }
    this.go(p, tx, tz, sprint);
  }
}
