// The runners as people: Quaternius' Universal Base Characters (CC0) in running kit, moved by motion
// capture from the Universal Animation Library (CC0). See source/README.md for how models/ was made.
// One body, hairstyle and set of clips is loaded once; each runner is a clone with its own skeleton,
// its kit painted onto the body (top, leggings, shoes in their player colour), and its own mixer.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export type BodyKind = 'male' | 'female';
export type Skin = 'light' | 'dark';

// How a runner looks (runners.json, plus their suit from the shop and their player colour)
export interface Look {
  body: BodyKind;
  skin: Skin;
  tint: number; // shades the skin texture: 1 as it comes
  hair: string; // a file in models/people
  beard?: boolean;
  top: string;
  legs: string;
  shoes: string;
}

export type Move = 'idle' | 'run' | 'jumpUp' | 'air' | 'land' | 'roll' | 'hit' | 'down' | 'dance';
const CLIP: Record<Move, string> = {
  idle: 'Idle_Loop', run: 'Sprint_Loop', jumpUp: 'Jump_Start', air: 'Jump_Loop', land: 'Jump_Land',
  roll: 'Roll', hit: 'Hit_Chest', down: 'Death01', dance: 'Dance_Loop',
};
const ONCE = new Set<Move>(['jumpUp', 'land', 'roll', 'hit', 'down']);

const DIR = 'models/people/';
const MANNEQUIN_PELVIS = 0.917; // the pelvis height the motion capture was recorded at
const HAIRS = ['Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Buns', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Beard'];

interface Body {
  scene: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
  facing: number; // which way the model faces, as a yaw
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  skins: Record<Skin, THREE.Texture>;
}
let BODIES: Record<BodyKind, Body>;
let HAIR: Record<string, THREE.Mesh>;

const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
const isBone = (o: THREE.Object3D): o is THREE.Bone => o instanceof THREE.Bone;
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;
const isSkinned = (o: THREE.Object3D): o is THREE.SkinnedMesh => o instanceof THREE.SkinnedMesh;
const isBody = (o: THREE.SkinnedMesh) => o.geometry.attributes.position.count > 3000; // (not the eyes or eyebrows)
function collect<T extends THREE.Object3D>(root: THREE.Object3D, is: (o: THREE.Object3D) => o is T) {
  const out: T[] = [];
  root.traverse((o) => { if (is(o)) out.push(o); });
  return out;
}
const bonesOf = (root: THREE.Object3D) => Object.fromEntries(collect(root, isBone).map((b) => [norm(b.name), b]));

interface ClipData { name: string; duration: number; tracks: { name: string; type: 'quaternion' | 'vector'; times: number[]; values: number[] }[] }

export async function loadPeople() {
  const gl = new GLTFLoader();
  const tex = (url: string) => new Promise<THREE.Texture>((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    res(t);
  }, undefined, rej));
  const [male, female, anims, maleLight, femaleLight, ...hairs] = await Promise.all([
    gl.loadAsync(DIR + 'Superhero_Male_FullBody.gltf'),
    gl.loadAsync(DIR + 'Superhero_Female_FullBody.gltf'),
    fetch('models/animations.json').then((r) => r.json() as Promise<{ clips: ClipData[] }>),
    tex(DIR + 'T_Superhero_Male_Ligh.png'),
    tex(DIR + 'T_Superhero_Female_Light_BaseColor.png'),
    ...HAIRS.map((n) => gl.loadAsync(DIR + n + '.gltf')),
  ]);
  BODIES = { male: body(male, anims.clips, maleLight), female: body(female, anims.clips, femaleLight) };
  HAIR = Object.fromEntries(HAIRS.map((n, i) => [n, collect((hairs[i] as GLTF).scene, isMesh)[0]]));
}

