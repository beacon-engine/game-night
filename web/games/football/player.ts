// Footballer: a real person (built with MakeHuman from free-licensed parts: web/people/), in a real kit
// (shirt, shorts, socks and boots, coloured for the team, the number printed on the back), moving
// with motion capture (CMU's and Quaternius', baked onto the same skeleton: web/people/).
// Locomotion (idle / walk / jog / run / sprint) is captured cycles, blended by speed, with the stride
// in step with how fast the player is really moving. Kicks and passes are captured strikes with
// either foot, timed so the boot meets the ball when the game strikes it. Other football actions
// (tackles, slides, falls, dives, throw-ins, controls...) are posed on the same skeleton and blended
// in while they last.
import * as THREE from 'three';
import { loadCast, loadMoves, fit, Person, type Cast, type Moves } from '@people/people.ts';
import { Footed, type Kit } from './types.ts';

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const pair = <T>(make: () => T): [T, T] => [make(), make()];

export type SkillKind = 'stepover' | 'dragback';
export type ControlKind = 'head' | 'chest' | 'thigh';
export type Card = 'yellow' | 'red';
// A kick: 0.34 s from the backswing to the follow-through, the foot meeting the ball half way
// through the forward swing (the game strikes the ball then: match.ts uses KICK_CONTACT)
export const KICK_CONTACT = 0.28; // the last stride and the backswing
export const KICK_TIME = KICK_CONTACT + 0.4; // and the follow-through
export type Foot = 0 | 1; // 0 = the -X side leg, 1 = the +X side

// On the floor: 'trip' (stumbles forward, lies there, gets up) or 'side' (after a slide)
export interface Fall {
  kind: 'trip' | 'side';
  t: number;
  total: number;
  side: number;
}

// What the match tells the model each frame (all optional but speed)
export interface BodyState {
  speed: number;
  vf?: number; // velocity forward / sideways, relative to facing
  vl?: number;
  af?: number; // acceleration forward / sideways (for leaning)
  al?: number;
  look?: number; // where the ball is, relative to facing (radians)
  tired?: number; // 0..1
  fall?: Fall | null;
  slide?: boolean;
  slideSide?: number;
  down?: boolean;
  tackle?: boolean;
  dive?: number; // -1/1: diving to that side
  holding?: boolean; // keeper with the ball in his hands
  celebrate?: boolean;
  point?: boolean; // (referee)
  card?: boolean; // (referee)
  throwHold?: boolean;
  gkReady?: boolean;
  reach?: 'high' | 'mid' | 'low' | null;
  wallJump?: boolean;
}

interface LegPose { hip: number; knee: number; ankle: number; z: number }
interface ArmPose { x: number; z: number; elbow: number }
interface Pose {
  hipsY: number; hipsX: number; hipsZ: number; hipsYaw: number;
  spineX: number; spineYaw: number; neckX: number;
  legs: [LegPose, LegPose];
  arms: [ArmPose, ArmPose];
}
const POSE_SCALARS = ['hipsY', 'hipsX', 'hipsZ', 'hipsYaw', 'spineX', 'spineYaw', 'neckX'] as const;

// how much each part of the body follows the procedural pose rather than the motion capture
const PARTS = ['hips', 'spine', 'neck', 'leg0', 'leg1', 'arm0', 'arm1'] as const;
type Weights = Record<(typeof PARTS)[number], number>;
const LEG = ['leg0', 'leg1'] as const;
const ARM = ['arm0', 'arm1'] as const;
const noWeights = (): Weights => ({ hips: 0, spine: 0, neck: 0, leg0: 0, leg1: 0, arm0: 0, arm1: 0 });

// The captured cycles, slowest first, each played at its natural rate at the speed it was captured at
// (moves.json), faster or slower in between. `phase` (worked out on loading) lines each stride up with
// the others, so blending between them never crosses the legs.
interface Loco { clip: string; speed: number; phase: number }
const LOCO_CLIPS = ['walk', 'jog', 'run'];
let LOCO: Loco[] = [];
const IDLE = 'idle';
// How much faster than captured a cycle plays, running k times as fast as it was captured at. Above
// the captured run (4.8 m/s: the capture room was small) a footballer at 8 m/s doesn't turn his legs
// over nearly twice as fast but takes longer strides, so the rate rises more slowly there.
const FASTER = 0.5;
const cadence = (k: number) => (k <= 1 ? k : Math.pow(k, FASTER));

// Strikes: a captured kick (a shot, a long ball) and a pass, for each foot. The clip starts KICK_CONTACT
// before its foot meets the ball, and fades back into running over the follow-through.
const STRIKES = { kick: { [Footed.Right]: 'kick_r', [Footed.Left]: 'kick_l' }, pass: { [Footed.Right]: 'pass_r', [Footed.Left]: 'pass_l' } } as const;
export type Strike = keyof typeof STRIKES;
const STRIKE_FADE = { in: 0.06, out: 0.22 }; // s

// ------------------------------------------------------------------ assets --
interface Assets {
  cast: Cast;
  moves: Moves;
  spots: Map<string, { x: number; z: number; height: number }>; // where each strike meets the ball (see strikeSpot)
  facing: number;
  c2s: THREE.Quaternion; // character space (X left, Y up, Z forward) -> the rig's space
}
let ASSET: Assets; // set by loadPlayerAssets(), before any PlayerModel is made

