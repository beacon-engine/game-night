// Pool: the table in 3D (three.js). The room and lamp, the table built from the same cushion and pocket
// geometry the physics uses, the balls (each turning with its real spin), the cue, the aiming guide with its
// ghost ball, and the cameras: behind the cue, overhead, and a broadcast view while the balls run.
//
// The physics is flat (x along the table, y across, z up); three.js is y-up. A table point (x, y) at height h
// is (x, h, -y) here, so looking down from above the table reads like a graph: x to the right, y up.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { firstBall, firstCushion, HEAD_X, L, NOSES, POCKETS, R, W, type Table } from './physics.ts';

const CUSHION_W = 0.05; // nose to the back of the cushion
const RAIL_W = 0.12; // the wooden rail outside the cushions
const RAIL_TOP = 0.046;
const NOSE_TOP = 0.04;
const BED = 0x23608f; // our cloth: a deep blue
const RAIL_WOOD = 0x3b2414;

export const BALL_COLORS = ['#f4f1e6', '#f2b705', '#1f4fd1', '#d4252a', '#6b2fa8', '#f06b14', '#178a4c', '#7a1f1f', '#111111'];
export const ballColor = (n: number) => BALL_COLORS[n > 8 ? n - 8 : n];

const at = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

export type CamMode = 'lobby' | 'aim' | 'top' | 'watch';

