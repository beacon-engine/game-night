// The cars you can pick (cars.json), drawn with models from Kenney's Car Kit (CC0; see
// source/README.md). Every model in the kit shares one small colour palette image (16 columns by 4
// rows of colours); a model's paint is one of the colours in the second row. Each car gets its own
// copy of the palette with that square in its colour.
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
}
const DISPLAY_FONT = '"Big Shoulders Display", "Arial Narrow", sans-serif';

export async function loadCars(types: CarType[]): Promise<Map<string, CarModel>> {
  const loader = new GLTFLoader();
  const models = await Promise.all(types.map(async (type): Promise<CarModel> => {
    const { scene } = await loader.loadAsync(`models/${type.model}.glb`);
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const scale = type.length / size.z; // (the models face +z)
    return { type, scene, scale, width: size.x * scale, height: size.y * scale, paint: paintColumn(scene) };
  }));
  return new Map(models.map((m) => [m.type.id, m]));
}

// One car, ready to place: facing +x (the track code's forward), its wheels listed for spinning
export function carMesh(m: CarModel, color: string, number: number) {
  const g = new THREE.Group();
  const model = m.scene.clone(true);
  model.scale.setScalar(m.scale);
  model.rotation.y = Math.PI / 2;
  const wheels: { node: THREE.Object3D; sign: number }[] = [];
  model.traverse((o) => {
    const wheel = /^wheel/.test(o.name) || /^wheel/.test(o.parent?.name ?? '');
    if (/^wheel/.test(o.name)) wheels.push({ node: o, sign: new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion).x >= 0 ? 1 : -1 });
    if (o instanceof THREE.Mesh) {
      o.material = (o.material as THREE.MeshStandardMaterial).clone();
      if (!wheel) (o.material as THREE.MeshStandardMaterial).map = painted((o.material as THREE.MeshStandardMaterial).map!, m.paint, color);
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

  // a soft shadow underneath
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(m.type.length * 1.15, m.width * 1.35).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
    new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  shadow.userData.own = true;
  shadow.geometry.userData.own = true;
  g.add(shadow);

  g.userData.wheels = wheels;
  g.userData.wheelRadius = 0.3 * m.scale;
  return g;
}

// Spin the wheels by how far the car went
export function rollWheels(g: THREE.Object3D, metres: number) {
  const a = metres / (g.userData.wheelRadius as number);
  for (const w of g.userData.wheels as { node: THREE.Object3D; sign: number }[]) w.node.rotation.x += a * w.sign;
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

let blob: THREE.Texture | null = null;
function blobTexture() {
  if (blob) return blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return (blob = new THREE.CanvasTexture(c));
}
