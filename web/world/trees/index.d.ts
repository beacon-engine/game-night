// Types for the vendored ez-tree (MIT, see LICENSE): only what the games use.
import * as THREE from 'three';

export interface TreeJson { [k: string]: unknown }

export declare class TreeOptions {
  seed: number;
  type: string;
  bark: { type: string; tint: number; flatShading: boolean; textured: boolean; textureScale: { x: number; y: number } };
  branch: Record<string, unknown> & { levels: number; length: Record<number, number>; children: Record<number, number>; radius: Record<number, number> };
  leaves: { type: string; billboard: string; angle: number; count: number; start: number; size: number; sizeVariance: number; tint: number; alphaTest: number };
  copy(json: TreeJson): void;
}

export declare class Tree extends THREE.Group {
  options: TreeOptions;
  branchesMesh: THREE.Mesh;
  leavesMesh: THREE.Mesh;
  constructor(options?: TreeOptions);
  loadPreset(name: string): void;
  loadFromJson(json: TreeJson): void;
  generate(): void;
  update(elapsedTime: number): void;
}

export declare function loadPreset(name: string): TreeJson;
export declare function setTreeTextures(t: { bark: { color: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture }; leaves: THREE.Texture }): void;
