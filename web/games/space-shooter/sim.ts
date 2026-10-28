// The rules of Space Shooter, with no graphics or sound: ships, their weapons, the enemies and their
// fire, the boss, pickups, lives and the score. main.ts runs it and scene.ts draws it; things that
// happen are reported as events for the screen and the speakers.
import {
  DIFFICULTY, DROPS, ENEMIES, Enemy, FIELD, Fire, Path, Pickup, STAGES, Weapon, WEAPON_OF,
  type Boss, type BossPart, type Difficulty, type EnemyKind, type Stage, type Wave,
} from './stages.ts';

export const TICK = 1 / 60;
const { w: W, h: H } = FIELD;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// --- tuning ------------------------------------------------------------------------------------------
const SHIP = {
  speed: 13, focus: 0.45, // units/s; how much of it when focusing
  hit: 0.32, body: 0.7, grab: 1.1, // hit circle (small: a shooter's ships are mostly wing), body (for rams), pickup reach
  respawn: 2, invuln: 2.6, bombs: 2, maxBombs: 5, maxLevel: 4,
  bombTime: 0.9, bombDamage: 25, bombBoss: 15, bombInvuln: 1.4,
};
const SHOT = { speed: 32, missileSpeed: 16, missileTurn: 7, missileLife: 2.2 };
const BULLET = { speed: 7, r: 0.22 };
const CHAIN = { window: 1.6, per: 5, most: 8 }; // kills this close together keep a chain; every `per` kills, one more times
const DROP_DRIFT = 2.2; // units/s pickups drift left
const HAULER_LAUNCH = 2.2; // s between darts launched from a hauler
const BOSS = { enter: 4, x: W - 7.5, warn: 3 }; // s it takes to fly in, where it stops, warning before it comes
const CLEAR_BONUS = 10000;
// More ships, tougher enemies: bosses take this much more for each ship after the first, the rest a little
const CREW = { boss: 0.4, foe: 0.12, solo: 0.8 };

// The weapons: how often each fires, and how strong each level is
const WEAPON = {
  [Weapon.Blaster]: { every: 0.1, dmg: 1 },
  [Weapon.Spread]: { every: 0.15, dmg: 0.75 },
  [Weapon.Laser]: { every: 0, dmg: 0 }, // (a beam: see LASER)
  [Weapon.Missiles]: { every: 0.12, dmg: 0.8 },
};
const LASER = { dps: 14, perLevel: 6, width: 0.3, widthPerLevel: 0.12, focusDps: 1.3 };
const MISSILE = { every: 0.55, dmg: 3 };

// --- things in the field -----------------------------------------------------------------------------
export interface ShipSpec { id: string; name: string; color: string; ai: boolean; model: string; hull?: string } // (hull: a paint job from the shop)

export class Ship {
  x = -2; y = H / 2;
  alive = true;
  out = false; // no lives left for it
  respawnT = 0;
  invuln = SHIP.invuln;
  weapon = Weapon.Blaster;
  level = 1;
  bombs = SHIP.bombs;
  shield = false;
  score = 0;
  kills = 0;
  deaths = 0;
  // what the pilot wants this tick
  moveX = 0; moveY = 0; firing = false; focus = false; bombNow = false;
  beam = 0; // the laser's length this tick (0: off)
  fireCd = 0;
  missileCd = 0;
  bank = 0; // how it leans as it climbs or dives (for the picture)
  entering = 1; // s still flying in from the left
  constructor(readonly spec: ShipSpec, slot: number, count: number) {
    this.y = H * ((slot + 1) / (count + 1));
  }
  get ai() { return this.spec.ai; }
  get targetable() { return this.alive && this.entering <= 0; }
}

export interface Shot { x: number; y: number; vx: number; vy: number; dmg: number; owner: Ship; missile: boolean; life: number; target: Target | null }
export interface Bullet { x: number; y: number; vx: number; vy: number; r: number }
export interface Drop { kind: Pickup; x: number; y: number; t: number }

export interface Foe {
  id: number;
  kind: Enemy;
  def: EnemyKind;
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  t: number; // s since it came in
  y0: number;
  wave: Wave;
  fireT: number;
  launchT: number;
  spin: number;
  scale: number; // (a broken rock is smaller)
  flash: number; // s it shows it was hit
  alive: boolean;
  state: number; // path phase
}

export interface BossPartState { def: BossPart; hp: number; max: number; alive: boolean; fireT: number; x: number; y: number; flash: number }
export interface BossState { def: Boss; x: number; y: number; t: number; parts: BossPartState[]; coreOpen: boolean; dead: boolean; spiral: number; rageT: number }

