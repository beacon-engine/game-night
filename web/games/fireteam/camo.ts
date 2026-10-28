// Camouflage, printed on the cloth: a pattern of soft-edged blotches in four or five colours, worked
// out on the garment as it was made (its rest shape), so it folds and stretches with the man. The
// garment's own texture (grey) still shades it: folds, seams, pockets.
import * as THREE from 'three';

export interface Pattern { colors: [string, string, string, string, string?]; scale: number } // base and blotches (the fifth: small light flecks); blotches a metre

export const CAMO = {
  // a multi-terrain pattern: tan, brown, green, dark brown, cream flecks
  ours: { colors: ['#a8996f', '#7f6e4c', '#5c6847', '#41372a', '#d6cba6'], scale: 7 } as Pattern,
  // a woodland-type pattern: olive, dark green, brown, black-green
  theirs: { colors: ['#646b49', '#3f4a32', '#6f5c40', '#262a20'], scale: 5.5 } as Pattern,
};

const GLSL = /* glsl */ `
varying vec3 vRest;
uniform vec3 camoA, camoB, camoC, camoD, camoE;
uniform float camoScale, camoFleck;
float c_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float c_noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(c_hash(i), c_hash(i + vec3(1, 0, 0)), f.x), mix(c_hash(i + vec3(0, 1, 0)), c_hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(c_hash(i + vec3(0, 0, 1)), c_hash(i + vec3(1, 0, 1)), f.x), mix(c_hash(i + vec3(0, 1, 1)), c_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float c_fbm(vec3 p) { return c_noise(p) * 0.6 + c_noise(p * 2.1 + 7.3) * 0.3 + c_noise(p * 4.3 + 1.7) * 0.1; }
vec3 camo(vec3 p) {
  vec3 q = p * vec3(1.0, 0.8, 1.0) * camoScale; // (a little taller than wide, as the patterns are)
  vec3 c = camoA;
  c = mix(c, camoB, smoothstep(0.52, 0.56, c_fbm(q + 11.0)));
  c = mix(c, camoC, smoothstep(0.54, 0.58, c_fbm(q * 1.15 + 23.0)));
  c = mix(c, camoD, smoothstep(0.6, 0.63, c_fbm(q * 1.3 + 41.0)));
  if (camoFleck > 0.5) c = mix(c, camoE, smoothstep(0.7, 0.72, c_noise(q * 3.0 + 3.0)));
  return c;
}`;

// Paint a material with a pattern (its colour is set to white: the pattern is the colour now)
export function paintCamo(m: THREE.MeshStandardMaterial, p: Pattern) {
  m.color.set('#ffffff');
  const col = (i: number) => ({ value: new THREE.Color(p.colors[i] ?? p.colors[0]) }); // (CSS colours are sRGB: THREE.Color keeps them linear)
  const u = { camoA: col(0), camoB: col(1), camoC: col(2), camoD: col(3), camoE: col(4), camoScale: { value: p.scale }, camoFleck: { value: p.colors[4] ? 1 : 0 } };
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    before.call(m, s, r);
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL}`)
      // (the texture's shading kept, but softened: a knit or a weave shouldn't show through the print)
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = camo(vRest) * mix(1.0, clamp(diffuseColor.r * 1.25, 0.0, 1.2), 0.45);');
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|camo';
  m.needsUpdate = true;
}
