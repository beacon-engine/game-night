// Tiny synthesised sound kit: kicks, whistle, woodwork, and short crowd reactions.
// There is deliberately no constant crowd bed: synthesised noise just sounds like a fan.
interface Graph {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

export class Sfx {
  muted = false;
  private graph: Graph | null = null; // created on the first click/key (browsers require one)

  // the audio graph, when sound can play right now
  private live() {
    const g = this.graph;
    return g && g.ctx.state === 'running' && !this.muted ? g : null;
  }

  unlock() {
    if (!this.graph) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
      this.graph = { ctx, master, noise: pinkNoise(ctx, 3) };
    }
    if (this.graph.ctx.state !== 'running') this.graph.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.graph) this.graph.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  // A crowd reaction: a few band-limited noise layers with a voice-like wobble
  crowd(peak: number, attack: number, hold: number, release: number, centre = 520) {
    const a = this.live();
    if (!a) return;
    const c = a.ctx, t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + attack);
    out.gain.setValueAtTime(peak, t + attack + hold);
    out.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    out.connect(lp).connect(a.master);
    for (const [f, q] of [[centre * 0.6, 1.2], [centre, 1.6], [centre * 1.7, 2.2]]) {
      const src = c.createBufferSource();
      src.buffer = a.noise;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      // slow "vowel" movement so it reads as voices rather than hiss
      const lfo = c.createOscillator();
      const lfoG = c.createGain();
      lfo.frequency.value = 0.6 + Math.random() * 0.8;
      lfoG.gain.value = f * 0.15;
      lfo.connect(lfoG).connect(bp.frequency);
      src.connect(bp).connect(out);
      const end = t + attack + hold + release + 0.1;
      src.start(t, Math.random() * 2);
      lfo.start(t);
      src.stop(end);
      lfo.stop(end);
    }
  }

  roar() { this.crowd(0.55, 0.35, 1.8, 2.5, 560); }
  ooh() { this.crowd(0.22, 0.15, 0.35, 0.9, 430); }
  cheer() { this.crowd(0.3, 0.2, 0.5, 1.2, 600); }

  kick(power = 10) {
    const a = this.live();
    if (!a) return;
    const c = a.ctx, t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    g.gain.setValueAtTime(Math.min(0.7, 0.12 + power / 40), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(a.master);
    o.start(t);
    o.stop(t + 0.14);
  }

  whistle(count = 1, long = false) {
    const a = this.live();
    if (!a) return;
    const c = a.ctx;
    for (let i = 0; i < count; i++) {
      const t = c.currentTime + i * 0.45;
      const dur = long && i === count - 1 ? 0.9 : 0.3;
      const o = c.createOscillator();
      const lfo = c.createOscillator();
      const lfoG = c.createGain();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = 2900;
      lfo.frequency.value = 38;
      lfoG.gain.value = 120;
      lfo.connect(lfoG).connect(o.frequency);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.setValueAtTime(0.14, t + dur - 0.05);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(a.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur);
      lfo.stop(t + dur);
    }
  }

  clang() {
    const a = this.live();
    if (!a) return;
    const c = a.ctx, t = c.currentTime;
    for (const f of [820, 1270, 1930, 2650]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(a.master);
      o.start(t);
      o.stop(t + 0.9);
    }
    this.ooh();
  }
}

// pink-ish noise: closer to a crowd than white noise
function pinkNoise(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029;
    b1 = 0.985 * b1 + w * 0.032;
    b2 = 0.95 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2) * 0.9;
  }
  return buf;
}
