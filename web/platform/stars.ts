// Stars: players earn them by playing and spend them in the shop (on their phone) on looks for the
// games, never on anything that helps win. The server decides what each thing is worth and caps it
// per day (internal/server/stars.go); a game only says what happened:
//
//   const got = await earnStars(c, won ? ['played', 'won'] : ['played']);
//   if (got?.earned) say(`+${got.earned} stars`);
//
// and, for what a player has bought for this game:
//
//   const mine = await ownedItems(c);              // ['gold', 'chrome'] (this game's items)
//
// Stars never break a game: if the server can't be reached, these come back empty.
import type { Controller } from './input.ts';
import { ICON } from './icons.ts';

export type EarnFor = 'played' | 'won' | 'podium' | 'record' | 'champion';

export interface Earned {
  balance: number;
  earned: number;
  lines: { for: EarnFor | 'daily'; stars: number }[];
}

export interface StarsInfo {
  balance: number;
  owned: string[]; // '<game>/<item>'
}

export interface ShopItem {
  id: string; // '<game>/<item>'
  game: string;
  gameName: string;
  name: string;
  price: number;
  extra: Record<string, unknown>; // the game's own fields from shop.json (about, a colour...)
}

const thisGame = () => location.pathname.match(/^\/games\/([^/]+)\//)?.[1] ?? 'hub';
// the same player id as their saves (playerKey)
export const starsId = (c: Controller | string) => (typeof c === 'string' ? c : c.id).toLowerCase().replace(/[^a-z0-9_-]/g, '');

async function call<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  } catch (err) {
    console.warn(`[stars] ${url}:`, err);
    return null;
  }
}

export const earnStars = (c: Controller, why: EarnFor[], game = thisGame()) =>
  call<Earned>(`/api/stars/${starsId(c)}/earn`, { game, for: why });

export const starsOf = (c: Controller | string) => call<StarsInfo>(`/api/stars/${starsId(c)}`);

// What a player has bought for a game: its item ids without the game ('gold', not 'stock-cars/gold')
export async function ownedItems(c: Controller, game = thisGame()) {
  const info = await starsOf(c);
  return (info?.owned ?? []).filter((id) => id.startsWith(`${game}/`)).map((id) => id.slice(game.length + 1));
}

export const shopItems = (game?: string) =>
  call<ShopItem[]>('/api/shop').then((all) => (all ?? []).filter((it) => !game || it.game === game));

// Buying fails with a reason a player can read
export async function buyItem(player: string, item: string): Promise<StarsInfo | string> {
  try {
    const r = await fetch(`/api/stars/${starsId(player)}/buy`, { method: 'POST', body: JSON.stringify({ item }), headers: { 'Content-Type': 'application/json' } });
    if (r.ok) return (await r.json()) as StarsInfo;
    return r.status === 402 ? 'Not enough stars yet' : r.status === 409 ? 'You have this already' : "Couldn't buy it. Try again.";
  } catch {
    return "Couldn't reach the game. Try again.";
  }
}

// A star count, drawn with the stars coin (not the pad's Star button)
export const starsLabel = (n: number) => `<span class="stars-count">${ICON.coin}${n.toLocaleString()}</span>`;

// What earned what, for a results screen: 'Played +5 · Won +15 · First game today +20'
const WHY: Record<Earned['lines'][number]['for'], string> = {
  played: 'Played', won: 'Won', podium: 'Podium', record: 'New record', champion: 'Champion', daily: 'First game today',
};
export const earnedText = (e: Earned) => e.lines.map((l) => `${WHY[l.for] ?? l.for} +${l.stars}`).join(' · ');
