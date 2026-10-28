// The land Fireteam is fought over, drawn from map.ts: rolling ground painted with photographed
// surfaces (grass, mud tracks, plough, leaf litter, scorched earth), hedgerows on their earth banks,
// dry-stone walls, wire, oaks and ashes and an orchard, a stone farm, a crossroads, and the clutter of
// war. Every texture and model is Poly Haven's (CC0); the trees are grown by ez-tree (MIT,
// web/world/trees/) and wear Poly Haven bark and leaves. Nothing here moves but the wind.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadPreset, setTreeTextures, Tree as EzTree, type TreeJson } from '@world/trees/index.js';
import { cutaway } from './cutaway.ts';
import {
  BUILDINGS, CRATERS, FIELDS, Ground, height, Kind, Line, MAP, Prop, ROAD, ROAD_W, RUNS, Style, THINGS, TRACK, TRACK_W, TREES,
  type Building,
} from './map.ts';

const TEX = 'models/tex/', PROPS = 'models/props/';
const BEYOND = 110; // m of land past the edge of the map, fading into the haze
const EXTENT = { w: MAP.w + BEYOND * 2, d: MAP.d + BEYOND * 2 };
const BANK = { h: 1.0, top: 0.5, foot: 1.5 }; // a hedgerow's earth bank: m high; half-widths of its top and its foot

let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + rnd() * (b - a);

// --- loading -----------------------------------------------------------------------------------------------
const SURFACES = ['leafy_grass', 'sparse_grass', 'muddy_tracks', 'dry_mud_field_001', 'brown_mud_leaves_01', 'forest_leaves_03', 'burned_ground_01',
  'rustic_stone_wall', 'plastered_stone_wall', 'clay_roof_tiles_02', 'weathered_planks', 'bark_brown_02', 'stacked_stone_wall'] as const;
type Surface = (typeof SURFACES)[number];
interface PBR { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture }
const PROP_MODELS = ['ammo_box', 'dead_tree_trunk', 'metal_jerrycan_green', 'nettle_plant', 'rock_moss_set_01', 'shrub_02', 'shrub_04',
  'tree_stump_01', 'wooden_barrels_01', 'wooden_crate_02', 'wooden_military_crate'] as const;
type PropModel = (typeof PROP_MODELS)[number];

export interface LandAssets {
  surfaces: Record<Surface, PBR>;
  props: Record<PropModel, THREE.Object3D>;
  leaves: THREE.Texture; // twigs of leaves, for the trees and the hedges
  grass: THREE.Texture; wheat: THREE.Texture; // clumps, four across
  sky: THREE.Texture;
}

