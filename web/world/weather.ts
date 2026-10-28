// The weather over a match or a race, for any game played outdoors (football, the racing games, golf,
// cricket...): how hard it's raining or snowing right now, and how wet the ground is. No graphics
// (precipitation.ts draws it) and no game rules: each game decides what the wet does to it (the
// racing games' tyres are in racing/tyres.ts; on a football pitch the ball skids and players slip).
//
// Rain doesn't soak the ground at once: the wet comes up over half a minute of steady rain and takes
// a couple of minutes to dry off after it stops, so a shower is a stretch of the game, not a switch.

export enum Forecast {
  Dry = 'dry',
  Showers = 'showers', // dry to start, then a spell or two of rain
  Rain = 'rain', // wet from the start, all game
  Snow = 'snow', // snow lying, and more falling
}

// How the ground is now, in a word (for the screen)
export enum Conditions {
  Dry = 'Dry',
  Spitting = 'Spitting',
  Rain = 'Rain',
  Wet = 'Wet',
  Drying = 'Drying',
  Snow = 'Snow',
}

// What the lobby says about each; a game can say more about what it does to its sport
export const FORECASTS: Record<Forecast, { name: string; about: string }> = {
  [Forecast.Dry]: { name: 'Dry', about: 'Sunshine and dry ground all game.' },
  [Forecast.Showers]: { name: 'Showers', about: 'Dry to start, then rain on and off: it gets wet, then dries out again.' },
  [Forecast.Rain]: { name: 'Rain', about: 'Wet from the start, and it keeps raining.' },
  [Forecast.Snow]: { name: 'Snow', about: 'Snow lying on the ground and more coming down.' },
};

const SOAK = 30; // s of full rain to soak dry ground
const DRY_OUT = 150; // s for soaked ground to dry once it stops
const RAMP = 20; // s a shower takes to build up, and to ease off
const FALLING = 0.05; // rain below this is too light to wet anything

// Thresholds for how the ground looks, by how wet it is
const SOAKED = 0.6;
const DAMP = 0.15;

// How heavy the steady weather is (a shower's peak is drawn from SHOWER_PEAK)
const STEADY: Partial<Record<Forecast, number>> = { [Forecast.Rain]: 0.8, [Forecast.Snow]: 0.5 };
const SHOWER_PEAK = { min: 0.55, spread: 0.45 };

// A spell of rain: when it comes, when it goes, how hard it gets (game seconds)
interface Spell { from: number; to: number; peak: number; phase: number } // (phase: where its come-and-go starts)

export class Weather {
  rain = 0; // how hard it's raining (or snowing) now: 0..1
  wet = 0; // how wet the ground is: 0 (dry) .. 1 (soaked)
  private spells: Spell[] = [];

  // `length`: about how long the game will last, in seconds, to spread the showers over it
  constructor(readonly forecast: Forecast, length: number, rnd: () => number = Math.random) {
    if (forecast === Forecast.Showers) {
      // one or two showers, never at the very start (so it starts dry) or right at the end
      const n = length > 240 && rnd() < 0.6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const span = length / n, from = span * i + span * (0.12 + rnd() * 0.3);
        this.spells.push({ from, to: from + span * (0.3 + rnd() * 0.25), peak: SHOWER_PEAK.min + rnd() * SHOWER_PEAK.spread, phase: from });
      }
    }
    const steady = STEADY[forecast];
    if (steady) {
      this.spells.push({ from: -Infinity, to: Infinity, peak: steady, phase: 0 });
      this.rain = steady;
      this.wet = 1;
    }
  }

  get snow() { return this.forecast === Forecast.Snow; }
  get raining() { return this.rain > FALLING; }

  // Time passing: `t` seconds into the game
  step(t: number, dt: number) {
    let rain = 0;
    for (const s of this.spells) {
      // (heavier in the middle, with a little come and go)
      const ramp = Math.min(1, (t - s.from) / RAMP, (s.to - t) / RAMP);
      if (ramp > 0) rain = Math.max(rain, s.peak * ramp * (0.85 + 0.15 * Math.sin(t * 0.05 + s.phase)));
    }
    this.rain = rain;
    if (this.snow) return; // (the snow lies all game)
    this.wet = this.raining ? Math.min(1, this.wet + (rain * dt) / SOAK) : Math.max(0, this.wet - dt / DRY_OUT);
  }

  // Rain falling, or due within this many seconds (the radar)
  coming(t: number, within: number) {
    return this.spells.some((s) => s.to > t && s.from - t < within);
  }

  get conditions(): Conditions {
    if (this.snow) return Conditions.Snow;
    if (this.wet > SOAKED) return this.raining ? Conditions.Rain : Conditions.Wet;
    if (this.wet > DAMP) return this.raining ? Conditions.Rain : Conditions.Drying;
    return this.raining ? Conditions.Spitting : Conditions.Dry;
  }
}
