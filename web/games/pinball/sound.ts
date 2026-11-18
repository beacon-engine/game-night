// Synthesised sound: the clack of the flippers, the pop of a bumper, the snap of a slingshot,
// chimes for the lanes and targets, the plunger, and the low tone of a lost ball. Browsers only
// allow sound after a click or a key on the page (the TV app allows it straight away), so
// unlock() is called on the first one.
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>(); // (the same sound no more than every few ms)

  unlock() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

  flip() { if (this.ok && this.throttle('flip', 0.03)) { this.burst(0.05, 0.25, 3000, 400); this.tone('square', 140, 90, 0.05, 0.05); } }
  bumper() { if (this.ok && this.throttle('bumper', 0.03)) { this.tone('square', 660, 330, 0.09, 0.08); this.burst(0.06, 0.2, 5000, 1500); } }
  sling() { if (this.ok && this.throttle('sling', 0.04)) { this.tone('triangle', 900, 500, 0.06, 0.08); this.burst(0.04, 0.2, 6000, 2000); } }
  wall(hard: number) { if (this.ok && this.throttle('wall', 0.05)) this.tone('sine', 260, 200, 0.05, Math.min(0.08, hard / 20000)); }
  lane() { if (this.ok) [0, 0.07].forEach((d, i) => this.tone('triangle', 880 * (i ? 1.5 : 1), 880 * (i ? 1.5 : 1), 0.18, 0.1, d)); }
  target() { if (this.ok && this.throttle('target', 0.05)) { this.tone('square', 520, 520, 0.08, 0.06); this.burst(0.05, 0.15, 3000, 800); } }
  fanfare() { if (this.ok) [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.12, i * 0.09)); }
  launch(power: number) { if (this.ok) { this.burst(0.25, 0.15 + power / 300, 800 + power * 30, 200); this.tone('sine', 120, 60, 0.15, 0.1); } }
  saved() { if (this.ok) [0, 0.12].forEach((d) => this.tone('sine', 1320, 1320, 0.12, 0.1, d)); }
  warning() { if (this.ok) this.tone('sawtooth', 110, 100, 0.25, 0.08); }
  tilt() { if (this.ok) { this.tone('sawtooth', 90, 60, 0.9, 0.12); this.burst(0.5, 0.2, 400, 80); } }
  drain() { if (this.ok) [392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.25, 0.1, i * 0.16)); }
  count(i: number) { if (this.ok) this.tone('triangle', 660 + i * 110, 660 + i * 110, 0.06, 0.06); }
}
