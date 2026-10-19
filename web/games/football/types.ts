// The football data files, typed: teams.json, formations.json and settings.json.

export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';
export type Stat = 'pace' | 'passing' | 'shooting' | 'tackling' | 'dribbling' | 'keeping' | 'stamina';

// how a player runs with the ball: little touches, knock it ahead and race onto it, or between
export type DribbleStyle = 'close' | 'knock' | 'balanced';

export interface Kit {
  shirt: string;
  shorts: string;
  socks: string;
  number: string; // colour of the shirt number
  trim?: string;
  second?: string; // stripes / hoops colour
  pattern?: 'plain' | 'stripes' | 'hoops';
}

export type PlayerData = { name: string; number: number; pos: Role; style?: DribbleStyle } & Partial<Record<Stat, number>> &
  Record<'pace' | 'passing' | 'shooting' | 'tackling' | 'dribbling', number>;

export interface Club {
  name: string;
  short: string;
  kit: Kit;
  gk: Kit;
  players: PlayerData[];
}

// x: 0 = own goal line, 1 = the opponents'. z: -1..1 across the pitch.
export interface FormationSlot {
  role: Role;
  x: number;
  z: number;
}

export type Formations = Record<string, FormationSlot[]>;

export type CameraMode = 'full' | 'broadcast' | 'wide' | 'close';
export type TagMode = 'all' | 'active' | 'none';
export type TimeOfDay = 'day' | 'night';

export interface Settings {
  matchMinutes: number;
  playersPerSide: number;
  pitch: { length: number; width: number };
  goal: { width: number; height: number };
  renderScale?: number;
  aiSkill?: number;
  camera?: CameraMode;
  nameTags?: TagMode;
  maxFps?: number;
  timeOfDay?: TimeOfDay;
}
