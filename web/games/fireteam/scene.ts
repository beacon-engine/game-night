// Drawing Fireteam: the countryside (land.ts), the soldiers (soldier.ts: the infantry cast in camouflage,
// motion capture, their arms on their weapons), the helicopter, and the fighting: tracers, muzzle
// flashes, dust, blood, grenades, flares, smoke over the ruins. Each player has his own view, a camera
// over his right shoulder (the screen split for two, three or four); whatever stands between it and him
// dissolves (cutaway.ts). The light runs from moonlight to dawn through the mission, and night-vision
// goggles turn a player's view to the green of an image intensifier.
import * as THREE from 'three';
import { loadCast, loadMoves, type Cast, type Moves } from '@people/people.ts';
import { loadGuns, type Guns } from '@armoury/armoury.ts';
import { layout as split } from '@world/screen.ts';
import { setCuts } from './cutaway.ts';
import { Helicopter } from './helicopter.ts';
import { buildLand, landHeight, loadLand, type Land, type LandAssets } from './land.ts';
import { height, LZ } from './map.ts';
import { Life, Side, type Flare, type Sim, type SimEvent, type Soldier } from './sim.ts';
import { SoldierView } from './soldier.ts';

// The light of the hours we fight through: deep night (a moon), dawn, day
interface Light { sun: string; sunI: number; dir: [number, number, number]; env: number; fog: string; density: number; exposure: number }
const NIGHT: Light = { sun: '#93a9ff', sunI: 0.5, dir: [-0.4, 1, 0.55], env: 0.05, fog: '#080c14', density: 0.011, exposure: 1.3 };
const DAWN: Light = { sun: '#ffae73', sunI: 1.6, dir: [1, 0.28, 0.25], env: 0.3, fog: '#6c6872', density: 0.0085, exposure: 1.0 };
const DAY: Light = { sun: '#fff0d8', sunI: 2.6, dir: [-0.6, 1.1, 0.5], env: 0.6, fog: '#a7aea8', density: 0.0075, exposure: 0.9 };

// The camera over a player's shoulder (m), how fast it swings round behind him, its field of view
const CHASE = { back: 3.4, up: 1.6, right: 0.65, crouchUp: 1.2, ahead: 12, swing: 2.4, aimSwing: 5, fov: 50, fovWide: 38, downBack: 6.5, downUp: 4 };
const DEMO = { back: 11, up: 6, ahead: 14 }; // (the lobby's camera: higher, further back)

// --- loading ------------------------------------------------------------------------------------------------
export interface World { cast: Cast; moves: Moves; guns: Guns; land: LandAssets }

export async function loadWorld(): Promise<World> {
  const [cast, moves, guns, land] = await Promise.all([loadCast('infantry'), loadMoves('infantry-moves'), loadGuns(), loadLand()]);
  return { cast, moves, guns, land };
}

