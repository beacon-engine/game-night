// Footballer: a realistic base body with face and hair (Quaternius Universal Base Characters, CC0),
// animated with motion capture (Quaternius Universal Animation Library, CC0).
// Locomotion (idle / walk / jog / sprint) comes from the motion capture, with the leg cycle synced
// to how fast the player is really moving. Football actions (kicks, tackles, slides, falls, dives,
// throw-ins, controls...) are posed procedurally on the same skeleton and blended in while they last.
// Kits are painted onto the body by region.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Kit } from './types.ts';

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const pair = <T>(make: () => T): [T, T] => [make(), make()];

export type SkillKind = 'stepover' | 'dragback';
export type ControlKind = 'head' | 'chest' | 'thigh';
export type Card = 'yellow' | 'red';
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

// speeds (m/s) the motion-captured cycles were recorded at, roughly
// speeds (m/s) each cycle is played at its natural rate; `phase` lines its stride up with the others;
// `bob` scales the hip bounce (the jog was captured as a big bounding run: 24 cm of bounce per stride,
// where footballers move with about 6-10 cm)
interface Loco { clip: string; speed: number; phase: number; bob: number; thigh: number; calf: number }
const LOCO: Loco[] = [
// `thigh`/`calf` scale how far the legs swing and the knee bends (the jog lifts its knees like a
// high-knees drill; a footballer's stride is lower and more economical)
  { clip: 'Walk_Loop', speed: 1.5, phase: 0.083, bob: 1, thigh: 1, calf: 1 },
  { clip: 'Jog_Fwd_Loop', speed: 3.4, phase: 0, bob: 0.33, thigh: 0.68, calf: 0.62 },
  { clip: 'Sprint_Loop', speed: 6.0, phase: 0, bob: 0.62, thigh: 0.88, calf: 0.78 },
];

// ------------------------------------------------------------------ assets --
type SkinTone = 'dark' | 'light';
type HairMesh = THREE.Mesh | THREE.SkinnedMesh;
interface Assets {
  scene: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
  facing: number;
  c2s: THREE.Quaternion; // character space (X left, Y up, Z forward) -> the rig's space
  bodyGeo: THREE.BufferGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  skinMaps: Record<SkinTone, THREE.Texture>;
  hair: Record<'buzz' | 'parted' | 'beard' | 'brows', HairMesh | null>;
}
let ASSET: Assets; // set by loadPlayerAssets(), before any PlayerModel is made
const MODELS = 'models/ubc/';

// the body itself (the hair, brows... are separate, much smaller meshes)
const isBody = (o: THREE.SkinnedMesh) => o.geometry.attributes.position.count > 3000;

const isBone = (o: THREE.Object3D): o is THREE.Bone => o instanceof THREE.Bone;
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;
const isSkinned = (o: THREE.Object3D): o is THREE.SkinnedMesh => o instanceof THREE.SkinnedMesh;

function collect<T extends THREE.Object3D>(root: THREE.Object3D, is: (o: THREE.Object3D) => o is T) {
  const out: T[] = [];
  root.traverse((o) => { if (is(o)) out.push(o); });
  return out;
}

// bones by normalised name: 'thighl', 'spine02'...
const bonesOf = (root: THREE.Object3D) => Object.fromEntries(collect(root, isBone).map((b) => [norm(b.name), b]));

