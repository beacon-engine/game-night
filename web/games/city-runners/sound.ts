// Little synthesised sounds: a hop for a jump, a ping for a coin, a chime for a power-up, a thud
// for a stumble, and the drone's whine. Browsers only allow sound after a click or key on the page
// (the TV app allows it straight away), so unlock() is called on the first one.
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { osc: OscillatorNode; gain: GainNode } | null = null;
  private last = new Map<string, number>(); // so a crowd picking up coins together isn't deafening

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  jump() { this.tone('jump', 'square', 300, 620, 0.12, 0.12); }
  land() { this.tone('land', 'triangle', 140, 90, 0.06, 0.1); }
  coin() { this.tone('coin', 'sine', 1320, 1760, 0.09, 0.14); }
  power() { [660, 880, 1100].forEach((f, i) => this.tone(`power${i}`, 'triangle', f, f, 0.12, 0.16, i * 0.07)); }
  stumble() { this.tone('stumble', 'sawtooth', 160, 60, 0.22, 0.2); }
  out() { this.tone('out', 'sawtooth', 420, 70, 0.6, 0.22); }
  shield() { this.tone('shield', 'sine', 500, 1000, 0.25, 0.18); }

  // The drone's whine, louder the closer it is to catching someone (0: gone)
  whine(level: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    if (!this.drone) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sawtooth';
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master);
      osc.start();
      this.drone = { osc, gain };
    }
    const now = ctx.currentTime;
    this.drone.osc.frequency.setTargetAtTime(220 + level * 140 + Math.sin(now * 30) * 6, now, 0.05);
    this.drone.gain.gain.setTargetAtTime(level * 0.05, now, 0.1);
  }

  silence() { this.whine(0); }

  private tone(key: string, type: OscillatorType, from: number, to: number, length: number, volume: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const now = ctx.currentTime + delay;
    if ((this.last.get(key) ?? -1) > now - 0.04) return;
    this.last.set(key, now);
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + length);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + length + 0.02);
  }
}