type Target = Foe | BossPartState;

export type SimEvent =
  | { type: 'fire'; ship: Ship }
  | { type: 'hit'; x: number; y: number }
  | { type: 'explode'; x: number; y: number; size: number; color: string }
  | { type: 'pickup'; ship: Ship; kind: Pickup }
  | { type: 'shield'; ship: Ship } // the shield took a hit
  | { type: 'down'; ship: Ship }
  | { type: 'respawn'; ship: Ship }
  | { type: 'bomb'; ship: Ship }
  | { type: 'warning' } // the boss is coming
  | { type: 'bossIn' }
  | { type: 'coreOpen' }
  | { type: 'bossDown' }
  | { type: 'clear'; bonus: number }
  | { type: 'over' } // every human ship is out of lives
  | { type: 'chain'; n: number };

export enum Phase { Waves = 'waves', Warning = 'warning', Boss = 'boss', Clear = 'clear' }

export class Sim {
  readonly ships: Ship[];
  shots: Shot[] = [];
  bullets: Bullet[] = [];
  foes: Foe[] = [];
  drops: Drop[] = [];
  boss: BossState | null = null;
  bombs: { x: number; y: number; t: number; owner: Ship }[] = [];
  events: SimEvent[] = [];
  phase = Phase.Waves;
  t = 0; // s into the stage
  phaseT = 0;
  lives: number; // the team's spare ships
  chain = 0;
  chainT = 0;
  best = 0; // the longest chain
  continues = 0;
  over = false;
  readonly stage: Stage;
  private queue: { wave: Wave; next: number; left: number; i: number }[];
  private nextId = 1;
  private readonly diff;

  // `stageIndex`: which stage (past the last, they come round again, harder: `round`)
  constructor(specs: ShipSpec[], readonly difficulty: Difficulty, readonly stageIndex = 0, carry?: Sim) {
    this.diff = DIFFICULTY[difficulty];
    this.stage = STAGES[stageIndex % STAGES.length];
    this.ships = specs.map((s, i) => new Ship(s, i, specs.length));
    this.lives = this.diff.lives * Math.max(1, specs.filter((s) => !s.ai).length);
    if (carry) this.carryFrom(carry);
    this.queue = this.stage.waves.map((wave) => ({ wave, next: wave.at, left: wave.count, i: 0 }));
  }

  // For testing: jump `t` s into the stage (the waves before then are skipped)
  skipTo(t: number) {
    this.t = t;
    for (const q of this.queue) if (q.wave.at < t) q.left = 0;
  }

  // Later stages come round again, tougher
  get round() { return 1 + Math.floor(this.stageIndex / STAGES.length); }
  private get toughness() { return this.diff.hp * (1 + (this.round - 1) * 0.4); }
  private get crew() { return Math.max(1, this.ships.length); }
  private get bulletSpeed() { return BULLET.speed * this.diff.bulletSpeed * (1 + (this.round - 1) * 0.15); }
  private get fireRate() { return this.diff.fireRate * (1 + (this.round - 1) * 0.25); }

  get teamScore() { return this.ships.reduce((s, p) => s + p.score, 0); }
  get multiplier() { return Math.min(CHAIN.most, 1 + Math.floor(this.chain / CHAIN.per)); }
  get humans() { return this.ships.filter((s) => !s.ai); }

  // The next stage keeps everyone's score, weapons, bombs and the lives left
  private carryFrom(prev: Sim) {
    this.lives = prev.lives;
    this.continues = prev.continues;
    this.best = prev.best;
    for (const s of this.ships) {
      const p = prev.ships.find((q) => q.spec.id === s.spec.id);
      if (!p) continue;
      Object.assign(s, { score: p.score, kills: p.kills, deaths: p.deaths, weapon: p.weapon, level: p.level, bombs: p.bombs, shield: p.shield, out: p.out });
      s.alive = !p.out;
    }
  }

  // A player joining mid-game takes a ship (from the left, like a respawn)
  addShip(spec: ShipSpec) {
    const s = new Ship(spec, 0, 1);
    s.y = H / 2;
    this.ships.push(s);
    return s;
  }
  removeShip(id: string) {
    const s = this.ships.find((q) => q.spec.id === id);
    if (s) s.alive = false, s.out = true;
  }