export async function loadPlayerAssets() {
  const gl = new GLTFLoader();
  const [ch, fbx, buzz, parted, beard, brows] = await Promise.all([
    gl.loadAsync(MODELS + 'Superhero_Male_FullBody.gltf'),
    new FBXLoader().loadAsync('models/ual_ue.fbx'),
    gl.loadAsync(MODELS + 'Hair_Buzzed.gltf'),
    gl.loadAsync(MODELS + 'Hair_SimpleParted.gltf'),
    gl.loadAsync(MODELS + 'Hair_Beard.gltf'),
    gl.loadAsync(MODELS + 'Eyebrows_Regular.gltf'),
  ]);
  const scene = ch.scene;
  scene.updateMatrixWorld(true);
  const bones = bonesOf(scene);
  const restPelvis = bones.pelvis.position.z;

  // The motion capture was made on a slightly smaller mannequin with the same skeleton:
  // use only its joint rotations (plus pelvis height, rescaled) so each body keeps its own proportions.
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of fbx.animations) {
    const name = c.name.replace(/^.*\|/, '');
    const tracks = [];
    for (const t of c.tracks) {
      const [bone, prop] = t.name.split('.');
      // the root carries each file's own Z-up correction (on a parent node in the FBX, on the bone in
      // the glTF), so never animate it
      if (!bones[norm(bone)] || norm(bone) === 'root') continue;
      if (prop === 'quaternion') {
        // tone down knee lift: pull each key toward the clip's average leg pose
        const loco = LOCO.find((l) => l.clip === name);
        const nb = norm(bone);
        const f = !loco ? 1 : nb.startsWith('thigh') ? loco.thigh : nb.startsWith('calf') ? loco.calf : 1;
        if (f === 1) { tracks.push(t); continue; }
        const v = t.values, n = v.length / 4;
        const mean = new THREE.Quaternion(0, 0, 0, 0), q = new THREE.Quaternion();
        for (let i = 0; i < n; i++) {
          q.fromArray(v, i * 4);
          const sgn = i && mean.dot(q) < 0 ? -1 : 1;
          mean.x += q.x * sgn; mean.y += q.y * sgn; mean.z += q.z * sgn; mean.w += q.w * sgn;
        }
        mean.normalize();
        const out = new Float32Array(v.length);
        for (let i = 0; i < n; i++) {
          q.fromArray(v, i * 4);
          new THREE.Quaternion().copy(mean).slerp(q, f).toArray(out, i * 4);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, out));
      }
      else if (prop === 'position' && norm(bone) === 'pelvis') {
        const v = t.values.slice();
        const k = restPelvis / 0.917;
        // calm the vertical bounce (Z is up in the rig) around its average height
        const bob = LOCO.find((l) => l.clip === name)?.bob ?? 1;
        let mean = 0;
        for (let i = 2; i < v.length; i += 3) mean += v[i];
        mean /= v.length / 3;
        for (let i = 0; i < v.length; i++) {
          if (i % 3 === 2) v[i] = mean + (v[i] - mean) * bob;
          v[i] *= k;
        }
        tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
      }
    }
    clips[name] = new THREE.AnimationClip(name, c.duration, tracks);
  }

  const wp = (n: string) => new THREE.Vector3().setFromMatrixPosition(bones[n].matrixWorld);
  const f = wp('balll').sub(wp('footl')).setY(0).normalize(); // heel -> toe: which way he faces
  const facing = Math.atan2(f.x, f.z);
  const c2s = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);

  // skin textures: the pack ships dark and light; tints give more variety
  const body = collect(scene, isSkinned).find(isBody)!;
  const bodyMat = body.material as THREE.MeshStandardMaterial;
  const loadTex = (url: string) => new Promise<THREE.Texture>((res) => new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; res(t); }));
  const light = await loadTex(MODELS + 'T_Superhero_Male_Ligh.png');
  const skinMaps = { dark: bodyMat.map!, light };

  const hairMesh = (g: GLTF): HairMesh | null => collect(g.scene, isMesh)[0] ?? null;
  ASSET = {
    scene, clips, facing, c2s, bodyGeo: body.geometry, bodyMat, skinMaps,
    hair: { buzz: hairMesh(buzz), parted: hairMesh(parted), beard: hairMesh(beard), brows: hairMesh(brows) },
  };
}

// --------------------------------------------------------------- kit paint --
const SKINS = ['#4a2e1f', '#5b3a26', '#6b4430', '#7c5236', '#3b2417', '#8d5e3c', '#a87250', '#2f1d13'];
const BOOTS = ['#111111', '#111111', '#f5f5f5', '#e11d48', '#facc15', '#22c55e', '#2563eb'];
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

interface BodyColors { boots: string; shirt: string; shorts: string; socks: string; glove: string }

