// The helicopter that comes for the pilot: a utility helicopter (in the manner of a Black Hawk), put
// together in code: fuselage, cockpit glass, the open cabin door, sponsons, tail boom and fin, a
// four-bladed main rotor and the tail rotor (spun, and blurred into discs at speed), wheels, its
// navigation lights and a searchlight. It comes in from the south, lands at the LZ, and goes.
import * as THREE from 'three';
import { landHeight } from './land.ts';
import { LZ } from './map.ts';
import type { HeloPhase } from './sim.ts';

const PATH = { from: new THREE.Vector3(LZ.x + 40, 60, LZ.z + 220), cruise: 45, inbound: 22, leaving: 30 }; // (the inbound time matches the sim's)

export class Helicopter {
  readonly group = new THREE.Group();
  readonly light: THREE.SpotLight;
  private rotor: THREE.Object3D;
  private tail: THREE.Object3D;
  private blink: THREE.Mesh[] = [];
  private t = 0;
  wash = 0; // 0..1: how hard its rotor wash is blowing at the ground (for the dust)

  constructor() {
    const paint = new THREE.MeshStandardMaterial({ color: '#3d4234', roughness: 0.55, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1c1a', roughness: 0.5, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: '#10151a', roughness: 0.1, metalness: 0.6 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.group) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
      o.castShadow = true; o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    // (it faces -z: nose north, the way the scene's yaw 0 goes)
    const body = new THREE.CapsuleGeometry(1.15, 4.2, 6, 14);
    body.rotateX(Math.PI / 2);
    body.scale(1, 0.95, 1);
    add(body, paint, 0, 1.9, 0);
    add(new THREE.SphereGeometry(1.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 2.05, -2.55, -1.2); // the cockpit's glass
    add(new THREE.BoxGeometry(2.0, 1.3, 1.9), dark, 0, 1.85, 0.2); // the open cabin (its dark inside)
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.6, 0.35, 1.6), paint, s * 1.3, 1.45, 0.7); // sponsons
    const boom = new THREE.CylinderGeometry(0.28, 0.55, 6.5, 10);
    boom.rotateX(Math.PI / 2);
    add(boom, paint, 0, 2.35, 5.4);
    add(new THREE.BoxGeometry(0.16, 1.9, 1.1), paint, 0, 3.0, 8.4, -0.35); // the fin
    add(new THREE.BoxGeometry(2.6, 0.08, 0.6), paint, 0, 2.3, 8.0); // the stabilator
    add(new THREE.CylinderGeometry(0.5, 0.7, 0.6, 12), paint, 0, 3.1, -0.2); // the engines' housing
    for (const [x, z] of [[-1.0, -1.6], [1.0, -1.6], [0, 7.6]] as const) add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), dark, x, 0.3, z, 0, 0, Math.PI / 2); // wheels
    // the main rotor: four blades on a mast (and a disc that shows at speed)
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 3.55, -0.2);
    this.group.add(this.rotor);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.5, 0.05, 8.2), dark, 0, 0, 0, 0, (i * Math.PI) / 2 + 0.4, 0, this.rotor).position.set(Math.sin((i * Math.PI) / 2 + 0.4) * 4.1, 0, Math.cos((i * Math.PI) / 2 + 0.4) * 4.1);
    const disc = add(new THREE.CircleGeometry(8.2, 40), new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }), 0, 0, 0, -Math.PI / 2, 0, 0, this.rotor);
    disc.castShadow = false;
    this.tail = new THREE.Group();
    this.tail.position.set(0.25, 3.0, 8.6);
    this.group.add(this.tail);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.04, 1.6, 0.18), dark, 0, 0, 0, (i * Math.PI) / 4, 0, 0, this.tail);
    // navigation lights (red port, green starboard, a white strobe on the tail) and the searchlight
    for (const [c, x, y, z] of [['#ff2a2a', -1.4, 1.6, 0.7], ['#2aff5a', 1.4, 1.6, 0.7], ['#ffffff', 0, 3.9, 8.6]] as const) {
      this.blink.push(add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: c }), x, y, z));
    }
    this.light = new THREE.SpotLight(0xfff2dc, 0, 90, 0.35, 0.6, 1.2);
    this.light.position.set(0, 1.2, -2.6);
    this.light.target.position.set(0, -30, -20);
    this.group.add(this.light, this.light.target);
    this.group.visible = false;
  }

  // Where it is, for the phase the sim says and how long it's been in it
  update(dt: number, phase: HeloPhase, phaseT: number, dark: number) {
    this.t += dt;
    const lz = new THREE.Vector3(LZ.x, landHeight(LZ.x, LZ.z), LZ.z);
    this.group.visible = phase !== 'away';
    if (!this.group.visible) { this.wash = 0; return; }
    let pos: THREE.Vector3, heading = 0, pitch = 0, spin = 1;
    if (phase === 'inbound') {
      const k = Math.min(1, phaseT / PATH.inbound);
      const e = 1 - (1 - k) * (1 - k); // (slowing as it comes in)
      pos = PATH.from.clone().lerp(lz.clone().add(new THREE.Vector3(0, 6, 0)), e);
      pos.y = THREE.MathUtils.lerp(PATH.cruise, lz.y + 6, Math.pow(k, 1.6));
      heading = Math.atan2(lz.x - PATH.from.x, -(lz.z - PATH.from.z));
      pitch = k > 0.75 ? -0.18 * (1 - k) / 0.25 * -1 : 0.12; // (nose down coming in, flaring at the end)
    } else if (phase === 'landed') {
      const k = Math.min(1, phaseT / 3);
      pos = lz.clone().add(new THREE.Vector3(0, 6 * (1 - k), 0));
      heading = Math.atan2(lz.x - PATH.from.x, -(lz.z - PATH.from.z));
      pitch = -0.08 * (1 - k);
    } else {
      const k = Math.min(1, phaseT / PATH.leaving);
      pos = lz.clone().add(new THREE.Vector3(0, Math.min(1, phaseT / 4) * 10 + k * k * 60, -k * 200));
      heading = Math.atan2(lz.x - PATH.from.x, -(lz.z - PATH.from.z)) + k * Math.PI * 0.9;
      pitch = 0.15 * Math.min(1, phaseT / 3);
      if (k >= 1) spin = 0;
    }
    this.group.position.copy(pos);
    this.group.rotation.set(pitch, Math.PI - heading, 0, 'YXZ');
    this.rotor.rotation.y += dt * 28 * spin;
    this.tail.rotation.x += dt * 60 * spin;
    const strobe = Math.sin(this.t * 6) > 0.85;
    this.blink[2].visible = strobe;
    this.light.intensity = dark > 0.4 ? 400 : 0;
    const above = pos.y - landHeight(pos.x, pos.z);
    this.wash = Math.max(0, 1 - above / 25);
  }
}