export async function loadLand(): Promise<LandAssets> {
  const tl = new THREE.TextureLoader(), il = new THREE.ImageLoader();
  const draco = new DRACOLoader().setDecoderPath('/people/draco/');
  draco.setDecoderConfig({ type: 'wasm' });
  const gl = new GLTFLoader().setDRACOLoader(draco);
  const tex = async (name: string, color: boolean) => {
    const t = await tl.loadAsync(TEX + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [surfaces, props, leafImgs, grassImgs, sky] = await Promise.all([
    Promise.all(SURFACES.map(async (s) => [s, { map: await tex(`${s}_diff.jpg`, true), normalMap: await tex(`${s}_nor.jpg`, false), arm: await tex(`${s}_arm.jpg`, false) }] as const)),
    Promise.all(PROP_MODELS.map(async (p) => {
      const g = await gl.loadAsync(`${PROPS}${p}.glb`);
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
      return [p, g.scene] as const;
    })),
    Promise.all(['shrub_01_diff.jpg', 'shrub_01_alpha.jpg'].map((f) => il.loadAsync(TEX + f))),
    Promise.all(['grass_medium_01_diff.jpg', 'grass_medium_01_alpha.jpg'].map((f) => il.loadAsync(TEX + f))),
    new HDRLoader().loadAsync(TEX + 'sky.hdr'),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  return {
    surfaces: Object.fromEntries(surfaces) as Record<Surface, PBR>,
    props: Object.fromEntries(props) as unknown as Record<PropModel, THREE.Object3D>,
    leaves: twigs(leafImgs[0], leafImgs[1]),
    grass: clumps(grassImgs[0], grassImgs[1], null),
    wheat: clumps(grassImgs[0], grassImgs[1], '#c9ad6a'),
    sky,
  };
}

// An image's colour with another's brightness as its alpha (Poly Haven ships cut-outs that way)
function cutout(diff: HTMLImageElement, alpha: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = diff.width; c.height = diff.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(alpha, 0, 0);
  const a = g.getImageData(0, 0, c.width, c.height);
  g.drawImage(diff, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = a.data[i];
  g.putImageData(d, 0, 0);
  return c;
}

function canvasTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Twigs of leaves, made from Poly Haven's leaf sheet (shrub_01): five green leaves (in its pixels, stem
// at the bottom), fanned out along a few brown stems
const LEAF_RECTS: [number, number, number, number][] = [[460, 13, 705, 500], [755, 128, 910, 360], [205, 420, 485, 745], [730, 395, 950, 715]]; // (below about y 750 the sheet is bark, solid)
function twigs(diff: HTMLImageElement, alpha: HTMLImageElement) {
  const sheet = cutout(diff, alpha);
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  seed = 77;
  // stems: from the bottom middle, up and out
  const stems: [number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const a = -0.75 + k * 0.5 + between(-0.12, 0.12), len = between(300, 420);
    stems.push([a, len, k]);
    g.strokeStyle = '#5a4630'; g.lineWidth = 7 - k * 0.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(S / 2, S); g.lineTo(S / 2 + Math.sin(a) * len, S - Math.cos(a) * len); g.stroke();
  }
  // leaves along them, each turned out from its stem, the near ones bigger
  for (let i = 0; i < 22; i++) {
    const [a, len] = stems[i % stems.length];
    const u = 0.3 + 0.7 * ((i * 0.37) % 1);
    const x = S / 2 + Math.sin(a) * len * u, y = S - Math.cos(a) * len * u;
    const [x0, y0, x1, y1] = LEAF_RECTS[i % LEAF_RECTS.length];
    const w = x1 - x0, h = y1 - y0, k = between(110, 175) / Math.max(w, h);
    g.save();
    g.translate(x, y);
    g.rotate(a + (i % 2 ? 1 : -1) * between(0.5, 1.1));
    g.drawImage(sheet, x0, y0, w, h, -(w * k) / 2, -h * k, w * k, h * k);
    g.restore();
  }
  const t = canvasTexture(c);
  return t;
}

// Four clumps of grass across one strip (from grass_medium_01), stems at the bottom; `tint` turns them
// to ripe wheat
const CLUMP_RECTS: [number, number, number, number][] = [[205, 765, 500, 882], [605, 778, 830, 866], [30, 890, 190, 982], [255, 905, 500, 992]]; // (stopping short of their cut-off bases)
function clumps(diff: HTMLImageElement, alpha: HTMLImageElement, tint: string | null) {
  const sheet = cutout(diff, alpha);
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  CLUMP_RECTS.forEach(([x0, y0, x1, y1], i) => {
    const w = x1 - x0, h = y1 - y0, k = Math.min(250 / w, 250 / h);
    g.drawImage(sheet, x0, y0, w, h, i * 256 + 128 - (w * k) / 2, 256 - h * k, w * k, h * k);
  });
  if (tint) {
    g.globalCompositeOperation = 'color';
    g.fillStyle = tint;
    g.fillRect(0, 0, 1024, 256);
    g.globalCompositeOperation = 'destination-in';
    for (let i = 0; i < 4; i++) {
      const [x0, y0, x1, y1] = CLUMP_RECTS[i], w = x1 - x0, h = y1 - y0, k = Math.min(250 / w, 250 / h);
      g.drawImage(sheet, x0, y0, w, h, i * 256 + 128 - (w * k) / 2, 256 - h * k, w * k, h * k);
    }
    g.globalCompositeOperation = 'source-over';
  }
  return canvasTexture(c);
}

// --- materials ----------------------------------------------------------------------------------------------
// A surface's material; its geometry's uvs are in metres over `tile` (what one texture covers)
const TILE: Partial<Record<Surface, number>> = { rustic_stone_wall: 2.4, plastered_stone_wall: 3, clay_roof_tiles_02: 2.2, weathered_planks: 2, stacked_stone_wall: 2, brown_mud_leaves_01: 3 };
function surface(a: LandAssets, s: Surface, opts: THREE.MeshStandardMaterialParameters = {}) {
  const p = a.surfaces[s];
  return new THREE.MeshStandardMaterial({ map: p.map, normalMap: p.normalMap, aoMap: p.arm, roughnessMap: p.arm, metalness: 0, ...opts });
}

// The wind in the leaves and the grass: a sway that grows toward the tips (`up`: how a vertex's height
// in its model scales the sway; m at the top)
const wind = { value: 0 };
function windy<T extends THREE.Material>(m: T, amount: number, up: string): T {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    before.call(m, shader, r);
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform float uWind;\nvoid main() {').replace('#include <begin_vertex>', `#include <begin_vertex>
	#ifdef USE_INSTANCING
		vec3 swayAt = instanceMatrix[3].xyz;
	#else
		vec3 swayAt = vec3(0.0);
	#endif
	swayAt += (modelMatrix * vec4(position, 1.0)).xyz * 0.15;
	float sway = sin(uWind * 1.3 + swayAt.x * 0.31 + swayAt.z * 0.23) * 0.7 + sin(uWind * 2.9 + swayAt.x * 0.9 - swayAt.z * 0.6) * 0.3;
	float swayUp = clamp(${up}, 0.0, 1.0);
	transformed.x += sway * ${amount.toFixed(3)} * swayUp;
	transformed.z += sway * ${(amount * 0.5).toFixed(3)} * swayUp;`);
    // (foliage is lit as a mass from both sides: no flipping the normal for the back of a leaf)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + `|wind${amount}${up}`;
  return m;
}

// Shadows the shape of the leaves, not of the cards they're drawn on
function leafShadow(mesh: THREE.Mesh, map: THREE.Texture, alphaTest: number) {
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
}

// --- the shape of the land -----------------------------------------------------------------------------------
// Hedgerows: those in the map, and a ring of them round its edge (where the map stops, the hedges do)
type Seg = [number, number, number, number];
const EDGE = 1.5;
const HEDGE_RUNS: [number, number][][] = [
  ...RUNS.filter((r) => r.kind === Line.Hedge).map((r) => r.points),
  [[-MAP.w / 2 + EDGE, MAP.d / 2 - EDGE], [MAP.w / 2 - EDGE, MAP.d / 2 - EDGE]],
  [[-MAP.w / 2 + EDGE, -MAP.d / 2 + EDGE], [MAP.w / 2 - EDGE, -MAP.d / 2 + EDGE]],
  [[-MAP.w / 2 + EDGE, -MAP.d / 2 + EDGE], [-MAP.w / 2 + EDGE, MAP.d / 2 - EDGE]],
  [[MAP.w / 2 - EDGE, -MAP.d / 2 + EDGE], [MAP.w / 2 - EDGE, MAP.d / 2 - EDGE]],
];
const HEDGE_SEGS: Seg[] = HEDGE_RUNS.flatMap((p) => p.slice(1).map((b, i) => [p[i][0], p[i][1], b[0], b[1]] as Seg));

function segDist(x: number, z: number, [ax, az, bx, bz]: Seg) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * u, z - az - dz * u);
}

// The ground's height with the hedgebanks on it, and hills beyond the map
export function landHeight(x: number, z: number) {
  const ox = Math.max(0, Math.abs(x) - MAP.w / 2), oz = Math.max(0, Math.abs(z) - MAP.d / 2);
  let h = height(Math.max(-MAP.w / 2, Math.min(MAP.w / 2, x)), Math.max(-MAP.d / 2, Math.min(MAP.d / 2, z)));
  if (ox || oz) h += Math.hypot(ox, oz) * 0.09 * (1.2 + Math.sin(x * 0.05) * Math.cos(z * 0.043)) + 2 * Math.sin(x * 0.021 + z * 0.017) * Math.min(1, Math.hypot(ox, oz) / 30);
  let bank = 0;
  for (const s of HEDGE_SEGS) {
    const d = segDist(x, z, s);
    if (d < BANK.foot) bank = Math.max(bank, d < BANK.top ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (d - BANK.top)) / (BANK.foot - BANK.top)));
  }
  return h + bank * BANK.h;
}

// --- the ground -----------------------------------------------------------------------------------------------
// Where each surface lies, painted at 2 px a metre over the whole land: a = (mud, plough, leaf litter,
// unused), b = (stubble and wheat, scorched earth, unused)
const PPM = 2;
function paintSplat() {
  const W = EXTENT.w * PPM, D = EXTENT.d * PPM;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = D;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, D);
    g.globalCompositeOperation = 'lighter';
    g.setTransform(PPM, 0, 0, PPM, (EXTENT.w / 2) * PPM, (EXTENT.d / 2) * PPM); // (metres from here on)
    return { c, g };
  };
  const a = make(), b = make();
  const line = (g: CanvasRenderingContext2D, pts: [number, number][], w: number, col: string) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke();
  };
  const blob = (g: CanvasRenderingContext2D, x: number, z: number, r: number, col: string) => { g.fillStyle = col; g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill(); };
  seed = 99;
  // the track and the road: two ruts and a grassy middle on the track
  for (const off of [-0.7, 0.7]) line(a.g, TRACK.map(([x, z]) => [x + off, z]), TRACK_W * 0.42, 'rgb(255,0,0)');
  line(a.g, TRACK, TRACK_W, 'rgb(110,0,0)');
  line(a.g, ROAD, ROAD_W, 'rgb(255,0,0)');
  // the farmyard, trodden to mud; mud in the gateways
  a.g.fillStyle = 'rgb(150,0,0)'; a.g.fillRect(-58, -1, 38, 28);
  for (let i = 0; i < 40; i++) blob(a.g, between(-58, -20), between(-1, 27), between(1, 3.5), 'rgb(90,0,0)');
  for (const s of HEDGE_SEGS) for (const [x, z] of [[s[0], s[1]], [s[2], s[3]]]) blob(a.g, x, z, 3, 'rgb(90,0,0)');
  // fields
  for (const f of FIELDS) {
    const col = f.kind === Ground.Plough ? 'rgb(0,255,0)' : f.kind === Ground.Woods ? 'rgb(0,0,255)' : null;
    if (col) { a.g.fillStyle = col; a.g.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d); }
    if (f.kind === Ground.Wheat) { b.g.fillStyle = 'rgb(255,0,0)'; b.g.fillRect(f.x - f.w / 2, f.z - f.d / 2, f.w, f.d); }
  }
  a.g.fillStyle = 'rgb(0,0,255)'; a.g.fillRect(-EXTENT.w / 2, -EXTENT.d / 2, EXTENT.w, BEYOND - 8); // (the woods go on north)
  // leaf litter on the hedgebanks and under the trees; trampled stubble in patches
  for (const p of HEDGE_RUNS) line(a.g, p, BANK.foot * 2 + 0.6, 'rgb(0,0,230)');
  for (const t of TREES) blob(a.g, t.x, t.z, 2.5 * t.size, 'rgb(0,0,120)');
  for (let i = 0; i < 260; i++) blob(b.g, between(-EXTENT.w / 2, EXTENT.w / 2), between(-EXTENT.d / 2, EXTENT.d / 2), between(2, 7), 'rgb(70,0,0)');
  // shell holes: scorched, and splashed round
  for (const c of CRATERS) {
    blob(b.g, c.x, c.z, c.r * 1.15, 'rgb(0,255,0)');
    for (let i = 0; i < 6; i++) blob(b.g, c.x + between(-2, 2) * c.r, c.z + between(-2, 2) * c.r, between(0.4, 1.2), 'rgb(0,120,0)');
  }
  const tex = (c: HTMLCanvasElement) => {
    blur(c, 3);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false; // (row 0 is the north edge)
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  return { a: tex(a.c), b: tex(b.c), aData: a.g.getImageData(0, 0, W, D).data, bData: b.g.getImageData(0, 0, W, D).data };
}

// (a quick blur, so the surfaces fade into each other: box blurs across and down)
function blur(c: HTMLCanvasElement, r: number) {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width, H = c.height;
  const tmp = new Float32Array(W * H * 3);
  for (let pass = 0; pass < 2; pass++) {
    const [n, m, step, along] = pass === 0 ? [H, W, 4, 4 * W] : [W, H, 4 * W, 4];
    for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      const base = i * along + ch;
      for (let j = -r; j <= r; j++) sum += d[base + Math.max(0, Math.min(m - 1, j)) * step];
      for (let j = 0; j < m; j++) {
        tmp[(i * m + j) * 3 + ch] = sum / (2 * r + 1);
        sum += d[base + Math.min(m - 1, j + r + 1) * step] - d[base + Math.max(0, j - r) * step];
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let ch = 0; ch < 3; ch++) d[i * along + j * step + ch] = tmp[(i * m + j) * 3 + ch];
  }
  g.putImageData(img, 0, 0);
}

function splatAt(data: Uint8ClampedArray, x: number, z: number, ch: number) {
  const i = Math.floor((x + EXTENT.w / 2) * PPM), j = Math.floor((z + EXTENT.d / 2) * PPM);
  if (i < 0 || j < 0 || i >= EXTENT.w * PPM || j >= EXTENT.d * PPM) return 0;
  return data[(j * EXTENT.w * PPM + i) * 4 + ch] / 255;
}

function ground(a: LandAssets, splat: ReturnType<typeof paintSplat>) {
  const geo = new THREE.PlaneGeometry(EXTENT.w, EXTENT.d, EXTENT.w, EXTENT.d);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, landHeight(x, z));
    uv.setXY(i, x / 4, -z / 4); // (metres over 4: the grass's tile)
  }
  geo.computeVertexNormals();
  const s = a.surfaces;
  const m = new THREE.MeshStandardMaterial({ map: s.leafy_grass.map, normalMap: s.leafy_grass.normalMap, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    const tex: Record<string, THREE.Texture> = {
      tSparse: s.sparse_grass.map, tMud: s.muddy_tracks.map, tPlough: s.dry_mud_field_001.map, tLitter: s.brown_mud_leaves_01.map, tWoods: s.forest_leaves_03.map, tBurnt: s.burned_ground_01.map,
      nMud: s.muddy_tracks.normalMap, nPlough: s.dry_mud_field_001.normalMap, splatA: splat.a, splatB: splat.b,
    };
    for (const [k, v] of Object.entries(tex)) shader.uniforms[k] = { value: v };
    shader.uniforms.uExtent = { value: new THREE.Vector4(-EXTENT.w / 2, -EXTENT.d / 2, EXTENT.w, EXTENT.d) };
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying vec2 vGround;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGround = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `varying vec2 vGround;
uniform sampler2D ${Object.keys(tex).join(', ')};
uniform vec4 uExtent;
vec4 gA, gB;
// (two scales of a texture blended, so its repeats don't show)
vec3 twice(sampler2D t, vec2 p) { return mix(texture2D(t, p).rgb, texture2D(t, p * 0.29 + 0.37).rgb, 0.4); }
float lum(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }
// (blend by height: a surface shows first in the grooves of the one under it)
float over(float w, float under) { return smoothstep(0.0, 1.0, clamp(w * 1.6 - 0.3 + (0.5 - under) * 0.7 * (1.0 - abs(w - 0.5) * 2.0), 0.0, 1.0)); }
void main() {`)
      .replace('#include <map_fragment>', `
	vec2 sUv = (vGround - uExtent.xy) / uExtent.zw;
	gA = texture2D(splatA, sUv); gB = texture2D(splatB, sUv);
	vec2 p = vGround / 4.0;
	vec3 c = twice(map, vec2(p.x, -p.y));
	float patchy = texture2D(tSparse, p * 0.031).g;
	c = mix(c, twice(tSparse, p), over(clamp(gB.r * 0.9 + (patchy - 0.45) * 0.4, 0.0, 1.0), lum(c)));
	// (June in Normandy: the pasture is lush, greener than the photographs; the wheat fields stay straw)
	float l0 = lum(c);
	vec3 green = (0.03 + l0 * 0.68) * vec3(0.5, 0.8, 0.24);
	c = mix(c, mix(green, c * vec3(1.08, 1.0, 0.8), clamp(gB.r * 1.4, 0.0, 1.0)), 0.9 * (1.0 - gA.r) * (1.0 - gA.g) * (1.0 - clamp(gA.b * 1.5, 0.0, 1.0)));
	c = mix(c, texture2D(tPlough, p * 0.7).rgb, over(gA.g, lum(c)));
	c = mix(c, twice(tLitter, p * 1.3), over(gA.b * 0.85, lum(c)));
	c = mix(c, twice(tWoods, p), over(clamp(gA.b * 2.0 - 1.2, 0.0, 1.0), lum(c)));
	c = mix(c, twice(tMud, p * 1.1), over(gA.r, lum(c)));
	c = mix(c, texture2D(tBurnt, p * 1.4).rgb, over(gB.g, lum(c)));
	diffuseColor.rgb *= c;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps).replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz;
	mapN = mix(mapN, texture2D(nPlough, vec2(vGround.x, -vGround.y) / 4.0 * 0.7).xyz, gA.g);
	mapN = mix(mapN, texture2D(nMud, vec2(vGround.x, -vGround.y) / 4.0 * 1.1).xyz, gA.r);
	mapN = mapN * 2.0 - 1.0;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix(roughnessFactor, 0.62, gA.r * 0.7);');
  };
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  return mesh;
}

// --- instancing ------------------------------------------------------------------------------------------------
// Every mesh in a model, drawn at each of `at` in one go
function instances(model: THREE.Object3D, at: THREE.Matrix4[], shadows = true, wrap?: (m: THREE.Material) => THREE.Material) {
  const g = new THREE.Group();
  if (!at.length) return g;
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = wrap ? wrap(mesh.material as THREE.Material) : (mesh.material as THREE.Material);
    const inst = new THREE.InstancedMesh(mesh.geometry, mat, at.length);
    const m = new THREE.Matrix4();
    at.forEach((p, i) => inst.setMatrixAt(i, m.multiplyMatrices(p, mesh.matrixWorld)));
    inst.castShadow = shadows; inst.receiveShadow = true;
    const std = mat as THREE.MeshStandardMaterial;
    if (std.map && (std.alphaTest > 0 || std.transparent)) { std.alphaTest = Math.max(std.alphaTest, 0.4); std.transparent = false; leafShadow(inst, std.map, std.alphaTest); }
    inst.computeBoundingSphere();
    g.add(inst);
  });
  return g;
}

const placed = (x: number, z: number, rotY: number, scale: number | THREE.Vector3, y = landHeight(x, z)) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale);

// One piece of a Poly Haven set (they lay several variants out side by side): the meshes whose names match,
// stood at the middle, on the ground
function part(model: THREE.Object3D, name: RegExp) {
  const o = model.clone();
  o.updateMatrixWorld(true);
  const drop: THREE.Object3D[] = [];
  o.traverse((q) => { if ((q as THREE.Mesh).isMesh && !name.test(q.name)) drop.push(q); });
  for (const q of drop) q.removeFromParent();
  const box = new THREE.Box3().setFromObject(o), mid = box.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  o.position.sub(new THREE.Vector3(mid.x, box.min.y, mid.z));
  g.add(o);
  return g;
}

// A model's size (m): to scale photographed props to what the map says they take
function sizeOf(o: THREE.Object3D) {
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

// --- trees -------------------------------------------------------------------------------------------------------
interface Grown { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; barkMat: THREE.Material; leafMat: THREE.Material; h: number }

function grow(a: LandAssets, preset: string, seedN: number, tint: string, tune: (j: TreeJson & Record<string, any>) => void = () => {}): Grown {
  const json = loadPreset(preset) as TreeJson & Record<string, any>;
  json.seed = seedN;
  tune(json);
  const t = new EzTree();
  t.loadFromJson(json);
  const phong = t.branchesMesh.material as THREE.MeshPhongMaterial & { roughnessMap: THREE.Texture | null };
  const bark = t.branchesMesh.geometry, leaves = t.leavesMesh.geometry;
  bark.computeBoundingBox();
  leaves.computeBoundingBox();
  const h = Math.max(bark.boundingBox!.max.y, leaves.boundingBox!.max.y);
  // leaves lit as one canopy: each faces out from its middle
  const mid = leaves.boundingBox!.getCenter(new THREE.Vector3());
  const lp = leaves.attributes.position, ln = leaves.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < lp.count; i++) {
    v.set(lp.getX(i) - mid.x, (lp.getY(i) - mid.y) * 0.7 + h * 0.15, lp.getZ(i) - mid.z).normalize();
    ln.setXYZ(i, v.x, v.y, v.z);
  }
  const barkMat = cutaway(new THREE.MeshStandardMaterial({ map: phong.map, normalMap: phong.normalMap, aoMap: phong.aoMap, roughnessMap: phong.roughnessMap, color: '#c9c0b4', metalness: 0 }));
  const leafMat = cutaway(windy(new THREE.MeshStandardMaterial({ map: a.leaves, color: tint, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 }),
    h * 0.006, `position.y / ${h.toFixed(2)}`));
  return { bark, leaves, barkMat, leafMat, h };
}

function trees(a: LandAssets) {
  const g = new THREE.Group();
  setTreeTextures({ bark: { color: a.surfaces.bark_brown_02.map, normal: a.surfaces.bark_brown_02.normalMap, arm: a.surfaces.bark_brown_02.arm }, leaves: a.leaves });
  const kinds: Record<Kind, { grown: Grown[]; tall: [number, number] }> = {
    [Kind.Oak]: { grown: [grow(a, 'Oak Medium', 11, '#9fae7a'), grow(a, 'Oak Large', 23, '#94a672', (j) => { j.leaves.count = 8; })], tall: [13, 17] },
    [Kind.Ash]: { grown: [grow(a, 'Ash Medium', 5, '#a8b47e'), grow(a, 'Ash Medium', 41, '#9caf74')], tall: [14, 18] },
    [Kind.Apple]: {
      grown: [grow(a, 'Oak Small', 3, '#a9b97a', (j) => { j.branch.length[0] *= 0.55; j.leaves.size *= 1.4; }), grow(a, 'Oak Small', 17, '#b1bc80', (j) => { j.branch.length[0] *= 0.5; j.leaves.size *= 1.4; })],
      tall: [4.2, 5.4],
    },
  };
  const at = new Map<Grown, THREE.Matrix4[]>();
  const put = (kind: Kind, x: number, z: number, size: number) => {
    const k = kinds[kind], gr = k.grown[Math.floor(rnd() * k.grown.length)];
    const s = (between(k.tall[0], k.tall[1]) * Math.min(1.25, size)) / gr.h;
    if (!at.has(gr)) at.set(gr, []);
    at.get(gr)!.push(placed(x, z, rnd() * Math.PI * 2, s, landHeight(x, z) - 0.2));
  };
  seed = 4242;
  for (const t of TREES) put(t.kind, t.x, t.z, t.size);
  // and beyond the map: woods to the north, trees along hedges out to the haze
  for (let i = 0; i < 160; i++) {
    const x = between(-EXTENT.w / 2, EXTENT.w / 2), z = between(-EXTENT.d / 2, EXTENT.d / 2);
    const out = Math.abs(x) > MAP.w / 2 + 4 || Math.abs(z) > MAP.d / 2 + 4;
    if (out && (z < -MAP.d / 2 || rnd() < 0.5)) put(rnd() < 0.5 ? Kind.Oak : Kind.Ash, x, z, 1);
  }
  for (const [gr, m] of at) {
    for (const [geo, mat] of [[gr.bark, gr.barkMat], [gr.leaves, gr.leafMat]] as const) {
      const inst = new THREE.InstancedMesh(geo, mat, m.length);
      m.forEach((q, i) => inst.setMatrixAt(i, q));
      inst.castShadow = inst.receiveShadow = true;
      if (mat === gr.leafMat) leafShadow(inst, a.leaves, 0.42);
      inst.computeBoundingSphere();
      g.add(inst);
    }
  }
  return g;
}

// --- hedgerows, walls, wire ----------------------------------------------------------------------------------------------
// A hedge: twigs of leaves packed thick over the bank, darker inside, lit as one mass
function hedges(a: LandAssets) {
  const g = new THREE.Group();
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [], norms: THREE.Vector3[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  seed = 31;
  for (const [ax, az, bx, bz] of HEDGE_SEGS) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const n = Math.floor(len * 60);
    for (let i = 0; i < n; i++) {
      const u = rnd() * len, across = between(-1, 1), up = Math.sqrt(rnd());
      const w = 1.15 * Math.sqrt(1 - up * up * 0.6); // (narrower toward the top)
      const x = ax + ux * u - uz * across * w, z = az + uz * u + ux * across * w;
      const y = landHeight(ax + ux * u, az + uz * u) - 0.3 + up * between(2.5, 3.3);
      e.set(between(-0.6, 0.6), rnd() * Math.PI * 2, between(-0.5, 0.5));
      const s = between(0.6, 0.95);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - s * 0.5, z), q.setFromEuler(e), new THREE.Vector3(s, s, s)));
      const shade = 0.45 + 0.55 * (Math.abs(across) * 0.6 + up * 0.4);
      cols.push(new THREE.Color().setRGB(0.62 * shade * between(0.85, 1.1), 0.7 * shade, 0.5 * shade * between(0.8, 1.1)));
      norms.push(new THREE.Vector3(-uz * across, up * 0.9 + 0.1, ux * across).normalize());
    }
  }
  const mat = cutaway(windy(new THREE.MeshStandardMaterial({ map: a.leaves, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 }), 0.05, 'uv.y'));
  // (each card lit by its place in the hedge, not its own tilt: the normal comes from the instance)
  mat.onBeforeCompile = ((before) => (shader: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    before(shader, r);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'attribute vec3 hedgeNormal;\nvoid main() {')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tobjectNormal = hedgeNormal;')
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * objectNormal;\n#ifdef FLIP_SIDED\n\ttransformedNormal = - transformedNormal;\n#endif');
  })(mat.onBeforeCompile);
  const geo = card.clone();
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  const hn = new Float32Array(mats.length * 3);
  mats.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[i]); hn.set([norms[i].x, norms[i].y, norms[i].z], i * 3); });
  geo.setAttribute('hedgeNormal', new THREE.InstancedBufferAttribute(hn, 3));
  inst.castShadow = inst.receiveShadow = true;
  leafShadow(inst, a.leaves, 0.42);
  inst.computeBoundingSphere();
  g.add(inst);
  // shrubs and nettles at the feet of the banks
  seed = 57;
  const kinds: Record<string, [THREE.Object3D, number, number]> = { // (the piece, and how much to scale it: some of the sets are small)
    a: [part(a.props.shrub_02, /_a$/), 0.6, 0.9], b: [part(a.props.shrub_02, /_b$/), 0.6, 0.9], c: [part(a.props.shrub_02, /_c$/), 0.5, 0.8],
    small: [part(a.props.shrub_04, /./), 2.5, 3.5], nettles: [part(a.props.nettle_plant, /tall_a/), 4, 6], nettles2: [part(a.props.nettle_plant, /tall_b|medium_a/), 4, 6],
  };
  const names = Object.keys(kinds);
  const shrubs: Record<string, THREE.Matrix4[]> = Object.fromEntries(names.map((k) => [k, []]));
  for (const [ax, az, bx, bz] of HEDGE_SEGS) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let u = between(0, 5); u < len; u += between(3, 8)) {
      const side = rnd() < 0.5 ? -1 : 1, off = side * between(1.3, 1.9);
      const x = ax + ux * u - uz * off, z = az + uz * u + ux * off;
      const k = names[Math.floor(rnd() * names.length)];
      shrubs[k].push(placed(x, z, rnd() * 6.3, between(kinds[k][1], kinds[k][2])));
    }
  }
  // and the undergrowth in the woods
  for (let i = 0; i < 260; i++) {
    const x = between(-EXTENT.w / 2, EXTENT.w / 2), z = between(-MAP.d / 2 - 30, -58);
    if (Math.hypot(x - 30, z + 61) < 6 || Math.abs(x - 8) < 3) continue;
    const k = names[Math.floor(rnd() * names.length)];
    shrubs[k].push(placed(x, z, rnd() * 6.3, between(kinds[k][1], kinds[k][2]) * 1.3));
  }
  for (const [k, at] of Object.entries(shrubs)) g.add(instances(kinds[k][0], at, true, (m) => cutaway(windy(m.clone(), 0.04, 'position.y'))));
  return g;
}

