// basic-processor.js (Refactored for Parameter Mapping - Corrected)

const NUM_STRING_MODES = 32; // Number of modes for the string resonator bank

class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'fundamentalFrequency', defaultValue: 220, minValue: 20.0, maxValue: 2000.0, automationRate: 'a-rate' },
      { name: 'stringDamping', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'excitationLevel', defaultValue: 0.8, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },

      // --- Parameters for LPF and old Modal Body (temporarily unused for modal string MVP) ---
      // { name: 'lpfCutoff', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // { name: 'lpfQ', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // { name: 'loopGain', defaultValue: 0.995, minValue: 0.8, maxValue: 1.05, automationRate: 'k-rate' }, // Was for Karplus-Strong
      // { name: 'bodyModeQScale', defaultValue: 1.0, minValue: 0.25, maxValue: 12.0, automationRate: 'k-rate' },
      // { name: 'bodyMode1Freq', defaultValue: 277.18, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      // { name: 'bodyMode2Freq', defaultValue: 466.16, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      // { name: 'bodyMode3Freq', defaultValue: 554.37, minValue: 20.0, maxValue: 20000.0, automationRate: 'k-rate' },
      // { name: 'bodyMixLevel', defaultValue: 0.25, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // --- Parameters for old excitation (temporarily unused for modal string MVP) ---
      // { name: 'sawPulseMix', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // { name: 'pulseWidth', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      // { name: 'toneNoiseMix', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      // { name: 'exciteIntensity', defaultValue: 0.02, minValue: 0.0, maxValue: 0.1, automationRate: 'k-rate' } // Replaced by excitationLevel
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
    this._cachedFundamentalFrequency = descriptors.find(p => p.name === 'fundamentalFrequency').defaultValue;
    this._cachedStringDamping = descriptors.find(p => p.name === 'stringDamping').defaultValue;
    // this._cachedExcitationLevel = descriptors.find(p => p.name === 'excitationLevel').defaultValue; // Not directly used for coeff calculation

    // --- String Modal Resonator Parameters & State Arrays ---
    this.stringMode_b0 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_b1 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_b2 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_a1 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_a2 = new Float32Array(NUM_STRING_MODES);
    this.stringMode_z1_states = new Float32Array(NUM_STRING_MODES);
    this.stringMode_z2_states = new Float32Array(NUM_STRING_MODES);
    
    // --- Excitation State ---
    this.excitationValue = 0.0; // Value of the impulse for the current block
    this.applyExcitation = false; // Flag to apply excitation in the current block

    // --- Output Scaling ---
    this.outputScalingFactor = 1.0 / NUM_STRING_MODES; // Normalize summed output

    // Calculate initial string mode coefficients based on default AudioParam values.
    this._calculateStringModeCoefficients();
    
    this.port.onmessage = this._handleMessage.bind(this);
  }

  // _getDspValue is removed as parameter mapping is handled by AudioParams or direct values.
  // _updateDspValuesFromRaw is removed as parameters are read from AudioParams in process().

  _handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'pluckString') {
      this.applyExcitation = true; // Signal to apply excitation in the next process block
      this._resetStringModeStates();
    }
    // Old setBowing and setParameter for frequency are removed as we transition to modal string
  }

  _resetStringModeStates() {
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      this.stringMode_z1_states[i] = 0.0;
      this.stringMode_z2_states[i] = 0.0;
    }
  }

  _calculateStringModeCoefficients() {
    const Fs = this.sampleRate;
    const fundamental = this._cachedFundamentalFrequency;
    const dampingControl = this._cachedStringDamping; // 0.01 (low damping, long decay) to 0.99 (high damping, short decay)

    for (let i = 0; i < NUM_STRING_MODES; i++) {
      const modeNumber = i + 1;
      const modeFreq = fundamental * modeNumber;

      if (modeFreq <= 0 || modeFreq >= Fs / 2) {
        // Mode is out of valid range, set to bypass
        this.stringMode_b0[i] = 1; this.stringMode_b1[i] = 0; this.stringMode_b2[i] = 0;
        this.stringMode_a1[i] = 0; this.stringMode_a2[i] = 0;
        continue;
      }

      // Map dampingControl to Q
      // Higher dampingControl means lower Q (faster decay)
      // Lower dampingControl means higher Q (slower decay)
      // Q also decreases for higher modes
      // Linear scaling for baseQ from dampingControl
      const maxBaseQ = 200; // Maximum Q for the fundamental when damping is minimal
      const minBaseQ = 2;   // Minimum Q for the fundamental when damping is maximal
      const baseQ = minBaseQ + (maxBaseQ - minBaseQ) * (1.0 - dampingControl);

      let modeQ = Math.max(0.5, baseQ / Math.pow(modeNumber, 0.75)); // Q decreases with mode number
      modeQ = Math.min(modeQ, 500); // Cap Q to prevent extreme resonance

      const omega = 2 * Math.PI * modeFreq / Fs;
      const s_omega = Math.sin(omega);
      const c_omega = Math.cos(omega);
      const alpha = s_omega / (2 * modeQ);

      // BPF coefficients (normalized for peak gain = 1)
      const b0_norm = alpha;
      const b1_norm = 0;
      const b2_norm = -alpha;
      const a0_norm = 1 + alpha;
      const a1_norm = -2 * c_omega;
      const a2_norm = 1 - alpha;
      
      this.stringMode_b0[i] = b0_norm / a0_norm;
      this.stringMode_b1[i] = b1_norm / a0_norm; // Remains 0
      this.stringMode_b2[i] = b2_norm / a0_norm;
      this.stringMode_a1[i] = a1_norm / a0_norm;
      this.stringMode_a2[i] = a2_norm / a0_norm;
    }
  }

      _recalculateAllCoefficientsIfNeeded(parameters) {
        let needsRecalcStringModes = false;
        const tolerance = 1e-6; // Small tolerance for floating point comparison

        // Check fundamentalFrequency
        // For a-rate, we check the first value for coefficient recalculation.
        // The actual per-sample frequency will be used in process() if we decide to make modes a-rate responsive.
        const fundamentalFreqVal = parameters.fundamentalFrequency[0]; 
        if (Math.abs(fundamentalFreqVal - this._cachedFundamentalFrequency) > tolerance) {
            this._cachedFundamentalFrequency = fundamentalFreqVal;
            needsRecalcStringModes = true;
        }

        // Check stringDamping
        const stringDampingVal = parameters.stringDamping[0]; // k-rate
        if (Math.abs(stringDampingVal - this._cachedStringDamping) > tolerance) {
            this._cachedStringDamping = stringDampingVal;
            needsRecalcStringModes = true;
        }
    
        if (needsRecalcStringModes) {
            this._calculateStringModeCoefficients();
        }
      }

  // --- Old LPF and Body Resonator methods (temporarily commented out/removed for MVP) ---
  /*
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

  _initializeDelayLine() { // This was for Karplus-Strong
    // if (this.delayLine) {
    //     this.delayLine.fill(0.0); 
    // }
    // this.currentIndex = 0;
    // this._resetFilterStates(); // Old filter states
    // this._resetSawPhase();     // Old excitation phase
  }

  _calculateModalBodyCoefficients() { // This was for the 3-mode body, not the new string modes
    const Fs = this.sampleRate;
    const currentQScale = this._cachedBodyModeQScale;
    const currentModeFreqs = [
        this._cachedBodyMode1Freq, 
        this._cachedBodyMode2Freq, 
        this._cachedBodyMode3Freq
    ];
    for (let i = 0; i < this.numBodyModes; i++) { // this.numBodyModes was for the 3-mode body
        const F0_param = currentModeFreqs[i]; 
        const baseQ  = this.bodyModeBaseQs[i]; 
        const Gain_param = this.bodyModeGains[i]; 
        const Q_param  = Math.max(0.1, baseQ * currentQScale); 
        if (F0_param <= 0 || F0_param >= Fs / 2 || Q_param <= 0) {
            this.bodyMode_b0[i] = 1; this.bodyMode_b1[i] = 0; this.bodyMode_b2[i] = 0;
            this.bodyMode_a1[i] = 0; this.bodyMode_a2[i] = 0;
            continue;
        }
        const omega = 2 * Math.PI * F0_param / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * Q_param);
        const b0_norm = alpha;
        const b1_norm = 0;
        const b2_norm = -alpha;
        const a0_norm = 1 + alpha;
        const a1_norm = -2 * c_omega;
        const a2_norm = 1 - alpha;
        this.bodyMode_b0[i] = (Gain_param * b0_norm) / a0_norm;
        this.bodyMode_b1[i] = (Gain_param * b1_norm) / a0_norm;
        this.bodyMode_b2[i] = (Gain_param * b2_norm) / a0_norm;
        this.bodyMode_a1[i] = a1_norm / a0_norm;
        this.bodyMode_a2[i] = a2_norm / a0_norm;
        }
      }

  _resetFilterStates() { // Old, for LPF and 3-mode body
    // this.lpf_z1 = 0.0; this.lpf_z2 = 0.0;
    // for (let i = 0; i < this.numBodyModes; i++) {
    //     this.bodyMode_z1_states[i] = 0.0; 
    //     this.bodyMode_z2_states[i] = 0.0;
    // }
  }
  _resetSawPhase() { // Old, for specific excitation
    // this.sawPhase = 0.0; 
  }
  */

  process(inputs, outputs, parameters) { 
    // if (!this.delayLine) { // Karplus-Strong delay line removed
    //   outputs[0][0].fill(0); return true; 
    // }

    // Check for parameter changes and recalculate coefficients if needed
    // This happens once per block, before the sample loop
    this._recalculateAllCoefficientsIfNeeded(parameters);

    const outputChannel = outputs[0][0];

    // Get parameters for modal string synthesis
    // fundamentalFrequency is a-rate, but for coefficient calculation, we use its cached k-rate version.
    // For real-time pitch glides with modal synthesis, a more sophisticated approach than per-block
    // coefficient recalculation would be needed (e.g., phase-vocoder techniques or per-sample coefficient updates),
    // which is beyond MVP scope.
    const excitationLevel = parameters.excitationLevel[0]; // k-rate

    // Handle excitation pulse: apply it for the first sample of the block if flagged.
    let impulse = 0.0;
    if (this.applyExcitation) {
      impulse = excitationLevel;
      this.applyExcitation = false; // Consume the trigger
    }

    for (let i = 0; i < outputChannel.length; i++) {
      let y_n_string_modes_summed = 0.0;
      
      // Determine the input to the modal filters for this specific sample
      // The impulse is applied only at the very first sample of an excitation event.
      const currentInputToFilters = (i === 0) ? impulse : 0.0;

      // Process each string mode resonator
      for (let mode = 0; mode < NUM_STRING_MODES; mode++) {
        const y_n_mode = this.stringMode_b0[mode] * currentInputToFilters + this.stringMode_z1_states[mode];
        this.stringMode_z1_states[mode] = (this.stringMode_b1[mode] * currentInputToFilters) - (this.stringMode_a1[mode] * y_n_mode) + this.stringMode_z2_states[mode];
        this.stringMode_z2_states[mode] = (this.stringMode_b2[mode] * currentInputToFilters) - (this.stringMode_a2[mode] * y_n_mode);
        y_n_string_modes_summed += y_n_mode;
      }
      
      // Output the sum of string modes.
      // Consider normalizing by NUM_STRING_MODES or a fixed scalar if output is too hot.
      // For now, direct sum. Max amplitude will be roughly excitationLevel * sum of peak gains of modes.
      // Since BPFs are peak gain 1, max is roughly excitationLevel * NUM_STRING_MODES * (some factor due to Q).
      // A simple scaling factor might be needed. Let's try 1/sqrt(NUM_STRING_MODES) or similar.
      // Or, more simply, ensure excitationLevel is small.
      // For MVP, let's output directly and adjust excitationLevel from UI.
      outputChannel[i] = y_n_string_modes_summed * this.outputScalingFactor;

      // Old Karplus-Strong, LPF, Body, and complex excitation logic is removed.
    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);