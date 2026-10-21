// The 3D world: the rooftops and the rail line built from the course's numbers (course.ts), the
// city around them going from dusk to night, the runners and their trails, and the security drone.
// One camera for everyone (see the README): it sits behind the runner at the back and keeps the
// leader in shot. Everything on the course is drawn with a few instanced meshes, refilled each frame
// from what's in view, so it runs on a TV.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ALL, CAR_TOP, LANE_W, ZIP_Y, type Ground, type Piece, type PieceKind, type Power } from './course.ts';
import type { Run, Runner } from './run.ts';
import { canvas, DISPLAY_FONT, seeded, texture } from './draw.ts';

const AHEAD = 190; // m of course drawn in front of the camera
const BEHIND = 12;
const NIGHT_AFTER = 1600; // m: dusk has turned to night by here
const COURSE_W = 11; // the width of a roof or the rail deck

// Dusk and night, mixed by how far the leader has got
const DUSK = { top: 0x2a2f63, bottom: 0xf08a5a, fog: 0x8e5a63, hemi: 1.5, sun: 2.2, sunColor: 0xffa66a, windows: 0.5 };
const NIGHT = { top: 0x03050c, bottom: 0x1b2340, fog: 0x0c1020, hemi: 1.0, sun: 0.9, sunColor: 0xa8b8ff, windows: 1.4 };

export const POWER_COLOR: Record<Power, string> = { magnet: '#ff5a5a', boots: '#3ddc84', shield: '#3fb7ff', double: '#d7ff3b' };

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  private hemi = new THREE.HemisphereLight(0xffe0c8, 0x1a1c2a, 1.5);
  private sun = new THREE.DirectionalLight(0xffa66a, 2.2);
  private fill = new THREE.DirectionalLight(0xbfd0ff, 1.1); // from behind the camera: we see the runners' backs, and the sun's in front
  private sky: Sky;
  private city: City;
  private stage = new Stage();
  private bits: Bits;
  private people = new Map<Runner, Figure>();
  private drone = new Drone();
  private camS = 0;
  private camX = 0;
  private camY = 4.5;
  private extras: THREE.Object3D[] = []; // what goes first when the screen struggles

  constructor(canvasEl: HTMLCanvasElement, tv: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: !tv, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, tv ? 1 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.fog = new THREE.Fog(DUSK.fog, 60, 420);
    this.sun.position.set(-60, 40, -120);
    this.sky = new Sky();
    this.city = new City();
    this.bits = new Bits();
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target, this.sky.mesh, this.city.group, this.stage.group, this.bits.group, this.drone.group);
    this.extras.push(this.city.far);
  }

  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else for (const o of this.extras) o.visible = false;
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
  }

  // A new run: the runners' figures, and the course from the start
  setRun(run: Run) {
    for (const f of this.people.values()) { this.scene.remove(f.group, f.trail.mesh); f.dispose(); }
    this.people.clear();
    for (const r of run.runners) {
      const f = new Figure(r);
      this.people.set(r, f);
      this.scene.add(f.group, f.trail.mesh);
    }
    this.stage.clear();
    this.camS = run.leader.s;
    this.camX = 0;
  }

  // Where a runner is on the screen, as fractions (for the labels over their heads)
  screenOf(r: Runner) {
    const f = this.people.get(r);
    if (!f) return null;
    const p = f.group.position.clone();
    p.y += 2.3;
    p.project(this.camera);
    return p.z < 1 ? { x: (p.x + 1) / 2, y: (1 - p.y) / 2 } : null;
  }

  render(run: Run, dt: number, now: number) {
    const lead = run.leader, alive = run.alive;
    // the camera: behind whoever's at the back, keeping the leader in shot
    let rear = lead.s, mid = 0, top = 0;
    for (const r of alive) { rear = Math.min(rear, r.s); mid += r.x; top = Math.max(top, r.y); }
    mid = alive.length ? mid / alive.length : lead.x;
    const spread = lead.s - rear;
    const wantS = rear - 7.5 - spread * 0.2;
    this.camS = Math.abs(wantS - this.camS) > 30 ? wantS : this.camS + (wantS - this.camS) * Math.min(1, 6 * dt);
    this.camX += (mid * 0.55 - this.camX) * Math.min(1, 4 * dt);
    this.camY += (4.3 + spread * 0.18 + Math.max(0, top - 1) * 0.6 - this.camY) * Math.min(1, 3 * dt);
    const cam = this.camera;
    cam.position.set(this.camX, this.camY, -this.camS);
    cam.lookAt(this.camX * 0.5, 1.2 + top * 0.3, -(this.camS + 22 + spread * 0.5));

    // dusk to night
    const night = Math.min(1, Math.max(0, lead.s / NIGHT_AFTER));
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(DUSK.fog).lerp(TMP_COLOR.setHex(NIGHT.fog), night);
    this.hemi.intensity = THREE.MathUtils.lerp(DUSK.hemi, NIGHT.hemi, night);
    this.sun.intensity = THREE.MathUtils.lerp(DUSK.sun, NIGHT.sun, night);
    this.sun.color.setHex(DUSK.sunColor).lerp(TMP_COLOR.setHex(NIGHT.sunColor), night);
    this.sun.position.set(-60, 40, -this.camS - 120);
    this.sun.target.position.set(0, 0, -this.camS);
    this.fill.position.set(8, 14, -this.camS + 20);
    this.fill.target.position.set(0, 0, -this.camS - 10);
    this.sky.update(night, cam.position);
    this.city.update(this.camS, night);
    this.stage.update(run.course.grounds, this.camS, night);
    this.bits.update(run, this.camS, now);

    for (const [r, f] of this.people) f.update(r, run, dt);
    this.drone.update(run, dt, now);
    this.renderer.render(this.scene, cam);
  }
}

