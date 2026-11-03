// Drawing the fight: the battleground (the quarry's gravel and terraced rock, the desert's red sand and
// mesas, the snowfield's pines, the city's blocks and streets at night), every bot as its Rig, shots in
// flight, scrap, sparks, fire and smoke, and a camera behind each of you, the screen split for two to four.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { layout, type Rect } from '@world/screen.ts';
import { reflections, sky, type Light } from '@world/sky.ts';
import { Particles } from '@world/particles.ts';
import { Precipitation } from '@world/precipitation.ts';
import { canvas, noise2, seeded, texture } from '@world/draw.ts';
import { parkedCar, Rig, still, type Body, type GunKind, type Pose } from './rig.ts';
import type { Livery } from './paint.ts';
import type { Arena, Look, Rock } from './arena.ts';
import { gun, type Bot, type Sim, type SimEvent } from './sim.ts';

// Each battleground's light, sky and colours
// (sky: a photographed sky from Poly Haven, env/<sky>.hdr; floor, rocks: photo textures, env/<name>_diff.jpg...)
interface Scenery {
  light: Light; fog: [number, number]; hemi: [number, number, number]; ground: string;
  floor: number; grain: number; wall: number; rock: number; snow?: boolean; night?: boolean;
  sky: string; skyLight: number; floorTex: string; rockTex: string; tile: number;
}
const SCENERY: Record<Look, Scenery> = {
  quarry: { light: { sky: ['#5f8fc4', '#d9c9a8'], sun: [0xfff1d6, 2.6], sunAt: [40, 60, 25], dim: 1 }, fog: [90, 260], hemi: [0xcfe0ff, 0x6b5d4a, 0.9],
    ground: '#9a8c78', floor: 0xd8ccb8, grain: 0xb8ab95, wall: 0xc8b8a0, rock: 0xc8b8a0,
    sky: 'kloofendal_48d_partly_cloudy_puresky', skyLight: 0.9, floorTex: 'sandy_gravel_02', rockTex: 'rock_face_03', tile: 5 },
  desert: { light: { sky: ['#3f7fd0', '#f2c99a'], sun: [0xffe2b0, 3.0], sunAt: [-50, 55, 30], dim: 1 }, fog: [120, 340], hemi: [0xbfdcff, 0x9a5a36, 0.8],
    ground: '#c27a4a', floor: 0xf0b088, grain: 0xd9925e, wall: 0xe09070, rock: 0xd88a62,
    sky: 'goegap', skyLight: 0.95, floorTex: 'sand_01', rockTex: 'sandstone_cracks', tile: 6 },
  snow: { light: { sky: ['#8fa6c0', '#e4eaf0'], sun: [0xf2f6ff, 1.7], sunAt: [30, 40, -40], dim: 0.9 }, fog: [45, 190], hemi: [0xe0ecff, 0xb8c4d0, 1.25],
    ground: '#dfe6ee', floor: 0xffffff, grain: 0xe2e8ee, wall: 0xd8dee6, rock: 0xb0b8c2, snow: true,
    sky: 'horn-koppe_snow', skyLight: 0.85, floorTex: 'snow_02', rockTex: 'rock_face_03', tile: 5 },
  city: { light: { sky: ['#03060e', '#1b2236'], sun: [0x9fb4ff, 0.45], sunAt: [30, 70, -20], dim: 0.25, lamps: true }, fog: [40, 170], hemi: [0x5a6aa0, 0x1c1f28, 1.1],
    ground: '#202329', floor: 0x8a8d94, grain: 0x2c2f35, wall: 0x2a2d33, rock: 0x8c8f96, night: true,
    sky: 'hansaplatz', skyLight: 0.6, floorTex: 'asphalt_02', rockTex: 'gravel_concrete', tile: 4 },
};
const CHASE = { robotBack: 10.5, robotUp: 5.2, carBack: 9, carUp: 3.4, ahead: 8, swing: 2.6 };
const UP = new THREE.Vector3(0, 1, 0);

interface View { rect: Rect; cam: THREE.PerspectiveCamera; bot: Bot; yaw: number; pos: THREE.Vector3; shake: number }
// What's drawn round a bot besides its rig: a health bar (the enemy), a shield, the ring that fills as a
// friend gets it up
interface Extras { bar?: { back: THREE.Sprite; fill: THREE.Sprite }; shield?: THREE.Mesh; ring?: THREE.Mesh; ringAt?: number }

