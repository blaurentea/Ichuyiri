import type { BomboEvent, MicMeterState } from '../types';

export interface MicOnsetPayload {
  audioTime: number;
  trackTime: number;
  weight: number;
  novelty: number;
}

type OnsetListener = (payload: MicOnsetPayload) => void;
type MeterListener = (meter: MicMeterState) => void;

export class IchuyiriAudioEngine {
  private ctx: AudioContext | null = null;
  private masterEl: HTMLAudioElement;
  private sourceConnected = false;

  // Zero-artifact 3-stage Studio EQ Sculptor
  private karaokeHighPass: BiquadFilterNode | null = null;
  private bomboResonantEq: BiquadFilterNode | null = null;
  private sikuLowPass: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;

  private bomboResonanceHz = 100;
  private bomboLevel = 1.0; // 0 = Karaoke Cut, 1.0 = Natural Untouched, 1.5 = Deep Bombo Boost
  private sikuLevel = 1.0; // 0 = Solo Low Bombo, 1.0 = Full Natural Sikus
  private guideVolume = 0.0; // Optional organic bombo guide pulse

  // Sub-millisecond smooth playhead interpolation
  private anchorMediaTime = 0;
  private anchorCtxTime = 0;

  // Guide pulse scheduler state
  private trackEvents: BomboEvent[] = [];
  private lastScheduledIdx = -1;
  private schedulerTimer: number | null = null;

  // Microphone + AudioWorklet state
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentSink: GainNode | null = null;
  private workletLoaded = false;

  private onsetListeners = new Set<OnsetListener>();
  private meterListeners = new Set<MeterListener>();

  private latencyMs = 28;
  private sensitivity = 1.15;
  private playbackRate = 1.0;
  private loopRange: { start: number; end: number } | null = null;
  private calibrationActive = false;

