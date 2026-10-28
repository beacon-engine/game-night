// The rules of Fireteam, with no graphics or sound: soldiers and their weapons (a rifle, a pistol to
// swap to, a knife at arm's length, grenades), shooting (whether a shot hits depends on the range,
// cover, stance, movement, nerve and the dark), the squads and their orders, the enemy's tactics and
// flares, the pilot to rescue, the helicopter, and the mission's steps. main.ts runs it, scene.ts draws
// it; what happens is reported as events.
import { Gun } from '@armoury/armoury.ts';
import { Goal, Grid, LZ, MAP, MISSION, PILOT, START, type Step } from './map.ts';

export const TICK = 1 / 30;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export enum Side { Allies = 'allies', Axis = 'axis' }
export enum Order { Follow = 'follow', Hold = 'hold', Assault = 'assault' }
export enum Life { Fine = 'fine', Down = 'down', Dead = 'dead' }

export const ORDER_NAME: Record<Order, string> = { [Order.Follow]: 'Follow me', [Order.Hold]: 'Hold here', [Order.Assault]: 'Assault' };
const ORDERS = [Order.Follow, Order.Hold, Order.Assault];

// --- weapons ------------------------------------------------------------------------------------------
export interface Weapon {
  gun: Gun;
  name: string;
  damage: number; // per hit (each pellet, for a shotgun)
  pellets: number;
  range: number; // m it's good to
  accuracy: number; // chance to hit a standing man in the open, aimed, at short range
  every: number; // s between shots
  auto: boolean; // keeps firing while held
  mag: number;
  reload: number; // s
}

export const WEAPONS: Record<Gun, Weapon> = {
  [Gun.Rifle]: { gun: Gun.Rifle, name: 'Rifle', damage: 75, pellets: 1, range: 70, accuracy: 0.85, every: 1.0, auto: false, mag: 5, reload: 2.6 },
  [Gun.Assault]: { gun: Gun.Assault, name: 'Assault rifle', damage: 26, pellets: 1, range: 45, accuracy: 0.55, every: 0.11, auto: true, mag: 30, reload: 2.3 },
  [Gun.Sniper]: { gun: Gun.Sniper, name: 'Sniper rifle', damage: 140, pellets: 1, range: 110, accuracy: 0.95, every: 1.5, auto: false, mag: 5, reload: 3 },
  [Gun.Shotgun]: { gun: Gun.Shotgun, name: 'Shotgun', damage: 16, pellets: 8, range: 16, accuracy: 0.6, every: 0.85, auto: false, mag: 6, reload: 3.2 },
  [Gun.Pistol]: { gun: Gun.Pistol, name: 'Pistol', damage: 32, pellets: 1, range: 25, accuracy: 0.6, every: 0.28, auto: false, mag: 7, reload: 1.6 },
  [Gun.MachinePistol]: { gun: Gun.MachinePistol, name: 'Machine pistol', damage: 24, pellets: 1, range: 30, accuracy: 0.5, every: 0.14, auto: true, mag: 10, reload: 2 },
  [Gun.Carbine]: { gun: Gun.Carbine, name: 'M4 carbine', damage: 30, pellets: 1, range: 55, accuracy: 0.62, every: 0.085, auto: true, mag: 30, reload: 2.2 },
  [Gun.Ak]: { gun: Gun.Ak, name: 'AK', damage: 32, pellets: 1, range: 50, accuracy: 0.55, every: 0.1, auto: true, mag: 30, reload: 2.5 },
  [Gun.Knife]: { gun: Gun.Knife, name: 'Knife', damage: 999, pellets: 1, range: 1.8, accuracy: 1, every: 1, auto: false, mag: 1, reload: 0 },
  [Gun.Launcher]: { gun: Gun.Launcher, name: 'RPG', damage: 140, pellets: 1, range: 60, accuracy: 0.5, every: 3, auto: false, mag: 1, reload: 4 },
};
// What a player can choose to carry (everyone also has a pistol, a knife and grenades)
export const LOADOUTS = [Gun.Carbine, Gun.Shotgun, Gun.Sniper];
export const SIDEARM = Gun.Pistol;

// How a shot's chances change: farther (past the gun's range, quickly worse), crouched, behind low
// cover, the shooter moving or pinned down, how long he's been aiming at this man
const HIT = { far: 0.6, beyond: 2.5, crouched: 0.7, covered: 0.22, moving: 0.55, pinned: 0.6, aimTime: 0.8, firstShot: 0.55 };
// The computer is a worse shot than a player and slower to settle on someone, and the players' side
// takes less from each hit: a couch game, where a careless run costs you, but not in a second
const FAIR = { aim: 0.38, aimTime: 1.8, ours: 0.55, mates: 0.75, notice: 45, grace: 3, waves: { base: 0.42, perHuman: 0.25 }, posts: { base: 0.55, perHuman: 0.15 } };
const NERVE = { nearMiss: 0.18, hit: 0.5, recover: 0.35, pinned: 0.6, whizz: 2.2 }; // suppression: what adds to it, how fast it fades, when you're pinned, how near a miss counts

const SOLDIER = {
  hp: 100, run: 4.4, sprint: 6.0, walk: 2.0, crouch: 1.5, r: 0.4, turn: 8,
  bleed: 30, revive: 3, reviveReach: 1.6, regenAfter: 5, regen: 18, grenades: 3, aimCone: 1.2, see: 60,
  swap: 0.7, // s to change between the rifle and the pistol
};
const KNIFE = { reach: 1.8, cone: 0.7, every: 1.1 }; // m, rad either side, s between strikes
// The dark: the enemy (no night vision) sees a man only this much as far, unless he's just fired
// (his muzzle flash gives him away) or he's under a flare
const DARK = { notice: 0.45, flash: 2.5 };
const FLARE = { burn: 24, rise: 55, fall: 1.6, light: 40, every: 40 }; // s, m up, m/s down, m it lights, s between flares
const HELO = { approach: 22 }; // s before the hold ends that it's heard coming
const GRENADE = { fuse: 2.8, radius: 6.5, damage: 140, throwSpeed: 13, far: 22, near: 6, every: 14, chance: 0.15 };
const CHARGE = { set: 3 }; // s to set the charge on the gun
const AI = { think: 0.35, leash: 12, follow: 6, assaultStep: 12, reviveFrom: 15, advanceAfter: 6 };

