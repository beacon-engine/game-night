// Synthesised sound: rifle cracks (quieter and duller the further from the camera), automatic fire,
// grenades, the snap of a bullet going past you, reloads, and the wind over the fields. Browsers only
// allow sound after a click or a key on the page, so unlock() is called on the first one.
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: GainNode | null = null;
  private last = new Map<string, number>();

  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running'; }
  private throttle(key: string, gap: number) {
    const now = this.ctx!.currentTime;
    if ((this.last.get(key) ?? -1) > now - gap) return false;
    this.last.set(key, now);
    return true;
  }

  private burst(length: number, volume: number, freq: number, q: number, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ctx!, now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + length);
    src.connect(f).connect(g).connect(this.master!);
    src.start(now, Math.random());
    src.stop(now + length + 0.05);
  }

  private tone(from: number, to: number, length: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
    const ctx = this.ctx!, now = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + length);
    o.connect(g).connect(this.master!);
    o.start(now);
    o.stop(now + length + 0.02);
  }

  // A shot `dist` m from the camera; `heavy` for rifles (a deeper crack than an automatic's)
  shot(dist: number, heavy: boolean) {
    if (!this.ok || !this.throttle(`shot${Math.round(dist / 15)}`, 0.03)) return;
    const k = Math.max(0.06, 1 - dist / 90);
    this.burst(heavy ? 0.22 : 0.12, (heavy ? 0.55 : 0.35) * k, (heavy ? 1500 : 2200) * (0.5 + 0.5 * k), 0.8);
    this.burst(heavy ? 0.6 : 0.3, 0.18 * k, 220, 0.7, 'lowpass', 0.02); // (the boom rolling back)
  }
  whizz() { if (this.ok && this.throttle('whizz', 0.12)) this.tone(2400 + Math.random() * 800, 900, 0.09, 0.08, 'sawtooth'); }
  bang(dist: number) {
    if (!this.ok) return;
    const k = Math.max(0.15, 1 - dist / 120);
    this.burst(1.4, 0.8 * k, 400, 0.5, 'lowpass');
    this.tone(90, 30, 0.9, 0.5 * k);
  }
  reload() { if (this.ok) { this.tone(1800, 1500, 0.03, 0.06, 'square'); this.tone(1400, 1200, 0.03, 0.06, 'square', 0.25); } }
  hurt() { if (this.ok && this.throttle('hurt', 0.2)) this.burst(0.12, 0.25, 600, 1.2); }
  order() { if (this.ok) [660, 880].forEach((f, i) => this.tone(f, f, 0.08, 0.08, 'triangle', i * 0.08)); }
  step() { if (this.ok) [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.2, 0.1, 'triangle', i * 0.14)); }
  won() { if (this.ok) [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.35, 0.12, 'triangle', i * 0.18)); }

  // Command on the radio: the squelch before it speaks
  radio() { if (this.ok) { this.burst(0.08, 0.12, 2400, 1.5, 'bandpass'); this.tone(1200, 1200, 0.05, 0.04, 'square', 0.06); } }
  // The goggles: the rising whine of the tube coming on, or a click off
  nvg(on: boolean) { if (this.ok) on ? this.tone(5000, 9000, 0.5, 0.025, 'sine') : this.tone(900, 700, 0.04, 0.05, 'square'); }
  stab(dist: number) { if (this.ok && dist < 30) { this.burst(0.12, 0.3 * (1 - dist / 30), 900, 1, 'bandpass'); this.tone(220, 120, 0.12, 0.12 * (1 - dist / 30)); } }
  // A flare going up: the thump of its launch, the hiss of it
  flare(dist: number) { if (this.ok) { const k = Math.max(0.15, 1 - dist / 120); this.tone(160, 60, 0.2, 0.3 * k); this.burst(1.6, 0.06 * k, 3500, 0.6, 'highpass', 0.15); } }

  // The helicopter's rotor: a thudding beat, louder as it comes (0 to stop it)
  private rotorGain: GainNode | null = null;
  rotor(level: number) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    if (!this.rotorGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 260;
      const beat = ctx.createGain();
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 17; // (blades going by)
      depth.gain.value = 0.5;
      beat.gain.value = 0.5;
      lfo.connect(depth).connect(beat.gain);
      lfo.start();
      this.rotorGain = ctx.createGain();
      this.rotorGain.gain.value = 0;
      src.connect(f).connect(beat).connect(this.rotorGain).connect(this.master!);
      src.start();
    }
    this.rotorGain.gain.setTargetAtTime(level * 0.9, ctx.currentTime, 0.3);
  }

  // The wind over the fields (on while playing)
  ambience(on: boolean) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    if (!this.wind) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      this.wind = ctx.createGain();
      this.wind.gain.value = 0;
      src.connect(f).connect(this.wind).connect(this.master!);
      src.start();
    }
    this.wind.gain.setTargetAtTime(on ? 0.07 : 0, ctx.currentTime, 0.8);
  }
}
