// basic-processor.js - Modal String Synthesis with Continuous Bow Excitation

const NUM_STRING_MODES = 32; // Number of modes for the string resonator bank

class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'fundamentalFrequency', defaultValue: 220, minValue: 20.0, maxValue: 2000.0, automationRate: 'a-rate' },
      { name: 'stringDamping', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'bowForce', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'bowPosition', defaultValue: 0.12, minValue: 0.02, maxValue: 0.5, automationRate: 'k-rate' }, // 0.02 = very close to bridge, 0.5 = middle of string
      { name: 'bowSpeed', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // 0 = very slow, 1 = very fast
      { name: 'brightness', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // Overall brightness control
      { name: 'stringMaterial', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' }, // 0=steel, 1=gut, 2=nylon, 3=wound
      
      // --- Vibrato parameters ---
      { name: 'vibratoEnabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }, // 0=off, 1=on
      { name: 'vibratoRate', defaultValue: 5.0, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' }, // Hz
      { name: 'vibratoDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // 0-1
      // TODO: Future enhancement - Add asymmetric vibrato waveshaping
      // - vibratoShape: 0=sine, 0.5=triangle, 1=square
      // - vibratoAsymmetry: -1=faster up/slower down, 0=symmetric, 1=slower up/faster down
      // - vibratoOnset: 0=immediate, 1=gradual (fade in over first second)
      
      // --- Trill parameters ---
      { name: 'trillEnabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }, // 0=off, 1=on
      { name: 'trillInterval', defaultValue: 1, minValue: 1, maxValue: 12, automationRate: 'k-rate' }, // semitones above base note
      { name: 'trillSpeed', defaultValue: 5.0, minValue: 3.0, maxValue: 12.0, automationRate: 'k-rate' }, // Hz
      { name: 'trillArticulation', defaultValue: 0.7, minValue: 0.1, maxValue: 0.95, automationRate: 'k-rate' }, // 0.1=very separated, 0.95=very connected
      
      // --- Tremolo parameters ---
      { name: 'tremoloEnabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }, // 0=off, 1=on
      { name: 'tremoloSpeed', defaultValue: 4.0, minValue: 1.0, maxValue: 12.0, automationRate: 'k-rate' }, // Hz
      { name: 'tremoloDepth', defaultValue: 0.7, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // 0-1
      { name: 'tremoloArticulation', defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' }, // 0.01=extreme staccato, 0.99=extreme legato
      
      // --- Instrument Body ---
      { name: 'bodyType', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' }, // 0=violin, 1=viola, 2=cello, 3=guitar, 4=none
      { name: 'bodyResonance', defaultValue: 0.3, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      
      // --- Master Output ---
      { name: 'masterGain', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }, // Master volume control
    ];
  }

  constructor(options) {
    super(options);
    this.sampleRate = sampleRate; // Globally available in AudioWorkletGlobalScope

    // Cached AudioParam values to detect changes and trigger coefficient updates
    const descriptors = ContinuousExcitationProcessor.parameterDescriptors;
    this._cachedFundamentalFrequency = descriptors.find(p => p.name === 'fundamentalFrequency').defaultValue;
    this._cachedStringDamping = descriptors.find(p => p.name === 'stringDamping').defaultValue;
    this._cachedBrightness = descriptors.find(p => p.name === 'brightness').defaultValue;
    this._cachedBowPosition = descriptors.find(p => p.name === 'bowPosition').defaultValue;
    this._cachedStringMaterial = descriptors.find(p => p.name === 'stringMaterial').defaultValue;
    this._cachedBodyType = descriptors.find(p => p.name === 'bodyType').defaultValue;


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
    
    // Bow position affects which harmonics are suppressed
    this.harmonicGains = new Float32Array(NUM_STRING_MODES);
    
    // Dynamic bow pressure tracking
    this._lastDynamicCutoff = 0.5;
    
    // Attack/Release envelope
    this.bowEnvelope = 0.0;
    this.bowEnvelopeTarget = 0.0;
    this.bowEnvelopeRate = 0.005; // ~20ms at 48kHz
    
    // Vibrato state
    this.vibratoPhase = 0.0;
    
    // Trill state
    this.trillPhase = 0.0;
    this.trillActive = false;
    this.trillRampFactor = 0.0; // For gradual speed changes
    this.trillCurrentSpeed = 3.0; // Start at minimum speed
    this.lastTrillState = 0; // Track if we're on upper or lower note
    
    // Tremolo state
    this.tremoloPhase = 0.0;
    this.tremoloActive = false;
    this.tremoloRampFactor = 0.0;
    this.tremoloStrokeCount = 0;
    this.lastTremoloState = 0;
    this.tremoloGroupPhase = 0.0; // For natural grouping accents
    this.tremoloScratchiness = 0.0;
    this.tremoloBowSpeed = 1.0;
    
    // --- LPF State ---
    this.lpf_b0 = 1; this.lpf_b1 = 0; this.lpf_b2 = 0; 
    this.lpf_a1 = 0; this.lpf_a2 = 0;
    this.lpf_z1 = 0; this.lpf_z2 = 0;

    // --- Modal Body Resonator Base Parameters & State Arrays ---
    // Body presets: [violin, viola, cello, guitar, none]
    this.bodyPresets = [
      { // Violin
        freqs: [280, 460, 580, 700, 840],
        qs: [12, 15, 10, 8, 8],
        gains: [1.0, 0.8, 0.7, 0.5, 0.3]
      },
      { // Viola  
        freqs: [220, 380, 500, 650, 780],
        qs: [10, 12, 9, 7, 7],
        gains: [1.0, 0.85, 0.7, 0.5, 0.3]
      },
      { // Cello
        freqs: [100, 200, 300, 400, 500],
        qs: [8, 10, 8, 6, 6],
        gains: [1.0, 0.9, 0.8, 0.6, 0.4]
      },
      { // Guitar
        freqs: [100, 200, 400, 500, 600],
        qs: [15, 12, 10, 8, 8],
        gains: [1.0, 0.7, 0.8, 0.5, 0.4]
      },
      { // None
        freqs: [100, 200, 300, 400, 500],
        qs: [1, 1, 1, 1, 1],
        gains: [0, 0, 0, 0, 0]
      }
    ];
    this.numBodyModes = 5;

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
    
    // Master gain scaling
    this.masterGainScale = 10.0; // Boost range for master gain (0-10x)

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
      this.bowEnvelopeTarget = data.value ? 1.0 : 0.0;
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
    const bowPos = this._cachedBowPosition || 0.1; // Default if not yet set

    // Get material properties
    const material = Math.round(this._cachedStringMaterial || 0);
    let inharmonicity, dampingFactor, brightnessScale;
    
    switch(material) {
      case 0: // Steel - bright, low damping, moderate inharmonicity
        inharmonicity = 0.0003;
        dampingFactor = 0.8;
        brightnessScale = 1.0;
        break;
      case 1: // Gut - warm, higher damping, very low inharmonicity
        inharmonicity = 0.00005;
        dampingFactor = 1.5;
        brightnessScale = 0.7;
        break;
      case 2: // Nylon - mellow, high damping, low inharmonicity
        inharmonicity = 0.0001;
        dampingFactor = 2.0;
        brightnessScale = 0.5;
        break;
      case 3: // Wound - complex, moderate damping, higher inharmonicity
        inharmonicity = 0.0005;
        dampingFactor = 1.2;
        brightnessScale = 0.85;
        break;
      default:
        inharmonicity = 0.0003;
        dampingFactor = 1.0;
        brightnessScale = 1.0;
    }

    // Calculate modes with proper harmonic series and damping
    for (let i = 0; i < NUM_STRING_MODES; i++) {
      // Harmonic series with material-specific inharmonicity
      const modeNumber = i + 1;
      const modeFreq = fundamental * modeNumber * Math.sqrt(1 + inharmonicity * modeNumber * modeNumber);
      
      if (modeFreq > 0 && modeFreq < Fs / 2) {
        // Q decreases with mode number (higher modes decay faster)
        const baseQ = 200 / dampingFactor;
        const modeQ = baseQ / Math.sqrt(modeNumber) * (1 - this._cachedStringDamping * 0.8);
        
        // Mode amplitude decreases with mode number, affected by material brightness
        const modeAmplitude = (brightnessScale * Math.pow(0.95, modeNumber - 1)) / modeNumber;
        
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
        
        // Calculate harmonic gain based on bow position
        // Harmonics at integer multiples of 1/bowPos are suppressed
        const harmonicAtNode = Math.abs(Math.sin(Math.PI * modeNumber * bowPos));
        this.harmonicGains[i] = harmonicAtNode;
      } else {
        // Mode is out of range, silence it
        this.stringMode_b0[i] = 0;
        this.stringMode_b1[i] = 0;
        this.stringMode_b2[i] = 0;
        this.stringMode_a1[i] = 0;
        this.stringMode_a2[i] = 0;
        this.modeAmplitudes[i] = 0;
        this.modeFrequencies[i] = 0;
        this.harmonicGains[i] = 0;
      }
    }
  }

  _calculateLpfCoefficients(dynamicBrightness = null) {
    const Fs = this.sampleRate;
    const brightness = dynamicBrightness !== null ? dynamicBrightness : this._cachedBrightness;

    // Map brightness to frequency range
    const minF = 200, maxF = Math.min(12000, Fs * 0.45);
    let actualCutoffFreq = minF * Math.pow(maxF / minF, brightness);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));
    
    // Fixed reasonable Q
    const actualQ_lpf = 0.8;

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
    const bodyType = Math.round(this._cachedBodyType || 0);
    const preset = this.bodyPresets[bodyType];

    for (let i = 0; i < this.numBodyModes; i++) {
        const F0_param = preset.freqs[i]; 
        const Q_param = preset.qs[i]; 
        const Gain_param = preset.gains[i]; 

        if (F0_param <= 0 || F0_param >= Fs / 2 || Q_param <= 0 || Gain_param === 0) {
            this.bodyMode_b0[i] = 1; this.bodyMode_b1[i] = 0; this.bodyMode_b2[i] = 0;
            this.bodyMode_a1[i] = 0; this.bodyMode_a2[i] = 0;
            continue;
        }

        const omega = 2 * Math.PI * F0_param / Fs;
        const s_omega = Math.sin(omega);
        const c_omega = Math.cos(omega);
        const alpha = s_omega / (2 * Q_param);

        // BPF coefficients
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

  _recalculateAllCoefficientsIfNeeded(parameters) {
   let needsRecalcStringModes = false; // Renamed from needsRecalcModal
   let needsRecalcLpf = false;
    let needsRecalcBody = false; // Flag for body resonator
    const tolerance = 1e-6;

    // Check stringMaterial
    const stringMaterialVal = parameters.stringMaterial[0];
    if (Math.abs(stringMaterialVal - this._cachedStringMaterial) > tolerance) {
      this._cachedStringMaterial = stringMaterialVal;
      needsRecalcStringModes = true;
    }

    // Check bowPosition
    const bowPositionVal = parameters.bowPosition[0];
    if (Math.abs(bowPositionVal - this._cachedBowPosition) > tolerance) {
      this._cachedBowPosition = bowPositionVal;
      needsRecalcStringModes = true; // Bow position affects harmonic gains
    }

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

    // Check brightness
    const brightnessVal = parameters.brightness[0];
    if (Math.abs(brightnessVal - this._cachedBrightness) > tolerance) {
      this._cachedBrightness = brightnessVal;
      needsRecalcLpf = true;
    }

    if (needsRecalcStringModes) {
      this._calculateStringModeCoefficients(); // Renamed
    }
    if (needsRecalcLpf) {
      this._calculateLpfCoefficients();
    }

    // Check Body Type
    const bodyTypeVal = parameters.bodyType[0];
    if (Math.abs(bodyTypeVal - this._cachedBodyType) > tolerance) {
        this._cachedBodyType = bodyTypeVal;
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
    const bowForce = parameters.bowForce[0];
    const currentBodyMix = parameters.bodyResonance[0]; // k-rate
    const brightness = parameters.brightness[0];

    // Get bow parameters
    const bowPosition = parameters.bowPosition[0];
    const bowSpeed = parameters.bowSpeed[0];
    const masterGain = parameters.masterGain[0];
    
    // Vibrato parameters
    const vibratoEnabled = parameters.vibratoEnabled[0] > 0.5;
    const vibratoRate = parameters.vibratoRate[0];
    const vibratoDepth = parameters.vibratoDepth[0];
    
    // Trill parameters
    const trillEnabled = parameters.trillEnabled[0] > 0.5;
    const trillInterval = Math.round(parameters.trillInterval[0]); // 1-12 semitones
    const trillTargetSpeed = parameters.trillSpeed[0];
    const trillArticulation = parameters.trillArticulation[0]; // 0.1=separated, 0.95=connected
    
    // Tremolo parameters
    const tremoloEnabled = parameters.tremoloEnabled[0] > 0.5;
    const tremoloSpeed = parameters.tremoloSpeed[0];
    const tremoloDepth = parameters.tremoloDepth[0];
    const tremoloArticulation = parameters.tremoloArticulation[0]; // 0.01=extreme staccato, 0.99=extreme legato
    
    // Update vibrato phase (only if vibrato is enabled and trill/tremolo are not active)
    const vibratoIncrement = (vibratoEnabled && !trillEnabled && !tremoloEnabled ? vibratoRate : 0) / this.sampleRate;
    
    // Dynamic bow physics
    // Bow force affects brightness and noise
    const forceBrightness = 0.2 + (bowForce * 0.6); // Dynamic brightness from force
    const forceNoise = Math.pow(bowForce, 1.5) * 0.4; // More force = more noise
    
    // Bow speed affects harmonic content and smoothness
    const speedHarmonics = Math.pow(bowSpeed, 0.7); 
    const speedSmoothness = bowSpeed * 0.5; // Faster = smoother
    
    // Calculate tone/noise mix from physical parameters
    const toneNoiseMix = Math.max(0.3, Math.min(0.95, 0.8 - forceNoise + speedSmoothness));
    
    for (let i = 0; i < outputChannel.length; i++) {
      // Update bow envelope
      if (this.bowEnvelope < this.bowEnvelopeTarget) {
        this.bowEnvelope = Math.min(this.bowEnvelopeTarget, this.bowEnvelope + this.bowEnvelopeRate);
      } else if (this.bowEnvelope > this.bowEnvelopeTarget) {
        this.bowEnvelope = Math.max(this.bowEnvelopeTarget, this.bowEnvelope - this.bowEnvelopeRate);
      }
      
      // Update vibrato
      this.vibratoPhase += vibratoIncrement;
      if (this.vibratoPhase >= 1.0) this.vibratoPhase -= 1.0;
      const vibratoValue = Math.sin(2 * Math.PI * this.vibratoPhase);
      
      // Calculate vibrato modulations (70% pitch, 30% amplitude for realism)
      let pitchModulation = 1.0;
      let ampModulation = 1.0;
      
      if (vibratoEnabled && !trillEnabled && !tremoloEnabled) {
        pitchModulation = 1.0 + (vibratoValue * vibratoDepth * 0.06); // ±6% pitch
        ampModulation = 1.0 + (vibratoValue * vibratoDepth * 0.2); // ±20% amplitude
      }
      
      // Handle trill
      if (trillEnabled) {
        // Ramp up trill speed gradually
        if (this.trillRampFactor < 1.0) {
          this.trillRampFactor = Math.min(1.0, this.trillRampFactor + 0.002); // ~0.5s ramp
        }
        this.trillActive = true;
      } else {
        // Ramp down when disabling
        if (this.trillRampFactor > 0.0) {
          this.trillRampFactor = Math.max(0.0, this.trillRampFactor - 0.004); // Faster ramp down
        }
        if (this.trillRampFactor === 0.0) {
          this.trillActive = false;
          this.trillPhase = 0.0;
        }
      }
      
      if (this.trillActive || this.trillRampFactor > 0) {
        // Calculate current trill speed with ramping
        this.trillCurrentSpeed = 3.0 + (trillTargetSpeed - 3.0) * this.trillRampFactor;
        
        // Add slight timing variations for realism (±10%)
        const timingVariation = 1.0 + (Math.random() - 0.5) * 0.1;
        const trillIncrement = (this.trillCurrentSpeed * timingVariation) / this.sampleRate;
        
        this.trillPhase += trillIncrement;
        if (this.trillPhase >= 1.0) {
          this.trillPhase -= 1.0;
        }
        
        // Determine if we're on upper or lower note with articulation control
        // For articulation, we adjust how much of each phase is "active"
        let isActivePhase = false;
        let currentTrillState;
        
        if (this.trillPhase < 0.5) {
          // First half - lower note
          currentTrillState = 0;
          isActivePhase = this.trillPhase < (0.5 * trillArticulation);
        } else {
          // Second half - upper note
          currentTrillState = 1;
          const adjustedPhase = this.trillPhase - 0.5;
          isActivePhase = adjustedPhase < (0.5 * trillArticulation);
        }
        
        const trillTransition = currentTrillState !== this.lastTrillState;
        this.lastTrillState = currentTrillState;
        
        // Calculate pitch change - base note is the lower pitch
        if (currentTrillState === 1 && isActivePhase) {
          // Upper note - trill interval above base
          pitchModulation = Math.pow(2, trillInterval / 12.0);
        } else if (currentTrillState === 0 && isActivePhase) {
          // Lower note (base pitch)
          pitchModulation = 1.0;
        } else {
          // In gap - maintain previous pitch to avoid glitches
          pitchModulation = currentTrillState === 1 ? Math.pow(2, trillInterval / 12.0) : 1.0;
        }
        
        // Amplitude effects for hammer-on/lift-off with articulation
        if (!isActivePhase) {
          // In gap between notes
          ampModulation = 0.1; // Very quiet during gaps
        } else if (currentTrillState === 1) {
          // Upper note (hammered on) - much louder to compensate for psychoacoustic effects
          ampModulation = 1.5;
        } else {
          // Lower note - slightly quieter to increase contrast
          ampModulation = 0.85;
        }
        
        // Apply ramp factor to smooth enable/disable
        pitchModulation = 1.0 + (pitchModulation - 1.0) * this.trillRampFactor;
        ampModulation = 1.0 + (ampModulation - 1.0) * this.trillRampFactor;
      }
      
      // Handle tremolo
      if (tremoloEnabled) {
        if (this.tremoloRampFactor < 1.0) {
          this.tremoloRampFactor = Math.min(1.0, this.tremoloRampFactor + 0.003); // ~0.3s ramp
        }
        this.tremoloActive = true;
      } else {
        if (this.tremoloRampFactor > 0.0) {
          this.tremoloRampFactor = Math.max(0.0, this.tremoloRampFactor - 0.005);
        }
        if (this.tremoloRampFactor === 0.0) {
          this.tremoloActive = false;
          this.tremoloPhase = 0.0;
          this.tremoloStrokeCount = 0;
        }
      }
      
      if (this.tremoloActive || this.tremoloRampFactor > 0) {
        // Add slight timing variations for realism
        const timingVariation = 1.0 + (Math.random() - 0.5) * 0.15;
        const tremoloIncrement = (tremoloSpeed * timingVariation) / this.sampleRate;
        
        this.tremoloPhase += tremoloIncrement;
        if (this.tremoloPhase >= 1.0) {
          this.tremoloPhase -= 1.0;
          this.tremoloStrokeCount++;
        }
        
        // Determine bow direction (up/down)
        const currentTremoloState = this.tremoloPhase < 0.5 ? 0 : 1;
        const tremoloTransition = currentTremoloState !== this.lastTremoloState;
        this.lastTremoloState = currentTremoloState;
        
        // Natural grouping - slight accent every 3-4 strokes
        const groupSize = 3 + Math.floor(Math.random() * 2); // 3 or 4
        const isAccented = (this.tremoloStrokeCount % groupSize) === 0;
        
        // Model bow speed changes through the stroke cycle
        // Bow slows to zero at turnaround points (0 and 0.5)
        let bowSpeedFactor = 1.0;
        
        // Adjust phase mapping based on articulation
        // For extreme staccato (0.01), stroke takes up only 1% of cycle
        // For extreme legato (0.99), stroke takes up 99% of cycle
        let phaseInStroke;
        if (currentTremoloState === 0) {
          // First half of cycle
          if (this.tremoloPhase < tremoloArticulation * 0.5) {
            // Active stroke portion
            phaseInStroke = this.tremoloPhase / (tremoloArticulation * 0.5);
          } else {
            // Gap portion - bow speed is zero
            phaseInStroke = 1.0;
          }
        } else {
          // Second half of cycle
          const adjustedPhase = this.tremoloPhase - 0.5;
          if (adjustedPhase < tremoloArticulation * 0.5) {
            // Active stroke portion
            phaseInStroke = adjustedPhase / (tremoloArticulation * 0.5);
          } else {
            // Gap portion - bow speed is zero
            phaseInStroke = 1.0;
          }
        }
        
        // Calculate bow speed based on phase
        if (phaseInStroke < 1.0) {
          // Active stroke - use raised sine for longer turnarounds
          bowSpeedFactor = Math.pow(Math.sin(phaseInStroke * Math.PI), 2.5);
        } else {
          // In gap - minimal bow speed
          bowSpeedFactor = 0.0;
        }
        
        // Much more aggressive scratchiness at low speeds
        const nearTurnaround = bowSpeedFactor < 0.5;
        let scratchiness = 0.0;
        if (nearTurnaround) {
          // Extreme noise and irregularity at low bow speeds
          scratchiness = Math.pow((0.5 - bowSpeedFactor) * 2.0, 1.5); // 0 to 1.4
        }
        
        // Calculate amplitude for tremolo - more extreme dynamics
        let tremoloAmp = 0.5 + bowSpeedFactor * 0.7; // 0.5 to 1.2
        
        // Create more pronounced gap at turnaround points and during gaps
        if (bowSpeedFactor < 0.15) {
          // Much quieter at direction change
          tremoloAmp = 0.05 + bowSpeedFactor * 0.5;
        } else if (phaseInStroke >= 1.0) {
          // In gap between strokes
          tremoloAmp = 0.02;
        }
        
        // Simulate increased bow pressure during tremolo
        const tremoloPressureBoost = 1.3;
        
        // Add accent on grouped notes
        if (isAccented && bowSpeedFactor > 0.5) {
          tremoloAmp += 0.2;
        }
        
        // Apply depth control
        tremoloAmp = 1.0 + (tremoloAmp - 1.0) * tremoloDepth;
        
        // Apply tremolo amplitude modulation with pressure boost
        ampModulation *= tremoloAmp * this.tremoloRampFactor * tremoloPressureBoost;
        
        // Store scratchiness for use in excitation
        this.tremoloScratchiness = scratchiness;
        this.tremoloBowSpeed = bowSpeedFactor;
      }
      
      // Generate continuous bow excitation when bowing
      let excitationSignal = 0.0;
      
      if (this.bowEnvelope > 0.001) {
        const fundamental = parameters.fundamentalFrequency.length > 1 
          ? parameters.fundamentalFrequency[i] 
          : parameters.fundamentalFrequency[0];
        
        // Apply pitch vibrato to fundamental
        const vibratoFundamental = fundamental * pitchModulation;
        
        // Sawtooth wave
        const sawIncrement = vibratoFundamental / this.sampleRate;
        this.sawPhase += sawIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        const sawWave = 2.0 * this.sawPhase - 1.0;
        
        // Create richer harmonic content based on bow speed
        let complexTone = sawWave;
        if (speedHarmonics > 0.2) {
          const harm2Phase = (this.sawPhase * 2.0) % 1.0;
          const harm3Phase = (this.sawPhase * 3.0) % 1.0;
          const harm2 = (2.0 * harm2Phase - 1.0) * 0.25 * speedHarmonics;
          const harm3 = (2.0 * harm3Phase - 1.0) * 0.1 * speedHarmonics;
          complexTone += harm2 + harm3;
        }
        
        // Bow stick-slip friction simulation
        const friction = (Math.random() - 0.5) * 0.3;
        const toneSignal = complexTone * 0.85 + friction * 0.15;
        
        // Add noise
        let noiseSignal = Math.random() * 2.0 - 1.0;
        
        // Add extra scratchiness during tremolo turnarounds
        if (this.tremoloActive && this.tremoloScratchiness > 0) {
          // Much more aggressive scratch noise
          const scratchNoise = (Math.random() - 0.5) * this.tremoloScratchiness * 2.0;
          noiseSignal = noiseSignal * (1.0 + this.tremoloScratchiness * 2.0) + scratchNoise;
        }
        
        // Mix tone and noise based on physical parameters
        let effectiveNoiseMix = toneNoiseMix;
        if (this.tremoloActive) {
          // Much more noise during tremolo, especially at low bow speeds
          effectiveNoiseMix = Math.max(0.2, Math.min(1, toneNoiseMix - 0.3 - this.tremoloScratchiness * 0.7));
        }
        const mixedExcitation = toneSignal * effectiveNoiseMix + noiseSignal * (1.0 - effectiveNoiseMix);
        
        // Apply bow force with envelope and amplitude vibrato
        excitationSignal = mixedExcitation * bowForce * this.bowEnvelope * ampModulation;
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
        
        // Apply harmonic gain based on bow position
        y_n_string_modes_summed += y_n_mode * this.harmonicGains[mode];
      }
      
      // Scale the summed string mode output
      const stringOutput = y_n_string_modes_summed * this.outputScalingFactor;

      // Apply dynamic brightness based on bow parameters and trill
      if (this.bowEnvelope > 0.001 && i === 0) {
        let brightnessBoost = forceBrightness * 0.3;
        
        // Add brightness on trill hammer-ons
        if (this.trillActive && this.lastTrillState === 1 && this.trillPhase < 0.1) {
          brightnessBoost += 0.2 * this.trillRampFactor;
        }
        
        // Add brightness changes based on tremolo bow speed
        if (this.tremoloActive) {
          // Much darker at turnarounds, brighter in middle of stroke
          brightnessBoost += (this.tremoloBowSpeed - 0.5) * 0.4 * this.tremoloRampFactor;
          // Overall darker tone during tremolo (high pressure dulls the sound)
          brightnessBoost -= 0.2 * this.tremoloRampFactor;
        }
        
        const dynamicBrightness = Math.min(1.0, brightness * (1.0 + brightnessBoost));
        
        if (Math.abs(dynamicBrightness - this._lastDynamicCutoff) > 0.01) {
          this._lastDynamicCutoff = dynamicBrightness;
          this._calculateLpfCoefficients(dynamicBrightness);
        }
      }
      
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

      // Mix LPF output (pre-body) with Body Resonator output ---
      const mixedOutput = (y_n_lpf * (1.0 - currentBodyMix)) + (y_n_body_modes_summed * currentBodyMix);
      
      // Apply amplitude vibrato to final output as well (subtle)
      const finalOutput = mixedOutput * (1.0 + (ampModulation - 1.0) * 0.3);
      
      // Apply master gain with scaling
      const gainedOutput = finalOutput * masterGain * this.masterGainScale;
      
      // Soft clipping to prevent harsh distortion
      outputChannel[i] = Math.tanh(gainedOutput * 0.5) * 2.0; // Compensate for tanh compression
    }
    
    return true;
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);