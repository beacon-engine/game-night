// Drawing Space Shooter: the ships and enemies (Kenney's Space Kit, CC0), seen from above as they fly
// across the screen, over a nebula, stars, a planet and the stage's wrecks and rocks drifting past far
// behind. Glowing shots, beams, explosions with shockwaves and debris, and bloom on everything bright.
//
// The playing field (sim.ts) is a flat 2D plane facing the camera: field (x, y) is world (x - W/2,
// y - H/2, 0). Models are turned so their tops face the camera and their noses point along +x
// (enemies, -x).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ENEMIES, FIELD, PICKUP_LOOK, STAGES, type Look, type Pickup } from './stages.ts';
import type { BossState, Foe, Ship, Sim, SimEvent } from './sim.ts';

const { w: W, h: H } = FIELD;
const FOV = 30;
const PLAYER_MODELS = ['craft_speederA', 'craft_speederB', 'craft_speederC', 'craft_speederD'];
export const WINGMAN_MODEL = 'craft_racer';
export const shipModel = (slot: number) => PLAYER_MODELS[slot % PLAYER_MODELS.length];
const PAINT = 'metalRed'; // the kit's accent material: a ship's own colour
const HULL = 'metal'; // and its main one: a paint job from the shop

// Kenney's models have their tops up (+y) and noses toward -z: turn them to face the camera, nose +x
const FACE_CAMERA = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));

const FAR = new THREE.Color('#1a2340'); // what distance does to the colour of things far behind
const BLOOM = { strength: 0.85, radius: 0.5, threshold: 0.62 };
const SHAKE = { decay: 5, most: 0.9 };

// --- models ---------------------------------------------------------------------------------------------
const models = new Map<string, THREE.Object3D>();

export async function loadModels(extra: string[] = []) {
  const names = new Set([...PLAYER_MODELS, WINGMAN_MODEL, ...Object.values(ENEMIES).map((e) => e.model), ...extra]);
  for (const s of STAGES) {
    for (const p of s.boss.parts) names.add(p.model);
    for (const p of s.look.props) names.add(p);
  }
  const loader = new GLTFLoader();
  await Promise.all([...names].map(async (n) => {
    const g = await loader.loadAsync(`models/${n}.glb`);
    models.set(n, g.scene);
  }));
}

// A copy of a model, turned to face the camera, with its own materials (so it can flash and be painted)
function make(name: string, scale: number, paint?: string, hull?: string) {
  const src = models.get(name)!;
  const inner = src.clone(true);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
      const c = (x as THREE.MeshStandardMaterial).clone();
      if (paint && c.name === PAINT) c.color.set(paint);
      if (hull && c.name === HULL) c.color.set(hull);
      c.emissive = new THREE.Color(0);
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
  const box = new THREE.Box3().setFromObject(inner);
  inner.position.sub(box.getCenter(new THREE.Vector3())); // (centred on its middle)
  const turn = new THREE.Group();
  turn.add(inner);
  turn.matrixAutoUpdate = true;
  turn.quaternion.setFromRotationMatrix(FACE_CAMERA);
  const outer = new THREE.Group(); // move, bank and spin this one
  outer.add(turn);
  outer.scale.setScalar(scale);
  return outer;
}

function setFlash(o: THREE.Object3D, k: number, color = 0xffffff) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).emissive.setHex(color).multiplyScalar(k);
  });
}

const toWorld = (x: number, y: number, z = 0) => new THREE.Vector3(x - W / 2, y - H / 2, z);

