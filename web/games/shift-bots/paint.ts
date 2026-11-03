// What the bots are made of. The paint is like a real car's: a base colour under a clear coat, with
// metal flakes in the metallic and pearl finishes (a normal map of tiny facets, under the clear coat
// so the gloss stays smooth while the base sparkles). The rest: tinted glass, black trim, chrome,
// rubber, the robot's machined frame, and lights that glow.
import * as THREE from 'three';
import { canvas, seeded } from '@world/draw.ts';

export type Finish = 'gloss' | 'metallic' | 'pearl' | 'matte' | 'satin' | 'candy' | 'chrome' | 'gold';
// (the last four are bought with stars: shop.json)
export const FINISHES: { id: Finish; name: string; about: string; shop?: boolean }[] = [
  { id: 'gloss', name: 'Gloss', about: 'Deep solid colour under a clear coat' },
  { id: 'metallic', name: 'Metallic', about: 'Flakes of metal that catch the light' },
  { id: 'pearl', name: 'Pearl', about: 'Shifts colour as it turns' },
  { id: 'matte', name: 'Matte', about: 'Flat and stealthy, no shine' },
  { id: 'satin', name: 'Satin', about: 'A soft sheen, between matte and gloss', shop: true },
  { id: 'candy', name: 'Candy', about: 'Deep, glassy colour with glitter under it', shop: true },
  { id: 'chrome', name: 'Chrome', about: 'Mirror-bright, in your colour', shop: true },
  { id: 'gold', name: 'Gold plate', about: 'The whole bot in gold', shop: true },
];

// How a bot is painted: its body colour, a second colour for the trim and calipers, the finish, and the
// colour its eyes and the robot's light strips glow
export interface Livery { paint: string; accent: string; finish: Finish; eyes: string }

// The colours to choose from: hues in five shades, plus greys from white to black
export const HUES: { name: string; h: number }[] = [
  { name: 'Red', h: 0 }, { name: 'Orange', h: 24 }, { name: 'Amber', h: 40 }, { name: 'Yellow', h: 54 }, { name: 'Lime', h: 84 },
  { name: 'Green', h: 140 }, { name: 'Teal', h: 174 }, { name: 'Cyan', h: 192 }, { name: 'Blue', h: 218 }, { name: 'Indigo', h: 244 },
  { name: 'Violet', h: 272 }, { name: 'Pink', h: 322 }, { name: 'Grey', h: -1 },
];
export const SHADES = ['Light', 'Bright', 'Rich', 'Deep', 'Dark'];
export function swatch(hue: number, shade: number) {
  const h = HUES[hue], c = new THREE.Color();
  if (h.h < 0) c.setHSL(0, 0.03, [0.9, 0.68, 0.46, 0.24, 0.07][shade]);
  else c.setHSL(h.h / 360, [0.7, 0.82, 0.78, 0.72, 0.6][shade], [0.7, 0.54, 0.43, 0.3, 0.17][shade]);
  return '#' + c.getHexString();
}
export const swatchName = (hue: number, shade: number) =>
  HUES[hue].h < 0 ? ['White', 'Silver', 'Grey', 'Graphite', 'Black'][shade] : `${SHADES[shade]} ${HUES[hue].name.toLowerCase()}`;

export interface Mats {
  paint: THREE.MeshPhysicalMaterial; accent: THREE.MeshPhysicalMaterial; glass: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial; joint: THREE.MeshStandardMaterial; lamp: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial; eyes: THREE.MeshStandardMaterial;
}
export type MatName = keyof Mats;

