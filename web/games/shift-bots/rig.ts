// The bots: a real car, cut into the panels it's made of (bonnet, wings, doors, rear quarters, bumpers,
// boot, roof, glass, wheels) by tools/cars/cars.py in Blender and served from /cars/, and a robot skeleton
// the same panels fold onto. Every panel has two places: where it sits on the car, and where it sits on
// the robot (a joint, an offset, which way it faces). The robot lies folded inside the car holding its
// panels; changing, it gets up, and each panel slides the last bit into place as its limb arrives.
//
// The car faces +z with y up, so its left is +x; the robot stands facing the same way. Lengths in metres.
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { materials, type Livery, type MatName } from './paint.ts';

type V3 = [number, number, number];

export type Head = 'visor' | 'crest' | 'horns' | 'dome' | 'block' | 'fin';
export interface RobotShape { height: number; bulk: number; head: Head; shift?: number } // shift: seconds to change
export interface Body { id: string; name: string; about: string; model: string; robot: RobotShape } // model: a car in /cars/

// --- the cars --------------------------------------------------------------------------------------------
// What cars.json says about each car (made with the models by tools/cars/cars.py)
export interface CarInfo {
  id: string; name: string; length: number; width: number; height: number;
  wheels: Record<string, { x: number; y: number; z: number; r: number }>;
  credit: { title: string; by: string; from: string; licence: string };
}
const cars = new Map<string, { scene: THREE.Group; info: CarInfo }>();
const loading = new Map<string, Promise<void>>();
let catalogue: Promise<CarInfo[]> | null = null;
let loader: GLTFLoader | null = null;

// What every car is (cars.json), for their names and credits before any is loaded
export async function carList() {
  catalogue ??= fetch('/cars/cars.json', { cache: 'no-store' }).then((r) => r.json() as Promise<{ cars: CarInfo[] }>).then((j) => j.cars);
  return catalogue;
}

// Load the cars these bodies are made from (before making a Rig of one); each is fetched once, when first
// wanted (they're a megabyte or two each; meshes Draco-compressed, decoded by the people's decoder)
export async function loadCars(bodies: Body[]) {
  const list = await carList();
  loader ??= new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/people/draco/'));
  await Promise.all([...new Set(bodies.map((b) => b.model))].map((id) => {
    if (!loading.has(id)) loading.set(id, loader!.loadAsync(`/cars/models/${id}.glb`).then(({ scene }) => { cars.set(id, { scene, info: list.find((c) => c.id === id)! }); }));
    return loading.get(id)!;
  }));
}
export const carInfo = (id: string) => cars.get(id)?.info;
// A car just as it is, parked (scenery: it doesn't change or move), or null if it isn't loaded
export function parkedCar(id: string) {
  const car = cars.get(id);
  if (!car) return null;
  const g = car.scene.clone(true);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
  return g;
}
export const carLoaded = (id: string) => cars.has(id);

// --- where each part goes on the robot ----------------------------------------------------------------
// For a left part (the right one is its mirror image): the joint it rides on; where, from the joint (in
// robot heights: a 3.4 m robot is 1); which way its outside should face; where its `ref` (an axis of the
// car, as it lies on the panel) should point; how big it is there; and when it moves (0 first .. 0.45)
interface Place { joint: string; at: V3; face: V3; to: V3; ref?: 'x' | 'y' | 'z'; scale?: number; delay: number }
// (a car's panel the table doesn't know rides in the robot's hips, out of sight)
const PLACES: Record<string, Place> = {
  // the chest is the car's face: the bonnet above, the two halves of the front bumper (lamps and all) below
  'bonnet': { joint: 'chest', at: [0, 0.075, 0.1], face: [0, 0.45, 1], to: [0, -1, 0], scale: 0.68, delay: 0.24 },
  'nose.L': { joint: 'chest', at: [0.075, -0.045, 0.1], face: [0.15, -0.1, 1], ref: 'x', to: [1, 0, 0], scale: 0.7, delay: 0.28 },
  'glass.front': { joint: 'chest', at: [0, 0.04, 0], face: [0, 0.3, 1], to: [0, -1, 0], scale: 0.3, delay: 0.2 }, // (folded away inside)
  // the back: the roof and the rear glass, the boot lid lower down
  'roof': { joint: 'chest', at: [0, 0.0, -0.11], face: [0, 0.3, -1], to: [0, 1, 0], scale: 0.58, delay: 0.16 },
  'glass.rear': { joint: 'waist', at: [0, 0.0, -0.1], face: [0, -0.2, -1], to: [0, 1, 0], scale: 0.5, delay: 0.2 },
  'deck': { joint: 'hips', at: [0, 0.01, -0.09], face: [0, 0.1, -1], to: [0, 1, 0], scale: 0.55, delay: 0.24 },
  // shoulders: the front wings with the wheels on them; the doors are shields on the forearms
  'fender.L': { joint: 'shoulder.L', at: [0.03, 0.045, 0], face: [0.5, 1, 0], to: [0, 0, 1], scale: 0.68, delay: 0.12 },
  'wheel.front.L': { joint: 'shoulder.L', at: [0.085, -0.05, -0.02], face: [1, 0, 0], to: [0, 0, 1], scale: 0.78, delay: 0 },
  'door.L': { joint: 'elbow.L', at: [0.05, -0.085, 0.005], face: [1, 0, 0.15], to: [0, -1, 0], scale: 0.52, delay: 0.04 },
  // legs: the rear quarters down the shins with the wheels behind the calves, the tail for feet
  'quarter.L': { joint: 'knee.L', at: [0.045, -0.1, 0.012], face: [1, 0, 0.35], to: [0, 1, 0], scale: 0.62, delay: 0.12 },
  'wheel.rear.L': { joint: 'knee.L', at: [0.015, -0.11, -0.085], face: [1, 0, 0], to: [0, 0, 1], scale: 0.85, delay: 0 },
  'tail.L': { joint: 'ankle.L', at: [0, 0.02, 0.05], face: [0, 1, 0.4], ref: 'x', to: [0, 0, 1], scale: 0.62, delay: 0.3 },
  // what isn't seen: folded away in the hips
  'cockpit': { joint: 'chest', at: [0, 0.03, -0.02], face: [0, 1, 0], to: [0, 0, 1], scale: 0.12, delay: 0.1 },
  'chassis': { joint: 'hips', at: [0, 0, 0], face: [0, 1, 0], to: [0, 0, 1], scale: 0.12, delay: 0.08 },
};

