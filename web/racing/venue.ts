// Building a venue from a track (track.ts): ribbons along the lap, cars placed on the banked
// surface, and the textures every track has (kerbs, the crowd).
import * as THREE from 'three';
import { canvas, seeded, texture } from '@world/draw.ts';
import type { Track } from './track.ts';

const STEP = 4; // m between the rings of the track's meshes
export const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const basis = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

// The banked surface's up direction at d (it leans in toward the inside of the turn)
export function surfaceUp(t: Track, s: number, d: number) {
  const p = t.at(s), b = Math.atan(t.slope(s, d));
  return new THREE.Vector3(p.hz * Math.sin(b), Math.cos(b), -p.hx * Math.sin(b));
}

// A car on the track: along it, tilted with the banking, turned by its slide or spin
export function place(t: Track, o: THREE.Object3D, s: number, d: number, yaw: number) {
  const p = t.point(s, d);
  const f = new THREE.Vector3(p.p.hx, 0, p.p.hz), right = new THREE.Vector3(-p.p.hz, 0, p.p.hx);
  basis.makeBasis(f, UP, right);
  o.quaternion.setFromRotationMatrix(basis)
    .multiply(q1.setFromAxisAngle(X, -Math.atan(t.slope(s, d))))
    .multiply(q2.setFromAxisAngle(UP, -yaw));
  o.position.set(p.x, p.y, p.z);
}

// A ribbon along the lap (or part of it) between two edges: inner edge first, so it faces up / inwards.
// u0..u1: the part of the texture across it.
export function strip(t: Track, a: (s: number) => THREE.Vector3, b: (s: number) => THREE.Vector3, tile: number, s0 = 0, s1 = t.length, u0 = 0, u1 = 1) {
  const n = Math.max(1, Math.ceil((s1 - s0) / STEP)), pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, p = a(s), q = b(s), v = (s - s0) / tile;
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uv.push(u0, v, u1, v);
    if (i < n) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function kerbTexture() {
  const c = canvas(16, 64), g = c.getContext('2d')!;
  for (let y = 0; y < 64; y += 16) {
    g.fillStyle = y % 32 ? '#f3f0e8' : '#c8323a';
    g.fillRect(0, y, 16, 16);
  }
  return texture(c);
}

// rows of people (x across the stand, y along it)
export function crowdTexture() {
  const c = canvas(256, 512), g = c.getContext('2d')!, rnd = seeded(23);
  g.fillStyle = '#1d2029';
  g.fillRect(0, 0, 256, 512);
  const shirts = ['#d8d4cb', '#c4505a', '#4a74c4', '#d0a640', '#38a07a', '#b45aa0', '#7d7b85', '#a6c043', '#c47a45', '#2a2e3a'];
  for (let row = 0; row < 32; row++) {
    g.fillStyle = '#12141b';
    g.fillRect(row * 8 + 6, 0, 2, 512);
    for (let y = 0; y < 512; y += 4) {
      if (rnd() < 0.15) continue;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      g.fillRect(row * 8 + 2, y + rnd(), 4, 3);
      g.fillStyle = '#8d6e5a';
      g.fillRect(row * 8, y + rnd(), 2, 2);
    }
  }
  return texture(c);
}
