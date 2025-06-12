// basic-processor.js (Refactored for Parameter Mapping - Corrected)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lpfCutoff', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfQ', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'loopGain', defaultValue: 0.995, minValue: 0.8, maxValue: 1.05, automationRate: 'k-rate' },
      { name: 'bodyModeQScale', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'bodyMode1Freq', defaultValue: 277.18, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMode2Freq', defaultValue: 466.16, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMode3Freq', defaultValue: 554.37, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMixLevel', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // Was bpfBankMix
      { name: 'sawPulseMix', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'pulseWidth', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'toneNoiseMix', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'exciteIntensity', defaultValue: 0.02, minValue: 0.0, maxValue: 0.1, automationRate: 'k-rate' } // Was bowForce
    ];
  }

  constructor(options) {
    super(options);
    this.sampleRate = sampleRate; // Globally available in AudioWorkletGlobalScope

    // --- Default Internal DSP Parameter Values (only for non-AudioParams now) ---
    this.dspValues = {
        frequency: 220 // Main string frequency, still handled by messagePort
    };

    // Cached AudioParam values to detect changes and trigger coefficient updates
    this._cachedLpfCutoff = -1;
    this._cachedLpfQ = -1;
    this._cachedBodyModeQScale = -1;
    this._cachedBodyMode1Freq = -1;
    this._cachedBodyMode2Freq = -1;
    this._cachedBodyMode3Freq = -1;
    // Note: loopGain, bodyMixLevel, sawPulseMix, pulseWidth, toneNoiseMix, exciteIntensity
    // will be read directly from AudioParams in the process loop.

    // --- Modal Body Resonator Base Parameters & State Arrays ---
    // Base frequencies for modes (will be overridden by AudioParams if connected)
    this.bodyModeBaseFreqs = [277.18, 466.16, 554.37]; // Hz (C#4, A#4, C#5)
    this.bodyModeBaseQs    = [10,  15,  12];  // Base Q values
    this.bodyModeGains = [0.8, 1.0, 0.9]; // Relative gains (currently fixed)
    this.numBodyModes  = this.bodyModeBaseFreqs.length;

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
    
    // --- Other State Variables ---
    this.delayLine = null; this.currentIndex = 0; this.delaySamples = 0;
    this.sawPhase = 0.0; this.isBowing = false;

    // Initial main string frequency from processorOptions if provided
    if (options && options.processorOptions && options.processorOptions.frequency !== undefined) {
        this.dspValues.frequency = options.processorOptions.frequency;
    }
    
    // Initial call to set up delay line based on initial/default frequency
    this._initializeDelayLine(); 
    // Coefficients will be calculated on the first process() call based on initial AudioParam values
    
    this.port.onmessage = this._handleMessage.bind(this);
  }

  // _getDspValue is removed as parameter mapping is handled by AudioParams or direct values.
  // _updateDspValuesFromRaw is removed as parameters are read from AudioParams in process().

  _handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'setBowing') {
      if (typeof data.isBowing === 'boolean') {
        this.isBowing = data.isBowing;
        if (this.isBowing) { this._resetFilterStates(); this._resetSawPhase(); }
      }
    } else if (data.type === 'setParameter' && data.frequency !== undefined) {
      // Only handle main string frequency changes via message port
      // Other parameters are now AudioParams
      const newFreq = data.frequency;
      if (newFreq !== this.dspValues.frequency && newFreq > 0) {
        this.dspValues.frequency = newFreq;
        this._initializeDelayLine(); // This will re-init delay and recalc all coeffs
      }
    }
  }
  
  _recalculateAllCoefficients() {
    // This method is called by _initializeDelayLine, 
    // and also potentially from process() if AudioParams driving coeffs change.
    this._calculateLpfCoefficients();
    this._calculateModalBodyCoefficients();
  }

  _calculateLpfCoefficients() { 
    const Fs = this.sampleRate;
    // Values are now read from cached AudioParams, fallback to descriptor default if cache is -1 (initial call)
    const sliderCutoff = this._cachedLpfCutoff !== -1 ? this._cachedLpfCutoff : ContinuousExcitationProcessor.parameterDescriptors.find(p => p.name === 'lpfCutoff').defaultValue;
    const sliderReso = this._cachedLpfQ !== -1 ? this._cachedLpfQ : ContinuousExcitationProcessor.parameterDescriptors.find(p => p.name === 'lpfQ').defaultValue;

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
    // Values are now read from cached AudioParams, fallback to descriptor default or base value if cache is -1

    const currentQScale = this._cachedBodyModeQScale !== -1 
        ? this._cachedBodyModeQScale 
        : ContinuousExcitationProcessor.parameterDescriptors.find(p => p.name === 'bodyModeQScale').defaultValue;

    const mode1FreqVal = this._cachedBodyMode1Freq !== -1 
        ? this._cachedBodyMode1Freq 
        : this.bodyModeBaseFreqs[0]; // Fallback to base, matches descriptor default
    const mode2FreqVal = this._cachedBodyMode2Freq !== -1 
        ? this._cachedBodyMode2Freq 
        : this.bodyModeBaseFreqs[1]; // Fallback to base
    const mode3FreqVal = this._cachedBodyMode3Freq !== -1 
        ? this._cachedBodyMode3Freq 
        : this.bodyModeBaseFreqs[2]; // Fallback to base

    const currentModeFreqs = [mode1FreqVal, mode2FreqVal, mode3FreqVal];

    // console.log(`[CalcModalCoeffs] QScale: ${currentQScale}`);

    for (let i = 0; i < this.numBodyModes; i++) {
        const F0_param = currentModeFreqs[i]; 
        const baseQ  = this.bodyModeBaseQs[i]; // Use bodyModeBaseQs
        const Gain_param = this.bodyModeGains[i]; // Gain is not scaled by UI for now

        const Q_param  = Math.max(0.1, baseQ * currentQScale); // Ensure Q doesn't go too low

        // console.log(`  Mode ${i}: F0_param=${F0_param?.toFixed(2)}, Q_param=${Q_param?.toFixed(2)}, Gain_param=${Gain_param?.toFixed(2)}`);

        if (F0_param <= 0 || F0_param >= Fs / 2 || Q_param <= 0) {
            // Flat response (bypass) if parameters are invalid
            console.warn(`[CalcModalCoeffs] Invalid params for Mode ${i}: F0=${F0_param}, Q=${Q_param}. Setting to bypass.`);
            this.bodyMode_b0[i] = 1; this.bodyMode_b1[i] = 0; this.bodyMode_b2[i] = 0;
            this.bodyMode_a1[i] = 0; this.bodyMode_a2[i] = 0;
            continue;
        }

        const omega = 2 * Math.PI * F0_param / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * Q_param);

        // Coefficients for a BPF with peak gain = 1 (0dB)
        const b0_norm = alpha;
        const b1_norm = 0;
        const b2_norm = -alpha;
        const a0_norm = 1 + alpha;
        const a1_norm = -2 * c_omega;
        const a2_norm = 1 - alpha;
        
        // Apply modal gain and normalize by a0_norm
        this.bodyMode_b0[i] = (Gain_param * b0_norm) / a0_norm;
        this.bodyMode_b1[i] = (Gain_param * b1_norm) / a0_norm; // still 0
        this.bodyMode_b2[i] = (Gain_param * b2_norm) / a0_norm;
        this.bodyMode_a1[i] = a1_norm / a0_norm;
        this.bodyMode_a2[i] = a2_norm / a0_norm;

        // console.log(`    Coeffs Mode ${i}: b0=${this.bodyMode_b0[i].toFixed(5)}, b1=${this.bodyMode_b1[i].toFixed(5)}, b2=${this.bodyMode_b2[i].toFixed(5)}, a1=${this.bodyMode_a1[i].toFixed(5)}, a2=${this.bodyMode_a2[i].toFixed(5)}`);
        }
      }

      _recalculateAllCoefficientsIfNeeded(parameters) {
        let needsRecalcLpf = false;
        let needsRecalcModal = false;

        const lpfCutoffVal = parameters.lpfCutoff[0];
        if (lpfCutoffVal !== this._cachedLpfCutoff) {
            this._cachedLpfCutoff = lpfCutoffVal;
            needsRecalcLpf = true;
        }
        const lpfQVal = parameters.lpfQ[0];
        if (lpfQVal !== this._cachedLpfQ) {
            this._cachedLpfQ = lpfQVal;
            needsRecalcLpf = true;
        }

        const bodyModeQScaleVal = parameters.bodyModeQScale[0];
        if (bodyModeQScaleVal !== this._cachedBodyModeQScale) {
            this._cachedBodyModeQScale = bodyModeQScaleVal;
            needsRecalcModal = true;
        }
        const bodyMode1FreqVal = parameters.bodyMode1Freq[0];
        if (bodyMode1FreqVal !== this._cachedBodyMode1Freq) {
            this._cachedBodyMode1Freq = bodyMode1FreqVal;
            needsRecalcModal = true;
        }
        const bodyMode2FreqVal = parameters.bodyMode2Freq[0];
        if (bodyMode2FreqVal !== this._cachedBodyMode2Freq) {
            this._cachedBodyMode2Freq = bodyMode2FreqVal;
            needsRecalcModal = true;
        }
        const bodyMode3FreqVal = parameters.bodyMode3Freq[0];
        if (bodyMode3FreqVal !== this._cachedBodyMode3Freq) {
            this._cachedBodyMode3Freq = bodyMode3FreqVal;
            needsRecalcModal = true;
        }
    
        if (needsRecalcLpf) {
            this._calculateLpfCoefficients();
        }
        if (needsRecalcModal) {
            this._calculateModalBodyCoefficients();
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
    // Coefficients will be calculated in the first process() call, or if freq changes here.
    // We need to ensure they are calculated once before first use if process() relies on them being set.
    // Calling _recalculateAllCoefficients() here ensures initial state is sound based on defaults
    // if AudioParams are not immediately available or if main 'frequency' changed.
    this._recalculateAllCoefficients(); // Ensures LPF and Modal based on *cached* or initial default AudioParam values.
  }

  process(inputs, outputs, parameters) { 
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); return true; 
    }

    // Check for parameter changes and recalculate coefficients if needed
    // This happens once per block, before the sample loop
    this._recalculateAllCoefficientsIfNeeded(parameters);

    const outputChannel = outputs[0][0];
    let logCounter = 0; // For periodic logging
    const logInterval = 1000; // Log every 1000 samples, for example
    
    // Read AudioParam values (k-rate, so take the first element)
    // Main string frequency is still from this.dspValues
    const phaseIncrement = this.dspValues.frequency / this.sampleRate; 
    const currentLoopGain = parameters.loopGain[0];
    const currentPulseWidth = parameters.pulseWidth[0];
    const currentExciteIntensity = parameters.exciteIntensity[0];
    const currentBodyMix = parameters.bodyMixLevel[0]; // Renamed from bpfBankMix
    const currentSawPulseMix = parameters.sawPulseMix[0];
    const currentToneNoiseMix = parameters.toneNoiseMix[0];

    for (let i = 0; i < outputChannel.length; i++) {
      // For a-rate parameters, you would use parameters.paramName[i] here
      // For k-rate, the value read above (e.g., currentLoopGain) is used for all samples in the block.
      const x_n = this.delayLine[this.currentIndex]; 
      
      const y_n_lpf = this.lpf_b0 * x_n + this.lpf_z1;
      this.lpf_z1 = (this.lpf_b1 * x_n) - (this.lpf_a1 * y_n_lpf) + this.lpf_z2;
      this.lpf_z2 = (this.lpf_b2 * x_n) - (this.lpf_a2 * y_n_lpf);
      
      let y_n_body_modes_summed = 0.0;
      let y_n_mode_ch_vals = [0,0,0]; // Assuming 3 modes for logging

      for (let ch = 0; ch < this.numBodyModes; ch++) {
          const y_n_mode_ch = this.bodyMode_b0[ch] * x_n + this.bodyMode_z1_states[ch];
          this.bodyMode_z1_states[ch] = (this.bodyMode_b1[ch] * x_n) - (this.bodyMode_a1[ch] * y_n_mode_ch) + this.bodyMode_z2_states[ch];
          this.bodyMode_z2_states[ch] = (this.bodyMode_b2[ch] * x_n) - (this.bodyMode_a2[ch] * y_n_mode_ch);
          y_n_body_modes_summed += y_n_mode_ch;
          if (ch < 3) y_n_mode_ch_vals[ch] = y_n_mode_ch; // Store for logging
      }
      // Averaging is not typically done for modal synthesis outputs unless specifically desired for an effect.
 
      const y_n_combined = (y_n_lpf * (1.0 - currentBodyMix)) + (y_n_body_modes_summed * currentBodyMix);
       
      outputChannel[i] = y_n_combined; 
      let feedbackSample = y_n_combined * currentLoopGain;
      let excitationSignal = 0;
 
      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        let pulseSignal = (this.sawPhase < currentPulseWidth) ? 1.0 : -1.0; 
        pulseSignal = -pulseSignal; 
        
        this.sawPhase += phaseIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        
        const noiseSignal = (Math.random() * 2 - 1);
        const combinedTone = (sawtoothSignal * currentSawPulseMix) + (pulseSignal * (1.0 - currentSawPulseMix));
        excitationSignal = (combinedTone * currentToneNoiseMix) + (noiseSignal * (1.0 - currentToneNoiseMix));
        feedbackSample += excitationSignal * currentExciteIntensity;
      }
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;

      if (logCounter === 0) {
        // console.log(`[Process] x_n: ${x_n?.toFixed(3)}, LPF_out: ${y_n_lpf?.toFixed(3)}, Mode0: ${y_n_mode_ch_vals[0]?.toFixed(3)}, Mode1: ${y_n_mode_ch_vals[1]?.toFixed(3)}, Mode2: ${y_n_mode_ch_vals[2]?.toFixed(3)}, BodySum: ${y_n_body_modes_summed?.toFixed(3)}, Combined: ${y_n_combined?.toFixed(3)}, Excite: ${excitationSignal?.toFixed(3)}, FB: ${feedbackSample?.toFixed(3)}, DelayIn: ${this.delayLine[this.currentIndex]?.toFixed(3)}`);
      }
      logCounter = (logCounter + 1) % logInterval;
    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);