// --- soldiers -----------------------------------------------------------------------------------------------
export interface SoldierSpec { name: string; side: Side; gun: Gun; human?: string; cast: number; pilot?: boolean }

export class Soldier {
  x = 0; z = 0; vx = 0; vz = 0;
  facing = 0; // rad, 0 = north (-z), clockwise looking down
  hp = SOLDIER.hp;
  life = Life.Fine;
  crouched = false;
  weapon: Weapon; // in his hands now (the rifle, or the pistol)
  ammo: number;
  readonly arms: { weapon: Weapon; ammo: number }[]; // what he carries: his rifle and his pistol
  using = 0; // which of them
  swapT = 0; // s left changing over
  knifeT = 0; // s till he can strike again
  flashT = 99; // s since he last fired (his muzzle flash shows in the dark)
  captive = false; // the pilot, before he's found
  reloadT = 0;
  fireT = 0;
  aimT = 0; // s aimed at the current target
  target: Soldier | null = null;
  suppression = 0;
  downT = 0; // s left to bleed out
  reviveT = 0;
  grenades = SOLDIER.grenades;
  grenadeT = 0; // s till the computer may throw another
  hurtT = 99; // s since last hit
  // a human's wishes this tick
  moveX = 0; moveZ = 0; sprint = false; firing = false; throwNow = false; reloadNow = false; useHeld = false; swapNow = false;
  // the computer's
  path: { x: number; z: number }[] | null = null;
  goal: { x: number; z: number } | null = null;
  post: { x: number; z: number } | null = null; // an enemy's position to defend
  thinkT = Math.random() * AI.think;
  unseenT = 0;
  order = Order.Follow; // a human leader's orders to his squad
  leader: Soldier | null = null; // a squad-mate's human
  chargeT = 0; // s spent setting a charge
  shotsFired = 0;
  kills = 0;
  constructor(readonly id: number, readonly spec: SoldierSpec) {
    this.arms = [{ weapon: WEAPONS[spec.gun], ammo: WEAPONS[spec.gun].mag }];
    if (spec.side === Side.Allies && !spec.pilot) this.arms.push({ weapon: WEAPONS[SIDEARM], ammo: WEAPONS[SIDEARM].mag });
    this.weapon = this.arms[0].weapon;
    this.ammo = this.arms[0].ammo;
  }
  get pilot() { return !!this.spec.pilot; }
  get pistol() { return this.weapon.gun === Gun.Pistol; }
  get side() { return this.spec.side; }
  get human() { return this.spec.human ?? null; }
  get alive() { return this.life === Life.Fine; }
  get moving() { return Math.hypot(this.vx, this.vz) > 0.4; }
}

export interface Grenade { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; owner: Soldier }

export type SimEvent =
  | { type: 'shot'; from: Soldier; to: { x: number; z: number; y: number }; hit: Soldier | null }
  | { type: 'whizz'; at: Soldier } // a near miss on a human
  | { type: 'hurt'; who: Soldier; by: Soldier | null }
  | { type: 'down'; who: Soldier }
  | { type: 'dead'; who: Soldier; by: Soldier | null }
  | { type: 'revived'; who: Soldier; by: Soldier }
  | { type: 'throw'; who: Soldier }
  | { type: 'bang'; x: number; z: number }
  | { type: 'reload'; who: Soldier }
  | { type: 'order'; leader: Soldier; order: Order }
  | { type: 'step'; index: number } // a new step of the mission begins
  | { type: 'done'; index: number } // a step is done
  | { type: 'blown' } // the charge went off: the gun is gone
  | { type: 'stab'; who: Soldier; target: Soldier } // a knife at arm's length
  | { type: 'swap'; who: Soldier } // rifle to pistol, or back
  | { type: 'flare'; flare: Flare } // the enemy sends up a flare
  | { type: 'rescued'; by: Soldier } // the pilot is ours
  | { type: 'helo'; phase: HeloPhase } // the helicopter: coming in, down, away
  | { type: 'won' }
  | { type: 'failed'; why: 'down' | 'pilot' }; // every human is down, or the pilot is dead

export interface Flare { x: number; y: number; z: number; t: number }
export type HeloPhase = 'away' | 'inbound' | 'landed' | 'leaving';

export class Sim {
  readonly grid = new Grid();
  soldiers: Soldier[] = [];
  grenades: Grenade[] = [];
  events: SimEvent[] = [];
  step = 0;
  stepT = 0;
  held = 0; // s the ground's been held (a hold step)
  waves = 0; // waves sent (a hold step)
  won = false;
  failed = false;
  t = 0;
  flares: Flare[] = [];
  flareT = 0; // s till the enemy may send up another
  helo: HeloPhase = 'away';
  heloT = 0; // s in this phase
  pilot: Soldier | null = null;
  private nextId = 1;