export interface Look {
  cam: CamMode;
  aim: number; // the aim, radians on the table
  cue: { pull: number; side: number; height: number; strike: number } | null; // the cue stick, if shown (strike: 0..1 forward)
  guide: { legal: (n: number) => boolean; long: boolean } | null; // the aiming line
  inHand: { ok: boolean; kitchen: boolean } | null; // the ring under a cue ball being placed (and the head string)
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.02, 40);
  private balls: THREE.Mesh[] = [];
  private cue = new THREE.Group();
  private ghost: THREE.Group;
  private ghostRing: THREE.MeshBasicMaterial;
  private handRing: THREE.Mesh;
  private lines: Ribbons;
  private faint: Ribbons;
  private camPos = new THREE.Vector3(0, 3, 2);
  private camLook = new THREE.Vector3();
  private orbit = 0;
  private snapped = true;
  private lamp: THREE.Object3D[] = [];
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    this.scene.background = new THREE.Color(0x07080b);
    // a soft room for reflections in the balls' lacquer
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.room();
    this.table();
    for (let n = 0; n < 16; n++) this.balls.push(this.ball(n));
    this.buildCue();
    this.lines = new Ribbons(this.scene, 0.9);
    this.faint = new Ribbons(this.scene, 0.45);
    this.ghost = new THREE.Group();
    const ghostBall = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    ghostBall.position.y = R;
    this.ghostRing = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 40), this.ghostRing);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    this.ghost.add(ghostBall, ring);
    this.scene.add(this.ghost);
    this.handRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.3, R * 1.55, 40), new THREE.MeshBasicMaterial({ color: 0xd7ff3b, transparent: true, depthWrite: false }));
    this.handRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.handRing);
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // --- the room -------------------------------------------------------------------------------------------
  private room() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xc9d4ff, 0x1a120c, 0.35));
    // the lamp over the table: a long shade, glowing underneath
    const shade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.36), new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.6, roughness: 0.4 }));
    shade.position.set(0, 1.05, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, 1.009, 0);
    s.add(shade, glow);
    this.lamp = [shade, glow];
    // the light that throws the balls' shadows: almost straight down
    const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
    key.position.set(0.15, 3, 0.25);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.0, bottom: -1.0, near: 1, far: 5 });
    key.shadow.radius = 3;
    key.shadow.bias = -0.0005;
    s.add(key);
    // the lamp's bulbs: highlights in the balls
    for (const x of [-0.55, 0, 0.55]) {
      const p = new THREE.PointLight(0xfff1d6, 0.9, 0, 1.4);
      p.position.set(x, 0.98, 0);
      s.add(p);
    }
    // the floor, lit in a pool under the lamp
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, '#3a2e26');
    grad.addColorStop(0.55, '#1a1512');
    grad.addColorStop(1, '#07080b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.78;
    floor.receiveShadow = true;
    s.add(floor);
  }

  // --- the table ------------------------------------------------------------------------------------------
  private table() {
    const s = this.scene;
    const backX = L / 2 + CUSHION_W, backY = W / 2 + CUSHION_W;
    const outX = backX + RAIL_W, outY = backY + RAIL_W;
    const inHole = (x: number, y: number, grow: number) => POCKETS.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < (p.r + grow) ** 2);
    // The bed: the slate under the cloth out to the cushions' backs, with a bite out for each pocket. Traced
    // round from the middle (the shape is star-shaped from there, so a ray finds its edge).
    const bed: THREE.Vector2[] = [];
    const steps = 1440;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let lo = 0, hi = 2;
      const inside = (d: number) => Math.abs(dx * d) <= backX && Math.abs(dy * d) <= backY && !inHole(dx * d, dy * d, 0);
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
      bed.push(new THREE.Vector2(dx * lo, dy * lo));
    }
    const cloth = new THREE.MeshStandardMaterial({ color: BED, roughness: 0.92, map: feltTexture() });
    const bedGeo = new THREE.ExtrudeGeometry(new THREE.Shape(bed), { depth: 0.03, bevelEnabled: false });
    bedGeo.rotateX(-Math.PI / 2);
    bedGeo.translate(0, -0.03, 0);
    const bedMesh = new THREE.Mesh(bedGeo, cloth);
    bedMesh.receiveShadow = true;
    s.add(bedMesh);

    // The cushions: each nose outline from the physics, closed off along the back line
    const cushionCloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(BED).multiplyScalar(0.92), roughness: 0.9 });
    for (const pts of NOSES) {
      const [p, q] = [pts[1], pts[2]];
      const ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey);
      let nx = -ey / len, ny = ex / len;
      if (nx * p[0] + ny * p[1] < 0) { nx = -nx; ny = -ny; } // (outwards)
      const back = (pt: number[]) => {
        // along the outward normal to the back line
        const d = Math.abs(nx) > 0.5 ? (backX * Math.sign(nx) - pt[0]) / nx : (backY * Math.sign(ny) - pt[1]) / ny;
        return new THREE.Vector2(pt[0] + nx * d, pt[1] + ny * d);
      };
      const shape = new THREE.Shape([...pts.map((pt) => new THREE.Vector2(pt[0], pt[1])), back(pts[3]), back(pts[0])]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: NOSE_TOP - 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.006, 0);
      const m = new THREE.Mesh(geo, cushionCloth);
      m.castShadow = m.receiveShadow = true;
      s.add(m);
    }

    // The rails: a wooden frame with each pocket cut out of it (traced from outside in)
    const rail: THREE.Vector2[] = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let lo = 0, hi = 2;
      const hole = (d: number) => (Math.abs(dx * d) <= backX && Math.abs(dy * d) <= backY) || inHole(dx * d, dy * d, 0.006);
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (hole(m)) lo = m; else hi = m; }
      rail.push(new THREE.Vector2(dx * lo, dy * lo));
    }
    const frame = new THREE.Shape(roundRect(outX, outY, 0.05));
    frame.holes.push(new THREE.Path(rail));
    const wood = new THREE.MeshStandardMaterial({ color: RAIL_WOOD, roughness: 0.45, metalness: 0.05, map: woodTexture() });
    const railGeo = new THREE.ExtrudeGeometry(frame, { depth: RAIL_TOP + 0.08, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 6 });
    railGeo.rotateX(-Math.PI / 2);
    railGeo.translate(0, -0.08, 0);
    const railMesh = new THREE.Mesh(railGeo, wood);
    railMesh.castShadow = railMesh.receiveShadow = true;
    s.add(railMesh);

    // Sights: pearl diamonds along the rails, a quarter of a side pocket apart
    const pearl = new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: 0.3 });
    const diamond = new THREE.CylinderGeometry(0.008, 0.008, 0.002, 4);
    const sight = (x: number, y: number, rotate: boolean) => {
      const d = new THREE.Mesh(diamond, pearl);
      d.position.copy(at(x, y, RAIL_TOP + 0.0085));
      d.scale.set(rotate ? 0.6 : 1, 1, rotate ? 1 : 0.6);
      s.add(d);
    };
    const mid = CUSHION_W + RAIL_W * 0.5;
    for (const k of [-3, -2, -1, 1, 2, 3]) for (const sy of [-1, 1]) sight((k * L) / 8, sy * (W / 2 + mid), false);
    for (const k of [-1, 0, 1]) for (const sx of [-1, 1]) sight(sx * (L / 2 + mid), (k * W) / 4, true);

    // The pockets: leather cups going down under the holes, and their backs where the rail is cut
    const leather = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.8, side: THREE.DoubleSide });
    for (const p of POCKETS) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.85, 0.16, 28, 1, true), leather);
      cup.position.copy(at(p.x, p.y, -0.08));
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.85, 28), leather);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.copy(at(p.x, p.y, -0.16));
      // the back half, above the cloth, inside the rail cut
      const a = Math.atan2(p.uy, p.ux);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.006, p.r + 0.006, RAIL_TOP + 0.01, 28, 1, true, 0, Math.PI * 1.1), leather);
      back.position.copy(at(p.x, p.y, (RAIL_TOP + 0.01) / 2 - 0.005));
      back.rotation.y = a - Math.PI * 0.55 + Math.PI / 2; // (centred on the pocket's axis, facing out)
      s.add(cup, bottom, back);
    }

    // The body and legs
    const body = new THREE.Mesh(new THREE.BoxGeometry(outX * 2 - 0.04, 0.2, outY * 2 - 0.04), new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.6, map: woodTexture() }));
    body.position.y = -0.18;
    body.castShadow = true;
    s.add(body);
    for (const x of [-1, 0, 1]) {
      for (const sy of [-1, 1]) {
        if (x === 0) continue;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), body.material);
        leg.position.set(x * (outX - 0.18), -0.53, sy * (outY - 0.14));
        leg.castShadow = true;
        s.add(leg);
      }
    }
  }

  private ball(n: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), new THREE.MeshPhysicalMaterial({
      map: ballTexture(n), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06,
    }));
    m.castShadow = true;
    // start each ball at a random turn, so the numbers don't all face the same way
    m.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.scene.add(m);
    return m;
  }

  // The cue: tip at the local origin, pointing along +x, the butt back along -x
  private buildCue() {
    const part = (len: number, r0: number, r1: number, color: number, x: number, rough = 0.4, metal = 0) => {
      const g = new THREE.CylinderGeometry(r1, r0, len, 20);
      g.rotateZ(Math.PI / 2); // along x, r1 at +x
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
      m.position.x = x - len / 2;
      m.castShadow = true;
      this.cue.add(m);
    };
    part(0.008, 0.0062, 0.0062, 0x3b6fb3, 0, 0.9); // the chalked tip
    part(0.02, 0.0063, 0.0063, 0xf3efe2, -0.008, 0.3); // ferrule
    part(0.68, 0.0105, 0.0064, 0xe0c48e, -0.028, 0.35); // maple shaft
    part(0.015, 0.0108, 0.0108, 0xb9bcc4, -0.708, 0.25, 0.9); // joint
    part(0.33, 0.0125, 0.0108, 0x2a1408, -0.723, 0.3); // forearm
    part(0.25, 0.0135, 0.0125, 0x111216, -1.053, 0.85); // wrap
    part(0.16, 0.0145, 0.0135, 0x2a1408, -1.303, 0.3); // butt
    part(0.012, 0.0145, 0.0145, 0x0a0a0a, -1.463, 0.8); // bumper
    this.scene.add(this.cue);
  }

  // --- each frame -----------------------------------------------------------------------------------------
  frame(dt: number, t: Table, look: Look) {
    this.time += dt;
    this.placeBalls(dt, t);
    const c = t.cue;
    const dx = Math.cos(look.aim), dy = Math.sin(look.aim);

    // the cue stick: behind the ball, tilted up a little, its tip on the point it will strike
    this.cue.visible = !!look.cue && c.state === 'table';
    if (look.cue) {
      // tilted up a little, and more when the cue ball is near a cushion, so the cue clears the rail behind it
      let tilt = 0.07;
      const wall = firstCushion(c.x, c.y, -dx, -dy);
      if (wall) {
        const over = wall.dist + R + CUSHION_W + 0.03; // (from the ball's centre to the far side of the rail's edge)
        tilt = Math.max(tilt, Math.atan2(RAIL_TOP + 0.022 - R, over));
      }
      const gap = 0.012 + look.cue.pull * 0.24 * (1 - look.cue.strike) - look.cue.strike * 0.01;
      const right = new THREE.Vector3(dy, 0, dx); // (the table's right of the aim, in three's axes)
      const tip = at(c.x - dx * (R + gap), c.y - dy * (R + gap), R + look.cue.height * R * 0.5)
        .addScaledVector(right, look.cue.side * R * 0.5);
      this.cue.position.copy(tip);
      this.cue.rotation.set(0, Math.atan2(dy, dx), -tilt, 'YZX'); // (the butt raised)
    }

    // the guide: to the first ball (or cushion) on the line, with the ghost ball where they'd touch
    this.lines.clear();
    this.faint.clear();
    this.ghost.visible = false;
    if (look.guide && c.state === 'table') this.guide(t, dx, dy, look.guide);
    if (look.inHand?.kitchen) dashes(this.faint, HEAD_X, -W / 2, 0, 1, W);
    this.lines.commit();
    this.faint.commit();

    this.handRing.visible = !!look.inHand;
    if (look.inHand) {
      this.handRing.position.copy(at(c.x, c.y, 0.002));
      const mat = this.handRing.material as THREE.MeshBasicMaterial;
      mat.color.set(look.inHand.ok ? 0xd7ff3b : 0xff4d5a);
      mat.opacity = 0.6 + 0.35 * Math.sin(this.time * 5);
    }
    this.moveCamera(dt, t, look);
    this.renderer.render(this.scene, this.camera);
  }

  private guide(t: Table, dx: number, dy: number, g: NonNullable<Look['guide']>) {
    const c = t.cue;
    const hit = firstBall(t, c.x, c.y, dx, dy, (n) => n === 0);
    const wall = firstCushion(c.x, c.y, dx, dy);
    const white = 0xf3f0e8;
    if (hit && (!wall || hit.dist < wall.dist)) {
      const gx = c.x + dx * hit.dist, gy = c.y + dy * hit.dist;
      this.lines.add(c.x + dx * R, c.y + dy * R, gx - dx * R, gy - dy * R, 0.004, white);
      this.ghost.visible = true;
      this.ghost.position.copy(at(gx, gy));
      this.ghostRing.color.set(g.legal(hit.n) ? white : 0xff4d5a);
      // the object ball goes along the line of centres; the cue ball off at right angles to it (a stun shot)
      const b = t.balls[hit.n];
      const nx = (b.x - gx) / (2 * R), ny = (b.y - gy) / (2 * R);
      const full = dx * nx + dy * ny;
      const objLen = (g.long ? 0.7 : 0.3) * (0.35 + 0.65 * full);
      const objWall = firstCushion(b.x, b.y, nx, ny);
      const ol = inside(b.x, b.y, nx, ny, Math.min(objLen, objWall ? objWall.dist : objLen));
      this.lines.add(b.x + nx * R, b.y + ny * R, b.x + nx * (R + ol), b.y + ny * (R + ol), 0.004, g.legal(hit.n) ? white : 0xff4d5a);
      let tx = dx - nx * full, ty = dy - ny * full;
      const tl = Math.hypot(tx, ty);
      if (tl > 0.02) {
        tx /= tl; ty /= tl;
        const len = inside(gx, gy, tx, ty, (g.long ? 0.45 : 0.22) * tl);
        dashes(this.faint, gx + tx * R, gy + ty * R, tx, ty, len);
      }
    } else if (wall) {
      const gx = c.x + dx * wall.dist, gy = c.y + dy * wall.dist;
      this.lines.add(c.x + dx * R, c.y + dy * R, gx, gy, 0.004, white);
      this.ghost.visible = true;
      this.ghost.position.copy(at(gx, gy));
      this.ghostRing.color.set(white);
      const k = dx * wall.nx + dy * wall.ny;
      const rx = dx - 2 * k * wall.nx, ry = dy - 2 * k * wall.ny;
      dashes(this.faint, gx + rx * R, gy + ry * R, rx, ry, inside(gx, gy, rx, ry, g.long ? 0.4 : 0.2));
    } else {
      // straight into a pocket
      this.lines.add(c.x + dx * R, c.y + dy * R, c.x + dx * inside(c.x, c.y, dx, dy, 3), c.y + dy * inside(c.x, c.y, dx, dy, 3), 0.004, white);
    }
  }

  private placeBalls(dt: number, t: Table) {
    const q = new THREE.Quaternion(), axis = new THREE.Vector3();
    for (const b of t.balls) {
      const m = this.balls[b.n];
      m.visible = b.state !== 'potted';
      if (!m.visible) continue;
      if (b.state === 'falling') {
        // over the hole: drop in, sliding towards the middle of the pocket
        const p = POCKETS[b.pocket], k = Math.min(1, b.fall / 0.18);
        m.position.copy(at(b.x + (p.x - b.x) * k, b.y + (p.y - b.y) * k, Math.max(-0.13, R - 4.9 * b.fall * b.fall * 1.6)));
      } else m.position.copy(at(b.x, b.y, R));
      // turn it by its spin (three's axes: the table's (wx, wy, wz) is (wx, wz, -wy))
      axis.set(b.wx, b.wz, -b.wy);
      const w = axis.length();
      if (w > 1e-4) {
        q.setFromAxisAngle(axis.divideScalar(w), w * dt);
        m.quaternion.premultiply(q);
      }
    }
  }

  // --- cameras --------------------------------------------------------------------------------------------
  private moveCamera(dt: number, t: Table, look: Look) {
    const cam = this.camera, aspect = cam.aspect;
    const pos = new THREE.Vector3(), target = new THREE.Vector3();
    let fov = 40, up = new THREE.Vector3(0, 1, 0), rate = 4;
    if (look.cam === 'lobby') {
      this.orbit += dt * 0.08;
      pos.set(Math.cos(this.orbit) * 2.7, 1.35, Math.sin(this.orbit) * 2.0);
      target.set(0, -0.1, 0);
      fov = 42;
      rate = 2;
    } else if (look.cam === 'top') {
      // straight down, the whole table and its rails in view
      // (the scoreboard covers the top sixth of the screen: the table sits in the rest, a little lower)
      fov = 34;
      const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const h = Math.max((L / 2 + 0.22) / (half * aspect), (W / 2 + 0.2) / (half * 0.8));
      pos.set(0, h, -h * half * 0.16);
      target.set(0, 0, pos.z);
      up = new THREE.Vector3(0, 0, -1);
    } else if (look.cam === 'watch') {
      // the broadcast view from the long side: high enough to see every pocket
      fov = 36;
      const half = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const d = Math.max(2.2, (L / 2 + 0.32) / (half * aspect) * 1.02);
      pos.set(0, d * 0.82, d * 0.6);
      target.set(0, -0.06, 0.08);
    } else {
      // behind the cue, looking down the line of the shot
      const c = t.cue, dx = Math.cos(look.aim), dy = Math.sin(look.aim);
      pos.copy(at(c.x - dx * 0.95, c.y - dy * 0.95, 0.5));
      target.copy(at(c.x + dx * 0.75, c.y + dy * 0.75, -0.05));
      fov = 46;
      rate = 9;
    }
    const k = this.snapped ? 1 : 1 - Math.exp(-dt * rate);
    this.snapped = false;
    this.camPos.lerp(pos, k);
    this.camLook.lerp(target, k);
    cam.fov += (fov - cam.fov) * k;
    cam.up.lerp(up, k).normalize();
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    // in the lobby the menu covers the left: centre the table in what's left
    if (look.cam === 'lobby') cam.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.18, 0, innerWidth, innerHeight);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    for (const o of this.lamp) o.visible = cam.position.y < 0.98; // (looking down from above it, the lamp would be in the way)
  }

  // Jump the camera straight to where it's going (a new screen, not a move)
  snap() {
    this.snapped = true;
  }

  // Where a table point is on the screen, in CSS pixels (for labels over the table)
  toScreen(x: number, y: number, h = 0) {
    const v = at(x, y, h).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 };
  }
}

