// The people in the 3D games: realistic bodies, faces and clothes (built from MakeHuman in Blender by
// tools/people/), and their moves (motion capture baked onto the same skeleton). A game loads a cast
// (a .glb of people) and a set of moves, makes a Person from one of the cast for each player, dresses
// them in its colours, and plays the moves on them.
//
// Everyone has the same skeleton (MPFB's "game_engine" rig: Unreal-style names, pelvis, spine_01,
// thigh_l...), so any moves play on anyone. Bodies differ in size and build, so each clip is fitted to
// a body once: each bone's rotation is kept relative to its rest, and the hips' height is scaled.
//
// Parts, by material name: skin, hair, eyes, brows, lashes, and the clothes by what they are (shirt,
// shorts, socks, boots, gloves...). Kit parts come in grey for the game to colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const PEOPLE = '/people/';
const HIPS = 'pelvis';
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const HAND_FROM = 'idle'; // the clip whose relaxed hands go on clips without fingers

let loader: GLTFLoader | null = null;
function gltf() {
  if (!loader) {
    const draco = new DRACOLoader().setDecoderPath(PEOPLE + 'draco/');
    draco.setDecoderConfig({ type: 'wasm' });
    loader = new GLTFLoader().setDRACOLoader(draco);
  }
  return loader;
}

// ------------------------------------------------------------------ the cast --
export interface Cast {
  people: Map<string, THREE.Object3D>; // by name (the recipe's)
}

// models/<name>.glb
export async function loadCast(name: string): Promise<Cast> {
  const g = await gltf().loadAsync(`${PEOPLE}models/${name}.glb`);
  const people = new Map<string, THREE.Object3D>();
  for (const o of g.scene.children) people.set(o.name, o);
  // The loader makes every name in the file unique (the second person's pelvis is "pelvis_1"):
  // give everyone's bones back the skeleton's names, which the moves are keyed by
  const names = new Set<string>();
  g.scene.children[0]?.traverse((o) => { if ((o as THREE.Bone).isBone) names.add(o.name); });
  for (const p of g.scene.children.slice(1)) {
    p.traverse((o) => {
      if (!(o as THREE.Bone).isBone || names.has(o.name)) return;
      const base = o.name.replace(/_\d+$/, '');
      if (names.has(base)) o.name = base;
    });
  }
  return { people };
}

// ----------------------------------------------------------------- the moves --
export interface MoveInfo {
  duration: number; // s
  speed: number; // m/s over the ground, as captured (the game moves the person: clips stay in place)
  loop: boolean;
  contact?: number; // s into a strike when the foot (or fist) meets the ball
}

export interface Moves {
  clips: Map<string, THREE.AnimationClip>;
  info: Record<string, MoveInfo>;
  rest: Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>; // the skeleton they were made on, at rest
}

// models/<name>.glb and .json
export async function loadMoves(name: string): Promise<Moves> {
  const [g, about] = await Promise.all([
    gltf().loadAsync(`${PEOPLE}models/${name}.glb`),
    fetch(`${PEOPLE}models/${name}.json`).then((r) => r.json() as Promise<{ clips: Record<string, MoveInfo> }>),
  ]);
  const rest = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  g.scene.traverse((o) => { if ((o as THREE.Bone).isBone) rest.set(o.name, { q: o.quaternion.clone(), p: o.position.clone() }); });
  return { clips: new Map(g.animations.map((c) => [c.name, c])), info: about.clips, rest };
}

// The moves fitted to one body: each bone turns from its own rest as the moves' skeleton turned from
// its rest, and the hips rise and fall in proportion to its height. (Cached per body.)
const fitted = new WeakMap<THREE.Object3D, Map<string, THREE.AnimationClip>>();
export function fit(moves: Moves, body: THREE.Object3D): Map<string, THREE.AnimationClip> {
  const done = fitted.get(body);
  if (done && done.size === moves.clips.size) return done;
  const bones = new Map<string, THREE.Bone>();
  body.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
  const hipsK = (bones.get(HIPS)?.position.length() ?? 1) / (moves.rest.get(HIPS)?.p.length() ?? 1);
  const out = new Map<string, THREE.AnimationClip>();
  const q = new THREE.Quaternion(), d = new THREE.Quaternion();
  function fitTrack(t: THREE.KeyframeTrack): THREE.KeyframeTrack | null {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    const mine = bones.get(bone), theirs = moves.rest.get(bone);
    if (!mine || !theirs) return null;
    if (prop === 'quaternion') {
      // mine = myRest * theirRest^-1 * theirs
      const fix = mine.quaternion.clone().multiply(theirs.q.clone().invert());
      const v = new Float32Array(t.values.length);
      for (let i = 0; i < v.length; i += 4) {
        q.fromArray(t.values, i);
        d.copy(fix).multiply(q).toArray(v, i);
      }
      return new THREE.QuaternionKeyframeTrack(t.name, t.times, v);
    }
    if (prop === 'position' && bone === HIPS) return new THREE.VectorKeyframeTrack(t.name, t.times, t.values.map((x) => x * hipsK));
    return null;
  }
  // Hands: motion capture without fingers (CMU's) would leave them open and stiff as at rest, so
  // those clips hold the fingers as they are, relaxed, at the start of the idle
  const hand = new Map<string, THREE.KeyframeTrack>();
  for (const t of moves.clips.get(HAND_FROM)?.tracks ?? []) {
    if (FINGER.test(t.name) && t.name.endsWith('.quaternion')) {
      hand.set(t.name, new THREE.QuaternionKeyframeTrack(t.name, [0], Array.from(t.values.slice(0, 4))));
    }
  }
  for (const [name, clip] of moves.clips) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t of clip.tracks) {
      const f = fitTrack(t);
      if (f) tracks.push(f);
    }
    if (!clip.tracks.some((t) => FINGER.test(t.name))) for (const t of hand.values()) { const f = fitTrack(t); if (f) tracks.push(f); }
    out.set(name, new THREE.AnimationClip(name, clip.duration, tracks));
  }
  fitted.set(body, out);
  return out;
}