// Who in the cast plays whom: outfield players, keepers (in gloves) and the referee
const OUTFIELD = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
const KEEPERS = ['gk1', 'gk2'];
const REFEREE = 'ref';

const isBone = (o: THREE.Object3D): o is THREE.Bone => o instanceof THREE.Bone;

function collect<T extends THREE.Object3D>(root: THREE.Object3D, is: (o: THREE.Object3D) => o is T) {
  const out: T[] = [];
  root.traverse((o) => { if (is(o)) out.push(o); });
  return out;
}

// bones by normalised name: 'thighl', 'spine02'...
const bonesOf = (root: THREE.Object3D) => Object.fromEntries(collect(root, isBone).map((b) => [norm(b.name), b]));

export async function loadPlayerAssets() {
  const [cast, moves] = await Promise.all([loadCast('footballers'), loadMoves('football-moves')]);
  // which way the bodies face (heel -> toe), from one of them at rest
  const one = new Person(cast, OUTFIELD[0]);
  one.root.updateMatrixWorld(true);
  const bones = bonesOf(one.root);
  const wp = (n: string) => new THREE.Vector3().setFromMatrixPosition(bones[n].matrixWorld);
  const f = wp('balll').sub(wp('footl')).setY(0).normalize();
  const facing = Math.atan2(f.x, f.z);
  const c2s = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
  ASSET = { cast, moves, facing, c2s, spots: new Map() };
  for (const kind of Object.values(STRIKES)) for (const name of Object.values(kind)) ASSET.spots.set(name, strikePoint(one, name));
  LOCO = LOCO_CLIPS.filter((c) => moves.clips.has(c)).map((clip) => ({ clip, speed: moves.info[clip].speed, phase: stridePhase(one, clip) }));
}

// Where the striking boot is, over the ground, at the moment a strike meets the ball: in character
// space (x to his left, z ahead), measured on one body (its height given, to scale to others).
// A real kick meets the ball beside the standing foot, well to the side of the body's middle.
function strikePoint(p: Person, clip: string) {
  const c = fit(ASSET.moves, p.root).get(clip);
  const at = ASSET.moves.info[clip]?.contact;
  if (!c || at === undefined) return { x: 0, z: 0.35, height: p.height };
  const mixer = new THREE.AnimationMixer(p.root);
  mixer.clipAction(c).play();
  mixer.setTime(at);
  p.root.updateMatrixWorld(true);
  const toe = p.bones.get(clip.endsWith('_l') ? 'ball_l' : 'ball_r')!.getWorldPosition(new THREE.Vector3());
  toe.applyQuaternion(_q2.copy(ASSET.c2s).invert());
  mixer.stopAllAction();
  return { x: toe.x, z: toe.z, height: p.height };
}

// Where in its cycle a clip has the left foot furthest forward (about when it lands), 0..1
function stridePhase(p: Person, clip: string) {
  const c = fit(ASSET.moves, p.root).get(clip)!;
  const mixer = new THREE.AnimationMixer(p.root);
  mixer.clipAction(c).play();
  const foot = p.bones.get('foot_l')!, hips = p.bones.get('pelvis')!;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let best = -Infinity, at = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    mixer.setTime((i / N) * c.duration);
    p.root.updateMatrixWorld(true);
    const ahead = foot.getWorldPosition(a).sub(hips.getWorldPosition(b)).applyQuaternion(_q2.copy(ASSET.c2s).invert()).z;
    if (ahead > best) { best = ahead; at = i / N; }
  }
  mixer.stopAllAction();
  return at;
}

const BOOTS = ['#111111', '#111111', '#f5f5f5', '#e11d48', '#facc15', '#22c55e', '#2563eb'];
const HAIR = ['#0d0a08', '#15100c', '#1e1610', '#2a1d14'];
const SKIN = [1, 0.94, 0.88, 0.82, 0.76]; // (darker or lighter than the body's own texture)
const GLOVES = '#e2e8f0';

export const DISPLAY_FONT = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';

function nameTexture(text: string, color = '#ffffff', bg?: string) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `800 34px ${DISPLAY_FONT}`;
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  c.width = tw + 28;
  c.height = 46;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(2, 3, c.width - 4, c.height - 6, 8);
    g.fill();
    g.fillStyle = '#000';
    g.fillText(text, c.width / 2, c.height / 2 + 1);
  } else {
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, c.width / 2, c.height / 2 + 1);
    g.fillStyle = color;
    g.fillText(text, c.width / 2, c.height / 2 + 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Screen-space label (same size wherever the player is)
export function makeLabel(text: string, opts: { color?: string; bg?: string; height?: number; opacity?: number } = {}) {
  const tex = nameTexture(text, opts.color, opts.bg);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true, opacity: opts.opacity ?? 1 }));
  const h = opts.height ?? 0.028;
  s.scale.set((h * tex.image.width) / tex.image.height, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 20;
  return s;
}

const shadowGeo = new THREE.CircleGeometry(0.45, 16);
shadowGeo.rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false });

// ----------------------------------------------------- pose helpers (math) --
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const qAxis = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

// A driven bone: rotations are given in character space (X = left, Y = up, Z = forward) relative to the
// bone's rest orientation, applied in its parent's current frame, just like simple hierarchical joints.
class Joint {
  readonly restLocal: THREE.Quaternion;
  readonly restPos: THREE.Vector3;
  private readonly M: THREE.Quaternion;
  private readonly Minv: THREE.Quaternion;
  private readonly target = new THREE.Quaternion();

