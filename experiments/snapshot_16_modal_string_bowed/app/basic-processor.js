// basic-processor.js - Modal String Synthesis with Continuous Bow Excitation

const NUM_STRING_MODES = 32; // Number of modes for the string resonator bank

class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'fundamentalFrequency', defaultValue: 220, minValue: 20.0, maxValue: 2000.0, automationRate: 'a-rate' },
      { name: 'stringDamping', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'excitationLevel', defaultValue: 0.8, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfCutoff', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfQ', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      
      // --- Bow excitation parameters ---
      { name: 'sawPulseMix', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'pulseWidth', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'toneNoiseMix', defaultValue: 0.8, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      
      // --- Parameters for Modal Body ---
      { name: 'bodyModeQScale', defaultValue: 1.0, minValue: 0.25, maxValue: 12.0, automationRate: 'k-rate' },
      { name: 'bodyMode1Freq', defaultValue: 277.18, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMode2Freq', defaultValue: 466.16, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMode3Freq', defaultValue: 554.37, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      { name: 'bodyMixLevel', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super(options);
    this.sampleRate = sampleRate; // Globally available in AudioWorkletGlobalScope

    // Cached AudioParam values to detect changes and trigger coefficient updates
    const descriptors = ContinuousExcitationProcessor.parameterDescriptors;
    this._cachedFundamentalFrequency = descriptors.find(p => p.name === 'fundamentalFrequency').defaultValue;
    this._cachedStringDamping = descriptors.find(p => p.name === 'stringDamping').defaultValue;
    this._cachedLpfCutoff = descriptors.find(p => p.name === 'lpfCutoff').defaultValue;
    this._cachedLpfQ = descriptors.find(p => p.name === 'lpfQ').defaultValue;
    this._cachedBodyModeQScale = descriptors.find(p => p.name === 'bodyModeQScale').defaultValue;
    this._cachedBodyMode1Freq = descriptors.find(p => p.name === 'bodyMode1Freq').defaultValue;
    this._cachedBodyMode2Freq = descriptors.find(p => p.name === 'bodyMode2Freq').defaultValue;
    this._cachedBodyMode3Freq = descriptors.find(p => p.name === 'bodyMode3Freq').defaultValue;
    // bodyMixLevel is read directly in process(), not cached for coefficient calculation.

    // --- String Modal Resonator Parameters & State Arrays (Biquad-based) ---
    this.stringMode_b0 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_b1 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_b2 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_a1 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_a2 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_z1_states = new Float32Array(NUM_STRING_MODES);
    this.stringMode_z2_states = new Float32Array(NUM_STRING_MODES);

    // Store mode properties (frequencies, amplitudes for gain scaling)
    this.modeFrequencies = new Float32Array(NUM_STRING_MODES); // Still useful for target frequencies
    this.modeAmplitudes = new Float32Array(NUM_STRING_MODES);  // For scaling biquad gains

    // --- Bow Excitation State ---
    this.isBowing = false;
    this.sawPhase = 0.0;
    this.pulsePhase = 0.0;
    
    // --- LPF State ---
    this.lpf_b0 = 1; this.lpf_b1 = 0; this.lpf_b2 = 0; 
    this.lpf_a1 = 0; this.lpf_a2 = 0;
    this.lpf_z1 = 0; this.lpf_z2 = 0;

    // --- Modal Body Resonator Base Parameters & State Arrays ---
    this.bodyModeBaseFreqs = [277.18, 466.16, 554.37]; // Hz (C#4, A#4, C#5) - Default values
    this.bodyModeBaseQs    = [10,  15,  12];  // Base Q values for each mode
    this.bodyModeGains     = [0.8, 1.0, 0.9]; // Relative gains (currently fixed, could be AudioParams)
    this.numBodyModes      = this.bodyModeBaseFreqs.length;

    this.bodyMode_b0 = new Float32Array(this.numBodyModes);
    this.bodyMode_b1 = new Float32Array(this.numBodyModes);
    this.bodyMode_b2 = new Float32Array(this.numBodyModes);
    this.bodyMode_a1 = new Float32Array(this.numBodyModes);
    this.bodyMode_a2 = new Float32Array(this.numBodyModes);
    this.bodyMode_z1_states = new Float32Array(this.numBodyModes);
    this.bodyMode_z2_states = new Float32Array(this.numBodyModes);

    // --- Output Scaling ---
    // More reasonable scaling - modes add constructively at fundamental
    this.outputScalingFactor = 0.3;

    // Calculate initial coefficients
    this._calculateStringModeCoefficients(); // Renamed from _calculateModalParameters
    this._calculateLpfCoefficients();
    this._calculateModalBodyCoefficients(); // Calculate initial Body Modal coefficients
    
    this.port.onmessage = this._handleMessage.bind(this);
  }

  _handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'setBowing') {
      this.isBowing = data.value;
      if (this.isBowing) {
        // When starting to bow, optionally reset states for cleaner attack
        this._resetStringModeStates();
        this._resetLpfState();
        this._resetBodyModeStates();
      }
    }
  }

  _resetBodyModeStates() {
    for (let i = 0; i < this.numBodyModes; i++) {
      this.bodyMode_z1_states[i] = 0.0;
      this.bodyMode_z2_states[i] = 0.0;
    }
  }

  _resetLpfState() {
    this.lpf_z1 = 0.0;
    this.lpf_z2 = 0.0;
  }

  _resetStringModeStates() {
    // Reset biquad filter states for string modes
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      this.stringMode_z1_states[i] = 0.0;
      this.stringMode_z2_states[i] = 0.0;
    }
  }

  _calculateStringModeCoefficients() {
    const Fs = this.sampleRate;
    const fundamental = this._cachedFundamentalFrequency;
    // const dampingControl = this._cachedStringDamping; // Not used in this diagnostic version

    // Calculate modes with proper harmonic series and damping
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      // Harmonic series with slight inharmonicity
      const inharmonicity = 0.0003; // Typical for steel strings
      const modeNumber = i + 1;
      const modeFreq = fundamental * modeNumber * Math.sqrt(1 + inharmonicity * modeNumber * modeNumber);
      
      if (modeFreq > 0 && modeFreq < Fs / 2) {
        // Q decreases with mode number (higher modes decay faster)
        const baseQ = 200;
        const modeQ = baseQ / Math.sqrt(modeNumber) * (1 - this._cachedStringDamping * 0.8);
        
        // Mode amplitude decreases with mode number
        const modeAmplitude = 1.0 / modeNumber;
        
        const omega = 2 * Math.PI * modeFreq / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * modeQ);

        const a0_norm = 1 + alpha;
        this.stringMode_b0[i] = (alpha * modeAmplitude) / a0_norm;
        this.stringMode_b1[i] = 0;
        this.stringMode_b2[i] = (-alpha * modeAmplitude) / a0_norm;
        this.stringMode_a1[i] = (-2 * c_omega) / a0_norm;
        this.stringMode_a2[i] = (1 - alpha) / a0_norm;
        
        this.modeAmplitudes[i] = modeAmplitude;
        this.modeFrequencies[i] = modeFreq;
      } else {
        // Mode is out of range, silence it
        this.stringMode_b0[i] = 0;
        this.stringMode_b1[i] = 0;
        this.stringMode_b2[i] = 0;
        this.stringMode_a1[i] = 0;
        this.stringMode_a2[i] = 0;
        this.modeAmplitudes[i] = 0;
        this.modeFrequencies[i] = 0;
      }
    }
  }

  _calculateLpfCoefficients() {
    const Fs = this.sampleRate;
    const sliderCutoff = this._cachedLpfCutoff;
    const sliderReso = this._cachedLpfQ;

    // Map slider to frequency range
    const minF = 40, maxF = Math.min(18000, Fs * 0.45);
    let actualCutoffFreq = minF * Math.pow(maxF / minF, sliderCutoff);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));
    
    // Map resonance slider to Q
    const mappedResonanceParam = Math.pow(Math.max(0.0, Math.min(1.0, sliderReso)), 3);
    const minQLPF = 0.707, maxQLPF = 2.5;
    let actualQ_lpf = minQLPF * Math.pow(maxQLPF / minQLPF, mappedResonanceParam);
    if (mappedResonanceParam <= 0) actualQ_lpf = minQLPF;
    actualQ_lpf = Math.max(minQLPF, Math.min(actualQ_lpf, maxQLPF * 1.01));

    // Calculate LPF coefficients
    const omega_lpf = 2 * Math.PI * actualCutoffFreq / Fs;
    const s_lpf = Math.sin(omega_lpf);
    const c_lpf = Math.cos(omega_lpf);
    const alpha_lpf = s_lpf / (2 * actualQ_lpf);
    
    const b0_lpf_coeff = (1 - c_lpf) / 2;
    const b1_lpf_coeff = 1 - c_lpf;
    const b2_lpf_coeff = (1 - c_lpf) / 2;
    const a0_lpf_coeff = 1 + alpha_lpf;
    const a1_lpf_rbj = -2 * c_lpf;
    const a2_lpf_rbj = 1 - alpha_lpf;
    
    this.lpf_b0 = b0_lpf_coeff / a0_lpf_coeff;
    this.lpf_b1 = b1_lpf_coeff / a0_lpf_coeff;
    this.lpf_b2 = b2_lpf_coeff / a0_lpf_coeff;
    this.lpf_a1 = a1_lpf_rbj / a0_lpf_coeff;
    this.lpf_a2 = a2_lpf_rbj / a0_lpf_coeff;
  }

  _calculateModalBodyCoefficients() {
    const Fs = this.sampleRate;
    const currentQScale = this._cachedBodyModeQScale;
    const currentModeFreqs = [
        this._cachedBodyMode1Freq, 
        this._cachedBodyMode2Freq, 
        this._cachedBodyMode3Freq
    ];

    for (let i = 0; i < this.numBodyModes; i++) {
        const F0_param = currentModeFreqs[i]; 
        const baseQ  = this.bodyModeBaseQs[i]; 
        const Gain_param = this.bodyModeGains[i]; 
        const Q_param  = Math.max(0.1, baseQ * currentQScale); 

        if (F0_param <= 0 || F0_param >= Fs / 2 || Q_param <= 0) {
            // console.warn(`[CalcModalBodyCoeffs] Invalid params for Mode ${i}: F0=${F0_param}, Q=${Q_param}. Setting to bypass.`);
            this.bodyMode_b0[i] = 1; this.bodyMode_b1[i] = 0; this.bodyMode_b2[i] = 0;
            this.bodyMode_a1[i] = 0; this.bodyMode_a2[i] = 0;
            continue;
        }

        const omega = 2 * Math.PI * F0_param / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * Q_param);

        // BPF coefficients (normalized for peak gain = 1 before applying Gain_param)
        const b0_norm = alpha;
        const b1_norm = 0;
        const b2_norm = -alpha;
        const a0_norm = 1 + alpha;
        const a1_norm = -2 * c_omega;
        const a2_norm = 1 - alpha;
        
        this.bodyMode_b0[i] = (Gain_param * b0_norm) / a0_norm;
        this.bodyMode_b1[i] = (Gain_param * b1_norm) / a0_norm; // Remains 0
        this.bodyMode_b2[i] = (Gain_param * b2_norm) / a0_norm;
        this.bodyMode_a1[i] = a1_norm / a0_norm;
        this.bodyMode_a2[i] = a2_norm / a0_norm;
    }
  }

  _recalculateAllCoefficientsIfNeeded(parameters) {
   let needsRecalcStringModes = false; // Renamed from needsRecalcModal
   let needsRecalcLpf = false;
    let needsRecalcBody = false; // Flag for body resonator
    const tolerance = 1e-6;

    // Check fundamentalFrequency
    const fundamentalFreqVal = parameters.fundamentalFrequency[0];
    if (Math.abs(fundamentalFreqVal - this._cachedFundamentalFrequency) > tolerance) {
      this._cachedFundamentalFrequency = fundamentalFreqVal;
      needsRecalcStringModes = true;
    }

    // Check stringDamping
    const stringDampingVal = parameters.stringDamping[0];
    if (Math.abs(stringDampingVal - this._cachedStringDamping) > tolerance) {
      this._cachedStringDamping = stringDampingVal;
      needsRecalcStringModes = true;
    }

    // Check LPF parameters
    const lpfCutoffVal = parameters.lpfCutoff[0];
    if (Math.abs(lpfCutoffVal - this._cachedLpfCutoff) > tolerance) {
      this._cachedLpfCutoff = lpfCutoffVal;
      needsRecalcLpf = true;
    }
    const lpfQVal = parameters.lpfQ[0];
    if (Math.abs(lpfQVal - this._cachedLpfQ) > tolerance) {
      this._cachedLpfQ = lpfQVal;
      needsRecalcLpf = true;
    }

    if (needsRecalcStringModes) {
      this._calculateStringModeCoefficients(); // Renamed
    }
    if (needsRecalcLpf) {
      this._calculateLpfCoefficients();
    }

    // Check Body Model parameters
    const bodyModeQScaleVal = parameters.bodyModeQScale[0];
    if (Math.abs(bodyModeQScaleVal - this._cachedBodyModeQScale) > tolerance) {
        this._cachedBodyModeQScale = bodyModeQScaleVal;
        needsRecalcBody = true;
    }
    const bodyMode1FreqVal = parameters.bodyMode1Freq[0];
    if (Math.abs(bodyMode1FreqVal - this._cachedBodyMode1Freq) > tolerance) {
        this._cachedBodyMode1Freq = bodyMode1FreqVal;
        needsRecalcBody = true;
    }
    const bodyMode2FreqVal = parameters.bodyMode2Freq[0];
    if (Math.abs(bodyMode2FreqVal - this._cachedBodyMode2Freq) > tolerance) {
        this._cachedBodyMode2Freq = bodyMode2FreqVal;
        needsRecalcBody = true;
    }
    const bodyMode3FreqVal = parameters.bodyMode3Freq[0];
    if (Math.abs(bodyMode3FreqVal - this._cachedBodyMode3Freq) > tolerance) {
        this._cachedBodyMode3Freq = bodyMode3FreqVal;
        needsRecalcBody = true;
    }

    if (needsRecalcBody) {
        this._calculateModalBodyCoefficients();
    }
  }

  process(inputs, outputs, parameters) {
    // Check for parameter changes
    this._recalculateAllCoefficientsIfNeeded(parameters);

    const outputChannel = outputs[0][0];
    const excitationLevel = parameters.excitationLevel[0];
    const dt = 1.0 / this.sampleRate; // dt is not used by biquads, but kept if needed elsewhere
    const currentBodyMix = parameters.bodyMixLevel[0]; // k-rate

    // Get bow excitation parameters
    const sawPulseMix = parameters.sawPulseMix[0];
    const pulseWidth = parameters.pulseWidth[0];
    const toneNoiseMix = parameters.toneNoiseMix[0];
    
    for (let i = 0; i < outputChannel.length; i++) {
      // Generate continuous bow excitation when bowing
      let excitationSignal = 0.0;
      
      if (this.isBowing) {
        const fundamental = parameters.fundamentalFrequency.length > 1 
          ? parameters.fundamentalFrequency[i] 
          : parameters.fundamentalFrequency[0];
        
        // Sawtooth wave
        const sawIncrement = fundamental / this.sampleRate;
        this.sawPhase += sawIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        const sawWave = 2.0 * this.sawPhase - 1.0;
        
        // Pulse wave
        this.pulsePhase += sawIncrement;
        if (this.pulsePhase >= 1.0) this.pulsePhase -= 1.0;
        const pulseWave = this.pulsePhase < pulseWidth ? 1.0 : -1.0;
        
        // Mix saw and pulse
        const toneSignal = sawWave * sawPulseMix + (-pulseWave) * (1.0 - sawPulseMix);
        
        // Add noise
        const noiseSignal = Math.random() * 2.0 - 1.0;
        
        // Mix tone and noise
        const mixedExcitation = toneSignal * toneNoiseMix + noiseSignal * (1.0 - toneNoiseMix);
        
        // Apply excitation level
        excitationSignal = mixedExcitation * excitationLevel;
      }
      
      // Apply excitation to all string modes
      const currentInputToFilters = excitationSignal;
      
      let y_n_string_modes_summed = 0.0;

      // Process each string mode resonator (biquad filter)
      for (let mode = 0; mode < NUM_STRING_MODES; mode++) {
        // Standard biquad difference equation
        const y_n_mode = this.stringMode_b0[mode] * currentInputToFilters + this.stringMode_z1_states[mode];
        this.stringMode_z1_states[mode] = (this.stringMode_b1[mode] * currentInputToFilters) - (this.stringMode_a1[mode] * y_n_mode) + this.stringMode_z2_states[mode];
        this.stringMode_z2_states[mode] = (this.stringMode_b2[mode] * currentInputToFilters) - (this.stringMode_a2[mode] * y_n_mode);
        y_n_string_modes_summed += y_n_mode;
      }
      
      // Scale the summed string mode output
      const stringOutput = y_n_string_modes_summed * this.outputScalingFactor;

      // Apply LPF
      const y_n_lpf = this.lpf_b0 * stringOutput + this.lpf_z1;
      this.lpf_z1 = (this.lpf_b1 * stringOutput) - (this.lpf_a1 * y_n_lpf) + this.lpf_z2;
      this.lpf_z2 = (this.lpf_b2 * stringOutput) - (this.lpf_a2 * y_n_lpf);
      
      // --- Process 3-Mode Body Resonator ---
      let y_n_body_modes_summed = 0.0;
      const inputToBody = y_n_lpf; // Output of LPF is input to the body model

      for (let ch = 0; ch < this.numBodyModes; ch++) {
          const y_n_mode_ch = this.bodyMode_b0[ch] * inputToBody + this.bodyMode_z1_states[ch];
          this.bodyMode_z1_states[ch] = (this.bodyMode_b1[ch] * inputToBody) - (this.bodyMode_a1[ch] * y_n_mode_ch) + this.bodyMode_z2_states[ch];
          this.bodyMode_z2_states[ch] = (this.bodyMode_b2[ch] * inputToBody) - (this.bodyMode_a2[ch] * y_n_mode_ch);
          y_n_body_modes_summed += y_n_mode_ch;
      }

      // --- Mix LPF output (pre-body) with Body Resonator output ---
      const finalOutput = (y_n_lpf * (1.0 - currentBodyMix)) + (y_n_body_modes_summed * currentBodyMix);
      
      outputChannel[i] = finalOutput;
    }
    
    return true;
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);