// What's in each stage: the enemies, the waves they come in, the boss at the end, and how it looks.
// Data only: the rules that play it are in sim.ts, the drawing in scene.ts.
//
// The playing field is FIELD.w by FIELD.h units (16:9, y up). Everything flies in from the right
// (the stage scrolls left past you); time is in seconds from the start of the stage.

export const FIELD = { w: 32, h: 18 };

// --- enemies ---------------------------------------------------------------------------------------
export enum Enemy {
  Dart = 'dart', // quick, light, comes in strings
  Raider = 'raider', // flies in, stops, fires, leaves
  Miner = 'miner', // slow and tough, sprays shots
  Hauler = 'hauler', // a big carrier: launches darts, always drops something
  Turret = 'turret', // fixed to a rock drifting past, aims at you
  Rock = 'rock', // drifting rock: soaks up shots, breaks in two
  Mine = 'mine', // drifts toward the nearest ship, bursts into a ring when it's hit or close
  Pod = 'pod', // the rift's own: weaves and fires rings
}

// How an enemy fires: at the nearest ship (one, three or five shots in a fan), a ring all round,
// or nothing
export enum Fire {
  None = 'none',
  Aimed = 'aimed',
  Aimed3 = 'aimed3',
  Fan5 = 'fan5',
  Ring = 'ring',
  Spiral = 'spiral',
}

export interface EnemyKind {
  model: string; // models/<model>.glb
  scale: number;
  hp: number;
  r: number; // hit circle
  speed: number; // units/s across the screen
  score: number;
  fire: Fire;
  every: number; // s between volleys (shortened by the difficulty)
  drop: number; // chance it leaves a pickup
  spin?: number; // rad/s it tumbles (rocks)
  paint: string; // its accent colour
}

export const ENEMIES: Record<Enemy, EnemyKind> = {
  [Enemy.Dart]: { model: 'craft_racer', scale: 0.8, hp: 2, r: 0.6, speed: 9, score: 100, fire: Fire.None, every: 0, drop: 0.04, paint: '#ff3b5c' },
  [Enemy.Raider]: { model: 'craft_speederB', scale: 0.85, hp: 6, r: 0.8, speed: 7, score: 250, fire: Fire.Aimed3, every: 1.6, drop: 0.12, paint: '#ff3b5c' },
  [Enemy.Miner]: { model: 'craft_miner', scale: 1.1, hp: 18, r: 1.1, speed: 2.6, score: 600, fire: Fire.Fan5, every: 2.2, drop: 0.35, paint: '#ff9a1f' },
  [Enemy.Hauler]: { model: 'craft_cargoB', scale: 1.7, hp: 45, r: 1.7, speed: 1.8, score: 1500, fire: Fire.Aimed, every: 1.4, drop: 1, paint: '#ff9a1f' },
  [Enemy.Turret]: { model: 'turret_double', scale: 1.6, hp: 10, r: 0.8, speed: 3, score: 400, fire: Fire.Aimed, every: 1.3, drop: 0.15, paint: '#ff3b5c' },
  [Enemy.Rock]: { model: 'meteor_detailed', scale: 1.7, hp: 8, r: 0.75, speed: 3.2, score: 50, fire: Fire.None, every: 0, drop: 0.05, spin: 1.2, paint: '#c97b5a' },
  [Enemy.Mine]: { model: 'satelliteDish_large', scale: 0.9, hp: 3, r: 0.6, speed: 2.2, score: 150, fire: Fire.Ring, every: 0, drop: 0, spin: 2.5, paint: '#ff3b5c' },
  [Enemy.Pod]: { model: 'alien', scale: 0.9, hp: 8, r: 0.8, speed: 4, score: 350, fire: Fire.Ring, every: 2.4, drop: 0.12, paint: '#b46bff' },
};

// How an enemy moves once it's on screen
export enum Path {
  Line = 'line', // straight across
  Sine = 'sine', // weaving up and down
  Dive = 'dive', // in, then swoop at the nearest ship
  Stop = 'stop', // in, hold a while, then away
  Drift = 'drift', // slowly, a little up or down (rocks, mines)
  Loop = 'loop', // a loop in the middle of the screen
}