  constructor() {
    this.masterEl = new Audio();
    this.masterEl.crossOrigin = 'anonymous';
    this.masterEl.preload = 'auto';

    const savedLat = localStorage.getItem('ichuyiri_latency_ms');
    if (savedLat !== null && !Number.isNaN(Number(savedLat))) {
      this.latencyMs = Number(savedLat);
    }

    this.masterEl.addEventListener('timeupdate', () => {
      if (this.ctx && !this.masterEl.paused) {
        this.anchorMediaTime = this.masterEl.currentTime;
        this.anchorCtxTime = this.ctx.currentTime;
      }
    });

    this.masterEl.addEventListener('seeked', () => {
      this.anchorMediaTime = this.masterEl.currentTime;
      if (this.ctx) this.anchorCtxTime = this.ctx.currentTime;
      this.resetGuideCursor(this.masterEl.currentTime);
    });
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.sourceConnected && this.ctx) {
      const src = this.ctx.createMediaElementSource(this.masterEl);

      this.karaokeHighPass = this.ctx.createBiquadFilter();
      this.karaokeHighPass.type = 'highpass';
      this.karaokeHighPass.frequency.value = 20;
      this.karaokeHighPass.Q.value = 0.707;

      this.bomboResonantEq = this.ctx.createBiquadFilter();
      this.bomboResonantEq.type = 'peaking';
      this.bomboResonantEq.frequency.value = this.bomboResonanceHz;
      this.bomboResonantEq.Q.value = 1.15;
      this.bomboResonantEq.gain.value = 0;

      this.sikuLowPass = this.ctx.createBiquadFilter();
      this.sikuLowPass.type = 'lowpass';
      this.sikuLowPass.frequency.value = 20000;
      this.sikuLowPass.Q.value = 0.707;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.95;

      src
        .connect(this.karaokeHighPass)
        .connect(this.bomboResonantEq)
        .connect(this.sikuLowPass)
        .connect(this.masterGain)
        .connect(this.ctx.destination);

      this.sourceConnected = true;
      this.updateSculptorFilters();
    }
    return this.ctx;
  }

  private updateSculptorFilters(): void {
    if (!this.ctx || !this.karaokeHighPass || !this.bomboResonantEq || !this.sikuLowPass) return;

    this.bomboResonantEq.frequency.value = Math.max(45, Math.min(180, this.bomboResonanceHz));

    // Bombo Control:
    // 1.0 = 100% Pure Original Audio (20Hz HP, 0dB Peaking)
    // < 1.0 = Karaoke Mode (sweeps HP up to 195Hz + cuts drum resonance up to -15dB)
    // > 1.0 = Deep Bombo Boost (boosts drum fundamental up to +10.5dB)
    if (this.bomboLevel >= 0.98 && this.bomboLevel <= 1.02) {
      this.karaokeHighPass.frequency.value = 20;
      this.bomboResonantEq.gain.value = 0;
    } else if (this.bomboLevel < 0.98) {
      const cutRatio = 1 - this.bomboLevel; // 0..1
      this.karaokeHighPass.frequency.value = 20 + cutRatio * 175;
      this.bomboResonantEq.gain.value = -cutRatio * 15;
    } else {
      const boostRatio = (this.bomboLevel - 1.0) / 0.5; // 0..1
      this.karaokeHighPass.frequency.value = 20;
      this.bomboResonantEq.gain.value = Math.min(11, boostRatio * 10.5);
    }

    // Sikus Control:
    // 1.0 = Full clear panpipes (20kHz LP)
    // 0.0 = Solo Low Bombo envelope (~155Hz LP, just like MATLAB bandpass preview!)
    if (this.sikuLevel >= 0.98) {
      this.sikuLowPass.frequency.value = 20000;
    } else {
      const minHz = 155;
      const maxHz = 16000;
      const curved = Math.pow(Math.max(0, this.sikuLevel), 2.2);
      this.sikuLowPass.frequency.value = minHz + curved * (maxHz - minHz);
    }
  }

  async loadTrack(audioUrl: string, resonanceHz: number, events: BomboEvent[]): Promise<void> {
    this.pause();
    this.bomboResonanceHz = resonanceHz || 100;
    this.trackEvents = events;
    this.updateSculptorFilters();

    this.masterEl.src = audioUrl;
    this.applyPreservesPitch();
    this.masterEl.playbackRate = this.playbackRate;
    this.masterEl.load();

    await new Promise<void>((resolve) => {
      const done = () => {
        this.masterEl.removeEventListener('canplay', done);
        resolve();
      };
      this.masterEl.addEventListener('canplay', done);
    });

    this.anchorMediaTime = 0;
    this.resetGuideCursor(0);
  }

  private applyPreservesPitch(): void {
    const el = this.masterEl as HTMLAudioElement & {
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
  }

  private resetGuideCursor(atTrackSec: number): void {
    let idx = -1;
    for (let i = 0; i < this.trackEvents.length; i++) {
      if (this.trackEvents[i].t < atTrackSec - 0.02) {
        idx = i;
      } else {
        break;
      }
    }
    this.lastScheduledIdx = idx;
  }

  async play(): Promise<void> {
    const ctx = this.ensureContext();
    this.applyPreservesPitch();
    this.masterEl.playbackRate = this.playbackRate;

    if (
      this.loopRange &&
      (this.masterEl.currentTime < this.loopRange.start || this.masterEl.currentTime >= this.loopRange.end)
    ) {
      this.seek(this.loopRange.start);
    }

    await this.masterEl.play();
    this.anchorMediaTime = this.masterEl.currentTime;
    this.anchorCtxTime = ctx.currentTime;
    this.resetGuideCursor(this.masterEl.currentTime);
    this.startSchedulerLoop();
  }

  pause(): void {
    this.masterEl.pause();
    this.anchorMediaTime = this.masterEl.currentTime;
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  seek(timeSec: number): void {
    const clamped = Math.max(0, Math.min(this.masterEl.duration || 9999, timeSec));
    this.masterEl.currentTime = clamped;
    this.anchorMediaTime = clamped;
    if (this.ctx) this.anchorCtxTime = this.ctx.currentTime;
    this.resetGuideCursor(clamped);
  }

  private startSchedulerLoop(): void {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
    }
    this.schedulerTimer = window.setInterval(() => {
      if (this.masterEl.paused || !this.ctx) return;

      const tNow = this.getSmoothTime();

      // Section A-B loop check
      if (this.loopRange && tNow >= this.loopRange.end - 0.02) {
        this.seek(this.loopRange.start);
        return;
      }

      // Optional Organic Bombo Guide Pulse Scheduler (65ms lookahead)
      if (this.guideVolume > 0.01) {
        const horizonTrackSec = tNow + 0.065 * this.playbackRate;
        while (
          this.lastScheduledIdx + 1 < this.trackEvents.length &&
          this.trackEvents[this.lastScheduledIdx + 1].t <= horizonTrackSec
        ) {
          this.lastScheduledIdx += 1;
          const ev = this.trackEvents[this.lastScheduledIdx];
          const deltaRealSec = Math.max(0, (ev.t - tNow) / this.playbackRate);
          this.triggerWarmDrumPulse(this.ctx.currentTime + deltaRealSec, ev.kind, ev.weight * this.guideVolume);
        }
      } else {
        this.resetGuideCursor(tNow);
      }
    }, 25);
  }

  /** Warm, natural membrane thud + gentle wood mallet click (never harsh or synthetic). */
  private triggerWarmDrumPulse(when: number, kind: string, level: number): void {
    if (!this.ctx) return;
    const gainVal = Math.min(0.85, Math.max(0.05, level * (kind === 'acento' ? 0.75 : 0.45)));

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    const startFreq = kind === 'acento' ? 148 : kind === 'repique' ? 175 : 122;
    const endFreq = kind === 'acento' ? 54 : 62;

    osc.frequency.setValueAtTime(startFreq, when);
    osc.frequency.exponentialRampToValueAtTime(endFreq, when + 0.075);

    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(gainVal, when + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);

    osc.connect(env).connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + 0.12);
  }

  /** Butter-smooth 120fps interpolated track timestamp (eliminates browser <audio>.currentTime stepping). */
  getSmoothTime(): number {
    if (this.masterEl.paused || !this.ctx) {
      return this.masterEl.currentTime || 0;
    }
    const elapsedCtx = Math.max(0, this.ctx.currentTime - this.anchorCtxTime);
    const est = this.anchorMediaTime + elapsedCtx * this.playbackRate;
    const raw = this.masterEl.currentTime;
    if (Math.abs(est - raw) > 0.045) {
      this.anchorMediaTime = raw;
      this.anchorCtxTime = this.ctx.currentTime;
      return raw;
    }
    return est;
  }

  get isPlaying(): boolean {
    return !this.masterEl.paused && !this.masterEl.ended;
  }

  get currentTime(): number {
    return this.getSmoothTime();
  }

  setSikusVolume(vol: number): void {
    this.sikuLevel = Math.max(0, Math.min(1.0, vol));
    this.updateSculptorFilters();
  }

  setBombosVolume(vol: number): void {
    this.bomboLevel = Math.max(0, Math.min(1.5, vol));
    this.updateSculptorFilters();
  }

  setGuideVolume(vol: number): void {
    this.guideVolume = Math.max(0, Math.min(1.0, vol));
    this.resetGuideCursor(this.getSmoothTime());
  }

  setPlaybackRate(rate: number): void {
    if (this.ctx && !this.masterEl.paused) {
      this.anchorMediaTime = this.getSmoothTime();
      this.anchorCtxTime = this.ctx.currentTime;
    }
    this.playbackRate = Math.max(0.5, Math.min(1.2, rate));
    this.applyPreservesPitch();
    this.masterEl.playbackRate = this.playbackRate;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  setLoopRange(range: { start: number; end: number } | null): void {
    this.loopRange = range;
  }

  setLatencyMs(ms: number): void {
    this.latencyMs = Math.max(0, Math.min(200, Math.round(ms)));
    localStorage.setItem('ichuyiri_latency_ms', String(this.latencyMs));
  }

  getLatencyMs(): number {
    return this.latencyMs;
  }

  setSensitivity(val: number): void {
    this.sensitivity = Math.max(0.3, Math.min(2.6, val));
    if (this.workletNode) {
      this.workletNode.port.postMessage({ sensitivity: this.sensitivity });
    }
  }

  async enableMicrophone(): Promise<void> {
    if (this.micStream) return;
    const ctx = this.ensureContext();

    if (!this.workletLoaded) {
      await ctx.audioWorklet.addModule('/worklets/bombo-onset-processor.js');
      this.workletLoaded = true;
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    this.micSource = ctx.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(ctx, 'bombo-onset-processor');
    this.workletNode.port.postMessage({ sensitivity: this.sensitivity });

    this.silentSink = ctx.createGain();
    this.silentSink.gain.value = 0;

    this.micSource.connect(this.workletNode);
    this.workletNode.connect(this.silentSink);
    this.silentSink.connect(ctx.destination);

    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'meter') {
        for (const cb of this.meterListeners) {
          cb({ rms: msg.rms, lowRms: msg.lowRms, attRms: msg.attRms });
        }
      } else if (msg.type === 'onset') {
        const nowCtx = ctx.currentTime;
        const elapsedSinceWorklet = Math.max(0, nowCtx - msg.audioTime);
        const totalDelaySec = this.calibrationActive
          ? elapsedSinceWorklet
          : elapsedSinceWorklet + this.latencyMs / 1000;
        const compensatedTrackTime = this.getSmoothTime() - totalDelaySec * this.playbackRate;

        const payload: MicOnsetPayload = {
          audioTime: msg.audioTime,
          trackTime: compensatedTrackTime,
          weight: msg.weight,
          novelty: msg.novelty,
        };
        for (const cb of this.onsetListeners) {
          cb(payload);
        }
      }
    };
  }

  disableMicrophone(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    for (const cb of this.meterListeners) {
      cb({ rms: 0, lowRms: 0, attRms: 0 });
    }
  }

  get isMicActive(): boolean {
    return this.micStream !== null;
  }

  triggerManualHit(weight = 0.65): void {
    const ctx = this.ensureContext();
    this.triggerWarmDrumPulse(ctx.currentTime, weight > 0.7 ? 'acento' : 'pulso', 0.45);
    const payload: MicOnsetPayload = {
      audioTime: ctx.currentTime,
      trackTime: this.getSmoothTime(),
      weight,
      novelty: 1.0,
    };
    for (const cb of this.onsetListeners) {
      cb(payload);
    }
  }

  scheduleCalibrationClicks(count = 8, intervalSec = 0.65): number[] {
    const ctx = this.ensureContext();
    this.calibrationActive = true;
    const startAt = ctx.currentTime + 0.35;
    const beatTimes: number[] = [];

    for (let i = 0; i < count; i++) {
      const t = startAt + i * intervalSec;
      beatTimes.push(t);
      this.triggerWarmDrumPulse(t, i === 0 ? 'acento' : 'pulso', 0.9);
    }

    window.setTimeout(
      () => {
        this.calibrationActive = false;
      },
      Math.ceil((0.45 + count * intervalSec) * 1000),
    );

    return beatTimes;
  }

  stopCalibrationMode(): void {
    this.calibrationActive = false;
  }

  onOnset(cb: OnsetListener): () => void {
    this.onsetListeners.add(cb);
    return () => this.onsetListeners.delete(cb);
  }

  onMeter(cb: MeterListener): () => void {
    this.meterListeners.add(cb);
    return () => this.meterListeners.delete(cb);
  }
}
