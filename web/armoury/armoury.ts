// The armoury: guns for any game (built by tools/armoury/guns.py from a CC0 pack). Each comes at its
// real size with its grip (where the trigger hand holds it) at the origin, its barrel along +x and its
// top up, and says where the other hand goes (`support`, m along the barrel) and where the muzzle is.
//
//   const guns = await loadGuns();
//   const rifle = guns.make('rifle');          // a copy to put in someone's hands
//   holdBetween(rifle, rightHand, leftHand);   // each frame: grip in one hand, aimed through the other
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ARMOURY = '/armoury/';

export enum Gun {
  Rifle = 'rifle', // bolt action
  Assault = 'assault', // automatic
  Sniper = 'sniper', // scoped bolt action
  Shotgun = 'shotgun',
  Pistol = 'pistol',
  MachinePistol = 'machine-pistol',
  Carbine = 'carbine', // a modern automatic carbine (M4-like)
  Ak = 'ak',
  Knife = 'knife',
  Launcher = 'launcher', // RPG
}

export interface GunModel { object: THREE.Object3D; support: number; muzzle: number; length: number }

export interface Guns { make(gun: Gun): GunModel }

export async function loadGuns(): Promise<Guns> {
  const g = await new GLTFLoader().loadAsync(`${ARMOURY}models/guns.glb`);
  // (each gun is a node of the scene: one mesh, or a group of them when it has more than one finish)
  const src = new Map<string, THREE.Object3D>();
  for (const o of g.scene.children) src.set(o.name, o);
  return {
    make(gun) {
      const s = src.get(gun);
      if (!s) throw new Error(`no ${gun} in the armoury`);
      const object = s.clone();
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.traverse((o) => { o.castShadow = true; });
      const x = s.userData as { support?: number; muzzle?: number; length?: number };
      return { object, support: x.support ?? 0.3, muzzle: x.muzzle ?? 0.6, length: x.length ?? 1 };
    },
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(), _m = new THREE.Matrix4();

// Put a gun (in world space: its parent is the scene) in a pair of hands: grip at `grip`, the barrel
// pointing through `support` (or along `aim` for a one-handed gun), its top toward `up`
export function holdBetween(gun: THREE.Object3D, grip: THREE.Object3D, support: THREE.Object3D | null, aim?: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) {
  grip.getWorldPosition(_a);
  if (support) support.getWorldPosition(_b).sub(_a);
  else _b.copy(aim ?? new THREE.Vector3(1, 0, 0));
  if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0);
  _b.normalize();
  const x = _b, z = _up.crossVectors(x, up).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  _m.makeBasis(x, y, z).setPosition(_a);
  gun.matrixAutoUpdate = false;
  gun.matrix.copy(_m);
  gun.matrixWorldNeedsUpdate = true;
}