// The robot's skeleton, in robot heights, standing; mirrored for the right side
const JOINTS: [name: string, parent: string, at: V3][] = [
  ['hips', 'root', [0, 0.49, 0]],
  ['waist', 'hips', [0, 0.07, 0]],
  ['chest', 'waist', [0, 0.12, 0]],
  ['neck', 'chest', [0, 0.15, 0]],
  ['head', 'neck', [0, 0.03, 0]],
  ['shoulder.L', 'chest', [0.215, 0.09, 0]],
  ['elbow.L', 'shoulder.L', [0, -0.2, 0]],
  ['hand.L', 'elbow.L', [0, -0.19, 0]],
  ['hip.L', 'hips', [0.09, -0.03, 0]],
  ['knee.L', 'hip.L', [0, -0.215, 0]],
  ['ankle.L', 'knee.L', [0, -0.215, 0]],
];

// The machined frame under the panels, seen only as a robot: [joint, shape, centre, size, material]
type FramePart = [joint: string, shape: 'box' | 'cyl' | 'ball', at: V3, size: V3, mat: MatName];
const FRAME: FramePart[] = [
  ['hips', 'box', [0, 0, 0], [0.21, 0.085, 0.14], 'frame'],
  ['hips', 'box', [0, -0.03, 0.07], [0.08, 0.07, 0.03], 'paint'],
  ['hips', 'box', [0, 0.03, 0.072], [0.12, 0.018, 0.01], 'eyes'], // (a strip of light across the belt)
  ['waist', 'cyl', [0, 0.0, 0], [0.12, 0.09, 0.12], 'joint'],
  ['waist', 'box', [0, 0.035, 0.012], [0.14, 0.05, 0.12], 'frame'],
  ['chest', 'box', [0, 0.045, -0.025], [0.3, 0.19, 0.14], 'frame'],
  ['chest', 'box', [0.15, 0.05, 0], [0.05, 0.14, 0.16], 'paint'],
  ['chest', 'box', [-0.15, 0.05, 0], [0.05, 0.14, 0.16], 'paint'],
  ['chest', 'box', [0, 0.14, -0.005], [0.2, 0.035, 0.11], 'accent'],
  ['neck', 'cyl', [0, 0.01, 0], [0.05, 0.06, 0.05], 'joint'],
  ['shoulder.L', 'ball', [0, 0, 0], [0.06, 0.06, 0.06], 'joint'],
  ['shoulder.L', 'box', [0, -0.1, 0], [0.08, 0.16, 0.085], 'frame'],
  ['shoulder.L', 'box', [0.012, -0.04, 0], [0.095, 0.06, 0.1], 'paint'],
  ['elbow.L', 'ball', [0, 0, 0], [0.045, 0.045, 0.045], 'joint'],
  ['elbow.L', 'box', [0, -0.09, 0], [0.085, 0.15, 0.09], 'frame'],
  ['hand.L', 'box', [0, -0.035, 0.005], [0.07, 0.065, 0.075], 'joint'],
  ['hand.L', 'box', [0, -0.08, 0.012], [0.065, 0.04, 0.055], 'frame'],
  ['hip.L', 'ball', [0, 0, 0], [0.055, 0.055, 0.055], 'joint'],
  ['hip.L', 'box', [0, -0.105, 0], [0.1, 0.18, 0.11], 'frame'],
  ['hip.L', 'box', [0, -0.1, 0.058], [0.105, 0.11, 0.03], 'paint'],
  ['knee.L', 'ball', [0, 0, 0.012], [0.05, 0.05, 0.05], 'joint'],
  ['knee.L', 'box', [0, -0.11, -0.005], [0.11, 0.19, 0.12], 'frame'],
  ['knee.L', 'box', [0, -0.08, 0.062], [0.112, 0.12, 0.03], 'paint'],
  ['ankle.L', 'box', [0, -0.005, 0.025], [0.1, 0.05, 0.18], 'frame'],
  ['ankle.L', 'box', [0, -0.005, 0.11], [0.1, 0.04, 0.04], 'accent'],
];

// --- a body's parts, built once and shared by every bot with that body ----------------------------------
// A panel is one or more meshes: the car's own materials, except its paint (and second colour), which
// are the livery's
interface KitMesh { geometry: THREE.BufferGeometry; mat: MatName | THREE.Material }
interface KitPart {
  name: string; meshes: KitMesh[];
  car: THREE.Matrix4; robot: { joint: string; local: THREE.Matrix4 }; delay: number;
  fold: THREE.Matrix4; // where it sits on its joint while the robot lies folded in the car (so: where it is on the car)
  pop: THREE.Vector3; // which way it lifts off the car as it comes loose, in the joint's frame
  wheel?: { front: boolean; side: number };
}
interface Kit { body: Body; parts: KitPart[]; k: number; joints: typeof JOINTS; folded: { p: THREE.Vector3; q: THREE.Quaternion; s: number } }