// One body: its clips fitted to it (the motion capture's pelvis height scaled to this body's), and
// which way it faces
function body(g: GLTF, clips: ClipData[], light: THREE.Texture): Body {
  const scene = g.scene;
  scene.updateMatrixWorld(true);
  const bones = bonesOf(scene);
  const k = bones.pelvis.position.z / MANNEQUIN_PELVIS; // (the rig is Z-up inside)
  const fitted: Record<string, THREE.AnimationClip> = {};
  for (const c of clips) {
    const tracks = c.tracks.filter((t) => bones[norm(t.name.split('.')[0])]).map((t) => t.type === 'quaternion'
      ? new THREE.QuaternionKeyframeTrack(t.name, t.times, t.values)
      : new THREE.VectorKeyframeTrack(t.name, t.times, t.values.map((v) => v * k)));
    fitted[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
  }
  const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(bones[n].matrixWorld);
  const f = at('balll').sub(at('footl')).setY(0).normalize(); // heel to toe
  const mesh = collect(scene, isSkinned).find(isBody)!;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  return { scene, clips: fitted, facing: Math.atan2(f.x, f.z), geo: mesh.geometry, mat, skins: { dark: mat.map!, light } };
}

// --- the kit, painted onto the body -------------------------------------------------------------------
// Every vertex gets the colour of the part of the kit it's under, by the bone that moves it most:
// a short-sleeved top, full-length leggings and shoes. Skin keeps its texture (mask 0).
const kitCache = new Map<string, THREE.BufferGeometry>();
function painted(b: Body, skeleton: THREE.Skeleton, look: Look) {
  const key = `${b.geo.uuid}|${look.top}|${look.legs}|${look.shoes}`;
  const cached = kitCache.get(key);
  if (cached) return cached;
  const g = b.geo.clone();
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count;
  const kit = new Float32Array(n * 4);
  const top = new THREE.Color(look.top), legs = new THREE.Color(look.legs), shoes = new THREE.Color(look.shoes);
  const names = skeleton.bones.map((bone) => norm(bone.name));
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const bone = names[best] || '';
    const c = bone.startsWith('spine') || bone.startsWith('clavicle') || bone.startsWith('upperarm') ? top
      : bone === 'pelvis' || bone.startsWith('thigh') || bone.startsWith('calf') ? legs
      : bone.startsWith('foot') || bone.startsWith('ball') ? shoes : null;
    if (c) { kit[i * 4] = c.r; kit[i * 4 + 1] = c.g; kit[i * 4 + 2] = c.b; kit[i * 4 + 3] = 1; }
  }
  g.setAttribute('kit', new THREE.BufferAttribute(kit, 4));
  kitCache.set(key, g);
  return g;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function kitMaterial(b: Body, skin: Skin, tint: number) {
  const key = `${b.mat.uuid}|${skin}|${tint}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const m = b.mat.clone();
  m.map = b.skins[skin];
  m.color = new THREE.Color(tint, tint, tint);
  m.roughness = 0.75;
  m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 kit;\nvarying vec4 vKit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKit = kit;');
    // (the kit isn't shaded by the skin tint)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vKit;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vKit.rgb, vKit.a);');
  };
  m.customProgramCacheKey = () => 'runnerkit';
  matCache.set(key, m);
  return m;
}

const hairMats = new Map<string, THREE.MeshStandardMaterial>();
function hairMaterial(src: THREE.Material | THREE.Material[]) {
  const base = (Array.isArray(src) ? src[0] : src) as THREE.MeshStandardMaterial;
  let m = hairMats.get(base.uuid);
  if (!m) {
    m = base.clone();
    m.color = new THREE.Color(0.12, 0.1, 0.09); // dark hair
    hairMats.set(base.uuid, m);
  }
  return m;
}

// --- a runner ----------------------------------------------------------------------------------------
export class Person {
  readonly root = new THREE.Group(); // stands on the ground, faces -z (down the course)
  private mixer: THREE.AnimationMixer;
  private actions = {} as Record<Move, THREE.AnimationAction>;
  private move: Move | null = null;
  private meshes: THREE.Mesh[] = [];

  constructor(look: Look) {
    const b = BODIES[look.body];
    const scene = SkeletonUtils.clone(b.scene) as THREE.Group;
    const bones = bonesOf(scene);
    const skinned = collect(scene, isSkinned);
    const bodyMesh = skinned.find(isBody)!;
    bodyMesh.geometry = painted(b, bodyMesh.skeleton, look);
    bodyMesh.material = kitMaterial(b, look.skin, look.tint);
    // the hair and beard are rigged to the head: bind them to this runner's skeleton
    for (const name of [look.hair, ...(look.beard ? ['Hair_Beard'] : [])]) {
      const src = HAIR[name];
      if (!src) continue;
      let mesh: THREE.Mesh;
      if (src instanceof THREE.SkinnedMesh) {
        const hair = new THREE.SkinnedMesh(src.geometry, hairMaterial(src.material));
        bodyMesh.parent!.add(hair);
        hair.bind(new THREE.Skeleton(src.skeleton.bones.map((bone) => bones[norm(bone.name)]), src.skeleton.boneInverses), src.bindMatrix);
        mesh = hair;
      } else {
        mesh = new THREE.Mesh(src.geometry, hairMaterial(src.material));
        bodyMesh.parent!.add(mesh);
      }
      this.meshes.push(mesh);
    }
    scene.traverse((o) => { if (o instanceof THREE.Mesh) o.frustumCulled = false; });
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI - b.facing; // face -z
    inner.add(scene);
    this.root.add(inner);
    this.mixer = new THREE.AnimationMixer(scene);
    for (const m of Object.keys(CLIP) as Move[]) {
      const a = this.mixer.clipAction(b.clips[CLIP[m]]);
      if (ONCE.has(m)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[m] = a;
    }
    this.play('idle', 0);
  }

  // Change what they're doing, blending over `fade` seconds; `length` squeezes a one-off move into that time
  play(m: Move, fade = 0.12, length = 0) {
    if (m === this.move && !ONCE.has(m)) return;
    const next = this.actions[m];
    next.reset();
    next.timeScale = length ? next.getClip().duration / length : 1;
    next.play();
    if (this.move && this.move !== m && fade > 0) this.actions[this.move].crossFadeTo(next, fade, false);
    else if (this.move && this.move !== m) this.actions[this.move].stop();
    this.move = m;
  }

  get doing() { return this.move; }

  // A one-off move has played to its end
  get done() {
    const a = this.move ? this.actions[this.move] : null;
    return !!a && ONCE.has(this.move!) && !a.isRunning();
  }

  // Running pace: the cycle goes faster as the run speeds up (within reason)
  set pace(v: number) { this.actions.run.timeScale = v; }

  update(dt: number) { this.mixer.update(dt); }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