// A wave: `count` of `enemy`, `every` s apart, from `at` s into the stage, entering at height `y`
// (0..1 of the field, or 'spread' across it)
export interface Wave {
  at: number;
  enemy: Enemy;
  count: number;
  every: number;
  y: number | 'spread' | 'random';
  path: Path;
  amp?: number; // sine height, loop size
  hold?: number; // stop: how long, and where (x, 0..1)
  holdX?: number;
}

// --- bosses ------------------------------------------------------------------------------------------
// A boss is a body you can't hurt until its guns are gone, then the core. Each part is a model at an
// offset from the boss's centre, with its own hit points and its own way of firing.
export interface BossPart {
  model: string;
  scale: number;
  x: number;
  y: number;
  rotY?: number;
  hp: number; // 0: armour, can't be hurt
  r: number;
  fire: Fire;
  every: number;
  core?: boolean; // the last part: open once the others are gone
  paint?: string;
}

export interface Boss {
  name: string;
  hp: number; // the core's (also in its part)
  score: number;
  sway: number; // how far it moves up and down
  parts: BossPart[];
  rage: Fire; // what the core fires once it's exposed
}

// --- stages -------------------------------------------------------------------------------------------
export interface Look {
  sky: [string, string]; // the nebula's two colours
  stars: string;
  planet: { color: string; glow: string; size: number; x: number; y: number } | null;
  props: string[]; // models drifting past far behind (rocks, wrecks, girders)
  propEvery: number; // s between them
  light: string;
}

export interface Stage {
  name: string;
  about: string; // a line on the screen as it starts
  look: Look;
  waves: Wave[];
  length: number; // s of waves before the boss comes in
  boss: Boss;
}

const W = (at: number, enemy: Enemy, count: number, every: number, y: Wave['y'], path: Path, more: Partial<Wave> = {}): Wave =>
  ({ at, enemy, count, every, y, path, ...more });

