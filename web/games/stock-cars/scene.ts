// The 3D world: a night race under the lights. The oval and its walls are built from the track's
// numbers (track.ts); the cars are drawn from simple shapes in each car's colour. Each person gets a
// chase camera (the screen splits for 2 to 4), and the TV camera follows the racing when nobody's
// driving. Everything is plain three.js with cheap materials, so it runs on modest screens.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TOP, type Car } from './race.ts';
import type { Track } from './track.ts';

const SKY = 0x0a0c12;
const STEP = 4; // m between the rings of the track's mesh
const DISPLAY_FONT = '"Big Shoulders Display", "Arial Narrow", sans-serif';

// A rectangle of the screen, as fractions from the top left
export interface Rect { x: number; y: number; w: number; h: number }

export interface View {
  car: Car | null; // whose chase camera; null: the TV camera
  rect: Rect;
  camera: THREE.PerspectiveCamera;
  lookBack: boolean;
  d: number; // the chase camera's line, eased
  aim: THREE.Vector3; // the TV camera's target, eased
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cars = new Map<Car, THREE.Group>();
  private extras: THREE.Object3D[] = []; // what goes first when the screen struggles
  private parts = carParts();
  views: View[] = [];

  constructor(canvas: HTMLCanvasElement, readonly track: Track) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 320, 1500);
    this.scene.add(new THREE.HemisphereLight(0xc4cee6, 0x1d2618, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(150, 400, 260);
    this.scene.add(sun);
    this.build();
  }

  // Lower the detail when the screen can't keep up: first the resolution, then the scenery
  lowerDetail(level: number) {
    if (level === 1) this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * 0.75);
    else for (const o of this.extras) o.visible = false;
  }

  // --- the cars ----------------------------------------------------------------------------------
  setCars(cars: Car[]) {
    for (const g of this.cars.values()) {
      this.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.own) { (o.material as THREE.MeshPhongMaterial).map?.dispose(); (o.material as THREE.Material).dispose(); }
      });
    }
    this.cars.clear();
    for (const c of cars) {
      const g = carModel(this.parts, c.spec.color, c.spec.number);
      this.scene.add(g);
      this.cars.set(c, g);
    }
  }

  // Each person's chase camera; a TV camera too when nobody is driving, or to fill the fourth corner
  setViews(cars: Car[]) {
    const n = cars.length;
    const rects: Rect[] = n <= 1 ? [{ x: 0, y: 0, w: 1, h: 1 }]
      : n === 2 ? [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]
      : [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
    this.views = rects.map((rect, i) => ({
      car: cars[i] ?? null, rect, lookBack: false,
      camera: new THREE.PerspectiveCamera(60, 1, 0.5, 2000),
      d: cars[i]?.d ?? 0, aim: new THREE.Vector3(),
    }));
  }

  // Place everything and draw each view. `follow`: who the TV camera watches.
  render(dt: number, follow: Car | null) {
    for (const [c, g] of this.cars) place(this.track, g, c.dist, c.d, c.yaw);
    const r = this.renderer, canvas = r.domElement;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    r.setScissorTest(true);
    for (const v of this.views) {
      const x = v.rect.x * W, y = (1 - v.rect.y - v.rect.h) * H, w = v.rect.w * W, h = v.rect.h * H;
      v.camera.aspect = w / h;
      if (v.car) this.chase(v, v.car, dt);
      else if (follow) this.tv(v, follow, dt);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(this.scene, v.camera);
    }
  }

  resize() {
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  // Behind the car, riding the banking with it; wider at speed
  private chase(v: View, car: Car, dt: number) {
    const t = this.track, cam = v.camera;
    v.d += (car.d - v.d) * Math.min(1, 6 * dt);
    const back = v.lookBack ? -1 : 1;
    const eye = t.point(car.dist - 9 * back, v.d), at = t.point(car.dist + 14 * back, car.d);
    const lift = surfaceUp(t, car.dist);
    cam.position.set(eye.x, eye.y, eye.z).addScaledVector(lift, 3.4);
    cam.up.copy(lift).lerp(UP, 0.5).normalize();
    cam.lookAt(at.x + lift.x, at.y + lift.y, at.z + lift.z);
    cam.fov = 60 + 14 * Math.min(1, car.v / TOP) ** 2;
    cam.updateProjectionMatrix();
  }

  // From the nearest camera spot around the outside, a long lens on the car
  private tv(v: View, car: Car, dt: number) {
    const t = this.track, cam = v.camera, spots = 8;
    let best = 0, bestGap = Infinity;
    for (let i = 0; i < spots; i++) {
      const gap = Math.abs(t.gap(((i + 0.5) / spots) * t.length, car.dist + 30)); // (looking a little ahead)
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    const spot = t.point(((best + 0.5) / spots) * t.length, t.width / 2 + 5);
    const p = t.point(car.dist, car.d);
    if (v.aim.lengthSq() === 0 || v.aim.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) > 120) v.aim.set(p.x, p.y, p.z);
    else v.aim.lerp(new THREE.Vector3(p.x, p.y, p.z), Math.min(1, 8 * dt));
    cam.position.set(spot.x, spot.y + 18, spot.z);
    cam.up.copy(UP);
    cam.lookAt(v.aim);
    const dist = cam.position.distanceTo(v.aim);
    cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(16 / dist)), 8, 55);
    cam.updateProjectionMatrix();
  }

  // --- the circuit ---------------------------------------------------------------------------------
  private build() {
    const t = this.track, s = this.scene, W = t.width;
    const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);

    // grass, then the apron (flat, inside) and the banked racing surface
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), lambert({ color: 0x16301f }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    s.add(grass);
    const at = (d: number, up = 0) => (u: number) => { const p = t.point(u, d); return new THREE.Vector3(p.x, p.y + up, p.z); };
    s.add(new THREE.Mesh(strip(t, at(-W / 2 - 8), at(-W / 2), 16), lambert({ map: apronTexture() })));
    s.add(new THREE.Mesh(strip(t, at(-W / 2), at(W / 2), 16), lambert({ map: asphaltTexture(W) })));

    // the wall, and the catch fence above it
    const wall = (u: number, h: number) => { const p = t.point(u, W / 2 + 0.1); return new THREE.Vector3(p.x, p.y + h, p.z); };
    s.add(new THREE.Mesh(strip(t, (u) => wall(u, 0), (u) => wall(u, 1.3), 8), lambert({ map: wallTexture(), side: THREE.DoubleSide })));
    const fence = new THREE.Mesh(strip(t, (u) => wall(u, 1.3), (u) => wall(u, 6.5), 3),
      new THREE.MeshBasicMaterial({ map: fenceTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true }));
    s.add(fence);
    const innerWall = (u: number, h: number) => { const p = t.point(u, -W / 2 - 8); return new THREE.Vector3(p.x, h, p.z); };
    s.add(new THREE.Mesh(strip(t, (u) => innerWall(u, 0), (u) => innerWall(u, 0.9), 8), lambert({ color: 0x9a9caa, side: THREE.DoubleSide })));

    // the start/finish line
    s.add(new THREE.Mesh(quad([at(-W / 2, 0.02)(0), at(W / 2, 0.02)(0), at(-W / 2, 0.02)(1.6), at(W / 2, 0.02)(1.6)]),
      new THREE.MeshBasicMaterial({ map: checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2 })));
    this.gantry();

    // the main grandstand along the front straight, and lights all round
    this.grandstand();
    this.lights();
    this.trees();
    this.infieldName();
    this.stars();
  }

  private gantry() {
    const t = this.track, W = t.width;
    const mat = new THREE.MeshLambertMaterial({ color: 0x20242f });
    const a = t.point(0, -W / 2 - 1), b = t.point(0, W / 2 + 1);
    const g = new THREE.Group();
    for (const p of [a, b]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), mat);
      pole.position.set(p.x, p.y + 4.5, p.z);
      g.add(pole);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, W + 2), new THREE.MeshBasicMaterial({ map: gantryTexture() }));
    beam.position.set(a.x, 9, (a.z + b.z) / 2);
    g.add(beam);
    this.scene.add(g);
  }

  private grandstand() {
    const t = this.track, z0 = t.radius + t.width / 2 + 9, len = t.straight + 40;
    const rise = 16, depth = 34, slope = Math.hypot(rise, depth);
    const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len, slope),
      new THREE.MeshLambertMaterial({ map: crowdTexture(len / 64), side: THREE.DoubleSide }));
    crowd.rotation.x = Math.atan2(depth, rise);
    crowd.position.set(0, 3 + rise / 2, z0 + depth / 2);
    const dark = new THREE.MeshLambertMaterial({ color: 0x1b1e27 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 1), dark);
    front.position.set(0, 1.5, z0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, rise + 10, 2), dark);
    back.position.set(0, (rise + 10) / 2, z0 + depth + 1);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, depth * 0.7), dark);
    roof.position.set(0, rise + 10, z0 + depth * 0.65);
    roof.rotation.x = -0.08;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
    glow.position.set(0, rise + 9.4, z0 + depth * 0.33);
    this.scene.add(crowd, front, back, roof, glow);
  }

  private lights() {
    const t = this.track, n = 14, poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
    const glow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.25) / n) * t.length;
      if (Math.abs(t.gap(u, 0)) < t.straight / 2 + 20) continue; // (the grandstand roof lights that stretch)
      const p = t.point(u, t.width / 2 + 16), h = 34;
      poles.push(new THREE.CylinderGeometry(0.35, 0.6, h, 6).translate(p.x, h / 2, p.z));
      heads.push(new THREE.BoxGeometry(5, 2.4, 5).translate(p.x, h + 1, p.z));
      const sprite = new THREE.Sprite(glow);
      sprite.position.set(p.x, h + 1, p.z);
      sprite.scale.setScalar(26);
      this.scene.add(sprite);
      this.extras.push(sprite);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x3a3f4e })));
    this.scene.add(new THREE.Mesh(mergeGeometries(heads), new THREE.MeshBasicMaterial({ color: 0xfff3d6 })));
  }

  private trees() {
    const t = this.track, n = 160;
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 14, 6).translate(0, 7, 0), new THREE.MeshLambertMaterial({ color: 0x10261a }), n);
    const m = new THREE.Matrix4(), rnd = seeded(7);
    for (let i = 0; i < n; i++) {
      const p = t.point(rnd() * t.length, t.width / 2 + 60 + rnd() * 140);
      if (p.z > t.radius + 20 && Math.abs(p.x) < t.straight / 2 + 60) p.z += 60; // (behind the grandstand)
      const k = 0.7 + rnd() * 0.8;
      m.makeScale(k, k * (0.8 + rnd() * 0.5), k).setPosition(p.x, 0, p.z);
      trees.setMatrixAt(i, m);
    }
    this.scene.add(trees);
    this.extras.push(trees);
  }

  // Our name painted on the infield grass, readable from the grandstand side
  private infieldName() {
    const c = canvas(1024, 192), g = c.getContext('2d')!;
    g.font = `800 150px ${DISPLAY_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(215,255,59,0.55)';
    g.fillStyle = 'rgba(243,240,232,0.35)';
    g.fillText('BEACON', 300, 100);
    g.strokeText('ARCADE', 740, 100);
    const name = new THREE.Mesh(new THREE.PlaneGeometry(260, 48.75),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    name.rotation.x = -Math.PI / 2;
    name.position.y = 0.02;
    this.scene.add(name);
  }

  private stars() {
    const n = 900, pos = new Float32Array(n * 3), rnd = seeded(3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.4, r = 1700;
      pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d0e8, size: 1.6, sizeAttenuation: false, fog: false }));
    this.scene.add(stars);
    this.extras.push(stars);
  }
}

// --- placing things on the track ----------------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const basis = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);

// The banked surface's up direction (it leans in toward the infield)
function surfaceUp(t: Track, s: number) {
  const p = t.at(s), b = t.bank(s);
  return new THREE.Vector3(p.hz * Math.sin(b), Math.cos(b), -p.hx * Math.sin(b));
}

// A car on the track: along it, tilted with the banking, turned by its slide
function place(t: Track, o: THREE.Object3D, s: number, d: number, yaw: number) {
  const p = t.point(s, d);
  const f = new THREE.Vector3(p.p.hx, 0, p.p.hz), right = new THREE.Vector3(-p.p.hz, 0, p.p.hx);
  basis.makeBasis(f, UP, right);
  o.quaternion.setFromRotationMatrix(basis)
    .multiply(q1.setFromAxisAngle(X, -t.bank(s)))
    .multiply(q2.setFromAxisAngle(UP, -yaw));
  o.position.set(p.x, p.y, p.z);
}

// A ribbon along the whole lap between two edges (inner edge first, so it faces up / inwards)
function strip(t: Track, a: (s: number) => THREE.Vector3, b: (s: number) => THREE.Vector3, tile: number) {
  const n = Math.ceil(t.length / STEP), pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * t.length, p = a(s), q = b(s);
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uv.push(0, s / tile, 1, s / tile);
    if (i < n) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Four corners: two across the start, two across the end (uv like strip())
function quad([a, b, c, d]: THREE.Vector3[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, d].flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
}

// --- the cars ----------------------------------------------------------------------------------------
// A stock car from the side, extruded: long bonnet, low roof, a spoiler on the boot. 5 m by 2 m.
interface CarParts {
  body: THREE.BufferGeometry; glass: THREE.BufferGeometry; wheels: THREE.BufferGeometry; decals: THREE.BufferGeometry; lamps: THREE.Mesh; shadow: THREE.Mesh;
  glassMat: THREE.Material; wheelMat: THREE.Material;
}

function carParts(): CarParts {
  const side = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const extrude = (shape: THREE.Shape, depth: number, bevel: number) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 })
      .translate(0, 0, -depth / 2);
  const shell = extrude(side([[-2.45, 0.28], [2.45, 0.28], [2.5, 0.55], [2.32, 0.76], [1.0, 0.86], [0.2, 1.24], [-1.0, 1.27], [-1.8, 0.95], [-2.45, 0.92]]), 1.86, 0.06);
  const spoiler = new THREE.BoxGeometry(0.12, 0.22, 1.9).translate(-2.38, 1.03, 0);
  const bare = (a: THREE.BufferGeometry) => { a.deleteAttribute('uv'); return a; }; // (merging needs the same attributes)
  const body = mergeGeometries([bare(shell.toNonIndexed()), bare(spoiler.toNonIndexed())]);
  body.computeVertexNormals();
  // (the windscreen and rear window sit just proud of the body, so they show; the top hides under the roof)
  const glass = extrude(side([[0.92, 0.99], [0.3, 1.29], [-1.12, 1.3], [-1.8, 1.03], [-1.8, 0.9], [0.92, 0.9]]), 2.02, 0);
  // tail lights, headlights and the grille, in one mesh coloured per vertex
  const lamp = (x: number, y: number, z: number, w: number, h: number, d: number, hex: number) => {
    const b = new THREE.BoxGeometry(w, h, d).translate(x, y, z), c = new THREE.Color(hex), n = b.attributes.position.count;
    b.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return b;
  };
  const lamps = mergeGeometries([
    lamp(-2.52, 0.74, 0, 0.04, 0.14, 1.55, 0xff2638),
    lamp(2.53, 0.63, 0.62, 0.05, 0.13, 0.42, 0xfff3c4),
    lamp(2.53, 0.63, -0.62, 0.05, 0.13, 0.42, 0xfff3c4),
    lamp(2.55, 0.42, 0, 0.04, 0.14, 1.3, 0x111216),
  ]);
  const wheel = () => new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12).rotateX(Math.PI / 2);
  const wheels = mergeGeometries([[1.55, 0.88], [1.55, -0.88], [-1.55, 0.88], [-1.55, -0.88]].map(([x, z]) => wheel().translate(x, 0.36, z)));
  // numbers on the roof and both doors
  const roof = new THREE.PlaneGeometry(1.1, 0.55).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(-0.4, 1.31, 0);
  const right = new THREE.PlaneGeometry(1.3, 0.65).translate(0.1, 0.6, 1.0);
  const left = new THREE.PlaneGeometry(1.3, 0.65).rotateY(Math.PI).translate(0.1, 0.6, -1.0);
  const decals = mergeGeometries([roof, right, left]);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 3).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false }));
  return {
    body, glass, wheels, decals, shadow,
    lamps: new THREE.Mesh(lamps, new THREE.MeshBasicMaterial({ vertexColors: true })),
    glassMat: new THREE.MeshPhongMaterial({ color: 0x0b0e16, specular: 0x667088, shininess: 80 }),
    wheelMat: new THREE.MeshLambertMaterial({ color: 0x15161a }),
  };
}

function carModel(parts: CarParts, color: string, number: number) {
  const g = new THREE.Group();
  const own = (m: THREE.Mesh) => { m.userData.own = true; return m; };
  g.add(own(new THREE.Mesh(parts.body, new THREE.MeshPhongMaterial({ color, specular: 0x555555, shininess: 70 }))));
  g.add(new THREE.Mesh(parts.glass, parts.glassMat));
  g.add(new THREE.Mesh(parts.wheels, parts.wheelMat));
  g.add(own(new THREE.Mesh(parts.decals, new THREE.MeshLambertMaterial({ map: numberTexture(number, color), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }))));
  g.add(parts.lamps.clone(), parts.shadow.clone());
  return g;
}

// --- textures, drawn here so there's nothing to download ---------------------------------------------------
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, light: number, rnd: () => number) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(light + (rnd() - 0.5) * 40);
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
}

// across the track (u: inside edge to the wall), repeated along it
function asphaltTexture(width: number) {
  const c = canvas(256, 256), g = c.getContext('2d')!, rnd = seeded(11);
  g.fillStyle = '#2c2f37';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 3000, 50, rnd);
  const u = (d: number) => ((d + width / 2) / width) * 256;
  g.fillStyle = 'rgba(10,10,14,0.35)'; // the groove: rubber laid down at the bottom
  g.fillRect(u(-8), 0, u(-2) - u(-8), 256);
  g.fillStyle = 'rgba(10,10,14,0.2)'; // and scuffs up by the wall
  g.fillRect(u(7), 0, u(9.6) - u(7), 256);
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 5, 256);
  return texture(c);
}

function apronTexture() {
  const c = canvas(128, 128), g = c.getContext('2d')!, rnd = seeded(5);
  g.fillStyle = '#464a53';
  g.fillRect(0, 0, 128, 128);
  speckle(g, 128, 128, 700, 80, rnd);
  g.fillStyle = '#ffc23d'; // the double yellow line: below it is out of bounds
  g.fillRect(104, 0, 5, 128);
  g.fillRect(112, 0, 5, 128);
  return texture(c);
}

function wallTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1e27'; // the soft barrier's dark band (x is up the wall, y along it)
  g.fillRect(16, 0, 30, 64);
  g.fillStyle = '#c9c6bd';
  g.fillRect(0, 62, 64, 2);
  return texture(c);
}

function fenceTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(190,196,210,0.35)';
  g.lineWidth = 1;
  for (let i = -64; i < 128; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
  }
  g.fillStyle = 'rgba(120,126,140,0.9)'; // posts
  g.fillRect(0, 0, 64, 2);
  return texture(c);
}

function checkerTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f3f0e8';
    g.fillRect(x * 4, y * 32, 4, 32);
  }
  return texture(c, false);
}

function gantryTexture() {
  const c = canvas(512, 64), g = c.getContext('2d')!;
  g.fillStyle = '#0e1016';
  g.fillRect(0, 0, 512, 64);
  g.font = `800 44px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#d7ff3b';
  g.fillText('START  ·  FINISH', 256, 34);
  return texture(c, false);
}