const TMP_COLOR = new THREE.Color();
const TMP = new THREE.Object3D();

// --- the sky: a gradient on a big sphere, around the camera ------------------------------------------
class Sky {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(DUSK.top) }, bottom: { value: new THREE.Color(DUSK.bottom) }, night: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float night; varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.7));
          vec3 cell = floor(vDir * 260.0);
          float star = step(0.9975, hash(cell)) * smoothstep(0.15, 0.5, vDir.y) * night;
          gl_FragColor = vec4(c + star * 0.9, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.mat);
    this.mesh.renderOrder = -1;
  }

  update(night: number, at: THREE.Vector3) {
    this.mat.uniforms.top.value.setHex(DUSK.top).lerp(TMP_COLOR.setHex(NIGHT.top), night);
    this.mat.uniforms.bottom.value.setHex(DUSK.bottom).lerp(TMP_COLOR.setHex(NIGHT.bottom), night);
    this.mat.uniforms.night.value = night;
    this.mesh.position.copy(at);
  }
}

// --- the city around the course: towers either side, recycled as the camera moves -----------------------
// (each tower has a fixed place in a repeating block of the city, so nothing is made up per frame)
class City {
  group = new THREE.Group();
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  private nearSpots: { x: number; z: number; w: number; d: number; h: number }[] = [];
  private farSpots: { x: number; z: number; w: number; d: number; h: number }[] = [];
  private windows: THREE.MeshLambertMaterial;
  private static BLOCK = 600; // m of city before it repeats

  constructor() {
    const rnd = seeded(41);
    const { map, glow } = windowTextures();
    this.windows = new THREE.MeshLambertMaterial({ map, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: DUSK.windows });
    const box = new THREE.BoxGeometry(1, 1, 1); // (the window texture stretches with each tower: a little variety)
    for (let z = 0; z < City.BLOCK; z += 14 + rnd() * 10) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const w = 9 + rnd() * 12;
        this.nearSpots.push({ x: side * (COURSE_W / 2 + 9 + w / 2 + rnd() * 10), z, w, d: 10 + rnd() * 10, h: -8 + rnd() * 34 });
      }
    }
    for (let z = 0; z < City.BLOCK; z += 22 + rnd() * 18) {
      for (const side of [-1, 1]) {
        const w = 18 + rnd() * 26;
        this.farSpots.push({ x: side * (70 + rnd() * 160), z, w, d: 18 + rnd() * 20, h: 30 + rnd() * 120 });
      }
    }
    this.near = new THREE.InstancedMesh(box, this.windows, this.nearSpots.length * 2);
    this.far = new THREE.InstancedMesh(box, this.windows, this.farSpots.length * 2);
    for (const m of [this.near, this.far]) { m.frustumCulled = false; this.group.add(m); }
  }

  update(camS: number, night: number) {
    this.windows.emissiveIntensity = THREE.MathUtils.lerp(DUSK.windows, NIGHT.windows, night);
    const B = City.BLOCK, base = Math.floor(camS / B) * B;
    const fill = (m: THREE.InstancedMesh, spots: typeof this.nearSpots) => {
      let n = 0;
      for (const k of [0, B]) for (const s of spots) {
        const at = base + k + s.z;
        if (at < camS - 40 || at > camS + B - 40) continue;
        TMP.position.set(s.x, s.h / 2 - 60 / 2, -at);
        TMP.scale.set(s.w, s.h + 60, s.d);
        TMP.updateMatrix();
        m.setMatrixAt(n++, TMP.matrix);
      }
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    };
    fill(this.near, this.nearSpots);
    fill(this.far, this.farSpots);
  }
}

