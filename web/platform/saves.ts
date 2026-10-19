// Saved progress: kept by the Beacon Arcade server, as files on the machine running it (the laptop, or
// the TV in the TV app), so it's there next time, whoever's phone joins. See internal/server/saves.go.
//
//   const saves = gameSaves();                         // this game's saves
//   const record = (await saves.get<Record>(playerKey(c))) ?? { wins: 0 };
//   record.wins++;
//   saves.set(playerKey(c), record);
//
// Keys are up to three parts of lowercase letters, digits, '-' and '_': 'players/3fa9c1', 'levels/world-2'.
// A value is any JSON, up to 256 KB. Saving never breaks a game: if it can't save, it says so in the
// console and carries on.
import type { Controller } from './input.ts';

export interface Saves {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

// The saves of the game this page belongs to (from its folder: /games/<id>/), or another game's
export function gameSaves(game = location.pathname.match(/^\/games\/([^/]+)\//)?.[1] ?? 'hub'): Saves {
  const url = (key: string) => `/api/saves/${game}/${key}`;
  return {
    async get<T>(key: string) {
      try {
        const r = await fetch(url(key), { cache: 'no-store' });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return (await r.json()) as T;
      } catch (err) {
        console.warn(`[saves] couldn't read ${game}/${key}:`, err);
        return null;
      }
    },
    async set(key: string, value: unknown) {
      try {
        const r = await fetch(url(key), { method: 'PUT', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      } catch (err) {
        console.warn(`[saves] couldn't save ${game}/${key}:`, err);
      }
    },
  };
}

// A player's own saves follow their phone (the same phone is the same player, every night).
// Keyboard players are one per layout on this machine.
export const playerKey = (c: Controller, under = 'players') => `${under}/${c.id.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
