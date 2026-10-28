// Points that fly and fade: sparks, flames, smoke, spray. A fixed pool, reused round and round.
import * as THREE from 'three';
import { canvas, texture } from './draw.ts';

// --- sparks, flames, smoke: a pool of points each, reused round and round ------------------------------
export class Particles {
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  readonly points: THREE.Points;

  constructor(private n: number, color: number, size: number, blending: THREE.Blending, opacity = 1) {
    this.pos = new Float32Array(n * 3).fill(-1e4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: glowTexture(), blending, transparent: true, opacity, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  // `spread`: sideways speed; `rise`: upward speed; `life`: seconds (plus a little at random)
  emit(at: THREE.Vector3, count: number, spread: number, rise: number, life = 0.3) {
    for (let i = 0; i < count; i++) {
      const k = this.next++ % this.n;
      this.pos.set([at.x + (Math.random() - 0.5) * 0.6, at.y, at.z + (Math.random() - 0.5) * 0.6], k * 3);
      this.vel.set([(Math.random() - 0.5) * spread, rise * (0.5 + Math.random()), (Math.random() - 0.5) * spread], k * 3);
      this.life[k] = life + Math.random() * life;
    }
  }

  update(dt: number, gravity: number) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e4; continue; }
      this.vel[k * 3 + 1] += gravity * dt;
      for (let j = 0; j < 3; j++) this.pos[k * 3 + j] += this.vel[k * 3 + j] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function glowTexture() {
  const c = canvas(64, 64), g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c, false);
}
