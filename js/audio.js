/**
 * Tiny synthesized arcade sound kit — no audio files, no network.
 * Everything is generated with the Web Audio API on first interaction.
 */
export class AudioEngine {
  constructor({ muted = false } = {}) {
    this.muted = muted;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.available = typeof window !== "undefined" && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  init() {
    if (!this.available || this.ctx) return this.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.34;
      this.master.connect(this.ctx.destination);
    } catch {
      this.available = false;
      this.ctx = null;
    }
    return this.ctx;
  }

  ensure() {
    if (this.muted) return null;
    const ctx = this.init();
    if (!ctx) return null;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.muted) this.ensure();
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.34, now, 0.015);
    }
  }

  tone({
    frequency,
    endFrequency = frequency,
    duration = 0.14,
    type = "sine",
    volume = 0.08,
    when = 0,
    attack = 0.006,
  } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const start = ctx.currentTime + Math.max(0, when);
    const end = start + duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, frequency), start);
    if (endFrequency !== frequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), end);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(end + 0.03);
  }

  noise({ duration = 0.35, volume = 0.12, when = 0, lowpass = 1600 } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 1.2);
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const start = ctx.currentTime + Math.max(0, when);
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(lowpass, start);
    filter.frequency.exponentialRampToValueAtTime(220, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.03);
  }

  click() {
    this.tone({ frequency: 760, endFrequency: 920, duration: 0.055, type: "triangle", volume: 0.045 });
  }

  turn() {
    this.tone({ frequency: 240, endFrequency: 290, duration: 0.035, type: "sine", volume: 0.018 });
  }

  eat(combo = 1) {
    const root = 470 + combo * 70;
    this.tone({ frequency: root, endFrequency: root * 1.5, duration: 0.13, type: "triangle", volume: 0.1 });
    this.tone({ frequency: root * 2, endFrequency: root * 2.7, duration: 0.16, type: "sine", volume: 0.045, when: 0.035 });
    if (combo > 2) {
      this.tone({ frequency: root * 3, endFrequency: root * 3.8, duration: 0.2, type: "sine", volume: 0.025, when: 0.08 });
    }
  }

  start() {
    [0, 0.09, 0.18, 0.27].forEach((when, index) => {
      this.tone({
        frequency: [220, 330, 440, 660][index],
        endFrequency: [330, 440, 660, 880][index],
        duration: 0.2,
        type: "triangle",
        volume: 0.055,
        when,
      });
    });
    this.tone({ frequency: 1320, endFrequency: 1760, duration: 0.25, type: "sine", volume: 0.03, when: 0.32 });
  }

  pause() {
    this.tone({ frequency: 380, endFrequency: 190, duration: 0.16, type: "sine", volume: 0.055 });
  }

  resume() {
    this.tone({ frequency: 220, endFrequency: 440, duration: 0.12, type: "sine", volume: 0.05 });
  }

  death() {
    this.tone({ frequency: 210, endFrequency: 48, duration: 0.65, type: "sawtooth", volume: 0.075 });
    this.tone({ frequency: 120, endFrequency: 35, duration: 0.8, type: "triangle", volume: 0.07 });
    this.noise({ duration: 0.5, volume: 0.15, lowpass: 2200 });
  }

  newRecord() {
    [0, 0.1, 0.2, 0.32, 0.46].forEach((when, index) => {
      this.tone({
        frequency: [523, 659, 784, 1047, 1319][index],
        duration: 0.28,
        type: "triangle",
        volume: 0.045,
        when,
      });
    });
  }

  speedUp() {
    this.tone({ frequency: 500, endFrequency: 1000, duration: 0.18, type: "sine", volume: 0.035 });
  }
}