const kits = new Map<string, Kit>();
function kit(body: Body): Kit {
  const hit = kits.get(body.id);
  if (hit) return hit;
  const car = cars.get(body.model);
  if (!car) throw new Error(`${body.model}: not loaded (loadCars first)`);
  const k = body.robot.height, bulk = body.robot.bulk, length = car.info.length, sill = 0.15;
  const parts: KitPart[] = [];
  const robotMatrix = (name: string, normal: THREE.Vector3): KitPart['robot'] & { delay: number } => {
    const mirror = name.endsWith('.R'), key = mirror ? name.slice(0, -2) + '.L' : name;
    const p = PLACES[key] ?? PLACES.chassis;
    const m = (v: V3) => new THREE.Vector3(mirror ? -v[0] : v[0], v[1], v[2]);
    const at = m(p.at).multiply(new THREE.Vector3(k * bulk, k, k));
    // turn the panel so its outside faces `face` and its `ref` axis points along `to`
    const ref = new THREE.Vector3(p.ref === 'x' ? (mirror ? -1 : 1) : 0, p.ref === 'y' ? 1 : 0, !p.ref || p.ref === 'z' ? 1 : 0);
    let a = ref.clone().addScaledVector(normal, -ref.dot(normal));
    if (a.lengthSq() < 1e-4) a = new THREE.Vector3(0, 0, 1).addScaledVector(normal, -normal.z);
    a.normalize();
    const from = new THREE.Matrix4().makeBasis(a, normal, a.clone().cross(normal));
    const N = m(p.face).normalize(), A = m(p.to).addScaledVector(N, -m(p.to).dot(N)).normalize();
    const to = new THREE.Matrix4().makeBasis(A, N, A.clone().cross(N));
    const rot = to.multiply(from.transpose());
    const scale = p.scale ?? 1;
    return { joint: mirror ? p.joint.replace('.L', '.R') : p.joint, local: new THREE.Matrix4().makeTranslation(at).multiply(rot).scale(new THREE.Vector3(scale, scale, scale)), delay: p.delay };
  };

  // the car's panels, each a node of the model with its meshes centred on it
  car.scene.updateMatrixWorld(true);
  for (const node of car.scene.children) {
    const name = (node.userData.name as string | undefined) ?? node.name, meshes: KitMesh[] = [];
    const inv = node.matrixWorld.clone().invert();
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geometry = o === node ? o.geometry : o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const m = o.material as THREE.Material;
      meshes.push({ geometry, mat: m.name === 'paint' || m.name === 'accent' ? m.name : m });
    });
    if (!meshes.length) continue;
    const wheel = /^wheel\.(front|rear)\.([LR])$/.exec(name);
    const normal = wheel ? new THREE.Vector3(wheel[2] === 'L' ? 1 : -1, 0, 0) : averageNormal(meshes.map((x) => x.geometry));
    const r = robotMatrix(name, normal);
    parts.push({ name, meshes, car: node.matrixWorld.clone(), robot: { joint: r.joint, local: r.local }, delay: r.delay,
      fold: new THREE.Matrix4(), pop: new THREE.Vector3(), wheel: wheel ? { front: wheel[1] === 'front', side: wheel[2] === 'L' ? 1 : -1 } : undefined });
  }

  // the robot's frame: it waits folded up inside the car, then unfolds
  let n = 0;
  const frame = (j: string, shape: FramePart[1], at: V3, size: V3, mat: MatName, mirror: boolean) => {
    const sx = size[0] * k * bulk, sy = size[1] * k, sz = size[2] * k;
    const g = shape === 'box' ? roundedBox(sx, sy, sz, Math.min(sx, sy, sz) * 0.18) : shape === 'cyl' ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 14) : new THREE.SphereGeometry(sx, 14, 10);
    const local = new THREE.Matrix4().makeTranslation((mirror ? -1 : 1) * at[0] * k * bulk, at[1] * k, at[2] * k);
    parts.push({ name: `frame.${j}`, meshes: [{ geometry: g, mat }], car: new THREE.Matrix4(), robot: { joint: mirror ? j.replace('.L', '.R') : j, local },
      delay: 0.14 + ((n++ * 0.37) % 1) * 0.12, fold: new THREE.Matrix4(), pop: new THREE.Vector3() });
  };
  for (const [j, shape, at, size, mat] of FRAME) {
    frame(j, shape, at, size, mat, false);
    if (j.endsWith('.L')) frame(j, shape, at, size, mat, true);
  }
  for (const [geometry, mat] of headGeometry(body.robot.head, k)) {
    parts.push({ name: 'frame.head', meshes: [{ geometry, mat }], car: new THREE.Matrix4(), robot: { joint: 'head', local: new THREE.Matrix4() },
      delay: 0.3, fold: new THREE.Matrix4(), pop: new THREE.Vector3() });
  }

  const joints = JOINTS.flatMap(([n, p, at]) => {
    const scaled: V3 = [at[0] * k * bulk, at[1] * k, at[2] * k];
    return n.endsWith('.L') ? [[n, p, scaled], [n.replace('.L', '.R'), p.replace('.L', '.R'), [-scaled[0], scaled[1], scaled[2]]]] : [[n, p, scaled]];
  }) as typeof JOINTS;
  // Folded up in the car, the robot lies face down along it: feet at the tail, arms reaching past its
  // head to the nose. Every panel is held by its joint from the start, so when the robot gets up the
  // panels come with the limbs they belong to, and only slide the last bit into place.
  const folded = {
    p: new THREE.Vector3(0, sill + 0.25 + 0.06 * k, -length / 2 + 0.35),
    q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    s: Math.min(0.88, (length - 0.7) / (1.18 * k)),
  };
  const made: Kit = { body, parts, k, joints, folded };
  const bones = skeleton(joints);
  foldUp(bones, made);
  const centre = new THREE.Vector3(0, sill + 0.4, 0), inv = new THREE.Matrix4(), rot = new THREE.Quaternion(), at = new THREE.Vector3();
  for (const p of parts) {
    const joint = bones.get(p.robot.joint)!.matrixWorld;
    if (p.name.startsWith('frame')) { p.fold.copy(p.robot.local).scale(new THREE.Vector3(0.8, 0.8, 0.8)); continue; } // (the frame rides its joints all along)
    p.fold.copy(inv.copy(joint).invert()).multiply(p.car);
    at.setFromMatrixPosition(p.car).sub(centre).setY(0.4).normalize().multiplyScalar(0.3);
    joint.decompose(new THREE.Vector3(), rot, new THREE.Vector3());
    p.pop.copy(at.applyQuaternion(rot.invert()));
  }
  kits.set(body.id, made);
  return made;
}

