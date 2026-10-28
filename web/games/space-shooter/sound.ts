// Synthesised sound: shots, explosions (filtered noise, bigger ones lower and longer), pickups, the
// bomb, the boss's warning siren, and a low hum under it all. Browsers only allow sound after a click
// or a key on the page (the TV app allows it straight away), so unlock() is called on the first one.
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>(); // (the same sound no more than every few ms: four ships firing at once)
  private hum: { osc: OscillatorNode; gain: GainNode } | null = null;

  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running' && !!this.master; }

  private throttle(key: string, gap: number) {
    const now = this.ctx!.currentTime;
    if ((this.last.get(key) ?? -1) > now - gap) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(type: OscillatorType, from: number, to: number, length: number, volume: number, delay = 0) {
    const ctx = this.ctx!, now = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain).connect(this.master!);
    osc.start(now);
    osc.stop(now + length + 0.02);
  }

  private burst(length: number, volume: number, from: number, to: number, delay = 0) {
    const ctx = this.ctx!, now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, now);
    f.frequency.exponentialRampToValueAtTime(to, now + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    src.connect(f).connect(gain).connect(this.master!);
    src.start(now, Math.random() * 0.5);
    src.stop(now + length + 0.05);
  }

  shot() { if (this.ok && this.throttle('shot', 0.06)) this.tone('square', 1500, 500, 0.06, 0.035); }
  laser() { if (this.ok && this.throttle('laser', 0.09)) this.tone('sawtooth', 220 + Math.random() * 30, 180, 0.1, 0.03); }
  hit() { if (this.ok && this.throttle('hit', 0.04)) this.tone('triangle', 900, 300, 0.05, 0.05); }
  explode(size: number) {
    if (!this.ok || !this.throttle(`boom${size > 1.5 ? 'big' : ''}`, 0.05)) return;
    this.burst(0.25 + size * 0.25, Math.min(0.5, 0.15 + size * 0.12), 2400, 90);
    this.tone('sine', 120, 40, 0.2 + size * 0.15, 0.2);
  }
  pickup() { if (this.ok) [880, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.09, 0.12, i * 0.05)); }
  shield() { if (this.ok) this.tone('sine', 400, 1200, 0.25, 0.15); }
  bomb() { if (this.ok) { this.burst(1.4, 0.6, 3000, 60); this.tone('sine', 200, 30, 1.2, 0.35); } }
  down() { if (this.ok) { this.burst(0.9, 0.45, 1800, 80); this.tone('sawtooth', 500, 60, 0.8, 0.15); } }
  chain() { if (this.ok) this.tone('square', 660, 1320, 0.12, 0.06); }
  life() { if (this.ok) [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.1, 0.06, i * 0.08)); }
  warning() {
    if (!this.ok) return;
    for (let i = 0; i < 4; i++) { this.tone('sawtooth', 440, 880, 0.35, 0.09, i * 0.7); this.tone('sawtooth', 880, 440, 0.35, 0.09, i * 0.7 + 0.35); }
  }
  clear() { if (this.ok) [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.12, i * 0.12)); }

  // A low engine hum, a little higher the more is going on (0: off)
  drone(level: number) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    if (!this.hum) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), f = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      f.type = 'lowpass';
      f.frequency.value = 260;
      gain.gain.value = 0;
      osc.connect(f).connect(gain).connect(this.master!);
      osc.start();
      this.hum = { osc, gain };
    }
    const now = ctx.currentTime;
    this.hum.osc.frequency.setTargetAtTime(48 + level * 18, now, 0.3);
    this.hum.gain.gain.setTargetAtTime(level ? 0.05 + level * 0.03 : 0, now, 0.4);
  }
}