// A dry-stone wall: rough blocks of stacked stone, their tops uneven, following the ground
function walls(a: LandAssets) {
  const parts: THREE.BufferGeometry[] = [];
  seed = 8;
  for (const r of RUNS) {
    if (r.kind !== Line.Wall) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.1)), rot = Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        const h = between(0.95, 1.15), y = landHeight(x, z) - 0.25;
        const b = block(len / n + 0.04, h + 0.25, between(0.62, 0.72), 2);
        b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -rot + between(-0.02, 0.02)), new THREE.Vector3(1, 1, 1)));
        parts.push(b);
        // capstones along the top
        const cap = block(len / n + 0.06, 0.16, 0.5, 2);
        cap.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y + h + 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(between(-0.06, 0.06), -rot, between(-0.05, 0.05))), new THREE.Vector3(1, 1, 1)));
        parts.push(cap);
      }
    }
  }
  const m = new THREE.Mesh(mergeGeometries(parts), surface(a, 'stacked_stone_wall'));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Barbed wire: stakes, strands sagging between them, and a coil along the bottom
function wire(a: LandAssets) {
  const g = new THREE.Group();
  const stakes: THREE.BufferGeometry[] = [], pts: number[] = [];
  seed = 13;
  for (const r of RUNS) {
    if (r.kind !== Line.Wire) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3));
      const top: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = landHeight(x, z);
        const s = block(0.08, 1.35, 0.08, 1);
        s.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.15, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(between(-0.12, 0.12), 0, between(-0.12, 0.12))), new THREE.Vector3(1, 1, 1)));
        stakes.push(s);
        top.push(new THREE.Vector3(x, y, z));
      }
      for (let k = 0; k < n; k++) for (const hgt of [0.3, 0.62, 0.95, 1.15]) for (let j = 0; j < 6; j++) {
        const p = top[k].clone().lerp(top[k + 1], j / 6), q = top[k].clone().lerp(top[k + 1], (j + 1) / 6);
        const sag = (t: number) => -0.08 * Math.sin(Math.PI * t);
        pts.push(p.x, p.y + hgt + sag(j / 6), p.z, q.x, q.y + hgt + sag((j + 1) / 6), q.z);
      }
      // the coil
      const ux = (bx - ax) / len, uz = (bz - az) / len, turns = len / 0.3;
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= turns * 10; k++) {
        const t = k / 10, u = t * 0.3, ang = t * Math.PI * 2;
        const x = ax + ux * u - uz * Math.cos(ang) * 0.45, z = az + uz * u + ux * Math.cos(ang) * 0.45;
        const p = new THREE.Vector3(x, landHeight(ax + ux * u, az + uz * u) + 0.45 + Math.sin(ang) * 0.42, z);
        if (prev) pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
  }
  if (!stakes.length) return g;
  const m = new THREE.Mesh(mergeGeometries(stakes), surface(a, 'weathered_planks', { color: '#6d5f4f' }));
  m.castShadow = true;
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#34302b' }));
  g.add(m, lines);
  return g;
}

