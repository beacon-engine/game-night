// Engines: one synthesised V8 drone per person driving, its pitch following their speed, plus a
// thump for contact and a crunch of metal for the wall. Browsers only allow sound after a click or
// key on the page (the TV app allows it straight away), so unlock() is called on the first one.
interface Voice { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode }

export class Engines {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const tone = this.ctx.createBiquadFilter(); // takes the fizz off the sawtooth
      tone.type = 'lowpass';
      tone.frequency.value = 900;
      this.master.connect(tone).connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // Every frame: who is driving, how fast (m/s) and how hard
  update(cars: { id: string; v: number; throttle: number }[]) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, live = new Set<string>();
    const share = 1 / Math.max(1, cars.length);
    for (const c of cars) {
      live.add(c.id);
      const v = this.voices.get(c.id) ?? this.voice(c.id);
      const hz = 34 + c.v * 1.45 + c.throttle * 6;
      v.osc.frequency.setTargetAtTime(hz, now, 0.05);
      v.sub.frequency.setTargetAtTime(hz / 2, now, 0.05);
      v.gain.gain.setTargetAtTime((0.05 + 0.07 * c.throttle) * share, now, 0.08);
    }
    for (const [id, v] of this.voices) if (!live.has(id)) this.stop(id, v);
  }

  silence() {
    for (const [id, v] of this.voices) this.stop(id, v);
  }

  thump(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    gain.gain.setValueAtTime(0.35 * strength, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  private voice(id: string): Voice {
    const ctx = this.ctx!, gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator(), sub = ctx.createOscillator();
    osc.type = 'sawtooth';
    sub.type = 'square';
    osc.connect(gain);
    sub.connect(gain);
    gain.connect(this.master!);
    osc.start();
    sub.start();
    const v = { osc, sub, gain };
    this.voices.set(id, v);
    return v;
  }

  // A burst of filtered noise: metal on concrete
  crunch(strength = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const t = ctx.currentTime, len = 0.35;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buf;
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.8;
    gain.gain.value = 0.5 * Math.min(1, strength);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(t);
    this.thump(strength);
  }

  private stop(id: string, v: Voice) {
    const t = this.ctx!.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.1);
    v.osc.stop(t + 0.5);
    v.sub.stop(t + 0.5);
    this.voices.delete(id);
  }
}
