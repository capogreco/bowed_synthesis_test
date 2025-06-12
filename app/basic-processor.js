// basic-processor.js - Modal String Synthesis with Proper Resonators

const NUM_STRING_MODES = 32; // Number of modes for the string resonator bank

class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'fundamentalFrequency', defaultValue: 220, minValue: 20.0, maxValue: 2000.0, automationRate: 'a-rate' },
      { name: 'stringDamping', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'excitationLevel', defaultValue: 0.8, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfCutoff', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'lpfQ', defaultValue: 0.1, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
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

    // --- Modal Synthesis State ---
    // Each mode is implemented as a resonator (2nd order oscillator)
    // State variables for each mode
    this.modePhases = new Float32Array(NUM_STRING_MODES);
    this.modeVelocities = new Float32Array(NUM_STRING_MODES);
    this.modeFrequencies = new Float32Array(NUM_STRING_MODES);
    this.modeDampingCoeffs = new Float32Array(NUM_STRING_MODES);
    this.modeAmplitudes = new Float32Array(NUM_STRING_MODES);
    
    // --- Excitation State ---
    this.applyExcitation = false;
    
    // --- LPF State ---
    this.lpf_b0 = 1; this.lpf_b1 = 0; this.lpf_b2 = 0; 
    this.lpf_a1 = 0; this.lpf_a2 = 0;
    this.lpf_z1 = 0; this.lpf_z2 = 0;

    // --- Output Scaling ---
    // More reasonable scaling - modes add constructively at fundamental
    this.outputScalingFactor = 0.1; 

    // Calculate initial coefficients
    this._calculateModalParameters();
    this._calculateLpfCoefficients();
    
    this.port.onmessage = this._handleMessage.bind(this);
  }

  _handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === 'pluckString') {
      this.applyExcitation = true;
      this._resetModalStates();
      this._resetLpfState();
    }
  }

  _resetLpfState() {
    this.lpf_z1 = 0.0;
    this.lpf_z2 = 0.0;
  }

  _resetModalStates() {
    // Reset oscillator states but not phases - we'll set initial displacements
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      this.modePhases[i] = 0.0;
      this.modeVelocities[i] = 0.0;
    }
  }

  _calculateModalParameters() {
    const fundamental = this._cachedFundamentalFrequency;
    const dampingControl = this._cachedStringDamping; // 0.01 (low damping) to 0.99 (high damping)

    // Map damping control to decay times
    // Low damping (0.01) -> long decay (10 seconds at fundamental)
    // High damping (0.99) -> short decay (0.05 seconds at fundamental)
    const minDecayTime = 0.05;
    const maxDecayTime = 10.0;
    
    // Inverse mapping: low damping = long decay
    const fundamentalDecayTime = minDecayTime + (maxDecayTime - minDecayTime) * (1.0 - dampingControl);

    for (let i = 0; i < NUM_STRING_MODES; i++) {
      const modeNumber = i + 1;
      const modeFreq = fundamental * modeNumber;

      if (modeFreq >= this.sampleRate / 2) {
        // Mode is above Nyquist, disable it
        this.modeFrequencies[i] = 0;
        this.modeDampingCoeffs[i] = 0;
        this.modeAmplitudes[i] = 0;
        continue;
      }

      // Store frequency in Hz
      this.modeFrequencies[i] = modeFreq;

      // Calculate damping coefficient
      // Higher modes decay faster - decay time inversely proportional to mode number
      const modeDecayTime = fundamentalDecayTime / Math.sqrt(modeNumber);
      
      // Convert decay time to damping coefficient
      // Using exponential decay: amplitude = e^(-damping * time)
      // For 60dB decay: e^(-damping * decayTime) = 0.001
      // damping = -ln(0.001) / decayTime ≈ 6.9 / decayTime
      this.modeDampingCoeffs[i] = 6.9 / modeDecayTime;

      // Calculate mode amplitude
      // Pluck excitation at center gives odd harmonics only, but we'll simulate
      // a more general pluck position that excites all modes with decreasing amplitude
      // Amplitude falls off as 1/mode^2 for a typical string pluck
      this.modeAmplitudes[i] = 1.0 / (modeNumber * modeNumber);
    }

    // Normalize amplitudes so they sum to 1
    let ampSum = 0;
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      ampSum += this.modeAmplitudes[i];
    }
    if (ampSum > 0) {
      for (let i = 0; i < NUM_STRING_MODES; i++) {
        this.modeAmplitudes[i] /= ampSum;
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

  _recalculateAllCoefficientsIfNeeded(parameters) {
    let needsRecalcModal = false;
    let needsRecalcLpf = false;
    const tolerance = 1e-6;

    // Check fundamentalFrequency
    const fundamentalFreqVal = parameters.fundamentalFrequency[0];
    if (Math.abs(fundamentalFreqVal - this._cachedFundamentalFrequency) > tolerance) {
      this._cachedFundamentalFrequency = fundamentalFreqVal;
      needsRecalcModal = true;
    }

    // Check stringDamping
    const stringDampingVal = parameters.stringDamping[0];
    if (Math.abs(stringDampingVal - this._cachedStringDamping) > tolerance) {
      this._cachedStringDamping = stringDampingVal;
      needsRecalcModal = true;
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

    if (needsRecalcModal) {
      this._calculateModalParameters();
    }
    if (needsRecalcLpf) {
      this._calculateLpfCoefficients();
    }
  }

  process(inputs, outputs, parameters) {
    // Check for parameter changes
    this._recalculateAllCoefficientsIfNeeded(parameters);

    const outputChannel = outputs[0][0];
    const excitationLevel = parameters.excitationLevel[0];
    const dt = 1.0 / this.sampleRate;

    // Apply excitation if triggered
    if (this.applyExcitation) {
      // Set initial displacement for each mode based on its amplitude
      for (let mode = 0; mode < NUM_STRING_MODES; mode++) {
        if (this.modeFrequencies[mode] > 0) {
          // Initial displacement proportional to mode amplitude and excitation level
          this.modePhases[mode] = this.modeAmplitudes[mode] * excitationLevel;
          this.modeVelocities[mode] = 0.0;
        }
      }
      this.applyExcitation = false;
    }

    for (let i = 0; i < outputChannel.length; i++) {
      let y_n_modes_summed = 0.0;

      // Process each mode as a damped harmonic oscillator
      for (let mode = 0; mode < NUM_STRING_MODES; mode++) {
        if (this.modeFrequencies[mode] > 0) {
          const omega = 2.0 * Math.PI * this.modeFrequencies[mode];
          const damping = this.modeDampingCoeffs[mode];
          
          // Simple damped harmonic oscillator using Euler method
          // d²x/dt² = -omega² * x - 2 * damping * dx/dt
          const acceleration = -omega * omega * this.modePhases[mode] - 2.0 * damping * this.modeVelocities[mode];
          
          // Update velocity and position
          this.modeVelocities[mode] += acceleration * dt;
          this.modePhases[mode] += this.modeVelocities[mode] * dt;
          
          // Add this mode's contribution to output
          y_n_modes_summed += this.modePhases[mode];
        }
      }

      // Scale the output
      const stringOutput = y_n_modes_summed * this.outputScalingFactor;

      // Apply LPF
      const y_n_lpf = this.lpf_b0 * stringOutput + this.lpf_z1;
      this.lpf_z1 = (this.lpf_b1 * stringOutput) - (this.lpf_a1 * y_n_lpf) + this.lpf_z2;
      this.lpf_z2 = (this.lpf_b2 * stringOutput) - (this.lpf_a2 * y_n_lpf);
      
      outputChannel[i] = y_n_lpf;
    }
    
    return true;
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);