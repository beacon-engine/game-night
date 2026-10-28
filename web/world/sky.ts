// The sky over a venue, the stars at night, and what the cars' paint and glass reflect, for any time
// of day a racing game lights (each game keeps its own table of times).
import * as THREE from 'three';
import { canvas, seeded, texture } from './draw.ts';

// What these need to know about a time of day: the sky's colours top to horizon, the sun's colour
// and strength and where it is, how dark it is (1: full day), and whether the floodlights are on
export interface Light {
  sky: readonly [string, string];
  sun: readonly [number, number];
  sunAt: readonly [number, number, number];
  dim: number;
  lamps?: boolean;
}

// What the cars' paint reflects: this sky, this ground, and bright panels where the light comes from
export function reflections(time: Light, ground: string) {
  const env = new THREE.Scene();
  const c = canvas(4, 256), g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  const earth = '#' + new THREE.Color(ground).multiplyScalar(time.dim * 0.5).getHexString();
  grad.addColorStop(0, time.sky[0]);
  grad.addColorStop(0.48, time.sky[1]);
  grad.addColorStop(0.52, earth);
  grad.addColorStop(1, earth);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: texture(c, false), side: THREE.BackSide })));
  const panel = (p: THREE.Vector3, w: number, h: number, color: number, power: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.copy(p);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(new THREE.Vector3(...time.sunAt).normalize().multiplyScalar(80), 30, 30, time.sun[0], 6);
  panel(new THREE.Vector3(0, 90, 0), 120, 20, 0xffffff, time.lamps ? 2.5 : 1.5);
  if (time.lamps) for (const a of [0.6, 2.2, 3.8, 5.4]) panel(new THREE.Vector3(Math.cos(a) * 75, 40, Math.sin(a) * 75), 14, 8, 0xfff1d0, 5);
  return env;
}

// A dome with the sky's colours, from the top down to the horizon
export function sky(top: string, horizon: string, radius = 5000) {
  const c = canvas(4, 256), g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.75, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.1),
    new THREE.MeshBasicMaterial({ map: texture(c, false), side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.userData.sky = true; // (rain.ts clouds it over)
  return dome;
}

export function stars() {
  const n = 900, pos = new Float32Array(n * 3), rnd = seeded(3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.4, r = 4500;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d0e8, size: 1.6, sizeAttenuation: false, fog: false }));
}
