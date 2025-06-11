// basic-processor.js (ContinuousExcitationProcessor with resonant LPF)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate;
    // Parameters and their typical default values
    this.frequency = 220; 
    this.loopGain = 0.995;
    this.cutoffParam = 0.5;   // 0-1, maps to filter cutoff frequency
    this.resonanceParam = 0.1; // 0-1, maps to filter Q / resonance
    this.bowForce = 0.02;     // Overall gain for the mixed excitation
    this.sawtoothLevel = 0.5; // 0-1, mix between sawtooth and noise for excitation

    // Filter coefficients and state variables (Direct Form II Transposed)
    this.b0 = 1; this.b1 = 0; this.b2 = 0; // feedforward coefficients (normalized)
    this.a1 = 0; this.a2 = 0;             // feedback coefficients (normalized, signs as in y[n] = ... -a1*y[n-1] -a2*y[n-2])
    
    // Filter delay elements (z-1, z-2) for Transposed Direct Form II
    this.z1 = 0; // state variable 1
    this.z2 = 0; // state variable 2

    if (options && options.processorOptions) {
        this.frequency = options.processorOptions.frequency !== undefined ? options.processorOptions.frequency : this.frequency;
        this.loopGain = options.processorOptions.loopGain !== undefined ? options.processorOptions.loopGain : this.loopGain;
        this.cutoffParam = options.processorOptions.cutoffParam !== undefined ? options.processorOptions.cutoffParam : this.cutoffParam;
        this.resonanceParam = options.processorOptions.resonanceParam !== undefined ? options.processorOptions.resonanceParam : this.resonanceParam;
        this.bowForce = options.processorOptions.bowForce !== undefined ? options.processorOptions.bowForce : this.bowForce;
        this.sawtoothLevel = options.processorOptions.sawtoothLevel !== undefined ? options.processorOptions.sawtoothLevel : this.sawtoothLevel;
    }

    this.delayLine = null;
    this.currentIndex = 0;
    this.delaySamples = 0;
    this.sawPhase = 0.0;
    this.isBowing = false;

    this._calculateFilterCoefficients(); // Initial calculation based on initial params
    this._initializeDelayLine();        // This will also reset states and may recalc coeffs if Fs dependent

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'setBowing') {
        if (typeof data.isBowing === 'boolean') {
            this.isBowing = data.isBowing;
            if (this.isBowing) {
                this._resetFilterState();
                this._resetSawPhase();
                // console.log(`[Processor] Bowing started. Freq: ${this.frequency.toFixed(0)}, Cutoff: ${this.cutoffParam.toFixed(2)}, Reso: ${this.resonanceParam.toFixed(2)}, Saw: ${this.sawtoothLevel.toFixed(2)}, Force: ${this.bowForce.toFixed(3)}`);
            } else {
                // console.log('[Processor] Bowing stopped.');
            }
         }
      } else if (data.type === 'setParameter') {
        let reinitializeDelayLine = false;
        let recalculateFilter = false;

        if (data.frequency !== undefined && data.frequency !== this.frequency && data.frequency > 0) {
          this.frequency = data.frequency;
          reinitializeDelayLine = true; 
        }
        if (data.loopGain !== undefined) this.loopGain = data.loopGain;
        if (data.bowForce !== undefined) this.bowForce = data.bowForce;
        if (data.sawtoothLevel !== undefined) this.sawtoothLevel = data.sawtoothLevel;
        
        if (data.cutoffParam !== undefined && data.cutoffParam !== this.cutoffParam) {
            this.cutoffParam = data.cutoffParam;
            recalculateFilter = true;
        }
        if (data.resonanceParam !== undefined && data.resonanceParam !== this.resonanceParam) {
            this.resonanceParam = data.resonanceParam;
            recalculateFilter = true;
        }

        if (reinitializeDelayLine) {
            this._initializeDelayLine(); 
        } else if (recalculateFilter) {
            this._calculateFilterCoefficients();
        }
        // console.log(`[Processor] Params updated. Cutoff: ${this.cutoffParam.toFixed(2)}, Reso: ${this.resonanceParam.toFixed(2)}`);
      }
    };
  }

  _calculateFilterCoefficients() {
    const Fs = this.sampleRate;
    const minF = 40; 
    const maxF = Math.min(18000, Fs * 0.45); 
    let actualCutoffFreq = minF * Math.pow(maxF / minF, this.cutoffParam);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));

    // *** Exponential Mapping for Q ***
    const minQ = 0.707; 
    const maxQ = 20.0;  // Max Q for the exponential scale

    let actualQ;
    // Ensure resonanceParam is within [0, 1] bounds for safety, though UI should handle it.
    const currentResonanceParam = Math.max(0.0, Math.min(1.0, this.resonanceParam));

    if (currentResonanceParam <= 0) { 
        actualQ = minQ;
    } else if (minQ <= 0) { // Defensive case, should not be hit with minQ = 0.707
        actualQ = currentResonanceParam * maxQ; // Fallback to linear if minQ is zero/negative
    } else {
        actualQ = minQ * Math.pow(maxQ / minQ, currentResonanceParam);
    }
    // Final sanity check for actualQ value
    actualQ = Math.max(0.5, Math.min(actualQ, maxQ * 1.1)); // Cap at slightly above maxQ
    // *** End of Exponential Mapping for Q ***

    const F0 = actualCutoffFreq;
    const Q = actualQ;

    const omega = 2 * Math.PI * F0 / Fs;
    const s = Math.sin(omega);
    const c = Math.cos(omega);
    const alpha = s / (2 * Q);

    const b0_coeff = (1 - c) / 2;
    const b1_coeff = 1 - c;
    const b2_coeff = (1 - c) / 2;
    const a0_coeff = 1 + alpha;
    const a1_coeff = -2 * c;
    const a2_coeff = 1 - alpha;
    
    this.b0 = b0_coeff / a0_coeff;
    this.b1 = b1_coeff / a0_coeff;
    this.b2 = b2_coeff / a0_coeff;
    this.a1 = a1_coeff / a0_coeff; 
    this.a2 = a2_coeff / a0_coeff; 
    
    // console.log(`[Processor] Filter Coeffs: F0=${F0.toFixed(1)}, Q=${Q.toFixed(1)} (ResoParam: ${this.resonanceParam.toFixed(2)})`);
  }

  _resetFilterState() {
    this.z1 = 0.0; 
    this.z2 = 0.0;
  }

  _resetSawPhase() {
    this.sawPhase = 0.0;
  }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    if (this.delaySamples < 2) {
        console.error(`[Processor] InitializeDelayLine: Invalid delay samples (${this.delaySamples}) for Freq ${this.frequency}Hz. Delay line NOT set.`);
        this.delayLine = null; 
        return;
    }
    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;
    this._resetFilterState();
    this._resetSawPhase();
    this._calculateFilterCoefficients(); 
    // console.log(`[Processor] Delay line initialized. Size: ${this.delaySamples} for ${this.frequency.toFixed(0)}Hz.`);
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); 
      return true; 
    }

    const outputChannel = outputs[0][0];
    const sawPhaseIncrement = this.frequency / this.sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      const x_n = this.delayLine[this.currentIndex]; 
      
      // Apply Biquad Filter (Transposed Direct Form II)
      // y[n] = b0*x[n] + z1[n-1]
      // z1[n] = b1*x[n] - a1*y[n] + z2[n-1]
      // z2[n] = b2*x[n] - a2*y[n]
      
      const y_n = this.b0 * x_n + this.z1;
      this.z1 = (this.b1 * x_n) - (this.a1 * y_n) + this.z2;
      this.z2 = (this.b2 * x_n) - (this.a2 * y_n);
      
      outputChannel[i] = y_n; 

      let feedbackSample = y_n * this.loopGain;
 
      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        this.sawPhase += sawPhaseIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        
        const noiseSignal = (Math.random() * 2 - 1);
        
        const mixedExcitation = (sawtoothSignal * this.sawtoothLevel) + (noiseSignal * (1.0 - this.sawtoothLevel));
        feedbackSample += mixedExcitation * this.bowForce;
      }
      
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true;
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);