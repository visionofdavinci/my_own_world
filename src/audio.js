import { CFG, VOWELS } from './config.js';

// A sample-and-hold plus bit reducer. Built from a Blob so the whole site
// stays a flat set of static files with no extra fetch to configure.
const CRUSH_SRC = `
class Crush extends AudioWorkletProcessor {
  static get parameterDescriptors(){ return [{name:'amount', defaultValue:0.4, minValue:0, maxValue:1}]; }
  constructor(){ super(); this.hold = [0,0]; this.phase = 0; }
  process(inputs, outputs, params){
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const a = params.amount;
    const n = out[0].length;
    for (let i = 0; i < n; i++){
      const amt = a.length > 1 ? a[i] : a[0];
      const step = 1 + Math.floor(amt * 9);
      const bits = Math.max(3, 13 - Math.floor(amt * 9));
      const q = Math.pow(2, bits);
      const take = (this.phase % step) === 0;
      this.phase++;
      for (let c = 0; c < out.length; c++){
        const src = inp[c] || inp[0];
        if (take) this.hold[c] = src[i];
        out[c][i] = Math.round(this.hold[c] * q) / q;
      }
    }
    return true;
  }
}
registerProcessor('crush', Crush);
`;

const rnd = (a, b) => a + Math.random() * (b - a);