  constructor(readonly bone: THREE.Bone, c2s: THREE.Quaternion) {
    this.restLocal = bone.quaternion.clone();
    this.restPos = bone.position.clone();
    const restWorld = new THREE.Quaternion();
    bone.getWorldQuaternion(restWorld);
    // M maps a character-space rotation into this bone's local delta
    this.M = restWorld.clone().invert().multiply(c2s);
    this.Minv = this.M.clone().invert();
  }
  // local quaternion for a character-space delta D (from rest)
  pose(D: THREE.Quaternion) {
    return this.target.copy(this.restLocal).multiply(_q.copy(this.M).multiply(D).multiply(this.Minv));
  }
  // small extra rotation on top of whatever the motion capture is doing
  addLocal(D: THREE.Quaternion) {
    this.bone.quaternion.multiply(_q.copy(this.M).multiply(D).multiply(this.Minv));
  }
}

// --------------------------------------------------------------- the model --
interface Leg { hip: Joint; knee: Joint; ankle: Joint; side: number }
interface Arm {
  shoulder: Joint;
  elbow: Joint;
  hand: THREE.Bone;
  side: number;
  down: THREE.Quaternion; // lets the T-posed arm hang down
  elbowAxis: THREE.Vector3; // the elbow's hinge once it does
}
type LocoAction = Loco & { action: THREE.AnimationAction; dur: number };

export interface ModelOptions {
  kit: Kit;
  number: number | ''; // '' = no number on the back
  name: string;
  gk: boolean;
  seed?: number; // picks skin, hair, boots and build
  referee?: boolean;
}

export class PlayerModel {
  readonly root = new THREE.Group(); // place this in the scene
  readonly tag: THREE.Sprite; // name above the head
  readonly build: number; // how tall, for reaching (1 = 1.80 m)
  readonly height: number; // m
  private readonly body = new THREE.Group();
  private readonly j: Record<'hips' | 'spine1' | 'spine2' | 'spine3' | 'neck' | 'head', Joint>;
  private readonly legs: [Leg, Leg];
  private readonly feet: [THREE.Bone, THREE.Bone];
  private readonly arms: [Arm, Arm];
  private readonly restHipsHeight: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly loco: LocoAction[];
  private readonly card: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private cycle: number;
  private time: number;
  private kickT = 0;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private strike: THREE.AnimationAction | null = null; // a captured kick or pass, playing
  private strikeT = 0;
  private strikeEnd = 0;
  private kickLeg: Foot = 1; // the leg swinging at the ball
  private readonly rightLeg: Foot; // which of the two (by side) is his right
  private touchT = 0;
  private touchFoot: Foot = 1;
  private touchReach = 0;
  private throwT = 0;
  private skillKind: SkillKind = 'stepover';
  private skillDur = 0.5;
  private skillT = 0;
  private skillSide = 1;
  private ctrlKind: ControlKind = 'chest';
  private ctrlT = 0;
  private lookYaw = 0;
  private strafePh = 0;
  private W = noWeights();
  private P: Pose | null = null; // eased procedural pose