  constructor(humans: { id: string; name: string; gun: Gun; cast: number }[], readonly mates: number, startAt = 0) {
    const names = SQUAD_NAMES.slice();
    const from = MISSION[startAt]?.checkpoint ?? START; // (starting part-way: at that step's checkpoint)
    humans.forEach((h, i) => {
      const lead = this.add({ name: h.name, side: Side.Allies, gun: h.gun, human: h.id, cast: h.cast }, from.x + (i - (humans.length - 1) / 2) * 4, from.z);
      for (let m = 0; m < mates; m++) {
        const s = this.add({ name: names.shift() ?? 'Private', side: Side.Allies, gun: m === 2 ? Gun.Sniper : Gun.Carbine, cast: (h.cast + 1 + m) % 8 }, lead.x + (m % 2 ? -1 : 1) * (2 + Math.floor(m / 2) * 1.5), lead.z + 0.5 + m);
        s.leader = lead;
      }
    });
    // the pilot: held at the farm, or (starting after his rescue) with the first of us
    const rescued = startAt > MISSION.findIndex((st) => st.goal === Goal.Rescue);
    const first = this.humans[0];
    const p = this.add({ name: 'Reyes', side: Side.Allies, gun: Gun.Pistol, cast: 5, pilot: true }, rescued && first ? first.x + 1.5 : PILOT.x, rescued && first ? first.z + 2 : PILOT.z);
    p.captive = !rescued;
    p.leader = rescued ? first ?? null : null;
    p.crouched = !rescued;
    this.pilot = p;
    this.begin(startAt);
  }

  get humans() { return this.soldiers.filter((s) => s.human); }
  get current(): Step | null { return MISSION[this.step] ?? null; }
  // How dark it is now (1: night, 0: day): a hold brings the dawn
  get dark() {
    const st = this.current;
    if (!st) return 0.3;
    return st.dawn !== undefined ? st.dark + (st.dawn - st.dark) * Math.min(1, this.held / (st.hold ?? 60)) : st.dark;
  }
  axisAlive() { return this.soldiers.filter((s) => s.side === Side.Axis && s.alive); }

  add(spec: SoldierSpec, x: number, z: number) {
    const s = new Soldier(this.nextId++, spec);
    s.x = x; s.z = z;
    s.facing = spec.side === Side.Allies ? 0 : Math.PI;
    this.soldiers.push(s);
    return s;
  }

  // A step of the mission begins: its enemies take their posts
  private begin(index: number) {
    this.step = index;
    this.stepT = 0;
    this.held = 0;
    this.waves = 0;
    const st = this.current;
    if (!st) return;
    // fewer of them for a smaller crew (the posts that matter most are listed first)
    const n = Math.max(3, Math.round(st.enemies.length * (FAIR.posts.base + FAIR.posts.perHuman * this.humans.length)));
    st.enemies.slice(0, n).forEach((p, i) => this.enemy(p.x, p.z, i));
    this.events.push({ type: 'step', index });
  }

  private enemy(x: number, z: number, i: number, wave = false) {
    // (never inside a tree or a hedge: the nearest open ground)
    for (let r = 0; !this.free(x, z) && r < 6; r += 0.5) {
      const a = Math.random() * Math.PI * 2;
      if (this.free(x + Math.cos(a) * r, z + Math.sin(a) * r)) { x += Math.cos(a) * r; z += Math.sin(a) * r; }
    }
    const guns = [Gun.Ak, Gun.Ak, Gun.Ak, Gun.Sniper, Gun.Ak, Gun.Ak];
    const s = this.add({ name: AXIS_NAMES[i % AXIS_NAMES.length], side: Side.Axis, gun: guns[i % guns.length], cast: i % 8 }, x, z);
    s.post = wave ? null : { x, z };
    s.crouched = !wave;
    return s;
  }

  // Back to the start of this step (after everyone went down): the fallen up again at the checkpoint
  retry() {
    this.failed = false;
    this.soldiers = this.soldiers.filter((s) => s.side === Side.Allies);
    this.grenades = [];
    this.flares = [];
    const st = this.current!;
    this.regroup(st.checkpoint);
    this.begin(this.step);
  }

  // Everyone on our side back on their feet at the checkpoint, with grenades
  private regroup(at: { x: number; z: number }) {
    for (const s of this.soldiers) {
      if (s.side !== Side.Allies) continue;
      const lead = s.leader ?? s;
      const hi = this.humans.indexOf(lead);
      s.life = Life.Fine; s.hp = SOLDIER.hp; s.grenades = Math.max(s.grenades, SOLDIER.grenades); s.suppression = 0; s.downT = 0;
      for (const a of s.arms) a.ammo = a.weapon.mag;
      s.ammo = s.arms[s.using].ammo;
      if (s.captive) continue; // (still where they hold him)
      if (Math.hypot(s.x - at.x, s.z - at.z) > 25) {
        s.x = at.x + (hi - (this.humans.length - 1) / 2) * 4 + rand(-1.5, 1.5);
        s.z = at.z + rand(0, 3);
      }
      s.path = null; s.goal = null;
    }
  }

  // A player joins mid-mission: a soldier (and his squad) at the checkpoint
  join(h: { id: string; name: string; gun: Gun; cast: number }) {
    const at = this.current?.checkpoint ?? START;
    const lead = this.add({ name: h.name, side: Side.Allies, gun: h.gun, human: h.id, cast: h.cast }, at.x, at.z);
    for (let m = 0; m < this.mates; m++) {
      const s = this.add({ name: SQUAD_NAMES[(this.soldiers.length + m) % SQUAD_NAMES.length], side: Side.Allies, gun: Gun.Carbine, cast: (h.cast + 1 + m) % 8 }, at.x + m, at.z + 2);
      s.leader = lead;
    }
    return lead;
  }
  leave(id: string) {
    const h = this.soldiers.find((s) => s.human === id);
    if (!h) return;
    // his squad goes on with whoever's left (or holds), and he's out of the fight
    const other = this.humans.find((s) => s !== h);
    for (const s of this.soldiers) if (s.leader === h) s.leader = other ?? null;
    this.soldiers = this.soldiers.filter((s) => s !== h);
  }