// --- grass and wheat ---------------------------------------------------------------------------------------------
function grass(a: LandAssets, splat: ReturnType<typeof paintSplat>) {
  const g = new THREE.Group();
  // clumps: two cards crossed (wheat: three), one of four clumps each
  const clump = (cards: number, cell: number) => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < cards * 2; i++) {
      const p = new THREE.PlaneGeometry(1, 1);
      p.translate(0, 0.5, 0.05);
      p.rotateX(cards === 2 ? 0.75 : 0.3); // (leaning out: grass splays, wheat stands)
      p.rotateY((i * Math.PI * 2) / (cards * 2) + 0.3);
      const uv = p.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (cell + uv.getX(k)) / 4);
      const n = p.attributes.normal;
      for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0); // (lit like the ground they grow from)
      parts.push(p);
    }
    return mergeGeometries(parts);
  };
  const solid = (x: number, z: number) => {
    for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3) return true;
    for (const s of HEDGE_SEGS) if (segDist(x, z, s) < 1.0) return true;
    return false;
  };
  seed = 5;
  for (const [tex, cards, size, perM2, where] of [
    [a.grass, 2, [0.8, 0.6], 3, (x: number, z: number) => 1 - splatAt(splat.aData, x, z, 0) * 1.4 - splatAt(splat.aData, x, z, 1) - Math.max(0, splatAt(splat.aData, x, z, 2) - 0.5) * 2 - splatAt(splat.bData, x, z, 1) * 1.5 - splatAt(splat.bData, x, z, 0) * 0.6],
    [a.wheat, 3, [0.75, 0.95], 3.2, (x: number, z: number) => FIELDS.some((f) => f.kind === Ground.Wheat && Math.abs(x - f.x) < f.w / 2 - 0.5 && Math.abs(z - f.z) < f.d / 2 - 0.5) ? 1 - splatAt(splat.bData, x, z, 1) * 2 : 0],
  ] as const) {
    const mat = cutaway(windy(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 }), 0.09, 'uv.y'));
    mat.color.setRGB(tex === a.grass ? 1.35 : 1.3, tex === a.grass ? 1.5 : 1.3, tex === a.grass ? 0.9 : 1.2); // (the photographed blades are dark)
    const at: THREE.Matrix4[][] = [[], [], [], []];
    const span = { w: MAP.w + 30, d: MAP.d + 30 }, n = Math.floor(span.w * span.d * perM2);
    for (let i = 0; i < n; i++) {
      const x = between(-span.w / 2, span.w / 2), z = between(-span.d / 2, span.d / 2);
      if (rnd() > where(x, z) || solid(x, z)) continue;
      const s = between(0.8, 1.3);
      at[Math.floor(rnd() * 4)].push(placed(x, z, rnd() * 6.3, new THREE.Vector3(size[0] * s, size[1] * s * between(0.85, 1.2), size[0] * s), landHeight(x, z) - 0.04));
    }
    at.forEach((m, cell) => {
      if (!m.length) return;
      const inst = new THREE.InstancedMesh(clump(cards, cell), mat, m.length);
      m.forEach((q, i) => inst.setMatrixAt(i, q));
      inst.receiveShadow = true;
      inst.castShadow = tex === a.wheat;
      leafShadow(inst, tex, 0.4);
      inst.computeBoundingSphere();
      g.add(inst);
    });
  }
  return g;
}