// A skeleton of joints from the table: name -> joint, under 'root'
function skeleton(joints: typeof JOINTS) {
  const map = new Map<string, THREE.Object3D>([['root', new THREE.Bone()]]);
  for (const [name, parent, at] of joints) {
    const j = new THREE.Bone(); // (bones, so the merged robot can be skinned to them)
    j.position.set(...at);
    map.get(parent)!.add(j);
    map.set(name, j);
  }
  return map;
}

// How each joint bends while the robot lies folded in the car (by the joint's name, either side)
const FOLD: Record<string, V3> = { shoulder: [Math.PI - 0.12, 0, 0], elbow: [0.1, 0, 0], neck: [0.55, 0, 0], ankle: [1.25, 0, 0] };
const foldOf = (name: string) => FOLD[name.split('.')[0]] ?? [0, 0, 0];
function foldUp(bones: Map<string, THREE.Object3D>, kit: Kit) {
  for (const [name, j] of bones) if (name !== 'root') j.rotation.set(...foldOf(name));
  const root = bones.get('root')!;
  root.position.copy(kit.folded.p);
  root.quaternion.copy(kit.folded.q);
  root.scale.setScalar(kit.folded.s);
  root.updateMatrixWorld(true);
}

// When each joint moves, as a share of the change: the body swings up first (pivoting on the feet at
// the tail), the legs straighten under it, the arms swing down, and the head comes up last
const JOINT_TIME: Record<string, [number, number]> = {
  root: [0.08, 0.64], hips: [0.2, 0.72], waist: [0.2, 0.72], chest: [0.25, 0.78], hip: [0.22, 0.75], knee: [0.28, 0.8], ankle: [0.38, 0.85],
  shoulder: [0.28, 0.82], elbow: [0.34, 0.86], hand: [0.42, 0.92], neck: [0.55, 0.94], head: [0.55, 0.94],
};

// Which way a panel faces, all told: its faces' normals, each by its area
function averageNormal(geometries: THREE.BufferGeometry[]) {
  const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const g of geometries) {
    const p = g.attributes.position, idx = g.index, count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const at = (j: number) => (idx ? idx.getX(i + j) : i + j);
      a.fromBufferAttribute(p, at(0)); b.fromBufferAttribute(p, at(1)); c.fromBufferAttribute(p, at(2));
      n.add(b.sub(a).cross(c.sub(a)));
    }
  }
  return n.lengthSq() > 1e-9 ? n.normalize() : new THREE.Vector3(0, 1, 0);
}

function roundedBox(w: number, h: number, d: number, r: number) {
  // a box with its edges bevelled: a box squeezed out of a rounded rectangle
  const shape = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  shape.moveTo(-x, -h / 2); shape.lineTo(x, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  shape.lineTo(w / 2, y); shape.quadraticCurveTo(w / 2, h / 2, x, h / 2); shape.lineTo(-x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); shape.lineTo(-w / 2, -y); shape.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - r * 2, bevelEnabled: true, bevelSize: r * 0.8, bevelThickness: r, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - r * 2) / 2);
  return g;
}

