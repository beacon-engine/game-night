// Synthesised sound for the fight: each of your engines (a growl that rises with speed, while you're a
// car), the guns (blaster, cannon, scatter, the lancer's crack), hits, punches, rams and explosions, the
// whirr and clanks of changing, the specials, and the horns for a wave starting and ending. Quieter the
// further from the nearest of you. Browsers only allow sound after a click or a key on the page, so
// unlock() is called on the first one (and straight away in the TV app).
import type { SimEvent } from './sim.ts';

interface Engine { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }
export interface Driving { id: string; speed: number; car: number; boosting: boolean } // car: 1 a car .. 0 a robot

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private engines = new Map<string, Engine>();

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
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
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

  // What happened, heard from `dist` m away (from the nearest of you); `mine`: it's one of you doing it
  play(e: SimEvent, dist: number, mine: boolean, shiftTime = 0.8) {
    if (!this.ok) return;
    const k = Math.max(0.05, 1 - dist / 90) * (mine ? 1 : 0.8);
    if (k < 0.08 && e.t !== 'wave' && e.t !== 'cleared' && e.t !== 'over') return;
    switch (e.t) {
      case 'fire':
        if (!this.throttle(`fire-${e.kind}-${Math.round(dist / 12)}`, e.kind === 'blaster' ? 0.06 : 0.02)) return;
        if (e.kind === 'blaster') this.tone(1500, 420, 0.09, 0.12 * k, 'square');
        else if (e.kind === 'scatter') { this.burst(0.18, 0.4 * k, 1800, 0.6); this.tone(300, 90, 0.15, 0.2 * k, 'triangle'); }
        else if (e.kind === 'cannon') { this.tone(140, 40, 0.35, 0.45 * k, 'sine'); this.burst(0.3, 0.3 * k, 500, 0.6, 'lowpass'); }
        else if (e.kind === 'lance') { this.tone(2600, 200, 0.25, 0.18 * k, 'sawtooth'); this.burst(0.15, 0.25 * k, 3000, 1); }
        else this.burst(0.5, 0.2 * k, 900, 0.5, 'bandpass'); // (a missile away)
        break;
      case 'hit':
        if (!this.throttle(`hit${Math.round(dist / 10)}`, 0.05)) return;
        this.tone(900 + Math.random() * 600, 300, 0.07, (e.bot ? 0.16 : 0.08) * k, 'square');
        break;
      case 'block': if (this.throttle('block', 0.06)) this.tone(2200, 1600, 0.12, 0.1 * k, 'sine'); break;
      case 'boom':
        this.burst(1.2 + e.r * 0.1, 0.8 * k, 380, 0.5, 'lowpass');
        this.tone(95, 28, 0.9, 0.55 * k);
        break;
      case 'punch': this.burst(0.12, 0.18 * k, 700, 0.8); break;
      case 'smack': this.burst(0.1, 0.45 * k, 260, 1, 'lowpass'); this.tone(420, 160, 0.12, 0.25 * k, 'square'); break;
      case 'ram': this.burst(0.35, 0.7 * k, 500, 0.6, 'lowpass'); this.tone(180, 60, 0.3, 0.4 * k, 'square'); break;
      case 'slam': this.tone(70, 25, 0.8, 0.7 * k); this.burst(0.7, 0.6 * k, 220, 0.6, 'lowpass'); break;
      case 'change': {
        // the whirr of the parts moving (up to a robot, down to a car), and the clanks as they lock
        if (!this.throttle(`change${Math.round(dist)}`, 0.2)) return;
        const t = shiftTime;
        this.tone(e.robot ? 180 : 520, e.robot ? 520 : 180, t * 0.9, 0.12 * k, 'sawtooth');
        for (let i = 0; i < 4; i++) this.tone(1300 - i * 120, 500, 0.06, 0.2 * k, 'square', t * (0.25 + i * 0.22));
        this.burst(0.15, 0.3 * k, 400, 0.8, 'lowpass', t);
        break;
      }
      case 'special':
        if (e.id === 'shield') this.tone(220, 660, 0.5, 0.25 * k, 'triangle');
        else if (e.id === 'shockwave') { this.tone(60, 22, 1, 0.8 * k); this.burst(1, 0.7 * k, 300, 0.5, 'lowpass'); }
        else for (let i = 0; i < 6; i++) this.burst(0.4, 0.22 * k, 1200 + i * 120, 0.8, 'bandpass', i * 0.07);
        break;
      case 'down': if (mine) this.tone(440, 110, 0.9, 0.25, 'triangle'); break;
      case 'revived': [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.18, 0.14, 'triangle', i * 0.1)); break;
      case 'scrap': if (this.throttle('scrap', 0.05)) this.tone(1400, 2100, 0.08, 0.08, 'sine'); break;
      case 'wave': [330, 247].forEach((f, i) => this.tone(f, f * 0.98, 0.6, 0.22, 'sawtooth', i * 0.5)); break;
      case 'cleared': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.3, 0.13, 'triangle', i * 0.13)); break;
      case 'over': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.5, 0.14, 'triangle', i * 0.25)); break;
    }
  }

  // Each of your cars' engines: louder and higher the faster it goes, quiet as a robot
  drive(list: Driving[]) {
    if (!this.ok) return;
    const ctx = this.ctx!, now = ctx.currentTime;
    for (const d of list) {
      let e = this.engines.get(d.id);
      if (!e) {
        const osc = ctx.createOscillator(), sub = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        osc.type = 'sawtooth'; sub.type = 'square';
        filter.type = 'lowpass'; filter.Q.value = 2;
        gain.gain.value = 0;
        osc.connect(filter); sub.connect(filter); filter.connect(gain).connect(this.master!);
        osc.start(); sub.start();
        e = { osc, sub, gain, filter };
        this.engines.set(d.id, e);
      }
      const v = Math.min(1, d.speed / 40), f = 55 + v * 140 + (d.boosting ? 25 : 0);
      e.osc.frequency.setTargetAtTime(f, now, 0.08);
      e.sub.frequency.setTargetAtTime(f / 2, now, 0.08);
      e.filter.frequency.setTargetAtTime(400 + v * 1600 + (d.boosting ? 600 : 0), now, 0.1);
      e.gain.gain.setTargetAtTime(d.car * (0.05 + v * 0.07) / Math.max(1, list.length * 0.7), now, 0.1);
    }
    for (const [id, e] of this.engines) if (!list.some((d) => d.id === id)) e.gain.gain.setTargetAtTime(0, now, 0.15);
  }

  silence() { this.drive([]); }
}