// --- buildings -------------------------------------------------------------------------------------------------------
// A box with its uvs in metres over `tile`, standing on y = 0
function block(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
  }
  return g.toNonIndexed();
}

// The end of a gabled roof's wall: a triangle `w` across, `h` high, `t` thick, facing +z
function gable(w: number, h: number, t: number, tile: number) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return g;
}

class Parts {
  readonly by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0) {
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(1, 1, 1)));
    if (!this.by.has(mat)) this.by.set(mat, []);
    this.by.get(mat)!.push(g);
  }
  build(shadows = true) {
    const g = new THREE.Group();
    for (const [mat, list] of this.by) {
      const m = new THREE.Mesh(mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q)).map((q) => { if (q.attributes.uv1) q.deleteAttribute('uv1'); return q; })), mat);
      m.castShadow = shadows; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
}

interface BuildingMats { plaster: THREE.Material; stone: THREE.Material; tiles: THREE.Material; planks: THREE.Material; shutters: THREE.Material; frames: THREE.Material; glass: THREE.Material; char: THREE.Material; rubble: THREE.Material }

function buildingMats(a: LandAssets): BuildingMats {
  const plaster = surface(a, 'plastered_stone_wall');
  plaster.color.setRGB(2.5, 2.3, 2.0); // (the photograph is a dark render: limewash is pale cream)
  return {
    plaster: cutaway(plaster),
    stone: cutaway(surface(a, 'rustic_stone_wall')),
    tiles: cutaway(surface(a, 'clay_roof_tiles_02', { color: '#b8a59a' })),
    planks: cutaway(surface(a, 'weathered_planks')),
    shutters: cutaway(surface(a, 'weathered_planks', { color: '#7f938c' })),
    frames: cutaway(surface(a, 'weathered_planks', { color: '#d8d0bf' })),
    glass: cutaway(new THREE.MeshStandardMaterial({ color: '#46525a', roughness: 0.18, metalness: 0.6 })),
    char: cutaway(surface(a, 'weathered_planks', { color: '#2c2621' })),
    rubble: cutaway(surface(a, 'rustic_stone_wall', { color: '#a59f95' })),
  };
}

