// Synthesised sound: the paddle's knock, bricks that ring a note higher with every brick in a combo
// (up a pentatonic scale, so a long run plays a tune), the clank of steel, charges going off, pickups,
// lasers and a lost ball. Browsers only allow sound after a click or a key on the page (the TV app
// allows it straight away), so unlock() is called on the first one.
const SCALE = [0, 2, 4, 7, 9]; // (semitones: a pentatonic scale)

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>(); // (the same sound no more than every few ms: four balls at once)

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

  paddle() { if (this.ok && this.throttle('paddle', 0.03)) { this.tone('square', 220, 180, 0.07, 0.07); this.tone('sine', 440, 440, 0.05, 0.08); } }
  wall() { if (this.ok && this.throttle('wall', 0.04)) this.tone('sine', 300, 260, 0.04, 0.04); }
  // a brick: the combo picks the note
  brick(combo: number) {
    if (!this.ok || !this.throttle('brick', 0.025)) return;
    const step = Math.min(combo - 1, 19), note = SCALE[step % 5] + 12 * Math.floor(step / 5);
    const f = 523 * Math.pow(2, note / 12);
    this.tone('triangle', f, f, 0.14, 0.12);
    this.tone('square', f * 2, f * 2, 0.05, 0.025);
  }
  tough() { if (this.ok && this.throttle('tough', 0.03)) this.tone('square', 330, 250, 0.06, 0.06); }
  steel() { if (this.ok && this.throttle('steel', 0.04)) { this.tone('square', 1400, 1200, 0.08, 0.04); this.tone('triangle', 2100, 1900, 0.12, 0.04); } }
  boom() {
    if (!this.ok || !this.throttle('boom', 0.06)) return;
    this.burst(0.6, 0.45, 2600, 80);
    this.tone('sine', 140, 40, 0.4, 0.3);
  }
  laser() { if (this.ok && this.throttle('laser', 0.08)) this.tone('sawtooth', 1200, 500, 0.08, 0.03); }
  launch() { if (this.ok) this.tone('triangle', 300, 700, 0.1, 0.08); }
  pickup() { if (this.ok) [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.08, 0.1, i * 0.05)); }
  life() { if (this.ok) [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.1, 0.05, i * 0.08)); }
  lost() { if (this.ok) { this.tone('sawtooth', 400, 70, 0.6, 0.12); this.burst(0.4, 0.2, 900, 80); } }
  junk() { if (this.ok) { this.burst(0.5, 0.3, 700, 60); this.tone('square', 160, 90, 0.3, 0.08); } }
  clear() { if (this.ok) [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.12, i * 0.1)); }
  count(go: boolean) { if (this.ok) this.tone('triangle', go ? 880 : 440, go ? 880 : 440, go ? 0.3 : 0.12, 0.12); }
}