function crowdTexture(repeat: number) {
  const c = canvas(512, 256), g = c.getContext('2d')!, rnd = seeded(23);
  g.fillStyle = '#1d2029';
  g.fillRect(0, 0, 512, 256);
  const shirts = ['#b9b6ae', '#a8434b', '#3d63ad', '#b38f3a', '#2f8a66', '#a04a8c', '#6d6b75', '#8fa63a', '#a8673a', '#2a2e3a'];
  for (let row = 0; row < 32; row++) {
    g.fillStyle = '#12141b';
    g.fillRect(0, row * 8 + 6, 512, 2);
    for (let x = 0; x < 512; x += 4) {
      if (rnd() < 0.15) continue;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(x + rnd(), row * 8 + 2, 3, 4);
      g.fillStyle = '#7d6250';
      g.fillRect(x + rnd(), row * 8, 2, 2);
    }
  }
  const t = texture(c);
  t.repeat.set(repeat, 1.3);
  return t;
}

function glowTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, false);
}

// The car's number, in a white panel: dark cars get light numbers and the other way round
function numberTexture(n: number, color: string) {
  const c = canvas(256, 128), g = c.getContext('2d')!;
  const dark = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35;
  g.fillStyle = dark ? '#f3f0e8' : '#0e1016';
  g.font = `900 120px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = dark ? '#0e1016' : '#f3f0e8';
  g.strokeText(String(n), 128, 70);
  g.fillText(String(n), 128, 70);
  return texture(c, false);
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
