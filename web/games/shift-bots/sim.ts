// Shift Bots: the rules. Bots, ours and theirs, as cars or robots on the arena floor; their shots, punches,
// dodges, rams and specials; changing between car and robot; getting each other up; scrap and what it
// buys; and the waves, with a boss every fifth. No graphics: main.ts reads what happened (`events`) and
// battle.ts draws it. Plain numbers in metres and seconds, at a fixed 60 steps a second. No imports but the
// arena, so it runs anywhere (balance.ts, in Node).
//
// The floor is the x/z plane. A bot's yaw is the way it faces: 0 is +z, and it turns towards +x.
import { blocked, nearest, pushOut, type Arena } from './arena.ts';

export const TICK = 1 / 60;
export type Side = 'us' | 'them';
export type Foe = 'scout' | 'trooper' | 'brute' | 'lancer' | 'hauler';
export type Kind = 'player' | Foe;
export type WeaponId = 'blaster' | 'cannon' | 'scatter';
export type SpecialId = 'shield' | 'shockwave' | 'missiles';
export type Upgrade = 'armour' | 'damage' | 'speed' | 'special';

// Who a bot is: its side and kind, and its body's numbers (1 = middling) as bots.json has them
export interface BotSpec {
  id: string; name: string; side: Side; kind: Kind; body: string;
  speed: number; armour: number; power: number; agility: number;
  shiftTime: number; height: number; length: number; // s to change; robot height, car length (m)
  weapon: WeaponId; special?: SpecialId;
  scale?: number; // drawn this much bigger (the boss)
}

interface Weapon { cd: number; speed: number; dmg: number; range: number; spread: number; pellets: number; splash: number }
export const WEAPON: Record<WeaponId, Weapon> = {
  blaster: { cd: 0.15, speed: 75, dmg: 8, range: 60, spread: 0.025, pellets: 1, splash: 0 },
  cannon: { cd: 0.85, speed: 48, dmg: 32, range: 55, spread: 0.01, pellets: 1, splash: 4.5 },
  scatter: { cd: 0.55, speed: 65, dmg: 6.5, range: 24, spread: 0.2, pellets: 7, splash: 0 },
};

// The enemy, kind by kind: toughness, how their guns shoot (a share of the weapon's damage, how often,
// how wild), how fast they drive, and the range they like to fight at
interface Enemy { hp: number; dmg: number; cd: number; spread: number; top: number; near: number; far: number }
const ENEMY: Record<Foe, Enemy> = {
  scout: { hp: 55, dmg: 0, cd: 0, spread: 0, top: 24, near: 0, far: 0 },
  trooper: { hp: 100, dmg: 0.45, cd: 0.5, spread: 0.08, top: 20, near: 13, far: 24 },
  brute: { hp: 260, dmg: 0, cd: 0, spread: 0, top: 18, near: 0, far: 2.5 },
  lancer: { hp: 85, dmg: 2.6, cd: 1.9, spread: 0.012, top: 22, near: 30, far: 44 },
  hauler: { hp: 900, dmg: 0.8, cd: 2.4, spread: 0.12, top: 19, near: 10, far: 26 },
};
export const LEVELS = [{ name: 'Easy', hurt: 0.6, tough: 0.75 }, { name: 'Normal', hurt: 1, tough: 1 }, { name: 'Hard', hurt: 1.35, tough: 1.3 }];

// The specials: how long to charge, and what they do
export const SPECIAL: Record<SpecialId, { cd: number; name: string }> = {
  shield: { cd: 16, name: 'Shield' }, shockwave: { cd: 12, name: 'Shockwave' }, missiles: { cd: 14, name: 'Missiles' },
};
const SHIELD_TIME = 5, SHIELD_R = 5.5;

// What scrap buys: each step of each upgrade costs more than the last
export const UPGRADES: { id: Upgrade; name: string; about: string }[] = [
  { id: 'armour', name: 'Armour', about: '+15% armour' },
  { id: 'damage', name: 'Damage', about: '+12% to guns and fists' },
  { id: 'speed', name: 'Speed', about: '+8% walking and driving' },
  { id: 'special', name: 'Special', about: 'Charges 15% sooner' },
];
export const upgradeCost = (level: number) => 25 + level * 15;

const WALK = 7.5, RUN = 1.9; // m/s as a robot (times agility), and how much faster running is
const TOP = 30; // m/s as a car, times speed
const ACCEL = 16, BRAKE = 12, TURN = 2.3; // m/s², m/s², rad/s
const REGEN_AFTER = 3, REGEN = 0.06; // a car out of the fight mends this much of its armour a second
const MAX_ENEMIES = 14; // on the field at once (the rest wait their turn)
const REVIVE_R = 4, REVIVE_TIME = 3; // stand this close to a friend who's down, this long, to get them up