// A window on a wall facing +z at (x, y) of it: frame, dark glass, shutters folded back, a stone lintel
function window(p: Parts, m: BuildingMats, x: number, y: number, z: number, rot: number, w = 0.95, h = 1.25, shut = false) {
  const put = (mat: THREE.Material, g: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    p.add(mat, g, x + lx * c + lz * s, y + ly, z - lx * s + lz * c, rot);
  };
  put(m.frames, block(w + 0.14, h + 0.14, 0.1, 1), 0, -0.07, 0.03);
  put(shut ? m.shutters : m.glass, block(w, h, 0.12, 1), 0, 0, 0.05);
  if (!shut) for (const side of [-1, 1]) put(m.shutters, block(w / 2, h, 0.05, 1), side * (w * 0.75 + 0.08), 0, 0.1);
  put(m.stone, block(w + 0.4, 0.2, 0.16, 1.5), 0, h + 0.05, 0.05);
  put(m.stone, block(w + 0.25, 0.08, 0.2, 1.5), 0, -0.1, 0.07);
}

function house(b: Building, m: BuildingMats, a: LandAssets) {
  const p = new Parts();
  seed = Math.abs(Math.round(b.x * 31 + b.z * 17)) + 1;
  const storey = b.style === Style.Barn ? 4.2 : b.style === Style.Shed ? 2.5 : 2.8;
  const H = b.storeys * storey + 0.3;
  const wall = b.style === Style.Farmhouse ? m.plaster : b.style === Style.Shed ? m.planks : m.stone;
  const along = b.w >= b.d; // the ridge runs along the longer side
  const span = along ? b.d : b.w, length = along ? b.w : b.d;
  const pitch = b.style === Style.Shed ? 0.5 : b.style === Style.Barn ? 0.72 : 0.82;
  const rise = (span / 2) * Math.tan(pitch);
  const base = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => landHeight(b.x + (i * b.w) / 2, b.z + (j * b.d) / 2))) - 0.4;
  void a;
  if (!b.ruined) {
    p.add(wall, block(b.w, H + 0.4, b.d, b.style === Style.Shed ? 2 : 3));
    // a stone plinth, and stone quoins at the corners of a plastered house
    if (b.style !== Style.Shed) p.add(m.stone, block(b.w + 0.1, 0.9, b.d + 0.1, 2.4));
    if (b.style === Style.Farmhouse) for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.add(m.stone, block(0.6, H + 0.4, 0.6, 2.4), (i * (b.w - 0.5)) / 2, 0, (j * (b.d - 0.5)) / 2);
    // the gable ends, the roof's two slopes, the ridge, a chimney
    const gx = along ? b.w / 2 : b.d / 2;
    for (const side of [-1, 1]) {
      p.add(wall, gable(span, rise, 0.4, b.style === Style.Shed ? 2 : 3), along ? side * (gx - 0.2) : 0, H + 0.4, along ? 0 : side * (gx - 0.2), along ? Math.PI / 2 : 0);
      const slope = block(length + 0.7, 0.16, span / 2 / Math.cos(pitch) + 0.45, TILE.clay_roof_tiles_02!);
      slope.translate(0, 0, -(span / 2 / Math.cos(pitch) + 0.45) / 2);
      if (along) p.add(m.tiles, slope, 0, H + 0.4 + rise + 0.08, 0, side > 0 ? 0 : Math.PI, -pitch);
      else p.add(m.tiles, slope, 0, H + 0.4 + rise + 0.08, 0, side > 0 ? Math.PI / 2 : -Math.PI / 2, -pitch);
    }
    p.add(m.tiles, block(along ? length + 0.7 : 0.3, 0.22, along ? 0.3 : length + 0.7, 1), 0, H + 0.4 + rise, 0);
    if (b.style !== Style.Shed && b.style !== Style.Barn) p.add(m.stone, block(0.8, rise + 1.4, 0.7, 2.4), along ? b.w * 0.32 : 0, H + 0.4, along ? 0 : b.d * 0.32);
    // the south (+z, toward the camera) and north faces: windows, a door; the ends: a window or two
    const faceZ = b.d / 2;
    if (b.style === Style.Barn) {
      p.add(m.planks, block(3.2, 3.2, 0.14, 2), 0, 0.9, faceZ + 0.02);
      p.add(m.stone, block(3.6, 0.35, 0.3, 2.4), 0, 4.1, faceZ);
      for (const x of [-b.w / 2 + 2, b.w / 2 - 2]) window(p, m, x, 2.4, faceZ, 0, 0.5, 0.8, true);
    } else {
      const n = Math.max(1, Math.floor(b.w / 2.6));
      for (let f = 0; f < b.storeys; f++) for (let i = 0; i < n; i++) {
        const x = -b.w / 2 + (b.w / n) * (i + 0.5);
        const door = f === 0 && i === Math.floor(n / 2);
        if (door) {
          p.add(m.planks, block(1.0, 2.1, 0.12, 2), x, 0.9, faceZ + 0.02);
          p.add(m.stone, block(1.4, 0.25, 0.2, 2.4), x, 3.0, faceZ + 0.02);
        } else window(p, m, x, 0.9 + 0.9 + f * storey, faceZ, 0, 0.9, b.style === Style.Shed ? 0.7 : 1.2, rnd() < 0.25);
        if (f === b.storeys - 1 && rnd() < 0.7) window(p, m, x, 0.9 + 0.9 + f * storey, -faceZ, Math.PI, 0.9, 1.2, true);
      }
      for (const side of [-1, 1]) if (b.d > 5) window(p, m, side * (b.w / 2), 0.9 + 0.9 + (b.storeys - 1) * storey, 0, side * Math.PI / 2, 0.8, 1.1, rnd() < 0.5);
    }
  } else {
    // a ruin: walls broken down to jagged stumps, a breach in the front, charred beams fallen in, rubble
    const T = 0.5;
    const runs: [number, number, number, number][] = [[-b.w / 2, b.d / 2 - T / 2, b.w, 0], [-b.w / 2, -b.d / 2 + T / 2, b.w, 0], [-b.w / 2 + T / 2, -b.d / 2, b.d, 1], [b.w / 2 - T / 2, -b.d / 2, b.d, 1]];
    runs.forEach(([x0, z0, len, dir], k) => {
      const n = Math.ceil(len / 0.55);
      let hgt = between(1.5, H);
      for (let i = 0; i < n; i++) {
        hgt = Math.max(0.3, Math.min(H + 0.4, hgt + between(-0.7, 0.7)));
        if (k === 0 && i > n * 0.35 && i < n * 0.65) hgt = Math.min(hgt, between(0.2, 0.6)); // (the breach)
        const u = (i + 0.5) * (len / n);
        p.add(m.stone, block(len / n + 0.02, hgt + 0.4, T, 2.4), dir ? x0 : x0 + u, 0, dir ? z0 + u : z0, dir ? Math.PI / 2 : 0);
      }
      if (k === 0) for (const x of [-b.w / 4, b.w / 4]) window(p, m, x, 1.8, b.d / 2, 0, 0.85, 1.1, true);
    });
    p.add(m.rubble, block(b.w - 1, 0.6, b.d - 1, 2), 0, 0.2, 0);
    for (let i = 0; i < 5; i++) p.add(m.char, block(0.18, 0.18, span * between(0.7, 1.1), 1.5), between(-b.w / 3, b.w / 3), between(0.8, 2.2), between(-b.d / 4, b.d / 4), between(-0.5, 0.5), between(-0.5, 0.5), between(-0.3, 0.3));
    for (let i = 0; i < 14; i++) p.add(m.rubble, block(between(0.3, 0.8), between(0.2, 0.5), between(0.3, 0.8), 1.5), between(-b.w / 2 - 1, b.w / 2 + 1), 0.4, b.d / 2 + between(0.2, 2.2), rnd() * 3, between(-0.3, 0.3), between(-0.3, 0.3));
  }
  const g = p.build();
  g.position.set(b.x, base, b.z);
  g.rotation.y = -(b.rot ?? 0);
  return g;
}