// Mark every vertex with the kit colour of the body part it belongs to (most influential bone + height).
// Skin areas get mask 0 and keep the skin texture.
function paintedGeometry(geo: THREE.BufferGeometry, skeleton: THREE.Skeleton, colors: BodyColors, gk: boolean) {
  const key = `${geo.uuid}|${JSON.stringify(colors)}|${gk}`;
  const cached = geoCache.get(key);
  if (cached) return cached;
  const g = geo.clone();
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const kit = new Float32Array(pos.count * 4);
  const C = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof BodyColors, THREE.Color>;
  const names = skeleton.bones.map((b) => norm(b.name));
  const finger = /index|middle|ring|pinky|thumb/;
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const n = names[best] || '';
    const x = Math.abs(pos.getX(i)), y = pos.getY(i);
    let c: THREE.Color | null = null;
    if (n.startsWith('spine') || n.startsWith('clavicle')) c = C.shirt;
    else if (n.startsWith('upperarm')) c = gk || x < 0.43 ? C.shirt : null;
    else if (n.startsWith('lowerarm')) c = gk ? C.shirt : null;
    else if (n.startsWith('hand') || finger.test(n)) c = gk ? C.glove : null;
    else if (n === 'pelvis') c = C.shorts;
    else if (n.startsWith('thigh')) c = y > 0.66 ? C.shorts : null;
    else if (n.startsWith('calf')) c = y > 0.46 ? null : C.socks;
    else if (n.startsWith('foot') || n.startsWith('ball')) c = y > 0.15 && n.startsWith('foot') ? C.socks : C.boots;
    // neck lower edge is still shirt collar
    else if (n.startsWith('neck') && y < 1.52) c = C.shirt;
    if (c) { kit[i * 4] = c.r; kit[i * 4 + 1] = c.g; kit[i * 4 + 2] = c.b; kit[i * 4 + 3] = 1; }
  }
  g.setAttribute('kit', new THREE.BufferAttribute(kit, 4));
  geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- garments --
