// The weather, drawn (weather.ts has the numbers): rain or snow falling round every camera, a sky
// that clouds over and closes in, and a road that darkens and shines as it gets wet.
import * as THREE from 'three';
import { Particles } from './particles.ts';
import type { Weather } from './weather.ts';

// All of it for one scene: the rain or snow, the sky, the road, and the spray the cars throw up
export class WeatherLook {
  private fall: Precipitation | null = null;
  private road: THREE.MeshStandardMaterial | null = null;
  private darken = ROAD_DARKENS;
  private drops = 5000;
  readonly spray = new Particles(1500, 0xd4dae2, 1.8, THREE.NormalBlending, 0.3);

  constructor(private scene: THREE.Scene) {
    scene.add(this.spray.points);
  }

  // The venue was rebuilt (or relit): this is its road or pitch (or none), and how much darker it
  // gets soaked (a road a lot; grass less)
  venue(road: THREE.MeshStandardMaterial | null, darken = ROAD_DARKENS) {
    clearSky(this.scene);
    this.road = road;
    this.darken = darken;
  }

  // The screen is struggling: fewer drops
  fewer() {
    this.drops = 2000;
    if (this.fall) this.make(this.fall.snow);
  }

  update(dt: number, w: Weather | null) {
    const rain = w?.rain ?? 0, wet = w?.wet ?? 0;
    if (w && (!this.fall || this.fall.snow !== w.snow)) this.make(w.snow);
    this.fall?.set(rain);
    this.fall?.update(dt);
    overcast(this.scene, w?.snow ? Math.max(0.5, rain) : Math.max(rain, wet * 0.5));
    if (this.road && !w?.snow) wetRoad(this.road, wet, this.darken);
    this.spray.update(dt, -2);
  }

  // Spray off a car's back wheels at `at`, going `v` m/s on a road this wet: more the faster and wetter
  splash(at: THREE.Vector3, v: number, wet: number) {
    if (wet > 0.15 && v > 12) this.spray.emit(at, Math.round(wet * Math.min(3, v / 20)), 2 + v * 0.04, 1.2, 0.5);
  }

  private make(snow: boolean) {
    if (this.fall) { this.scene.remove(this.fall.object); this.fall.dispose(); }
    this.fall = new Precipitation(snow, this.drops);
    this.scene.add(this.fall.object);
  }
}

// Rain as streaks, snow as soft flakes, in a box that wraps round whichever camera is drawing (so a
// split screen gets it round every view at once). The falling is done on the graphics card: nothing
// moves on the CPU, however much is coming down.
export class Precipitation {
  readonly object: THREE.LineSegments | THREE.Points;
  private uniforms = {
    time: { value: 0 },
    box: { value: new THREE.Vector3(70, 34, 70) },
    fall: { value: new THREE.Vector3(1.5, -11, 0.8) }, // m/s: down, and drifting with the wind
    len: { value: 0.8 }, // m: a streak's length
    size: { value: 0.09 }, // m: a flake's
    color: { value: new THREE.Color(0xdde4ee) },
    opacity: { value: 0.5 },
  };