export class Voice {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.energy = 0;
    this.speakingUntil = 0;
    this._buf = null;
    this._vo = new Map();
  }

  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = CFG.audio.voiceGain;

    // voice -> crusher -> analyser -> master
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this._buf = new Float32Array(this.analyser.fftSize);

    let tail = this.voiceBus;
    try {
      const url = URL.createObjectURL(new Blob([CRUSH_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.crush = new AudioWorkletNode(ctx, 'crush');
      this.crush.parameters.get('amount').value = CFG.audio.crush;
      tail.connect(this.crush);
      tail = this.crush;
    } catch (e) {
      // worklets unavailable: a waveshaper still gets us most of the grit
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = Math.tanh(x * 3.4) * 0.8;
      }
      ws.curve = curve;
      tail.connect(ws);
      tail = ws;
    }
    tail.connect(this.analyser);
    this.analyser.connect(this.master);

    this.bed(ctx);
    this.ready = true;
  }

  bed(ctx) {
    // low drone plus filtered noise, always present, very quiet
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    this.bedGain = g;

    [55, 82.5, 110.4].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = [0.55, 0.30, 0.12][i];
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.031;
      const lg = ctx.createGain();
      lg.gain.value = 0.9;
      lfo.connect(lg); lg.connect(o.detune);
      o.connect(og); og.connect(g);
      o.start(); lfo.start();
    });

    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource();
    ns.buffer = nb; ns.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.09;
    ns.connect(nf); nf.connect(ng); ng.connect(g);
    ns.start();
    this.noiseGain = ng;

    g.gain.linearRampToValueAtTime(CFG.audio.bedGain, ctx.currentTime + 3.5);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08);
  }

  setGlitch(level) {
    if (!this.ready || !this.crush) return;
    const p = this.crush.parameters.get('amount');
    p.setTargetAtTime(Math.min(1, CFG.audio.crush + level * 0.5), this.ctx.currentTime, 0.15);
    if (this.noiseGain) this.noiseGain.gain.setTargetAtTime(0.06 + level * 0.20, this.ctx.currentTime, 0.2);
  }

  // A short burst of noise, for punctuating interface events.
  tick(strength = 1) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const b = ctx.createBuffer(1, 1200, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0.10 * strength;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + 0.06);
  }

  syllables(text) {
    const groups = String(text).toLowerCase().match(/[aeiouy]+/g) || ['a'];
    return groups.map(g => (VOWELS[g[0]] ? g[0] : 'a'));
  }

  // Try a recorded line first; fall back to the formant synth.
  async speak(text, id) {
    if (!this.ready) return this.estimate(text);
    if (id && !this._vo.has(id)) {
      try {
        const r = await fetch(`${CFG.audio.voPath}${id}.ogg`);
        if (r.ok) {
          const ab = await r.arrayBuffer();
          this._vo.set(id, await this.ctx.decodeAudioData(ab));
        } else this._vo.set(id, null);
      } catch (e) { this._vo.set(id, null); }
    }
    const buf = id ? this._vo.get(id) : null;
    if (buf) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf; s.connect(this.voiceBus); s.start();
      this.speakingUntil = this.ctx.currentTime + buf.duration;
      return buf.duration;
    }
    return this.synth(text);
  }

  estimate(text) { return Math.max(1.1, this.syllables(text).length * 0.16); }

  synth(text) {
    const ctx = this.ctx;
    const syls = this.syllables(text);
    let t = ctx.currentTime + 0.04;
    syls.forEach((v, i) => {
      const dur = rnd(0.09, 0.15) + (i % 3 === 0 ? 0.05 : 0);
      this.utter(v, t, dur, i / Math.max(1, syls.length - 1));
      t += dur + rnd(0.018, 0.045);
    });
    this.speakingUntil = t;
    return t - ctx.currentTime;
  }

  utter(vowel, t, dur, prog) {
    const ctx = this.ctx;
    const F = VOWELS[vowel] || VOWELS.a;
    const f0 = CFG.audio.f0 * (1 + (0.5 - prog) * 0.10) * rnd(0.97, 1.03);

    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t);
    src.frequency.linearRampToValueAtTime(f0 * rnd(0.92, 1.06), t + dur);

    // ring modulation: a gain node at zero, driven by an oscillator
    const ringOsc = ctx.createOscillator();
    ringOsc.type = 'sine';
    ringOsc.frequency.value = CFG.audio.ring * rnd(0.96, 1.05);
    const ring = ctx.createGain();
    ring.gain.value = 0;
    ringOsc.connect(ring.gain);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.014);
    env.gain.setValueAtTime(1, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    src.connect(ring);
    const dry = ctx.createGain(); dry.gain.value = 0.45;
    src.connect(dry); dry.connect(env);

    F.forEach((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = [9, 12, 14][i];
      const g = ctx.createGain();
      g.gain.value = [1.0, 0.62, 0.32][i];
      ring.connect(bp); bp.connect(g); g.connect(env);
    });

    env.connect(this.voiceBus);
    src.start(t); ringOsc.start(t);
    src.stop(t + dur + 0.05); ringOsc.stop(t + dur + 0.05);

    // a consonant-ish transient in front of the vowel
    const nb = ctx.createBuffer(1, 900, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = rnd(1400, 3400); nf.Q.value = 1.4;
    const ng = ctx.createGain(); ng.gain.value = 0.30;
    ns.connect(nf); nf.connect(ng); ng.connect(this.voiceBus);
    ns.start(Math.max(ctx.currentTime, t - 0.018));
  }

  // RMS of the voice bus, used to drive the mouth.
  sample() {
    if (!this.ready || !this.analyser) { this.energy = 0; return 0; }
    this.analyser.getFloatTimeDomainData(this._buf);
    let s = 0;
    for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(s / this._buf.length);
    this.energy = Math.min(1, rms * 7.5);
    return this.energy;
  }

  get speaking() { return this.ready && this.ctx.currentTime < this.speakingUntil; }
}

/* ------------------------------------------------------------------ */
/* The listening ring: a slow generative piece in a doina mode, played   */
/* on something between a cimbalom and a music box.                      */
/* ------------------------------------------------------------------ */

// D, E, F, G#, A, B, C: the augmented second between F and G# is the colour
const MODE = [0, 2, 3, 6, 7, 9, 10];
const ROOT = 146.83;   // D3

export class MindMusic {
  constructor(voice, onNote) {
    this.voice = voice;
    this.onNote = onNote;
    this.running = false;
    this.presence = 0;
    this.notes = [];
    for (let i = 0; i < 16; i++) {
      const oct = Math.floor(i / MODE.length), deg = MODE[i % MODE.length];
      this.notes.push(ROOT * Math.pow(2, oct + deg / 12));
    }
    this.cur = 4; this.next = 0; this.phrase = 0;
  }