// What a bot wants this step: which way to go (world x/z, up to 1 long), and the buttons
export interface Control { x: number; z: number; fire: boolean; punch: boolean; shift: boolean; dodge: boolean; special: boolean; run: boolean }
export const idle = (): Control => ({ x: 0, z: 0, fire: false, punch: false, shift: false, dodge: false, special: false, run: false });

export class Bot {
  x = 0; z = 0; yaw = 0; vx = 0; vz = 0;
  speed = 0; // forward, as a car
  shift = 0; target = 0; // 0 car .. 1 robot, and which it's changing to
  hp: number; maxHp: number; base: number;
  down = false; dead = false; revive = 0; // (how far a friend has got with getting it up, 0..1)
  ctl: Control = idle();
  fireCd = 0; punchT = -1; combo = 0; comboT = 0; punchCd = 0; dodgeT = -1; dodgeX = 0; dodgeZ = 0; dodgeCd = 0;
  hurtT = 99; hitT = 0; aim = 0; foe: Bot | null = null; boost = 1; boosting = false; stun = 0; slam = false; rammedT = 99;
  special = 0; shieldT = 0; // the special's charge (0..1), the shield's time left
  running = false;
  up: Record<Upgrade, number> = { armour: 0, damage: 0, speed: 0, special: 0 };
  kills = 0; scrap = 0; think = 0; stuckT = 0; escapeT = 0; strafe = Math.random() < 0.5 ? 1 : -1; stompCd = 2;
  readonly spec: BotSpec;
  constructor(spec: BotSpec, hp: number) { this.spec = spec; this.hp = this.maxHp = this.base = hp; } // (no parameter properties: Node runs this file as it is)
  get robot() { return this.shift >= 1; }
  get car() { return this.shift <= 0; }
  get changing() { return this.shift > 0 && this.shift < 1; }
  get scale() { return this.spec.scale ?? 1; }
  get r() { return (this.shift > 0.5 ? 0.24 * this.spec.height : 0.28 * this.spec.length) * this.scale; }
  get alive() { return !this.down && !this.dead; }
  get dodging() { return this.dodgeT >= 0 && this.dodgeT < 0.3; }
  get power() { return this.spec.power * (1 + 0.12 * this.up.damage); }
  get pace() { return 1 + 0.08 * this.up.speed; }
}

export interface Shot {
  x: number; z: number; y: number; vx: number; vz: number; life: number; dmg: number; splash: number; from: Bot;
  kind: WeaponId | 'missile' | 'lance'; homing?: Bot | null; max: number; // (max: the life it started with)
}
export interface Drop { x: number; z: number; value: number; life: number }

export type SimEvent =
  | { t: 'fire'; bot: Bot; kind: Shot['kind'] } | { t: 'hit'; x: number; z: number; y: number; bot: Bot | null; dmg: number }
  | { t: 'boom'; x: number; z: number; r: number } | { t: 'punch'; bot: Bot; combo: number } | { t: 'smack'; bot: Bot; by: Bot }
  | { t: 'ram'; bot: Bot; by: Bot; dmg: number } | { t: 'slam'; bot: Bot; r: number } | { t: 'change'; bot: Bot; robot: boolean }
  | { t: 'special'; bot: Bot; id: SpecialId } | { t: 'block'; x: number; z: number; y: number }
  | { t: 'down'; bot: Bot } | { t: 'revived'; bot: Bot } | { t: 'wreck'; bot: Bot } | { t: 'scrap'; bot: Bot; value: number }
  | { t: 'wave'; n: number; boss: boolean } | { t: 'cleared'; n: number } | { t: 'over' };

export class Sim {
  bots: Bot[] = [];
  shots: Shot[] = [];
  drops: Drop[] = [];
  events: SimEvent[] = [];
  wave = 0;
  t = 0;
  over = false;
  breakT = 3; // seconds until the next wave starts (main holds it at zero while people shop)
  resting = false; // between waves: the last one's cleared, the next isn't here yet
  private queue: Foe[] = [];
  private spawnT = 0;
  private level: { hurt: number; tough: number };

  readonly arena: Arena;
  readonly enemies: Record<Foe, BotSpec[]>;
  constructor(arena: Arena, players: BotSpec[], level: number, enemies: Record<Foe, BotSpec[]>) {
    this.arena = arena;
    this.enemies = enemies;
    this.level = LEVELS[level];
    players.forEach((spec, i) => {
      const b = new Bot(spec, 240 * spec.armour);
      const a = (i / Math.max(1, players.length)) * Math.PI * 2;
      b.x = Math.cos(a) * 4; b.z = Math.sin(a) * 4;
      b.special = 0.5;
      this.bots.push(b);
    });
  }

