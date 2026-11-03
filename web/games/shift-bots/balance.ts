// Balancing Shift Bots without a screen: bots play the human side through whole fights, and this says how
// far they get, for one to four of them on each level. Run it with Node from the repo root:
//
//   node web/games/shift-bots/balance.ts            # 20 fights each
//   node web/games/shift-bots/balance.ts 50         # more, for steadier numbers
//   node web/games/shift-bots/balance.ts 20 city    # on another battleground
//
// The stand-in players fight like a decent person would: stand up, keep enemies at a good range, shoot,
// punch what's close, use the special when it's charged, drive off to mend when hurt, get each other up,
// and buy the upgrades they can afford (armour first).
import { arena, type Look } from './arena.ts';
import { LEVELS, Sim, TICK, UPGRADES, upgradeCost, type Bot, type BotSpec, type Foe } from './sim.ts';

const body = (id: string, kind: BotSpec['kind'], side: BotSpec['side'], extra: Partial<BotSpec> = {}): BotSpec => ({
  id, name: id, side, kind, body: id, speed: 1.05, armour: 1, power: 1, agility: 1, shiftTime: 0.8, height: 3.5, length: 4.6, weapon: 'blaster', ...extra,
});
const enemies: Record<Foe, BotSpec[]> = {
  scout: [body('scout', 'scout', 'them', { length: 4.4 })],
  trooper: [body('trooper', 'trooper', 'them')],
  brute: [body('brute', 'brute', 'them', { armour: 1.3, power: 1.2, height: 4, length: 5 })],
  lancer: [body('lancer', 'lancer', 'them')],
  hauler: [body('hauler', 'hauler', 'them', { height: 4, length: 4.9, scale: 1.8, weapon: 'cannon' })],
};

function pilot(sim: Sim, b: Bot) {
  const c = b.ctl;
  c.fire = c.punch = c.shift = c.special = c.dodge = false;
  c.x = c.z = 0;
  if (!b.alive) return;
  const friend = sim.humans.find((h) => h.down);
  const foes = sim.foes.filter((f) => f.alive);
  const near = foes.reduce<Bot | null>((m, f) => (!m || Math.hypot(f.x - b.x, f.z - b.z) < Math.hypot(m.x - b.x, m.z - b.z) ? f : m), null);
  const hurt = b.hp < b.maxHp * 0.3 && !friend;
  if (hurt !== (b.target === 0) && !b.changing) c.shift = true; // (a car to get away and mend; a robot to fight)
  if (friend && friend !== b) { const dx = friend.x - b.x, dz = friend.z - b.z, d = Math.hypot(dx, dz); if (d > 3) { c.x = dx / d; c.z = dz / d; } return; }
  if (!near) return;
  const dx = near.x - b.x, dz = near.z - b.z, d = Math.hypot(dx, dz) || 1;
  if (hurt) { c.x = -dx / d; c.z = -dz / d; return; }
  const want = !sim.sees(b, near, 80) ? 1 : d > 22 ? 1 : d < 10 ? -0.6 : 0; // (round cover to get a shot)
  c.x = (dx / d) * want + (dz / d) * 0.3; c.z = (dz / d) * want - (dx / d) * 0.3;
  if (b.robot && Math.abs(Math.atan2(dx, dz) - b.yaw) > 0.4) { c.x += (dx / d) * 0.2; c.z += (dz / d) * 0.2; } // (turn to face it)
  c.fire = true;
  c.punch = d < 4;
  c.special = b.special >= 1 && d < 15;
  c.run = d > 30;
  c.dodge = b.hitT > 0.9 && Math.random() < 0.05;
}

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const runs = Number(argv[2] ?? 20), where = (argv[3] ?? 'quarry') as Look; // (and which battleground: quarry, desert, city, snow)
for (const level of [0, 1, 2]) {
  const line: string[] = [];
  for (let players = 1; players <= 4; players++) {
    const waves: number[] = [];
    for (let r = 0; r < runs; r++) {
      const specs = Array.from({ length: players }, (_, i) => body(`p${i}`, 'player', 'us', { special: (['shield', 'shockwave', 'missiles'] as const)[i % 3] }));
      const sim = new Sim(arena(where), specs, level, enemies);
      while (!sim.over && sim.t < 60 * 30) {
        for (const b of sim.humans) pilot(sim, b);
        sim.step();
        for (const e of sim.events) if (e.t === 'cleared') {
          for (const b of sim.humans) for (const u of [...UPGRADES].sort((a) => (a.id === 'armour' ? -1 : 0))) while (b.scrap >= upgradeCost(b.up[u.id]) && sim.buy(b, u.id));
        }
      }
      waves.push(sim.wave);
    }
    waves.sort((a, b) => a - b);
    line.push(`${players}p: median wave ${waves[waves.length >> 1]} (${waves[0]}–${waves[waves.length - 1]})`);
  }
  console.log(`${LEVELS[level].name.padEnd(7)} ${line.join('   ')}`);
}
void TICK;
