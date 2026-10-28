// One soldier on screen: a man from the infantry cast in his side's camouflage and kit, his legs and
// body moving with motion capture (walk, jog, sprint, crouch: a man's stride), and his arms on his
// weapon the way a soldier holds one: the rifle's stock in the pocket of his shoulder, his trigger hand
// on the grip and the other under the fore-end, at the low ready when he's moving and up at his eye when
// he fires; a pistol out in both hands; a knife or a grenade from the clips. The arms are solved onto
// the weapon each frame (two-bone IK), so a gun is never held sideways, whatever the clip's arms did.
import * as THREE from 'three';
import { fit, Person, type Cast, type Moves } from '@people/people.ts';
import { Gun, type GunModel, type Guns } from '@armoury/armoury.ts';
import { CAMO, paintCamo } from './camo.ts';
import { height } from './map.ts';
import { Life, Side, type Soldier } from './sim.ts';

const UPPER = /^(spine_02|spine_03|neck_01|head|clavicle_|upperarm_|lowerarm_|hand_|thumb_|index_|middle_|ring_|pinky_)/;
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const LOCO = ['idle', 'walk', 'jog', 'run', 'crouch', 'crouch_walk'] as const;
type Loco = (typeof LOCO)[number];
// What share of a stride each foot is on the ground (to tell a clip's speed from how far its feet go)
const STANCE: Record<Loco, number> = { idle: 1, walk: 0.62, jog: 0.42, run: 0.36, crouch: 1, crouch_walk: 0.62 };

// Colours of each side's kit (the shirt, trousers and helmet cover are camouflage: camo.ts)
const KIT = {
  [Side.Allies]: { vest: '#82714f', pack: '#776849', pads: '#2a2925', gear: '#1d1d1c', gloves: '#6c5f47', boots: '#86704f', helmet: null as string | null },
  [Side.Axis]: { vest: '#4a4f3d', pack: '#424736', pads: '#252622', gear: '#1c1c1b', gloves: '#272725', boots: '#262420', helmet: '#4c523f' as string | null },
};
const SUIT = '#5b6343'; // the pilot's flight suit

// How a weapon sits: m and rad (`down`: the muzzle dipped at the low ready; `in`: turned across the body)
const CARRY = {
  pocket: { in: 0.045, fwd: 0.03, down: 0.035 }, // the stock's place, from the shoulder joint
  ready: { down: 0.62, in: 0.3 }, sprint: { down: 0.95, in: 0.6 }, reload: { down: 0.5, in: 0.45 },
  pistol: { out: 0.4, down: 0.06, lowDown: 0.55 },
  twist: [0.3, 0.35, 0.35], // the upper body's turn toward the aim, shared down the spine
  maxTwist: 1.1,
};

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const dirOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)); // (the sim's yaw: 0 north, clockwise)

