// ez-tree's texture lookup, without its bundled images: the game hands in its own (free-licensed)
// bark and leaf textures with setTreeTextures() before it grows any trees. Every bark type wears the
// same bark, every leaf type the same leaves (tinted per tree by the options).
import * as THREE from 'three';

const set = { bark: null, leaves: null };

/**
 * @param {{ bark: { color: THREE.Texture, normal: THREE.Texture, arm: THREE.Texture }, leaves: THREE.Texture }} textures
 *   (arm: ambient occlusion, roughness, metalness in r, g, b, as Poly Haven packs them)
 */
export function setTreeTextures(textures) {
  set.bark = textures.bark;
  set.leaves = textures.leaves;
}

const cache = new Map();

/**
 * @param {string} type (any: they all share the bark)
 * @param {'ao' | 'color' | 'normal' | 'roughness'} map
 * @param {{ x: number, y: number }} scale
 */
export function getBarkTexture(type, map, scale = { x: 1, y: 1 }) {
  if (!set.bark) throw new Error('setTreeTextures() first');
  const key = `${map}:${scale.x}:${scale.y}`;
  if (cache.has(key)) return cache.get(key);
  const src = map === 'color' ? set.bark.color : map === 'normal' ? set.bark.normal : set.bark.arm;
  const t = src.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.x = scale.x;
  t.repeat.y = 1 / scale.y;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** @param {string} type (any: they all share the leaves) */
export function getLeafTexture(type) {
  if (!set.leaves) throw new Error('setTreeTextures() first');
  return set.leaves;
}
