// basic-processor.js (Refactored for Parameter Mapping - Corrected)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.sampleRate = sampleRate; // Globally available in AudioWorkletGlobalScope

    // --- Default Internal DSP Parameter Values ---
    this.dspValues = {
        frequency: 220,
        loopGain: 0.995,
        lpfCutoff: 0.5,    // This is a 0-1 value used for internal log mapping
        lpfQ: 0.1,         // This is a 0-1 value used for internal power mapping
        // bpfQ: 0.1,        // Old: This was a 0-1 value that mapped to actual Q 0.707-7.0 for BPF bank
        bpfBankMix: 0.25,  // Mix level for the body resonance (formerly BPF bank, now modal body)
        sawPulseMix: 0.5,    // Direct 0-1 value
        pulseWidth: 0.5,     // Direct 0.01-0.99 value (slider is 0.01-0.99)
        toneNoiseMix: 0.5,   // Direct 0-1 value
        exciteIntensity: 0.02 // Direct 0-0.1 value (slider is 0-0.1)
    };

    this.paramMappings = {};

    if (options && options.processorOptions) {
        const opts = options.processorOptions;
        for (const key in opts) {
            if (key.endsWith('_dspMin')) {
                const baseKey = key.replace('_dspMin', '');
                if (!this.paramMappings[baseKey]) this.paramMappings[baseKey] = {};
                this.paramMappings[baseKey].dspMin = opts[key];
            } else if (key.endsWith('_dspMax')) {
                const baseKey = key.replace('_dspMax', '');
                if (!this.paramMappings[baseKey]) this.paramMappings[baseKey] = {};
                this.paramMappings[baseKey].dspMax = opts[key];
            }
        }
        this._updateDspValuesFromRaw(opts);
    }

    // --- Modal Body Resonator Parameters ---
    this.bodyModeFreqs = [280, 460, 550]; // Hz
    this.bodyModeQs    = [10,  15,  12];  // Q values
    this.bodyModeGains = [0.8, 1.0, 0.9]; // Relative gains
    this.numBodyModes  = this.bodyModeFreqs.length;

    this.bodyMode_b0 = new Float32Array(this.numBodyModes);
    this.bodyMode_b1 = new Float32Array(this.numBodyModes);
    this.bodyMode_b2 = new Float32Array(this.numBodyModes);
    this.bodyMode_a1 = new Float32Array(this.numBodyModes);
    this.bodyMode_a2 = new Float32Array(this.numBodyModes);
    this.bodyMode_z1_states = new Float32Array(this.numBodyModes);
    this.bodyMode_z2_states = new Float32Array(this.numBodyModes);
    
    // --- LPF Parameters & State ---
    this.lpf_b0 = 1; this.lpf_b1 = 0; this.lpf_b2 = 0; this.lpf_a1 = 0; this.lpf_a2 = 0;             
    this.lpf_z1 = 0; this.lpf_z2 = 0; 
    
    this.delayLine = null; this.currentIndex = 0; this.delaySamples = 0;
    this.sawPhase = 0.0; this.isBowing = false;

    this._recalculateAllCoefficients(); 
    this._initializeDelayLine();   
    this.port.onmessage = this._handleMessage.bind(this);
  }

  _getDspValue(paramKey, rawSliderValue) {
      if (this.paramMappings[paramKey] && 
          this.paramMappings[paramKey].dspMin !== undefined && 
          this.paramMappings[paramKey].dspMax !== undefined) {
          const min = this.paramMappings[paramKey].dspMin;
          const max = this.paramMappings[paramKey].dspMax;
          return min + (rawSliderValue * (max - min));
      }
      return rawSliderValue; 
  }

  _updateDspValuesFromRaw(rawData) {
      if (rawData.frequency !== undefined) this.dspValues.frequency = this._getDspValue('frequency', rawData.frequency);
      if (rawData.loopGain !== undefined) this.dspValues.loopGain = this._getDspValue('loopGain', rawData.loopGain);
      if (rawData.cutoffParam !== undefined) this.dspValues.lpfCutoff = rawData.cutoffParam; 
      if (rawData.resonanceParam !== undefined) this.dspValues.lpfQ = rawData.resonanceParam; 
      // if (rawData.bpfQParam !== undefined) this.dspValues.bpfQ = rawData.bpfQParam; // bpfQ is no longer directly used for modal Qs
      if (rawData.bpfBankMixLevelParam !== undefined) this.dspValues.bpfBankMix = this._getDspValue('bpfBankMixLevelParam', rawData.bpfBankMixLevelParam);
      if (rawData.sawPulseMixParam !== undefined) this.dspValues.sawPulseMix = this._getDspValue('sawPulseMixParam', rawData.sawPulseMixParam);
      if (rawData.pulseWidthParam !== undefined) this.dspValues.pulseWidth = this._getDspValue('pulseWidthParam', rawData.pulseWidthParam);
      if (rawData.toneNoiseMixParam !== undefined) this.dspValues.toneNoiseMix = this._getDspValue('toneNoiseMixParam', rawData.toneNoiseMixParam);
      if (rawData.bowForce !== undefined) this.dspValues.exciteIntensity = this._getDspValue('bowForce', rawData.bowForce);
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
      const rawValues = data; // Corrected: data object itself contains the parameters
      let reinitDelay = false, recalcLpf = false, recalcBpfBank = false; 
      
      const newMappedFreq = this._getDspValue('frequency', rawValues.frequency);
      if (rawValues.frequency !== undefined && newMappedFreq !== this.dspValues.frequency) {
          reinitDelay = true;
      }
      
      if (rawValues.cutoffParam !== undefined && rawValues.cutoffParam !== this.dspValues.lpfCutoff) {
          recalcLpf = true; 
      }
      if (rawValues.resonanceParam !== undefined && rawValues.resonanceParam !== this.dspValues.lpfQ) {
          recalcLpf = true;   
      }
      // No longer recalculating BPF bank based on bpfQParam directly, modal Qs are fixed for now.
      // If modal parameters become dynamic, this will need revisiting.
      // if (rawValues.bpfQParam !== undefined && rawValues.bpfQParam !== this.dspValues.bpfQ) { 
      //     recalcBpfBank = true;    
      // }
      
      this._updateDspValuesFromRaw(rawValues);

      if (reinitDelay) {
          this._initializeDelayLine(); 
      } else {
          if (recalcLpf) this._calculateLpfCoefficients();
          // if (recalcBpfBank) this._calculateBpfBankCoefficients(); // Old BPF bank
      }
    }
  }
  
  _recalculateAllCoefficients() { 
      this._calculateLpfCoefficients();
      this._calculateModalBodyCoefficients(); // New method for modal body
  }

  _calculateLpfCoefficients() { 
    const Fs = this.sampleRate;
    const sliderCutoff = this.dspValues.lpfCutoff; 
    const sliderReso = this.dspValues.lpfQ; 

    const minF = 40, maxF = Math.min(18000, Fs * 0.45); 
    let actualCutoffFreq = minF * Math.pow(maxF / minF, sliderCutoff);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));
    
    const mappedResonanceParam = Math.pow(Math.max(0.0, Math.min(1.0, sliderReso)), 3);
    const minQLPF = 0.707, maxQLPF = 2.5;
    let actualQ_lpf = minQLPF * Math.pow(maxQLPF / minQLPF, mappedResonanceParam); 
    if (mappedResonanceParam <=0) actualQ_lpf = minQLPF; 
    actualQ_lpf = Math.max(minQLPF, Math.min(actualQ_lpf, maxQLPF * 1.01));

    const F0_lpf = actualCutoffFreq, Q_lpf = actualQ_lpf;
    const omega_lpf = 2 * Math.PI * F0_lpf / Fs, s_lpf = Math.sin(omega_lpf), c_lpf = Math.cos(omega_lpf);
    const alpha_lpf = s_lpf / (2 * Q_lpf);
    const b0_lpf_coeff = (1 - c_lpf) / 2, b1_lpf_coeff = 1 - c_lpf, b2_lpf_coeff = (1 - c_lpf) / 2;
    const a0_lpf_coeff = 1 + alpha_lpf, a1_lpf_rbj = -2 * c_lpf, a2_lpf_rbj = 1 - alpha_lpf;
    this.lpf_b0 = b0_lpf_coeff / a0_lpf_coeff; this.lpf_b1 = b1_lpf_coeff / a0_lpf_coeff; this.lpf_b2 = b2_lpf_coeff / a0_lpf_coeff;
    this.lpf_a1 = a1_lpf_rbj / a0_lpf_coeff; this.lpf_a2 = a2_lpf_rbj / a0_lpf_coeff;
  }

  _calculateModalBodyCoefficients() {
    const Fs = this.sampleRate;
    for (let i = 0; i < this.numBodyModes; i++) {
        const F0   = this.bodyModeFreqs[i];
        const Q    = this.bodyModeQs[i];
        const Gain = this.bodyModeGains[i];

        if (F0 <= 0 || F0 >= Fs / 2 || Q <= 0) {
            // Flat response (bypass) if parameters are invalid
            this.bodyMode_b0[i] = 1; this.bodyMode_b1[i] = 0; this.bodyMode_b2[i] = 0;
            this.bodyMode_a1[i] = 0; this.bodyMode_a2[i] = 0;
            continue;
        }

        const omega = 2 * Math.PI * F0 / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * Q);

        // Coefficients for a BPF with peak gain = 1 (0dB)
        const b0_norm = alpha;
        const b1_norm = 0;
        const b2_norm = -alpha;
        const a0_norm = 1 + alpha;
        const a1_norm = -2 * c_omega;
        const a2_norm = 1 - alpha;
        
        // Apply modal gain and normalize by a0_norm
        this.bodyMode_b0[i] = (Gain * b0_norm) / a0_norm;
        this.bodyMode_b1[i] = (Gain * b1_norm) / a0_norm; // still 0
        this.bodyMode_b2[i] = (Gain * b2_norm) / a0_norm;
        this.bodyMode_a1[i] = a1_norm / a0_norm;
        this.bodyMode_a2[i] = a2_norm / a0_norm;
    }
  }

  _resetFilterStates() { 
    this.lpf_z1 = 0.0; this.lpf_z2 = 0.0;
    for (let i = 0; i < this.numBodyModes; i++) {
        this.bodyMode_z1_states[i] = 0.0; 
        this.bodyMode_z2_states[i] = 0.0;
    }
  }
  _resetSawPhase() { this.sawPhase = 0.0; }

  _initializeDelayLine() { 
    this.delaySamples = Math.floor(this.sampleRate / this.dspValues.frequency); 
    if (this.delaySamples < 2) { this.delayLine = null; return; }
    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;
    this._resetFilterStates(); 
    this._resetSawPhase();
    this._recalculateAllCoefficients(); 
  }

  process(inputs, outputs, parameters) { 
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); return true; 
    }
    const outputChannel = outputs[0][0];
    
    const phaseIncrement = this.dspValues.frequency / this.sampleRate; 
    const currentLoopGain = this.dspValues.loopGain;
    const currentPulseWidth = this.dspValues.pulseWidth;
    const currentExciteIntensity = this.dspValues.exciteIntensity;
    const currentBpfBankMix = this.dspValues.bpfBankMix; 
    const currentSawPulseMix = this.dspValues.sawPulseMix;
    const currentToneNoiseMix = this.dspValues.toneNoiseMix;

    for (let i = 0; i < outputChannel.length; i++) {
      const x_n = this.delayLine[this.currentIndex]; 
      
      const y_n_lpf = this.lpf_b0 * x_n + this.lpf_z1;
      this.lpf_z1 = (this.lpf_b1 * x_n) - (this.lpf_a1 * y_n_lpf) + this.lpf_z2;
      this.lpf_z2 = (this.lpf_b2 * x_n) - (this.lpf_a2 * y_n_lpf);
      
      let y_n_body_modes_summed = 0.0;
      for (let ch = 0; ch < this.numBodyModes; ch++) {
          const y_n_mode_ch = this.bodyMode_b0[ch] * x_n + this.bodyMode_z1_states[ch];
          this.bodyMode_z1_states[ch] = (this.bodyMode_b1[ch] * x_n) - (this.bodyMode_a1[ch] * y_n_mode_ch) + this.bodyMode_z2_states[ch];
          this.bodyMode_z2_states[ch] = (this.bodyMode_b2[ch] * x_n) - (this.bodyMode_a2[ch] * y_n_mode_ch);
          y_n_body_modes_summed += y_n_mode_ch;
      }
      // Averaging is not typically done for modal synthesis outputs unless specifically desired for an effect.

      const y_n_combined = (y_n_lpf * (1.0 - currentBpfBankMix)) + (y_n_body_modes_summed * currentBpfBankMix);
      
      outputChannel[i] = y_n_combined; 
      let feedbackSample = y_n_combined * currentLoopGain;
 
      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        let pulseSignal = (this.sawPhase < currentPulseWidth) ? 1.0 : -1.0; 
        pulseSignal = -pulseSignal; 
        
        this.sawPhase += phaseIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        
        const noiseSignal = (Math.random() * 2 - 1);
        const combinedTone = (sawtoothSignal * currentSawPulseMix) + (pulseSignal * (1.0 - currentSawPulseMix));
        const finalExcitationMix = (combinedTone * currentToneNoiseMix) + (noiseSignal * (1.0 - currentToneNoiseMix));
        feedbackSample += finalExcitationMix * currentExciteIntensity;
      }
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);