// ------------------------------------------------------------------ a person --
export type Pattern = 'plain' | 'stripes' | 'hoops';

// What someone wears, in colours (CSS strings). A part not given keeps its own colour.
export interface Outfit {
  shirt?: string;
  second?: string; // stripes or hoops on the shirt
  pattern?: Pattern;
  shorts?: string;
  socks?: string;
  boots?: string;
  gloves?: string;
  number?: number | ''; // on the back of the shirt
  numberColor?: string;
}

// The parts of a person, by what they are (their material's name up to the first dot)
const partOf = (m: THREE.Material) => m.name.split('.')[0];

export class Person {
  readonly root: THREE.Object3D; // put this in the scene: it stands at the origin, facing +Z
  readonly bones = new Map<string, THREE.Bone>();
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly height: number; // m, top of the head
  private readonly mats = new Map<string, THREE.MeshStandardMaterial[]>();

  constructor(cast: Cast, name: string) {
    const src = cast.people.get(name);
    if (!src) throw new Error(`no ${name} in the cast`);
    this.root = SkeletonUtils.clone(src);
    this.root.position.set(0, 0, 0);
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.castShadow = true;
      m.frustumCulled = false; // (skinned: its bounds move with the pose)
      // own materials, so this person can be coloured without colouring everyone
      const own = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const c = (x as THREE.MeshStandardMaterial).clone();
        const part = partOf(c);
        if (!this.mats.has(part)) this.mats.set(part, []);
        this.mats.get(part)!.push(c);
        if (part === 'hair' || part === 'brows' || part === 'lashes') {
          c.alphaTest = 0.5;
          c.transparent = false;
          c.side = THREE.DoubleSide;
        }
        return c;
      });
      m.material = Array.isArray(m.material) ? own : own[0];
      this.meshes.push(m);
    });
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    for (const m of this.meshes) if (partOf(m.material as THREE.Material) === 'skin') box.expandByObject(m);
    this.height = box.max.y || 1.8;
  }

  parts(part: string) { return this.mats.get(part) ?? []; }
  has(part: string) { return this.mats.has(part); }

  // A colour over a part (its texture's shading stays)
  tint(part: string, color: THREE.ColorRepresentation) {
    for (const m of this.parts(part)) m.color.set(color);
  }

  dress(o: Outfit) {
    if (o.shorts) this.tint('shorts', o.shorts);
    if (o.socks) this.tint('socks', o.socks);
    if (o.boots) this.tint('boots', o.boots);
    if (o.gloves) this.tint('gloves', o.gloves);
    if (o.shirt) {
      this.tint('shirt', o.shirt);
      const shirt = this.meshes.find((m) => partOf(m.material as THREE.Material) === 'shirt');
      if (shirt) for (const m of this.parts('shirt')) paintShirt(m, shirt.geometry, o);
    }
  }
}

// ---------------------------------------------------------------- shirt paint --
// Stripes, hoops and the number are drawn on the shirt where they'd be printed on the cloth:
// measured on the shirt as it was made (its rest shape), so they fold and stretch with it.
const NUMBER = { width: 0.24, top: 0.13, height: 0.27 }; // m: on the back, from the shirt's top
const BAND = { stripes: 0.11, hoops: 0.12 }; // m: one colour's width

const numbers = new Map<string, THREE.CanvasTexture>();
function numberTexture(n: number, color: string) {
  const key = `${n}:${color}`;
  let t = numbers.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 144;
  const g = c.getContext('2d')!;
  g.font = 'bold 118px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(String(n), 64, 76, 124);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numbers.set(key, t);
  return t;
}

function paintShirt(m: THREE.MeshStandardMaterial, geo: THREE.BufferGeometry, o: Outfit) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const centre = (b.min.x + b.max.x) / 2;
  const back = (b.min.z + b.max.z) / 2;
  const u = {
    second: { value: new THREE.Color(o.second ?? o.shirt ?? '#fff') },
    pattern: { value: o.pattern === 'stripes' ? 1 : o.pattern === 'hoops' ? 2 : 0 },
    band: { value: o.pattern === 'hoops' ? BAND.hoops : BAND.stripes },
    centre: { value: new THREE.Vector3(centre, b.max.y, back) },
    num: { value: o.number !== undefined && o.number !== '' ? numberTexture(o.number, o.numberColor ?? '#fff') : null },
    numRect: { value: new THREE.Vector3(NUMBER.width, NUMBER.top, NUMBER.height) },
  };
  m.userData.paint = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest;
uniform vec3 second; uniform int pattern; uniform float band; uniform vec3 centre;
uniform sampler2D num; uniform vec3 numRect;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float x = vRest.x - centre.x, y = centre.y - vRest.y;
  float on = pattern == 1 ? step(0.5, fract(x / (2.0 * band) + 0.25)) : pattern == 2 ? step(0.5, fract(y / (2.0 * band))) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, second * (diffuseColor.rgb / max(diffuse, vec3(1e-3))), on);
  ${u.num.value ? `
  vec2 q = vec2(0.5 + x / numRect.x, (y - numRect.y) / numRect.z);
  if (vRest.z < centre.z && q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
    vec4 n = texture2D(num, vec2(1.0 - q.x, 1.0 - q.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, n.rgb, n.a);
  }` : ''}
}`);
  };
  m.customProgramCacheKey = () => `shirt:${u.num.value ? 1 : 0}`;
  m.needsUpdate = true;
}
