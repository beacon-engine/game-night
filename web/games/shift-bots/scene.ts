// Drawing Shift Bots. For now the garage: each person's bot turning on a plinth in their part of the
// screen, lit like a showroom (soft boxes overhead for the paint to reflect), and a showroom of every body
// at once for looking them over (?showroom).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { layout, type Rect } from '@world/screen.ts';
import { Rig, still, type Body, type Pose } from './rig.ts';
import type { Livery } from './paint.ts';

export interface Pick { body: Body; livery: Livery; robot: boolean }
interface Bay { rect: Rect; rig: Rig; camera: THREE.PerspectiveCamera; spin: number; pick: Pick; at: THREE.Vector3; stand?: THREE.Object3D }

const BAY_GAP = 30; // m between the bays (each view sees only its own)

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  bays: Bay[] = [];
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private rich: boolean;
  private pose: Pose = still();
  private t = 0;
  private framing = true; // (the garage frames each bay; the showroom keeps its own camera)
  private aside = 0;

  constructor(canvas: HTMLCanvasElement, rich: boolean) {
    this.rich = rich;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = new THREE.Color(0x0b0c10);
    this.scene.fog = new THREE.Fog(0x0b0c10, 18, 60);

    this.sun.position.set(6, 12, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -7; sc.right = sc.top = 7; sc.near = 1; sc.far = 40;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x15161a, 0.5));
    const rim = new THREE.DirectionalLight(0x9fc0ff, 1.4);
    rim.position.set(-8, 5, -10);
    this.scene.add(rim);

    // the garage floor: dark polished concrete
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.5, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // One bay per person: their bot on a plinth, in their part of the screen. `aside`: how far right of
  // the middle the bot stands (as a fraction of its view), to leave room for a card on the left.
  garage(picks: Pick[], aside = 0) {
    this.framing = true;
    this.aside = aside;
    const rects = layout(picks.length);
    const bays: Bay[] = picks.map((pick, i) => {
      const at = new THREE.Vector3(i * BAY_GAP, 0, 0), old = this.bays[i];
      let rig = old?.rig, stand = old?.stand;
      if (!rig || old.pick.body !== pick.body) {
        if (rig) this.scene.remove(rig.root);
        rig = new Rig(pick.body, pick.livery, this.rich);
        rig.root.position.copy(at);
        rig.shift = rig.target = pick.robot ? 1 : 0;
        this.scene.add(rig.root);
      } else rig.setMaterials(pick.livery, this.rich);
      if (!stand) { stand = plinth(at); this.scene.add(stand); }
      rig.transform(pick.robot ? 1 : 0);
      return { rect: rects[i], rig, camera: old?.camera ?? new THREE.PerspectiveCamera(32, 1, 0.1, 200), spin: old?.spin ?? 0.7 + i * 0.6, pick, at, stand };
    });
    for (const b of this.bays.slice(picks.length)) { this.scene.remove(b.rig.root); if (b.stand) this.scene.remove(b.stand); }
    this.bays = bays;
    this.resize();
  }

  // Every body side by side, as cars or robots or anywhere between (?showroom&t=0.5)
  showroom(bodies: Body[], livery: (i: number) => Livery, shift: number, yaw: number) {
    const cols = 3;
    this.framing = false;
    this.bays = [];
    bodies.forEach((body, i) => {
      const rig = new Rig(body, livery(i), this.rich), at = new THREE.Vector3((i % cols - 1) * 7.5, 0, Math.floor(i / cols) * -9);
      rig.root.position.copy(at);
      rig.root.rotation.y = yaw;
      rig.shift = rig.target = shift;
      this.scene.add(rig.root);
      this.bays.push({ rect: { x: 0, y: 0, w: 1, h: 1 }, rig, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 200), spin: yaw, pick: { body, livery: livery(i), robot: shift > 0.5 }, at });
    });
    const cam = this.bays[0].camera;
    if (bodies.length === 1) {
      this.bays[0].rig.root.position.set(0, 0, 0);
      const k = this.bays[0].rig.k, s = shift > 0.5 || shift < 0;
      if (shift < 0) this.bays[0].rig.shift = this.bays[0].rig.target = -shift; // (a negative t: framed as a robot, for filmstrips)
      cam.position.set(0, s ? k * 0.45 : 1.6, s ? k * 2.9 : 9);
      cam.lookAt(0, s ? k * 0.42 : 0.6, 0);
    } else {
      cam.position.set(0, 9, 19);
      cam.lookAt(0, 1.4, -4.5);
    }
    this.bays = [{ ...this.bays[0], rect: { x: 0, y: 0, w: 1, h: 1 } }, ...this.bays.slice(1).map((b) => ({ ...b, rect: { x: 0, y: 0, w: 0, h: 0 } }))];
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, -4.5);
    this.sun.position.set(6, 14, 4);
    this.resize();
  }

  transform(i: number, robot: boolean) { this.bays[i]?.rig.transform(robot ? 1 : 0); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    for (const b of this.bays) if (b.rect.w) {
      const vw = b.rect.w * w, vh = b.rect.h * h;
      b.camera.aspect = vw / vh;
      if (this.framing && this.aside) b.camera.setViewOffset(vw, vh, -vw * this.aside, 0, vw, vh); else b.camera.clearViewOffset();
      b.camera.updateProjectionMatrix();
    }
  }

  render(dt: number) {
    this.t += dt;
    const W = innerWidth, H = innerHeight;
    for (const b of this.bays) {
      if (this.framing) { // a garage bay, turning slowly (the showroom stands still)
        b.spin += dt * 0.25;
        b.rig.root.rotation.y = b.spin;
        // (the camera backs off and rises as the car stands up into a robot)
        const tall = THREE.MathUtils.lerp(0.75, b.rig.k * 0.5, b.rig.shift), far = THREE.MathUtils.lerp(8.5, b.rig.k * 3.2, b.rig.shift);
        b.camera.position.set(b.at.x + far * 0.12, tall + 1.2 + b.rig.shift * 0.4, b.at.z + far);
        b.camera.lookAt(b.at.x, tall, b.at.z);
      }
      b.rig.update(dt, this.pose);
    }
    this.renderer.setScissorTest(true);
    for (const b of this.bays) {
      if (!b.rect.w) continue;
      const x = Math.round(b.rect.x * W), y = Math.round((1 - b.rect.y - b.rect.h) * H), w = Math.round(b.rect.w * W), h = Math.round(b.rect.h * H);
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      if (this.framing) { this.sun.target.position.copy(b.at); this.sun.position.copy(b.at).add(new THREE.Vector3(6, 12, 8)); }
      this.renderer.render(this.scene, b.camera);
    }
    this.renderer.setScissorTest(false);
  }
}

// A round plinth with a ring of light round its foot
function plinth(at: THREE.Vector3) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.3, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.3, metalness: 0.5 }));
  top.position.y = 0.0;
  top.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.025, 6, 96), new THREE.MeshBasicMaterial({ color: 0xd7ff3b }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(top, ring);
  g.position.copy(at).setY(-0.04);
  return g;
}