// The finished picture of a view: tone-mapped, graded like a war film; or through night-vision
// goggles: brightened many times over into green, with the grain of the tube and its round edge
const POST = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, exposure: { value: 1 }, nvg: { value: 0 }, gain: { value: 1 }, time: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse; uniform float exposure, nvg, gain, time, aspect; varying vec2 vUv;
vec3 aces(vec3 x) { x *= exposure; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 37.0) * 43758.5453); }
void main() {
  vec3 hdr = texture2D(tDiffuse, vUv).rgb;
  vec2 v = vUv - 0.5;
  if (nvg > 0.5) {
    float l = dot(hdr, vec3(0.3, 0.59, 0.11)) * gain;
    l = 1.0 - exp(-l * 1.6);
    l += (hash(vUv * 900.0) - 0.5) * 0.12; // (the tube's grain)
    vec2 r = vec2(v.x * aspect, v.y) / max(aspect, 1.0) * 2.0;
    float edge = smoothstep(1.02, 0.86, length(r * vec2(0.62, 1.0))); // (its round field)
    vec3 c = mix(vec3(0.02, 0.08, 0.03), vec3(0.62, 1.0, 0.55), clamp(l, 0.0, 1.0)) * edge;
    gl_FragColor = vec4(srgb(c), 1.0);
    return;
  }
  vec3 c = aces(hdr);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.84);
  c *= mix(vec3(0.95, 0.98, 1.04), vec3(1.04, 1.0, 0.93), smoothstep(0.2, 0.8, l));
  c *= 1.0 - dot(v, v) * 0.6;
  gl_FragColor = vec4(srgb(c), 1.0);
}`,
};

// --- a player's view ---------------------------------------------------------------------------------------------------
interface Eye {
  id: string; // the player's (or 'demo')
  cam: THREE.PerspectiveCamera;
  yaw: number; // the way the camera looks (the sim's yaw)
  pos: THREE.Vector3;
  rt: THREE.WebGLRenderTarget;
  rect: { x: number; y: number; w: number; h: number }; // CSS px, from the top left
  nvg: boolean;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private sunDir = new THREE.Vector3(0, 1, 0);
  private land: Land;
  private heli = new Helicopter();
  private soldiers = new Map<Soldier, SoldierView>();
  private eyes: Eye[] = [];
  private tracers: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; len: number }[] = [];
  private puffs = new Puffs(900, THREE.NormalBlending);
  private smoke = new Puffs(600, THREE.NormalBlending);
  private fire = new Puffs(500, THREE.AdditiveBlending);
  private grenades = new Map<object, THREE.Mesh>();
  private flares = new Map<Flare, THREE.Sprite>();
  private flareLights = [0, 1].map(() => new THREE.PointLight(0xffd9b0, 0, 70, 1.2)); // (a fixed few: adding lights recompiles every material)
  private flash = new THREE.PointLight(0xffc070, 0, 22, 1.5);
  private post: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private burning: THREE.Vector3[] = [];
  private t = 0;
  private dark = 1;
  shake = 0;

  constructor(canvas: HTMLCanvasElement, private world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(world.land.sky).texture;
    pmrem.dispose();
    this.scene.fog = new THREE.FogExp2(NIGHT.fog, NIGHT.density);
    this.scene.background = new THREE.Color(NIGHT.fog);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 5; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, this.flash, ...this.flareLights, this.heli.group);
    this.land = buildLand(world.land);
    this.scene.add(this.land.group, this.puffs.points, this.smoke.points, this.fire.points);
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...POST, depthTest: false, depthWrite: false }));
    this.post.frustumCulled = false;
    this.postScene.add(this.post);
    this.setEyes([]);
  }

  // The views: one per player (in the order given), or the lobby's one
  setEyes(ids: string[]) {
    const want = ids.length ? ids : ['demo'];
    if (want.join() === this.eyes.map((e) => e.id).join()) return;
    for (const e of this.eyes) e.rt.dispose();
    const old = new Map(this.eyes.map((e) => [e.id, e]));
    this.eyes = want.map((id) => {
      const was = old.get(id);
      return {
        id, cam: new THREE.PerspectiveCamera(CHASE.fov, 16 / 9, 0.15, 600), yaw: was?.yaw ?? 0, pos: was?.pos ?? new THREE.Vector3(),
        rt: new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 }), rect: { x: 0, y: 0, w: 1, h: 1 }, nvg: was?.nvg ?? false,
      };
    });
    this.layout();
  }

  layout() {
    const W = innerWidth, H = innerHeight;
    this.renderer.setSize(W, H, false);
    const rects = split(this.eyes.length);
    const pr = this.renderer.getPixelRatio();
    this.eyes.forEach((e, i) => {
      const r = rects[i];
      e.rect = { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };
      e.cam.aspect = e.rect.w / e.rect.h;
      e.cam.fov = e.cam.aspect > 2.4 ? CHASE.fovWide : CHASE.fov;
      e.cam.updateProjectionMatrix();
      e.rt.setSize(Math.round(e.rect.w * pr), Math.round(e.rect.h * pr));
    });
  }

  get views() { return this.eyes.map((e) => ({ id: e.id, rect: e.rect, nvg: e.nvg })); }
  get listener() { return this.eyes[0]?.cam.position ?? new THREE.Vector3(); }
  camYaw(id: string) { return this.eyes.find((e) => e.id === id)?.yaw ?? 0; }
  nvg(id: string) { return this.eyes.find((e) => e.id === id)?.nvg ?? false; }
  setNvg(id: string, on: boolean) { const e = this.eyes.find((q) => q.id === id); if (e) e.nvg = on; }

  // Where a point is in a player's view: CSS px on the page (and whether it's in front of him)
  project(id: string, x: number, y: number, z: number) {
    const e = this.eyes.find((q) => q.id === id) ?? this.eyes[0];
    const p = new THREE.Vector3(x, y, z).project(e.cam);
    return { x: e.rect.x + ((p.x + 1) / 2) * e.rect.w, y: e.rect.y + ((1 - p.y) / 2) * e.rect.h, front: p.z < 1, rect: e.rect };
  }

  // --- what happened ---------------------------------------------------------------------------------------------------
  react(e: SimEvent) {
    if (e.type === 'shot') {
      const v = this.soldiers.get(e.from);
      const from = v ? v.muzzleAt() : new THREE.Vector3(e.from.x, height(e.from.x, e.from.z) + 1.4, e.from.z);
      const ground = height(e.to.x, e.to.z);
      const to = new THREE.Vector3(e.to.x, ground + e.to.y, e.to.z);
      if (v) v.flashT = 0.05;
      if (Math.random() < 0.45) this.tracer(from, to, e.from.side === Side.Allies ? '#ff9a4a' : '#9dff6a');
      if (e.hit) this.puffs.burst(to, 6, 1.6, new THREE.Color('#5a1612'), 0.3, 0.5);
      else this.puffs.burst(new THREE.Vector3(e.to.x, ground + Math.max(0.1, e.to.y * 0.3), e.to.z), 5, 1.2, new THREE.Color('#7d705c'), 0.45, 0.8);
      this.flash.position.copy(from);
      this.flash.intensity = Math.max(this.flash.intensity, 8);
    } else if (e.type === 'bang') {
      const at = new THREE.Vector3(e.x, height(e.x, e.z) + 0.3, e.z);
      this.fire.burst(at, 40, 7, new THREE.Color('#ffb060'), 1.6, 0.4);
      this.smoke.burst(at, 30, 3, new THREE.Color('#3e3a36'), 3, 3);
      this.puffs.burst(at, 40, 8, new THREE.Color('#6f6250'), 0.8, 1.2);
      this.flash.position.set(e.x, at.y + 1.7, e.z);
      this.flash.intensity = 80;
      this.shake = Math.min(1, this.shake + 0.7);
      this.scene.add(scorch(e.x, e.z));
    } else if (e.type === 'throw') this.soldiers.get(e.who)?.strike('throw');
    else if (e.type === 'stab') {
      this.soldiers.get(e.who)?.strike('knife');
      this.puffs.burst(new THREE.Vector3(e.target.x, height(e.target.x, e.target.z) + 1.2, e.target.z), 8, 1.4, new THREE.Color('#5a1612'), 0.25, 0.5);
    } else if (e.type === 'hurt') {
      const v = this.soldiers.get(e.who);
      if (v) v.flinch = 1;
    } else if (e.type === 'blown') {
      // the gun: thrown askew, blackened, burning from then on
      const gun = this.land.gun;
      if (gun) {
        gun.rotation.z += 0.18; gun.rotation.x -= 0.1; gun.position.y -= 0.15;
        gun.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const c = (m.material as THREE.MeshStandardMaterial).clone(); c.color.multiplyScalar(0.3); m.material = c; } });
        this.burning.push(gun.position.clone().add(new THREE.Vector3(0, 1, 0)));
      }
    }
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3, color: string) {
    const mesh = new THREE.Mesh(TRACER, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.scene.add(mesh);
    this.tracers.push({ mesh, from, to, t: 0, len: from.distanceTo(to) });
  }

  // --- each frame --------------------------------------------------------------------------------------------------------
  frame(sim: Sim, dt: number) {
    this.t += dt;
    this.light(sim.dark, dt);
    this.syncSoldiers(sim, dt);
    this.syncGrenades(sim);
    this.syncFlares(sim);
    this.effects(dt);
    this.heli.update(dt, sim.helo, sim.heloT, this.dark);
    if (this.heli.wash > 0.05) for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
      this.puffs.emit(LZ.x + Math.cos(a) * r, landHeight(LZ.x, LZ.z) + 0.3, LZ.z + Math.sin(a) * r, Math.cos(a) * 6, 0.6, Math.sin(a) * 6, new THREE.Color('#8a7d66'), 1.2 * this.heli.wash, 1.4);
    }
    this.land.update(this.t);
    for (const e of this.eyes) this.chase(e, sim, dt);
    this.render();
  }

  // The light for how dark it is (1 night, 0.35 dawn, 0 day)
  private light(dark: number, dt: number) {
    this.dark += (dark - this.dark) * Math.min(1, dt * 0.5);
    const d = this.dark;
    const [a, b, k] = d > 0.6 ? [DAWN, NIGHT, (d - 0.6) / 0.4] : [DAY, DAWN, d / 0.6];
    const mix = (x: number, y: number) => x + (y - x) * k;
    this.sun.color.set(a.sun).lerp(new THREE.Color(b.sun), k);
    this.sun.intensity = mix(a.sunI, b.sunI);
    this.sunDir.set(mix(a.dir[0], b.dir[0]), mix(a.dir[1], b.dir[1]), mix(a.dir[2], b.dir[2])).normalize();
    this.scene.environmentIntensity = mix(a.env, b.env);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(a.fog).lerp(new THREE.Color(b.fog), k);
    fog.density = mix(a.density, b.density);
    (this.scene.background as THREE.Color).copy(fog.color);
    (this.post.material as THREE.ShaderMaterial).uniforms.exposure.value = mix(a.exposure, b.exposure);
    this.land.night(d);
  }

  private syncSoldiers(sim: Sim, dt: number) {
    const live = new Set(sim.soldiers);
    for (const s of sim.soldiers) {
      let v = this.soldiers.get(s);
      if (!v) { v = new SoldierView(s, this.world.cast, this.world.moves, this.world.guns, this.scene); this.soldiers.set(s, v); }
      // goggles: a player's as he chooses; his squad's down in the dark
      v.nvg = s.human ? this.nvg(s.human) : sim.dark > 0.6;
      const t = s.target && s.target.alive ? s.target : null;
      v.update(dt, t ? new THREE.Vector3(t.x, height(t.x, t.z) + (t.crouched ? 0.95 : 1.35), t.z) : null);
    }
    for (const [s, v] of this.soldiers) if (!live.has(s)) { v.remove(this.scene); this.soldiers.delete(s); }
  }

  private syncGrenades(sim: Sim) {
    const live = new Set<object>(sim.grenades);
    for (const g of sim.grenades) {
      let m = this.grenades.get(g);
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: '#3a3f2a', roughness: 0.6 }));
        m.castShadow = true;
        this.scene.add(m);
        this.grenades.set(g, m);
      }
      m.position.set(g.x, height(g.x, g.z) + g.y, g.z);
    }
    for (const [g, m] of this.grenades) if (!live.has(g)) { this.scene.remove(m); this.grenades.delete(g); }
  }

  // Flares: a hard white light swinging down under its parachute, smoke trailing up from it
  private syncFlares(sim: Sim) {
    const live = new Set(sim.flares);
    for (const f of sim.flares) {
      let s = this.flares.get(f);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#fff0d8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        s.scale.setScalar(5);
        this.scene.add(s);
        this.flares.set(f, s);
      }
      const y = height(f.x, f.z) + f.y;
      s.position.set(f.x + Math.sin(this.t * 1.3) * 0.6, y, f.z);
      if (Math.random() < 0.3) this.smoke.emit(s.position.x, y, s.position.z, 0, 0.4, 0, new THREE.Color('#9a9894'), 1.2, 3);
    }
    for (const [f, s] of this.flares) if (!live.has(f)) { this.scene.remove(s); this.flares.delete(f); }
    const list = [...this.flares.values()];
    this.flareLights.forEach((l, i) => {
      const s = list[i];
      l.intensity = s ? 220 * (0.85 + Math.random() * 0.15) : 0;
      if (s) l.position.copy(s.position);
    });
  }

  private effects(dt: number) {
    const SPEED = 320, LEN = 4; // m/s a tracer flies, m long its streak
    for (const tr of this.tracers) {
      tr.t += dt;
      const head = Math.min(tr.len, tr.t * SPEED), tail = Math.max(0, head - LEN);
      const dir = tr.to.clone().sub(tr.from).normalize();
      const a = tr.from.clone().addScaledVector(dir, tail), b = tr.from.clone().addScaledVector(dir, head);
      tr.mesh.position.copy(a).add(b).multiplyScalar(0.5);
      tr.mesh.quaternion.setFromUnitVectors(UP, dir);
      tr.mesh.scale.set(1, Math.max(0.01, head - tail), 1);
    }
    const gone = (q: { t: number; len: number }) => q.t * SPEED - LEN > q.len;
    for (const tr of this.tracers.filter(gone)) { this.scene.remove(tr.mesh); (tr.mesh.material as THREE.Material).dispose(); }
    this.tracers = this.tracers.filter((q) => !gone(q));
    for (const r of this.land.smoke) if (Math.random() < 0.18) this.smoke.emit(r.x + (Math.random() - 0.5) * 3, r.y, r.z + (Math.random() - 0.5) * 3, 0.5, 1.6, 0.2, new THREE.Color('#5d5856'), 1.6, 4.5);
    for (const r of this.burning) {
      if (Math.random() < 0.5) this.fire.emit(r.x + (Math.random() - 0.5), r.y, r.z + (Math.random() - 0.5), 0, 1.5, 0, new THREE.Color('#ff9a40'), 0.7, 0.6);
      if (Math.random() < 0.3) this.smoke.emit(r.x, r.y + 1, r.z, 0.4, 2, 0.2, new THREE.Color('#2a2725'), 2, 5);
    }
    this.puffs.update(dt, -2);
    this.smoke.update(dt, 0.3);
    this.fire.update(dt, 1);
    this.flash.intensity *= Math.max(0, 1 - dt * 14);
    this.shake = Math.max(0, this.shake - dt * 2);
  }

  // A view's camera: over its player's right shoulder, swinging round behind him as he goes, turning to
  // what he's shooting at; pulled in where a hedge or a wall is behind him; further back while he's down
  private chase(e: Eye, sim: Sim, dt: number) {
    const s = e.id === 'demo' ? sim.humans.find((q) => q.alive) ?? sim.humans[0] : sim.soldiers.find((q) => q.human === e.id);
    if (!s) return;
    const sp = Math.hypot(s.vx, s.vz);
    const move = Math.atan2(s.vx, -s.vz);
    const aiming = !!s.target && s.firing;
    const want = aiming ? s.facing : sp > 0.8 ? move : e.yaw;
    const rate = aiming ? CHASE.aimSwing : CHASE.swing * Math.min(1, sp / 3);
    e.yaw += THREE.MathUtils.clamp(angDiff(want, e.yaw), -rate * dt, rate * dt);
    const fwd = new THREE.Vector3(Math.sin(e.yaw), 0, -Math.cos(e.yaw)), right = fwd.clone().cross(UP);
    const ground = height(s.x, s.z);
    const down = s.life !== Life.Fine;
    const demo = e.id === 'demo';
    const back = demo ? DEMO.back : down ? CHASE.downBack : CHASE.back;
    const up = demo ? DEMO.up : down ? CHASE.downUp : s.crouched ? CHASE.crouchUp : CHASE.up;
    const pivot = new THREE.Vector3(s.x, ground + (s.crouched ? 1.1 : 1.55), s.z);
    const want3 = new THREE.Vector3(s.x, ground + up, s.z).addScaledVector(fwd, -back).addScaledVector(right, demo ? 0 : CHASE.right);
    // (not into a hedge or a building behind him)
    const d = want3.clone().sub(pivot);
    let k = 1;
    for (let t = 0.15; t <= 1; t += 0.05) {
      const p = pivot.clone().addScaledVector(d, t);
      if (sim.grid.at(p.x, p.z) === 1 && p.y < landHeight(p.x, p.z) + 3.4) { k = Math.max(0.25, t - 0.12); break; }
    }
    const target = pivot.clone().addScaledVector(d, k);
    if (e.pos.lengthSq() === 0) e.pos.copy(target);
    e.pos.lerp(target, Math.min(1, dt * 9));
    const shake = this.shake * 0.25;
    e.cam.position.copy(e.pos).add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    e.cam.lookAt(pivot.clone().addScaledVector(fwd, demo ? DEMO.ahead : CHASE.ahead).add(new THREE.Vector3(0, demo ? -2 : -0.4, 0)));
  }

  private render() {
    const r = this.renderer;
    const post = this.post.material as THREE.ShaderMaterial;
    post.uniforms.time.value = this.t;
    const sc = this.sun.shadow.camera;
    for (const e of this.eyes) {
      // the sun's shadows round what this view looks at (snapped to their texels, so they don't crawl)
      const at = e.cam.position.clone().add(e.cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(18));
      const snap = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
      at.x = Math.round(at.x / snap) * snap; at.z = Math.round(at.z / snap) * snap;
      this.sun.position.copy(at).addScaledVector(this.sunDir, 90);
      this.sun.target.position.copy(at);
      this.sun.target.updateMatrixWorld();
      // the player seen through whatever is in the way
      const s = e.id === 'demo' ? null : this.playerOf(e.id);
      setCuts(e.cam, s ? [{ x: s.x, y: height(s.x, s.z) + 1.1, z: s.z }] : [], e.rt.width, e.rt.height);
      // (anyone right in front of the lens: not drawn, rather than filling the view)
      const near: THREE.Object3D[] = [];
      for (const [q, v] of this.soldiers) if (q !== s && Math.hypot(q.x - e.cam.position.x, q.z - e.cam.position.z) < 1.6) { near.push(v.person.root); v.person.root.visible = false; }
      r.setRenderTarget(e.rt);
      r.clear();
      r.render(this.scene, e.cam);
      for (const o of near) o.visible = true;
    }
    r.setRenderTarget(null);
    r.setScissorTest(true);
    const H = innerHeight;
    for (const e of this.eyes) {
      r.setViewport(e.rect.x, H - e.rect.y - e.rect.h, e.rect.w, e.rect.h);
      r.setScissor(e.rect.x, H - e.rect.y - e.rect.h, e.rect.w, e.rect.h);
      post.uniforms.tDiffuse.value = e.rt.texture;
      post.uniforms.nvg.value = e.nvg ? 1 : 0;
      post.uniforms.gain.value = 0.35 + this.dark ** 3 * 9; // (the tube is made for the dark: in the dawn it's near white)
      post.uniforms.aspect.value = e.rect.w / e.rect.h;
      r.render(this.postScene, this.postCam);
    }
    r.setScissorTest(false);
  }

  private playerOf(id: string) { for (const s of this.soldiers.keys()) if (s.human === id) return s; return null; }
}

const UP = new THREE.Vector3(0, 1, 0);
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const TRACER = new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true);

function glow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.4)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glow();

// A blast's mark on the ground: a scorched patch, lying on the land's shape
const SCORCH = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(20,16,12,0.95)'); r.addColorStop(0.45, 'rgba(34,28,22,0.75)'); r.addColorStop(1, 'rgba(40,34,26,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 40;
    g.fillStyle = `rgba(28,22,16,${0.2 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + Math.random() * 4, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
})();
function scorch(x: number, z: number) {
  const g = new THREE.PlaneGeometry(4.4, 4.4, 8, 8);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.random() * Math.PI * 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, landHeight(x + p.getX(i), z + p.getZ(i)) + 0.04);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, SCORCH);
  m.position.set(x, 0, z);
  m.receiveShadow = true;
  return m;
}