  // After the game is over: a continue fills the team's ships up again, keeping the scores
  continueGame() {
    this.continues++;
    this.over = false;
    this.lives = this.diff.lives * Math.max(1, this.humans.length) - 1;
    for (const s of this.ships) if (s.out || !s.alive) this.respawn(s);
    this.bullets = [];
  }

  step() {
    this.events = [];
    this.t += TICK;
    this.phaseT += TICK;
    this.chainT -= TICK;
    if (this.chainT <= 0 && this.chain) this.chain = 0;
    for (const s of this.ships) if (s.ai) pilot(s, this);
    this.flow();
    for (const s of this.ships) this.moveShip(s);
    this.moveShots();
    for (const f of this.foes) this.moveFoe(f);
    if (this.boss) this.moveBoss(this.boss);
    this.moveBullets();
    this.moveDrops();
    this.moveBombs();
    this.collide();
    this.foes = this.foes.filter((f) => f.alive);
    if (!this.over && this.humans.length && this.humans.every((s) => s.out)) {
      this.over = true;
      this.events.push({ type: 'over' });
    }
  }

  // --- the stage: waves, then the boss -----------------------------------------------------------------
  private flow() {
    if (this.phase === Phase.Waves) {
      for (const q of this.queue) {
        while (q.left > 0 && this.t >= q.next) {
          this.spawn(q.wave, q.i++);
          q.left--;
          q.next += q.wave.every;
        }
      }
      // the boss comes once the waves are done and the screen is (nearly) clear
      if (this.t > this.stage.length && this.foes.filter((f) => f.kind !== Enemy.Rock).length === 0) {
        this.phase = Phase.Warning;
        this.phaseT = 0;
        this.events.push({ type: 'warning' });
      }
    } else if (this.phase === Phase.Warning && this.phaseT > BOSS.warn) {
      this.phase = Phase.Boss;
      this.phaseT = 0;
      this.boss = this.newBoss(this.stage.boss);
      this.events.push({ type: 'bossIn' });
    }
  }

  private spawn(wave: Wave, i: number, at?: { x: number; y: number }) {
    const def = ENEMIES[wave.enemy];
    const y = at ? at.y : wave.y === 'spread' ? H * ((i % wave.count + 1) / (wave.count + 1)) : wave.y === 'random' ? rand(0.12, 0.88) * H : wave.y * H;
    const hp = def.hp * this.toughness * (1 + CREW.foe * (this.crew - 1));
    const f: Foe = {
      id: this.nextId++, kind: wave.enemy, def, x: at ? at.x : W + 2 + def.r, y, vx: -def.speed, vy: 0,
      hp, maxHp: hp, t: 0, y0: y, wave, fireT: rand(0.4, 1) * Math.max(0.6, def.every), launchT: HAULER_LAUNCH,
      spin: Math.random() * 6, scale: 1, flash: 0, alive: true, state: 0,
    };
    if (wave.path === Path.Drift) f.vy = rand(-0.6, 0.6);
    this.foes.push(f);
    return f;
  }

  private newBoss(def: Boss): BossState {
    const k = this.toughness * (this.crew === 1 ? CREW.solo : 1 + CREW.boss * (this.crew - 1));
    return {
      def, x: W + 10, y: H / 2, t: 0, coreOpen: false, dead: false, spiral: 0, rageT: 0,
      parts: def.parts.map((p) => ({ def: p, hp: p.hp * k, max: p.hp * k, alive: p.hp > 0, fireT: rand(0.5, 1.5), x: 0, y: 0, flash: 0 })),
    };
  }

  // --- ships ---------------------------------------------------------------------------------------------
  private moveShip(s: Ship) {
    if (!s.alive) {
      if (!s.out) {
        s.respawnT -= TICK;
        if (s.respawnT <= 0) this.respawn(s);
      }
      return;
    }
    s.invuln = Math.max(0, s.invuln - TICK);
    if (s.entering > 0) {
      // flying in from the left
      s.entering -= TICK;
      s.x += (4 - s.x) * Math.min(1, TICK * 4);
      s.beam = 0;
      return;
    }
    const sp = SHIP.speed * (s.focus ? SHIP.focus : 1);
    const m = Math.hypot(s.moveX, s.moveY);
    const k = m > 1 ? 1 / m : 1;
    s.x = clamp(s.x + s.moveX * k * sp * TICK, 1, W - 1.2);
    s.y = clamp(s.y + s.moveY * k * sp * TICK, 0.8, H - 0.8);
    s.bank += (s.moveY * k * 0.6 - s.bank) * Math.min(1, TICK * 10);
    if (s.bombNow && s.bombs > 0) {
      s.bombs--;
      s.invuln = Math.max(s.invuln, SHIP.bombInvuln);
      this.bombs.push({ x: s.x, y: s.y, t: 0, owner: s });
      this.bullets = []; // (a bomb clears the screen of fire at once)
      this.events.push({ type: 'bomb', ship: s });
    }
    s.bombNow = false;
    this.fire(s);
  }