// One set per livery, shared by every bot wearing it
const cache = new Map<string, Mats>();
export function materials(l: Livery, rich: boolean): Mats {
  const key = `${l.paint}|${l.accent}|${l.finish}|${l.eyes}|${rich}`;
  let m = cache.get(key);
  if (m) return m;
  m = {
    paint: paintMaterial(l.paint, l.finish, rich),
    accent: paintMaterial(l.accent, l.finish === 'matte' ? 'matte' : 'gloss', rich),
    glass: shell(new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.1, roughness: 0.12, envMapIntensity: 0.55, clearcoat: rich ? 0.6 : 0, clearcoatRoughness: 0.03 })),
    trim: shell(new THREE.MeshStandardMaterial({ color: 0x14161b, metalness: 0.3, roughness: 0.55 })),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecf2, metalness: 1, roughness: 0.12 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0, roughness: 0.88 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x5b606b, metalness: 0.8, roughness: 0.36 }),
    joint: new THREE.MeshStandardMaterial({ color: 0x23262d, metalness: 0.7, roughness: 0.5 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xf4f7ff, emissive: 0xe6efff, emissiveIntensity: 1.6, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xff1a22, emissiveIntensity: 1.4, roughness: 0.3 }),
    eyes: new THREE.MeshStandardMaterial({ color: l.eyes, emissive: l.eyes, emissiveIntensity: 2.4, roughness: 0.3 }),
  };
  cache.set(key, m);
  return m;
}

function paintMaterial(color: string, finish: Finish, rich: boolean) {
  const o: THREE.MeshPhysicalMaterialParameters = { color };
  switch (finish) {
    case 'gloss': Object.assign(o, { metalness: 0.05, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.035 }); break;
    case 'metallic': Object.assign(o, { metalness: 0.72, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03, normalMap: flakes(), normalScale: new THREE.Vector2(0.06, 0.06) }); break;
    case 'pearl': Object.assign(o, { metalness: 0.38, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, normalMap: flakes(), normalScale: new THREE.Vector2(0.04, 0.04),
      iridescence: 0.75, iridescenceIOR: 1.55, iridescenceThicknessRange: [180, 520] }); break;
    case 'matte': Object.assign(o, { metalness: 0.12, roughness: 0.66 }); break;
    case 'satin': Object.assign(o, { metalness: 0.45, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35 }); break;
    case 'candy': Object.assign(o, { metalness: 0.9, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.02, normalMap: flakes(), normalScale: new THREE.Vector2(0.08, 0.08) }); break;
    case 'chrome': Object.assign(o, { color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), metalness: 1, roughness: 0.07, clearcoat: 0.6 }); break;
    case 'gold': Object.assign(o, { color: 0xd9a43a, metalness: 1, roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.05 }); break;
  }
  if (!rich) { o.clearcoat = 0; o.iridescence = 0; o.normalMap = null; } // (weaker screens: plain paint)
  return shell(new THREE.MeshPhysicalMaterial(o));
}

// The body panels are thin shells seen from both sides: from behind (the inside of a door, the gap
// between panels) they're dark, like the unpainted metal inside a real car
function shell<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.06;');
  };
  m.customProgramCacheKey = () => 'shell';
  return m;
}

// Metal flakes: a tile of tiny facets, each tilted its own way
let flakeMap: THREE.Texture | null = null;
function flakes() {
  if (flakeMap) return flakeMap;
  const n = 256, c = canvas(n, n), g = c.getContext('2d')!, img = g.createImageData(n, n), rnd = seeded(11);
  for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
    const r = 128 + (rnd() - 0.5) * 150, gr = 128 + (rnd() - 0.5) * 150;
    for (let j = 0; j < 4; j++) {
      const i = ((y + (j >> 1)) * n + x + (j & 1)) * 4;
      img.data[i] = r; img.data[i + 1] = gr; img.data[i + 2] = 235; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  flakeMap = new THREE.CanvasTexture(c);
  flakeMap.wrapS = flakeMap.wrapT = THREE.RepeatWrapping;
  flakeMap.repeat.set(24, 24); // (the cars' texture coordinates span a few metres: fine flakes)
  flakeMap.anisotropy = 4;
  return flakeMap;
}
