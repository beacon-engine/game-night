// The cars you can pick (cars.json), drawn with models from Kenney's Car Kit (CC0; see
// source/README.md). Every model in the kit shares one small colour palette image (16 columns by 4
// rows of colours); a model's paint is one of the colours in the second row. Each car gets its own
// copy of the palette with that square in its colour. A second, tiny map says how each square is
// finished (glossy paint with a clear coat, dark glass, metal rims, rubber), and a third which of
// them are lights, so the cars catch the sky and the venue's lights like the real thing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CarType {
  id: string;
  name: string;
  model: string; // models/<model>.glb
  about: string;
  length: number; // m
  top: number; // the rest compared with the Stocker
  accel: number;
  grip: number;
  weight: number;
}

export interface CarModel {
  type: CarType;
  scene: THREE.Group;
  scale: number; // model units to metres
  width: number; // m
  height: number;
  paint: number; // which column of the palette's second row is its paint
  shadow: THREE.Texture; // its outline from above, softened
  rich: boolean; // clear-coated paint (skipped on slower screens)
}
const DISPLAY_FONT = '"Big Shoulders Display", "Arial Narrow", sans-serif';

export async function loadCars(types: CarType[], rich: boolean): Promise<Map<string, CarModel>> {
  const loader = new GLTFLoader();
  const models = await Promise.all(types.map(async (type): Promise<CarModel> => {
    const { scene } = await loader.loadAsync(`models/${type.model}.glb`);
    const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
    const scale = type.length / size.z; // (the models face +z)
    return { type, scene, scale, width: size.x * scale, height: size.y * scale, paint: paintColumn(scene), shadow: outline(scene, box), rich };
  }));
  return new Map(models.map((m) => [m.type.id, m]));
}

// One car, ready to place: facing +x (the track code's forward), its wheels listed for spinning
export function carMesh(m: CarModel, color: string, number: number) {
  const g = new THREE.Group();
  const model = m.scene.clone(true);
  model.scale.setScalar(m.scale);
  model.rotation.y = Math.PI / 2;
  const wheels: { node: THREE.Object3D; sign: number; front: boolean; turn: number }[] = [];
  model.traverse((o) => {
    const wheel = /^wheel/.test(o.name) || /^wheel/.test(o.parent?.name ?? '');
    if (/^wheel/.test(o.name)) {
      o.rotation.reorder('YXZ'); // (steer about the upright, then roll about the axle)
      wheels.push({ node: o, sign: new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion).x >= 0 ? 1 : -1, front: /front/.test(o.name), turn: o.rotation.y });
    }
    if (o instanceof THREE.Mesh) {
      const base = (o.material as THREE.MeshStandardMaterial).map!;
      o.material = finish(m, wheel ? base : painted(base, m.paint, color), wheel);
      o.userData.own = true;
    }
  });
  g.add(model);

  // the number on both doors
  const tex = numberTexture(number);
  const plate = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const w = m.type.length * 0.3, h = w / 2;
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plate);
    p.geometry.userData.own = true;
    p.position.set(-m.type.length * 0.04, m.height * 0.42, side * (m.width / 2 + 0.02));
    if (side < 0) p.rotation.y = Math.PI;
    p.userData.own = true;
    g.add(p);
  }

  // a soft shadow underneath, the car's own shape
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(m.type.length * SHADOW_PAD, m.width * SHADOW_PAD).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
    new THREE.MeshBasicMaterial({ map: m.shadow, color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false }));
  shadow.userData.own = true;
  shadow.geometry.userData.own = true;
  g.add(shadow);

  g.userData.wheels = wheels;
  g.userData.wheelRadius = 0.3 * m.scale;
  return g;
}

// How bright the lights are: off by day, on at dusk and at night
export function carLights(g: THREE.Object3D, level: number) {
  g.traverse((o) => { if (o instanceof THREE.Mesh && o.userData.own && 'emissiveIntensity' in o.material) o.material.emissiveIntensity = level; });
}

// Spin the wheels by how far the car went
export function rollWheels(g: THREE.Object3D, metres: number) {
  const a = metres / (g.userData.wheelRadius as number);
  for (const w of g.userData.wheels as { node: THREE.Object3D; sign: number }[]) w.node.rotation.x += a * w.sign;
}

// Turn the front wheels with the steering: -1 (left) .. 1 (right)
const LOCK = 0.45; // rad at full lock
export function steerWheels(g: THREE.Object3D, steer: number) {
  for (const w of g.userData.wheels as { node: THREE.Object3D; front: boolean; turn: number }[]) {
    if (w.front) w.node.rotation.y = w.turn - steer * LOCK;
  }
}

// Free what this car made for itself. (The models' geometry, and the painted palettes, are shared.)
export function disposeCar(g: THREE.Object3D) {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.own) return;
    const m = o.material as THREE.MeshStandardMaterial;
    if (m.map?.userData.own) m.map.dispose();
    m.dispose();
    if (o.geometry.userData.own) o.geometry.dispose();
  });
}

// The body's paint: the square of the palette's second row its faces use most
function paintColumn(scene: THREE.Object3D) {
  const count = new Array(16).fill(0);
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || /^wheel/.test(o.name)) return;
    const uv = o.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) if (Math.floor(uv.getY(i) * 4) === 1) count[Math.floor(uv.getX(i) * 16)]++;
  });
  return count.indexOf(Math.max(...count));
}