  get humans() { return this.bots.filter((b) => b.spec.side === 'us'); }
  get foes() { return this.bots.filter((b) => b.spec.side === 'them' && !b.dead); }
  get remaining() { return this.queue.length + this.foes.length; }
  get boss() { return this.foes.find((b) => b.spec.kind === 'hauler') ?? null; }

  step() {
    this.events = [];
    this.t += TICK;
    const dt = TICK;
    for (const b of this.bots) {
      if (!b.alive) continue;
      if (b.spec.side === 'them') this.ai(b, dt);
      this.control(b, dt);
      this.weapons(b, dt);
      this.specials(b, dt);
    }
    this.move(dt);
    this.fly(dt);
    this.revives(dt);
    this.pickups(dt);
    this.waves(dt);
    for (const b of this.bots) b.ctl.punch = b.ctl.shift = b.ctl.dodge = b.ctl.special = false; // (presses last one step)
  }

  // Start at a later wave (for testing: ?wave=5)
  startAt(wave: number) { this.wave = Math.max(0, wave - 1); this.resting = true; this.breakT = 2; }

  // Spend scrap on an upgrade, if there's enough
  buy(b: Bot, u: Upgrade) {
    const cost = upgradeCost(b.up[u]);
    if (b.scrap < cost) return false;
    b.scrap -= cost;
    b.up[u]++;
    if (u === 'armour') { const k = b.hp / b.maxHp; b.maxHp = b.base * (1 + 0.15 * b.up.armour); b.hp = b.maxHp * k; }
    return true;
  }

  // --- driving, walking, changing ---------------------------------------------------------------------
  private control(b: Bot, dt: number) {
    const c = b.ctl, mag = Math.min(1, Math.hypot(c.x, c.z));
    b.hurtT += dt; b.rammedT += dt; b.hitT = Math.max(0, b.hitT - dt * 3); b.stun = Math.max(0, b.stun - dt);
    b.fireCd -= dt; b.punchCd -= dt; b.dodgeCd -= dt; b.comboT -= dt; b.stompCd -= dt;
    if (b.punchT >= 0) b.punchT = b.punchT + dt > 0.38 ? -1 : b.punchT + dt;
    if (b.dodgeT >= 0) b.dodgeT = b.dodgeT + dt > 0.4 ? -1 : b.dodgeT + dt;
    // changing: press to start (or turn back halfway); at speed, a car that stands up lands with a slam
    if (c.shift && b.dodgeT < 0 && b.stun <= 0) {
      b.target = b.target > 0.5 ? 0 : 1;
      if (b.target === 1 && b.speed > 14) b.slam = true;
      this.events.push({ t: 'change', bot: b, robot: b.target === 1 });
    }
    const was = b.shift;
    b.shift = b.target > b.shift ? Math.min(1, b.shift + dt / b.spec.shiftTime) : Math.max(b.target, b.shift - dt / b.spec.shiftTime);
    if (was < 1 && b.shift >= 1 && b.slam) { b.slam = false; this.shockwave(b, 7, 24, 10, 0.8); }
    if (b.stun > 0) { b.speed *= 1 - dt * 3; b.vx *= 1 - dt * 4; b.vz *= 1 - dt * 4; return; }
    if (b.shift <= 0 || (b.target === 0 && b.shift < 0.4)) {
      // a car: turns towards where the stick points, gas as far as it's pushed; Fire held is the boost
      b.boosting = c.fire && b.boost > 0.05 && mag > 0.2;
      b.boost = Math.max(0, Math.min(1, b.boost + (b.boosting ? -0.35 : 0.15) * dt));
      const kind = b.spec.kind, top = (kind === 'player' ? TOP * b.spec.speed : ENEMY[kind].top) * b.pace * (b.boosting ? 1.45 : 1);
      if (mag > 0.2) {
        const want = Math.atan2(c.x, c.z), turn = TURN * (0.55 + 0.45 * b.spec.agility) * Math.min(1, 0.3 + b.speed / 12);
        b.yaw += clamp(angle(want - b.yaw), -turn * dt, turn * dt);
        b.speed = approach(b.speed, top * mag, (b.speed < top * mag ? ACCEL * (b.boosting ? 1.6 : 1) * (0.5 + 0.5 * this.arena.grip) : BRAKE) * dt);
      } else b.speed = approach(b.speed, 0, BRAKE * this.arena.grip * dt);
      // (the car goes where it's pointing as fast as its tyres grip: on snow it slides round the turns)
      const g = this.arena.grip, k = Math.min(1, dt * (1 + 20 * g * g));
      b.vx += (Math.sin(b.yaw) * b.speed - b.vx) * k; b.vz += (Math.cos(b.yaw) * b.speed - b.vz) * k;
      return;
    }
    b.boosting = false;
    // changing: no driving and no walking, just sliding to a stop
    if (b.changing) { b.speed = approach(b.speed, 0, 22 * dt); b.vx = Math.sin(b.yaw) * b.speed; b.vz = Math.cos(b.yaw) * b.speed; return; }
    b.speed = 0;
    // a robot: walks where the stick points, faces what it's shooting at (or where it's going); dodges
    if (c.dodge && b.dodgeCd <= 0) {
      const d = mag > 0.2 ? [c.x / mag, c.z / mag] : [-Math.sin(b.yaw), -Math.cos(b.yaw)];
      b.dodgeT = 0; b.dodgeCd = 0.8; b.dodgeX = d[0]; b.dodgeZ = d[1];
    }
    if (b.dodgeT >= 0) { b.vx = b.dodgeX * 15; b.vz = b.dodgeZ * 15; return; }
    b.running = c.run && mag > 0.5 && b.punchT < 0;
    const walk = WALK * b.spec.agility * b.pace * (b.punchT >= 0 ? 0.35 : 1) * (b.spec.kind === 'hauler' ? 0.6 : 1) * (b.running ? RUN : 1);
    b.vx = approach(b.vx, c.x * walk, 40 * dt); b.vz = approach(b.vz, c.z * walk, 40 * dt);
    const face = b.foe && (b.aim > 0.3 || b.punchT >= 0) ? Math.atan2(b.foe.x - b.x, b.foe.z - b.z) : mag > 0.2 ? Math.atan2(c.x, c.z) : b.yaw;
    b.yaw += clamp(angle(face - b.yaw), -10 * dt, 10 * dt);
  }

