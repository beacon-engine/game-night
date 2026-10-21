// The sound of the race, synthesised (nothing to download). Each person driving gets an engine that
// works through a gearbox, so the revs climb, drop at each shift and climb again; a V8's uneven
// firing pulses, brighter and louder on the gas, muffled off it; tyres on the road and wind that
// grow with speed; a squeal when sliding; a grind along the wall. The computer drivers are heard
// as they come close. With the screen split, each person's car is panned toward their side.
// Browsers only allow sound after a click or key on the page (the TV app allows it straight away),
// so unlock() is called on the first one.

export interface Driving {
  id: string;
  v: number; // m/s
  throttle: number; // 0..1
  slip?: number; // m/s sliding sideways
  scrape?: boolean; // grinding along a wall
  pan?: number; // -1 (left) .. 1 (right)
  air?: boolean; // wheels off the ground (the engine races, the tyres go quiet)
}
export interface Others { near: number; v: number } // the nearest computer car: 0 (far) .. 1 (alongside), its speed

// The gearbox: the speed (m/s) each gear runs out at. Revs go from IDLE to RED within a gear.
const GEARS = [19, 33, 47, 61, 74, 92];
const IDLE = 900, RED = 7200;
const SHIFT = 0.12; // s the revs take to drop at a shift

interface Voice {
  engine: OscillatorNode; // the firing pulses, from a wave with a V8's harmonics
  sub: OscillatorNode; // the crank, an octave down
  lump: OscillatorNode; // wobbles the volume at half the firing rate: the burble
  lumpDepth: GainNode;
  body: GainNode; // the engine's volume
  tone: BiquadFilterNode; // opens up on the gas
  road: GainNode; // tyres on the surface
  wind: GainNode;
  squeal: GainNode;
  grind: GainNode;
  pan: StereoPannerNode;
  out: GainNode;
  sources: AudioBufferSourceNode[]; // the noise loops, to stop with it
  gear: number;
  rpm: number;
}

export class Engines {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wave: PeriodicWave | null = null;
  private voices = new Map<string, Voice>();
  private pack: Voice | null = null; // the computer drivers, as one engine that comes and goes

  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      // a compressor keeps a pack of engines and a crash from clipping
      const squash = ctx.createDynamicsCompressor();
      squash.threshold.value = -18;
      squash.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(squash).connect(ctx.destination);
      this.noise = noiseBuffer(ctx);
      // a V8's note: the firing frequency, with strong low harmonics and an uneven, lumpy edge
      const n = 12, re = new Float32Array(n), im = new Float32Array(n);
      [0, 1, 0.55, 0.42, 0.3, 0.12, 0.18, 0.06, 0.08, 0.03, 0.04, 0.02].forEach((a, i) => { im[i] = a; re[i] = i % 2 ? a * 0.3 : 0; });
      this.wave = ctx.createPeriodicWave(re, im);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // Every frame: who is driving, and how close the computer drivers are
  update(cars: Driving[], others?: Others) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, live = new Set<string>();
    const share = 1 / Math.sqrt(Math.max(1, cars.length));
    for (const c of cars) {
      live.add(c.id);
      const v = this.voices.get(c.id) ?? this.voice(c.id);
      this.drive(v, c, share, now);
    }
    for (const [id, v] of this.voices) if (!live.has(id)) this.stop(id, v);

