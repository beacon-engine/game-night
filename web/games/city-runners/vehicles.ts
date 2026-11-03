// The traffic on the Streets route, drawn: real-looking cars from the car library (web/cars, via
// @racing/cars.ts) and the library's police car, van, lorry and bus (web/cars/vehicles, made by
// tools/cars/vehicles.py). Each kind comes in a few paint jobs; each paint job keeps a pool of
// copies (sharing their geometry and materials), placed afresh every frame from what's in view.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { carLights, carMesh, loadCars, type CarType } from '@racing/cars.ts';
import { VEHICLES, type Model } from './course.ts';

// The library cars, and the paint jobs everything comes in (ordinary cars: not too loud)
const LIBRARY: Partial<Record<Model, string>> = { sedan: 'cars/sedan', shc: 'cars/shc', thunderbolt: 'cars/thunderbolt', azura: 'cars/azura' };
const PAINTS: Record<Model, string[]> = {
  sedan: ['#c9ccd2', '#1c1f26', '#6e1f2a', '#2c3e66'],
  shc: ['#eef0f2', '#3a3f48', '#7c8a6e', '#8a5a34'],
  thunderbolt: ['#d94040', '#2f5bd8', '#e8e6df', '#232733'],
  azura: ['#f2d03b', '#0fa3a3', '#c9ccd2', '#5b2a86'],
  van: ['#e8e6df', '#2c3e66', '#b9ab8e', '#8a1f1f'],
  lorry: ['#e8e6df', '#3f8a5a', '#d9a13a'],
  bus: [''], // (as it comes)
  police: [''],
};

interface Kind { copies: THREE.Object3D[]; used: number; make: () => THREE.Object3D }

export class Vehicles {
  group = new THREE.Group();
  ready = false;
  private kinds = new Map<string, Kind>(); // by model and paint
  private lights = 0;

  async load(rich: boolean) {
    const types: CarType[] = Object.entries(LIBRARY).map(([id, model]) => ({ id, name: id, model, about: '', length: VEHICLES[id as Model].length, top: 1, accel: 1, grip: 1, weight: 1 }));
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/people/draco/'));
    const [cars, ...own] = await Promise.all([
      loadCars(types, rich),
      ...(['van', 'lorry', 'bus', 'police'] as Model[]).map((id) => loader.loadAsync(`/cars/vehicles/${id}.glb`).then((g) => [id, g.scene] as const)),
    ]);
    for (const [id, m] of cars) {
      PAINTS[id as Model].forEach((paint, i) => this.kinds.set(`${id}${i}`, { copies: [], used: 0, make: () => {
        // (carMesh faces the model along +x; the course runs along -z)
        const g = new THREE.Group(), car = carMesh(m, paint, 0);
        car.rotation.y = Math.PI / 2;
        carLights(car, this.lights);
        g.add(car);
        return g;
      } }));
    }
    for (const [id, scene] of own) {
      PAINTS[id].forEach((paint, i) => {
        // the body in this paint job (one material per kind and paint, shared by every copy)
        const painted = new Map<THREE.Material, THREE.Material>();
        this.kinds.set(`${id}${i}`, { copies: [], used: 0, make: () => {
          const g = scene.clone(true);
          g.traverse((o) => {
            if (!(o instanceof THREE.Mesh) || !paint) return;
            const m = o.material as THREE.MeshStandardMaterial;
            if (!/bodymat/i.test(m.name)) return;
            if (!painted.has(m)) { const p = m.clone(); p.color.set(paint); p.roughness = 0.4; painted.set(m, p); }
            o.material = painted.get(m)!;
          });
          return g;
        } });
      });
    }
    this.ready = true;
  }

  // Headlights and tail lights: on at night
  setLights(level: number) {
    if (level === this.lights) return;
    this.lights = level;
    for (const k of this.kinds.values()) for (const c of k.copies) carLights(c, level);
  }

  // Every frame: begin, place each vehicle in view, end (which hides the copies nobody used)
  begin() { for (const k of this.kinds.values()) k.used = 0; }

  // `look`: picks its paint job (the same every frame); rotY 0 faces down the course
  place(model: Model, look: number, x: number, y: number, z: number, rotY = 0) {
    if (!this.ready) return;
    const n = PAINTS[model].length, kind = this.kinds.get(`${model}${Math.floor(look * n) % n}`)!;
    let o = kind.copies[kind.used];
    if (!o) { o = kind.make(); kind.copies.push(o); this.group.add(o); }
    kind.used++;
    o.visible = true;
    o.position.set(x, y, z);
    o.rotation.set(0, rotY, 0);
    return o;
  }

  end() {
    for (const k of this.kinds.values()) for (let i = k.used; i < k.copies.length; i++) k.copies[i].visible = false;
  }
}