export class Battle {
  readonly scene = new THREE.Scene();
  views: View[] = [];
  private rigs = new Map<Bot, Rig>();
  private extras = new Map<Bot, Extras>();
  // (health bars stay the same size on the screen however near or far)
  private barBack = new THREE.SpriteMaterial({ color: 0x0e1016, opacity: 0.75, transparent: true, depthTest: false, sizeAttenuation: false });
  private barFill = new THREE.SpriteMaterial({ color: 0xff4433, depthTest: false, sizeAttenuation: false });
  private shieldMat = new THREE.MeshBasicMaterial({ color: 0x3fb8ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xd7ff3b, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  private sun = new THREE.DirectionalLight();
  private floorMat: THREE.Material | null = null;
  private look: Scenery = SCENERY.quarry;
  private snowfall: Precipitation | null = null;
  private bolts: THREE.InstancedMesh; // (the shots as tracers: a bright core...)
  private halos: THREE.InstancedMesh; // (...in a soft glow)
  private flashes = new Particles(240, 0xfff0c0, 1.6, THREE.AdditiveBlending);
  private shells: THREE.InstancedMesh;
  private scraps: THREE.InstancedMesh;
  private sparks = new Particles(600, 0xffd27a, 0.35, THREE.AdditiveBlending);
  private fire = new Particles(400, 0xff7a2a, 1.6, THREE.AdditiveBlending, 0.9);
  private smoke = new Particles(400, 0x3a3631, 3.2, THREE.NormalBlending, 0.45);
  private t = 0;
  private radius = 70;
  private colour = new THREE.Color();
  private m = new THREE.Matrix4();

  constructor(private renderer: THREE.WebGLRenderer, private rich: boolean, private bodyOf: (b: Bot) => Body, private liveryOf: (b: Bot) => Livery) {
    // (a unit-long tube along +z, its head at the front: stretched to each kind of shot's length)
    const tube = (r: number) => new THREE.CylinderGeometry(r, r, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    // (the core solid, so it shows against bright sand or snow; the glow added on)
    this.bolts = new THREE.InstancedMesh(tube(0.06), new THREE.MeshBasicMaterial({ toneMapped: false }), 600);
    this.halos = new THREE.InstancedMesh(tube(0.2), new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.4, depthWrite: false }), 600);
    for (const m of [this.bolts, this.halos]) m.setColorAt(0, new THREE.Color()); // (so their shaders are built with a colour per shot)
    this.shells = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb14a, toneMapped: false }), 60);
    this.scraps = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0xd7ff3b, emissive: 0x9ab826, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3 }), 120);
    for (const m of [this.bolts, this.halos, this.shells, this.scraps]) { m.count = 0; m.frustumCulled = false; this.scene.add(m); }
    this.scene.add(this.sparks.points, this.fire.points, this.smoke.points, this.flashes.points);
  }

  // The battleground: built once per fight (its sky and textures are fetched first)
  async setup(arena: Arena) {
    const s = this.scene, look = (this.look = SCENERY[arena.id]), L = look.light;
    this.radius = arena.radius;
    s.fog = new THREE.Fog(L.sky[1], look.fog[0] * (arena.radius / 70), look.fog[1] * (arena.radius / 70));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const [sky360, ground, stone2] = await Promise.all([
      new HDRLoader().loadAsync(`env/${look.sky}.hdr`).catch(() => null), photo(look.floorTex, this.renderer), photo(look.rockTex, this.renderer),
    ]);
    if (sky360) {
      // the photographed sky: seen all round, and what lights everything and shines in the paint
      sky360.mapping = THREE.EquirectangularReflectionMapping;
      s.background = sky360;
      s.backgroundIntensity = look.skyLight;
      s.environment = pmrem.fromEquirectangular(sky360).texture;
      s.environmentIntensity = look.skyLight;
    } else {
      s.background = new THREE.Color(L.sky[1]);
      s.add(sky(L.sky[0], L.sky[1], 900));
      if (look.night) s.add(stars());
      s.environment = pmrem.fromScene(reflections(L, look.ground), 0.03).texture;
      s.environmentIntensity = look.night ? 0.75 : 0.8;
    }
    this.sun.color.set(L.sun[0]);
    this.sun.intensity = L.sun[1];
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40; sc.right = sc.top = 40; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target, new THREE.HemisphereLight(...look.hemi));

    // the floor (sand, gravel, snow or tarmac), out past the walls
    const size = arena.radius + 70;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(size, 128).rotateX(-Math.PI / 2), surface(ground, (size * 2) / look.tile, look.floor));
    floor.receiveShadow = true;
    s.add(floor);
    this.floorMat = surface(ground, 30, look.floor);
    const rock = surface(stone2, 1, look.rock, THREE.DoubleSide);
    if (arena.id === 'city') this.city(arena, surface(stone2, 1, 0xb8bbc0));
    else this.walls(arena, surface(stone2, 1, look.wall, THREE.DoubleSide, [Math.round((arena.radius * 2 * Math.PI) / 9), 2]));
    this.rocks(arena.rocks.filter((r) => r.kind === 'rock' || r.kind === 'pillar' || r.kind === 'mesa'), rock);
    if (arena.id === 'snow') {
      this.trees(arena.rocks.filter((r) => r.kind === 'tree'));
      this.snowfall = new Precipitation(true, 3000);
      this.snowfall.set(0.55);
      s.add(this.snowfall.object);
    }
  }

  // Three terraces of rock round the edge (red sandstone in the desert, icy in the snow)
  private walls(arena: Arena, mat: THREE.Material) {
    const n = noise2(5);
    [[arena.radius + 2, 9], [arena.radius + 14, 17], [arena.radius + 28, 26]].forEach(([r, h], i) => {
      const wall = new THREE.CylinderGeometry(r, r + 3, h, 160, 6, true);
      const p = wall.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), z = p.getZ(k), y = p.getY(k), a = Math.atan2(z, x), bump = (n(a * 8 + i * 3, y * 0.25 + i) - 0.5) * 3.4;
        p.setX(k, x * (1 + bump / r)); p.setZ(k, z * (1 + bump / r));
      }
      wall.computeVertexNormals();
      const m = new THREE.Mesh(wall.translate(0, h / 2 - 0.5, 0), mat);
      m.receiveShadow = true;
      this.scene.add(m);
      const ledge = new THREE.Mesh(new THREE.RingGeometry(r + 2, r + 14, 160, 1).rotateX(-Math.PI / 2).translate(0, h - 0.5, 0), this.floorMat!);
      ledge.receiveShadow = true;
      this.scene.add(ledge);
    });
  }

  // Boulders, pillars and mesas: lumpy stone, all one mesh
  private rocks(list: Rock[], mat: THREE.Material) {
    if (!list.length) return;
    const n = noise2(5), rnd = seeded(9), lumps: THREE.BufferGeometry[] = [];
    for (const r of list) {
      const tall = r.kind !== 'rock', mesa = r.kind === 'mesa';
      const g = tall ? new THREE.CylinderGeometry(r.r * (mesa ? 0.92 : 0.8), r.r * (mesa ? 1.12 : 1), r.h, mesa ? 24 : 12, 8) : new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position, seed = rnd() * 100;
      for (let k = 0; k < p.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, k), f = 1 + (n(v.x * 1.7 + seed, v.y * (mesa ? 0.5 : 1.7) + v.z * 1.3) - 0.5) * (mesa ? 0.18 : tall ? 0.35 : 0.55);
        if (tall) { p.setX(k, v.x * f); p.setZ(k, v.z * f); } else p.setXYZ(k, v.x * f, v.y * f, v.z * f);
      }
      if (!tall) g.scale(r.r, r.h, r.r);
      g.translate(r.x, tall ? r.h / 2 : r.h * 0.35, r.z);
      lumps.push(g.toNonIndexed());
    }
    const merged = mergeAll(lumps);
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // Pines: a trunk and three tiers of needles, snow lying on each
  private trees(list: Rock[]) {
    const trunks: THREE.BufferGeometry[] = [], needles: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [], rnd = seeded(13);
    for (const t of list) {
      const h = t.h, a = rnd() * Math.PI;
      trunks.push(new THREE.CylinderGeometry(t.r * 0.35, t.r * 0.5, h * 0.4, 8).translate(t.x, h * 0.2, t.z).toNonIndexed());
      for (let i = 0; i < 3; i++) {
        const y = h * (0.3 + i * 0.22), w = t.r * (2.5 - i * 0.6), tall = h * 0.36;
        needles.push(new THREE.ConeGeometry(w, tall, 9).rotateY(a + i).translate(t.x, y + tall / 2, t.z).toNonIndexed());
        caps.push(new THREE.ConeGeometry(w * 0.62, tall * 0.42, 9).rotateY(a + i).translate(t.x, y + tall * 0.82, t.z).toNonIndexed());
      }
    }
    for (const [list2, color] of [[trunks, 0x4a3628], [needles, 0x23402e], [caps, 0xf4f7fb]] as const) {
      const g = mergeAll(list2);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // The city at night: lit-up blocks on their pavements, a skyline all round, the streets marked out,
  // street lamps (a few of them really lighting the way), parked cars and concrete barriers
  private city(arena: Arena, concrete: THREE.MeshStandardMaterial) {
    const s = this.scene, rnd = seeded(17);
    const windows = officeWindows();
    const facade = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, map: windows, emissiveMap: windows, emissive: 0xffe2a8, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.2 });
    const boxes: THREE.BufferGeometry[] = [], kerbs: THREE.BufferGeometry[] = [];
    for (const r of arena.rocks) if (r.kind === 'building') {
      boxes.push(towerBox(r.w! * 2, r.h, r.d! * 2).translate(r.x, r.h / 2, r.z).toNonIndexed());
      kerbs.push(new THREE.BoxGeometry(r.w! * 2 + 3, 0.18, r.d! * 2 + 3).translate(r.x, 0.09, r.z).toNonIndexed());
    }
    // the skyline: towers in a ring beyond the edge
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, d = arena.radius + 10 + rnd() * 30, w = 10 + rnd() * 14, h = 25 + rnd() * 70;
      boxes.push(towerBox(w, h, w).rotateY(-a).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d).toNonIndexed());
    }
    const towers = new THREE.Mesh(mergeAll(boxes), facade);
    towers.geometry.computeVertexNormals();
    towers.castShadow = towers.receiveShadow = true;
    const pavement = new THREE.Mesh(mergeAll(kerbs), concrete);
    pavement.geometry.computeVertexNormals();
    pavement.receiveShadow = true;
    s.add(towers, pavement);
    // the lines down the middle of the streets
    const lines: THREE.BufferGeometry[] = [];
    for (const k of [-45, -15, 15, 45]) for (let t = -95; t < 95; t += 6) {
      lines.push(new THREE.PlaneGeometry(0.25, 3).rotateX(-Math.PI / 2).translate(k, 0.02, t).toNonIndexed());
      lines.push(new THREE.PlaneGeometry(3, 0.25).rotateX(-Math.PI / 2).translate(t, 0.02, k).toNonIndexed());
    }
    const paint = new THREE.Mesh(mergeAll(lines), new THREE.MeshStandardMaterial({ color: 0xe8d27a, roughness: 0.6 }));
    paint.geometry.computeVertexNormals();
    s.add(paint);
    // street lamps along the streets; the ones nearest the middle really light it
    const poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
    let lit = 0;
    for (const k of [-45, -15, 15, 45]) for (const t of [-78, -48, -24, 0, 24, 48, 78]) for (const [x, z] of [[k + 6.5, t], [t, k + 6.5]]) {
      if (Math.abs(x) < 9 && Math.abs(z) < 9) continue;
      poles.push(new THREE.CylinderGeometry(0.12, 0.16, 7, 6).translate(x, 3.5, z).toNonIndexed());
      heads.push(new THREE.BoxGeometry(0.9, 0.25, 0.5).translate(x, 7.1, z).toNonIndexed());
      if (Math.abs(t) <= 24 && Math.abs(k) === 15 && lit < 8) {
        const lamp = new THREE.PointLight(0xffd9a0, 120, 34, 1.5);
        lamp.position.set(x, 6.8, z);
        s.add(lamp);
        lit++;
      }
    }
    const pole = new THREE.Mesh(mergeAll(poles), new THREE.MeshStandardMaterial({ color: 0x30333a, metalness: 0.6, roughness: 0.5 }));
    const head = new THREE.Mesh(mergeAll(heads), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 3 }));
    pole.geometry.computeVertexNormals(); head.geometry.computeVertexNormals();
    pole.castShadow = true;
    s.add(pole, head);
    // concrete barriers, and parked cars (real ones, from the garage)
    for (const r of arena.rocks) {
      if (r.kind === 'barrier') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(r.w! * 2, r.h, r.d! * 2).translate(0, r.h / 2, 0), concrete);
        b.position.set(r.x, 0, r.z);
        b.castShadow = b.receiveShadow = true;
        s.add(b);
      } else if (r.kind === 'car') {
        const car = parkedCar(['sedan', 'suv', 'shc', 'thunderbolt', 'azura'][Math.floor(rnd() * 5)]);
        if (!car) continue;
        car.position.set(r.x, 0, r.z);
        car.rotation.y = (r.w! > r.d! ? Math.PI / 2 : 0) + (rnd() < 0.5 ? Math.PI : 0);
        s.add(car);
      }
    }
  }

  // Who's on the screen: one view each, P1 top left
  setViews(bots: Bot[]) {
    const rects = layout(bots.length);
    this.views = bots.map((bot, i) => ({ rect: rects[i], cam: new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 900), bot, yaw: bot.yaw, pos: new THREE.Vector3(), shake: 0 }));
    this.resize();
  }

  resize() {
    for (const v of this.views) { v.cam.aspect = (v.rect.w * innerWidth) / (v.rect.h * innerHeight); v.cam.updateProjectionMatrix(); }
  }

  // Which way a person's camera looks, for their stick: up on the stick is away from the camera
  camYaw(bot: Bot) { return this.views.find((v) => v.bot === bot)?.yaw ?? bot.yaw; }

  // What happened this step, drawn: flashes, sparks, explosions, a jolt for whoever was hit
  react(e: SimEvent) {
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    switch (e.t) {
      case 'fire': {
        const [x, y, z] = gun(e.bot);
        this.flashes.emit(at(x + Math.sin(e.bot.yaw) * 0.6, y, z + Math.cos(e.bot.yaw) * 0.6), e.kind === 'cannon' ? 4 : 2, 0.5, 0, 0.03);
        this.sparks.emit(at(x, y, z), e.kind === 'cannon' ? 10 : 2, 4, 1, 0.08);
        break;
      }
      case 'hit': this.sparks.emit(at(e.x, e.y, e.z), e.bot ? 10 : 6, 9, 3, 0.25); this.jolt(e.bot, 0.15); break;
      case 'block': this.sparks.emit(at(e.x, e.y, e.z), 8, 6, 2, 0.2); break;
      case 'special':
        if (e.id === 'missiles') this.smoke.emit(at(e.bot.x, e.bot.spec.height * 0.8, e.bot.z), 16, 4, 2, 0.6);
        if (e.id === 'shield') this.sparks.emit(at(e.bot.x, 2, e.bot.z), 30, 10, 4, 0.4);
        break;
      case 'revived': this.sparks.emit(at(e.bot.x, 1.5, e.bot.z), 40, 6, 6, 0.6); break;
      case 'boom':
        this.fire.emit(at(e.x, 1.2, e.z), 30 + e.r * 6, e.r * 3, 4, 0.45);
        this.smoke.emit(at(e.x, 1.5, e.z), 18 + e.r * 3, e.r * 1.5, 3, 1.4);
        this.sparks.emit(at(e.x, 1, e.z), 30, 18, 8, 0.5);
        for (const v of this.views) if (Math.hypot(v.bot.x - e.x, v.bot.z - e.z) < 14) v.shake = Math.max(v.shake, 0.6);
        break;
      case 'smack': this.sparks.emit(at(e.bot.x, e.bot.spec.height * 0.5, e.bot.z), 14, 10, 4, 0.2); this.jolt(e.bot, 0.3); this.jolt(e.by, 0.15); break;
      case 'ram': this.sparks.emit(at(e.bot.x, 0.8, e.bot.z), 26, 14, 5, 0.35); this.jolt(e.bot, 0.6); this.jolt(e.by, 0.5); break;
      case 'slam':
        this.smoke.emit(at(e.bot.x, 0.4, e.bot.z), 20 + e.r * 3, e.r * 2, 1, 0.9);
        this.sparks.emit(at(e.bot.x, 0.3, e.bot.z), 20 + e.r * 3, e.r * 3, 3, 0.3);
        for (const v of this.views) if (Math.hypot(v.bot.x - e.bot.x, v.bot.z - e.bot.z) < e.r * 2) v.shake = Math.max(v.shake, 0.6);
        break;
      case 'wreck': this.drop(e.bot); break;
      case 'down': this.jolt(e.bot, 0.8); break;
    }
  }

  private jolt(b: Bot | null, k: number) { for (const v of this.views) if (v.bot === b) v.shake = Math.max(v.shake, k); }

  render(dt: number, sim: Sim) {
    this.t += dt;
    for (const b of sim.bots) this.place(b, dt);
    for (const b of this.rigs.keys()) if (!sim.bots.includes(b)) this.drop(b);
    this.drawShots(sim);
    this.snowfall?.update(dt);
    this.sparks.update(dt, -9);
    this.flashes.update(dt, 0);
    this.fire.update(dt, 1.5);
    this.smoke.update(dt, 0.6);
    for (const v of this.views) this.chase(v, dt);
    const W = innerWidth, H = innerHeight, r = this.renderer;
    r.setScissorTest(true);
    for (const v of this.views) {
      const x = Math.round(v.rect.x * W), y = Math.round((1 - v.rect.y - v.rect.h) * H), w = Math.round(v.rect.w * W), h = Math.round(v.rect.h * H);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      // (the sun's shadows follow whoever this view is watching)
      const at = this.look.light.sunAt;
      this.sun.target.position.set(v.bot.x, 0, v.bot.z);
      this.sun.position.set(v.bot.x + at[0], at[1], v.bot.z + at[2]);
      r.render(this.scene, v.cam);
    }
    r.setScissorTest(false);
  }

  // A bot gone: its rig and what's round it
  private drop(b: Bot) {
    const r = this.rigs.get(b), x = this.extras.get(b);
    if (r) this.scene.remove(r.root);
    if (x) for (const o of [x.bar?.back, x.bar?.fill, x.shield, x.ring]) if (o) this.scene.remove(o);
    this.rigs.delete(b);
    this.extras.delete(b);
  }

  // A bot's rig, where the rules have it, posed by what it's doing
  private place(b: Bot, dt: number) {
    if (b.dead) return;
    let rig = this.rigs.get(b);
    if (!rig) {
      const kind = b.spec.kind, gunKind: GunKind | undefined = kind === 'player' ? ({ blaster: 'rotary', cannon: 'cannon', scatter: 'scatter' } as const)[b.spec.weapon]
        : kind === 'trooper' ? 'rotary' : kind === 'lancer' ? 'rifle' : kind === 'hauler' ? 'cannon' : undefined;
      rig = new Rig(this.bodyOf(b), this.liveryOf(b), this.rich, gunKind);
      rig.shift = rig.target = b.shift;
      rig.root.scale.setScalar(b.scale);
      this.rigs.set(b, rig);
      this.extras.set(b, {});
      this.scene.add(rig.root);
    }
    const leap = b.slam && b.changing ? Math.sin(Math.PI * b.shift) * 3 : 0;
    rig.root.position.set(b.x, b.down ? 0.6 : leap, b.z);
    const turning = angleTo(rig.root.rotation.y, b.yaw);
    rig.root.rotation.y = b.yaw;
    rig.root.rotation.x = b.down ? -1.45 : 0;
    this.decorate(b);
    rig.transform(b.down ? 1 : b.target);
    rig.spin += (b.speed * dt) / 0.34;
    rig.steer = THREE.MathUtils.clamp(turning / Math.max(dt, 1e-3) / 2, -1, 1);
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), pose: Pose = still();
    pose.move.x = b.vx * c - b.vz * s;
    pose.move.z = b.vx * s + b.vz * c;
    pose.aim = b.aim;
    pose.punch = b.punchT >= 0 ? b.punchT / 0.38 : 0;
    pose.punchSide = b.combo % 2 ? -1 : 1;
    pose.dodge = b.dodgeT >= 0 ? b.dodgeT / 0.4 : 0;
    pose.hit = b.hitT;
    rig.update(dt, pose);
    if (b.boosting && Math.random() < 0.5) this.fire.emit(new THREE.Vector3(b.x - s * b.spec.length * 0.5, 0.5, b.z - c * b.spec.length * 0.5), 1, 0.5, 0.3, 0.1);
    if (b.spec.side === 'them' && b.hp < b.maxHp * 0.35 && Math.random() < 0.15) this.smoke.emit(new THREE.Vector3(b.x, b.spec.height * 0.4, b.z), 1, 1, 2, 0.8);
  }

  // The health bar over a hurt enemy (bigger over the boss), a shield, a friend's ring while they're down
  private decorate(b: Bot) {
    const x = this.extras.get(b)!;
    if (b.spec.side === 'them' && b.hp < b.maxHp && b.spec.kind !== 'hauler') { // (the boss has its own, across the top)
      if (!x.bar) {
        x.bar = { back: new THREE.Sprite(this.barBack), fill: new THREE.Sprite(this.barFill) };
        x.bar.back.renderOrder = 10; x.bar.fill.renderOrder = 11;
        this.scene.add(x.bar.back, x.bar.fill);
      }
      const w = 0.06, k = Math.max(0.02, b.hp / b.maxHp), y = (b.shift > 0.5 ? b.spec.height + 0.8 : 2.4) * b.scale;
      x.bar.back.position.set(b.x, y, b.z); x.bar.back.scale.set(w + 0.004, 0.011, 1);
      x.bar.fill.position.set(b.x, y, b.z); x.bar.fill.scale.set(w * k, 0.007, 1);
      x.bar.fill.center.set(0.5 / k, 0.5); // (anchored so its left end stays at the bar's left end)
    }
    if (b.shieldT > 0 && !x.shield) { x.shield = new THREE.Mesh(new THREE.SphereGeometry(5.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.shieldMat); this.scene.add(x.shield); }
    if (x.shield) {
      x.shield.visible = b.shieldT > 0;
      x.shield.position.set(b.x, 0, b.z);
      this.shieldMat.opacity = 0.1 + Math.sin(this.t * 8) * 0.03 + (b.shieldT < 1 ? Math.sin(this.t * 30) * 0.05 : 0); // (it flickers as it runs out)
    }
    if (b.down) {
      const k = Math.round(b.revive * 40) / 40;
      if (!x.ring) { x.ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4, 64, 1, 0, 0.01), this.ringMat); this.scene.add(x.ring); }
      if (x.ringAt !== k) { x.ring.geometry.dispose(); x.ring.geometry = new THREE.RingGeometry(3.6, 4, 64, 1, Math.PI / 2, Math.max(0.01, k * Math.PI * 2)).rotateX(-Math.PI / 2); x.ringAt = k; }
      x.ring.position.set(b.x, 0.08, b.z);
      x.ring.visible = true;
    } else if (x.ring) x.ring.visible = false;
  }

  private drawShots(sim: Sim) {
    let n = 0, k = 0;
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), scale = new THREE.Vector3(), white = new THREE.Color(0xffffff);
    for (const s of sim.shots) {
      p.set(s.x, s.y, s.z);
      if (s.kind === 'cannon' || s.kind === 'missile') {
        if (k < 60) this.shells.setMatrixAt(k++, this.m.makeTranslation(p));
        if (s.kind === 'missile' && Math.random() < 0.6) this.smoke.emit(p, 1, 0.3, 0.2, 0.5);
        continue;
      }
      if (n >= 600) continue;
      // a streak of light trailing back from where the shot is (never longer than it's flown)
      const flown = (s.max - s.life) * Math.hypot(s.vx, s.vz), len = Math.min(flown, s.kind === 'lance' ? 10 : s.kind === 'scatter' ? 2.2 : 4.5), w = s.kind === 'lance' ? 2.2 : s.kind === 'scatter' ? 0.8 : 1;
      q.setFromAxisAngle(UP, Math.atan2(s.vx, s.vz));
      this.m.compose(p, q, scale.set(w, w, Math.max(0.3, len)));
      this.bolts.setMatrixAt(n, this.m); this.halos.setMatrixAt(n, this.m);
      const c = s.from.spec.side === 'us' ? (s.kind === 'scatter' ? 0xffd27a : 0x9ff6ff) : s.kind === 'lance' ? 0xff6a1a : 0xff4433;
      this.bolts.setColorAt(n, this.colour.set(c).lerp(white, 0.6)); this.halos.setColorAt(n, this.colour.set(c));
      n++;
    }
    this.bolts.count = this.halos.count = n; this.shells.count = k;
    this.bolts.instanceMatrix.needsUpdate = this.halos.instanceMatrix.needsUpdate = this.shells.instanceMatrix.needsUpdate = true;
    if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    let d = 0;
    for (const s of sim.drops) {
      if (d >= 120) break;
      q.setFromAxisAngle(UP, this.t * 2 + d);
      this.scraps.setMatrixAt(d++, this.m.compose(p.set(s.x, 0.6 + Math.sin(this.t * 3 + d) * 0.15, s.z), q, one));
    }
    this.scraps.count = d;
    this.scraps.instanceMatrix.needsUpdate = true;
  }

  // Behind and above the bot, swinging round behind it as it goes (quicker as a car), looking a little
  // ahead of it; further back and higher as a robot
  private chase(v: View, dt: number) {
    const b = v.bot, sp = Math.hypot(b.vx, b.vz), robot = b.shift > 0.5;
    const want = robot ? (b.aim > 0.3 ? b.yaw : sp > 1 ? Math.atan2(b.vx, b.vz) : v.yaw) : b.yaw;
    const rate = robot ? CHASE.swing * Math.min(1, sp / 4 + (b.aim > 0.3 ? 0.6 : 0)) : CHASE.swing * 1.4 * Math.min(1, sp / 8);
    v.yaw += THREE.MathUtils.clamp(angleTo(v.yaw, want), -rate * dt, rate * dt);
    const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    const back = THREE.MathUtils.lerp(CHASE.carBack, CHASE.robotBack, b.shift), up = THREE.MathUtils.lerp(CHASE.carUp, CHASE.robotUp, b.shift);
    const target = new THREE.Vector3(b.x, up, b.z).addScaledVector(fwd, -back);
    const out = Math.hypot(target.x, target.z), room = this.radius - 1.5; // (never back into the quarry wall)
    if (out > room) { target.x *= room / out; target.z *= room / out; target.y += (out - room) * 0.5; }
    if (v.pos.lengthSq() === 0) v.pos.copy(target);
    v.pos.lerp(target, Math.min(1, dt * 6));
    v.shake = Math.max(0, v.shake - dt * 2.5);
    const j = v.shake * 0.4;
    v.cam.position.copy(v.pos).add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, 0));
    v.cam.lookAt(new THREE.Vector3(b.x, b.down ? 0.5 : THREE.MathUtils.lerp(1.2, b.spec.height * 0.6, b.shift), b.z).addScaledVector(fwd, CHASE.ahead));
  }

  dispose() {
    for (const b of [...this.rigs.keys()]) this.drop(b);
  }
}