  private respawn(s: Ship) {
    s.alive = true;
    s.out = false;
    s.x = -2;
    s.y = H / 2;
    s.entering = 1;
    s.invuln = SHIP.invuln;
    this.events.push({ type: 'respawn', ship: s });
  }

  private fire(s: Ship) {
    s.beam = 0;
    s.fireCd -= TICK;
    s.missileCd -= TICK;
    if (!s.firing) return;
    const L = s.level, focus = s.focus;
    if (s.weapon === Weapon.Laser) {
      s.beam = W - s.x; // (cut short where it's stopped: collide)
      return;
    }
    if (s.fireCd > 0) return;
    s.fireCd = WEAPON[s.weapon].every;
    const dmg = WEAPON[s.weapon].dmg;
    const bolt = (dy: number, ang: number, d = dmg) => this.shots.push({
      x: s.x + 0.9, y: s.y + dy, vx: Math.cos(ang) * SHOT.speed, vy: Math.sin(ang) * SHOT.speed, dmg: d, owner: s, missile: false, life: 1.2, target: null,
    });
    if (s.weapon === Weapon.Spread) {
      const n = 1 + L * 2, fan = (0.18 + L * 0.12) * (focus ? 0.45 : 1);
      for (let i = 0; i < n; i++) bolt(0, -fan + (2 * fan * i) / (n - 1));
    } else {
      // the blaster (missiles fly with it): more streams as it powers up
      const rows = [[0], [-0.22, 0.22], [-0.3, 0, 0.3], [-0.45, -0.15, 0.15, 0.45]][L - 1];
      for (const dy of rows) bolt(dy * (focus ? 0.6 : 1), 0);
      if (L >= 3 && !focus) { bolt(0.2, 0.12); bolt(-0.2, -0.12); }
      if (s.weapon === Weapon.Missiles && s.missileCd <= 0) {
        s.missileCd = MISSILE.every;
        for (let i = 0; i < Math.min(4, L + 1); i++) {
          const up = i % 2 ? 1 : -1;
          this.shots.push({ x: s.x, y: s.y + up * 0.4, vx: 6, vy: up * (5 + i), dmg: MISSILE.dmg, owner: s, missile: true, life: SHOT.missileLife, target: null });
        }
      }
    }
    this.events.push({ type: 'fire', ship: s });
  }

  private moveShots() {
    for (const p of this.shots) {
      p.life -= TICK;
      if (p.missile) {
        if (!p.target || !alive(p.target)) p.target = this.nearestTarget(p.x, p.y, true);
        if (p.target) {
          const want = Math.atan2(p.target.y - p.y, p.target.x - p.x), now = Math.atan2(p.vy, p.vx);
          let d = want - now;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const a = now + clamp(d, -SHOT.missileTurn * TICK, SHOT.missileTurn * TICK);
          const sp = Math.min(SHOT.missileSpeed * 1.6, Math.hypot(p.vx, p.vy) + 30 * TICK);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
        }
      }
      p.x += p.vx * TICK;
      p.y += p.vy * TICK;
    }
    this.shots = this.shots.filter((p) => p.life > 0 && p.x < W + 2 && p.x > -2 && p.y > -2 && p.y < H + 2);
  }