export const STAGES: Stage[] = [
  {
    name: 'The Kessler Belt',
    about: 'Rocks, raiders, and the rig that mines them',
    look: {
      sky: ['#1a2650', '#5a2a4a'], stars: '#cfe0ff', light: '#ffe2c4',
      planet: { color: '#c26a3d', glow: '#ff9a5a', size: 9, x: 0.78, y: 0.72 },
      props: ['rock_largeA', 'rock_largeB', 'meteor', 'meteor_half'], propEvery: 0.9,
    },
    length: 96,
    waves: [
      W(2, Enemy.Dart, 6, 0.35, 0.7, Path.Sine, { amp: 2 }),
      W(6, Enemy.Dart, 6, 0.35, 0.3, Path.Sine, { amp: 2 }),
      W(10, Enemy.Rock, 4, 0.9, 'random', Path.Drift),
      W(13, Enemy.Raider, 3, 0.9, 'spread', Path.Stop, { hold: 2.5, holdX: 0.72 }),
      W(19, Enemy.Dart, 8, 0.25, 0.5, Path.Dive),
      W(24, Enemy.Rock, 6, 0.6, 'random', Path.Drift),
      W(26, Enemy.Turret, 2, 2, 'random', Path.Drift),
      W(31, Enemy.Miner, 1, 0, 0.5, Path.Stop, { hold: 5, holdX: 0.75 }),
      W(33, Enemy.Dart, 6, 0.3, 0.85, Path.Line),
      W(36, Enemy.Dart, 6, 0.3, 0.15, Path.Line),
      W(41, Enemy.Raider, 4, 0.7, 'spread', Path.Stop, { hold: 2, holdX: 0.68 }),
      W(46, Enemy.Rock, 7, 0.55, 'random', Path.Drift),
      W(48, Enemy.Turret, 3, 1.5, 'random', Path.Drift),
      W(54, Enemy.Hauler, 1, 0, 0.5, Path.Line),
      W(58, Enemy.Dart, 10, 0.25, 0.5, Path.Loop, { amp: 3.5 }),
      W(64, Enemy.Miner, 2, 3, 'spread', Path.Stop, { hold: 4, holdX: 0.72 }),
      W(70, Enemy.Raider, 5, 0.6, 'spread', Path.Stop, { hold: 2, holdX: 0.7 }),
      W(76, Enemy.Dart, 8, 0.2, 0.65, Path.Dive),
      W(79, Enemy.Dart, 8, 0.2, 0.35, Path.Dive),
      W(84, Enemy.Rock, 8, 0.45, 'random', Path.Drift),
      W(88, Enemy.Miner, 1, 0, 0.75, Path.Stop, { hold: 4, holdX: 0.7 }),
      W(89, Enemy.Miner, 1, 0, 0.25, Path.Stop, { hold: 4, holdX: 0.7 }),
    ],
    boss: {
      name: 'Rig Matriarch', hp: 220, score: 20000, sway: 4.5, rage: Fire.Spiral,
      parts: [
        { model: 'craft_miner', scale: 4.6, x: 0.5, y: 0, hp: 0, r: 0, fire: Fire.None, every: 0 },
        { model: 'turret_double', scale: 1.8, x: -2.2, y: 2.6, hp: 60, r: 1, fire: Fire.Aimed3, every: 1.3 },
        { model: 'turret_double', scale: 1.8, x: -2.2, y: -2.6, hp: 60, r: 1, fire: Fire.Aimed3, every: 1.3 },
        { model: 'turret_single', scale: 1.8, x: -5, y: 0, hp: 45, r: 0.9, fire: Fire.Fan5, every: 1.8 },
        { model: 'machine_generatorLarge', scale: 1.8, x: 1.2, y: 0, hp: 220, r: 1.4, fire: Fire.Ring, every: 1.1, core: true, paint: '#ff3b5c' },
      ],
    },
  },
  {
    name: 'Orbital Yard',
    about: 'A shipyard in orbit, and the dreadnought it was building',
    look: {
      sky: ['#0d2a3a', '#183c5c'], stars: '#bfefff', light: '#d8f2ff',
      planet: { color: '#3d7fc2', glow: '#7fd0ff', size: 14, x: 0.25, y: 0.15 },
      props: ['structure_detailed', 'structure_diagonal', 'rocket_fuelA', 'pipe_ring', 'hangar_roundGlass'], propEvery: 1.2,
    },
    length: 100,
    waves: [
      W(2, Enemy.Raider, 3, 0.6, 'spread', Path.Stop, { hold: 2, holdX: 0.7 }),
      W(7, Enemy.Dart, 8, 0.25, 0.75, Path.Sine, { amp: 1.5 }),
      W(9, Enemy.Dart, 8, 0.25, 0.25, Path.Sine, { amp: 1.5 }),
      W(14, Enemy.Mine, 6, 0.8, 'random', Path.Drift),
      W(19, Enemy.Hauler, 1, 0, 0.7, Path.Line),
      W(21, Enemy.Turret, 3, 1.2, 'random', Path.Drift),
      W(27, Enemy.Raider, 6, 0.5, 'spread', Path.Stop, { hold: 1.8, holdX: 0.66 }),
      W(33, Enemy.Dart, 12, 0.2, 0.5, Path.Loop, { amp: 4 }),
      W(39, Enemy.Miner, 2, 2, 'spread', Path.Stop, { hold: 4, holdX: 0.74 }),
      W(42, Enemy.Mine, 8, 0.6, 'random', Path.Drift),
      W(48, Enemy.Hauler, 1, 0, 0.3, Path.Line),
      W(50, Enemy.Dart, 10, 0.2, 0.8, Path.Dive),
      W(56, Enemy.Turret, 4, 1, 'random', Path.Drift),
      W(62, Enemy.Raider, 8, 0.4, 'spread', Path.Stop, { hold: 1.6, holdX: 0.64 }),
      W(70, Enemy.Miner, 3, 1.5, 'spread', Path.Stop, { hold: 3.5, holdX: 0.72 }),
      W(77, Enemy.Mine, 10, 0.5, 'random', Path.Drift),
      W(82, Enemy.Dart, 10, 0.2, 0.2, Path.Dive),
      W(86, Enemy.Hauler, 2, 4, 'spread', Path.Line),
      W(92, Enemy.Raider, 6, 0.4, 'spread', Path.Stop, { hold: 2, holdX: 0.68 }),
    ],
    boss: {
      name: 'Dreadnought Vantor', hp: 300, score: 30000, sway: 3, rage: Fire.Fan5,
      parts: [
        { model: 'craft_cargoB', scale: 6, x: 0.5, y: 0, rotY: 0, hp: 0, r: 0, fire: Fire.None, every: 0 },
        { model: 'turret_double', scale: 1.8, x: -3.8, y: 1.8, hp: 50, r: 0.9, fire: Fire.Aimed, every: 0.8 },
        { model: 'turret_double', scale: 1.8, x: -3.8, y: -1.8, hp: 50, r: 0.9, fire: Fire.Aimed, every: 0.8 },
        { model: 'turret_single', scale: 1.8, x: 0.5, y: 3.2, hp: 50, r: 0.9, fire: Fire.Ring, every: 1.6 },
        { model: 'turret_single', scale: 1.8, x: 0.5, y: -3.2, hp: 50, r: 0.9, fire: Fire.Ring, every: 1.6 },
        { model: 'rocket_baseA', scale: 2.2, x: -1.5, y: 0, rotY: Math.PI / 2, hp: 300, r: 1.4, fire: Fire.Aimed3, every: 0.9, core: true, paint: '#ff3b5c' },
      ],
    },
  },
  {
    name: 'The Rift',
    about: 'Where the pods come from',
    look: {
      sky: ['#24103e', '#0b3a34'], stars: '#e6d4ff', light: '#d6ffe9',
      planet: { color: '#6b3dc2', glow: '#b48aff', size: 11, x: 0.7, y: 0.2 },
      props: ['rock_crystalsLargeA', 'rock_crystalsLargeB', 'meteor_half'], propEvery: 0.8,
    },
    length: 104,
    waves: [
      W(2, Enemy.Pod, 4, 0.8, 'spread', Path.Sine, { amp: 1.2 }),
      W(8, Enemy.Dart, 10, 0.2, 0.5, Path.Loop, { amp: 3 }),
      W(13, Enemy.Rock, 6, 0.6, 'random', Path.Drift),
      W(16, Enemy.Pod, 6, 0.6, 'spread', Path.Sine, { amp: 2 }),
      W(23, Enemy.Miner, 2, 1, 'spread', Path.Stop, { hold: 4, holdX: 0.72 }),
      W(28, Enemy.Mine, 8, 0.5, 'random', Path.Drift),
      W(33, Enemy.Pod, 8, 0.5, 'spread', Path.Dive),
      W(39, Enemy.Raider, 6, 0.45, 'spread', Path.Stop, { hold: 2, holdX: 0.66 }),
      W(45, Enemy.Hauler, 1, 0, 0.5, Path.Line),
      W(47, Enemy.Pod, 6, 0.5, 0.8, Path.Sine, { amp: 1.5 }),
      W(50, Enemy.Pod, 6, 0.5, 0.2, Path.Sine, { amp: 1.5 }),
      W(56, Enemy.Rock, 8, 0.45, 'random', Path.Drift),
      W(58, Enemy.Turret, 4, 1, 'random', Path.Drift),
      W(64, Enemy.Miner, 3, 1.5, 'spread', Path.Stop, { hold: 3, holdX: 0.72 }),
      W(70, Enemy.Pod, 10, 0.4, 'spread', Path.Dive),
      W(78, Enemy.Dart, 14, 0.18, 0.5, Path.Loop, { amp: 4 }),
      W(84, Enemy.Mine, 10, 0.4, 'random', Path.Drift),
      W(90, Enemy.Hauler, 2, 3, 'spread', Path.Line),
      W(96, Enemy.Pod, 8, 0.4, 'spread', Path.Stop, { hold: 2.5, holdX: 0.7 }),
    ],
    boss: {
      name: 'The Hive Crystal', hp: 360, score: 40000, sway: 5, rage: Fire.Spiral,
      parts: [
        { model: 'rock_crystalsLargeA', scale: 7, x: 0.5, y: 0, hp: 0, r: 0, fire: Fire.None, every: 0 },
        { model: 'alien', scale: 1.4, x: -2.5, y: 3.5, hp: 55, r: 1, fire: Fire.Ring, every: 1.4 },
        { model: 'alien', scale: 1.4, x: -2.5, y: -3.5, hp: 55, r: 1, fire: Fire.Ring, every: 1.4 },
        { model: 'alien', scale: 1.4, x: -4, y: 0, hp: 55, r: 1, fire: Fire.Fan5, every: 1.2 },
        { model: 'rock_crystalsLargeB', scale: 3, x: -0.8, y: 0, hp: 360, r: 1.6, fire: Fire.Spiral, every: 0.12, core: true, paint: '#2ee59d' },
      ],
    },
  },
];