const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// A photographed surface (Poly Haven): its colour, bumps and how rough it is, tiling
interface Photo { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }
async function photo(name: string, renderer: THREE.WebGLRenderer): Promise<Photo | null> {
  const load = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  try {
    const [map, normal, rough] = await Promise.all(['diff', 'nor', 'rough'].map((k) => load.loadAsync(`env/${name}_${k}.jpg`)));
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normal, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; }
    return { map, normal, rough };
  } catch { return null; }
}
function surface(p: Photo | null, repeat: number | [number, number], color: number, side: THREE.Side = THREE.FrontSide, rep2?: [number, number]) {
  const r = rep2 ?? (typeof repeat === 'number' ? [repeat, repeat] : repeat);
  if (!p) return new THREE.MeshStandardMaterial({ map: stone(), roughness: 0.92, color, side });
  const tex = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(r[0], r[1]); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({ map: tex(p.map), normalMap: tex(p.normal), roughnessMap: tex(p.rough), color, side });
}

// Textures drawn in code: gravel for the floor, banded stone for the walls and rocks
function gravel(tint: number, repeat: number) {
  const c = canvas(256, 256), g = c.getContext('2d')!, rnd = seeded(3), base = new THREE.Color(tint);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = 0.75 + rnd() * 0.5;
    g.fillStyle = `rgb(${Math.min(255, base.r * 255 * v)},${Math.min(255, base.g * 255 * v)},${Math.min(255, base.b * 255 * v)})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  const t = texture(c);
  t.repeat.set(repeat, repeat);
  return t;
}
// Rows of office windows, some lit, some dark (also its own glow: lit ones shine at night)
function officeWindows() {
  const c = canvas(128, 256), g = c.getContext('2d')!, rnd = seeded(29);
  g.fillStyle = '#16181d'; g.fillRect(0, 0, 128, 256);
  for (let y = 4; y < 256; y += 16) for (let x = 4; x < 128; x += 12) {
    const on = rnd() < 0.42, v = on ? 180 + rnd() * 70 : 30 + rnd() * 20;
    g.fillStyle = on ? `rgb(${v},${v * 0.86},${v * 0.6})` : `rgb(${v},${v},${v + 8})`;
    g.fillRect(x, y, 8, 10);
  }
  const t = texture(c);
  return t;
}
// A box whose faces show whole floors of windows (about 3.2 m a floor, 6 m a bay), not stretched ones
function towerBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const side = Math.abs(n.getX(i)) > 0.5 ? d : w;
    if (Math.abs(n.getY(i)) > 0.5) { uv.setXY(i, 0, 0); continue; } // (the roof: one dark pixel)
    uv.setXY(i, uv.getX(i) * side / 18, uv.getY(i) * h / 51);
  }
  return g;
}
function stars() {
  const n = 700, pos = new Float32Array(n * 3), rnd = seeded(5);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.15 + rnd() * 1.3, r = 850;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d0e8, size: 1.5, sizeAttenuation: false, fog: false }));
}
function stone() {
  const c = canvas(256, 256), g = c.getContext('2d')!, n = noise2(4);
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = 168 + (n(x / 30, y / 22) - 0.5) * 60 + (n(x / 8, y / 8) - 0.5) * 50 + (n(x / 2.5, y / 2.5) - 0.5) * 24, i = (y * 256 + x) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.93; img.data[i + 2] = v * 0.82; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = texture(c);
  t.repeat.set(70, 2); // (round the whole quarry: square-ish tiles)
  return t;
}
function mergeAll(list: THREE.BufferGeometry[]) {
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0), pos = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}
