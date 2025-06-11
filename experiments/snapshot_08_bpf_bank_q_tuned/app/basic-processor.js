// basic-processor.js (LPF + 4x BPF Filterbank, BPF peak gain = Q, BPF Q_max = 7.0)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.sampleRate = sampleRate; // Globally available

    // Main LPF parameters
    this.frequency = 220;
    this.loopGain = 0.995;
    this.cutoffParam = 0.5;
    this.resonanceParam = 0.1;
    // Excitation parameters
    this.bowForce = 0.02;
    this.sawPulseMixParam = 0.5;
    this.pulseWidthParam = 0.5;
    this.toneNoiseMixParam = 0.5;

    // --- BPF Filterbank Parameters ---
    this.violinOpenStringFreqs = [196.00, 293.66, 440.00, 659.25]; // G3, D4, A4, E5
    this.numBpfChannels = this.violinOpenStringFreqs.length;

    // UI Controlled Parameters for BPF Bank
    this.bpfQParam = 0.1; // Global Q for all BPFs (0-1 from UI, maps to 0.707-7.0 now)
    this.bpfBankMixLevelParam = 0.5; // Global mix for the summed BPF bank output vs LPF (was 0.25)

    if (options && options.processorOptions) {
        this.frequency = options.processorOptions.frequency || this.frequency;
        this.loopGain = options.processorOptions.loopGain || this.loopGain;
        this.cutoffParam = options.processorOptions.cutoffParam || this.cutoffParam;
        this.resonanceParam = options.processorOptions.resonanceParam || this.resonanceParam;
        this.bowForce = options.processorOptions.bowForce || this.bowForce;
        this.sawPulseMixParam = options.processorOptions.sawPulseMixParam || this.sawPulseMixParam;
        this.pulseWidthParam = options.processorOptions.pulseWidthParam || this.pulseWidthParam;
        this.toneNoiseMixParam = options.processorOptions.toneNoiseMixParam || this.toneNoiseMixParam;
        this.bpfQParam = options.processorOptions.bpfQParam || this.bpfQParam;
        this.bpfBankMixLevelParam = options.processorOptions.bpfBankMixLevelParam || this.bpfBankMixLevelParam;
    }

    // LPF Coefficients & State
    this.lpf_b0 = 1; this.lpf_b1 = 0; this.lpf_b2 = 0; this.lpf_a1 = 0; this.lpf_a2 = 0;
    this.lpf_z1 = 0; this.lpf_z2 = 0;

    // BPF Filterbank Coefficients & State (Arrays)
    this.bp_b0 = new Float32Array(this.numBpfChannels);
    this.bp_b1 = new Float32Array(this.numBpfChannels);
    this.bp_b2 = new Float32Array(this.numBpfChannels);
    this.bp_a1 = new Float32Array(this.numBpfChannels);
    this.bp_a2 = new Float32Array(this.numBpfChannels);
    this.bp_z1_state = new Float32Array(this.numBpfChannels);
    this.bp_z2_state = new Float32Array(this.numBpfChannels);

    this.delayLine = null; this.currentIndex = 0; this.delaySamples = 0;
    this.sawPhase = 0.0; this.isBowing = false;

    this._calculateLpfCoefficients();
    this._calculateBpfBankCoefficients();
    this._initializeDelayLine();
    this.port.onmessage = this._handleMessage.bind(this);
  }

  _handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'setBowing') {
      if (typeof data.isBowing === 'boolean') {
          this.isBowing = data.isBowing;
          if (this.isBowing) { this._resetFilterStates(); this._resetSawPhase(); }
       }
    } else if (data.type === 'setParameter') {
      let reinitDelay = false, recalcLpf = false, recalcBpfBank = false;

        if (data.frequency !== undefined && data.frequency !== this.frequency && data.frequency > 0) {
          this.frequency = data.frequency; reinitDelay = true;
        }
        if (data.loopGain !== undefined) this.loopGain = data.loopGain;
        if (data.bowForce !== undefined) this.bowForce = data.bowForce;
        if (data.sawPulseMixParam !== undefined) this.sawPulseMixParam = data.sawPulseMixParam;
        if (data.pulseWidthParam !== undefined) this.pulseWidthParam = data.pulseWidthParam;
        if (data.toneNoiseMixParam !== undefined) this.toneNoiseMixParam = data.toneNoiseMixParam;

        if (data.cutoffParam !== undefined && data.cutoffParam !== this.cutoffParam) {
            this.cutoffParam = data.cutoffParam; recalcLpf = true;
        }
        if (data.resonanceParam !== undefined && data.resonanceParam !== this.resonanceParam) {
            this.resonanceParam = data.resonanceParam; recalcLpf = true;
        }
        if (data.bpfQParam !== undefined && data.bpfQParam !== this.bpfQParam) {
            this.bpfQParam = data.bpfQParam;
            recalcBpfBank = true;
        }
        if (data.bpfBankMixLevelParam !== undefined && data.bpfBankMixLevelParam !== this.bpfBankMixLevelParam) {
            this.bpfBankMixLevelParam = data.bpfBankMixLevelParam;
        }

      if (reinitDelay) {
          this._initializeDelayLine();
      } else {
          if (recalcLpf) this._calculateLpfCoefficients();
          if (recalcBpfBank) this._calculateBpfBankCoefficients();
      }
    }
  }

  _calculateLpfCoefficients() {
    const Fs = this.sampleRate;
    const minF = 40, maxF = Math.min(18000, Fs * 0.45);
    let actualCutoffFreq = minF * Math.pow(maxF / minF, this.cutoffParam);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));

    const minQ = 0.707, maxQ = 2.5;
    const currentResonanceParam = Math.max(0.0, Math.min(1.0, this.resonanceParam));
    const mappedResonanceParam = Math.pow(currentResonanceParam, 3);
    let actualQ_lpf = minQ * Math.pow(maxQ / minQ, mappedResonanceParam);
    if (mappedResonanceParam <=0) actualQ_lpf = minQ;
    actualQ_lpf = Math.max(minQ, Math.min(actualQ_lpf, maxQ * 1.01));

    const F0_lpf = actualCutoffFreq, Q_lpf = actualQ_lpf;
    const omega_lpf = 2 * Math.PI * F0_lpf / Fs, s_lpf = Math.sin(omega_lpf), c_lpf = Math.cos(omega_lpf);
    const alpha_lpf = s_lpf / (2 * Q_lpf);
    const b0_lpf_coeff = (1 - c_lpf) / 2, b1_lpf_coeff = 1 - c_lpf, b2_lpf_coeff = (1 - c_lpf) / 2;
    const a0_lpf_coeff = 1 + alpha_lpf, a1_lpf_rbj = -2 * c_lpf, a2_lpf_rbj = 1 - alpha_lpf;

    this.lpf_b0 = b0_lpf_coeff / a0_lpf_coeff;
    this.lpf_b1 = b1_lpf_coeff / a0_lpf_coeff;
    this.lpf_b2 = b2_lpf_coeff / a0_lpf_coeff;
    this.lpf_a1 = a1_lpf_rbj / a0_lpf_coeff;
    this.lpf_a2 = a2_lpf_rbj / a0_lpf_coeff;
  }

  _calculateBpfBankCoefficients() {
    const Fs = this.sampleRate;
    const minActualBQ = 0.707;
    const maxActualBQ = 7.0; // Adjusted BPF Q_max
    const currentBpfQParam = Math.max(0.0, Math.min(1.0, this.bpfQParam));
    const actualGlobalBQ = minActualBQ + (currentBpfQParam * (maxActualBQ - minActualBQ));

    for (let i = 0; i < this.numBpfChannels; i++) {
        const F0_bpf = this.violinOpenStringFreqs[i];
        const Q_bpf = actualGlobalBQ;

        if (F0_bpf <=0 || F0_bpf >= Fs / 2) {
            this.bp_b0[i] = 1; this.bp_b1[i] = 0; this.bp_b2[i] = 0;
            this.bp_a1[i] = 0; this.bp_a2[i] = 0;
            continue;
        }

        const omega_bpf = 2 * Math.PI * F0_bpf / Fs;
        const s_bpf = Math.sin(omega_bpf);
        const c_bpf = Math.cos(omega_bpf);
        const alpha_bpf = s_bpf / (2 * Q_bpf);

        // BPF coefficients for Peak Gain = Q
        const b0_coeff = Q_bpf * alpha_bpf; 
        const b1_coeff = 0;
        const b2_coeff = -(Q_bpf * alpha_bpf); 

        const a0_coeff = 1 + alpha_bpf;
        const a1_rbj = -2 * c_bpf;
        const a2_rbj = 1 - alpha_bpf;

        this.bp_b0[i] = b0_coeff / a0_coeff;
        this.bp_b1[i] = b1_coeff / a0_coeff;
        this.bp_b2[i] = b2_coeff / a0_coeff;
        this.bp_a1[i] = a1_rbj / a0_coeff;
        this.bp_a2[i] = a2_rbj / a0_coeff;
    }
  }

  _resetFilterStates() {
    this.lpf_z1 = 0.0; this.lpf_z2 = 0.0;
    for (let i = 0; i < this.numBpfChannels; i++) {
        this.bp_z1_state[i] = 0.0;
        this.bp_z2_state[i] = 0.0;
    }
  }
  _resetSawPhase() { this.sawPhase = 0.0; }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    if (this.delaySamples < 2) {
        console.error(`[Processor] InitDelay: Invalid samples (${this.delaySamples}) for Freq ${this.frequency}Hz.`);
        this.delayLine = null; return;
    }
    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;
    this._resetFilterStates();
    this._resetSawPhase();
    this._calculateLpfCoefficients();
    this._calculateBpfBankCoefficients();
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); return true;
    }
    const outputChannel = outputs[0][0];
    const phaseIncrement = this.frequency / this.sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      const x_n = this.delayLine[this.currentIndex];

      const y_n_lpf = this.lpf_b0 * x_n + this.lpf_z1;
      this.lpf_z1 = (this.lpf_b1 * x_n) - (this.lpf_a1 * y_n_lpf) + this.lpf_z2;
      this.lpf_z2 = (this.lpf_b2 * x_n) - (this.lpf_a2 * y_n_lpf);

      let y_n_bpf_summed = 0.0;
      for (let ch = 0; ch < this.numBpfChannels; ch++) {
          const y_n_bpf_ch = this.bp_b0[ch] * x_n + this.bp_z1_state[ch];
          this.bp_z1_state[ch] = (this.bp_b1[ch] * x_n) - (this.bp_a1[ch] * y_n_bpf_ch) + this.bp_z2_state[ch];
          this.bp_z2_state[ch] = (this.bp_b2[ch] * x_n) - (this.bp_a2[ch] * y_n_bpf_ch);
          y_n_bpf_summed += y_n_bpf_ch;
      }
      if (this.numBpfChannels > 0) {
          y_n_bpf_summed /= this.numBpfChannels;
      }

      const y_n_combined = (y_n_lpf * (1.0 - this.bpfBankMixLevelParam)) + (y_n_bpf_summed * this.bpfBankMixLevelParam);

      outputChannel[i] = y_n_combined;
      let feedbackSample = y_n_combined * this.loopGain;

      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        const actualPulseWidth = Math.max(0.01, Math.min(0.99, this.pulseWidthParam));
        let pulseSignal = (this.sawPhase < actualPulseWidth) ? 1.0 : -1.0;
        pulseSignal = -pulseSignal;

        this.sawPhase += phaseIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;

        const noiseSignal = (Math.random() * 2 - 1);
        const combinedTone = (sawtoothSignal * this.sawPulseMixParam) + (pulseSignal * (1.0 - this.sawPulseMixParam));
        const finalExcitationMix = (combinedTone * this.toneNoiseMixParam) + (noiseSignal * (1.0 - this.toneNoiseMixParam));
        feedbackSample += finalExcitationMix * this.bowForce;
      }
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);
