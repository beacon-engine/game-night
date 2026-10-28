// What each car is like (cars.json), turned into the physics' numbers: its weight, engine, springs
// and grip, with its size and where its wheels are taken from the model (Kenney's Car Kit, shared with
// Stock Cars).
import * as THREE from 'three';
import type { CarModel, CarType } from '@racing/cars.ts';
import type { Chassis } from './physics.ts';

// cars.json: compared with the Saloon, as in Stock Cars, plus `ride`: how soft and long its springs
// are (soft soaks up landings and rough ground; stiff bottoms out but sits flatter in the turns)
export interface RallyCar extends CarType { ride: number }

// The model's size and wheels, in the physics' terms: x forward, z right, from the body's middle
export interface Shape {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  wheels: Chassis['wheels'];
  offset: { x: number; z: number }; // the body's middle, from the model's origin (for drawing it)
}

export const WHEEL = /^wheel-(front|back)-(left|right)$/;

export function shapeOf(m: CarModel): Shape {
  const s = m.scale;
  m.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.scene), mid = box.getCenter(new THREE.Vector3());
  // (the model faces +z; drawn, it's turned to face +x: model (x, z) is (z, -x) in the car's terms)
  const wheels: Chassis['wheels'] = [];
  let radius = 0.33;
  m.scene.traverse((o) => {
    if (!WHEEL.test(o.name)) return; // (not the SUV's spare on the back)
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    radius = (b.max.y - b.min.y) * s * 0.5;
    wheels.push({ x: (c.z - mid.z) * s, z: -(c.x - mid.x) * s, front: /front/.test(o.name) || c.z > mid.z, name: o.name });
  });
  // The kit's cars are toys, their wheels tucked well in under tall bodies: on those they'd tip over
  // in an ordinary bend. The physics puts the tyres out near the body's edges (they're still drawn
  // where the model has them), so a car rolls from a bad landing or a hard hit, not from cornering.
  for (const w of wheels) w.z = Math.sign(w.z) * Math.max(Math.abs(w.z), m.width * 0.4);
  return { length: m.type.length, width: m.width, height: m.height, wheelRadius: radius, wheels, offset: { x: mid.z * s, z: -mid.x * s } };
}

export function chassisOf(t: RallyCar, shape: Shape): Chassis {
  const mass = 1250 * t.weight;
  const power = 165 * mass * t.accel, top = 52 * t.top; // W, m/s
  const freq = 1.7 / Math.sqrt(t.ride), spring = (mass / 4) * (2 * Math.PI * freq) ** 2;
  return {
    mass,
    length: shape.length,
    width: shape.width,
    height: shape.height,
    cmHeight: Math.min(0.7, Math.max(0.42, 0.24 * shape.height + 0.1)), // (the tall ones a little higher: less stable)
    wheels: shape.wheels,
    wheelRadius: shape.wheelRadius,
    power,
    force: mass * 7.5 * t.accel,
    drag: power / top ** 3,
    grip: t.grip,
    travel: 0.26 * t.ride,
    spring,
    damper: 2 * 0.45 * Math.sqrt((spring * mass) / 4),
  };
}