function windowTextures() {
  const W = 128, H = 256, rnd = seeded(7);
  const c = canvas(W, H), g = c.getContext('2d')!;
  const e = canvas(W, H), ge = e.getContext('2d')!;
  g.fillStyle = '#20232f';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let y = 4; y < H; y += 12) for (let x = 4; x < W; x += 10) {
    const lit = rnd() < 0.38;
    g.fillStyle = lit ? '#3a3a40' : '#151821';
    g.fillRect(x, y, 6, 7);
    if (lit) {
      ge.fillStyle = rnd() < 0.8 ? `hsl(${35 + rnd() * 15}, 90%, ${55 + rnd() * 20}%)` : `hsl(${190 + rnd() * 30}, 80%, 70%)`;
      ge.fillRect(x, y, 6, 7);
    }
  }
  const map = texture(c), glow = texture(e);
  map.repeat.set(2, 3);
  glow.repeat.set(2, 3);
  return { map, glow };
}

// --- the course's buildings and the rail line: one group per stretch, made when it comes into view -------
class Stage {
  group = new THREE.Group();
  private built = new Map<Ground, THREE.Group>();
  private mats = stageMaterials();

  clear() {
    for (const g of this.built.values()) this.drop(g);
    this.built.clear();
  }

  update(grounds: Ground[], camS: number, night: number) {
    this.mats.neon.emissiveIntensity = 0.6 + night * 1.6;
    for (const [g, obj] of this.built) if (g.s1 < camS - BEHIND - 20 || !grounds.includes(g)) { this.drop(obj); this.built.delete(g); }
    for (const g of grounds) {
      if (g.s0 > camS + AHEAD || g.s1 < camS - BEHIND || this.built.has(g) || g.kind === 'gap') continue;
      const obj = g.kind === 'roof' ? this.roof(g) : this.rail(g);
      this.built.set(g, obj);
      this.group.add(obj);
    }
  }

  private drop(obj: THREE.Group) {
    this.group.remove(obj);
    obj.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  // A building: its roof, the low wall round it, and some clutter at the sides
  private roof(g: Ground) {
    const out = new THREE.Group(), len = g.s1 - g.s0, rnd = seeded(Math.floor(g.s0 * 7) + 3), m = this.mats;
    const z = -(g.s0 + len / 2);
    out.add(placed(tiledBox(COURSE_W, 0.5, len, 3), m.roof, 0, -0.25, z));
    out.add(placed(tiledBox(COURSE_W - 0.4, g.depth, len - 0.4, 6), m.wall, 0, -0.5 - g.depth / 2, z));
    const parapets = [-1, 1].map((side) => new THREE.BoxGeometry(0.35, 0.7, len).translate(side * (COURSE_W / 2 - 0.17), 0.35, z));
    parapets.push(new THREE.BoxGeometry(COURSE_W, 0.7, 0.35).translate(0, 0.35, -g.s0 - 0.17), new THREE.BoxGeometry(COURSE_W, 0.7, 0.35).translate(0, 0.35, -g.s1 + 0.17));
    out.add(new THREE.Mesh(mergeGeometries(parapets), m.trim));
    // outside the lanes: air units, a water tank, an aerial, a neon sign
    const clutter: THREE.BufferGeometry[] = [], neon: THREE.BufferGeometry[] = [];
    for (let s = g.s0 + 4; s < g.s1 - 4; s += 6 + rnd() * 10) {
      const side = rnd() < 0.5 ? -1 : 1, x = side * (COURSE_W / 2 + 0.2), kind = rnd();
      if (kind < 0.5) clutter.push(new THREE.BoxGeometry(1.4, 1.1, 1.8).translate(x + side * 0.8, 0.55, -s));
      else if (kind < 0.7) clutter.push(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 10).translate(x + side * 1.4, 3.4, -s), ...[0, 1, 2, 3].map((i) =>
        new THREE.BoxGeometry(0.15, 2.2, 0.15).translate(x + side * 1.4 + (i % 2 ? 0.8 : -0.8), 1.1, -s + (i < 2 ? 0.8 : -0.8))));
      else if (kind < 0.85) clutter.push(new THREE.CylinderGeometry(0.06, 0.08, 6, 4).translate(x + side * 0.5, 3, -s));
      else neon.push(new THREE.BoxGeometry(0.2, 1.2, 4.5).translate(x + side * 0.6, 1.4, -s));
    }
    if (clutter.length) out.add(new THREE.Mesh(mergeGeometries(clutter), m.metal));
    if (neon.length) out.add(new THREE.Mesh(mergeGeometries(neon), m.neon));
    return out;
  }