// Each body's own head
function headGeometry(head: Head, k: number): [THREE.BufferGeometry, MatName][] {
  const s = (x: number) => x * k, box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => roundedBox(s(w), s(h), s(d), s(Math.min(w, h, d) * 0.2)).translate(s(x), s(y), s(z));
  const out: [THREE.BufferGeometry, MatName][] = [];
  const add = (mat: MatName, ...g: THREE.BufferGeometry[]) => out.push([mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x))), mat]);
  switch (head) {
    case 'visor':
      add('frame', box(0.1, 0.1, 0.1, 0, 0.05, 0), box(0.12, 0.03, 0.06, 0, 0.1, -0.01), box(0.02, 0.05, 0.06, 0.06, 0.05, 0), box(0.02, 0.05, 0.06, -0.06, 0.05, 0));
      add('eyes', box(0.085, 0.02, 0.01, 0, 0.06, 0.05));
      break;
    case 'crest':
      add('frame', box(0.09, 0.1, 0.1, 0, 0.05, 0), box(0.016, 0.07, 0.11, 0, 0.12, -0.01), box(0.02, 0.06, 0.05, 0.052, 0.07, -0.01), box(0.02, 0.06, 0.05, -0.052, 0.07, -0.01));
      add('accent', box(0.018, 0.03, 0.06, 0, 0.135, 0.02));
      add('eyes', box(0.025, 0.014, 0.01, 0.022, 0.065, 0.05), box(0.025, 0.014, 0.01, -0.022, 0.065, 0.05));
      break;
    case 'horns': {
      const horn = (x: number) => new THREE.ConeGeometry(s(0.016), s(0.08), 8).rotateZ(-x * 0.5).translate(s(x * 0.06), s(0.13), 0);
      add('frame', box(0.1, 0.09, 0.1, 0, 0.045, 0), box(0.06, 0.03, 0.04, 0, 0.012, 0.04));
      add('accent', horn(1), horn(-1));
      add('eyes', box(0.03, 0.014, 0.01, 0.024, 0.06, 0.05), box(0.03, 0.014, 0.01, -0.024, 0.06, 0.05));
      break;
    }
    case 'dome':
      add('frame', new THREE.SphereGeometry(s(0.058), 18, 12).scale(1, 0.95, 1).translate(0, s(0.06), 0), box(0.11, 0.03, 0.08, 0, 0.02, 0));
      add('eyes', new THREE.SphereGeometry(s(0.059), 18, 6, -0.9, 1.8, 1.25, 0.32).translate(0, s(0.06), 0));
      break;
    case 'block':
      add('frame', box(0.13, 0.085, 0.1, 0, 0.042, 0), box(0.05, 0.03, 0.08, 0.065, 0.06, 0), box(0.05, 0.03, 0.08, -0.065, 0.06, 0), box(0.07, 0.025, 0.02, 0, 0.015, 0.05));
      add('eyes', box(0.1, 0.012, 0.01, 0, 0.06, 0.05));
      break;
    case 'fin':
      add('frame', box(0.09, 0.095, 0.1, 0, 0.048, 0), box(0.015, 0.05, 0.12, 0.05, 0.1, -0.03).rotateX(0.4), box(0.015, 0.05, 0.12, -0.05, 0.1, -0.03).rotateX(0.4));
      add('accent', box(0.06, 0.012, 0.03, 0, 0.098, 0.035));
      add('eyes', box(0.07, 0.016, 0.01, 0, 0.06, 0.05));
      break;
  }
  return out;
}

// --- a bot ----------------------------------------------------------------------------------------------
// What the robot is doing, for its pose: how fast it's walking and which way (in its own frame: x left,
// z forward, m/s), whether it's aiming, and the moment of a punch or a dodge (0..1, 0 = not)
export interface Pose { move: { x: number; z: number }; aim: number; punch: number; punchSide: number; dodge: number; hit: number }
export const still = (): Pose => ({ move: { x: 0, z: 0 }, aim: 0, punch: 0, punchSide: 1, dodge: 0, hit: 0 });

export const SHIFT_TIME = 0.9; // s, car to robot or back (each body has its own: bots.json)

interface Live {
  part: KitPart; mesh: THREE.Object3D; joint: THREE.Object3D; frame: boolean;
  fold: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }; robot: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };
}
const parts3 = (m: THREE.Matrix4) => { const o = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }; m.decompose(o.p, o.q, o.s); return o; };
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _q3 = new THREE.Quaternion();

// --- the guns ------------------------------------------------------------------------------------------
// What a robot carries on its right forearm (built here, in its hand's frame: the barrels point down the
// arm, so with the arm raised to aim they point ahead): a rotary gun whose six barrels spin up as it fires,
// a cannon with a muzzle brake, twin short scatter barrels, or a long rifle
export type GunKind = 'rotary' | 'cannon' | 'scatter' | 'rifle';
interface GunParts { fixed: [THREE.BufferGeometry, MatName][]; spinning: [THREE.BufferGeometry, MatName][] }
const guns = new Map<string, GunParts>();
function gunParts(kind: GunKind, k: number): GunParts {
  const key = `${kind}:${k}`, hit = guns.get(key);
  if (hit) return hit;
  const s = (x: number) => x * k, cyl = (r: number, len: number, y: number, x = 0, z = 0, r2 = r) => new THREE.CylinderGeometry(s(r), s(r2), s(len), 14).translate(s(x), s(y), s(z));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => roundedBox(s(w), s(h), s(d), s(Math.min(w, h, d) * 0.2)).translate(s(x), s(y), s(z));
  const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  let parts: GunParts;
  if (kind === 'rotary') {
    const barrels: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; barrels.push(cyl(0.011, 0.26, -0.27, Math.cos(a) * 0.03, Math.sin(a) * 0.03)); }
    barrels.push(new THREE.TorusGeometry(s(0.034), s(0.008), 6, 18).rotateX(Math.PI / 2).translate(0, s(-0.37), 0), cyl(0.012, 0.28, -0.26));
    parts = {
      fixed: [[merge([cyl(0.052, 0.13, -0.08, 0, 0, 0.058), cyl(0.04, 0.03, -0.16)]), 'frame'], [box(0.07, 0.09, 0.07, -0.07, -0.08, 0), 'accent']],
      spinning: [[merge(barrels), 'chrome']],
    };
  } else if (kind === 'cannon') {
    parts = {
      fixed: [[merge([box(0.1, 0.14, 0.1, 0, -0.07, 0), cyl(0.036, 0.3, -0.28, 0, 0, 0.044)]), 'frame'],
        [merge([box(0.1, 0.06, 0.1, 0, -0.44, 0), cyl(0.046, 0.02, -0.15)]), 'joint'], [box(0.04, 0.12, 0.04, 0.06, -0.08, 0), 'accent']],
      spinning: [],
    };
  } else if (kind === 'scatter') {
    parts = {
      fixed: [[merge([box(0.11, 0.11, 0.08, 0, -0.07, 0), cyl(0.026, 0.18, -0.21, 0.03), cyl(0.026, 0.18, -0.21, -0.03)]), 'frame'],
        [merge([cyl(0.03, 0.02, -0.3, 0.03), cyl(0.03, 0.02, -0.3, -0.03)]), 'chrome'], [box(0.12, 0.03, 0.09, 0, -0.03, 0), 'accent']],
      spinning: [],
    };
  } else {
    parts = {
      fixed: [[merge([box(0.06, 0.16, 0.07, 0, -0.08, 0), cyl(0.013, 0.5, -0.4)]), 'frame'],
        [merge([cyl(0.02, 0.14, -0.12, 0, 0.06), cyl(0.022, 0.04, -0.64)]), 'joint'], [cyl(0.006, 0.12, -0.12, 0, 0.083), 'eyes']],
      spinning: [],
    };
  }
  guns.set(key, parts);
  return parts;
}

