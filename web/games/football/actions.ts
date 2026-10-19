// Everything a football player can do with the pad. controls.json binds pad buttons to these,
// per situation; anything it names that isn't listed here is reported and ignored.
import { loadControls, type Controls } from '@platform';

export const CONTEXTS = ['attack', 'defend', 'throwIn'] as const;
export const ACTIONS = [
  'pass', 'longPass', 'shoot', 'throughBall', 'loftedThroughBall', 'stepOver', 'dragBack', // with the ball
  'press', 'tackle', 'slideTackle', 'standingTackle', 'switchPlayer', 'teammatePress', // without it
  'shortThrow', 'longThrow', // throw-ins
] as const;

export type Context = (typeof CONTEXTS)[number];
export type Action = (typeof ACTIONS)[number];
export type FootballControls = Controls<Context, Action>;

export const loadFootballControls = () => loadControls(CONTEXTS, ACTIONS);
