// Makes models/animations.json: the few clips City Runners uses, cut out of Quaternius' Universal
// Animation Library (CC0; the 25 MB FBX football ships), so the game loads a few hundred KB instead.
// Joint rotations only (plus the pelvis's height), no fingers, rounded; the game fits them to each body.
//
//   cd web && node games/city-runners/source/make-animations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const KEEP = ['Idle_Loop', 'Sprint_Loop', 'Jog_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Crouch_Fwd_Loop', 'Hit_Chest', 'Death01', 'Dance_Loop'];
const FBX = 'games/football/models/ual_ue.fbx';
const OUT = 'games/city-runners/models/animations.json';

const buf = readFileSync(FBX);
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const round = (v, d) => Array.from(v, (x) => Math.round(x * d) / d);
const clips = [];
for (const c of fbx.animations) {
  const name = c.name.replace(/^.*\|/, '');
  if (!KEEP.includes(name)) continue;
  const tracks = [];
  for (const t of c.tracks) {
    const [bone, prop] = t.name.split('.');
    // (the root carries the file's own Z-up correction; fingers are too small to see from behind a runner)
    if (bone === 'root' || /_leaf_|^(index|middle|ring|pinky|thumb)_/.test(bone)) continue;
    if (prop === 'quaternion') tracks.push({ name: t.name, type: 'quaternion', times: round(t.times, 1000), values: round(t.values, 10000) });
    else if (prop === 'position' && bone === 'pelvis') tracks.push({ name: t.name, type: 'vector', times: round(t.times, 1000), values: round(t.values, 10000) });
  }
  clips.push({ name, duration: Math.round(c.duration * 1000) / 1000, tracks });
}
const missing = KEEP.filter((k) => !clips.some((c) => c.name === k));
if (missing.length) throw new Error(`not in the library: ${missing.join(', ')}`);
writeFileSync(OUT, JSON.stringify({ source: 'Quaternius Universal Animation Library (CC0), from ' + FBX, clips }));
console.log(`${clips.length} clips -> ${OUT} (${(JSON.stringify(clips).length / 1024).toFixed(0)} KB)`);