// --- things ---------------------------------------------------------------------------------------------------------
function sandbags() {
  const g = new THREE.Group();
  const bag = new THREE.SphereGeometry(0.5, 14, 10);
  bag.scale(0.58, 0.3, 0.38);
  const mats = ['#6e6146', '#635843', '#76694c'].map((c) => cutaway(new THREE.MeshStandardMaterial({ color: c, roughness: 1 })));
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - (row === 3 ? 1 : 0); i++) {
    const m = new THREE.Mesh(bag, mats[Math.floor(rnd() * 3)]);
    m.position.set(-1.45 + i * 0.55 + (row % 2) * 0.27, 0.13 + row * 0.25, between(-0.04, 0.04) - row * 0.04);
    m.rotation.set(between(-0.05, 0.05), between(-0.15, 0.15), between(-0.06, 0.06));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function haystack(a: LandAssets) {
  const prof = [[0, 0], [1.15, 0], [1.2, 0.5], [1.12, 1.2], [0.85, 1.8], [0.45, 2.25], [0, 2.4]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.06 * Math.sin(x * 7 + y * 5) * Math.cos(z * 6 - y * 4);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, cutaway(new THREE.MeshStandardMaterial({ color: '#b59c60', roughness: 1, normalMap: a.surfaces.sparse_grass.normalMap, normalScale: new THREE.Vector2(1.5, 1.5) })));
  m.castShadow = m.receiveShadow = true;
  return m;
}

function cart(m: BuildingMats) {
  const p = new Parts();
  const iron = cutaway(new THREE.MeshStandardMaterial({ color: '#2d2b29', roughness: 0.6, metalness: 0.6 }));
  p.add(m.planks, block(2.6, 0.1, 1.4, 2), 0, 0.82, 0);
  for (const s of [-1, 1]) {
    p.add(m.planks, block(2.6, 0.42, 0.06, 2), 0, 0.9, s * 0.68);
    p.add(m.planks, block(0.06, 0.42, 1.4, 2), s * 1.28, 0.9, 0);
    // the wheels: an iron tyre, a hub, spokes
    const tyre = new THREE.TorusGeometry(0.6, 0.045, 6, 24);
    p.add(iron, tyre, 0.2, 0.62, s * 0.86);
    p.add(m.planks, new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10), 0.2, 0.62, s * 0.86, 0, Math.PI / 2);
    for (let k = 0; k < 6; k++) p.add(m.planks, block(0.05, 0.58, 0.05, 1), 0.2, 0.62, s * 0.86, 0, 0, (k * Math.PI) / 6 + 0.0001);
    // the shafts
    p.add(m.planks, block(2.2, 0.08, 0.08, 2), 2.2, 0.5, s * 0.5, 0, 0, -0.25);
  }
  p.add(iron, block(0.06, 0.06, 1.9, 1), 0.2, 0.6, 0);
  return p.build();
}