  // --- the tick -------------------------------------------------------------------------------------------------
  stepTick() {
    this.events = [];
    if (this.won || this.failed) return;
    this.t += TICK;
    this.stepT += TICK;
    for (const s of this.soldiers) {
      if (s.life === Life.Dead) continue;
      if (s.life === Life.Down) { this.bleed(s); continue; }
      if (s.human) this.humanTick(s);
      else if (s.pilot) this.pilotTick(s);
      else this.aiTick(s);
      if (!s.pilot) this.weaponTick(s);
      this.move(s);
      s.suppression = Math.max(0, s.suppression - NERVE.recover * TICK);
      s.hurtT += TICK;
      if (s.human && s.hurtT > SOLDIER.regenAfter) s.hp = Math.min(SOLDIER.hp, s.hp + SOLDIER.regen * TICK);
    }
    this.moveGrenades();
    this.moveFlares();
    this.revives();
    this.objective();
    this.heloTick();
    // failed: every human down and nobody on our side left standing to help them up (or all bled out);
    // or the pilot dead
    const humans = this.humans;
    const helpers = this.soldiers.some((s) => s.side === Side.Allies && s.alive && !s.pilot);
    if (this.pilot?.life === Life.Dead) {
      this.failed = true;
      this.events.push({ type: 'failed', why: 'pilot' });
    } else if (humans.length && humans.every((s) => s.life !== Life.Fine) && (!helpers || humans.every((s) => s.life === Life.Dead))) {
      this.failed = true;
      this.events.push({ type: 'failed', why: 'down' });
    }
  }

  // --- what a human wants --------------------------------------------------------------------------------------
  private humanTick(s: Soldier) {
    const m = Math.hypot(s.moveX, s.moveZ);
    // aim: the nearest enemy he can see, roughly the way he's going or facing (and stick with him)
    const want = m > 0.2 ? Math.atan2(s.moveX, -s.moveZ) : s.facing;
    if (!s.target || !s.target.alive || !this.canSee(s, s.target) || Math.abs(angDiff(this.bearing(s, s.target), want)) > SOLDIER.aimCone * 1.4) {
      s.target = this.pickTarget(s, want, SOLDIER.aimCone);
      s.aimT = 0;
    }
    const face = s.target && (s.firing || m < 0.2) ? this.bearing(s, s.target) : m > 0.2 ? want : s.facing;
    s.facing += clamp(angDiff(face, s.facing), -SOLDIER.turn * TICK, SOLDIER.turn * TICK);
    if (s.target) s.aimT += TICK;
    if (s.throwNow) this.throwGrenade(s, s.target ?? null);
    if (s.reloadNow) this.startReload(s);
    if (s.swapNow) this.swap(s);
    s.throwNow = s.reloadNow = s.swapNow = false;
  }

  // R1: rifle to pistol (quicker to bring round, close in), or back
  private swap(s: Soldier) {
    if (s.arms.length < 2 || s.swapT > 0) return;
    s.arms[s.using].ammo = s.ammo;
    s.using = 1 - s.using;
    s.weapon = s.arms[s.using].weapon;
    s.ammo = s.arms[s.using].ammo;
    s.reloadT = 0;
    s.swapT = SOLDIER.swap * (s.pistol ? 0.7 : 1);
    this.events.push({ type: 'swap', who: s });
  }

  // The pilot: sits where they hold him till someone gets to him, then stays with that man, keeping low
  private pilotTick(s: Soldier) {
    if (s.captive) { s.moveX = s.moveZ = 0; return; }
    s.thinkT -= TICK;
    if (s.thinkT <= 0) {
      s.thinkT = AI.think;
      const lead = s.leader && s.leader.life !== Life.Dead ? s.leader : this.humans.find((h) => h.life !== Life.Dead) ?? null;
      s.leader = lead;
      if (lead) {
        const d = Math.hypot(lead.x - s.x, lead.z - s.z);
        if (d > 3.5 && (!s.goal || Math.hypot(s.goal.x - lead.x, s.goal.z - lead.z) > 3)) this.setGoal(s, this.coverNear(lead.x, lead.z, 3, s) ?? { x: lead.x, z: lead.z + 1.5 });
        else if (d < 2) { s.goal = null; s.path = null; }
      }
      const danger = this.soldiers.some((e) => e.side === Side.Axis && e.alive && Math.hypot(e.x - s.x, e.z - s.z) < 25);
      s.crouched = danger;
    }
    this.followPath(s);
  }

  // Leaf: crouch (a tap), or set the charge (held beside the gun)
  toggleCrouch(s: Soldier) { s.crouched = !s.crouched; }
  cycleOrder(s: Soldier) {
    s.order = ORDERS[(ORDERS.indexOf(s.order) + 1) % ORDERS.length];
    for (const m of this.soldiers) if (m.leader === s) { m.goal = null; m.path = null; m.thinkT = 0; }
    this.events.push({ type: 'order', leader: s, order: s.order });
  }

  // --- the computer ----------------------------------------------------------------------------------------------
  private aiTick(s: Soldier) {
    // between decisions, just keep facing the target and going where it was going
    s.thinkT -= TICK;
    if (s.target && s.target.alive) {
      s.facing += clamp(angDiff(this.bearing(s, s.target), s.facing), -SOLDIER.turn * TICK, SOLDIER.turn * TICK);
      s.aimT += TICK;
    }
    if (s.thinkT > 0) { this.followPath(s); return; }
    s.thinkT = AI.think * rand(0.8, 1.2);
    // who to fight
    const t = this.pickTarget(s, s.facing, Math.PI);
    if (t !== s.target) { s.target = t; s.aimT = 0; }
    // in the dark, the first of them to see us sends up a flare
    if (t && s.side === Side.Axis && this.dark > 0.5 && this.flareT <= 0) {
      this.flareT = FLARE.every;
      const f = { x: (s.x + t.x) / 2 + rand(-6, 6), y: 2, z: (s.z + t.z) / 2 + rand(-6, 6), t: FLARE.burn };
      this.flares.push(f);
      this.events.push({ type: 'flare', flare: f });
    }
    s.unseenT = t ? 0 : s.unseenT + AI.think;
    s.firing = !!t && s.suppression < NERVE.pinned + 0.2 && s.reloadT <= 0 && (s.side === Side.Allies || this.stepT > FAIR.grace);
    // pinned: get down
    if (s.suppression > NERVE.pinned) { s.crouched = true; s.firing = Math.random() < 0.3 && !!t; }
    // a grenade at someone hiding behind low cover
    s.grenadeT -= AI.think;
    if (t && s.grenades > 0 && s.grenadeT <= 0) {
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      if (d > GRENADE.near && d < GRENADE.far && t.crouched && Math.random() < GRENADE.chance) { this.throwGrenade(s, t); s.grenadeT = GRENADE.every; }
    }
    if (s.side === Side.Axis) this.axisMove(s, t);
    else this.mateMove(s, t);
    if (!s.path && s.goal && Math.hypot(s.goal.x - s.x, s.goal.z - s.z) > 1.2) s.path = this.grid.path(s.x, s.z, s.goal.x, s.goal.z);
    this.followPath(s);
  }

