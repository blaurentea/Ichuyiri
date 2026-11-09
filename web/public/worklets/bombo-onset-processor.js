/**
 * BomboOnsetProcessor — Real-time AudioWorkletProcessor (128-sample quantum = ~2.67ms @ 48kHz).
 *
 * Splits incoming raw microphone PCM into:
 *   1. Low Body Band (~95 Hz biquad bandpass) -> measures cuero / thump weight
 *   2. Mazo Attack Band (~650 Hz biquad bandpass) -> pinpoints sharp strike onset
 * Uses adaptive exponential baseline + 75ms refractory window to catch fast Sikuri repiques
 * while rejecting steady ambient room noise.
 */
class BomboOnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sensitivity = 1.0; // 0.4 (less sensitive) .. 2.2 (very sensitive)
    this.refractorySec = 0.075; // 75ms allows rapid repiques
    this.lastOnsetTime = -1.0;

    // Biquad filter states: Low band (~95 Hz, Q=1.0) & Attack band (~680 Hz, Q=0.75)
    this.lowCoeffs = this._makeBandpass(95, 1.0, sampleRate);
    this.attCoeffs = this._makeBandpass(680, 0.75, sampleRate);
    this.lowState = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.attState = { x1: 0, x2: 0, y1: 0, y2: 0 };

    this.prevLogLow = 0;
    this.prevLogAtt = 0;
    this.noiseBaseline = 0.008;
    this.peakHoldWeight = 0;
    this.pendingOnset = null;
    this.meterCounter = 0;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (typeof data.sensitivity === 'number') {
        this.sensitivity = Math.max(0.25, Math.min(3.0, data.sensitivity));
      }
    };
  }

  _makeBandpass(f0, Q, fs) {
    const w0 = (2 * Math.PI * f0) / fs;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    };
  }

  _stepBiquad(sample, c, s) {
    const y = c.b0 * sample + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
    s.x2 = s.x1;
    s.x1 = sample;
    s.y2 = s.y1;
    s.y1 = y;
    return y;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const ch = input[0];
    const n = ch.length;
    let sumSq = 0;
    let sumLowSq = 0;
    let sumAttSq = 0;

    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const xl = this._stepBiquad(x, this.lowCoeffs, this.lowState);
      const xa = this._stepBiquad(x, this.attCoeffs, this.attState);
      sumSq += x * x;
      sumLowSq += xl * xl;
      sumAttSq += xa * xa;
    }

    const fullRms = Math.sqrt(sumSq / n);
    const lowRms = Math.sqrt(sumLowSq / n);
    const attRms = Math.sqrt(sumAttSq / n);

    const logLow = Math.log1p(35.0 * lowRms);
    const logAtt = Math.log1p(50.0 * attRms);

    const fluxLow = Math.max(0, logLow - this.prevLogLow);
    const fluxAtt = Math.max(0, logAtt - this.prevLogAtt);
    this.prevLogLow = logLow;
    this.prevLogAtt = logAtt;

    const novelty = 0.52 * fluxLow + 0.48 * fluxAtt;

    // Update slow adaptive noise baseline
    if (novelty < this.noiseBaseline * 2.0) {
      this.noiseBaseline = 0.985 * this.noiseBaseline + 0.015 * novelty;
    } else {
      this.noiseBaseline = 0.997 * this.noiseBaseline + 0.003 * novelty;
    }

    const dynamicThresh = (0.048 + this.noiseBaseline * 2.8) / this.sensitivity;
    const minGateRms = 0.006 / this.sensitivity;

    // If we triggered 1-3 blocks ago (~8ms peak capture window), collect true body weight then emit
    if (this.pendingOnset !== null) {
      this.pendingOnset.blocksLeft -= 1;
      this.pendingOnset.maxLow = Math.max(this.pendingOnset.maxLow, lowRms);
      this.pendingOnset.maxFull = Math.max(this.pendingOnset.maxFull, fullRms);
      if (this.pendingOnset.blocksLeft <= 0) {
        const weight = Math.min(1.0, this.pendingOnset.maxLow * 7.5 + this.pendingOnset.maxFull * 2.5);
        this.port.postMessage({
          type: 'onset',
          audioTime: this.pendingOnset.onsetTime,
          novelty: this.pendingOnset.novelty,
          weight: Number(weight.toFixed(3)),
        });
        this.pendingOnset = null;
      }
    } else if (
      novelty >= dynamicThresh &&
      fullRms >= minGateRms &&
      currentTime - this.lastOnsetTime >= this.refractorySec
    ) {
      this.lastOnsetTime = currentTime;
      this.pendingOnset = {
        onsetTime: currentTime,
        novelty,
        maxLow: lowRms,
        maxFull: fullRms,
        blocksLeft: 3, // ~8 ms peak body integration
      };
    }

    // UI level meter (~25 Hz)
    this.meterCounter += 1;
    if (this.meterCounter >= 14) {
      this.meterCounter = 0;
      this.port.postMessage({
        type: 'meter',
        rms: Math.min(1.0, fullRms * 4.5),
        lowRms: Math.min(1.0, lowRms * 6.5),
        attRms: Math.min(1.0, attRms * 6.5),
      });
    }

    return true;
  }
}

registerProcessor('bombo-onset-processor', BomboOnsetProcessor);