  // --- enemies -------------------------------------------------------------------------------------------
  private moveFoe(f: Foe) {
    f.t += TICK;
    f.flash = Math.max(0, f.flash - TICK);
    f.spin += (f.def.spin ?? 0) * TICK;
    const sp = f.def.speed, w = f.wave;
    switch (w.path) {
      case Path.Line: f.vx = -sp; f.vy = 0; break;
      case Path.Sine: f.vx = -sp; f.vy = Math.cos(f.t * 2.2) * 2.2 * (w.amp ?? 1.5); break;
      case Path.Drift: f.vx = -sp; break;
      case Path.Dive: {
        f.vx = -sp;
        if (f.t > 0.7) {
          const s = this.nearestShip(f.x, f.y);
          if (s && s.x < f.x) f.vy += clamp(s.y - f.y, -1, 1) * 14 * TICK;
          f.vy *= 0.97;
        }
        break;
      }
      case Path.Stop: {
        const holdAt = (w.holdX ?? 0.7) * W;
        if (f.state === 0) { f.vx = -sp; if (f.x <= holdAt) { f.state = 1; f.t = 0; } }
        else if (f.state === 1) { f.vx *= 0.9; f.vy = Math.sin(f.t * 1.5) * 0.8; if (f.t > (w.hold ?? 2)) f.state = 2; }
        else { f.vx -= 12 * TICK; f.vy *= 0.95; }
        break;
      }
      case Path.Loop: {
        const r = w.amp ?? 3, cx = W * 0.55;
        if (f.state === 0) { f.vx = -sp; f.vy = 0; if (f.x <= cx) { f.state = 1; f.t = 0; } }
        else if (f.state === 1) {
          const a = (f.t * sp) / r; // once round
          f.vx = -Math.cos(a) * sp;
          f.vy = Math.sin(a) * sp * (f.y0 > H / 2 ? -1 : 1);
          if (a > Math.PI * 2) f.state = 2;
        } else { f.vx = -sp * 1.2; f.vy = 0; }
        break;
      }
    }
    // mines drift toward the nearest ship once it's near
    if (f.kind === Enemy.Mine) {
      const s = this.nearestShip(f.x, f.y);
      if (s && Math.hypot(s.x - f.x, s.y - f.y) < 9) {
        f.vx += clamp(s.x - f.x, -1, 1) * 3 * TICK;
        f.vy += clamp(s.y - f.y, -1, 1) * 3 * TICK;
        if (Math.hypot(s.x - f.x, s.y - f.y) < 1.6) this.kill(f, null); // it goes off beside you
      }
    }
    f.x += f.vx * TICK;
    f.y += f.vy * TICK;
    if (f.y < 0.5 || f.y > H - 0.5) f.vy = -f.vy * 0.8, f.y = clamp(f.y, 0.5, H - 0.5);
    if (f.x < -4 || f.x > W + 12) f.alive = false;
    // haulers launch darts at you
    if (f.kind === Enemy.Hauler && f.x < W - 2) {
      f.launchT -= TICK;
      if (f.launchT <= 0) {
        f.launchT = HAULER_LAUNCH / this.fireRate;
        this.spawn({ at: 0, enemy: Enemy.Dart, count: 1, every: 0, y: 0.5, path: Path.Dive }, 0, { x: f.x - 1, y: f.y + rand(-1, 1) });
      }
    }
    if (f.def.fire !== Fire.None && f.def.every > 0 && f.x < W - 1 && f.x > 4) {
      f.fireT -= TICK * this.fireRate;
      if (f.fireT <= 0) {
        f.fireT = f.def.every * rand(0.85, 1.15);
        this.shoot(f.def.fire, f.x - f.def.r * 0.6, f.y);
      }
    }
  }

  private moveBoss(b: BossState) {
    b.t += TICK;
    const entering = b.t < BOSS.enter;
    b.x = entering ? W + 10 + (BOSS.x - W - 10) * smooth(b.t / BOSS.enter) : BOSS.x + Math.sin(b.t * 0.35) * 1.2;
    b.y = H / 2 + (entering ? 0 : Math.sin((b.t - BOSS.enter) * 0.5) * b.def.sway);
    const guns = b.parts.filter((p) => p.def.hp > 0 && !p.def.core);
    if (!b.coreOpen && guns.every((p) => !p.alive)) {
      b.coreOpen = true;
      this.events.push({ type: 'coreOpen' });
    }
    for (const p of b.parts) {
      p.x = b.x + p.def.x;
      p.y = b.y + p.def.y;
      p.flash = Math.max(0, p.flash - TICK);
      if (!p.alive || entering || p.def.fire === Fire.None || (p.def.core && !b.coreOpen)) continue;
      p.fireT -= TICK * this.fireRate * (b.coreOpen ? 1.3 : 1);
      if (p.fireT <= 0) {
        p.fireT = p.def.every * rand(0.9, 1.1);
        this.shoot(p.def.fire, p.x - p.def.r, p.y, b);
      }
    }
    if (b.coreOpen && !entering) {
      b.rageT -= TICK * this.fireRate;
      if (b.rageT <= 0) {
        b.rageT = b.def.rage === Fire.Spiral ? 0.09 : 1.1;
        const core = b.parts.find((p) => p.def.core)!;
        this.shoot(b.def.rage, core.x - 1, core.y, b);
      }
    }
  }