// --- drawing a bot cheaply -------------------------------------------------------------------------------
// A bot is dozens of pieces, each its own draw. Settled as a car, or as a robot, the pieces don't move
// against each other (as a robot, not against their joint), so they're drawn merged: as a car, one mesh per
// material (and the four wheels, which turn); as a robot, one per material on each joint. Only while it's
// changing are the pieces drawn one by one. (The robot's is skinned: each piece's vertices are bound to
// its joint, and the graphics card moves them, so it's one draw per material for the whole robot.)
type Merged = { key: MatName | THREE.Material; geometry: THREE.BufferGeometry }[];
interface Baked { car: Merged; robot: Merged; bones: string[] }
const baked = new Map<Kit, Baked>();
function bake(kt: Kit): Baked {
  const hit = baked.get(kt);
  if (hit) return hit;
  const car = new Map<MatName | THREE.Material, THREE.BufferGeometry[]>(), robot = new Map<MatName | THREE.Material, THREE.BufferGeometry[]>();
  const bones = ['root', ...kt.joints.map((j) => j[0])];
  const put = (into: Map<MatName | THREE.Material, THREE.BufferGeometry[]>, m: KitMesh, at: THREE.Matrix4, bone = -1) => {
    const g = plain(m.geometry).applyMatrix4(at);
    if (bone >= 0) { // (all of it on its joint's bone)
      const n = g.attributes.position.count, index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { index[i * 4] = bone; weight[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    }
    into.set(m.mat, [...(into.get(m.mat) ?? []), g]);
  };
  for (const p of kt.parts) for (const m of p.meshes) {
    if (!p.wheel && !p.name.startsWith('frame')) put(car, m, p.car);
    put(robot, m, p.robot.local, bones.indexOf(p.robot.joint));
  }
  const merge = (by: Map<MatName | THREE.Material, THREE.BufferGeometry[]>): Merged => [...by].map(([key, list]) => ({ key, geometry: mergeGeometries(list) }));
  const made = { car: merge(car), robot: merge(robot), bones };
  baked.set(kt, made);
  return made;
}
// A copy with just what every merged mesh has (position, normal, uv), not indexed, so any two will merge.
// (The pieces are drawn from the same copies, so a bot looks exactly the same merged or in pieces.)
const plains = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const plainOf = (g: THREE.BufferGeometry) => { let p = plains.get(g); if (!p) { p = plain(g); plains.set(g, p); } return p; };
function plain(g: THREE.BufferGeometry) {
  const flat = g.index ? g.toNonIndexed() : g.clone(), out = new THREE.BufferGeometry();
  out.setAttribute('position', flat.attributes.position);
  if (!flat.attributes.normal) flat.computeVertexNormals();
  out.setAttribute('normal', flat.attributes.normal);
  out.setAttribute('uv', flat.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(flat.attributes.position.count * 2), 2));
  return out;
}

export class Rig {
  readonly root = new THREE.Group();
  readonly k: number;
  shift = 0; // 0 = a car, 1 = a robot, in between = transforming
  target = 0;
  spin = 0; // how far the wheels have turned (rad)
  steer = 0; // the front wheels, -1..1 (+ = left)
  private live: Live[] = [];
  private skeleton = new THREE.Object3D();
  private joints = new Map<string, THREE.Object3D>();
  private rest = new Map<string, THREE.Vector3>();
  private folded = new Map<string, THREE.Quaternion>();
  private kit: Kit;
  readonly time: number; // s to change, this body's own
  private walk = 0;
  private t = Math.random() * 10;
  private asOne: THREE.Group; // (the car, merged)
  private skinned: THREE.Group; // (the robot, merged and skinned to its joints)
  private mode: 'car' | 'robot' | 'pieces' | null = null;
  private gun: THREE.Group | null = null;
  private barrels: THREE.Group | null = null;
  private barrelSpin = 0; // how fast the rotary's barrels are turning (rad/s)

  constructor(readonly body: Body, livery: Livery, rich: boolean, gunKind?: GunKind) {
    const kt = kit(body), mats = materials(livery, rich);
    this.kit = kt;
    this.k = kt.k;
    this.time = body.robot.shift ?? SHIFT_TIME;
    this.joints = skeleton(kt.joints);
    this.skeleton = this.joints.get('root')!;
    for (const [name, j] of this.joints) {
      this.rest.set(name, j.position.clone());
      this.folded.set(name, new THREE.Quaternion().setFromEuler(new THREE.Euler(...foldOf(name))));
    }
    for (const part of kt.parts) {
      const mesh = new THREE.Group();
      for (const m of part.meshes) {
        const piece = new THREE.Mesh(plainOf(m.geometry), typeof m.mat === 'string' ? mats[m.mat] : m.mat);
        piece.castShadow = true;
        piece.receiveShadow = true;
        mesh.add(piece);
      }
      mesh.matrixAutoUpdate = false;
      this.live.push({ part, mesh, joint: this.joints.get(part.robot.joint)!, frame: part.name.startsWith('frame'), fold: parts3(part.fold), robot: parts3(part.robot.local) });
      this.root.add(mesh);
    }
    const b = bake(kt), bones = new THREE.Skeleton(b.bones.map((n) => this.joints.get(n) as THREE.Bone), b.bones.map(() => new THREE.Matrix4()));
    const group = (list: Merged, skin: boolean) => {
      const g = new THREE.Group();
      for (const m of list) {
        const material = typeof m.key === 'string' ? mats[m.key] : m.key;
        const mesh = skin ? new THREE.SkinnedMesh(m.geometry, material) : new THREE.Mesh(m.geometry, material);
        if (mesh instanceof THREE.SkinnedMesh) {
          mesh.bindMode = THREE.DetachedBindMode; // (the bones are placed relative to the bot, not the world: the bot's own place still applies)
          mesh.bind(bones, new THREE.Matrix4());
          mesh.frustumCulled = false;
        }
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.key = m.key;
        g.add(mesh);
      }
      g.visible = false;
      this.root.add(g);
      return g;
    };
    this.asOne = group(b.car, false);
    this.skinned = group(b.robot, true);
    if (gunKind) {
      const g = gunParts(gunKind, this.k), mesh = ([geo, mat]: [THREE.BufferGeometry, MatName]) => {
        const m = new THREE.Mesh(geo, mats[mat]);
        m.castShadow = true;
        m.userData.key = mat;
        return m;
      };
      this.gun = new THREE.Group();
      this.gun.matrixAutoUpdate = false;
      this.barrels = new THREE.Group();
      for (const p of g.fixed) this.gun.add(mesh(p));
      for (const p of g.spinning) this.barrels.add(mesh(p));
      this.gun.add(this.barrels);
      this.root.add(this.gun);
    }
    this.update(0, still());
  }

  // Which way it's drawn: merged as a car, merged as a robot, or piece by piece while it changes
  private draw(mode: 'car' | 'robot' | 'pieces') {
    if (mode === this.mode) return;
    this.mode = mode;
    this.asOne.visible = mode === 'car';
    this.skinned.visible = mode === 'robot';
    for (const l of this.live) l.mesh.visible = mode === 'pieces' ? true : mode === 'car' ? !!l.part.wheel : false;
  }

  // Start changing: to a robot (1), back to a car (0), or the other one
  transform(to?: number) { this.target = to ?? (this.target > 0.5 ? 0 : 1); }
  get robot() { return this.shift > 0.999; }
  get car() { return this.shift < 0.001; }

  setMaterials(livery: Livery, rich: boolean) {
    const mats = materials(livery, rich);
    for (const l of this.live) l.mesh.children.forEach((c, i) => {
      const m = l.part.meshes[i].mat;
      if (typeof m === 'string') (c as THREE.Mesh).material = mats[m];
    });
    for (const g of [this.asOne, this.skinned, ...(this.gun ? [this.gun, this.barrels!] : [])]) for (const c of g.children) {
      const key = c.userData.key as MatName | THREE.Material;
      if (typeof key === 'string') (c as THREE.Mesh).material = mats[key];
    }
  }

  update(dt: number, pose: Pose) {
    this.t += dt;
    const step = dt / this.time;
    this.shift = this.target > this.shift ? Math.min(this.target, this.shift + step) : Math.max(this.target, this.shift - step);
    const s = this.shift;
    if (s <= 0) return this.asCar();
    // the robot's own pose, then each joint (and the whole body) eased back towards lying folded in the car
    this.animate(dt, pose);
    for (const [name, j] of this.joints) {
      const e = smoother(span(s, JOINT_TIME[name.split('.')[0]] ?? [0.2, 0.8]));
      if (name === 'root') {
        const f = this.kit.folded;
        j.position.lerpVectors(f.p, _p.set(0, 0, 0), e);
        j.quaternion.copy(_q3.copy(f.q).slerp(_q.identity(), e));
        j.scale.setScalar(f.s + (1 - f.s) * e);
      } else if (e < 1) {
        j.quaternion.copy(_q3.copy(this.folded.get(name)!).slerp(j.quaternion, e));
        j.position.lerpVectors(this.rest.get(name)!, _p.copy(j.position), e);
      }
    }
    this.skeleton.updateMatrixWorld(true);
    this.holdGun(dt, s, pose);
    if (s >= 1) { this.draw('robot'); return; } // (settled as a robot: the skinned meshes follow the joints)
    this.draw('pieces');
    // each panel rides its joint, lifts off a little as it comes loose, and slides into its place on the robot
    for (const l of this.live) {
      const e = l.frame ? 1 : lock(span(s, [0.04 + l.part.delay * 0.9, 0.5 + l.part.delay * 0.9]));
      const f = l.frame ? l.robot : l.fold;
      _p.lerpVectors(f.p, l.robot.p, e).addScaledVector(l.part.pop, Math.sin(Math.PI * Math.min(1, Math.max(0, e))));
      _q.copy(_q3.copy(f.q).slerp(l.robot.q, Math.min(1, Math.max(0, e))));
      _s.lerpVectors(f.s, l.robot.s, Math.min(1, Math.max(0, e)));
      if (l.frame) _s.multiplyScalar(0.8 + 0.2 * smoother(span(s, [0.2, 0.7])));
      _m.compose(_p, _q, _s).premultiply(l.joint.matrixWorld);
      if (l.part.wheel) _m.multiply(_m2.makeRotationX(this.spin)); // (rolling, about the axle)
      l.mesh.matrix.copy(_m);
      l.mesh.matrixWorldNeedsUpdate = true;
      l.mesh.visible = !l.frame || s > 0.02;
    }
  }

  // How many things it takes to draw it as it is now (for the performance check)
  get draws() {
    let n = 0;
    this.root.traverseVisible((o) => { if (o instanceof THREE.Mesh) n++; });
    return n;
  }

  // The gun in the right hand (it comes out as the robot stands up), its barrels spinning up as it fires
  private holdGun(dt: number, s: number, pose: Pose) {
    if (!this.gun) return;
    const out = smoother(span(s, [0.75, 1]));
    this.gun.visible = out > 0.01;
    if (!this.gun.visible) return;
    this.gun.matrix.copy(this.joints.get('hand.R')!.matrixWorld).multiply(_m2.makeScale(out, out, out));
    this.gun.matrixWorldNeedsUpdate = true;
    this.barrelSpin += ((pose.aim > 0.5 ? 40 : 0) - this.barrelSpin) * Math.min(1, dt * 4);
    this.barrels!.rotation.y += this.barrelSpin * dt;
  }

  // Just a car: every panel where it belongs, the wheels rolling and the front ones steering
  private asCar() {
    if (this.gun) this.gun.visible = false;
    this.draw('car');
    for (const l of this.live) {
      if (!l.part.wheel) continue; // (the rest is drawn merged)
      l.mesh.matrix.copy(l.part.car);
      if (l.part.wheel?.front) l.mesh.matrix.multiply(_m2.makeRotationY(this.steer * 0.45));
      if (l.part.wheel) l.mesh.matrix.multiply(_m2.makeRotationX(this.spin));
      l.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  // The robot's pose, worked out on its joints: standing, walking, aiming, punching, dodging
  private animate(dt: number, pose: Pose) {
    const J = (n: string) => this.joints.get(n)!, k = this.k;
    for (const [n, p] of this.rest) J(n).position.copy(p);
    for (const j of this.joints.values()) j.rotation.set(0, 0, 0);
    const speed = Math.hypot(pose.move.x, pose.move.z);
    this.walk += dt * (2.2 + speed * 1.1) * Math.min(1, speed);
    const w = Math.min(1, speed / 3), ph = this.walk, breathe = Math.sin(this.t * 1.7) * 0.012;
    const run = Math.min(1, Math.max(0, (speed - 8) / 6)); // (running: a longer stride and a lean into it)
    const stride = (0.55 + 0.35 * run) * w, sw = Math.sin(ph);
    // legs: swing from the hips, bend at the knees on the way through
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const s = sw * sign;
      J(`hip.${side}`).rotation.x = -s * stride - 0.08;
      J(`knee.${side}`).rotation.x = Math.max(0, Math.cos(ph + (sign > 0 ? 0 : Math.PI))) * 0.7 * w + 0.12;
      J(`ankle.${side}`).rotation.x = -0.04;
      J(`hip.${side}`).rotation.z = sign * 0.05;
      J(`shoulder.${side}`).rotation.x = s * stride * 0.6;
      J(`shoulder.${side}`).rotation.z = sign * (0.16 + breathe);
      J(`elbow.${side}`).rotation.x = -0.25 - w * 0.25;
    }
    J('hips').position.y -= k * (0.012 + Math.abs(Math.cos(ph)) * 0.018 * w);
    J('chest').rotation.x = 0.06 * w + breathe + 0.25 * run;
    J('hips').rotation.x = 0.12 * run;
    J('waist').rotation.y = sw * 0.1 * w;
    J('head').rotation.y = -sw * 0.06 * w;
    // aiming: the right arm comes up level, the body turns a little into it
    if (pose.aim > 0) {
      const a = pose.aim;
      J('shoulder.R').rotation.x = mix(J('shoulder.R').rotation.x, -1.45, a);
      J('shoulder.R').rotation.z = mix(J('shoulder.R').rotation.z, -0.05, a);
      J('elbow.R').rotation.x = mix(J('elbow.R').rotation.x, -0.12, a);
      J('waist').rotation.y += 0.18 * a;
      J('head').rotation.y -= 0.12 * a;
    }
    // a punch: wind back, then drive the arm straight out
    if (pose.punch > 0) {
      const side = pose.punchSide > 0 ? 'L' : 'R', p = pose.punch, out = p < 0.3 ? -p / 0.3 * 0.4 : Math.sin(((p - 0.3) / 0.7) * Math.PI);
      J(`shoulder.${side}`).rotation.x = -1.5 * Math.max(0, out) + 0.5 * Math.max(0, -out);
      J(`elbow.${side}`).rotation.x = -1.4 * (1 - Math.max(0, out));
      J('waist').rotation.y += (side === 'L' ? -1 : 1) * 0.35 * out;
    }
    // a dodge: a low, quick tuck
    if (pose.dodge > 0) {
      const d = Math.sin(pose.dodge * Math.PI);
      J('hips').position.y -= k * 0.12 * d;
      for (const side of ['L', 'R']) { J(`hip.${side}`).rotation.x -= 0.9 * d; J(`knee.${side}`).rotation.x += 1.5 * d; }
      J('chest').rotation.x += 0.4 * d;
    }
    if (pose.hit > 0) { J('chest').rotation.x -= 0.25 * pose.hit; J('head').rotation.x -= 0.2 * pose.hit; }
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// How far through its own window [from, to] of the change a joint or a panel is, 0..1
const span = (s: number, [a, b]: [number, number]) => Math.min(1, Math.max(0, (s - a) / (b - a)));
const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
// A panel sliding home: smooth, with a small overshoot as it locks into place
function lock(x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c = 0.7, u = x - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