// --- flat lines on the cloth --------------------------------------------------------------------------------
class Ribbons {
  private pos: number[] = [];
  private col: number[] = [];
  private mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene, opacity: number) {
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  clear() { this.pos = []; this.col = []; }

  add(x1: number, y1: number, x2: number, y2: number, w: number, color: number) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-4) return;
    const nx = (-(y2 - y1) / len) * w / 2, ny = ((x2 - x1) / len) * w / 2, h = 0.0015;
    const pts = [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x1 + nx, y1 + ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny]];
    this.color.set(color);
    for (const [x, y] of pts) {
      this.pos.push(x, h, -y);
      this.col.push(this.color.r, this.color.g, this.color.b);
    }
  }

  commit() {
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    this.geo.computeBoundingSphere();
  }
}

// How far a line from (x, y) along (dx, dy) can go, up to len, before it leaves the bed (into a pocket)
function inside(x: number, y: number, dx: number, dy: number, len: number) {
  const ex = L / 2 + 0.02, ey = W / 2 + 0.02;
  if (dx) len = Math.min(len, ((dx > 0 ? ex : -ex) - x) / dx);
  if (dy) len = Math.min(len, ((dy > 0 ? ey : -ey) - y) / dy);
  return Math.max(0, len);
}

function dashes(r: Ribbons, x: number, y: number, dx: number, dy: number, len: number) {
  for (let s = 0; s < len; s += 0.03) {
    const e = Math.min(len, s + 0.018);
    r.add(x + dx * s, y + dy * s, x + dx * e, y + dy * e, 0.0035, 0xf3f0e8);
  }
}