  // The rail line: a concrete deck on pillars, three tracks, posts for the wires
  private rail(g: Ground) {
    const out = new THREE.Group(), len = g.s1 - g.s0, m = this.mats, z = -(g.s0 + len / 2);
    out.add(placed(tiledBox(COURSE_W, 1.4, len, 4), m.deck, 0, -0.7, z));
    const steel: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [];
    for (const lane of [-1, 0, 1]) for (const side of [-1, 1]) steel.push(new THREE.BoxGeometry(0.09, 0.16, len).translate(lane * LANE_W + side * 0.72, 0.08, z));
    for (let s = g.s0 + 1; s < g.s1; s += 1.6) wood.push(new THREE.BoxGeometry(COURSE_W - 1, 0.1, 0.35).translate(0, 0.02, -s));
    for (let s = g.s0 + 8; s < g.s1; s += 24) {
      for (const side of [-1, 1]) {
        steel.push(new THREE.BoxGeometry(0.2, 6.4, 0.2).translate(side * (COURSE_W / 2 - 0.2), 3.2, -s));
        wood.push(new THREE.BoxGeometry(1.6, 40, 1.6).translate(side * 3.6, -21, -s)); // (pillars, in the same grey)
      }
      steel.push(new THREE.BoxGeometry(COURSE_W - 0.4, 0.16, 0.16).translate(0, 6.3, -s));
    }
    out.add(new THREE.Mesh(mergeGeometries(steel), m.metal), new THREE.Mesh(mergeGeometries(wood), m.trim));
    return out;
  }
}

function stageMaterials() {
  const rnd = seeded(11);
  const gravel = canvas(64, 64), g = gravel.getContext('2d')!;
  g.fillStyle = '#4a4d57';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) { const v = 60 + rnd() * 40; g.fillStyle = `rgb(${v},${v},${v + 6})`; g.fillRect(rnd() * 64, rnd() * 64, 2, 2); }
  const deck = canvas(64, 64), d = deck.getContext('2d')!;
  d.fillStyle = '#5c5e66';
  d.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 300; i++) { const v = 75 + rnd() * 30; d.fillStyle = `rgb(${v},${v},${v})`; d.fillRect(rnd() * 64, rnd() * 64, 2, 2); }
  const { map, glow } = windowTextures();
  return {
    roof: new THREE.MeshLambertMaterial({ map: texture(gravel) }),
    deck: new THREE.MeshLambertMaterial({ map: texture(deck) }),
    wall: new THREE.MeshLambertMaterial({ map, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: 0.8 }),
    trim: new THREE.MeshLambertMaterial({ color: 0x6d7180 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x8a90a0 }),
    neon: new THREE.MeshLambertMaterial({ color: 0x220a2a, emissive: 0xff3fd2, emissiveIntensity: 1 }),
  };
}

// A box whose uvs are in units of `tile` metres, so a texture repeats at the same size on any box
function tiledBox(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv as THREE.BufferAttribute;
  // faces in order: +x, -x, +y, -y, +z, -z; four corners each
  const size = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * size[f][0]) / tile, (uv.getY(k) * size[f][1]) / tile);
  }
  return g;
}

