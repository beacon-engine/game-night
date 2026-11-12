// Pool: a tiny synthesised sound kit. The click of ball on ball, the thud of a cushion, a ball dropping into
// a pocket, the cue's tip. All made from short bursts of noise and tones, so there are no files to load.
export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null; // made on the first click or key (browsers insist on one)
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = 0; // sounds started this frame (a break makes dozens at once)

  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }

  frame() { this.recent = 0; }

  private live() {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || this.recent > 6) return null;
    this.recent++;
    return this.ctx;
  }

  // a decaying tone
  private tone(c: AudioContext, freq: number, gain: number, decay: number, type: OscillatorType = 'sine', at = 0) {
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  // a filtered burst of noise
  private burst(c: AudioContext, type: BiquadFilterType, freq: number, q: number, gain: number, decay: number, at = 0) {
    const t = c.currentTime + at, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + decay + 0.02);
  }

  // ball on ball: a hard, bright click, louder with speed (m/s)
  click(speed: number) {
    const c = this.live();
    if (!c || speed < 0.03) return;
    const v = Math.min(1, speed / 5) ** 0.7;
    this.tone(c, 3600 + Math.random() * 600, 0.35 * v, 0.035);
    this.tone(c, 1900 + Math.random() * 300, 0.18 * v, 0.05, 'triangle');
    this.burst(c, 'highpass', 2500, 0.7, 0.3 * v, 0.02);
  }

  // ball on cushion: a soft thud
  cushion(speed: number) {
    const c = this.live();
    if (!c || speed < 0.05) return;
    const v = Math.min(1, speed / 5) ** 0.7;
    this.burst(c, 'lowpass', 380, 0.8, 0.5 * v, 0.09);
    this.tone(c, 110, 0.25 * v, 0.08);
  }

  // into the pocket: a knock on the leather, then the ball rolling away inside the table
  pocket() {
    const c = this.live();
    if (!c) return;
    this.burst(c, 'lowpass', 520, 1, 0.55, 0.12);
    this.tone(c, 140, 0.35, 0.12);
    for (let i = 1; i <= 3; i++) this.burst(c, 'bandpass', 900 - i * 120, 2, 0.12 / i, 0.06, 0.08 + i * 0.07);
  }

  // the tip on the cue ball
  strike(speed: number) {
    const c = this.live();
    if (!c) return;
    const v = Math.min(1, speed / 7) ** 0.6;
    this.tone(c, 1300, 0.3 * v, 0.03, 'triangle');
    this.burst(c, 'bandpass', 1800, 1.2, 0.35 * v, 0.03);
  }
}