// --- bones -----------------------------------------------------------------------------------------------
function setWorldQuat(b: THREE.Object3D, q: THREE.Quaternion) {
  b.parent!.getWorldQuaternion(q2);
  b.quaternion.copy(q2.invert().multiply(q));
  b.updateMatrixWorld(true);
}
function rotateWorld(b: THREE.Object3D, r: THREE.Quaternion) {
  b.getWorldQuaternion(q1);
  setWorldQuat(b, r.clone().multiply(q1));
}
// Turn a bone (the least turn) so its child lies along `to`
function aimBone(b: THREE.Object3D, child: THREE.Object3D, to: THREE.Vector3) {
  b.getWorldPosition(v1);
  child.getWorldPosition(v2);
  rotateWorld(b, new THREE.Quaternion().setFromUnitVectors(v2.sub(v1).normalize(), to));
}
// Upper and lower arm bent so the hand reaches `target`, the elbow toward `pole`
function twoBone(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
  const A = upper.getWorldPosition(new THREE.Vector3()), B = lower.getWorldPosition(new THREE.Vector3()), C = hand.getWorldPosition(new THREE.Vector3());
  const la = A.distanceTo(B), lb = B.distanceTo(C);
  const to = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(to.length(), 0.05, (la + lb) * 0.999);
  const n = to.normalize();
  const a = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - a * a));
  const side = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n))).normalize();
  const E = A.clone().addScaledVector(n, a).addScaledVector(side, h);
  aimBone(upper, lower, E.clone().sub(A).normalize());
  aimBone(lower, hand, A.clone().addScaledVector(n, d).sub(E).normalize());
}
// The turn that takes a frame (a direction and a second one across it) onto another
function frame(f: THREE.Vector3, t: THREE.Vector3) {
  const x = f.clone().normalize(), y = t.clone().sub(x.clone().multiplyScalar(t.dot(x))).normalize(), z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

interface Hand { hand: THREE.Bone; lower: THREE.Bone; upper: THREE.Bone; fingers: THREE.Vector3; thumb: THREE.Vector3; palm: THREE.Vector3; rest: THREE.Quaternion }

// --- the moves, measured once ---------------------------------------------------------------------------------
const speeds = new WeakMap<Moves, Record<Loco, number>>();
function clipSpeeds(moves: Moves, person: Person, clips: Map<string, THREE.AnimationClip>) {
  const known = speeds.get(moves);
  if (known) return known;
  const out = {} as Record<Loco, number>;
  const mixer = new THREE.AnimationMixer(person.root);
  const foot = person.bones.get('foot_l')!;
  for (const name of LOCO) {
    const clip = clips.get(name);
    if (!clip) { out[name] = 1; continue; }
    const a = mixer.clipAction(clip);
    a.play();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 24; i++) {
      mixer.setTime((clip.duration * i) / 24);
      person.root.updateMatrixWorld(true);
      const z = foot.getWorldPosition(v1).z;
      lo = Math.min(lo, z); hi = Math.max(hi, z);
    }
    a.stop();
    out[name] = STANCE[name] >= 1 ? 0 : (hi - lo) / (STANCE[name] * clip.duration);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(person.root);
  speeds.set(moves, out);
  return out;
}

// --- a soldier ---------------------------------------------------------------------------------------------------------
export class SoldierView {
  readonly person: Person;
  readonly gun: GunModel; // his rifle (or nothing, the pilot)
  readonly pistol: GunModel | null;
  readonly knife: GunModel;
  readonly grenade: THREE.Mesh;
  readonly muzzle: THREE.Sprite;
  nvg = false; // goggles down
  flashT = 0;
  flinch = 0;
  private mixer: THREE.AnimationMixer;
  private lower = new Map<string, THREE.AnimationAction>();
  private upper = new Map<string, THREE.AnimationAction>();
  private overlay: { action: THREE.AnimationAction; t: number; kind: 'knife' | 'throw' } | null = null;
  private strikes = new Map<string, THREE.AnimationAction>();
  private fall: THREE.AnimationAction | null = null;
  private getup: THREE.AnimationAction;
  private speed: Record<Loco, number>;
  private hands: { r: Hand; l: Hand };
  private spine: THREE.Bone[];
  private parts: { up: THREE.Object3D[]; down: THREE.Object3D[] };
  private ik = 1; // how much the arms are on the weapon (0 for a knife, a throw, a fall)
  private hips = 0; // yaw the hips face
  private life = Life.Fine;
  private weaponShown: Gun | null = null;

  constructor(readonly s: Soldier, cast: Cast, private moves: Moves, guns: Guns, scene: THREE.Scene) {
    const names = [...cast.people.keys()];
    const p = (this.person = new Person(cast, names[s.spec.cast % names.length]));
    const kit = KIT[s.side];
    // kit and camouflage
    const camo = s.side === Side.Allies ? CAMO.ours : CAMO.theirs;
    for (const part of ['top', 'legs']) for (const m of p.parts(part)) s.pilot ? m.color.set(SUIT) : paintCamo(m, camo);
    for (const m of p.parts('helmet')) kit.helmet ? m.color.set(kit.helmet) : paintCamo(m, { ...camo, scale: camo.scale * 1.4 });
    for (const part of ['vest', 'pack', 'pads', 'gear', 'gloves', 'boots'] as const) p.tint(part, kit[part]);
    // what's hidden: the pilot has none of the kit; the enemy has no night vision
    const by = (re: RegExp) => { const out: THREE.Object3D[] = []; p.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && re.test(o.name)) out.push(o); }); return out; };
    this.parts = { up: by(/nvg_up/), down: by(/nvg_down/) };
    if (s.pilot) for (const o of by(/helmet|vest|pack|pad_|kit|grenades|holster|mount|nvg/)) o.visible = false;
    if (s.side === Side.Axis) for (const o of by(/nvg|mount/)) o.visible = false;
    for (const o of this.parts.down) o.visible = false;
    // the moves: the legs and the upper body apart (a knife or a throw over the walk), fingers round a grip
    const clips = fit(moves, p.root);
    this.speed = clipSpeeds(moves, p, clips);
    this.mixer = new THREE.AnimationMixer(p.root);
    const part = (c: THREE.AnimationClip, upper: boolean | null, fingers = false) => new THREE.AnimationClip(`${c.name}.${upper}`, c.duration,
      c.tracks.filter((t) => { const b = t.name.split('.')[0]; return (upper === null || UPPER.test(b) === upper) && (fingers || !FINGER.test(b)); }));
    for (const name of LOCO) {
      const c = clips.get(name)!;
      const lo = this.mixer.clipAction(part(c, false)), up = this.mixer.clipAction(part(c, true));
      lo.play(); up.play();
      lo.setEffectiveWeight(name === 'idle' ? 1 : 0); up.setEffectiveWeight(name === 'idle' ? 1 : 0);
      this.lower.set(name, lo); this.upper.set(name, up);
    }
    // (a hand round a grip, from the pistol clip, always: the IK puts the hand there)
    const grip = clips.get('pistol');
    if (grip && !s.pilot) {
      const g = this.mixer.clipAction(new THREE.AnimationClip('grip', grip.duration, grip.tracks.filter((t) => FINGER.test(t.name.split('.')[0]))));
      g.play();
    }
    this.getup = this.mixer.clipAction(clips.get('getup')!);
    this.getup.setLoop(THREE.LoopOnce, 1);
    // the hands, measured at rest: which way the fingers and thumb point, where the palm is
    p.root.updateMatrixWorld(true);
    const hand = (side: 'r' | 'l'): Hand => {
      const b = (n: string) => p.bones.get(`${n}_${side}`)!;
      const h = b('hand');
      const inv = h.getWorldQuaternion(new THREE.Quaternion()).invert();
      const at = h.getWorldPosition(new THREE.Vector3());
      const local = (w: THREE.Vector3) => w.sub(at).applyQuaternion(inv);
      const mid = b('middle_01').getWorldPosition(new THREE.Vector3()), index = b('index_01').getWorldPosition(new THREE.Vector3()), pinky = b('pinky_01').getWorldPosition(new THREE.Vector3());
      const t1 = b('thumb_01').getWorldPosition(new THREE.Vector3()), t3 = b('thumb_03').getWorldPosition(new THREE.Vector3());
      return {
        hand: h, lower: b('lowerarm'), upper: b('upperarm'),
        fingers: local(mid.clone()).normalize(),
        thumb: t3.sub(t1).applyQuaternion(inv).normalize(),
        palm: local(index.clone().add(pinky).multiplyScalar(0.5)).multiplyScalar(0.6),
        rest: inv.clone().invert(),
      };
    };
    this.hands = { r: hand('r'), l: hand('l') };
    this.spine = ['spine_01', 'spine_02', 'spine_03'].map((n) => p.bones.get(n)!);
    // what he carries
    this.gun = guns.make(s.arms[0].weapon.gun);
    this.pistol = s.arms[1] ? guns.make(s.arms[1].weapon.gun) : null;
    this.knife = guns.make(Gun.Knife);
    this.grenade = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: '#3a3f2c', roughness: 0.6 }));
    this.grenade.scale.set(1, 1.25, 1);
    this.grenade.castShadow = true;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd08a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.muzzle.visible = false;
    for (const o of [this.gun.object, this.pistol?.object, this.knife.object, this.grenade, this.muzzle, p.root]) if (o) scene.add(o);
    if (s.pilot) this.gun.object.visible = false;
    this.knife.object.visible = this.grenade.visible = false;
    if (this.pistol) this.pistol.object.visible = false;
    this.hips = s.facing;
  }

  remove(scene: THREE.Scene) {
    for (const o of [this.gun.object, this.pistol?.object, this.knife.object, this.grenade, this.muzzle, this.person.root]) if (o) scene.remove(o);
  }

  // A knife strike or a grenade thrown: the upper body from the clip for a moment
  strike(kind: 'knife' | 'throw') {
    let a = this.strikes.get(kind);
    if (!a) {
      const c = fit(this.moves, this.person.root).get(kind);
      if (!c) return;
      a = this.mixer.clipAction(new THREE.AnimationClip(`${kind}.up`, c.duration, c.tracks.filter((t) => UPPER.test(t.name.split('.')[0]))));
      this.strikes.set(kind, a);
    }
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().play();
    if (this.overlay && this.overlay.action !== a) this.overlay.action.stop();
    this.overlay = { action: a, t: 0, kind };
  }

  // Where the muzzle is (world)
  muzzleAt() {
    const g = this.s.pistol && this.pistol ? this.pistol : this.gun;
    return new THREE.Vector3(g.muzzle, 0.03, 0).applyMatrix4(g.object.matrixWorld);
  }
  headAt(out = new THREE.Vector3()) { return this.person.bones.get('head')!.getWorldPosition(out); }

  update(dt: number, aimAt: THREE.Vector3 | null) {
    const s = this.s, p = this.person, root = p.root;
    root.position.set(s.x, height(s.x, s.z), s.z);
    // falling, lying, getting up
    if (s.life !== this.life) {
      if (s.life !== Life.Fine && this.life === Life.Fine) {
        const c = fit(this.moves, root).get(Math.random() < 0.5 ? 'die' : 'die_face')!;
        this.fall = this.mixer.clipAction(c);
        this.fall.setLoop(THREE.LoopOnce, 1);
        this.fall.clampWhenFinished = true;
        this.fall.reset().play();
      } else if (s.life === Life.Fine && this.fall) {
        this.fall.stop();
        this.fall = null;
        this.getup.reset().play();
      }
      this.life = s.life;
    }
    const down = s.life !== Life.Fine;
    const sp = Math.hypot(s.vx, s.vz);
    // the hips: along his way if the aim is near enough to it (the body turns the rest), else toward the aim
    const move = Math.atan2(s.vx, -s.vz);
    const aim = s.facing;
    const want = sp > 0.6 && Math.abs(angDiff(aim, move)) < CARRY.maxTwist + 0.3 ? move : aim;
    this.hips += THREE.MathUtils.clamp(angDiff(want, this.hips), -7 * dt, 7 * dt);
    root.rotation.y = Math.PI - this.hips;
    // the legs: blend of idle, walk, jog, sprint (or crouched), in step with the ground
    const w: Record<Loco, number> = { idle: 0, walk: 0, jog: 0, run: 0, crouch: 0, crouch_walk: 0 };
    if (!down) {
      if (s.crouched) { const k = Math.min(1, sp / 0.6); w.crouch = 1 - k; w.crouch_walk = k; }
      else if (sp < 0.3) w.idle = 1;
      else {
        const sw = this.speed.walk || 1.4, sj = this.speed.jog || 3.4, sr = this.speed.run || 5.6;
        if (sp < sw) { const k = (sp - 0.3) / Math.max(0.1, sw - 0.3); w.idle = 1 - k; w.walk = k; }
        else if (sp < sj) { const k = (sp - sw) / (sj - sw); w.walk = 1 - k; w.jog = k; }
        else { const k = Math.min(1, (sp - sj) / Math.max(0.1, sr - sj)); w.jog = 1 - k; w.run = k; }
      }
    }
    if (this.overlay) {
      this.overlay.t += dt;
      const dur = this.overlay.action.getClip().duration;
      if (this.overlay.t > dur) { this.overlay.action.stop(); this.overlay = null; }
    }
    const o = this.overlay ? Math.min(1, this.overlay.t / 0.12, (this.overlay.action.getClip().duration - this.overlay.t) / 0.2) : 0;
    this.overlay?.action.setEffectiveWeight(o);
    for (const n of LOCO) {
      const k = this.speed[n];
      const scale = k > 0 && sp > 0.2 ? THREE.MathUtils.clamp(sp / k, 0.5, 1.6) : 1;
      this.lower.get(n)!.setEffectiveWeight(w[n]).timeScale = scale;
      this.upper.get(n)!.setEffectiveWeight(w[n] * (1 - o)).timeScale = scale;
    }
    this.fall?.setEffectiveWeight(1);
    this.mixer.update(dt);
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 5);
      this.spine[2].rotateX(-0.3 * this.flinch);
    }
    root.updateMatrixWorld(true);
    // the arms on the weapon (not while he's striking, throwing, down or getting up; not the pilot)
    const busy = !!this.overlay || down || this.getup.isRunning() || s.pilot || s.swapT > 0.25;
    this.ik += THREE.MathUtils.clamp((busy ? 0 : 1) - this.ik, -dt * 9, dt * 9);
    this.carry(dt, aimAt, sp);
    this.muzzle.visible = (this.flashT -= dt) > 0;
    if (this.muzzle.visible) { this.muzzle.position.copy(this.muzzleAt()); this.muzzle.scale.setScalar(0.35 + Math.random() * 0.3); }
  }

  // The weapon in his hands (or slung, or on the ground), and his arms on it
  private carry(dt: number, aimAt: THREE.Vector3 | null, sp: number) {
    const s = this.s, p = this.person;
    const pistol = s.pistol && !!this.pistol;
    const held = pistol ? this.pistol! : this.gun;
    if (this.pistol) this.pistol.object.visible = pistol && s.life === Life.Fine && !s.pilot;
    this.gun.object.visible = !s.pilot;
    const down = s.life !== Life.Fine;
    // the pose before the arms are moved: kept, to blend back into
    const bones = [...this.spine, this.hands.r.upper, this.hands.r.lower, this.hands.r.hand, this.hands.l.upper, this.hands.l.lower, this.hands.l.hand];
    const anim = bones.map((b) => b.quaternion.clone());
    // the upper body turned toward the aim
    const aimYaw = s.facing;
    const twist = THREE.MathUtils.clamp(angDiff(aimYaw, this.hips), -CARRY.maxTwist, CARRY.maxTwist);
    if (!down && !s.pilot) this.spine.forEach((b, i) => rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(UP, -twist * CARRY.twist[i])));
    p.root.updateMatrixWorld(true);
    const fwd = dirOf(aimYaw), right = fwd.clone().cross(UP).normalize();
    const shoulder = this.hands.r.upper.getWorldPosition(new THREE.Vector3());
    // which way the muzzle points: at the target when he's firing (or still and aiming), else the low ready
    let D: THREE.Vector3;
    const aiming = !!aimAt && (s.firing || sp < 0.6) && s.reloadT <= 0;
    const lowered = (pose: { down: number; in: number }) => fwd.clone().applyAxisAngle(UP, pose.in).applyAxisAngle(right, -pose.down).normalize();
    if (aiming) D = aimAt!.clone().sub(shoulder).normalize();
    else D = lowered(s.reloadT > 0 ? CARRY.reload : sp > 4.8 && !s.crouched ? CARRY.sprint : CARRY.ready);
    if (pistol && !aiming) D = fwd.clone().applyAxisAngle(right, -CARRY.pistol.lowDown).normalize();
    const R = D.clone().cross(UP).normalize(), Y = R.clone().cross(D).normalize();
    // where the gun goes
    const grip = new THREE.Vector3();
    if (pistol) {
      const chest = shoulder.clone().addScaledVector(right, -0.17); // (between the shoulders)
      grip.copy(chest).addScaledVector(D, CARRY.pistol.out).addScaledVector(Y, -CARRY.pistol.down);
    } else {
      const pocket = shoulder.clone().addScaledVector(right, -CARRY.pocket.in).addScaledVector(fwd, CARRY.pocket.fwd).addScaledVector(UP, -CARRY.pocket.down);
      grip.copy(pocket).addScaledVector(D, held.length - held.muzzle); // (the butt in the pocket: the grip that far along)
    }
    const g = held.object;
    if (down) {
      g.matrixAutoUpdate = true;
      g.position.set(s.x + 0.6, height(s.x + 0.6, s.z + 0.3) + 0.05, s.z + 0.3);
      g.rotation.set(0, -s.facing, Math.PI / 2);
      g.updateMatrixWorld(true);
    } else if (this.ik < 0.5 && !pistol) {
      // slung across his chest, muzzle down to the left
      const chest = this.spine[2].getWorldPosition(new THREE.Vector3()).addScaledVector(dirOf(this.hips), 0.2);
      const hr = dirOf(this.hips).cross(UP).normalize();
      const x = UP.clone().multiplyScalar(-0.75).addScaledVector(hr, -0.6).normalize();
      setGun(g, x, dirOf(this.hips).multiplyScalar(-1), chest.addScaledVector(hr, 0.12).addScaledVector(UP, -0.12));
    } else setGun(g, D, Y, grip);
    // the arms, onto it
    if (!down && this.ik > 0.001 && !s.pilot) {
      const X = D;
      const rightHand = frame(X.clone().multiplyScalar(0.15).addScaledVector(R, -0.75).addScaledVector(Y, -0.35), X.clone().multiplyScalar(0.7).addScaledVector(Y, 0.5));
      const support = pistol
        ? grip.clone().addScaledVector(R, -0.035).addScaledVector(Y, -0.02)
        : s.reloadT > 0 ? grip.clone().addScaledVector(X, 0.09).addScaledVector(Y, -0.12) : grip.clone().addScaledVector(X, held.support).addScaledVector(Y, -0.025);
      const leftHand = pistol
        ? frame(R.clone().multiplyScalar(0.7).addScaledVector(Y, -0.5), X.clone().multiplyScalar(0.8).addScaledVector(Y, 0.3))
        : frame(R.clone().multiplyScalar(0.6).addScaledVector(Y, 0.6).addScaledVector(X, 0.15), X.clone().multiplyScalar(0.8).addScaledVector(Y, 0.3).addScaledVector(R, -0.2));
      this.reach(this.hands.r, grip, rightHand, UP.clone().multiplyScalar(-1).addScaledVector(right, 0.7));
      this.reach(this.hands.l, support, leftHand, UP.clone().multiplyScalar(-1).addScaledVector(right, -0.9));
    }
    // blend from the clip's pose to this by how much the arms are on the weapon
    const k = s.pilot ? 0 : down ? 0 : this.ik;
    bones.forEach((b, i) => { if (i >= 3 || k < 1) b.quaternion.slerpQuaternions(anim[i], b.quaternion.clone(), i < 3 ? 1 : k); });
    p.root.updateMatrixWorld(true);
    // the knife or the grenade in his right hand, while he uses it
    const hr = this.hands.r.hand;
    const palm = hr.localToWorld(this.hands.r.palm.clone());
    const kind = this.overlay?.kind;
    this.knife.object.visible = kind === 'knife';
    this.grenade.visible = kind === 'throw' && this.overlay!.t < 0.62;
    if (kind === 'knife') {
      const hq = hr.getWorldQuaternion(new THREE.Quaternion());
      const thumb = this.hands.r.thumb.clone().applyQuaternion(hq), fingers = this.hands.r.fingers.clone().applyQuaternion(hq);
      setGun(this.knife.object, thumb, fingers.multiplyScalar(-1), palm);
    }
    if (kind === 'throw') this.grenade.position.copy(palm);
    // the goggles: down over his eyes or up on the helmet
    for (const o of this.parts.up) o.visible = !this.nvg && this.s.side === Side.Allies && !s.pilot;
    for (const o of this.parts.down) o.visible = this.nvg && this.s.side === Side.Allies && !s.pilot;
    void dt;
  }

  // One arm: the hand to `at` (where its palm should be), turned as `turn` says, the elbow toward `pole`
  private reach(h: Hand, at: THREE.Vector3, turn: THREE.Quaternion, pole: THREE.Vector3) {
    // the hand's own turn: its rest frame (fingers, thumb) onto the wanted one
    const want = turn.clone().multiply(frame(h.fingers, h.thumb).invert());
    const wrist = at.clone().sub(h.palm.clone().applyQuaternion(want));
    twoBone(h.upper, h.lower, h.hand, wrist, pole);
    setWorldQuat(h.hand, want);
  }
}

function setGun(g: THREE.Object3D, x: THREE.Vector3, up: THREE.Vector3, at: THREE.Vector3) {
  const X = x.clone().normalize(), Z = X.clone().cross(up).normalize(), Y = Z.clone().cross(X);
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(X, Y, Z).setPosition(at);
  g.matrixWorld.copy(g.matrix);
  g.matrixWorldNeedsUpdate = true;
}

let glow: THREE.Texture | null = null;
function glowTexture() {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(c));
}
