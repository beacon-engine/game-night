// The pit crews: four people in each team's colours at its box, in overalls and helmets (the shared cast,
// @people). They wait at the front of the garage; when their car stops in the box they run to its wheels
// and crouch at them until it's done, then step back. Above each box, a board with the team's colour and
// the driver's name, so you can find yours. A crew is out only for the people's cars and for a computer
// driver's while it's coming in (a whole pit wall of animated people is too much for a TV), and only drawn
// when a camera is near.
import * as THREE from 'three';
import { fit, loadCast, loadMoves, Person, type Cast, type Moves } from '@people/people.ts';
import type { Car } from '@racing/race.ts';
import type { Track } from '@racing/track.ts';
import { canvas, DISPLAY_FONT, texture } from '@world/draw.ts';
import type { PitLane } from './pits.ts';

const NEAR = 160; // m from a camera to the box for its crew to be drawn
const RUN = 7; // m/s they run to the car
const WHEELS: [number, number][] = [[1.75, -1.15], [1.75, 1.15], [-1.6, -1.15], [-1.6, 1.15]]; // along, across: front left...

const MOVES = ['idle', 'run', 'crouch'];
let assets: { cast: Cast; moves: Moves } | null = null;
export async function loadCrew() {
  const [cast, moves] = await Promise.all([loadCast('soldiers'), loadMoves('soldier-moves')]);
  // (just the moves a crew makes: fitting each to a body takes a moment)
  assets = { cast, moves: { ...moves, clips: new Map([...moves.clips].filter(([n]) => MOVES.includes(n))) } };
}

interface Hand { person: Person; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; doing: string; at: THREE.Vector3; home: THREE.Vector3 }
interface Crew { car: Car; box: number; index: number; hands: Hand[]; board: THREE.Mesh; group: THREE.Group }

export class Crews {
  group = new THREE.Group();
  private crews: Crew[] = [];

  // A crew and a board for each car, at its box (box i for car i, as the pit lane hands them out)
  set(track: Track, pits: PitLane, cars: Car[]) {
    this.clear();
    if (!assets) return;
    cars.forEach((car, i) => {
      const s = pits.boxes[i % pits.boxes.length], group = new THREE.Group();
      const board = this.board(track, pits, s, car, car.spec.paint ?? car.spec.color);
      group.add(board);
      this.group.add(group);
      this.crews.push({ car, box: s, index: i, hands: [], board, group });
    });
  }

  // The crew itself, made the first time it's out
  private hire(crew: Crew, track: Track, pits: PitLane) {
    const people = [...assets!.cast.people.keys()], { car, box: s, index: i, group } = crew;
    const color = car.spec.paint ?? car.spec.color;
    crew.hands = WHEELS.map((_, k): Hand => {
      const person = new Person(assets!.cast, people[(i * 3 + k) % people.length]);
      person.tint('top', color);
      person.tint('legs', new THREE.Color(color).multiplyScalar(0.45));
      person.tint('helmet', color);
      person.tint('boots', '#1b1d22');
      const clips = fit(assets!.moves, person.root), mixer = new THREE.AnimationMixer(person.root);
      const actions = new Map(MOVES.map((n) => [n, mixer.clipAction(clips.get(n)!)]));
      actions.get('idle')!.play();
      actions.get('idle')!.time = Math.random() * 2;
      // waiting at the front of the garage, spread along the box
      const p = track.point(s + (k - 1.5) * 1.6, pits.lane - 3.2);
      const home = new THREE.Vector3(p.x, p.y, p.z);
      person.root.position.copy(home);
      group.add(person.root);
      return { person, mixer, actions, doing: 'idle', at: home.clone(), home };
    });
  }

  clear() {
    for (const c of this.crews) {
      this.group.remove(c.group);
      for (const h of c.hands) h.mixer.stopAllAction();
      (c.board.material as THREE.MeshBasicMaterial).map?.dispose();
      c.board.geometry.dispose();
    }
    this.crews = [];
  }

  // `atBox`: is this car stopped in its box being worked on? `out`: is its crew out (a person's car, or one coming in)?
  update(dt: number, track: Track, pits: PitLane, atBox: (c: Car) => boolean, out: (c: Car) => boolean, cameras: THREE.Camera[]) {
    for (const crew of this.crews) {
      const near = cameras.some((c) => c.position.distanceTo(crew.board.position) < NEAR);
      crew.group.visible = near;
      if (!near || !out(crew.car)) { for (const h of crew.hands) h.person.root.visible = false; continue; }
      if (!crew.hands.length) this.hire(crew, track, pits);
      for (const h of crew.hands) h.person.root.visible = true;
      const working = atBox(crew.car);
      crew.hands.forEach((h, k) => {
        let want = h.home;
        if (working) {
          const [along, across] = WHEELS[k], p = track.point(crew.box + along, pits.lane + across * 1.35);
          want = TMP.set(p.x, p.y, p.z);
        }
        const gap = h.at.distanceTo(want);
        if (gap > 0.05) h.at.addScaledVector(TMP2.copy(want).sub(h.at).normalize(), Math.min(gap, RUN * dt));
        const doing = gap > 0.3 ? 'run' : working ? 'crouch' : 'idle';
        if (doing !== h.doing) {
          h.actions.get(h.doing)!.fadeOut(0.15);
          h.actions.get(doing)!.reset().fadeIn(0.15).play();
          h.doing = doing;
        }
        h.person.root.position.copy(h.at);
        // facing where they're running, or the car's wheel, or the pit lane
        const face = gap > 0.3 ? TMP2.copy(want).sub(h.at) : working ? TMP2.copy(pointAt(track, crew.box, pits.lane)).sub(h.at) : TMP2.copy(pointAt(track, crew.box + (k - 1.5) * 1.6, pits.lane)).sub(h.at);
        if (face.lengthSq() > 1e-4) h.person.root.rotation.y = Math.atan2(face.x, face.z);
        h.mixer.update(dt);
      });
    }
  }

  // The board over the box: the team's colour, the driver's name and number
  private board(track: Track, pits: PitLane, s: number, car: Car, color: string) {
    const c = canvas(512, 160), g = c.getContext('2d')!;
    g.fillStyle = '#0e1016';
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 22);
    g.fillRect(0, 138, 512, 22);
    g.fillStyle = '#f3f0e8';
    g.font = `900 92px ${DISPLAY_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${car.spec.number}  ${car.spec.name.toUpperCase()}`, 256, 84, 480);
    const p = track.point(s, pits.lane - 3.85), board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.6), new THREE.MeshBasicMaterial({ map: texture(c, false), side: THREE.DoubleSide }));
    board.position.set(p.x, p.y + 4.6, p.z);
    board.rotation.y = Math.atan2(-p.p.hz, p.p.hx); // (facing the lane: +d is (-hz, hx))
    return board;
  }
}

const TMP = new THREE.Vector3(), TMP2 = new THREE.Vector3();
const pointAt = (t: Track, s: number, d: number) => { const p = t.point(s, d); return TMP.set(p.x, p.y, p.z).clone(); };