    // the pack: louder and nearer as one comes alongside
    if (others && others.near > 0.02) {
      this.pack ??= this.makeVoice();
      this.drive(this.pack, { id: 'pack', v: others.v, throttle: 1 }, others.near * 0.6 * share, now);
      this.pack.road.gain.setTargetAtTime(0, now, 0.1);
    } else if (this.pack) { this.stopVoice(this.pack); this.pack = null; }
  }

  silence() {
    for (const [id, v] of this.voices) this.stop(id, v);
    if (this.pack) { this.stopVoice(this.pack); this.pack = null; }
  }

  // A dull knock: contact, or landing hard
  thump(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    gain.gain.setValueAtTime(0.5 * strength, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
    this.burst(0.12, 400, 0.25 * strength); // and the body panels
  }

  // Metal on concrete
  crunch(strength = 1) {
    this.burst(0.35, 1800, 0.45 * Math.min(1, strength));
    this.thump(strength);
  }

  // --- the engine ----------------------------------------------------------------------------------
  private drive(v: Voice, c: Driving, level: number, now: number) {
    // which gear, and the revs in it; in the air (or wheelspin) the revs run free
    let gear = 0;
    while (gear < GEARS.length - 1 && c.v > GEARS[gear] * 0.97) gear++;
    let rpm = (c.v / GEARS[gear]) * RED;
    if (c.air) rpm = Math.min(RED, rpm + 2500 * c.throttle);
    rpm = Math.max(IDLE, Math.min(RED, rpm + (gear === 0 ? c.throttle * 1400 : 0)));
    const shifted = gear !== v.gear;
    v.gear = gear;
    v.rpm = rpm;

    const fire = (rpm / 60) * 4; // a V8 fires four times a revolution
    const glide = shifted ? SHIFT : 0.04;
    v.engine.frequency.setTargetAtTime(fire, now, glide);
    v.sub.frequency.setTargetAtTime(fire / 2, now, glide);
    v.lump.frequency.setTargetAtTime(fire / 8, now, glide);
    v.lumpDepth.gain.setTargetAtTime(0.35 - 0.2 * c.throttle, now, 0.1); // lumpier when it's lazy
    const load = 0.35 + 0.65 * c.throttle;
    v.body.gain.setTargetAtTime(level * (0.1 + 0.16 * load) * (shifted ? 0.5 : 1), now, shifted ? 0.02 : 0.06);
    v.tone.frequency.setTargetAtTime(300 + 2400 * load * (0.4 + (0.6 * rpm) / RED), now, 0.06);

    const speed = Math.min(1, c.v / 90);
    v.road.gain.setTargetAtTime(c.air ? 0 : level * 0.12 * speed, now, 0.08);
    v.wind.gain.setTargetAtTime(level * 0.1 * speed * speed, now, 0.2);
    v.squeal.gain.setTargetAtTime(c.air ? 0 : level * 0.12 * Math.min(1, Math.max(0, (c.slip ?? 0) - 1.5) / 6), now, 0.05);
    v.grind.gain.setTargetAtTime(c.scrape ? level * 0.3 : 0, now, 0.04);
    v.pan.pan.setTargetAtTime(c.pan ?? 0, now, 0.1);
  }

  private voice(id: string) {
    const v = this.makeVoice();
    this.voices.set(id, v);
    return v;
  }

  private makeVoice(): Voice {
    const ctx = this.ctx!;
    const out = ctx.createGain(), pan = ctx.createStereoPanner();
    out.connect(pan).connect(this.master!);

    const engine = ctx.createOscillator(), sub = ctx.createOscillator(), lump = ctx.createOscillator();
    engine.setPeriodicWave(this.wave!);
    sub.type = 'triangle';
    lump.type = 'sine';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 2.5; // a little resonance: the intake's honk
    const body = ctx.createGain(), mix = ctx.createGain(), subLevel = ctx.createGain(), lumpDepth = ctx.createGain();
    body.gain.value = 0;
    subLevel.gain.value = 0.6;
    lumpDepth.gain.value = 0.3;
    engine.connect(mix);
    sub.connect(subLevel).connect(mix);
    lump.connect(lumpDepth).connect(mix.gain); // (mix.gain sits at 1; the lump wobbles it)
    mix.connect(tone).connect(body).connect(out);

    const sources: AudioBufferSourceNode[] = [];
    const road = this.noisy(out, sources, 'lowpass', 220, 0.7);
    const wind = this.noisy(out, sources, 'bandpass', 900, 0.5);
    const squeal = this.noisy(out, sources, 'bandpass', 1300, 9);
    const grind = this.noisy(out, sources, 'bandpass', 2600, 1.2);
    for (const o of [engine, sub, lump]) o.start();
    return { engine, sub, lump, lumpDepth, body, tone, road, wind, squeal, grind, pan, out, sources, gear: 0, rpm: IDLE };
  }

  // A loop of noise through a filter, silent until turned up
  private noisy(to: AudioNode, sources: AudioBufferSourceNode[], type: BiquadFilterType, hz: number, q: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4; // (so two cars' noise doesn't line up)
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    gain.gain.value = 0;
    src.connect(f).connect(gain).connect(to);
    src.start();
    sources.push(src);
    return gain;
  }

  // A short burst of filtered noise, fading out
  private burst(len: number, hz: number, level: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = this.noise;
    band.type = 'bandpass';
    band.frequency.value = hz;
    band.Q.value = 0.8;
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(band).connect(gain).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len + 0.05);
  }

  private stop(id: string, v: Voice) {
    this.stopVoice(v);
    this.voices.delete(id);
  }

  private stopVoice(v: Voice) {
    const t = this.ctx!.currentTime;
    v.out.gain.setTargetAtTime(0, t, 0.1);
    for (const o of [v.engine, v.sub, v.lump]) o.stop(t + 0.6);
    for (const src of v.sources) src.stop(t + 0.6);
  }
}

// Two seconds of white noise, shared by everything that hisses, rumbles or grinds
function noiseBuffer(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
