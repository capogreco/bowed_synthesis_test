// basic-processor.js (Excitation: (Saw/Pulse Mix) vs Noise Mix - Inverted Pulse)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate;
    // Parameters
    this.frequency = 220; 
    this.loopGain = 0.995;
    this.cutoffParam = 0.5;   // 0-1, maps to filter cutoff frequency
    this.resonanceParam = 0.1; // 0-1, maps to filter Q / resonance
    this.bowForce = 0.02;       // Overall intensity for the final excitation
    this.sawPulseMixParam = 0.5;  // 0=Pulse, 1=Saw (effectively)
    this.pulseWidthParam = 0.5; 
    this.toneNoiseMixParam = 0.5; // 0=Noise, 1=Tone (Saw/Pulse mix)

    if (options && options.processorOptions) {
        this.frequency = options.processorOptions.frequency !== undefined ? options.processorOptions.frequency : this.frequency;
        this.loopGain = options.processorOptions.loopGain !== undefined ? options.processorOptions.loopGain : this.loopGain;
        this.cutoffParam = options.processorOptions.cutoffParam !== undefined ? options.processorOptions.cutoffParam : this.cutoffParam;
        this.resonanceParam = options.processorOptions.resonanceParam !== undefined ? options.processorOptions.resonanceParam : this.resonanceParam;
        this.bowForce = options.processorOptions.bowForce !== undefined ? options.processorOptions.bowForce : this.bowForce;
        this.sawPulseMixParam = options.processorOptions.sawPulseMixParam !== undefined ? options.processorOptions.sawPulseMixParam : this.sawPulseMixParam;
        this.pulseWidthParam = options.processorOptions.pulseWidthParam !== undefined ? options.processorOptions.pulseWidthParam : this.pulseWidthParam;
        this.toneNoiseMixParam = options.processorOptions.toneNoiseMixParam !== undefined ? options.processorOptions.toneNoiseMixParam : this.toneNoiseMixParam;
    }

    // Filter coefficients and state variables (Transposed Direct Form II)
    this.b0 = 1; this.b1 = 0; this.b2 = 0; 
    this.a1 = 0; this.a2 = 0;             
    this.z1 = 0; // filter state variable 1
    this.z2 = 0; // filter state variable 2
    
    // Delay Line
    this.delayLine = null; 
    this.currentIndex = 0; 
    this.delaySamples = 0;
    
    // Excitation
    this.sawPhase = 0.0; // Used for both sawtooth and pulse wave generation
    this.isBowing = false;

    this._calculateFilterCoefficients(); 
    this._initializeDelayLine();        

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'setBowing') {
        if (typeof data.isBowing === 'boolean') {
            this.isBowing = data.isBowing;
            if (this.isBowing) { 
                this._resetFilterState();
                this._resetSawPhase();
            } 
         }
      } else if (data.type === 'setParameter') {
        let reinitDelay = false, recalcFilter = false; // Correct declaration
        if (data.frequency !== undefined && data.frequency !== this.frequency && data.frequency > 0) {
          this.frequency = data.frequency; reinitDelay = true;
        }
        if (data.loopGain !== undefined) this.loopGain = data.loopGain;
        if (data.bowForce !== undefined) this.bowForce = data.bowForce;
        // Renamed parameters for new mixing scheme
        if (data.sawPulseMixParam !== undefined) this.sawPulseMixParam = data.sawPulseMixParam; 
        if (data.pulseWidthParam !== undefined) this.pulseWidthParam = data.pulseWidthParam;
        if (data.toneNoiseMixParam !== undefined) this.toneNoiseMixParam = data.toneNoiseMixParam; 
        
        if (data.cutoffParam !== undefined && data.cutoffParam !== this.cutoffParam) {
            this.cutoffParam = data.cutoffParam; recalcFilter = true; // Use correct variable
        }
        if (data.resonanceParam !== undefined && data.resonanceParam !== this.resonanceParam) {
            this.resonanceParam = data.resonanceParam; recalcFilter = true; // Use correct variable
        }

        if (reinitDelay) {
            this._initializeDelayLine(); 
        } else if (recalcFilter) { // Use correct variable
            this._calculateFilterCoefficients();
        }
      }
    };
  }

  _calculateFilterCoefficients() {
    const Fs = this.sampleRate;
    const minF = 40, maxF = Math.min(18000, Fs * 0.45); 
    let actualCutoffFreq = minF * Math.pow(maxF / minF, this.cutoffParam);
    actualCutoffFreq = Math.max(minF, Math.min(maxF, actualCutoffFreq));

    const minQ = 0.707; 
    const maxQ = 2.5;  // Aggressive Q mapping
    let actualQ;
    const currentResonanceParam = Math.max(0.0, Math.min(1.0, this.resonanceParam));
    const mappedResonanceParam = Math.pow(currentResonanceParam, 3); 

    if (mappedResonanceParam <= 0) { 
        actualQ = minQ;
    } else if (minQ <= 0) { 
        actualQ = mappedResonanceParam * maxQ; 
    } else {
        actualQ = minQ * Math.pow(maxQ / minQ, mappedResonanceParam);
    }
    actualQ = Math.max(minQ, Math.min(actualQ, maxQ * 1.01)); 

    const F0 = actualCutoffFreq, Q = actualQ;
    const omega = 2 * Math.PI * F0 / Fs, s = Math.sin(omega), c = Math.cos(omega);
    const alpha = s / (2 * Q);
    const b0_coeff = (1 - c) / 2, b1_coeff = 1 - c, b2_coeff = (1 - c) / 2;
    const a0_coeff = 1 + alpha, a1_coeff = -2 * c, a2_coeff = 1 - alpha;
    this.b0 = b0_coeff / a0_coeff; this.b1 = b1_coeff / a0_coeff; this.b2 = b2_coeff / a0_coeff;
    this.a1 = a1_coeff / a0_coeff; this.a2 = a2_coeff / a0_coeff; 
  }

  _resetFilterState() { this.z1 = 0.0; this.z2 = 0.0; }
  _resetSawPhase() { this.sawPhase = 0.0; }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    if (this.delaySamples < 2) { 
        console.error(`[Processor] InitDelay: Invalid samples (${this.delaySamples}) for Freq ${this.frequency}Hz.`);
        this.delayLine = null; return; 
    }
    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;
    this._resetFilterState(); this._resetSawPhase();
    this._calculateFilterCoefficients();
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); return true; 
    }
    const outputChannel = outputs[0][0];
    const phaseIncrement = this.frequency / this.sampleRate; 

    for (let i = 0; i < outputChannel.length; i++) {
      const x_n = this.delayLine[this.currentIndex]; 
      
      const y_n = this.b0 * x_n + this.z1;
      this.z1 = (this.b1 * x_n) - (this.a1 * y_n) + this.z2;
      this.z2 = (this.b2 * x_n) - (this.a2 * y_n);
      
      outputChannel[i] = y_n; 
      let feedbackSample = y_n * this.loopGain;
 
      if (this.isBowing) {
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        
        const actualPulseWidth = Math.max(0.01, Math.min(0.99, this.pulseWidthParam));
        let pulseSignal = (this.sawPhase < actualPulseWidth) ? 1.0 : -1.0;
        pulseSignal = -pulseSignal; // Invert the pulse signal
        
        this.sawPhase += phaseIncrement;
        if (this.sawPhase >= 1.0) this.sawPhase -= 1.0;
        
        const noiseSignal = (Math.random() * 2 - 1);
        
        // 1. Mix Saw and Pulse (controlled by sawPulseMixParam)
        // sawPulseMixParam: 0 = pure (inverted) Pulse, 1 = pure Saw
        const combinedTone = (sawtoothSignal * this.sawPulseMixParam) + (pulseSignal * (1.0 - this.sawPulseMixParam));
        
        // 2. Mix Combined Tone with Noise (controlled by toneNoiseMixParam)
        // toneNoiseMixParam: 0 = pure Noise, 1 = pure Combined Tone
        const finalExcitationMix = (combinedTone * this.toneNoiseMixParam) + (noiseSignal * (1.0 - this.toneNoiseMixParam));
        
        // 3. Scale final mixed excitation by overall bowForce
        feedbackSample += finalExcitationMix * this.bowForce;
      }
      
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, feedbackSample));
      
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true;
  }
}
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);