function cross(m: BuildingMats) {
  const p = new Parts();
  [1.7, 1.25, 0.85].forEach((w, i) => p.add(m.stone, block(w, 0.32, w, 2), 0, i * 0.32, 0));
  p.add(m.stone, block(0.26, 3.4, 0.26, 2), 0, 0.96, 0);
  p.add(m.stone, block(1.3, 0.24, 0.24, 2), 0, 3.4, 0);
  return p.build();
}

// The anti-aircraft gun: a twin-barrelled 23 mm cannon (in the manner of a ZU-23-2) on its two-wheeled
// carriage, its wheels up and its legs out, the barrels raised, its gunners' seats and ammunition boxes
function aaGun() {
  const p = new Parts();
  const paint = cutaway(new THREE.MeshStandardMaterial({ color: '#59603f', roughness: 0.6, metalness: 0.35 }));
  const dark = cutaway(new THREE.MeshStandardMaterial({ color: '#252622', roughness: 0.5, metalness: 0.55 }));
  const tyre = cutaway(new THREE.MeshStandardMaterial({ color: '#1d1c1b', roughness: 0.9 }));
  // the carriage on its three legs
  p.add(paint, block(1.9, 0.18, 1.3, 1), 0, 0.35, 0);
  for (const [x, z, r] of [[0, 1.4, 0], [-1.2, -0.8, 1.05], [1.2, -0.8, -1.05]] as const) p.add(paint, block(0.12, 0.1, 1.6, 1), x * 0.5, 0.3, z * 0.5, r);
  for (const s of [-1, 1]) p.add(tyre, new THREE.CylinderGeometry(0.42, 0.42, 0.2, 18), s * 1.05, 0.6, 0.1, 0, 0, Math.PI / 2); // (wheels raised off the ground)
  // the mount, turned toward the south-east sky, and its two barrels
  p.add(paint, new THREE.CylinderGeometry(0.55, 0.62, 0.35, 14), 0, 0.6, 0);
  p.add(paint, block(0.9, 0.55, 1.1, 1), 0, 0.78, 0);
  for (const s of [-1, 1]) {
    p.add(dark, new THREE.CylinderGeometry(0.045, 0.05, 2.8, 10), s * 0.17, 1.8, 1.15, 0, 0.96); // (raised 35 degrees)
    p.add(paint, block(0.18, 0.2, 0.9, 1), s * 0.17, 1.2, 0.25, 0, -0.62);
    p.add(dark, block(0.2, 0.24, 0.35, 1), s * 0.55, 1.05, -0.1); // the ammunition boxes
    p.add(paint, block(0.38, 0.06, 0.35, 1), s * 0.62, 0.95, -0.75); // the seats
  }
  const g = p.build();
  g.userData.gun = true;
  return g;
}

function thing(kind: Prop, a: LandAssets, m: BuildingMats): THREE.Object3D {
  const prop = (name: PropModel, x = 0, z = 0, rot = 0, s = 1, only = /./) => {
    const o = part(a.props[name], only);
    o.position.set(x, 0, z); o.rotation.y = rot; o.scale.setScalar(s);
    o.traverse((q) => { const mesh = q as THREE.Mesh; if (mesh.isMesh) mesh.material = cutaway((mesh.material as THREE.Material).clone()); });
    return o;
  };
  const g = new THREE.Group();
  switch (kind) {
    case Prop.Sandbags: return sandbags();
    case Prop.Hay: return haystack(a);
    case Prop.Cart: return cart(m);
    case Prop.Cross: return cross(m);
    case Prop.Gun: return aaGun();
    case Prop.Crates: g.add(prop('wooden_military_crate', -0.3, 0, 0.1), prop('wooden_crate_02', 0.55, 0.3, 0.6), prop('ammo_box', 0.1, -0.55, 1.4)); return g;
    case Prop.Barrels: g.add(prop('wooden_barrels_01', -0.35, 0, 0, 1, /barrel01/), prop('wooden_barrels_01', 0.45, -0.3, 1, 1, /barrel02/), prop('metal_jerrycan_green', 0.4, 0.55, 2.1), prop('metal_jerrycan_green', 0.8, 0.35, 1.7)); return g;
    case Prop.Logs: {
      const o = prop('dead_tree_trunk');
      const s = sizeOf(o);
      o.scale.setScalar(3.2 / Math.max(s.x, s.z));
      g.add(o);
      return g;
    }
    case Prop.Rocks: g.add(prop('rock_moss_set_01', 0, 0, 0, 0.75, /rock04/), prop('rock_moss_set_01', 0.9, 0.5, 2, 0.4, /rock03/)); return g;
    case Prop.Stump: return prop('tree_stump_01');
  }
}

// --- all of it --------------------------------------------------------------------------------------------------------------
export interface Land { group: THREE.Group; gun: THREE.Object3D | null; smoke: THREE.Vector3[]; update(t: number): void; night(dark: number): void }

export function buildLand(a: LandAssets): Land {
  const group = new THREE.Group();
  const splat = paintSplat();
  group.add(ground(a, splat), hedges(a), walls(a), wire(a), grass(a, splat), trees(a));
  const mats = buildingMats(a);
  const smoke: THREE.Vector3[] = [];
  for (const b of BUILDINGS) {
    group.add(house(b, mats, a));
    if (b.ruined) smoke.push(new THREE.Vector3(b.x, landHeight(b.x, b.z) + 1.5, b.z));
  }
  let gun: THREE.Object3D | null = null;
  seed = 3;
  for (const t of THINGS) {
    const o = thing(t.kind, a, mats);
    o.position.set(t.x, landHeight(t.x, t.z) - 0.03, t.z);
    o.rotation.y = -(t.rot ?? 0);
    o.traverse((q) => { const mesh = q as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = mesh.receiveShadow = true; } });
    if (o.userData.gun) gun = o;
    group.add(o);
  }
  // at night, lamplight in the windows that aren't shuttered
  const lamp = new THREE.Color('#ffb25c');
  const night = (dark: number) => {
    const g = mats.glass as THREE.MeshStandardMaterial;
    g.emissive.copy(lamp);
    g.emissiveIntensity = Math.max(0, dark - 0.4) * 2.2;
  };
  return { group, gun, smoke, update: (t) => { wind.value = t; }, night };
}