  // Enemy fire, from (x, y)
  private shoot(kind: Fire, x: number, y: number, b?: BossState) {
    const v = this.bulletSpeed;
    const s = this.nearestShip(x, y);
    const aim = s ? Math.atan2(s.y - y, s.x - x) : Math.PI;
    const one = (a: number, speed = v) => this.bullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: BULLET.r });
    switch (kind) {
      case Fire.Aimed: one(aim); break;
      case Fire.Aimed3: for (const d of [-0.22, 0, 0.22]) one(aim + d); break;
      case Fire.Fan5: for (let i = 0; i < 5; i++) one(aim - 0.6 + i * 0.3, v * 0.85); break;
      case Fire.Ring: for (let i = 0; i < 12; i++) one((i / 12) * Math.PI * 2 + this.t, v * 0.7); break;
      case Fire.Spiral: {
        const host = b ?? { spiral: 0 };
        host.spiral += 0.32;
        one(host.spiral, v * 0.75);
        one(host.spiral + Math.PI, v * 0.75);
        break;
      }
    }
  }

  private moveBullets() {
    for (const p of this.bullets) { p.x += p.vx * TICK; p.y += p.vy * TICK; }
    this.bullets = this.bullets.filter((p) => p.x > -1 && p.x < W + 1 && p.y > -1 && p.y < H + 1);
  }

  private moveDrops() {
    for (const d of this.drops) {
      d.t += TICK;
      d.x -= DROP_DRIFT * TICK;
      d.y += Math.sin(d.t * 3) * 0.6 * TICK;
    }
    this.drops = this.drops.filter((d) => d.x > -1);
  }

  private moveBombs() {
    for (const bomb of this.bombs) {
      const r0 = (bomb.t / SHIP.bombTime) * W * 1.2;
      bomb.t += TICK;
      const r1 = (bomb.t / SHIP.bombTime) * W * 1.2;
      // the wave hits everything it sweeps over, once
      for (const f of this.foes) {
        const d = Math.hypot(f.x - bomb.x, f.y - bomb.y);
        if (d >= r0 && d < r1) this.damage(f, SHIP.bombDamage, bomb.owner);
      }
      if (this.boss) for (const p of this.boss.parts) {
        const d = Math.hypot(p.x - bomb.x, p.y - bomb.y);
        if (d >= r0 && d < r1) this.damagePart(this.boss, p, SHIP.bombBoss, bomb.owner);
      }
      this.bullets = this.bullets.filter((p) => Math.hypot(p.x - bomb.x, p.y - bomb.y) > r1);
    }
    this.bombs = this.bombs.filter((b) => b.t < SHIP.bombTime);
  }

  // --- hits ------------------------------------------------------------------------------------------------
  private collide() {
    // our fire
    for (const p of this.shots) {
      const t = this.targetAt(p.x, p.y, 0.25);
      if (!t) continue;
      p.life = 0;
      this.events.push({ type: 'hit', x: p.x, y: p.y });
      if ('kind' in t) this.damage(t, p.dmg, p.owner);
      else this.damagePart(this.boss!, t, p.dmg, p.owner);
    }
    // lasers: everything in the beam's line, up to the first armour (the boss's hull)
    for (const s of this.ships) {
      if (!s.beam) continue;
      const width = LASER.width + s.level * LASER.widthPerLevel * (s.focus ? 0.6 : 1);
      const dps = (LASER.dps + s.level * LASER.perLevel) * (s.focus ? LASER.focusDps : 1);
      if (this.boss && this.boss.x - 4 > s.x && Math.abs(this.boss.y - s.y) < 3.5) s.beam = Math.min(s.beam, this.boss.x - 3 - s.x);
      for (const f of this.foes) {
        if (f.x > s.x && f.x < s.x + s.beam && Math.abs(f.y - s.y) < f.def.r * f.scale + width) this.damage(f, dps * TICK, s, true);
      }
      if (this.boss) for (const p of this.boss.parts) {
        if (p.alive && p.x > s.x && p.x - p.def.r < s.x + s.beam + 1 && Math.abs(p.y - s.y) < p.def.r + width) this.damagePart(this.boss, p, dps * TICK, s, true);
      }
    }
    // their fire, and ramming
    for (const s of this.ships) {
      if (!s.targetable || s.invuln > 0) continue;
      let hit = false;
      for (const p of this.bullets) {
        if (Math.hypot(p.x - s.x, p.y - s.y) < p.r + SHIP.hit) { hit = true; p.x = -99; break; }
      }
      if (!hit) for (const f of this.foes) {
        if (Math.hypot(f.x - s.x, f.y - s.y) < f.def.r * f.scale + SHIP.body * 0.6) { hit = true; this.damage(f, 6, s); break; }
      }
      if (!hit && this.boss) for (const p of this.boss.parts) {
        if (p.def.r && Math.hypot(p.x - s.x, p.y - s.y) < p.def.r + SHIP.body * 0.5) { hit = true; break; }
      }
      if (hit) this.hitShip(s);
    }
    // pickups
    for (const d of this.drops) {
      for (const s of this.ships) {
        if (!s.targetable || Math.hypot(d.x - s.x, d.y - s.y) > SHIP.grab) continue;
        this.collect(s, d.kind);
        d.x = -99;
        break;
      }
    }
  }

  private hitShip(s: Ship) {
    if (s.shield) {
      s.shield = false;
      s.invuln = 1;
      this.events.push({ type: 'shield', ship: s });
      return;
    }
    s.alive = false;
    s.deaths++;
    s.beam = 0;
    this.events.push({ type: 'explode', x: s.x, y: s.y, size: 1.4, color: s.spec.color }, { type: 'down', ship: s });
    // what you lose: a level of your weapon, left floating for you (or anyone) to pick up again
    if (s.level > 1) { s.level--; this.drops.push({ kind: Pickup.Power, x: s.x, y: s.y, t: 0 }); }
    s.bombs = Math.max(s.bombs, SHIP.bombs);
    if (s.ai) { s.respawnT = SHIP.respawn * 2; return; } // (wingmen don't use the team's ships)
    if (this.lives > 0) { this.lives--; s.respawnT = SHIP.respawn; }
    else s.out = true;
  }

  private collect(s: Ship, kind: Pickup) {
    const w = WEAPON_OF[kind];
    if (w) {
      if (s.weapon === w) s.level = Math.min(SHIP.maxLevel, s.level + 1);
      else s.weapon = w;
    } else if (kind === Pickup.Power) s.level = Math.min(SHIP.maxLevel, s.level + 1);
    else if (kind === Pickup.Shield) s.shield = true;
    else if (kind === Pickup.Bomb) s.bombs = Math.min(SHIP.maxBombs, s.bombs + 1);
    else if (kind === Pickup.Life) this.lives++;
    s.score += 500;
    this.events.push({ type: 'pickup', ship: s, kind });
  }

  private damage(f: Foe, dmg: number, by: Ship | null, beam = false) {
    if (!f.alive) return;
    f.hp -= dmg;
    if (!beam || f.flash <= 0) f.flash = 0.06;
    if (f.hp <= 0) this.kill(f, by);
  }

  private kill(f: Foe, by: Ship | null) {
    f.alive = false;
    const big = f.def.r * f.scale;
    this.events.push({ type: 'explode', x: f.x, y: f.y, size: big, color: f.def.paint });
    if (f.kind === Enemy.Mine) this.shoot(Fire.Ring, f.x, f.y);
    if (by) this.score(by, f.def.score);
    // a big rock breaks in two
    if (f.kind === Enemy.Rock && f.scale > 0.6) {
      for (const up of [-1, 1]) {
        const g = this.spawn(f.wave, 0, { x: f.x, y: f.y + up * 0.5 });
        g.scale = f.scale * 0.55;
        g.hp = g.maxHp = f.maxHp * 0.35;
        g.vy = up * 2;
        g.x = f.x;
      }
    }
    if (Math.random() < f.def.drop) this.drops.push({ kind: pickDrop(), x: f.x, y: f.y, t: 0 });
  }

  private damagePart(b: BossState, p: BossPartState, dmg: number, by: Ship, beam = false) {
    if (!p.alive || b.dead) return;
    if (p.def.core && !b.coreOpen) { if (!beam) this.events.push({ type: 'hit', x: p.x, y: p.y }); return; } // (armoured until the guns are gone)
    p.hp -= dmg;
    if (!beam || p.flash <= 0) p.flash = 0.06;
    if (p.hp > 0) return;
    p.alive = false;
    this.events.push({ type: 'explode', x: p.x, y: p.y, size: 2, color: '#ffb347' });
    this.score(by, 2000);
    if (p.def.core) {
      b.dead = true;
      this.score(by, b.def.score);
      this.bullets = [];
      for (let i = 0; i < 6; i++) this.events.push({ type: 'explode', x: b.x + rand(-4, 3), y: b.y + rand(-3, 3), size: 3, color: '#ffd28a' });
      this.events.push({ type: 'bossDown' });
      this.phase = Phase.Clear;
      this.phaseT = 0;
      const bonus = CLEAR_BONUS * (this.stageIndex + 1);
      const alive = this.humans.filter((s) => !s.out);
      for (const s of alive) s.score += Math.round(bonus / alive.length);
      this.events.push({ type: 'clear', bonus });
    }
  }

  private score(by: Ship, points: number) {
    this.chain++;
    this.chainT = CHAIN.window;
    this.best = Math.max(this.best, this.chain);
    if (this.chain % CHAIN.per === 0) this.events.push({ type: 'chain', n: this.chain });
    by.score += points * this.multiplier;
    by.kills++;
  }

  // --- finding things ------------------------------------------------------------------------------------
  nearestShip(x: number, y: number) {
    let best: Ship | null = null, bd = Infinity;
    for (const s of this.ships) {
      if (!s.targetable) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private targets(): Target[] {
    const out: Target[] = this.foes.filter((f) => f.alive);
    if (this.boss && !this.boss.dead) for (const p of this.boss.parts) if (p.alive && (!p.def.core || this.boss.coreOpen)) out.push(p);
    return out;
  }

  nearestTarget(x: number, y: number, ahead = false): Target | null {
    let best: Target | null = null, bd = Infinity;
    for (const t of this.targets()) {
      if (ahead && t.x < x - 1) continue;
      if (t.x > W) continue;
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  private targetAt(x: number, y: number, r: number): Target | null {
    for (const f of this.foes) if (f.alive && Math.hypot(f.x - x, f.y - y) < f.def.r * f.scale + r) return f;
    if (this.boss && !this.boss.dead) for (const p of this.boss.parts) {
      if ((p.alive || p.def.hp === 0) && p.def.r && Math.hypot(p.x - x, p.y - y) < p.def.r + r) return p;
    }
    return null;
  }
}

const alive = (t: Target) => ('kind' in t ? t.alive : t.alive);
const smooth = (k: number) => { const x = clamp(k, 0, 1); return x * x * (3 - 2 * x); };

function pickDrop(): Pickup {
  let r = Math.random();
  for (const [kind, p] of DROPS) { if ((r -= p) <= 0) return kind; }
  return Pickup.Power;
}

// --- the computer pilot (wingmen, and the demo behind the menu) ------------------------------------------
// Lines up with the nearest target, keeps to the left third, sidesteps the fire coming at it, grabs
// pickups that are near, and bombs when it's boxed in.
const PILOT = { home: 7, look: 3.2, dodge: 2.2, crowd: 6, crowdR: 2.6 };

function pilot(s: Ship, sim: Sim) {
  s.firing = true;
  s.focus = false;
  if (!s.alive || s.entering > 0) return;
  const t = sim.nearestTarget(s.x, s.y, true);
  let wantY = t ? t.y : H / 2;
  let wantX = PILOT.home;
  const d = sim.drops.find((p) => Math.hypot(p.x - s.x, p.y - s.y) < 6);
  if (d) { wantY = d.y; wantX = Math.max(3, d.x); }
  let mx = clamp((wantX - s.x) * 0.5, -1, 1), my = clamp((wantY - s.y) * 0.8, -1, 1);
  let near = 0;
  for (const b of sim.bullets) {
    const dx = b.x - s.x, dy = b.y - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < PILOT.crowdR) near++;
    if (dist > PILOT.look) continue;
    // coming toward us? step out of its line
    const closing = -(dx * b.vx + dy * b.vy) / (dist || 1);
    if (closing <= 0) continue;
    const side = (dx * b.vy - dy * b.vx) > 0 ? 1 : -1;
    const k = (PILOT.look - dist) / PILOT.look;
    mx += -b.vy / Math.hypot(b.vx, b.vy) * side * k * PILOT.dodge;
    my += b.vx / Math.hypot(b.vx, b.vy) * side * k * PILOT.dodge;
  }
  for (const f of sim.foes) {
    const dx = f.x - s.x, dy = f.y - s.y, dist = Math.hypot(dx, dy);
    if (dist < f.def.r + 2) { mx -= dx / dist; my -= dy / dist; }
  }
  if (sim.boss && Math.abs(sim.boss.x - s.x) < 6) mx -= 1;
  s.moveX = clamp(mx, -1, 1);
  s.moveY = clamp(my, -1, 1);
  if (near >= PILOT.crowd && s.bombs > 0) s.bombNow = true;
}