// The palette with the paint square in this colour, keeping its shading (cached per colour and square)
const paints = new Map<string, THREE.Texture>();
function painted(base: THREE.Texture, column: number, color: string) {
  const key = `${column}:${color.toLowerCase()}`;
  const hit = paints.get(key);
  if (hit) return hit;
  const img = base.image as HTMLImageElement | ImageBitmap;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const w = c.width / 16, h = c.height / 4, x = column * w, y = h; // (the second row)
  const px = g.getImageData(x, y, w, h), d = px.data, tint = new THREE.Color(color);
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const shade = 0.55 + 0.7 * l;
    d[i] = Math.min(255, tint.r * 255 * shade);
    d[i + 1] = Math.min(255, tint.g * 255 * shade);
    d[i + 2] = Math.min(255, tint.b * 255 * shade);
  }
  g.putImageData(px, x, y);
  const t = new THREE.CanvasTexture(c);
  t.flipY = base.flipY;
  t.colorSpace = base.colorSpace;
  t.magFilter = base.magFilter;
  t.minFilter = base.minFilter;
  paints.set(key, t);
  return t;
}

// The car's number: light with a dark outline, readable on any paint
function numberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = `900 118px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  g.strokeStyle = '#0e1016';
  g.strokeText(String(n), 128, 70);
  g.fillStyle = '#f3f0e8';
  g.fillText(String(n), 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.own = true;
  return t;
}

// --- the finish ---------------------------------------------------------------------------------
// How each square of the palette is finished, as [clear coat, roughness, metalness] (the red, green
// and blue the materials read them from). Squares are "row,column"; anything else is satin plastic.
type Finish = [number, number, number];
const PAINT: Finish = [1, 0.3, 0.15];
const BODY: Record<string, Finish> = {
  '3,1': [1, 0.04, 0.6], // the windows
  '2,7': [0, 0.55, 0.05], // the lower body and bumpers
  '2,5': [0, 0.8, 0], // the grille and the underneath
  '2,13': [1, 0.1, 0], '3,3': [1, 0.1, 0], '3,5': [1, 0.1, 0], // the lights
};
const WHEEL: Record<string, Finish> = {
  '2,5': [0, 0.92, 0], // the tyres
  '2,7': [0, 0.22, 0.9], '2,11': [0, 0.22, 0.9], '1,9': [0.6, 0.28, 0.7], // the rims
};
const PLASTIC: Finish = [0, 0.7, 0];
// what glows when the lights are on: headlights, indicators, tail lights
const LIGHTS: Record<string, string> = { '2,13': '#fff1d6', '3,3': '#ffb02e', '3,5': '#ff2a1a' };

const palettes = new Map<string, THREE.Texture>();
function palette(key: string, cell: (row: number, col: number) => [number, number, number], color = false) {
  const hit = palettes.get(key);
  if (hit) return hit;
  const data = new Uint8Array(16 * 4 * 4);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 16; col++) {
    const [r, g, b] = cell(row, col);
    data.set([r * 255, g * 255, b * 255, 255], (row * 16 + col) * 4);
  }
  const t = new THREE.DataTexture(data, 16, 4); // (row 0 is the top of the palette, as the models' UVs have it)
  t.magFilter = t.minFilter = THREE.NearestFilter;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  palettes.set(key, t);
  return t;
}

function finish(m: CarModel, map: THREE.Texture, wheel: boolean) {
  const table = wheel ? WHEEL : BODY;
  const finishes = palette(`${wheel ? 'wheel' : `body${m.paint}`}`, (row, col) =>
    !wheel && row === 1 && col === m.paint ? PAINT : table[`${row},${col}`] ?? PLASTIC);
  const lights = palette('lights', (row, col) => {
    const c = LIGHTS[`${row},${col}`];
    return c ? new THREE.Color(c).toArray() as [number, number, number] : [0, 0, 0];
  }, true);
  const o: THREE.MeshPhysicalMaterialParameters = {
    map, roughnessMap: finishes, metalnessMap: finishes, roughness: 1, metalness: 1,
    emissive: wheel ? 0x000000 : 0xffffff, emissiveMap: wheel ? null : lights, emissiveIntensity: 0, // (wheels have no lights)
  };
  return m.rich ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: 1, clearcoatMap: finishes, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial(o);
}

// The car's outline from above, drawn once, softened: its shadow
const SHADOW_PAD = 1.3; // the shadow's square is this much bigger than the car, for the blur
function outline(scene: THREE.Object3D, box: THREE.Box3) {
  const W = 128, H = 64, c = document.createElement('canvas'), soft = document.createElement('canvas');
  c.width = soft.width = W;
  c.height = soft.height = H;
  const g = c.getContext('2d')!, size = box.getSize(new THREE.Vector3());
  // along the car (z) across the canvas, across it (x) down it, inside the padding
  const u = (z: number) => (W * (1 - 1 / SHADOW_PAD)) / 2 + ((z - box.min.z) / size.z) * (W / SHADOW_PAD);
  const v = (x: number) => (H * (1 - 1 / SHADOW_PAD)) / 2 + ((box.max.x - x) / size.x) * (H / SHADOW_PAD);
  g.fillStyle = '#fff';
  scene.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute, index = o.geometry.index;
    const n = index ? index.count : pos.count, at = (i: number) => p.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
    g.beginPath();
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) { at(i + k); k ? g.lineTo(u(p.z), v(p.x)) : g.moveTo(u(p.z), v(p.x)); }
      g.closePath();
    }
    g.fill();
  });
  const s = soft.getContext('2d')!;
  s.filter = 'blur(5px)';
  s.globalAlpha = 0.55;
  s.drawImage(c, 0, 0);
  s.filter = 'blur(1.5px)';
  s.globalAlpha = 0.6;
  s.drawImage(c, 0, 0);
  return new THREE.CanvasTexture(soft);
}