function placed(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// --- the things on the course: one instanced mesh per kind, refilled from what's in view -----------------
type Slot = 'low' | 'pipe' | 'sign' | 'block' | 'car' | 'carFront' | 'ramp' | 'beam' | 'cable' | 'post' | 'coin' | 'power';

class Bits {
  group = new THREE.Group();
  private meshes: Record<Slot, THREE.InstancedMesh>;
  private counts = {} as Record<Slot, number>;
  private lamps: THREE.Sprite[] = []; // headlights on oncoming trains

  constructor() {
    const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
    const tex = bitTextures();
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, max: number) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
      return m;
    };
    // a unit box sitting on the ground, so scale.y is its height
    const unit = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const wedge = new THREE.BufferGeometry();
    // a ramp: up from nothing at its near end (+z) to full height at its far end (-z)
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, // slope
      -0.5, 0, 0.5, -0.5, 1, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, // sides
    ], 3));
    wedge.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 4, 0, 0, 1, 4, 0, 4, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 1], 2));
    wedge.computeVertexNormals();
    this.meshes = {
      low: make(unit(), lambert({ map: tex.stripes }), 64),
      pipe: make(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2), lambert({ color: 0xc9a227 }), 48),
      sign: make(unit(), lambert({ map: tex.sign, emissiveMap: tex.sign, emissive: 0xffffff, emissiveIntensity: 0.9 }), 16),
      block: make(unit(), lambert({ map: tex.vent }), 64),
      car: make(unit(), lambert({ map: tex.car }), 64),
      carFront: make(new THREE.BoxGeometry(1, 1, 0.05).translate(0, 0.5, 0), lambert({ map: tex.front, emissiveMap: tex.frontGlow, emissive: 0xffffff }), 32),
      ramp: make(wedge, lambert({ map: tex.stripes, side: THREE.DoubleSide }), 16),
      beam: make(unit(), lambert({ color: 0xd04a2a }), 8),
      cable: make(new THREE.CylinderGeometry(0.04, 0.04, 1, 4).rotateX(Math.PI / 2), lambert({ color: 0x222222 }), 8),
      post: make(new THREE.CylinderGeometry(0.1, 0.12, 1, 6).translate(0, 0.5, 0), lambert({ color: 0x8a90a0 }), 16),
      coin: make(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 14).rotateX(Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4300 }), 256),
      power: make(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshLambertMaterial({ emissive: 0x333333 }), 16),
    };
    const glow = new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff2c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(glow);
      s.scale.setScalar(2.6);
      s.visible = false;
      this.lamps.push(s);
      this.group.add(s);
    }
  }

  update(run: Run, camS: number, now: number) {
    const c = run.course, t = run.t;
    for (const k of Object.keys(this.meshes) as Slot[]) this.counts[k] = 0;
    for (let i = c.firstNear(camS - BEHIND); i < c.pieces.length; i++) {
      const p = c.pieces[i];
      if (p.s0 > camS + AHEAD) break;
      if (p.s1 < camS - BEHIND || p.taken) continue;
      this.piece(p, 0, now);
    }
    let lamp = 0;
    for (const p of c.movers) {
      const off = c.offset(p, t);
      if (p.s1 - off < camS - BEHIND || p.s0 - off > camS + AHEAD) continue;
      this.piece(p, off, now);
      if (p.look === 1 && lamp < this.lamps.length - 1) {
        for (const side of [-1, 1]) {
          const l = this.lamps[lamp++];
          l.visible = true;
          l.position.set(p.lane * LANE_W + side * 0.7, 0.9, -(p.s0 - off) + 0.2);
        }
      }
    }
    for (let i = lamp; i < this.lamps.length; i++) this.lamps[i].visible = false;
    for (const k of Object.keys(this.meshes) as Slot[]) {
      const m = this.meshes[k];
      m.count = this.counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private put(slot: Slot, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0, rotX = 0) {
    const m = this.meshes[slot], n = this.counts[slot];
    if (n >= m.instanceMatrix.count) return;
    TMP.position.set(x, y, z);
    TMP.rotation.set(rotX, rotY, 0);
    TMP.scale.set(sx, sy, sz);
    TMP.updateMatrix();
    m.setMatrixAt(n, TMP.matrix);
    this.counts[slot] = n + 1;
  }

  private piece(p: Piece, off: number, now: number) {
    const x = p.lane === ALL ? 0 : p.lane * LANE_W, len = p.s1 - p.s0, z = -(p.s0 - off + len / 2);
    switch (p.kind as PieceKind) {
      case 'low': return this.put('low', x, p.y0, z, 2, p.y1 - p.y0, len);
      case 'bar':
        if (p.lane === ALL) {
          // a sign on two legs, right across
          this.put('sign', 0, p.y0 + 0.15, z, COURSE_W - 1.2, p.y1 - p.y0 - 0.15, len * 0.5);
          for (const side of [-1, 1]) this.put('post', side * (COURSE_W / 2 - 0.4), 0, z, 1, p.y1, 1);
          return;
        }
        this.put('pipe', x, (p.y0 + p.y1) / 2, z, 2.3, p.y1 - p.y0, 0.6);
        for (const side of [-1, 1]) this.put('post', x + side * 1.15, 0, z, 1, p.y1, 1);
        return;
      case 'block': return this.put('block', x, 0, z, 1.9, p.y1, len);
      case 'car':
        this.put('car', x, 0, z, 2.1, CAR_TOP, len);
        if (p.move && p.look === 1) this.put('carFront', x, 0, -(p.s0 - off) + 0.03, 2.1, CAR_TOP, 1);
        return;
      case 'ramp': return this.put('ramp', x, 0, z, 2, CAR_TOP, len);
      case 'beam': return this.put('beam', x, p.y0, z, 0.5, p.y1 - p.y0, len);
      case 'zip':
        this.put('cable', x, ZIP_Y, z, 1, 1, len);
        for (const end of [p.s0, p.s1]) this.put('post', x + 1.2, 0, -end, 1, ZIP_Y + 0.3, 1);
        return;
      case 'coin': return this.put('coin', x, (p.y0 + p.y1) / 2, z, 1, 1, 1, now * 0.004 + p.s0 * 0.3);
      case 'power': {
        const n = this.counts.power;
        this.put('power', x, (p.y0 + p.y1) / 2 + Math.sin(now * 0.004) * 0.15, z, 1, 1, 1, now * 0.002, now * 0.0013);
        this.meshes.power.setColorAt(n, TMP_COLOR.set(POWER_COLOR[p.power!]));
      }
    }
  }
}

function bitTextures() {
  const stripes = canvas(64, 64), s = stripes.getContext('2d')!;
  s.fillStyle = '#16181f';
  s.fillRect(0, 0, 64, 64);
  s.fillStyle = '#d7ff3b';
  for (let i = -64; i < 128; i += 22) { s.beginPath(); s.moveTo(i, 64); s.lineTo(i + 11, 64); s.lineTo(i + 75, 0); s.lineTo(i + 64, 0); s.fill(); }
  const vent = canvas(64, 64), v = vent.getContext('2d')!;
  v.fillStyle = '#7d8494';
  v.fillRect(0, 0, 64, 64);
  v.fillStyle = '#3d424e';
  for (let y = 8; y < 60; y += 7) v.fillRect(6, y, 52, 3);
  // made-up signs, nobody's brand
  const sign = canvas(512, 128), g = sign.getContext('2d')!;
  g.fillStyle = '#12061f';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#ff3fd2';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#fff3d6';
  g.font = `900 72px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NIGHT NOODLES', 256, 68);
  const car = canvas(128, 64), cg = car.getContext('2d')!;
  cg.fillStyle = '#c9ccd4';
  cg.fillRect(0, 0, 128, 64);
  cg.fillStyle = '#2a6df4';
  cg.fillRect(0, 40, 128, 8);
  cg.fillStyle = '#1a2030';
  for (let x = 6; x < 128; x += 20) cg.fillRect(x, 14, 14, 18);
  const front = canvas(64, 64), fg = front.getContext('2d')!;
  fg.fillStyle = '#c9ccd4';
  fg.fillRect(0, 0, 64, 64);
  fg.fillStyle = '#1a2030';
  fg.fillRect(8, 10, 48, 22);
  fg.fillStyle = '#ffe9a8';
  fg.fillRect(6, 44, 10, 8);
  fg.fillRect(48, 44, 10, 8);
  const frontGlow = canvas(64, 64), gg = frontGlow.getContext('2d')!;
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, 64, 64);
  gg.fillStyle = '#ffe9a8';
  gg.fillRect(6, 44, 10, 8);
  gg.fillRect(48, 44, 10, 8);
  const glow = canvas(64, 64), lg = glow.getContext('2d')!;
  const grad = lg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  lg.fillStyle = grad;
  lg.fillRect(0, 0, 64, 64);
  const tex = (c: HTMLCanvasElement, repeat = true) => texture(c, repeat);
  return { stripes: tex(stripes), vent: tex(vent), sign: tex(sign, false), car: tex(car), front: tex(front, false), frontGlow: tex(frontGlow, false), glow: tex(glow, false) };
}

// --- a runner: a figure in a helmet, its trail, its shadow ---------------------------------------------
class Figure {
  group = new THREE.Group();
  trail: Trail;
  private body = new THREE.Group(); // leans for a slide, tumbles in a crash
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private shadow: THREE.Mesh;
  private shield: THREE.Mesh;
  private mats: THREE.Material[] = [];
  private tumble = 0;

  constructor(r: Runner) {
    const suit = new THREE.MeshLambertMaterial({ color: r.spec.outfit });
    const dark = new THREE.MeshLambertMaterial({ color: 0x15171d });
    const accent = new THREE.MeshLambertMaterial({ color: r.spec.color, emissive: r.spec.color, emissiveIntensity: 0.5 });
    const visor = new THREE.MeshLambertMaterial({ color: 0x0a0c12, emissive: 0x3fb7ff, emissiveIntensity: 0.35 });
    this.mats.push(suit, dark, accent, visor);
    const box = (w: number, h: number, d: number, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, y, 0), mat);
      return m;
    };
    this.body.add(box(0.5, 0.62, 0.28, suit, 1.18), box(0.52, 0.08, 0.3, accent, 1.0), box(0.36, 0.2, 0.2, dark, 1.32).translateZ(0.18));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), suit);
    head.position.y = 1.64;
    const face = box(0.3, 0.12, 0.08, visor, 1.66);
    face.position.z = -0.17;
    this.body.add(head, face);
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0.86, 0);
      hip.add(box(0.17, 0.82, 0.2, suit, -0.41), box(0.18, 0.12, 0.3, accent, -0.82).translateZ(-0.04));
      this.legs.push(hip);
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.33, 1.42, 0);
      shoulder.add(box(0.13, 0.6, 0.14, suit, -0.3));
      this.arms.push(shoulder);
      this.body.add(hip, shoulder);
    }
    this.group.add(this.body);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x3fb7ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shield.position.y = 0.95;
    this.mats.push(this.shadow.material as THREE.Material, this.shield.material as THREE.Material);
    this.group.add(this.shield);
    this.trail = new Trail(r.spec.trail);
  }

  update(r: Runner, run: Run, dt: number) {
    const g = this.group;
    g.position.set(r.x, r.y, -r.s);
    const leg = Math.sin(r.stride * 1.15), arms = this.arms, legs = this.legs;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    if (r.out === 'crashed' || r.out === 'caught') {
      this.tumble = Math.min(1, this.tumble + dt * 3);
      this.body.rotation.x = this.tumble * 1.5;
      this.body.position.y = r.out === 'caught' ? this.tumble * 2.5 : 0;
    } else {
      this.tumble = 0;
    }
    if (r.zip) {
      arms.forEach((a) => (a.rotation.x = Math.PI));
      legs.forEach((l, i) => (l.rotation.x = 0.3 + (i ? 0.2 : -0.2)));
    } else if (r.slide > 0) {
      this.body.rotation.x = -1.05;
      this.body.position.y = -0.25;
      arms.forEach((a) => (a.rotation.x = -0.6));
      legs.forEach((l, i) => (l.rotation.x = 1.0 + i * 0.25));
    } else if (!r.grounded) {
      arms.forEach((a, i) => (a.rotation.x = i ? -1.2 : 0.9));
      legs.forEach((l, i) => (l.rotation.x = i ? 1.1 : -0.6));
    } else if (!r.out) {
      legs.forEach((l, i) => (l.rotation.x = leg * 0.9 * (i ? -1 : 1)));
      arms.forEach((a, i) => (a.rotation.x = leg * 0.8 * (i ? 1 : -1)));
    }
    // leaning into a lane change
    this.body.rotation.z = (r.lane * LANE_W - r.x) * -0.12;
    this.shield.visible = r.powers.shield > 0 && !r.out;
    const floor = r.out ? -Infinity : run.floor(r);
    this.shadow.visible = Number.isFinite(floor) && r.y - floor < 4;
    if (this.shadow.visible) {
      this.shadow.position.set(r.x, floor + 0.03, -r.s);
      if (!this.shadow.parent) g.parent?.add(this.shadow);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - (r.y - floor) / 4);
    }
    this.trail.update(r.out ? null : TMP_V.set(r.x, r.y + 1.0, -r.s + 0.2), r.slide > 0);
  }

  dispose() {
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.shadow.parent?.remove(this.shadow);
    this.shadow.geometry.dispose();
    for (const m of this.mats) m.dispose();
    this.trail.dispose();
  }
}

const TMP_V = new THREE.Vector3();

// A ribbon of light behind a runner: the last few positions, fading out
class Trail {
  mesh: THREE.Mesh;
  private n = 12;
  private pts: Float32Array;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private filled = 0;

  constructor(color: string) {
    const n = this.n;
    this.pts = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      if (color === 'rainbow') c.setHSL(i / n, 0.9, 0.55); else c.set(color);
      c.multiplyScalar((1 - i / n) ** 1.5);
      for (const k of [0, 1]) this.col.setXYZ(i * 2 + k, c.r, c.g, c.b);
    }
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  // Each frame: the newest point first (null: the trail fades away)
  update(p: THREE.Vector3 | null, low: boolean) {
    const a = this.pts;
    a.copyWithin(3, 0, a.length - 3);
    if (p) { a[0] = p.x; a[1] = low ? p.y - 0.5 : p.y; a[2] = p.z; this.filled = Math.min(this.n, this.filled + 1); }
    else this.filled = Math.max(0, this.filled - 1);
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, Math.max(0, this.filled - 1)), w = 0.16 * (1 - i / this.n);
      this.pos.setXYZ(i * 2, a[j * 3], a[j * 3 + 1] - w, a[j * 3 + 2]);
      this.pos.setXYZ(i * 2 + 1, a[j * 3], a[j * 3 + 1] + w, a[j * 3 + 2]);
    }
    this.pos.needsUpdate = true;
    this.mesh.visible = this.filled > 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// --- the security drone: comes in behind whoever stumbled, and takes anyone it catches -----------------
class Drone {
  group = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private light: THREE.Mesh;
  private beam: THREE.Mesh;
  private pos = new THREE.Vector3(0, 30, 30);
  private want = new THREE.Vector3();

  constructor() {
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a1d26 });
    this.group.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.9), dark));
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 1.1), dark);
      arm.position.set(x / 2, 0, z / 2);
      arm.rotation.y = Math.atan2(x, z);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12),
        new THREE.MeshBasicMaterial({ color: 0x9aa3b5, transparent: true, opacity: 0.35 }));
      rotor.position.set(x, 0.12, z);
      this.rotors.push(rotor);
      this.group.add(arm, rotor);
    }
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
    this.light.position.set(0, -0.15, -0.45);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 16, 1, true).translate(0, -2, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.group.add(this.light, this.beam);
    this.group.visible = false;
  }

  update(run: Run, dt: number, now: number) {
    // after whoever it's chasing (the one with the most time on the clock), or the last one it caught
    let target: Runner | null = null;
    for (const r of run.runners) if (!r.out && r.drone > 0 && (!target || r.drone > target.drone)) target = r;
    const caught = run.runners.find((r) => r.out === 'caught' && run.t - r.outAt < 2.5);
    const lead = run.leader;
    const want = this.want;
    if (caught) want.set(caught.x, caught.y + 3.2 + (run.t - caught.outAt) * 1.5, -caught.s + 0.5);
    else if (target) want.set(target.x, target.y + 3 + target.drone * 0.2, -target.s + 2.5 + target.drone * 1.1);
    else want.set(lead.x, 18, -lead.s + 30); // up and away, behind everyone
    if (!this.group.visible && (caught || target)) this.pos.set(want.x, want.y + 8, want.z + 20);
    this.pos.lerp(want, Math.min(1, (caught ? 6 : 3) * dt));
    this.group.visible = !!(caught || target) || this.pos.y < 16;
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(now * 0.005) * 0.12;
    this.group.rotation.x = 0.25;
    for (const r of this.rotors) r.rotation.y += dt * 40;
    (this.light.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(now / 250) % 2 ? 0xff2d55 : 0x3fb7ff);
    this.beam.visible = !!(caught || target);
  }
}