  ensure() {
    const ctx = this.voice.ctx;
    if (!ctx || this.out) return !!ctx;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // a feedback delay is enough of a room for a plucked string
    const dl = ctx.createDelay(1.5); dl.delayTime.value = 0.43;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.bus = ctx.createGain(); this.bus.gain.value = 1;
    this.bus.connect(this.out);
    this.bus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.out);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.7;
    this.fft = new Uint8Array(this.analyser.frequencyBinCount);
    this.out.connect(this.analyser);
    this.out.connect(this.voice.master);
    // drone on D and A
    this.drone = ctx.createGain(); this.drone.gain.value = 0.0;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 420;
    [73.42, 110.0, 146.83].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 1 ? 'sawtooth' : 'triangle'; o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      const g = ctx.createGain(); g.gain.value = [0.5, 0.12, 0.2][i];
      o.connect(g); g.connect(dlp); o.start();
    });
    dlp.connect(this.drone); this.drone.connect(this.out);
    return true;
  }

  start() {
    if (!this.ensure()) return;
    this.running = true;
    this.clock = this.ctx.currentTime + 0.6;
    this.drone.gain.setTargetAtTime(0.10, this.ctx.currentTime, 1.5);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 90);
  }

  stop() {
    this.running = false;
    if (!this.ctx) return;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    this.drone.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    clearInterval(this.timer); this.timer = null;
  }

  setPresence(p) {
    if (!this.ctx) return;
    if (Math.abs(p - this.presence) < 0.01) return;
    this.presence = p;
    const v = this.voice.muted ? 0 : 0.55 * p;
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  // look ahead and schedule notes; a random walk with phrases and rests
  schedule() {
    if (!this.running) return;
    const ctx = this.ctx;
    while (this.clock < ctx.currentTime + 0.3) {
      const beat = 0.36;
      this.phrase++;
      if (this.phrase % 12 === 0) { this.clock += beat * 2; continue; }        // breathe
      const r = Math.random();
      const step = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : 4;
      this.cur = Math.max(0, Math.min(this.notes.length - 1, this.cur + step));
      if (this.cur > 12 && Math.random() < 0.4) this.cur -= 3;
      const len = Math.random() < 0.22 ? beat * 2 : beat;
      // a quick grace note from above, the ornament that makes it a doina
      if (Math.random() < 0.18 && this.cur < this.notes.length - 1) {
        this.pluck(this.cur + 1, 0.45, this.clock);
        this.pluck(this.cur, 0.9, this.clock + 0.07);
      } else this.pluck(this.cur, 0.8 + Math.random() * 0.2, this.clock);
      if (Math.random() < 0.25) this.pluck(Math.max(0, this.cur - 4), 0.35, this.clock);
      this.clock += len;
    }
  }

  pluck(i, vel = 1, when) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const f = this.notes[i % this.notes.length];
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.22 * vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0006, t + 1.9);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.9);
    [[1, 'triangle', 0.8], [2.003, 'sine', 0.35], [3.01, 'sine', 0.12], [1.004, 'sawtooth', 0.08]].forEach(([m, type, g]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * m;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + 2);
    });
    // the hammer
    const nb = ctx.createBuffer(1, 400, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = f * 4; nf.Q.value = 2;
    const ng = ctx.createGain(); ng.gain.value = 0.25 * vel;
    ns.connect(nf); nf.connect(ng); ng.connect(env);
    ns.start(t);
    lp.connect(env); env.connect(this.bus);
    const delay = Math.max(0, (t - ctx.currentTime) * 1000);
    setTimeout(() => this.onNote?.(i % 16, vel), delay);
  }

  // sixteen rough loudness levels for the pillars
  levels(n) {
    if (!this.analyser || !this.running) return null;
    this.analyser.getByteFrequencyData(this.fft);
    const out = new Array(n);
    const bins = this.fft.length;
    for (let i = 0; i < n; i++) {
      const b = Math.min(bins - 1, 2 + Math.floor(i * (bins * 0.45) / n));
      out[i] = this.fft[b] / 255;
    }
    return out;
  }
}
