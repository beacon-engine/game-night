// Seeing your men through the scenery: wherever a tree, a hedge or a building stands between the camera
// and a player, it dissolves in a soft-edged circle round him (its shadow stays), the way top-down war
// games do it. cutaway(material) adds this to a material; setCuts() moves the circles each frame.
import * as THREE from 'three';

export const MAX_CUTS = 4;
const CUT = { radius: 0.11, edge: 0.4, near: 1.8 }; // the circle (share of the screen's height, at 24 m); its soft edge (share of the radius); m in front of him it starts

// (x, y in drawing-buffer pixels as gl_FragCoord counts them; his distance from the camera, m; radius, px)
const cuts = { value: Array.from({ length: MAX_CUTS }, () => new THREE.Vector4(0, 0, -1, 0)) };

// The players this frame (where their chests are), and the drawing buffer's size
export function setCuts(camera: THREE.PerspectiveCamera, at: { x: number; y: number; z: number }[], w: number, h: number) {
  const v = new THREE.Vector3();
  for (let i = 0; i < MAX_CUTS; i++) {
    const c = cuts.value[i], p = at[i];
    if (!p) { c.set(0, 0, -1, 0); continue; }
    v.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -v.z;
    v.set(p.x, p.y, p.z).project(camera);
    c.set((v.x * 0.5 + 0.5) * w, (v.y * 0.5 + 0.5) * h, depth - CUT.near, CUT.radius * h * Math.sqrt(24 / Math.max(10, depth)));
  }
}

export function cutaway<T extends THREE.Material>(m: T): T {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.uniforms.uCuts = cuts;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vCutDepth;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvCutDepth = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `uniform vec4 uCuts[${MAX_CUTS}];
varying float vCutDepth;
float cutNoise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
	for (int i = 0; i < ${MAX_CUTS}; i++) {
		vec4 c = uCuts[i];
		if (c.w <= 0.0 || vCutDepth > c.z) continue;
		float d = length(gl_FragCoord.xy - c.xy) / c.w;
		if (cutNoise(floor(gl_FragCoord.xy)) > smoothstep(1.0 - ${CUT.edge.toFixed(2)}, 1.0, d)) discard;
	}`);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + '|cutaway';
  return m;
}