  // The enemy: hold your post; if you can't see anyone for a while, push a little toward where they
  // are; counter-attacks (no post) come on to the ground they want back
  private axisMove(s: Soldier, t: Soldier | null) {
    const st = this.current;
    if (!s.post) {
      const at = st?.at ?? { x: 0, z: 0 };
      if (!t || Math.hypot(at.x - s.x, at.z - s.z) > 16) {
        if (!s.goal || Math.random() < 0.15) this.setGoal(s, this.coverNear(at.x, at.z, 14, s) ?? at);
      } else if (s.goal && Math.random() < 0.2) s.goal = null; // (stop and fight)
      s.crouched = !!t && Math.random() < 0.6;
      return;
    }
    if (t) { s.crouched = Math.random() < 0.75; return; }
    if (s.unseenT > AI.advanceAfter) {
      const foe = this.nearest(s, Side.Allies);
      if (foe) {
        const k = Math.min(1, AI.leash / Math.max(1, Math.hypot(foe.x - s.post.x, foe.z - s.post.z)));
        const c = this.coverNear(s.post.x + (foe.x - s.post.x) * k * 0.6, s.post.z + (foe.z - s.post.z) * k * 0.6, 5, s);
        if (c) this.setGoal(s, c);
        s.unseenT = 0;
      }
    } else if (!s.goal) this.setGoal(s, s.post);
  }

  // A squad-mate: do as the leader says
  private mateMove(s: Soldier, t: Soldier | null) {
    const lead = s.leader;
    // help a fallen human up, if it's safe enough
    const down = this.soldiers.find((q) => q.side === s.side && q.life === Life.Down && Math.hypot(q.x - s.x, q.z - s.z) < AI.reviveFrom);
    if (down && !this.soldiers.some((e) => e.side !== s.side && e.alive && Math.hypot(e.x - down.x, e.z - down.z) < 8)) {
      this.setGoal(s, down, 0.2);
      s.crouched = false;
      return;
    }
    if (!lead) { if (!s.goal) this.setGoal(s, { x: s.x, z: s.z }); return; }
    if (lead.order === Order.Hold) {
      if (!s.goal) this.setGoal(s, this.coverNear(s.x, s.z, 4, s) ?? { x: s.x, z: s.z });
      s.crouched = true;
    } else if (lead.order === Order.Follow) {
      const far = !s.goal || Math.hypot(s.goal.x - lead.x, s.goal.z - lead.z) > AI.follow;
      if (far) this.setGoal(s, this.coverNear(lead.x, lead.z, AI.follow, s) ?? { x: lead.x + rand(-2, 2), z: lead.z + rand(1, 3) });
      s.crouched = !!t || lead.crouched;
    } else {
      // assault: cover by cover toward the enemy nearest the leader
      const foe = this.nearest(lead, Side.Axis);
      if (foe && (!s.goal || Math.hypot(s.goal.x - s.x, s.goal.z - s.z) < 1.5)) {
        const d = Math.hypot(foe.x - s.x, foe.z - s.z);
        const k = Math.min(1, AI.assaultStep / Math.max(1, d));
        this.setGoal(s, this.coverNear(s.x + (foe.x - s.x) * k, s.z + (foe.z - s.z) * k, 5, s) ?? { x: s.x + (foe.x - s.x) * k, z: s.z + (foe.z - s.z) * k });
      }
      s.crouched = !!t && Math.random() < 0.5;
    }
  }

  private setGoal(s: Soldier, g: { x: number; z: number }, jitter = 0) {
    s.goal = { x: g.x + rand(-jitter, jitter), z: g.z + rand(-jitter, jitter) };
    s.path = this.grid.path(s.x, s.z, s.goal.x, s.goal.z);
  }

  private followPath(s: Soldier) {
    s.moveX = s.moveZ = 0;
    s.sprint = false;
    if (!s.path || !s.path.length) return;
    const p = s.path[0];
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { s.path.shift(); if (!s.path.length) s.path = null; return; }
    s.moveX = dx / d;
    s.moveZ = dz / d;
    s.sprint = !s.target && d > 3;
    if (!s.target) s.facing += clamp(angDiff(Math.atan2(dx, -dz), s.facing), -SOLDIER.turn * TICK, SOLDIER.turn * TICK);
  }

