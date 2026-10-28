// Tyres, and what the weather (world/weather.ts) does to them. No graphics (cars.ts draws the tread).
//
// Slicks, the smooth tyres, are the quickest in the dry and slither about in the wet. Wets have
// grooves cut in them that push the water out from under the tread: slower in the dry (and they wear
// fast there), far better once the road is wet. Rally cars run treaded gravel tyres, and studded
// snow tyres in the snow.
//
// Real racing: rallies run in rain and snow (the winter rounds are on snow and ice), circuit racing
// runs in the rain on wets but stops for snow, and oval racing stops for rain altogether (a wet
// banking can't be raced). Each game offers what its sport does.
import type { Weather } from '@world/weather.ts';

export enum Tyre {
  Slick = 'slick',
  Wet = 'wet',
  Gravel = 'gravel', // a rally car's
  Snow = 'snow', // studded
}

export const TYRE_NAME: Record<Tyre, string> = {
  [Tyre.Slick]: 'Slicks', [Tyre.Wet]: 'Wets', [Tyre.Gravel]: 'Gravel', [Tyre.Snow]: 'Studs',
};

// How much of a dry road's grip each tyre has: on a dry road, and on a soaked one (in between, in
// between). Wets overtake slicks when the road is about a third wet.
const GRIP: Record<Tyre, { dry: number; soaked: number }> = {
  [Tyre.Slick]: { dry: 1, soaked: 0.5 },
  [Tyre.Wet]: { dry: 0.88, soaked: 0.78 },
  [Tyre.Gravel]: { dry: 0.9, soaked: 0.8 },
  [Tyre.Snow]: { dry: 0.84, soaked: 0.76 },
};
// ...and on packed snow, as a share of that: studs bite, anything else hardly does
const ON_SNOW: Record<Tyre, number> = { [Tyre.Slick]: 0.34, [Tyre.Wet]: 0.4, [Tyre.Gravel]: 0.45, [Tyre.Snow]: 0.62 };

// The share of its dry grip this tyre has in this weather (none: a dry road)
export function tyreGrip(tyre: Tyre, w: Weather | null) {
  if (!w) return GRIP[tyre].dry;
  const g = GRIP[tyre], road = g.dry + (g.soaked - g.dry) * w.wet;
  return w.snow ? road * ON_SNOW[tyre] : road;
}

// When the pit wall changes a car's tyres. Going to wets: once the road is a third wet, or it's
// only damp but pouring. Back to slicks: once it's drying, the rain has stopped, and the radar shows
// nothing more for a minute (so a car doesn't swap just before the next shower).
const TO_WETS = { wet: 0.33, damp: 0.1, downpour: 0.3 };
const TO_SLICKS = { wet: 0.28, drizzle: 0.2, radar: 60 };

// The tyres a crew would fit now, for a car on these
export function bestTyre(w: Weather | null, t: number, on: Tyre): Tyre {
  if (!w) return Tyre.Slick;
  if (w.snow) return Tyre.Snow;
  if (on === Tyre.Wet) {
    const dried = w.wet < TO_SLICKS.wet && w.rain < TO_SLICKS.drizzle && !w.coming(t, TO_SLICKS.radar);
    return dried ? Tyre.Slick : Tyre.Wet;
  }
  const soaking = w.wet > TO_WETS.wet || (w.wet > TO_WETS.damp && w.rain > TO_WETS.downpour);
  return soaking ? Tyre.Wet : Tyre.Slick;
}