// A shirt and shorts made from the body itself: take the triangles of that region, smooth away the
// muscle detail and puff them out a couple of centimetres, so they read as loose fabric over the body.
// They're skinned to the same skeleton, so they move with the player.
type ShellKind = 'shirt' | 'shirtLong' | 'shorts';
const shellCache = new Map<ShellKind, THREE.BufferGeometry>();
function inShirt(n: string, x: number, y: number, long: boolean) {
  if (n.startsWith('spine') || n.startsWith('clavicle')) return true;
  if (n.startsWith('upperarm')) return long || x < 0.45;
  if (n.startsWith('lowerarm')) return long;
  if (n.startsWith('neck')) return y < 1.52;
  if (n === 'pelvis') return y > 0.86; // the shirt hangs over the waistband
  return false;
}
function inShorts(n: string, _x: number, y: number) {
  if (n === 'pelvis') return y < 0.95;
  if (n.startsWith('thigh')) return y > 0.62;
  return false;
}
function buildShell(geo: THREE.BufferGeometry, skeleton: THREE.Skeleton, kind: ShellKind) {
  const cached = shellCache.get(kind);
  if (cached) return cached;
  const pos = geo.attributes.position, nor = geo.attributes.normal, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const names = skeleton.bones.map((b) => norm(b.name));
  const inside = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const n = names[best] || '', x = Math.abs(pos.getX(i)), y = pos.getY(i);
    inside[i] = Number(kind === 'shorts' ? inShorts(n, x, y) : inShirt(n, x, y, kind === 'shirtLong'));
  }
  const idx = geo.index!.array;
  const remap = new Int32Array(pos.count).fill(-1);
  const kept: number[] = [];
  let nv = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(inside[a] && inside[b] && inside[c])) continue;
    for (const v of [a, b, c]) if (remap[v] < 0) remap[v] = nv++;
    kept.push(remap[a], remap[b], remap[c]);
  }
  const P = new Float32Array(nv * 3), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = remap[i];
    if (r < 0) continue;
    P[r * 3] = pos.getX(i); P[r * 3 + 1] = pos.getY(i); P[r * 3 + 2] = pos.getZ(i);
    for (let k = 0; k < 4; k++) { SI[r * 4 + k] = si.getComponent(i, k); SW[r * 4 + k] = sw.getComponent(i, k); }
  }
  // neighbours and open edges (hems, collar, sleeve ends)
  const nb = Array.from({ length: nv }, () => new Set<number>());
  const edges = new Map<number, number>();
  for (let t = 0; t < kept.length; t += 3) {
    const tri = [kept[t], kept[t + 1], kept[t + 2]];
    for (let e = 0; e < 3; e++) {
      const u = tri[e], v = tri[(e + 1) % 3];
      nb[u].add(v); nb[v].add(u);
      const key = u < v ? u * nv + v : v * nv + u;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const boundary = new Uint8Array(nv);
  for (const [key, count] of edges) if (count === 1) { boundary[Math.floor(key / nv)] = 1; boundary[key % nv] = 1; }
  // smooth away the sculpted muscles (fabric doesn't follow every bump)
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < 6; it++) {
    for (let i = 0; i < nv; i++) {
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (const j of nb[i]) { sx += P[j * 3]; sy += P[j * 3 + 1]; sz += P[j * 3 + 2]; c++; }
      const k = boundary[i] ? 0.25 : 0.6;
      tmp[i * 3] = c ? P[i * 3] + (sx / c - P[i * 3]) * k : P[i * 3];
      tmp[i * 3 + 1] = c ? P[i * 3 + 1] + (sy / c - P[i * 3 + 1]) * k : P[i * 3 + 1];
      tmp[i * 3 + 2] = c ? P[i * 3 + 2] + (sz / c - P[i * 3 + 2]) * k : P[i * 3 + 2];
    }
    P.set(tmp);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(kept);
  g.computeVertexNormals();
  // puff it out: shirts a little, shorts more and flaring toward the hem
  const N = g.attributes.normal;
  for (let i = 0; i < nv; i++) {
    const y = P[i * 3 + 1];
    // the shirt's bottom stands off the body more, so it hangs outside the shorts
    const out = kind === 'shorts' ? 0.03 + clamp((0.8 - y) * 0.12, 0, 0.025) : 0.024 + clamp((1.04 - y) * 0.2, 0, 0.03);
    P[i * 3] += N.getX(i) * out; P[i * 3 + 1] += N.getY(i) * out; P[i * 3 + 2] += N.getZ(i) * out;
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  // contrasting trim on the collar and sleeve ends (not the bottom hem)
  const trim = new Float32Array(nv);
  for (let i = 0; i < nv; i++) if (boundary[i] && (kind === 'shorts' ? P[i * 3 + 1] < 0.75 : P[i * 3 + 1] > 1.3)) {
    trim[i] = 1;
    for (const j of nb[i]) trim[j] = Math.max(trim[j], 0.45);
  }
  g.setAttribute('trim', new THREE.BufferAttribute(trim, 1));
  shellCache.set(kind, g);
  return g;
}

const shellMatCache = new Map<string, THREE.MeshStandardMaterial>();
function shellMaterial(kind: ShellKind, kit: Kit) {
  const key = `${kind}|${JSON.stringify(kit)}`;
  const cached = shellMatCache.get(key);
  if (cached) return cached;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const pattern = kind === 'shorts' ? 0 : kit.pattern === 'stripes' ? 1 : kit.pattern === 'hoops' ? 2 : 0;
  const U = {
    uMain: { value: new THREE.Color(kind === 'shorts' ? kit.shorts : kit.shirt) },
    uSecond: { value: new THREE.Color(kit.second || kit.shirt) },
    uTrim: { value: new THREE.Color(kind === 'shorts' ? kit.shirt : kit.trim || kit.number) },
    uPattern: { value: pattern },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float trim;\nvarying float vTrim;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrim = trim;\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uMain, uSecond, uTrim;\nuniform float uPattern;\nvarying float vTrim;\nvarying vec3 vBind;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 kc = uMain;
        if (uPattern > 0.5 && uPattern < 1.5 && mod(floor((vBind.x + 2.0) / 0.075), 2.0) > 0.5) kc = uSecond;
        if (uPattern > 1.5 && mod(floor(vBind.y / 0.11), 2.0) > 0.5) kc = uSecond;
        diffuseColor.rgb = mix(kc, uTrim, clamp(vTrim, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'shell';
  shellMatCache.set(key, m);
  return m;
}

// The body's own material (skin texture, normal and roughness maps) with the kit painted over it
function kitMaterial(tone: SkinTone, tint: number) {
  const key = `${tone}|${tint}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const m = ASSET.bodyMat.clone();
  m.map = ASSET.skinMaps[tone];
  m.color = new THREE.Color(tint, tint, tint);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 kit;\nvarying vec4 vKit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKit = kit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vKit;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vKit.rgb, vKit.a);');
  };
  m.customProgramCacheKey = () => 'kitpaint';
  matCache.set(key, m);
  return m;
}

const hairMatCache = new Map<string, THREE.MeshStandardMaterial>();
function hairMaterial(src: THREE.Material | THREE.Material[], shade: number) {
  const base = (Array.isArray(src) ? src[0] : src) as THREE.MeshStandardMaterial;
  const key = `${base.uuid}|${shade}`;
  let m = hairMatCache.get(key);
  if (!m) {
    m = base.clone();
    m.color = new THREE.Color(shade, shade * 0.95, shade * 0.9);
    hairMatCache.set(key, m);
  }
  return m;
}

const numberCache = new Map<string, THREE.CanvasTexture>();
function numberTexture(color: string, number: number) {
  const key = `${color}|${number}`;
  const cached = numberCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 92px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(String(number), 64, 70);
  g.fillStyle = color;
  g.fillText(String(number), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numberCache.set(key, t);
  return t;
}

function nameTexture(text: string, color = '#ffffff', bg?: string) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = 'bold 30px "Arial Black", Impact, sans-serif';
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
  readonly build: number; // body size, ~0.95..1.03
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
    const colors: BodyColors = {
      boots: BOOTS[Math.floor(rnd() * BOOTS.length)],
      shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks, glove: '#f1f5f9',
    };
    // mostly darker skin tones (these are West African clubs), with tints for variety
    const tone: SkinTone = referee ? 'light' : rnd() < 0.85 ? 'dark' : 'light';
    // the dark texture is a medium-brown base: shade it for a range of deep to medium skin tones
    const tint = tone === 'dark' ? [0.42, 0.5, 0.58, 0.68, 0.8][Math.floor(rnd() * 5)] : [0.85, 0.95][Math.floor(rnd() * 2)];
    const build = 0.95 + rnd() * 0.08;

    const scene = SkeletonUtils.clone(ASSET.scene);
    const bones = bonesOf(scene);
    const skinned = collect(scene, isSkinned);
    for (const o of skinned) {
      o.castShadow = true;
      o.frustumCulled = false;
    }
    const bodyMesh = skinned.find(isBody)!;
    const bodyParent = bodyMesh.parent!;
    bodyMesh.geometry = paintedGeometry(ASSET.bodyGeo, bodyMesh.skeleton, colors, gk);
    bodyMesh.material = kitMaterial(tone, tint);
    // shirt and shorts as garments over the (kit-painted) body
    for (const kind of [gk ? 'shirtLong' : 'shirt', 'shorts'] as const) {
      const g = new THREE.SkinnedMesh(buildShell(ASSET.bodyGeo, bodyMesh.skeleton, kind), shellMaterial(kind, kit));
      bodyParent.add(g);
      g.bind(bodyMesh.skeleton, bodyMesh.bindMatrix);
      g.castShadow = true;
      g.frustumCulled = false;
    }
    // hair, beard and eyebrows are rigged to the head: rebind them to this player's skeleton
    const hairShade = [0.05, 0.08, 0.12][Math.floor(rnd() * 3)]; // black to very dark brown
    const parts = [ASSET.hair.brows, rnd() < 0.6 ? ASSET.hair.buzz : ASSET.hair.parted];
    if (!referee && rnd() < 0.3) parts.push(ASSET.hair.beard);
    for (const src of parts) {
      if (!src) continue;
      let mesh: THREE.Mesh;
      if (src instanceof THREE.SkinnedMesh) {
        const skinnedHair = new THREE.SkinnedMesh(src.geometry, hairMaterial(src.material, hairShade));
        const sk = new THREE.Skeleton(src.skeleton.bones.map((b) => bones[norm(b.name)]), src.skeleton.boneInverses);
        bodyParent.add(skinnedHair);
        skinnedHair.bind(sk, src.bindMatrix);
        mesh = skinnedHair;
      } else {
        mesh = new THREE.Mesh(src.geometry, hairMaterial(src.material, hairShade));
        bodyParent.add(mesh);
      }
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
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
    this.feet = legL.side < 0 ? [bones.balll, bones.ballr] : [bones.ballr, bones.balll];
    this.arms = armL.side < 0 ? [armL, armR] : [armR, armL];
    this.restHipsHeight = this.j.hips.restPos.z; // the rig's root is Z-up

    // motion capture
    this.mixer = new THREE.AnimationMixer(scene);
    this.idle = this.mixer.clipAction(ASSET.clips.Idle_Loop);
    this.idle.play();
    this.loco = LOCO.map((l) => {
      const a = this.mixer.clipAction(ASSET.clips[l.clip]);
      a.play();
      a.setEffectiveWeight(0);
      a.timeScale = 0; // we drive their time ourselves so the cycles stay in step
      return { ...l, action: a, dur: ASSET.clips[l.clip].duration };
    });
    this.idle.time = rnd() * ASSET.clips.Idle_Loop.duration;
    this.cycle = rnd();

    this.body.rotation.y = -ASSET.facing; // face +Z
    this.body.add(scene);
    this.root.scale.setScalar(build);
    this.build = build;
    this.root.add(this.body);
    const blob = new THREE.Mesh(shadowGeo, shadowMat);
    blob.position.y = 0.015;
    this.root.add(blob);

    // shirt number on the back, stuck to the upper spine
    if (number !== '') {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), new THREE.MeshBasicMaterial({ map: numberTexture(kit.number, number), transparent: true, depthWrite: false }));
      const sp = bones.spine03;
      const back = new THREE.Vector3(0, 1.36, 0).add(new THREE.Vector3(0, 0, -0.205).applyQuaternion(c2s));
      const m = new THREE.Matrix4().compose(back, c2s.clone().multiply(qAxis(AY, Math.PI)), new THREE.Vector3(1, 1, 1));
      const local = new THREE.Matrix4().copy(sp.matrixWorld).invert().multiply(m);
      local.decompose(plate.position, plate.quaternion, plate.scale);
      sp.add(plate);
    }

    this.tag = makeLabel(name.toUpperCase(), { height: 0.011, opacity: 0.9 });
    this.tag.position.y = 2.12 / build;
    this.root.add(this.tag);

    if (referee) {
      this.card = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.105, 0.006), new THREE.MeshBasicMaterial({ color: '#facc15' }));
      this.card.visible = false;
      this.arms[1].hand.add(this.card);
    }
    this.time = rnd() * 10;
  }

  kick() { this.kickT = 0.34; }
  // reach: 0 = ball at the foot, up to 1 = stretching for it (the leg extends further toward it)
  touch(foot: Foot = this.touchFoot ? 0 : 1, reach = 0) { this.touchT = 0.2; this.touchFoot = foot; this.touchReach = reach; }

  // where each foot is (index 0 = the -X side leg, 1 = the +X side), in world space
  footWorld(i: Foot, out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    return this.feet[i].getWorldPosition(out);
  }
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

    // ---- motion capture locomotion: blend idle / walk / jog / sprint by speed, cycles in step
    const runSp = sp * (1 - strafe * 0.6);
    let wIdle = 1, rate = 0;
    const lw = [0, 0, 0];
    if (runSp > 0.25) {
      if (runSp < LOCO[0].speed) { const k = (runSp - 0.25) / (LOCO[0].speed - 0.25); wIdle = 1 - k; lw[0] = k; }
      else if (runSp < LOCO[1].speed) { const k = (runSp - LOCO[0].speed) / (LOCO[1].speed - LOCO[0].speed); wIdle = 0; lw[0] = 1 - k; lw[1] = k; }
      else if (runSp < LOCO[2].speed) { const k = (runSp - LOCO[1].speed) / (LOCO[2].speed - LOCO[1].speed); wIdle = 0; lw[1] = 1 - k; lw[2] = k; }
      else { wIdle = 0; lw[2] = 1; }
    }
    for (let i = 0; i < 3; i++) rate += lw[i] * (Math.max(runSp, 0.6) / LOCO[i].speed) / this.loco[i].dur;
    this.cycle = (this.cycle + dt * rate * (back ? -1 : 1) + 1) % 1;
    this.idle.setEffectiveWeight(wIdle);
    this.idle.time = (this.idle.time + dt) % this.idle.getClip().duration;
    this.loco.forEach((l, i) => {
      l.action.setEffectiveWeight(lw[i]);
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
    if (this.kickT > 0) { legs(); arms(); W.spine = Math.max(W.spine, 0.7); W.hips = Math.max(W.hips, 0.6); }
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
    if (this.kickT > 0) {
      this.kickT -= dt;
      const p = 1 - Math.max(0, this.kickT) / 0.34;
      const R = T.legs[1], Lg = T.legs[0];
      if (p < 0.3) { const k = p / 0.3; R.hip = lerp(0.1, 0.75, k); R.knee = lerp(0.3, 1.5, k); }
      else if (p < 0.6) { const k = (p - 0.3) / 0.3; R.hip = lerp(0.75, -1.2, k); R.knee = lerp(1.5, 0.05, k); }
      else { const k = (p - 0.6) / 0.4; R.hip = lerp(-1.2, -0.3, k); R.knee = lerp(0.05, 0.35, k); }
      Lg.hip = -0.15; Lg.knee = 0.4; R.z = Lg.z = 0;
      T.arms[0].x = -0.35; T.arms[0].z = 0.9; T.arms[1].x = 0.3; T.arms[1].z = 0.6;
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
