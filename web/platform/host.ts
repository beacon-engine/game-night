// The local server the games run on (see internal/server).

// A game as listed on the game select page: its folder's game.json, plus what the server knows
export interface GameInfo {
  id: string;
  name: string;
  icon: string; // emoji fallback
  iconUrl?: string; // the game's icon.svg
  tagline: string;
  players: string;
  category: string;
  needs: import('./device.ts').Tier; // how much device it takes (game.json "needs")
  status: 'ready' | 'soon';
  manual: boolean; // has a manual.json: offer "How to play"
  url: string;
}

export interface HostInfo {
  padUrl: string; // what phones open to join
  qr: string; // that url as an svg QR code
  version: string; // of game-night, e.g. 'v1.2.0' ('dev' when built without a tag)
}

const getJson = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<T>);

export const hostInfo = () => getJson<HostInfo>('/api/info');
export const listGames = () => getJson<GameInfo[]>('/api/games');

// Back to the game select page; the phones stay connected
export function backToHub() {
  location.href = '/';
}