// Soft particles that drift and fade: dust, smoke, fire, blood
class Puffs {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private base: Float32Array;
  private size: Float32Array; private life: Float32Array; private full: Float32Array;
  private next = 0;
  constructor(private n: number, blending: THREE.Blending) {
    this.pos = new Float32Array(n * 3).fill(-1e4);
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
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: GLOW } },
      vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * 900.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * 0.85); }',
      blending, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number) {
    const k = this.next++ % this.n;
    this.pos.set([x, y, z], k * 3);
    this.vel.set([vx, vy, vz], k * 3);
    this.base.set([c.r, c.g, c.b], k * 3);
    this.size[k] = size;
    this.life[k] = this.full[k] = life;
  }
  burst(at: THREE.Vector3, count: number, speed: number, c: THREE.Color, size: number, life: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const v = speed * (0.3 + Math.random() * 0.7);
      this.emit(at.x, at.y, at.z, Math.cos(a) * v * (1 - up * 0.5), up * v, Math.sin(a) * v * (1 - up * 0.5), c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8));
    }
  }
  update(dt: number, gravity: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e4; this.size[k] = 0; continue; }
      const f = this.life[k] / this.full[k];
      this.vel[k * 3 + 1] += gravity * dt;
      for (let j = 0; j < 3; j++) {
        this.vel[k * 3 + j] *= 1 - 1.2 * dt;
        this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
        this.col[k * 3 + j] = this.base[k * 3 + j] * (0.6 + 0.4 * f);
      }
      this.size[k] *= 1 + dt * 0.6;
      if (f < 0.3) this.size[k] *= 1 - dt * 3;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}
