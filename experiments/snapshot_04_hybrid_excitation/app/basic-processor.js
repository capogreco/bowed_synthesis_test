// basic-processor.js (ContinuousExcitationProcessor with sawtooth + noise excitation)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate;
    this.frequency = 220; 
    this.loopGain = 0.995;
    this.filterCoeff = 0.5;
    this.bowForce = 0.02;     // Amplitude of noise component
    this.sawtoothLevel = 0.5; // Amplitude of sawtooth component (0-1), acts as mix control

    if (options && options.processorOptions) {
        this.frequency = options.processorOptions.frequency !== undefined ? options.processorOptions.frequency : this.frequency;
        this.loopGain = options.processorOptions.loopGain !== undefined ? options.processorOptions.loopGain : this.loopGain;
        this.filterCoeff = options.processorOptions.filterCoeff !== undefined ? options.processorOptions.filterCoeff : this.filterCoeff;
        this.bowForce = options.processorOptions.bowForce !== undefined ? options.processorOptions.bowForce : this.bowForce;
        this.sawtoothLevel = options.processorOptions.sawtoothLevel !== undefined ? options.processorOptions.sawtoothLevel : this.sawtoothLevel;
    }

    this.delayLine = null;
    this.currentIndex = 0;
    this.delaySamples = 0;
    this.lastFilterOutput = 0.0;
    this.sawPhase = 0.0; // Phase accumulator for sawtooth wave
    
    this.isBowing = false;

    this._initializeDelayLine();
    // No need to call _resetSawPhase here, _initializeDelayLine does it.

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'setBowing') {
        if (typeof data.isBowing === 'boolean') {
            this.isBowing = data.isBowing;
            if (this.isBowing) {
                this.lastFilterOutput = 0.0; 
                this._resetSawPhase(); // Reset saw phase when bowing starts
                console.log(`[Processor] Bowing started. Freq: ${this.frequency.toFixed(2)}, Gain: ${this.loopGain.toFixed(3)}, Filter: ${this.filterCoeff.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}, Saw: ${this.sawtoothLevel.toFixed(2)}`);
            } else {
                console.log('[Processor] Bowing stopped.');
            }
         }
      } else if (data.type === 'setParameter') {
        let reinitializeDelayLine = false;
        let resetSawPhaseNeeded = false;

        if (data.frequency !== undefined && data.frequency !== this.frequency && data.frequency > 0) {
          this.frequency = data.frequency;
          reinitializeDelayLine = true; 
          // saw phase will be reset by _initializeDelayLine if frequency changes
        }
        if (data.loopGain !== undefined && data.loopGain > 0 && data.loopGain < 1.5) {
          this.loopGain = data.loopGain;
        }
        if (data.filterCoeff !== undefined && data.filterCoeff >= 0 && data.filterCoeff <= 1) {
          this.filterCoeff = data.filterCoeff;
        }
        if (data.bowForce !== undefined && data.bowForce >= 0 && data.bowForce <= 1.0) { // Max bowForce 1.0
          this.bowForce = data.bowForce;
        }
        if (data.sawtoothLevel !== undefined && data.sawtoothLevel >= 0 && data.sawtoothLevel <= 1) {
          this.sawtoothLevel = data.sawtoothLevel;
        }

        if (reinitializeDelayLine) {
            this._initializeDelayLine(); // This will also reset saw phase
        }
        // console.log(`[Processor] Params. Freq: ${this.frequency.toFixed(2)}, Gain: ${this.loopGain.toFixed(3)}, Filter: ${this.filterCoeff.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}, Saw: ${this.sawtoothLevel.toFixed(2)}, Bow: ${this.isBowing}`);
      }
    };
  }

  _resetSawPhase() {
    this.sawPhase = 0.0;
  }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    
    if (this.delaySamples < 2) {
        console.error(`[Processor] Invalid delay samples: ${this.delaySamples} for freq ${this.frequency}Hz. Not initialized.`);
        this.delayLine = null;
        return;
    }

    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;
    this.lastFilterOutput = 0.0;
    this._resetSawPhase(); // Reset saw phase whenever delay line is (re)initialized
    // console.log(`[Processor] Delay line initialized. Size: ${this.delaySamples} for ${this.frequency.toFixed(2)}Hz.`);
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      outputs[0][0].fill(0); 
      return true; 
    }

    const outputChannel = outputs[0][0];
    const sawPhaseIncrement = this.frequency / this.sampleRate;

    for (let i = 0; i < outputChannel.length; i++) {
      const currentDelaySample = this.delayLine[this.currentIndex];
      outputChannel[i] = currentDelaySample;

      const filteredSample = currentDelaySample * (1.0 - this.filterCoeff) + this.lastFilterOutput * this.filterCoeff;
      this.lastFilterOutput = filteredSample;
      
      let newSampleValue = filteredSample * this.loopGain;

      if (this.isBowing) {
        // Sawtooth wave: (phase * 2) - 1 maps 0..1 to -1..1
        const sawtoothSignal = (this.sawPhase * 2.0) - 1.0;
        this.sawPhase += sawPhaseIncrement;
        if (this.sawPhase >= 1.0) {
            this.sawPhase -= 1.0;
        }

        const noiseSignal = (Math.random() * 2 - 1);
        
        // Mix: sawtoothLevel controls the balance between saw and noise.
        // bowForce scales the overall amplitude of the noise component.
        const sawComponent = sawtoothSignal * this.sawtoothLevel;
        // Noise component is scaled by bowForce AND by (1-sawtoothLevel)
        // so that as sawtoothLevel increases, noise contribution decreases.
        const noiseComponent = noiseSignal * this.bowForce * (1.0 - this.sawtoothLevel);
        
        const excitation = sawComponent + noiseComponent;
        // The total amplitude of excitation is now a bit more complex.
        // If sawtoothLevel = 1, excitation = sawtoothSignal.
        // If sawtoothLevel = 0, excitation = noiseSignal * bowForce.
        // If sawtoothLevel = 0.5, excitation = (sawtoothSignal * 0.5) + (noiseSignal * bowForce * 0.5).
        // Max amplitude of excitation could exceed bowForce if sawtoothLevel > 0.
        // Consider if bowForce should be an overall gain for the combined excitation.
        // For now, this mixing approach is fine for initial testing.

        newSampleValue += excitation;
      }
      
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, newSampleValue));
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true;
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);