// --- pickups --------------------------------------------------------------------------------------------
export enum Weapon {
  Blaster = 'blaster', // straight ahead, more streams as it powers up
  Spread = 'spread', // a fan
  Laser = 'laser', // a beam through everything in a line
  Missiles = 'missiles', // homing, alongside the blaster
}

export enum Pickup {
  Power = 'power', // the weapon you have, one level up
  Spread = 'spread',
  Laser = 'laser',
  Missiles = 'missiles',
  Shield = 'shield', // takes one hit for you
  Bomb = 'bomb',
  Life = 'life', // one more ship for the team
}

export const PICKUP_LOOK: Record<Pickup, { letter: string; color: string; name: string }> = {
  [Pickup.Power]: { letter: 'P', color: '#ffc23d', name: 'Power up' },
  [Pickup.Spread]: { letter: 'S', color: '#4c8dff', name: 'Spread' },
  [Pickup.Laser]: { letter: 'L', color: '#2ee59d', name: 'Laser' },
  [Pickup.Missiles]: { letter: 'M', color: '#ff8a3d', name: 'Missiles' },
  [Pickup.Shield]: { letter: '◆', color: '#3fd7e8', name: 'Shield' },
  [Pickup.Bomb]: { letter: 'B', color: '#ff4d5a', name: 'Bomb' },
  [Pickup.Life]: { letter: '+', color: '#a97bff', name: 'Extra ship' },
};