  constructor({ kit, number, name, gk, seed = 0, referee = false }: ModelOptions) {
    const rnd = mulberry(seed * 9301 + 49297);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const who = referee ? REFEREE : gk ? pick(KEEPERS) : pick(OUTFIELD);
    const person = new Person(ASSET.cast, who);
    person.dress({
      shirt: kit.shirt, second: kit.second, pattern: kit.pattern, shorts: kit.shorts, socks: kit.socks,
      boots: pick(BOOTS), gloves: GLOVES, number, numberColor: kit.number,
    });
    person.tint('hair', pick(HAIR));
    person.tint('brows', pick(HAIR));
    const shade = pick(SKIN);
    person.tint('skin', new THREE.Color(shade, shade, shade));
    const build = person.height / 1.8; // (how tall, for reaching: 1 = 1.80 m)
    const scene = person.root;
    const bones = bonesOf(scene);
    scene.updateMatrixWorld(true);
    const c2s = ASSET.c2s;
    const J = (n: string) => new Joint(bones[n], c2s);
    this.j = {
      hips: J('pelvis'), spine1: J('spine01'), spine2: J('spine02'), spine3: J('spine03'),
      neck: J('neck01'), head: J('head'),
    };
    // left/right as they sit in character space: index 0 = the -X side, 1 = the +X side
    const toChar = (n: string) => _v.setFromMatrixPosition(bones[n].matrixWorld).applyQuaternion(_q2.copy(c2s).invert());
    const sideOf = (n: string) => Math.sign(toChar(n).x);
    const leg = (s: string): Leg => ({ hip: J(`thigh${s}`), knee: J(`calf${s}`), ankle: J(`foot${s}`), side: sideOf(`thigh${s}`) });
    // the arms are modelled out sideways (T-pose): work out the rotation that lets them hang down,
    // and the elbow axis once they do
    const arm = (s: string): Arm => {
      const shoulder = toChar(`upperarm${s}`).clone();
      const dir = toChar(`lowerarm${s}`).sub(shoulder).normalize();
      const down = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, -1, 0));
      return {
        shoulder: J(`upperarm${s}`), elbow: J(`lowerarm${s}`), hand: bones[`hand${s}`], side: sideOf(`upperarm${s}`),
        down, elbowAxis: AX.clone().applyQuaternion(down.clone().invert()),
      };
    };
    const [legL, legR, armL, armR] = [leg('l'), leg('r'), arm('l'), arm('r')];
    this.legs = legL.side < 0 ? [legL, legR] : [legR, legL];
    this.rightLeg = legL.side < 0 ? 1 : 0;
    this.feet = legL.side < 0 ? [bones.balll, bones.ballr] : [bones.ballr, bones.balll];
    this.arms = armL.side < 0 ? [armL, armR] : [armR, armL];
    this.restHipsHeight = this.j.hips.restPos.z; // the rig's root is Z-up

    // motion capture
    const clips = fit(ASSET.moves, scene);
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(scene);
    this.idle = this.mixer.clipAction(clips.get(IDLE)!);
    this.idle.play();
    this.loco = LOCO.map((l) => {
      const c = clips.get(l.clip)!;
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      a.timeScale = 0; // we drive their time ourselves so the cycles stay in step
      return { ...l, action: a, dur: c.duration };
    });
    this.idle.time = rnd() * this.idle.getClip().duration;
    this.cycle = rnd();

    this.body.rotation.y = -ASSET.facing; // face +Z
    this.body.add(scene);
    this.build = build;
    this.height = person.height;
    this.root.add(this.body);
    const blob = new THREE.Mesh(shadowGeo, shadowMat);
    blob.position.y = 0.015;
    this.root.add(blob);

    this.tag = makeLabel(name.toUpperCase(), { height: 0.011, opacity: 0.9 });
    this.tag.position.y = person.height + 0.32;
    this.root.add(this.tag);

    if (referee) {
      this.card = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.105, 0.006), new THREE.MeshBasicMaterial({ color: '#facc15' }));
      this.card.visible = false;
      this.arms[1].hand.add(this.card);
    }
    this.time = rnd() * 10;
  }

  // A strike with this foot: 'kick' (a shot, a clearance, a long ball) or 'pass'. The captured strike
  // starts KICK_CONTACT before the boot meets the ball (when the game strikes it).
  kick(foot: Footed.Left | Footed.Right = Footed.Right, kind: Strike = 'kick') {
    this.kickT = KICK_TIME;
    this.kickLeg = foot === Footed.Right ? this.rightLeg : this.rightLeg ? 0 : 1;
    const name = STRIKES[kind][foot];
    const clip = this.clips.get(name);
    if (!clip) return;
    this.strike?.stop();
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.time = Math.max(0, (ASSET.moves.info[name].contact ?? 0) - KICK_CONTACT);
    a.timeScale = 0; // (stepped by update)
    a.play();
    this.strike = a;
    this.strikeT = 0;
    this.strikeEnd = clip.duration - a.time;
  }
  // reach: 0 = ball at the foot, up to 1 = stretching for it (the leg extends further toward it)
  touch(foot: Foot = this.touchFoot ? 0 : 1, reach = 0) { this.touchT = 0.2; this.touchFoot = foot; this.touchReach = reach; }

  // Where the ball wants to be for this strike, relative to him: x to his left, z ahead (m)
  strikeSpot(kind: Strike, foot: Footed.Left | Footed.Right) {
    const s = ASSET.spots.get(STRIKES[kind][foot]);
    if (!s) return { x: 0, z: 0.35 };
    const k = this.height / s.height;
    return { x: s.x * k, z: s.z * k };
  }

  // where each foot is (index 0 = the -X side leg, 1 = the +X side), in world space
  footWorld(i: Foot, out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    return this.feet[i].getWorldPosition(out);
  }
  // the foot swinging at the ball right now, in world space
  strikingFootWorld(out: THREE.Vector3) { return this.footWorld(this.kickLeg, out); }
  throwBall() { this.throwT = 0.36; }
  skill(kind: SkillKind, side = 1) {
    this.skillKind = kind;
    this.skillDur = kind === 'stepover' ? 0.5 : 0.45;
    this.skillT = this.skillDur;
    this.skillSide = side;
  }
  control(kind: ControlKind) { this.ctrlKind = kind; this.ctrlT = 0.45; }
  showCard(color: Card | null) {
    if (!this.card) return;
    this.card.visible = !!color;
    if (color) this.card.material.color.set(color === 'red' ? '#dc2626' : '#facc15');
  }

  // world position between the two hands (where a held ball sits)
  handsWorld(out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.arms[0].hand.getWorldPosition(a);
    this.arms[1].hand.getWorldPosition(b);
    return out.copy(a).add(b).multiplyScalar(0.5).add(_v.set(0, -0.06, 0));
  }

  update(dt: number, st: BodyState) {
    this.time += dt;
    const sp = st.speed;
    const vf = st.vf ?? sp, vl = st.vl ?? 0;
    const strafe = sp < 4.5 ? clamp((Math.abs(vl) - Math.abs(vf) * 0.7) / 1.2, 0, 1) : 0;
    const back = vf < -0.3 && strafe < 0.5;

    // ---- motion capture locomotion: blend idle / walk / jog / run / sprint by speed, cycles in step
    const runSp = sp * (1 - strafe * 0.6);
    const n = this.loco.length;
    const lw = new Array<number>(n).fill(0);
    let wIdle = 1, rate = 0;
    const START = 0.25; // m/s: below this, standing
    if (runSp > START && n) {
      const first = this.loco[0].speed;
      if (runSp < first) { const k = (runSp - START) / (first - START); wIdle = 1 - k; lw[0] = k; }
      else {
        wIdle = 0;
        let i = 0;
        while (i < n - 1 && runSp >= this.loco[i + 1].speed) i++;
        if (i === n - 1) lw[i] = 1;
        else { const k = (runSp - this.loco[i].speed) / (this.loco[i + 1].speed - this.loco[i].speed); lw[i] = 1 - k; lw[i + 1] = k; }
      }
    }
    for (let i = 0; i < n; i++) rate += lw[i] * cadence(Math.max(runSp, 0.6) / this.loco[i].speed) / this.loco[i].dur;
    this.cycle = (this.cycle + dt * rate * (back ? -1 : 1) + 1) % 1;

    // ---- a captured strike over the top, fading in fast and out over the follow-through
    let ws = 0;
    if (this.strike) {
      this.strikeT += dt;
      this.strike.time = Math.min(this.strike.getClip().duration, this.strike.time + dt);
      const left = this.strikeEnd - this.strikeT;
      ws = Math.min(1, this.strikeT / STRIKE_FADE.in, Math.max(0, left / STRIKE_FADE.out), Math.max(0, (KICK_TIME + STRIKE_FADE.out - this.strikeT) / STRIKE_FADE.out));
      if (ws <= 0 && this.strikeT > STRIKE_FADE.in) { this.strike.stop(); this.strike = null; ws = 0; }
      else this.strike.setEffectiveWeight(ws);
    }
    this.idle.setEffectiveWeight(wIdle * (1 - ws));
    this.idle.time = (this.idle.time + dt) % this.idle.getClip().duration;
    this.loco.forEach((l, i) => {
      l.action.setEffectiveWeight(lw[i] * (1 - ws));
      l.action.time = ((this.cycle + l.phase) % 1) * l.dur;
    });
    this.mixer.update(0);

    // ---- procedural action pose (only blended in where an action needs it)
    const T = this.actionPose(dt, st, strafe);
    const want = this.weights(st, strafe);
    const fast = this.kickT > 0 || st.tackle;
    for (const k of PARTS) this.W[k] = lerp(this.W[k], want[k], Math.min(1, dt * (want[k] > this.W[k] ? (fast ? 30 : 12) : 8)));
    if (!this.P) this.P = structuredClone(T);
    const kE = Math.min(1, dt * (st.fall ? 10 : fast ? 30 : 14));
    const P = this.P;
    for (const key of POSE_SCALARS) P[key] = lerp(P[key], T[key], kE);
    for (let i = 0; i < 2; i++) {
      for (const key of ['hip', 'knee', 'ankle', 'z'] as const) P.legs[i][key] = lerp(P.legs[i][key], T.legs[i][key], kE);
      for (const key of ['x', 'z', 'elbow'] as const) P.arms[i][key] = lerp(P.arms[i][key], T.arms[i][key], kE);
    }
    this.apply(P);

    // ---- always-on touches: lean into turns/acceleration, tiredness, head follows the ball
    const j = this.j;
    const leanF = clamp((st.af || 0) * 0.03, -0.2, 0.22) * (1 - this.W.spine);
    const leanS = clamp(-Math.atan((st.al || 0) / 9.81) * 0.7, -0.3, 0.3) * (1 - this.W.hips);
    const tired = st.tired || 0;
    j.hips.addLocal(qAxis(AZ, leanS));
    j.spine2.addLocal(qAxis(AX, leanF + 0.12 * tired));
    this.lookYaw = lerp(this.lookYaw, clamp(st.look || 0, -1.1, 1.1), Math.min(1, dt * 6));
    j.neck.addLocal(qAxis(AY, this.lookYaw * 0.6 * (1 - this.W.neck)));
    j.head.addLocal(qAxis(AY, this.lookYaw * 0.4 * (1 - this.W.neck)));
  }

  // how much each part of the body follows the procedural pose rather than the motion capture
  private weights(st: BodyState, strafe: number) {
    const W = noWeights();
    const all = (v = 1) => { for (const k of PARTS) W[k] = Math.max(W[k], v); };
    const legs = (v = 1) => { W.leg0 = Math.max(W.leg0, v); W.leg1 = Math.max(W.leg1, v); };
    const arms = (v = 1) => { W.arm0 = Math.max(W.arm0, v); W.arm1 = Math.max(W.arm1, v); };
    if (st.slide || st.fall || st.down || st.dive || st.wallJump || st.gkReady || st.reach === 'low') all();
    if (this.kickT > 0 && !this.strike) { legs(); arms(); W.spine = Math.max(W.spine, 0.7); W.hips = Math.max(W.hips, 0.6); }
    if (this.touchT > 0) W[LEG[this.touchFoot]] = Math.max(W[LEG[this.touchFoot]], 0.45 + 0.5 * this.touchReach);
    if (this.skillT > 0) { legs(); arms(0.6); W.hips = 1; W.spine = Math.max(W.spine, 0.6); }
    if (st.tackle) { legs(); arms(); W.hips = 1; W.spine = 1; }
    if (st.throwHold || this.throwT > 0) { arms(); W.spine = 1; }
    if (this.ctrlT > 0) {
      if (this.ctrlKind === 'chest') { arms(); W.spine = 1; W.neck = 1; }
      else if (this.ctrlKind === 'head') { arms(0.8); W.neck = 1; W.spine = Math.max(W.spine, 0.6); }
      else { W.leg1 = 1; arms(0.6); }
    }
    if (st.reach === 'mid' || st.reach === 'high') { arms(); if (st.reach === 'high') W.hips = Math.max(W.hips, 0.5); }
    if (st.holding || st.celebrate) arms();
    if (st.point || st.card) W.arm1 = 1;
    if (strafe > 0.3) { legs(strafe); arms(strafe * 0.5); }
    return W;
  }

  // Write the procedural pose into the skeleton, blended by body part
  private apply(P: Pose) {
    const j = this.j, W = this.W;
    const blend = (joint: Joint, D: THREE.Quaternion, w: number) => { if (w > 0.001) joint.bone.quaternion.slerp(joint.pose(D), w); };
    // hips: height and orientation
    if (W.hips > 0.001) {
      j.hips.bone.position.z = lerp(j.hips.bone.position.z, (P.hipsY / 0.95) * this.restHipsHeight, W.hips);
      blend(j.hips, qAxis(AY, P.hipsYaw).multiply(qAxis(AX, P.hipsX)).multiply(qAxis(AZ, P.hipsZ)), W.hips);
    }
    if (W.spine > 0.001) {
      const half = qAxis(AX, P.spineX * 0.5).multiply(qAxis(AY, P.spineYaw * 0.5));
      blend(j.spine1, half, W.spine);
      blend(j.spine2, half.clone(), W.spine);
      blend(j.spine3, new THREE.Quaternion(), W.spine);
    }
    if (W.neck > 0.001) blend(j.neck, qAxis(AX, P.neckX), W.neck);
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], A = this.arms[i], pl = P.legs[i], pa = P.arms[i];
      const wl = W[LEG[i]], wa = W[ARM[i]];
      if (wl > 0.001) {
        blend(L.hip, qAxis(AX, pl.hip).multiply(qAxis(AZ, pl.z * L.side)), wl);
        blend(L.knee, qAxis(AX, pl.knee), wl);
        blend(L.ankle, qAxis(AX, pl.ankle), wl);
      }
      if (wa > 0.001) {
        blend(A.shoulder, qAxis(AX, pa.x).multiply(qAxis(AZ, A.side * pa.z)).multiply(A.down), wa);
        blend(A.elbow, qAxis(A.elbowAxis, pa.elbow), wa);
      }
    }
  }

  // The pose each football action calls for (standing neutral where nothing is happening)
  private actionPose(dt: number, st: BodyState, strafe: number) {
    const T: Pose = {
      hipsY: 0.95, hipsX: 0, hipsZ: 0, hipsYaw: 0, spineX: 0.04, spineYaw: 0, neckX: -0.05,
      legs: pair(() => ({ hip: 0, knee: 0.1, ankle: 0, z: 0 })),
      arms: pair(() => ({ x: 0, z: 0.12, elbow: -0.3 })),
    };
    if (strafe > 0) {
      // side-stepping (jockeying): legs open and close alternately, low athletic stance
      this.strafePh += dt * Math.PI * 2 * (0.8 + st.speed * 0.35);
      for (let i = 0; i < 2; i++) {
        const p = this.strafePh + i * Math.PI;
        T.legs[i].z = Math.max(0, Math.sin(p)) * 0.38;
        T.legs[i].hip = -0.25; T.legs[i].knee = 0.5;
      }
      T.hipsY = 0.88; T.spineX = 0.2;
      for (const A of T.arms) { A.z = 0.35; A.elbow = -0.6; }
    }
    if (this.kickT > 0) this.kickT -= dt;
    if (this.kickT > 0 && !this.strike) {
      const p = 1 - Math.max(0, this.kickT) / KICK_TIME;
      const R = T.legs[this.kickLeg], Lg = T.legs[this.kickLeg ? 0 : 1];
      if (p < 0.3) { const k = p / 0.3; R.hip = lerp(0.1, 0.75, k); R.knee = lerp(0.3, 1.5, k); }
      else if (p < 0.6) { const k = (p - 0.3) / 0.3; R.hip = lerp(0.75, -1.2, k); R.knee = lerp(1.5, 0.05, k); }
      else { const k = (p - 0.6) / 0.4; R.hip = lerp(-1.2, -0.3, k); R.knee = lerp(0.05, 0.35, k); }
      Lg.hip = -0.15; Lg.knee = 0.4; R.z = Lg.z = 0;
      // (the arm on the kicking side swings back, the other one out for balance)
      const [back, out] = this.kickLeg ? [T.arms[0], T.arms[1]] : [T.arms[1], T.arms[0]];
      back.x = -0.35; back.z = 0.9; out.x = 0.3; out.z = 0.6;
      T.spineX = -0.08; T.hipsY = 0.9;
    }
    if (this.touchT > 0) {
      this.touchT -= dt;
      const q = Math.sin(Math.PI * (1 - Math.max(0, this.touchT) / 0.2));
      const L = T.legs[this.touchFoot];
      const r = this.touchReach;
      L.hip = -0.15 - (0.4 + 0.5 * r) * q; L.knee = 0.35 - (0.2 + 0.15 * r) * q; L.ankle = 0.25 * q;
    }
    if (this.skillT > 0) {
      this.skillT -= dt;
      const q = 1 - Math.max(0, this.skillT) / this.skillDur;
      const sd = this.skillSide;
      const L = T.legs[sd > 0 ? 1 : 0], O = T.legs[sd > 0 ? 0 : 1];
      if (this.skillKind === 'stepover') {
        const arc = Math.sin(Math.PI * q);
        L.hip = -0.55 * arc; L.knee = 0.5 + 0.4 * arc; L.z = 0.55 * Math.sin(2 * Math.PI * q);
        O.knee = 0.35; O.hip = 0.05;
        T.hipsZ = sd * 0.28 * arc; T.spineYaw = sd * 0.35 * arc; T.hipsY = 0.9 - 0.05 * arc;
        for (const A of T.arms) { A.z = 0.45; A.x = -0.2; }
      } else {
        const reach = q < 0.4 ? q / 0.4 : 1, pull = q < 0.4 ? 0 : (q - 0.4) / 0.6;
        L.hip = lerp(-0.1, -0.75, reach) + 1.05 * pull; L.knee = lerp(0.3, 0.1, reach) + 0.5 * pull; L.ankle = -0.3;
        O.knee = 0.4;
        T.spineX = lerp(0.04, -0.15, reach); T.hipsY = 0.91;
        for (const A of T.arms) { A.z = 0.5; A.x = -0.15; }
      }
    }
    if (st.tackle) {
      T.hipsY = 0.8; T.spineX = 0.3;
      T.legs[1].hip = -1.05; T.legs[1].knee = 0.15; T.legs[1].z = 0.25;
      T.legs[0].hip = 0.2; T.legs[0].knee = 0.75;
      T.arms[0].x = -0.3; T.arms[0].z = 0.8; T.arms[1].x = 0.4; T.arms[1].z = 0.6;
    }
    if (st.gkReady) {
      T.hipsY = 0.84; T.spineX = 0.38; T.neckX = -0.35;
      for (const Lg of T.legs) { Lg.hip = -0.45; Lg.knee = 0.75; }
      for (const A of T.arms) { A.x = -0.55; A.z = 0.45; A.elbow = -0.7; }
    }
    if (st.reach === 'low') {
      T.hipsY = 0.62; T.spineX = 0.85; T.neckX = -0.6;
      for (const Lg of T.legs) { Lg.hip = -0.7; Lg.knee = 1.3; }
      for (const A of T.arms) { A.x = -0.35; A.z = 0.12; A.elbow = -0.15; }
    } else if (st.reach === 'mid') {
      for (const A of T.arms) { A.x = -1.25; A.z = 0.05; A.elbow = -0.85; }
    } else if (st.reach === 'high') {
      for (const A of T.arms) { A.x = -2.85; A.z = 0.12; A.elbow = -0.15; }
      T.hipsY = 1.0;
    }
    if (st.throwHold || this.throwT > 0) {
      let x = -3.0, el = -1.5;
      if (this.throwT > 0) {
        this.throwT -= dt;
        const q = 1 - Math.max(0, this.throwT) / 0.36;
        const sw = q < 0.25 ? 0 : Math.min(1, (q - 0.25) / 0.45);
        x = lerp(-3.05, -1.2, sw); el = lerp(-1.6, -0.1, sw);
        T.spineX = lerp(-0.3, 0.35, sw);
      } else T.spineX = -0.15;
      for (const A of T.arms) { A.x = x; A.z = -0.12; A.elbow = el; }
    }
    if (this.ctrlT > 0) {
      this.ctrlT -= dt;
      const q = Math.sin(Math.PI * (1 - Math.max(0, this.ctrlT) / 0.45));
      if (this.ctrlKind === 'chest') {
        T.spineX = lerp(0.04, -0.45, q); T.neckX = lerp(-0.05, 0.35, q);
        for (const A of T.arms) { A.x = -0.35 * q; A.z = lerp(0.12, 0.85, q); }
      } else if (this.ctrlKind === 'head') {
        T.neckX = lerp(-0.05, -0.5, q) + 0.6 * Math.max(0, q - 0.6);
        T.spineX = lerp(0.04, -0.15, q);
        for (const A of T.arms) { A.x = -0.6 * q; A.z = lerp(0.12, 0.6, q); }
      } else {
        const R = T.legs[1];
        R.hip = -1.25 * q; R.knee = lerp(0.1, 1.4, q);
        T.legs[0].knee = 0.25 * q;
        for (const A of T.arms) A.z = lerp(0.12, 0.7, q);
      }
    }
    if (st.wallJump) {
      for (const Lg of T.legs) { Lg.hip = -0.35; Lg.knee = 0.8; }
      for (const A of T.arms) { A.x = -0.25; A.z = -0.35; A.elbow = -0.6; }
      T.spineX = 0.1;
    }
    if (st.point) { T.arms[1].x = -1.55; T.arms[1].z = 0.35; T.arms[1].elbow = -0.05; }
    if (st.card) { T.arms[1].x = -3.05; T.arms[1].z = 0.1; T.arms[1].elbow = -0.05; }
    if (st.holding) for (const A of T.arms) { A.x = -0.75; A.elbow = -1.45; A.z = -0.38; }
    if (st.celebrate) for (const A of T.arms) { A.x = -2.6 + Math.sin(this.time * 9) * 0.15; A.z = 0.45; A.elbow = -0.2; }
    if (st.slide) this.sidePose(T, st.slideSide || 1);
    else if (st.fall) this.fallPose(T, st.fall);
    else if (st.down) {
      T.hipsY = 0.3; T.hipsX = 0.2; T.hipsZ = 1.2; T.spineX = 0.1; T.neckX = -0.2;
      T.legs[0].hip = -0.5; T.legs[0].knee = 0.9; T.legs[1].hip = -0.2; T.legs[1].knee = 0.5;
      T.arms[0].x = -0.6; T.arms[0].z = 0.4; T.arms[1].x = -1.0; T.arms[1].z = 0.3;
    }
    if (st.dive) {
      T.hipsY = 0.62; T.hipsZ = st.dive * 1.35; T.hipsX = 0; T.spineX = 0.05;
      for (const A of T.arms) { A.x = -2.9; A.z = 0.15; A.elbow = -0.1; }
      T.legs[0].hip = 0.05; T.legs[0].knee = 0.3; T.legs[1].hip = -0.1; T.legs[1].knee = 0.2;
    }
    return T;
  }

  // On the side and hip (slide tackle)
  private sidePose(T: Pose, side: number) {
    T.hipsY = 0.3; T.hipsX = -0.3; T.hipsZ = side * 1.05; T.spineX = 0.2; T.neckX = -0.3;
    const lead = T.legs[1], trail = T.legs[0];
    lead.hip = -0.95; lead.knee = 0.05; lead.z = 0; lead.ankle = 0.2;
    trail.hip = -0.35; trail.knee = 1.4; trail.z = 0;
    const low = side > 0 ? T.arms[1] : T.arms[0], high = side > 0 ? T.arms[0] : T.arms[1];
    low.x = 0.35; low.z = 1.25; low.elbow = -0.2;
    high.x = -0.8; high.z = 0.6; high.elbow = -0.5;
  }

  // Stumble forward onto the hands, lie a moment, get up through the knees (or, after a slide,
  // up from the side onto a knee)
  private fallPose(T: Pose, f: Fall) {
    const t = f.t, tot = f.total;
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (f.kind === 'side') {
      this.sidePose(T, f.side);
      const up = clamp((t - (tot - 0.6)) / 0.6, 0, 1);
      if (up > 0) {
        const k = ease(up);
        T.hipsZ = lerp(T.hipsZ, 0, k); T.hipsX = lerp(T.hipsX, 0.2 * (1 - k), k);
        T.hipsY = lerp(0.3, 0.95, k); T.spineX = lerp(T.spineX, 0.1, k);
        T.legs[0].hip = lerp(T.legs[0].hip, -0.1, k); T.legs[0].knee = lerp(1.5, 0.15, k);
        T.legs[1].hip = lerp(T.legs[1].hip, 0, k); T.legs[1].knee = lerp(T.legs[1].knee, 0.1, k);
        for (const A of T.arms) { A.x = lerp(A.x, 0, k); A.z = lerp(A.z, 0.1, k); }
      }
      return;
    }
    const down = ease(clamp(t / 0.4, 0, 1));
    const up = clamp((t - (tot - 0.8)) / 0.8, 0, 1);
    T.hipsX = lerp(0.25, 1.42, down); T.hipsY = lerp(0.85, 0.24, down); T.hipsZ = lerp(0, f.side * 0.25, down);
    T.spineX = lerp(0.2, 0.05, down); T.neckX = lerp(-0.2, -0.75, down);
    for (const Lg of T.legs) { Lg.hip = lerp(-0.5, 0.08, down); Lg.knee = lerp(0.9, 0.35, down); Lg.ankle = 0.3; }
    // break the fall like a person: hands down under the shoulders, elbows bent, taking the weight
    for (const A of T.arms) { A.x = lerp(-0.7, -1.4, down); A.z = 0.38; A.elbow = lerp(-0.3, -0.75, down); }
    T.hipsZ += Math.sin(t * 5) * 0.06 * down * (1 - up);
    if (up > 0) {
      if (up < 0.5) {
        const k = ease(up / 0.5);
        T.hipsY = lerp(0.24, 0.52, k); T.hipsX = lerp(1.42, 0.45, k); T.hipsZ = lerp(T.hipsZ, 0, k);
        for (const Lg of T.legs) { Lg.hip = lerp(0.08, -1.35, k); Lg.knee = lerp(0.35, 2.0, k); }
        for (const A of T.arms) { A.x = lerp(-1.4, -0.9, k); A.elbow = lerp(-0.75, -0.1, k); } // push up
        T.neckX = lerp(-0.75, -0.3, k);
      } else {
        const k = ease((up - 0.5) / 0.5);
        T.hipsY = lerp(0.52, 0.95, k); T.hipsX = lerp(0.45, 0, k); T.hipsZ = 0;
        T.legs[0].hip = lerp(-1.35, 0, k); T.legs[0].knee = lerp(2.0, 0.1, k);
        T.legs[1].hip = lerp(-1.35, -0.1, k); T.legs[1].knee = lerp(2.0, 0.2, k);
        for (const A of T.arms) { A.x = lerp(-0.9, 0, k); A.elbow = lerp(-0.2, -0.3, k); }
        T.neckX = lerp(-0.3, -0.06, k);
      }
    }
  }
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