  // A free spot to take cover in, near (x, z), facing away from the enemy if it can
  private coverNear(x: number, z: number, r: number, s: Soldier) {
    let best: { x: number; z: number } | null = null, bs = Infinity;
    const foe = this.nearest(s, s.side === Side.Allies ? Side.Axis : Side.Allies);
    for (const c of this.grid.cover) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > r) continue;
      if (this.soldiers.some((q) => q !== s && q.alive && Math.hypot((q.goal?.x ?? q.x) - c.x, (q.goal?.z ?? q.z) - c.z) < 1.4)) continue;
      let sc = d + Math.random() * 1.5;
      if (foe) {
        const seen = this.grid.sight(foe.x, foe.z, c.x, c.z, true);
        sc += seen === 'blocked' ? -2 : seen === 'covered' ? -3 : 4; // (somewhere they can't hit you)
      }
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }

  // --- moving ---------------------------------------------------------------------------------------------------
  private move(s: Soldier) {
    const m = Math.min(1, Math.hypot(s.moveX, s.moveZ));
    const firing = s.firing && !!s.target;
    const speed = s.crouched ? SOLDIER.crouch : firing ? SOLDIER.walk : s.sprint ? SOLDIER.sprint : SOLDIER.run;
    const k = m > 0.05 ? speed / Math.max(m, 1) : 0;
    const want = { x: s.moveX * k, z: s.moveZ * k };
    s.vx += (want.x - s.vx) * Math.min(1, TICK * 10);
    s.vz += (want.z - s.vz) * Math.min(1, TICK * 10);
    // slide along whatever's in the way
    const nx = s.x + s.vx * TICK, nz = s.z + s.vz * TICK;
    if (this.free(nx, nz)) { s.x = nx; s.z = nz; }
    else if (this.free(nx, s.z)) { s.x = nx; s.vz *= 0.5; }
    else if (this.free(s.x, nz)) { s.z = nz; s.vx *= 0.5; }
    else { s.vx = s.vz = 0; s.path = null; }
    s.x = clamp(s.x, -MAP.w / 2 + 1, MAP.w / 2 - 1);
    s.z = clamp(s.z, -MAP.d / 2 + 1, MAP.d / 2 - 1);
  }

  private free(x: number, z: number) {
    const r = SOLDIER.r;
    return this.grid.walkable(x, z) && this.grid.walkable(x + r, z) && this.grid.walkable(x - r, z) && this.grid.walkable(x, z + r) && this.grid.walkable(x, z - r);
  }

  // --- shooting ----------------------------------------------------------------------------------------------------
  private weaponTick(s: Soldier) {
    s.fireT -= TICK;
    s.knifeT -= TICK;
    s.flashT += TICK;
    if (s.swapT > 0) { s.swapT -= TICK; return; }
    // the knife: anyone at arm's length in front of him, when he'd fire
    const t0 = s.target;
    if (s.firing && t0 && t0.alive && s.knifeT <= 0) {
      const d = Math.hypot(t0.x - s.x, t0.z - s.z);
      if (d < KNIFE.reach && Math.abs(angDiff(this.bearing(s, t0), s.facing)) < KNIFE.cone) {
        s.knifeT = KNIFE.every;
        s.fireT = KNIFE.every * 0.8;
        this.events.push({ type: 'stab', who: s, target: t0 });
        this.damage(t0, 999, s);
        return;
      }
    }
    if (s.knifeT > KNIFE.every - 0.6) return; // (still striking)
    if (s.reloadT > 0) {
      s.reloadT -= TICK;
      if (s.reloadT <= 0) s.ammo = s.weapon.mag;
      return;
    }
    if (!s.firing) { if (!s.human) s.shotsFired = 0; return; }
    if (s.ammo <= 0) { this.startReload(s); return; }
    if (s.fireT > 0) return;
    // a human's semi-automatic fires once per press: main.ts sets `firing` for one tick
    const aimAt = s.target;
    if (!aimAt && !s.human) return;
    if (aimAt && Math.abs(angDiff(this.bearing(s, aimAt), s.facing)) > 0.35) return; // (still turning to him)
    s.fireT = s.weapon.every * (s.human ? 1 : rand(1, 1.6));
    s.ammo--;
    s.shotsFired++;
    s.flashT = 0;
    for (let i = 0; i < s.weapon.pellets; i++) this.shoot(s, aimAt);
    if (s.ammo <= 0 && s.human) this.startReload(s);
  }

  private startReload(s: Soldier) {
    if (s.reloadT > 0 || s.ammo === s.weapon.mag || s.swapT > 0) return;
    s.reloadT = s.weapon.reload;
    this.events.push({ type: 'reload', who: s });
  }

  // One bullet: at the target if there is one, otherwise straight ahead
  private shoot(s: Soldier, t: Soldier | null) {
    const w = s.weapon;
    if (!t) {
      const far = Math.min(w.range, 40);
      const a = s.facing + rand(-0.05, 0.05);
      const end = this.rayEnd(s.x, s.z, s.x + Math.sin(a) * far, s.z - Math.cos(a) * far);
      this.events.push({ type: 'shot', from: s, to: { ...end, y: 1.2 }, hit: null });
      return;
    }
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    const view = this.grid.sight(s.x, s.z, t.x, t.z, t.crouched);
    let p = w.accuracy;
    p *= d < w.range * 0.3 ? 1 : d < w.range ? 1 - (1 - HIT.far) * ((d - w.range * 0.3) / (w.range * 0.7)) : HIT.far * Math.exp(-(d - w.range) / (w.range / HIT.beyond));
    if (t.crouched) p *= HIT.crouched;
    if (view === 'covered') p *= HIT.covered;
    if (s.moving) p *= HIT.moving;
    if (s.suppression > NERVE.pinned) p *= HIT.pinned;
    p *= HIT.firstShot + (1 - HIT.firstShot) * Math.min(1, s.aimT / (s.human ? HIT.aimTime : FAIR.aimTime));
    if (!s.human) p *= FAIR.aim;
    if (w.auto) p *= 1 - Math.min(0.4, s.shotsFired * 0.03); // (sprays as it climbs)
    if (view === 'blocked') p = 0;
    const hit = Math.random() < p;
    if (hit) {
      this.events.push({ type: 'shot', from: s, to: { x: t.x, z: t.z, y: t.crouched ? 0.8 : 1.3 }, hit: t });
      this.damage(t, w.damage * (d > w.range ? 0.7 : 1) * (t.human ? FAIR.ours : t.side === Side.Allies ? FAIR.mates : 1), s);
      t.suppression = Math.min(1, t.suppression + NERVE.hit);
    } else {
      // a miss: past him, into whatever's there
      const a = Math.atan2(t.x - s.x, -(t.z - s.z)) + rand(-0.06, 0.06) * (1 + d / 20);
      const end = this.rayEnd(s.x, s.z, s.x + Math.sin(a) * (d + 8), s.z - Math.cos(a) * (d + 8));
      this.events.push({ type: 'shot', from: s, to: { ...end, y: rand(0.2, 1.8) }, hit: null });
      // anyone it passed close to feels it
      for (const q of this.soldiers) {
        if (q.side === s.side || !q.alive) continue;
        if (distToSeg(q.x, q.z, s.x, s.z, end.x, end.z) < NERVE.whizz) {
          q.suppression = Math.min(1, q.suppression + NERVE.nearMiss);
          if (q.human) this.events.push({ type: 'whizz', at: q });
        }
      }
    }
  }

  // Where a straight shot from a toward b stops (the first solid thing)
  private rayEnd(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.5);
    for (let i = 2; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (this.grid.at(x, z) === 1) return { x, z };
    }
    return { x: bx, z: bz };
  }

  private damage(t: Soldier, dmg: number, by: Soldier | null) {
    if (!t.alive) return;
    t.hp -= dmg;
    t.hurtT = 0;
    this.events.push({ type: 'hurt', who: t, by });
    if (t.hp > 0) return;
    t.hp = 0;
    t.target = null;
    t.firing = false;
    if (by) by.kills++;
    if (t.side === Side.Allies) {
      // our side goes down, and can be helped up
      t.life = Life.Down;
      t.downT = SOLDIER.bleed;
      t.reviveT = 0;
      this.events.push({ type: 'down', who: t });
    } else {
      t.life = Life.Dead;
      this.events.push({ type: 'dead', who: t, by });
    }
  }

  private bleed(s: Soldier) {
    s.downT -= TICK;
    if (s.downT > 0) return;
    s.life = Life.Dead;
    this.events.push({ type: 'dead', who: s, by: null });
  }

  // A fallen friend gets up when someone stays beside him long enough
  private revives() {
    for (const d of this.soldiers) {
      if (d.life !== Life.Down) continue;
      const helper = this.soldiers.find((q) => q.side === d.side && q.alive && Math.hypot(q.x - d.x, q.z - d.z) < SOLDIER.reviveReach && !q.moving);
      if (!helper) { d.reviveT = Math.max(0, d.reviveT - TICK); continue; }
      d.reviveT += TICK;
      if (d.reviveT >= SOLDIER.revive) {
        d.life = Life.Fine;
        d.hp = SOLDIER.hp * 0.5;
        d.hurtT = 0;
        d.reviveT = 0;
        d.suppression = 0;
        this.events.push({ type: 'revived', who: d, by: helper });
      }
    }
  }

  // --- grenades ----------------------------------------------------------------------------------------------------
  private throwGrenade(s: Soldier, t: Soldier | null) {
    if (s.grenades <= 0 || !s.alive) return;
    s.grenades--;
    const tx = t ? t.x : s.x + Math.sin(s.facing) * 15, tz = t ? t.z : s.z - Math.cos(s.facing) * 15;
    const d = clamp(Math.hypot(tx - s.x, tz - s.z), 4, GRENADE.far);
    const a = Math.atan2(tx - s.x, -(tz - s.z)) + rand(-0.08, 0.08);
    // a lob that lands about there (ignoring drag): time of flight from the range
    const flight = d / GRENADE.throwSpeed * 1.4;
    this.grenades.push({ x: s.x, y: 1.6, z: s.z, vx: Math.sin(a) * (d / flight), vy: 4.9 * flight - 1.6 / flight, vz: -Math.cos(a) * (d / flight), t: GRENADE.fuse, owner: s });
    s.facing = a;
    this.events.push({ type: 'throw', who: s });
  }

  private moveGrenades() {
    for (const g of this.grenades) {
      g.t -= TICK;
      g.vy -= 9.8 * TICK;
      const nx = g.x + g.vx * TICK, nz = g.z + g.vz * TICK;
      if (this.grid.at(nx, nz) === 1 && g.y < 3) { g.vx *= -0.35; g.vz *= -0.35; } // (off a wall)
      else { g.x = nx; g.z = nz; }
      g.y += g.vy * TICK;
      if (g.y < 0.08) { g.y = 0.08; g.vy = Math.abs(g.vy) * 0.3; g.vx *= 0.55; g.vz *= 0.55; }
      if (g.t <= 0) this.explode(g);
    }
    this.grenades = this.grenades.filter((g) => g.t > 0);
  }

  private explode(g: Grenade) {
    this.events.push({ type: 'bang', x: g.x, z: g.z });
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const d = Math.hypot(s.x - g.x, s.z - g.z);
      if (d > GRENADE.radius) continue;
      if (this.grid.sight(g.x, g.z, s.x, s.z, s.crouched) === 'blocked') continue; // (a wall between)
      const k = 1 - d / GRENADE.radius;
      this.damage(s, GRENADE.damage * k * k + 10, g.owner);
      s.suppression = 1;
    }
  }

  // --- the mission ----------------------------------------------------------------------------------------------------
  private objective() {
    const st = this.current;
    if (!st) return;
    const humans = this.humans.filter((s) => s.alive);
    let done = false;
    if (st.goal === Goal.Reach) done = humans.some((s) => Math.hypot(s.x - st.at.x, s.z - st.at.z) < st.at.r);
    else if (st.goal === Goal.Rescue) {
      // reach him, with nobody of theirs close by
      const p = this.pilot;
      const by = p && humans.find((s) => Math.hypot(s.x - p.x, s.z - p.z) < st.at.r);
      if (p && by && !this.axisAlive().some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 12)) {
        p.captive = false;
        p.leader = by;
        this.events.push({ type: 'rescued', by });
        done = true;
      }
    } else if (st.goal === Goal.Extract) {
      const p = this.pilot;
      done = this.helo === 'landed' && !!p && p.alive && Math.hypot(p.x - LZ.x, p.z - LZ.z) < LZ.r && humans.some((s) => Math.hypot(s.x - LZ.x, s.z - LZ.z) < LZ.r + 2);
    }
    else if (st.goal === Goal.Clear) {
      const z = st.zone!;
      done = this.stepT > 2 && !this.axisAlive().some((s) => Math.abs(s.x - z.x) < z.w / 2 && Math.abs(s.z - z.z) < z.d / 2);
    } else if (st.goal === Goal.Destroy) {
      const setter = humans.find((s) => s.useHeld && Math.hypot(s.x - st.at.x, s.z - st.at.z) < st.at.r + 1);
      for (const s of humans) if (s !== setter) s.chargeT = 0;
      if (setter) {
        setter.chargeT += TICK;
        if (setter.chargeT >= CHARGE.set) {
          done = true;
          this.events.push({ type: 'blown' }, { type: 'bang', x: st.at.x, z: st.at.z });
        }
      }
    } else if (st.goal === Goal.Hold) {
      this.held += TICK;
      const waves = st.waves ?? [];
      while (this.waves < waves.length && this.held >= waves[this.waves].after) {
        const w = waves[this.waves++];
        const count = Math.round(w.count * (FAIR.waves.base + FAIR.waves.perHuman * this.humans.length));
        for (let i = 0; i < count; i++) {
          const from = w.from[i % w.from.length];
          this.enemy(from.x + rand(-3, 3), from.z + rand(-2, 2), i, true);
        }
      }
      done = this.held >= (st.hold ?? 60);
    }
    if (!done) return;
    this.events.push({ type: 'done', index: this.step });
    // the enemy that's left gives up the ground; the squads regroup
    if (st.goal === Goal.Hold) for (const s of this.axisAlive()) { s.life = Life.Dead; }
    if (this.step + 1 >= MISSION.length) {
      this.won = true;
      this.setHelo('leaving');
      this.events.push({ type: 'won' });
      return;
    }
    if (st.goal === Goal.Hold) this.setHelo('landed');
    this.regroup(MISSION[this.step + 1].checkpoint);
    this.begin(this.step + 1);
  }

  // --- flares and the helicopter ---------------------------------------------------------------------------------------
  private moveFlares() {
    this.flareT -= TICK;
    for (const f of this.flares) {
      f.t -= TICK;
      // up on its rocket, then down slowly under its parachute
      f.y = f.t > FLARE.burn - 1.2 ? Math.min(FLARE.rise, f.y + (FLARE.rise / 1.2) * TICK) : Math.max(0, f.y - FLARE.fall * TICK);
    }
    this.flares = this.flares.filter((f) => f.t > 0 && f.y > 0);
  }

  private setHelo(p: HeloPhase) {
    if (this.helo === p) return;
    this.helo = p;
    this.heloT = 0;
    this.events.push({ type: 'helo', phase: p });
  }

  private heloTick() {
    this.heloT += TICK;
    const st = this.current;
    if (st?.goal === Goal.Hold && this.helo === 'away' && this.held >= (st.hold ?? 60) - HELO.approach) this.setHelo('inbound');
    if (st?.goal === Goal.Extract && this.helo !== 'landed') this.setHelo('landed');
  }

  // How far through setting the charge (0..1), for the screen
  get chargeProgress() { return Math.max(0, ...this.humans.map((s) => s.chargeT / CHARGE.set)); }

  // --- seeing ------------------------------------------------------------------------------------------------------------
  bearing(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.atan2(b.x - a.x, -(b.z - a.z)); }

  canSee(s: Soldier, t: Soldier) {
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    if (d > SOLDIER.see) return false;
    return this.grid.sight(s.x, s.z, t.x, t.z, false) !== 'blocked';
  }

  // The enemy to shoot at: visible, in range, within `cone` of `dir`, the nearest (and closest to the line)
  private pickTarget(s: Soldier, dir: number, cone: number) {
    let best: Soldier | null = null, bs = Infinity;
    for (const t of this.soldiers) {
      if (t.side === s.side || !t.alive || t.captive) continue;
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      if (d > Math.max(s.weapon.range * 1.5, 30) || d > (s.side === Side.Axis ? FAIR.notice * this.seenIn(t) : SOLDIER.see)) continue;
      const off = Math.abs(angDiff(this.bearing(s, t), dir));
      if (off > cone) continue;
      if (!this.canSee(s, t)) continue;
      const sc = d + off * 12;
      if (sc < bs) { bs = sc; best = t; }
    }
    return best;
  }

  // How far the enemy (no night vision) can make out a man, as a share of daylight: the dark hides him
  // unless he's just fired or a flare is up near him
  private seenIn(t: Soldier) {
    const k = 1 - (1 - DARK.notice) * Math.max(0, (this.dark - 0.3) / 0.7);
    if (t.flashT < DARK.flash) return 1;
    if (this.flares.some((f) => f.y > 3 && Math.hypot(f.x - t.x, f.z - t.z) < FLARE.light)) return 1;
    return k;
  }

  private nearest(s: Soldier, side: Side) {
    let best: Soldier | null = null, bd = Infinity;
    for (const t of this.soldiers) {
      if (t.side !== side || !t.alive) continue;
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const SQUAD_NAMES = ['Baker', 'Hollis', 'Okafor', 'Brennan', 'Kowalski', 'Mensah', 'Delgado', 'Fischer', 'Adeyemi', 'Murphy', 'Lindqvist', 'Abara'];
const AXIS_NAMES = ['Gruber', 'Weiss', 'Krause', 'Vogel', 'Brandt', 'Hahn', 'Lenz', 'Roth'];
