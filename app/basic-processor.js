// basic-processor.js (Refactored for Parameter Mapping - Corrected)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 220, minValue: 20.0, maxValue: 2000.0, automationRate: 'a-rate' },
      { name: 'lpfCutoff', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfQ', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'loopGain', defaultValue: 0.995, minValue: 0.8, maxValue: 1.05, automationRate: 'k-rate' },
      { name: 'bodyModeQScale', defaultValue: 1.0, minValue: 0.25, maxValue: 12.0, automationRate: 'k-rate' },
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
    // Main string 'frequency' is now an AudioParam.
    // this.dspValues will hold any other non-AudioParam state if needed in the future.
    this.dspValues = {};

    // Cached AudioParam values to detect changes and trigger coefficient updates
    // Initialize with default values from parameterDescriptors
    const descriptors = ContinuousExcitationProcessor.parameterDescriptors;
    this._cachedLpfCutoff = descriptors.find(p => p.name === 'lpfCutoff').defaultValue;
    this._cachedLpfQ = descriptors.find(p => p.name === 'lpfQ').defaultValue;
    this._cachedBodyModeQScale = descriptors.find(p => p.name === 'bodyModeQScale').defaultValue;
    this._cachedBodyMode1Freq = descriptors.find(p => p.name === 'bodyMode1Freq').defaultValue;
    this._cachedBodyMode2Freq = descriptors.find(p => p.name === 'bodyMode2Freq').defaultValue;
    this._cachedBodyMode3Freq = descriptors.find(p => p.name === 'bodyMode3Freq').defaultValue;



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
    
    // --- Other State Variables & Delay Line Setup ---
    // Max delay line for lowest frequency (e.g., 20Hz)
    const MIN_FREQ = 20.0; // Hz
    this.maxDelaySamples = Math.floor(this.sampleRate / MIN_FREQ);
    if (this.maxDelaySamples < 2) this.maxDelaySamples = 2; // Ensure valid length
    this.delayLine = new Float32Array(this.maxDelaySamples);

    this.currentIndex = 0; // Write pointer
    this.sawPhase = 0.0; 
    this.isBowing = false;
    
    // Initial call to set up delay line (zero out buffer) and reset filter states.
    this._initializeDelayLine(); 
    // Calculate initial coefficients based on default AudioParam values (now in caches).
    this._recalculateAllCoefficients();
    
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
    // Main 'frequency' is now an AudioParam, no longer handled by message port for updates.
    // } else if (data.type === 'setParameter' && data.frequency !== undefined) {
    //   const newFreq = data.frequency;
    //   if (newFreq !== this.dspValues.frequency && newFreq > 0) {
    //     // this.dspValues.frequency = newFreq; // dspValues.frequency removed
    //     // this._initializeDelayLine(); // This structural change is now avoided
    //   }
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
    // Values are now read from cached AudioParams (which are initialized to defaults)
    const sliderCutoff = this._cachedLpfCutoff;
    const sliderReso = this._cachedLpfQ;

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

  // This method is now only responsible for zeroing the delay line and resetting filter states.
  // The actual delay length is determined dynamically in process() by the frequency AudioParam.
  _initializeDelayLine() {
    if (this.delayLine) {
        this.delayLine.fill(0.0); // Zero out the fixed-size buffer
    }
    this.currentIndex = 0;
    this._resetFilterStates(); 
    this._resetSawPhase();
    // No need to call _recalculateAllCoefficients() here,
    // process() will handle it on the first block based on AudioParam defaults.
  }

  _calculateModalBodyCoefficients() {
    const Fs = this.sampleRate;
    // Values are now read from cached AudioParams (which are initialized to defaults)

    const currentQScale = this._cachedBodyModeQScale;

    // Frequencies for modes come directly from their cached AudioParam values
    const currentModeFreqs = [
        this._cachedBodyMode1Freq, 
        this._cachedBodyMode2Freq, 
        this._cachedBodyMode3Freq
    ];
    


    for (let i = 0; i < this.numBodyModes; i++) {
        const F0_param = currentModeFreqs[i]; 
        const baseQ  = this.bodyModeBaseQs[i]; // Use bodyModeBaseQs
        const Gain_param = this.bodyModeGains[i]; // Gain is not scaled by UI for now

        const Q_param  = Math.max(0.1, baseQ * currentQScale); // Ensure Q doesn't go too low



        if (F0_param <= 0 || F0_param >= Fs / 2 || Q_param <= 0) {
            // Flat response (bypass) if parameters are invalid

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


        }
      }

      _recalculateAllCoefficientsIfNeeded(parameters) {
        let needsRecalcLpf = false;
        let needsRecalcModal = false;
        const tolerance = 1e-6; // Small tolerance for floating point comparison

        let lpfCutoffVal = parameters.lpfCutoff[0];
        if (Math.abs(lpfCutoffVal - this._cachedLpfCutoff) > tolerance) {
            this._cachedLpfCutoff = lpfCutoffVal;
            needsRecalcLpf = true;
        }

        let lpfQVal = parameters.lpfQ[0];
        if (Math.abs(lpfQVal - this._cachedLpfQ) > tolerance) {
            this._cachedLpfQ = lpfQVal;
            needsRecalcLpf = true;
        }

        let bodyModeQScaleVal = parameters.bodyModeQScale[0];
        if (Math.abs(bodyModeQScaleVal - this._cachedBodyModeQScale) > tolerance) {
            this._cachedBodyModeQScale = bodyModeQScaleVal;
            needsRecalcModal = true;
        }

        let bodyMode1FreqVal = parameters.bodyMode1Freq[0];
        if (Math.abs(bodyMode1FreqVal - this._cachedBodyMode1Freq) > tolerance) {
            this._cachedBodyMode1Freq = bodyMode1FreqVal;
            needsRecalcModal = true;
        }

        let bodyMode2FreqVal = parameters.bodyMode2Freq[0];
        if (Math.abs(bodyMode2FreqVal - this._cachedBodyMode2Freq) > tolerance) {
            this._cachedBodyMode2Freq = bodyMode2FreqVal;
            needsRecalcModal = true;
        }

        let bodyMode3FreqVal = parameters.bodyMode3Freq[0];
        if (Math.abs(bodyMode3FreqVal - this._cachedBodyMode3Freq) > tolerance) {
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

  process(inputs, outputs, parameters) { 
    if (!this.delayLine) { // Check if delayLine itself is null (shouldn't happen after constructor)
      outputs[0][0].fill(0); return true; 
    }

    // Check for parameter changes and recalculate coefficients if needed
    // This happens once per block, before the sample loop
    this._recalculateAllCoefficientsIfNeeded(parameters);

    const outputChannel = outputs[0][0];


    // Read AudioParam values (k-rate, so take the first element of the array)
    const frequencyParamArray = parameters.frequency; // a-rate
    const currentLoopGain = parameters.loopGain[0];
    const currentPulseWidth = parameters.pulseWidth[0];
    const currentExciteIntensity = parameters.exciteIntensity[0];
    const currentBodyMix = parameters.bodyMixLevel[0]; 
    const currentSawPulseMix = parameters.sawPulseMix[0];
    const currentToneNoiseMix = parameters.toneNoiseMix[0];

    for (let i = 0; i < outputChannel.length; i++) {
      // Get current frequency for this sample (a-rate)
      const currentFreq = frequencyParamArray.length > 1 ? frequencyParamArray[i] : frequencyParamArray[0];
      if (currentFreq <= 0) { // Safety break for invalid frequency
        outputChannel[i] = 0;
        continue;
      }

      // Calculate dynamic delay length in samples (float)
      const delayInSamples = this.sampleRate / currentFreq;
      
      // Calculate read pointer with wrap-around for the fixed-size delay line
      let readPointer = this.currentIndex - delayInSamples;
      while (readPointer < 0) {
        readPointer += this.delayLine.length; // this.delayLine.length is maxDelaySamples
      }
      // readPointer can still be >= this.delayLine.length if delayInSamples is very small (high freq), ensure it wraps
      readPointer %= this.delayLine.length;


      // Linear Interpolation for reading x_n
      const idx0 = Math.floor(readPointer);
      const idx1 = (idx0 + 1) % this.delayLine.length;
      const frac = readPointer - idx0;
      const sample0 = this.delayLine[idx0];
      const sample1 = this.delayLine[idx1];
      const x_n = sample0 + frac * (sample1 - sample0);
      
      // Phase increment for excitation oscillator
      const phaseIncrement = currentFreq / this.sampleRate;

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
      let currentPhaseIncrement = phaseIncrement; // Use the per-sample calculated phaseIncrement

      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        let pulseSignal = (this.sawPhase < currentPulseWidth) ? 1.0 : -1.0; 
        pulseSignal = -pulseSignal; 
        
        this.sawPhase += currentPhaseIncrement; // Use currentPhaseIncrement
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        
        const noiseSignal = (Math.random() * 2 - 1);
        const combinedTone = (sawtoothSignal * currentSawPulseMix) + (pulseSignal * (1.0 - currentSawPulseMix));
        excitationSignal = (combinedTone * currentToneNoiseMix) + (noiseSignal * (1.0 - currentToneNoiseMix));
        feedbackSample += excitationSignal * currentExciteIntensity;
      }
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      this.currentIndex = (this.currentIndex + 1) % this.delayLine.length; // Wrap around maxDelaySamples


    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);