  // --- shooting and punching ---------------------------------------------------------------------------
  private weapons(b: Bot, dt: number) {
    b.aim = Math.max(0, b.aim - dt * 2);
    if (!b.robot || b.dodgeT >= 0 || b.stun > 0) return;
    const us = b.spec.kind === 'player', w = WEAPON[b.spec.weapon];
    // aim at the nearest enemy in sight, roughly the way it's facing (or the one it's already on)
    const cone = us ? 0.9 : Math.PI;
    if (!b.foe || !b.foe.alive || !this.sees(b, b.foe, w.range * 1.1)) b.foe = this.pick(b, w.range * (b.spec.kind === 'lancer' ? 1.3 : 1), cone);
    if (b.ctl.punch && b.punchCd <= 0) {
      b.combo = b.comboT > 0 ? (b.combo % 3) + 1 : 1;
      b.punchT = 0; b.punchCd = b.spec.kind === 'brute' ? 0.7 : 0.28; b.comboT = 0.9;
      const near = this.pick(b, 5 * b.scale, Math.PI);
      if (near) { b.foe = near; b.yaw = Math.atan2(near.x - b.x, near.z - b.z); }
      this.events.push({ t: 'punch', bot: b, combo: b.combo });
    }
    if (b.punchT >= 0.15 && b.punchT - dt < 0.15) this.punch(b);
    if (!b.ctl.fire || b.fireCd > 0 || b.punchT >= 0) return;
    const e = us ? null : ENEMY[b.spec.kind as Foe];
    b.fireCd = e ? e.cd : w.cd;
    b.aim = 1;
    const y = gun(b)[1], f = b.foe, lance = b.spec.kind === 'lancer', speed = lance ? 120 : w.speed;
    let dir = b.yaw;
    if (f) { // (lead the target a little)
      const d = Math.hypot(f.x - b.x, f.z - b.z), t = d / speed;
      dir = Math.atan2(f.x + f.vx * t * 0.7 - b.x, f.z + f.vz * t * 0.7 - b.z);
    }
    const spread = e ? e.spread : w.spread, pellets = b.spec.kind === 'hauler' ? 3 : w.pellets;
    for (let i = 0; i < pellets; i++) {
      const a = dir + (pellets > 1 && e ? (i - (pellets - 1) / 2) * 0.12 : 0) + (Math.random() - 0.5) * 2 * spread;
      const g = gun(b), sx = g[0], sz = g[2];
      const life = (w.range * (lance ? 1.4 : 1)) / speed;
      this.shots.push({ x: sx, z: sz, y, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, life, max: life,
        dmg: w.dmg * b.power * (e ? e.dmg : 1), splash: w.splash, from: b, kind: lance ? 'lance' : b.spec.weapon });
    }
    this.events.push({ t: 'fire', bot: b, kind: lance ? 'lance' : b.spec.weapon });
  }

  private punch(b: Bot) {
    const brute = b.spec.kind === 'brute', reach = b.r + 1.4 + b.spec.height * 0.15 * b.scale, last = b.combo === 3 || brute;
    for (const o of this.bots) {
      if (o.spec.side === b.spec.side || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d > reach + o.r || Math.abs(angle(Math.atan2(o.x - b.x, o.z - b.z) - b.yaw)) > 1.2) continue;
      const kx = (o.x - b.x) / (d || 1), kz = (o.z - b.z) / (d || 1);
      this.hurt(o, (brute ? 20 : last ? 26 : 13) * b.power, b, kx * (last ? 12 : 3), kz * (last ? 12 : 3));
      if (last) o.stun = brute ? 0.5 : 0.6;
      this.events.push({ t: 'smack', bot: o, by: b });
    }
  }