// --- glows --------------------------------------------------------------------------------------------
function glowTexture(soft = 0.35) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(soft, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

function letterTexture(letter: string, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.stroke();
  g.fillStyle = '#0b0d12';
  g.font = '900 76px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A pool of glowing points, each with its own colour, size and fade: sparks, fire, smoke, bullets
class Glows {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array;
  private life: Float32Array; private full: Float32Array; private base: Float32Array;
  private next = 0;
  constructor(private n: number, blending: THREE.Blending, private drag = 1.5) {
    this.pos = new Float32Array(n * 3).fill(1e4);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.full = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: GLOW }, scale: { value: 1 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a); }`,
      blending, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  set scale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px; }
  emit(x: number, y: number, z: number, vx: number, vy: number, color: THREE.Color, size: number, life: number) {
    const k = this.next++ % this.n;
    this.pos.set([x, y, z], k * 3);
    this.vel.set([vx, vy, 0], k * 3);
    this.base.set([color.r, color.g, color.b], k * 3);
    this.size[k] = size;
    this.life[k] = this.full[k] = life;
  }
  burst(at: THREE.Vector3, count: number, speed: number, color: THREE.Color, size: number, life: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.emit(at.x, at.y, at.z, Math.cos(a) * v, Math.sin(a) * v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8));
    }
  }
  update(dt: number) {
    const drag = Math.max(0, 1 - this.drag * dt);
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3] = 1e4; this.size[k] = 0; continue; }
      const f = this.life[k] / this.full[k];
      for (let j = 0; j < 3; j++) {
        this.vel[k * 3 + j] *= drag;
        this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
        this.col[k * 3 + j] = this.base[k * 3 + j] * f;
      }
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}

// Points standing for live things (bullets): rewritten every frame from the sim's list
class Dots {
  readonly points: THREE.Points;
  private pos: Float32Array;
  constructor(private n: number, color: string, size: number) {
    this.pos = new Float32Array(n * 3).fill(1e4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points.frustumCulled = false;
  }
  set(list: { x: number; y: number }[]) {
    const n = Math.min(this.n, list.length);
    for (let i = 0; i < n; i++) this.pos.set([list[i].x - W / 2, list[i].y - H / 2, 0.3], i * 3);
    for (let i = n; i < this.n; i++) this.pos[i * 3] = 1e4;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// --- the backdrop ---------------------------------------------------------------------------------------
const NEBULA_FRAG = `
uniform vec3 a; uniform vec3 b; uniform float t; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, k = 0.5; for (int i = 0; i < 5; i++){ s += n(p) * k; p *= 2.03; k *= 0.5; } return s; }
void main(){
  vec2 p = vUv * vec2(3.2, 1.8) + vec2(t * 0.012, 0.0);
  float c = fbm(p + fbm(p * 1.7 + 3.1));
  float d = fbm(p * 2.4 - t * 0.004);
  vec3 col = mix(vec3(0.01, 0.012, 0.03), a * 0.55, smoothstep(0.35, 0.85, c));
  col = mix(col, b * 0.7, smoothstep(0.55, 0.95, d) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

class Backdrop {
  readonly group = new THREE.Group();
  private nebula: THREE.ShaderMaterial;
  private stars: { pts: THREE.Points; speed: number; spanX: number }[] = [];
  private planet: THREE.Group | null = null;
  private props: { o: THREE.Object3D; speed: number; spin: THREE.Vector3 }[] = [];
  private propT = 0;
  constructor(private look: Look) {
    this.nebula = new THREE.ShaderMaterial({
      uniforms: { a: { value: new THREE.Color(look.sky[0]) }, b: { value: new THREE.Color(look.sky[1]) }, t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: NEBULA_FRAG, depthWrite: false,
    });
    const neb = new THREE.Mesh(new THREE.PlaneGeometry(260, 150), this.nebula);
    neb.position.z = -150;
    this.group.add(neb);
    // three layers of stars, further ones slower
    for (const [z, count, size, speed] of [[-130, 900, 0.9, 1.2], [-80, 500, 0.7, 2.6], [-40, 260, 0.45, 5]] as const) {
      const spanX = 2.2 * Math.abs(z) * Math.tan((FOV * Math.PI) / 360) * (16 / 9) + 20;
      const spanY = spanX * 0.6;
      const p = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) p.set([(Math.random() - 0.5) * spanX, (Math.random() - 0.5) * spanY, z + Math.random() * 6], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: look.stars, size, map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.group.add(pts);
      this.stars.push({ pts, speed, spanX });
    }
    if (look.planet) {
      const pl = look.planet;
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(pl.size, 48, 32), new THREE.MeshStandardMaterial({ color: pl.color, roughness: 0.9 }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: pl.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(pl.size * 3.2);
      g.add(halo, ball);
      g.position.set((pl.x - 0.5) * 120, (pl.y - 0.5) * 66, -110);
      this.planet = g;
      this.group.add(g);
    }
  }

  update(dt: number, t: number) {
    this.nebula.uniforms.t.value = t;
    for (const s of this.stars) {
      s.pts.position.x -= s.speed * dt;
      if (s.pts.position.x < -s.spanX / 4) s.pts.position.x += s.spanX / 4; // (a quarter-span step: the field is uniform)
    }
    if (this.planet) { this.planet.position.x -= 0.15 * dt; this.planet.rotation.y += 0.02 * dt; }
    // wrecks and rocks drifting past behind the action
    this.propT -= dt;
    if (this.propT <= 0 && this.look.props.length) {
      this.propT = this.look.propEvery * (0.6 + Math.random() * 0.8);
      const name = this.look.props[Math.floor(Math.random() * this.look.props.length)];
      const z = -28 - Math.random() * 40;
      const o = make(name, 2 + Math.random() * 4);
      const span = Math.abs(z) * Math.tan((FOV * Math.PI) / 360) * 2 + H;
      o.position.set(W / 2 + Math.abs(z) * 0.9 + 10, (Math.random() - 0.5) * span, z);
      o.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).color.multiplyScalar(0.32).lerp(FAR, 0.35);
      });
      this.group.add(o);
      this.props.push({ o, speed: 3 + 40 / (Math.abs(z) + 6), spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4) });
    }
    for (const p of this.props) {
      p.o.position.x -= p.speed * dt;
      p.o.rotation.x += p.spin.x * dt; p.o.rotation.y += p.spin.y * dt; p.o.rotation.z += p.spin.z * dt;
    }
    for (const p of this.props.filter((q) => q.o.position.x < -W / 2 - Math.abs(q.o.position.z) - 12)) this.group.remove(p.o);
    this.props = this.props.filter((q) => q.o.parent);
  }
}

// --- the view ----------------------------------------------------------------------------------------------
interface ShipView { o: THREE.Object3D; engine: THREE.Sprite; shield: THREE.Mesh; beam: THREE.Group; color: THREE.Color }

export class View {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 400);
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private backdrop: Backdrop | null = null;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private ships = new Map<Ship, ShipView>();
  private foes = new Map<Foe, THREE.Object3D>();
  private boss: { state: BossState; group: THREE.Group; parts: THREE.Object3D[] } | null = null;
  private drops = new Map<object, THREE.Object3D>();
  private shotMesh: THREE.InstancedMesh;
  private missileMesh: THREE.InstancedMesh;
  private bullets = new Dots(1400, '#ff3d9a', 1.25);
  private bulletCores = new Dots(1400, '#ffffff', 0.5);
  private sparks = new Glows(1600, THREE.AdditiveBlending, 2.2);
  private smoke = new Glows(700, THREE.NormalBlending, 1.2);
  private rings: { m: THREE.Mesh; t: number; life: number; size: number }[] = [];
  private flash: THREE.PointLight;
  private shake = 0;
  private t = 0;
  bloom = true;
  private dummy = new THREE.Object3D();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#020308');
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20121a, 1.1));
    this.sun.position.set(-6, 10, 14);
    this.scene.add(this.sun);
    this.flash = new THREE.PointLight(0xffb060, 0, 30, 1.6);
    this.flash.position.z = 3;
    this.scene.add(this.flash);
    // player shots: thin glowing streaks; missiles: small bright darts
    const streak = new THREE.PlaneGeometry(1.1, 0.16);
    this.shotMesh = new THREE.InstancedMesh(streak, new THREE.MeshBasicMaterial({ color: 0xffffff, map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 900);
    this.missileMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshBasicMaterial({ color: 0xffd08a, map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 200);
    for (const m of [this.shotMesh, this.missileMesh]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    this.scene.add(this.bullets.points, this.bulletCores.points, this.smoke.points, this.sparks.points);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 576), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.layout();
  }

  // Fit the whole field on the screen, whatever its shape
  layout() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    const halfV = Math.tan((FOV * Math.PI) / 360);
    const fitH = (H / 2) / halfV, fitW = (W / 2) / (halfV * this.camera.aspect);
    this.camera.position.set(0, 0, Math.max(fitH, fitW) * 1.02);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    const px = h / (2 * halfV); // pixels per unit at distance 1
    this.sparks.scale = this.smoke.scale = px;
  }

  // A fresh stage: its backdrop and light, and nothing left over from the last one
  setStage(look: Look) {
    if (this.backdrop) this.scene.remove(this.backdrop.group);
    this.backdrop = new Backdrop(look);
    this.scene.add(this.backdrop.group);
    this.sun.color.set(look.light);
    for (const v of this.ships.values()) this.scene.remove(v.o);
    for (const o of this.foes.values()) this.scene.remove(o);
    for (const o of this.drops.values()) this.scene.remove(o);
    if (this.boss) this.scene.remove(this.boss.group);
    this.ships.clear(); this.foes.clear(); this.drops.clear(); this.boss = null;
  }

  // What happened this tick: bangs, flashes, shakes
  react(e: SimEvent) {
    if (e.type === 'explode') this.explode(e.x, e.y, e.size, new THREE.Color(e.color));
    else if (e.type === 'hit') this.sparks.burst(toWorld(e.x, e.y, 0.4), 3, 6, new THREE.Color('#ffe9b0'), 0.35, 0.18);
    else if (e.type === 'bomb') { this.ring(e.ship.x, e.ship.y, W * 1.2, 0.9, '#bfe6ff'); this.shake = Math.min(SHAKE.most, this.shake + 0.6); this.flashLight(e.ship.x, e.ship.y, 60, '#cfe8ff'); }
    else if (e.type === 'shield') this.ring(e.ship.x, e.ship.y, 2.5, 0.35, '#3fd7e8');
    else if (e.type === 'bossDown') this.shake = SHAKE.most;
  }

  private explode(x: number, y: number, size: number, color: THREE.Color) {
    const at = toWorld(x, y, 0.5);
    const n = Math.round(18 + size * 22);
    this.sparks.burst(at, n, 7 + size * 5, new THREE.Color('#ffd27a'), 0.5 + size * 0.25, 0.5);
    this.sparks.burst(at, Math.round(n / 2), 3 + size * 3, color.clone().lerp(new THREE.Color('#ff6a2a'), 0.5), 0.9 + size * 0.6, 0.6);
    this.smoke.burst(at, Math.round(6 + size * 8), 1.5 + size, new THREE.Color('#3a3036'), 1.2 + size, 1.2);
    this.ring(x, y, 1.6 + size * 2.2, 0.45, '#ffcf8a');
    this.flashLight(x, y, 10 + size * 18, '#ffb060');
    this.shake = Math.min(SHAKE.most, this.shake + size * 0.15);
  }

  private ring(x: number, y: number, size: number, life: number, color: string) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(toWorld(x, y, 0.6));
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, size });
  }

  private flashLight(x: number, y: number, power: number, color: string) {
    this.flash.position.set(x - W / 2, y - H / 2, 3);
    this.flash.color.set(color);
    this.flash.intensity = Math.max(this.flash.intensity, power);
  }

  frame(sim: Sim, dt: number) {
    this.t += dt;
    this.backdrop?.update(dt, this.t);
    this.syncShips(sim, dt);
    this.syncFoes(sim);
    this.syncBoss(sim);
    this.syncDrops(sim, dt);
    this.syncShots(sim);
    this.bullets.set(sim.bullets);
    this.bulletCores.set(sim.bullets);
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / r.life;
      r.m.scale.setScalar(0.2 + r.size * k);
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    }
    for (const r of this.rings.filter((q) => q.t >= q.life)) { this.scene.remove(r.m); r.m.geometry.dispose(); }
    this.rings = this.rings.filter((q) => q.t < q.life);
    this.flash.intensity *= Math.max(0, 1 - dt * 8);
    // a shake that dies away
    this.shake = Math.max(0, this.shake - dt * SHAKE.decay * this.shake - dt * 0.2);
    const s = this.shake * 0.35;
    this.camera.position.x = (Math.random() - 0.5) * s;
    this.camera.position.y = (Math.random() - 0.5) * s;
    if (this.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private syncShips(sim: Sim, dt: number) {
    for (const s of sim.ships) {
      let v = this.ships.get(s);
      if (!v) {
        const color = new THREE.Color(s.spec.color);
        const o = make(s.spec.model, 0.62, s.spec.color, s.spec.hull);
        const engine = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        engine.scale.setScalar(1.1);
        engine.position.set(-1.3, 0, 0);
        o.add(engine);
        const shield = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 16), new THREE.MeshBasicMaterial({ color: '#3fd7e8', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
        o.add(shield);
        const beam = new THREE.Group();
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.add(glow, core);
        this.scene.add(beam);
        v = { o, engine, shield, beam, color };
        this.ships.set(s, v);
        this.scene.add(o);
      }
      v.o.visible = s.alive && !(s.invuln > 0 && Math.floor(s.invuln * 12) % 2 === 0);
      v.o.position.copy(toWorld(s.x, s.y, 0));
      v.o.rotation.x = -s.bank * 0.9; // (banking into a climb or a dive)
      v.shield.visible = s.shield;
      v.engine.scale.setScalar(1 + Math.sin(this.t * 40) * 0.15 + (s.moveX > 0.3 ? 0.4 : 0));
      if (s.alive && Math.random() < 0.6) {
        // exhaust
        const p = toWorld(s.x - 0.9, s.y + (Math.random() - 0.5) * 0.15, -0.2);
        this.sparks.emit(p.x, p.y, p.z, -6 - Math.random() * 4, (Math.random() - 0.5) * 0.8, v.color, 0.45, 0.22);
      }
      // the laser
      v.beam.visible = s.alive && s.beam > 0;
      if (v.beam.visible) {
        const w = 0.5 + s.level * 0.22 * (s.focus ? 0.6 : 1);
        const flicker = 1 + Math.sin(this.t * 60) * 0.08;
        v.beam.position.copy(toWorld(s.x + 0.8 + s.beam / 2, s.y, 0.2));
        v.beam.scale.set(s.beam, w * flicker, 1);
        if (Math.random() < 0.5) {
          const end = toWorld(s.x + 0.8 + s.beam, s.y, 0.4);
          this.sparks.emit(end.x, end.y, end.z, (Math.random() - 0.3) * 6, (Math.random() - 0.5) * 6, v.color, 0.5, 0.2);
        }
      }
    }
    void dt;
  }

  private syncFoes(sim: Sim) {
    const live = new Set(sim.foes);
    for (const f of sim.foes) {
      let o = this.foes.get(f);
      if (!o) {
        o = make(f.def.model, f.def.scale * f.scale, f.def.paint);
        o.rotation.z = Math.PI; // (they fly the other way)
        this.foes.set(f, o);
        this.scene.add(o);
      }
      o.position.copy(toWorld(f.x, f.y, 0));
      if (f.def.spin) o.rotation.set(f.spin * 0.7, f.spin, Math.PI);
      else o.rotation.x = Math.max(-0.6, Math.min(0.6, -f.vy * 0.12));
      setFlash(o, f.flash > 0 ? 1.4 : 0);
    }
    for (const [f, o] of this.foes) if (!live.has(f)) { this.scene.remove(o); this.foes.delete(f); }
  }

  private syncBoss(sim: Sim) {
    const b = sim.boss;
    if (!b) { if (this.boss) { this.scene.remove(this.boss.group); this.boss = null; } return; }
    if (!this.boss || this.boss.state !== b) {
      const group = new THREE.Group();
      const parts = b.def.parts.map((p) => {
        const o = make(p.model, p.scale, p.paint ?? '#ff3b5c');
        o.rotation.z = Math.PI + (p.rotY ?? 0);
        o.position.set(p.x, p.y, p.hp ? 0.8 : 0);
        group.add(o);
        return o;
      });
      this.boss = { state: b, group, parts };
      this.scene.add(group);
    }
    const g = this.boss.group;
    g.position.copy(toWorld(b.x, b.y, 0));
    g.visible = !b.dead;
    b.parts.forEach((p, i) => {
      const o = this.boss!.parts[i];
      o.visible = p.alive || p.def.hp === 0;
      const armoured = p.def.core && !b.coreOpen;
      setFlash(o, p.flash > 0 ? 1.5 : armoured ? 0 : p.def.core ? 0.35 + Math.sin(this.t * 8) * 0.25 : 0, p.def.core ? 0xff3355 : 0xffffff);
      if (!p.alive && p.def.hp > 0 && Math.random() < 0.3) {
        const at = toWorld(p.x, p.y, 0.6);
        this.smoke.emit(at.x, at.y, at.z, -2, 1 + Math.random(), new THREE.Color('#2a2226'), 1.2, 0.9);
        if (Math.random() < 0.3) this.sparks.emit(at.x, at.y, at.z, (Math.random() - 0.5) * 4, Math.random() * 3, new THREE.Color('#ff9a3a'), 0.5, 0.3);
      }
      if (p.def.hp === 0) o.rotation.y = Math.sin(this.t * 0.6) * 0.05;
    });
  }

  private syncDrops(sim: Sim, dt: number) {
    const live = new Set<object>(sim.drops);
    for (const d of sim.drops) {
      let o = this.drops.get(d);
      if (!o) {
        const look = PICKUP_LOOK[d.kind as Pickup];
        const g = new THREE.Group();
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(look.letter, look.color), transparent: true, depthWrite: false }));
        s.scale.setScalar(1.15);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: look.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.scale.setScalar(2.4);
        g.add(halo, s);
        o = g;
        this.drops.set(d, o);
        this.scene.add(o);
      }
      o.position.copy(toWorld(d.x, d.y, 0.5));
      o.scale.setScalar(1 + Math.sin(d.t * 6) * 0.08);
    }
    for (const [d, o] of this.drops) if (!live.has(d)) { this.scene.remove(o); this.drops.delete(d); }
    void dt;
  }

  private syncShots(sim: Sim) {
    let n = 0, m = 0;
    const c = new THREE.Color();
    for (const p of sim.shots) {
      this.dummy.position.copy(toWorld(p.x, p.y, 0.25));
      this.dummy.rotation.set(0, 0, Math.atan2(p.vy, p.vx));
      this.dummy.updateMatrix();
      if (p.missile) {
        if (m < 200) this.missileMesh.setMatrixAt(m++, this.dummy.matrix);
        if (Math.random() < 0.5) this.smoke.emit(this.dummy.position.x, this.dummy.position.y, 0, -p.vx * 0.05, -p.vy * 0.05, new THREE.Color('#6a6060'), 0.5, 0.5);
      } else if (n < 900) {
        this.shotMesh.setMatrixAt(n, this.dummy.matrix);
        this.shotMesh.setColorAt(n, c.set(p.owner.spec.color).lerp(new THREE.Color(1, 1, 1), 0.45));
        n++;
      }
    }
    this.shotMesh.count = n;
    this.missileMesh.count = m;
    this.shotMesh.instanceMatrix.needsUpdate = this.missileMesh.instanceMatrix.needsUpdate = true;
    if (this.shotMesh.instanceColor) this.shotMesh.instanceColor.needsUpdate = true;
  }
}