// --- textures -----------------------------------------------------------------------------------------------
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

// A ball's surface, wrapped round the sphere: a solid colour, or white with a colour band; the number in a white
// spot on both sides. (Stretched near the poles like any map of a globe, which is why the spots sit on the equator.)
function ballTexture(n: number) {
  const [c, g] = canvas(512, 256);
  const col = ballColor(n);
  g.fillStyle = n > 8 || n === 0 ? '#f4f1e6' : col;
  g.fillRect(0, 0, 512, 256);
  if (n > 8) { g.fillStyle = col; g.fillRect(0, 70, 512, 116); }
  if (n === 0) {
    // the cue ball: small red spots, so you can see it spin
    g.fillStyle = '#c8202b';
    for (const [x, y] of [[128, 128], [384, 128], [0, 128], [256, 128], [512, 128]]) { g.beginPath(); g.ellipse(x, y, 9, 9, 0, 0, Math.PI * 2); g.fill(); }
  } else {
    for (const x of [128, 384]) {
      g.fillStyle = '#f4f1e6';
      g.beginPath();
      g.ellipse(x, 128, 40, 40, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = `700 ${n > 9 ? 40 : 48}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), x, 131);
      if (n === 6 || n === 9) g.fillRect(x - 12, 156, 24, 4); // (which way up)
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The cloth: a faint nap of noise, tiled
function feltTexture() {
  const [c, g] = canvas(256, 256);
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 236 + Math.random() * 19;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Wood: streaks of grain along the rails
function woodTexture() {
  const [c, g] = canvas(512, 64);
  g.fillStyle = '#c9a27a';
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(60, 30, 10, ${0.08 + Math.random() * 0.18})`;
    g.lineWidth = 0.5 + Math.random() * 2;
    const y = Math.random() * 64;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 2.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRect(hx: number, hy: number, r: number) {
  const pts: THREE.Vector2[] = [];
  for (const [cx, cy, a0] of [[hx - r, hy - r, 0], [-hx + r, hy - r, 90], [-hx + r, -hy + r, 180], [hx - r, -hy + r, 270]]) {
    for (let k = 0; k <= 6; k++) {
      const a = ((a0 + (k * 90) / 6) * Math.PI) / 180;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return pts;
}