  // Everything of the other side within r is hurt (less further out), thrown back and stunned
  private shockwave(b: Bot, r: number, dmg: number, push: number, stun: number) {
    this.events.push({ t: 'slam', bot: b, r });
    for (const o of this.bots) {
      if (o.spec.side === b.spec.side || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d > r + o.r) continue;
      this.hurt(o, dmg * b.power * (1 - (d / (r + o.r)) * 0.6), b, ((o.x - b.x) / (d || 1)) * push, ((o.z - b.z) / (d || 1)) * push);
      o.stun = Math.max(o.stun, stun);
    }
  }

  // --- specials: charging, and Star to use (as a robot) ----------------------------------------------------
  private specials(b: Bot, dt: number) {
    b.shieldT = Math.max(0, b.shieldT - dt);
    const id = b.spec.special;
    if (!id) return;
    if (b.special < 1) b.special = Math.min(1, b.special + dt / (SPECIAL[id].cd * 0.85 ** b.up.special));
    if (!b.ctl.special || b.special < 1 || !b.robot || b.stun > 0) return;
    b.special = 0;
    this.events.push({ t: 'special', bot: b, id });
    if (id === 'shield') b.shieldT = SHIELD_TIME;
    else if (id === 'shockwave') this.shockwave(b, 10, 32, 15, 1.3);
    else {
      // six missiles, at the nearest three enemies (two each), curling in from above
      const targets = this.foes.filter((o) => o.alive).sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z)).slice(0, 3);
      for (let i = 0; i < 6; i++) {
        const a = b.yaw + (i - 2.5) * 0.35;
        this.shots.push({ x: b.x, z: b.z, y: b.spec.height * 0.8, vx: Math.sin(a) * 26, vz: Math.cos(a) * 26, life: 3.5, max: 3.5,
          dmg: 22 * b.power, splash: 2.6, from: b, kind: 'missile', homing: targets.length ? targets[i % targets.length] : null });
      }
    }
  }

  // The enemy nearest b within range and roughly ahead (`cone`: how far off its facing, rad), in sight
  private pick(b: Bot, range: number, cone: number) {
    let best: Bot | null = null, score = Infinity;
    for (const o of this.bots) {
      if (o.spec.side === b.spec.side || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z), off = Math.abs(angle(Math.atan2(o.x - b.x, o.z - b.z) - b.yaw));
      if (d > range || off > cone || !this.sees(b, o, range)) continue;
      const s = d + off * 12;
      if (s < score) { score = s; best = o; }
    }
    return best;
  }

  sees(a: Bot, b: Bot, range: number) {
    return Math.hypot(b.x - a.x, b.z - a.z) <= range && !blocked(this.arena, a.x, a.z, b.x, b.z);
  }

  // --- damage ------------------------------------------------------------------------------------------
  hurt(b: Bot, dmg: number, by: Bot | null, kx = 0, kz = 0) {
    if (!b.alive || b.dodging) return;
    if (b.changing) dmg *= 0.5;
    if (b.spec.side === 'us') dmg *= this.level.hurt * (0.62 + 0.12 * (this.humans.length - 1)); // (fair for a couch: on your own you're tougher)
    b.hp -= dmg; b.hurtT = 0; b.hitT = 1;
    const heavy = b.spec.kind === 'hauler' ? 0.15 : 1;
    if (b.shift > 0.5) { b.vx += kx * heavy; b.vz += kz * heavy; } else b.speed *= 0.7;
    if (b.hp > 0) return;
    b.hp = 0;
    if (b.spec.side === 'us') { b.down = true; b.revive = 0; b.vx = b.vz = b.speed = 0; this.events.push({ t: 'down', bot: b }); return; }
    b.dead = true;
    if (by) by.kills++;
    const value = { scout: 8, trooper: 15, brute: 25, lancer: 20, hauler: 120 }[b.spec.kind as Foe];
    const pieces = b.spec.kind === 'hauler' ? 8 : 1;
    for (let i = 0; i < pieces; i++) this.drops.push({ x: b.x + (pieces > 1 ? (Math.random() - 0.5) * 8 : 0), z: b.z + (pieces > 1 ? (Math.random() - 0.5) * 8 : 0), value: value / pieces, life: 30 });
    this.events.push({ t: 'wreck', bot: b }, { t: 'boom', x: b.x, z: b.z, r: 3 * b.scale });
  }

  // --- getting each other up --------------------------------------------------------------------------
  private revives(dt: number) {
    for (const b of this.humans) {
      if (!b.down) continue;
      const helped = this.humans.some((o) => o.alive && Math.hypot(o.x - b.x, o.z - b.z) < REVIVE_R + o.r);
      b.revive = helped ? b.revive + dt / REVIVE_TIME : Math.max(0, b.revive - dt / (REVIVE_TIME * 2));
      if (b.revive >= 1) { b.down = false; b.hp = b.maxHp * 0.4; b.revive = 0; b.hurtT = 0; this.events.push({ t: 'revived', bot: b }); }
    }
  }

  // --- moving, bumping, ramming -------------------------------------------------------------------------
  private move(dt: number) {
    const live = this.bots.filter((b) => b.alive);
    for (const b of live) {
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.shift > 0.5 && b.dodgeT < 0) { b.vx *= 1 - Math.min(1, dt * 2); b.vz *= 1 - Math.min(1, dt * 2); } // (knocks die away)
      // the quarry walls, and the rocks
      const d = Math.hypot(b.x, b.z), max = this.arena.radius - b.r;
      if (d > max) { b.x *= max / d; b.z *= max / d; if (b.car) b.speed *= 0.4; }
      for (const r of this.arena.rocks) {
        const to = pushOut(r, b.x, b.z, b.r);
        if (!to) continue;
        [b.x, b.z] = to;
        if (b.car && b.speed > 10) { this.hurt(b, (b.speed - 10) * 0.6, null); this.events.push({ t: 'hit', x: b.x, z: b.z, y: 0.6, bot: b, dmg: 0 }); }
        if (b.car) { b.speed *= 0.5; b.vx *= 0.5; b.vz *= 0.5; }
      }
    }
    // bots bump each other (the big ones barely move); a car going fast into the other side rams it
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d, wa = a.scale ** 3, wb = b.scale ** 3, push = min - d;
      a.x -= nx * push * (wb / (wa + wb)); a.z -= nz * push * (wb / (wa + wb));
      b.x += nx * push * (wa / (wa + wb)); b.z += nz * push * (wa / (wa + wb));
      if (a.spec.side === b.spec.side) continue;
      for (const [m, o, s] of [[a, b, 1], [b, a, -1]] as const) {
        const closing = (m.vx * nx + m.vz * nz) * s;
        if (!m.car || m.speed < 8 || closing < 6 || m.rammedT < (m.spec.side === 'them' ? 1.4 : 0.6)) continue;
        const dmg = closing * (m.spec.side === 'them' ? 0.6 * m.scale : 1.7) * m.power; // (theirs hurt less: there are more of them)
        m.rammedT = 0;
        this.hurt(o, dmg, m, nx * s * closing * 0.6, nz * s * closing * 0.6);
        this.hurt(m, dmg * 0.12, null);
        m.speed *= 0.55;
        this.events.push({ t: 'ram', bot: o, by: m, dmg });
      }
    }
  }

  // --- shots in flight -------------------------------------------------------------------------------------
  private fly(dt: number) {
    const keep: Shot[] = [];
    const shields = this.humans.filter((b) => b.alive && b.shieldT > 0);
    for (const s of this.shots) {
      const ax = s.x, az = s.z;
      if (s.kind === 'missile') { // (curls round towards its target, faster as it goes)
        const t = s.homing && s.homing.alive ? s.homing : null;
        const sp = Math.min(48, Math.hypot(s.vx, s.vz) + 30 * dt);
        let a = Math.atan2(s.vx, s.vz);
        if (t) a += clamp(angle(Math.atan2(t.x - s.x, t.z - s.z) - a), -4 * dt, 4 * dt);
        s.vx = Math.sin(a) * sp; s.vz = Math.cos(a) * sp;
        if (t) s.y += ((t.spec.height * 0.5) - s.y) * Math.min(1, dt * 2);
      }
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      let done = false;
      // the enemy's shots stop at a shield
      if (s.from.spec.side === 'them' && shields.some((b) => Math.hypot(s.x - b.x, s.z - b.z) < SHIELD_R)) {
        this.events.push({ t: 'block', x: s.x, z: s.z, y: s.y });
        continue;
      }
      const rock = s.kind === 'missile' ? null : blocked(this.arena, ax, az, s.x, s.z);
      for (const o of this.bots) {
        if (done || !o.alive || o.spec.side === s.from.spec.side) continue;
        if (segDist(ax, az, s.x, s.z, o.x, o.z) < o.r + 0.25) {
          if (!s.splash) this.hurt(o, s.dmg, s.from, s.vx * 0.02, s.vz * 0.02);
          this.events.push({ t: 'hit', x: s.x, z: s.z, y: s.y, bot: o, dmg: s.dmg });
          done = true;
        }
      }
      if (!done && rock) { this.events.push({ t: 'hit', x: s.x, z: s.z, y: s.y, bot: null, dmg: 0 }); done = true; }
      if (s.splash && (done || s.life <= 0)) this.explode(s);
      if (!done && s.life > 0) keep.push(s);
    }
    this.shots = keep;
  }

  private explode(s: Shot) {
    this.events.push({ t: 'boom', x: s.x, z: s.z, r: s.splash });
    for (const o of this.bots) {
      if (!o.alive || o.spec.side === s.from.spec.side) continue;
      if (o.spec.side === 'us' && o.shieldT > 0) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z) - o.r;
      if (d < s.splash) this.hurt(o, s.dmg * (1 - Math.max(0, d) / s.splash * 0.6), s.from, ((o.x - s.x) / (d + 1)) * 6, ((o.z - s.z) / (d + 1)) * 6);
    }
  }

  // --- scrap: what wrecks leave, picked up by driving or walking over it --------------------------------
  private pickups(dt: number) {
    for (const p of this.drops) p.life -= dt;
    for (const b of this.humans) {
      if (!b.alive) continue;
      // a car out of the fight mends
      if (b.car && b.hurtT > REGEN_AFTER) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * REGEN * dt);
      for (const p of this.drops) {
        if (p.life > 0 && Math.hypot(p.x - b.x, p.z - b.z) < (b.car ? 4.5 : 3)) {
          b.scrap += Math.round(p.value); p.life = 0;
          this.events.push({ t: 'scrap', bot: b, value: Math.round(p.value) });
        }
      }
    }
    this.drops = this.drops.filter((p) => p.life > 0);
  }

  // --- waves -------------------------------------------------------------------------------------------------
  private waves(dt: number) {
    if (this.over) return;
    if (this.humans.every((b) => !b.alive)) { this.over = true; this.events.push({ t: 'over' }); return; }
    if (this.resting) {
      this.breakT -= dt;
      if (this.breakT <= 0) { this.resting = false; this.startWave(); }
      return;
    }
    if (this.wave === 0) { this.resting = true; return; }
    this.spawnT -= dt;
    // (they come in one at a time, and only so many at once: fewer in the early waves)
    const room = Math.min(MAX_ENEMIES, 5 + this.wave * 1.5 + this.humans.length);
    if (this.queue.length && this.spawnT <= 0 && this.foes.length < room) { this.spawnT = Math.max(0.45, 1.4 - this.wave * 0.1); this.spawn(this.queue.shift()!); }
    if (!this.queue.length && !this.foes.length) {
      this.events.push({ t: 'cleared', n: this.wave });
      this.resting = true;
      this.breakT = 7;
      for (const b of this.humans) if (b.down) { b.down = false; b.hp = b.maxHp * 0.5; } // (back up for the next one)
      this.bots = this.bots.filter((b) => !b.dead);
    }
  }

  // Wave n: more of them each time, more for more of us; troopers from the start, brutes from the third,
  // lancers from the fourth, and every fifth the Hauler, with a few scouts round it
  private startWave() {
    this.wave++;
    const boss = this.wave % 5 === 0, w = this.wave, players = this.humans.length;
    const n = Math.round((5 + w * 2.6) * (0.7 + 0.3 * players) * (boss ? 0.5 : 1));
    const share = (k: number) => Math.round(n * k);
    const brutes = w >= 3 ? share(Math.min(0.2, 0.05 + w * 0.02)) : 0, lancers = w >= 4 ? share(Math.min(0.18, w * 0.025)) : 0;
    const troopers = Math.min(n - 1 - brutes - lancers, share(Math.min(0.5, 0.3 + w * 0.05)));
    const list: Foe[] = [...Array(Math.max(0, troopers)).fill('trooper'), ...Array(brutes).fill('brute'), ...Array(lancers).fill('lancer')];
    while (list.length < n) list.push('scout');
    this.queue = shuffle(list);
    if (boss) this.queue.unshift('hauler');
    this.spawnT = 0;
    this.events.push({ t: 'wave', n: this.wave, boss });
  }

  // In at the edge, as far from us as it gets, driving
  private spawn(kind: Foe) {
    const list = this.enemies[kind], spec = { ...list[Math.floor(Math.random() * list.length)] };
    spec.id = `${kind}-${this.wave}-${Math.random().toString(36).slice(2, 7)}`;
    const players = this.humans.length, hp = ENEMY[kind].hp * this.level.tough * (1 + (this.wave - 1) * 0.06) * (kind === 'hauler' ? 0.6 + 0.4 * players : 1);
    const b = new Bot(spec, hp);
    const us = this.humans.filter((h) => h.alive);
    const far = (p: [number, number]) => Math.min(...us.map((h) => Math.hypot(h.x - p[0], h.z - p[1])));
    const options = [...this.arena.spawns].sort((a, c) => far(c) - far(a)).slice(0, 4);
    const [x, z] = options[Math.floor(Math.random() * options.length)];
    b.x = x; b.z = z; b.yaw = Math.atan2(-x, -z); b.speed = 12;
    this.bots.push(b);
  }

  // --- the enemy's minds ---------------------------------------------------------------------------------------
  private ai(b: Bot, dt: number) {
    b.think -= dt;
    const us = this.humans.filter((h) => h.alive);
    if (!us.length) { b.ctl = idle(); return; }
    const t = us.reduce((m, h) => (Math.hypot(h.x - b.x, h.z - b.z) < Math.hypot(m.x - b.x, m.z - b.z) ? h : m));
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz) || 1e-6;
    const c = b.ctl, kind = b.spec.kind as Foe, e = ENEMY[kind];
    c.fire = false;
    if (kind === 'scout') {
      // a scout: a car that runs at you, rams, carries on past, and comes round again
      if (b.rammedT < 1.1) { c.x = Math.sin(b.yaw); c.z = Math.cos(b.yaw); }
      else { const lead = Math.min(1, d / 30); c.x = dx + t.vx * lead; c.z = dz + t.vz * lead; }
    } else {
      // the rest drive in, stand up within range and fight; drive off again if you get away. Troopers and
      // lancers keep their distance and shoot, side-stepping; brutes walk right up and punch; the Hauler
      // lumbers in, fires volleys of shells, and stamps the ground when you're close.
      const standAt = kind === 'brute' ? 14 : kind === 'hauler' ? 40 : e.far + 8;
      if (b.target === 0 && d < standAt && !b.changing) c.shift = true;
      if (b.target === 1 && b.robot && d > standAt + 25) c.shift = true;
      if (b.target === 0) { c.x = dx; c.z = dz; }
      else {
        if (b.think <= 0) { b.think = 1.5 + Math.random() * 2; if (Math.random() < 0.4) b.strafe *= -1; }
        // (can't see you from here? come closer, round whatever's in the way)
        const seen = kind === 'brute' || this.sees(b, t, 80);
        const want = !seen ? 1 : d > e.far ? 1 : d < e.near ? -1 : 0, side = kind === 'brute' ? 0.15 : seen ? 0.6 : 1;
        c.x = (dx / d) * want + (dz / d) * b.strafe * side;
        c.z = (dz / d) * want - (dx / d) * b.strafe * side;
        const facing = Math.abs(angle(Math.atan2(dx, dz) - b.yaw)) < 0.5;
        if (kind === 'brute') c.punch = d < b.r + t.r + 2.2 && facing;
        else c.fire = this.sees(b, t, kind === 'lancer' ? 75 : 55) && facing;
        if (kind === 'hauler' && d < 9 * b.scale && b.stompCd <= 0) { b.stompCd = 4.5; this.shockwave(b, 9 * b.scale, 26, 14, 0.9); }
      }
    }
    // stuck against a rock as a car? turn off to one side for a moment to get free
    b.stuckT = b.target === 0 && b.speed < 3 ? b.stuckT + dt : 0;
    b.escapeT -= dt;
    if (b.stuckT > 0.7) { b.escapeT = 1.2; b.stuckT = 0; b.strafe *= -1; }
    if (b.target === 0 && b.escapeT > 0) { c.x = (dz / d) * b.strafe; c.z = -(dx / d) * b.strafe; }
    // steer round rocks, and away from each other
    let ax = 0, az = 0;
    for (const r of this.arena.rocks) {
      const [px, pz] = nearest(r, b.x, b.z), rx = b.x - px, rz = b.z - pz, dd = Math.hypot(rx, rz) || 1e-6, rd = dd - b.r;
      if (rd < 5) { ax += (rx / dd) * (5 - rd) * 0.6; az += (rz / dd) * (5 - rd) * 0.6; }
    }
    for (const o of this.bots) {
      if (o === b || o.spec.side !== 'them' || !o.alive) continue;
      const ox = b.x - o.x, oz = b.z - o.z, od = Math.hypot(ox, oz);
      if (od < 6 && od > 0) { ax += (ox / od) * (6 - od) * 0.3; az += (oz / od) * (6 - od) * 0.3; }
    }
    const len = Math.hypot(c.x, c.z) || 1;
    c.x = c.x / len + ax * 0.2; c.z = c.z / len + az * 0.2;
    const l2 = Math.hypot(c.x, c.z);
    if (l2 > 1) { c.x /= l2; c.z /= l2; }
  }
}

// Where a robot's gun is when it's aiming: the right arm held out ahead at shoulder height
export function gun(b: Bot): [number, number, number] {
  const h = b.spec.height * b.scale, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  return [b.x + fx * 0.45 * h - fz * 0.2 * h, 0.74 * h, b.z + fz * 0.45 * h + fx * 0.2 * h];
}

// --- helpers -----------------------------------------------------------------------------------------------------
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
export const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
function shuffle<T>(list: T[]) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