// How likely each is when something drops (they add up to 1)
export const DROPS: [Pickup, number][] = [
  [Pickup.Power, 0.4], [Pickup.Spread, 0.12], [Pickup.Laser, 0.12], [Pickup.Missiles, 0.12],
  [Pickup.Shield, 0.1], [Pickup.Bomb, 0.1], [Pickup.Life, 0.04],
];

export const WEAPON_OF: Partial<Record<Pickup, Weapon>> = {
  [Pickup.Spread]: Weapon.Spread, [Pickup.Laser]: Weapon.Laser, [Pickup.Missiles]: Weapon.Missiles,
};

// --- how hard ----------------------------------------------------------------------------------------------
export enum Difficulty { Easy = 'easy', Normal = 'normal', Hard = 'hard' }

export const DIFFICULTY: Record<Difficulty, { name: string; bulletSpeed: number; fireRate: number; hp: number; lives: number }> = {
  [Difficulty.Easy]: { name: 'Easy', bulletSpeed: 0.75, fireRate: 0.65, hp: 0.8, lives: 4 },
  [Difficulty.Normal]: { name: 'Normal', bulletSpeed: 1, fireRate: 1, hp: 1, lives: 3 },
  [Difficulty.Hard]: { name: 'Hard', bulletSpeed: 1.25, fireRate: 1.35, hp: 1.3, lives: 2 },
};