  // `count`: drops at the heaviest (fewer on slower screens)
  constructor(readonly snow: boolean, private count = 5000) {
    const n = snow ? Math.round(count * 0.6) : count, per = snow ? 1 : 2;
    const pos = new Float32Array(n * per * 3), end = new Float32Array(n * per), box = this.uniforms.box.value;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * box.x, y = Math.random() * box.y, z = Math.random() * box.z;
      for (let k = 0; k < per; k++) { pos.set([x, y, z], (i * per + k) * 3); end[i * per + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('end', new THREE.BufferAttribute(end, 1));
    if (snow) {
      this.uniforms.fall.value.set(0.6, -1.4, 0.3);
      this.uniforms.color.value.set(0xf4f7fb);
      this.uniforms.opacity.value = 0.85;
    }
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: snow ? SNOW_VERTEX : RAIN_VERTEX,
      fragmentShader: snow ? SNOW_FRAGMENT : RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.object = snow ? new THREE.Points(g, material) : new THREE.LineSegments(g, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.set(0);
  }

  // How hard it's coming down: 0..1
  set(amount: number) {
    const per = this.snow ? 1 : 2, n = this.snow ? Math.round(this.count * 0.6) : this.count;
    this.object.geometry.setDrawRange(0, Math.round(n * Math.min(1, amount)) * per);
    this.object.visible = amount > 0.01;
  }

  update(dt: number) {
    this.uniforms.time.value = (this.uniforms.time.value + dt) % 10000;
  }

  dispose() {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

// (each drop's place moves with time and wraps round the camera; both ends of a streak share it)
const WRAP = /* glsl */ `
  uniform float time;
  uniform vec3 box;
  uniform vec3 fall;
  varying float vFade;
  vec3 drop() {
    vec3 p = position + fall * time;
    p = mod(p - cameraPosition + box * 0.5, box) + cameraPosition - box * 0.5;
    return p;
  }
  float fade(vec3 p) { // thin out toward the edges of the box, so it has no edge
    vec3 q = abs(p - cameraPosition) / (box * 0.5);
    return 1.0 - smoothstep(0.55, 1.0, max(q.x, max(q.y, q.z)));
  }
`;

const RAIN_VERTEX = /* glsl */ `
  attribute float end;
  uniform float len;
  ${WRAP}
  void main() {
    vec3 p = drop() + normalize(fall) * len * end;
    vFade = fade(p);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() { gl_FragColor = vec4(color, opacity * vFade); }
`;

const SNOW_VERTEX = /* glsl */ `
  uniform float size;
  ${WRAP}
  void main() {
    vec3 p = drop();
    p.x += sin(time * 0.9 + position.z * 1.7) * 0.6; // (flakes flutter as they fall)
    p.z += cos(time * 0.7 + position.x * 1.3) * 0.6;
    vFade = fade(p);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_PointSize = size * projectionMatrix[1][1] * 400.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(color, opacity * vFade * (1.0 - smoothstep(0.2, 0.5, r)));
  }
`;

// The sky clouds over as it rains: the sun and sky dim, the fog greys and closes in. `k`: 0 (as the
// venue was lit) .. 1 (heavy rain). Each light, the fog and the sky dome keep what they started as.
const CLOUD = new THREE.Color(0x8d949e);
export function overcast(scene: THREE.Scene, k: number) {
  const base = (scene.userData.clear ??= {
    fog: scene.fog instanceof THREE.Fog ? { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far } : null,
    env: scene.environmentIntensity,
  }) as { fog: { color: THREE.Color; near: number; far: number } | null; env: number };
  if (Math.abs((scene.userData.overcast ?? -1) - k) < 0.01) return;
  scene.userData.overcast = k;
  // (the cloud is as dark as the hour: grey by day, near black at night)
  const dusk = base.fog ? Math.min(1, base.fog.color.getHSL({ h: 0, s: 0, l: 0 }).l * 1.6) : 1;
  scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight || o instanceof THREE.AmbientLight) {
      o.userData.clear ??= o.intensity;
      o.intensity = o.userData.clear * (1 - (o instanceof THREE.DirectionalLight ? 0.75 : 0.6) * k);
    } else if (o instanceof THREE.Mesh && o.userData.sky) {
      (o.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1).lerp(CLOUD.clone().multiplyScalar(dusk), 0.8 * k);
    }
  });
  if (base.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.color.copy(base.fog.color).lerp(CLOUD.clone().multiplyScalar(dusk), 0.75 * k);
    scene.fog.near = base.fog.near * (1 - 0.7 * k);
    scene.fog.far = base.fog.far * (1 - 0.65 * k);
    if (scene.background instanceof THREE.Color) scene.background.copy(scene.fog.color);
  }
  scene.environmentIntensity = base.env * (1 - 0.3 * k);
}

// Forget what the venue was lit like (it's been rebuilt, or relit for another time of day: the next
// overcast() starts afresh from the lights as they are now)
export function clearSky(scene: THREE.Scene) {
  delete scene.userData.clear;
  delete scene.userData.overcast;
  scene.traverse((o) => { if (o instanceof THREE.Light) delete o.userData.clear; });
}

// A road darkens and shines as it gets wet (puddles reflect the sky). `wet`: 0..1
export const ROAD_DARKENS = 0.55;
export const GRASS_DARKENS = 0.25;
export function wetRoad(m: THREE.MeshStandardMaterial, wet: number, darken = ROAD_DARKENS) {
  m.userData.dry ??= { roughness: m.roughness, color: m.color.clone() };
  const dry = m.userData.dry as { roughness: number; color: THREE.Color };
  m.roughness = dry.roughness + (0.42 - dry.roughness) * wet;
  m.color.copy(dry.color).multiplyScalar(1 - darken * wet);
  m.envMapIntensity = 1 - 0.45 * wet; // (a dark sheen, not a mirror of the sky)
}
