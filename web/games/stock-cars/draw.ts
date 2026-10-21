// Small helpers for the textures and scenery, which are drawn in code rather than downloaded.
import * as THREE from 'three';

export const DISPLAY_FONT = '"Big Shoulders Display", "Arial Narrow", sans-serif';

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function texture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Grit: little squares of grey around `light`
export function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, light: number, rnd: () => number, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(light + (rnd() - 0.5) * 40);
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}

// The same "random" numbers every time, so a venue looks the same each visit
export function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// Smooth noise in 0..1 (value noise, a few octaves): hills, rock, patches of colour
export function noise2(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const one = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number, octaves = 4) => {
    let sum = 0, amp = 0.5, total = 0;
    for (let o = 0; o < octaves; o++) { sum += one(x * 2 ** o, y * 2 ** o) * amp; total += amp; amp /= 2; }
    return sum / total;
  };
}
