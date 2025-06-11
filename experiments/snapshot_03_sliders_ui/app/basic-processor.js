// basic-processor.js (ContinuousExcitationProcessor with one-pole filter)
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate;
    this.frequency = 220; 
    this.loopGain = 0.995;      // Overall gain of the feedback loop (formerly damping)
    this.filterCoeff = 0.5;     // Coefficient for the one-pole LPF (0-1). Higher values = lower cutoff.
    this.bowForce = 0.02;       // Amplitude of the continuous noise excitation

    if (options && options.processorOptions) {
        this.frequency = options.processorOptions.frequency !== undefined ? options.processorOptions.frequency : this.frequency;
        this.loopGain = options.processorOptions.loopGain !== undefined ? options.processorOptions.loopGain : this.loopGain;
        this.filterCoeff = options.processorOptions.filterCoeff !== undefined ? options.processorOptions.filterCoeff : this.filterCoeff;
        this.bowForce = options.processorOptions.bowForce !== undefined ? options.processorOptions.bowForce : this.bowForce;
    }

    this.delayLine = null;
    this.currentIndex = 0;
    this.delaySamples = 0;
    this.lastFilterOutput = 0.0; // State for the one-pole filter
    
    this.isBowing = false; // Initialize as not bowing

    this._initializeDelayLine();

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'setBowing') {
        if (typeof data.isBowing === 'boolean') {
            this.isBowing = data.isBowing;
            if (this.isBowing) {
                // When bowing starts, reset filter state to avoid old values influencing new sound.
                this.lastFilterOutput = 0.0; 
                console.log(`[Processor] Bowing started. Freq: ${this.frequency.toFixed(2)}, Gain: ${this.loopGain.toFixed(3)}, Filter: ${this.filterCoeff.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}`);
            } else {
                console.log('[Processor] Bowing stopped.');
            }
         }
      } else if (data.type === 'setParameter') {
        let reinitializeDelayLine = false;
        if (data.frequency !== undefined && data.frequency !== this.frequency && data.frequency > 0) {
          this.frequency = data.frequency;
          reinitializeDelayLine = true;
        }
        // Validate loopGain: allow values slightly above 1 for exploration, but typically <= 1
        if (data.loopGain !== undefined && data.loopGain > 0 && data.loopGain < 1.5) { 
          this.loopGain = data.loopGain;
        }
        if (data.filterCoeff !== undefined && data.filterCoeff >= 0 && data.filterCoeff <= 1) {
          this.filterCoeff = data.filterCoeff;
        }
        if (data.bowForce !== undefined && data.bowForce >= 0) {
          this.bowForce = data.bowForce;
        }

        if (reinitializeDelayLine) {
          this._initializeDelayLine();
        }
        // console.log(`[Processor] Params updated. Freq: ${this.frequency.toFixed(2)}, Gain: ${this.loopGain.toFixed(3)}, Filter: ${this.filterCoeff.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}, Bowing: ${this.isBowing}`);
      }
    };
  }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    
    if (this.delaySamples < 2) {
        console.error(`[Processor] Invalid delay samples: ${this.delaySamples} for frequency ${this.frequency}Hz at ${this.sampleRate}Hz. Delay line not (re)initialized.`);
        this.delayLine = null;
        return;
    }

    this.delayLine = new Float32Array(this.delaySamples); // Initialize with zeros
    this.currentIndex = 0;
    this.lastFilterOutput = 0.0; // Reset filter state on reinitialization as well
    // console.log(`[Processor] Delay line initialized. Size: ${this.delaySamples} for ${this.frequency.toFixed(2)}Hz.`);
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      const silentOutput = outputs[0];
      for (let channel = 0; channel < silentOutput.length; channel++) {
        silentOutput[channel].fill(0);
      }
      return true; 
    }

    const outputChannel = outputs[0][0]; // Assuming mono output

    for (let i = 0; i < outputChannel.length; i++) {
      const currentDelaySample = this.delayLine[this.currentIndex];
      // Output the raw sample from the delay line *before* it's filtered and processed for feedback
      outputChannel[i] = currentDelaySample; 

      // Apply one-pole low-pass filter to the sample read from the delay line.
      // The filter formula is y[n] = x[n] * (1-g) + y[n-1] * g
      // Here, x[n] is currentDelaySample, y[n-1] is this.lastFilterOutput, g is this.filterCoeff
      const filteredSample = currentDelaySample * (1.0 - this.filterCoeff) + this.lastFilterOutput * this.filterCoeff;
      this.lastFilterOutput = filteredSample; // Store the filter's output for the next sample
      
      // Apply overall loop gain to the filtered sample
      let newSampleValue = filteredSample * this.loopGain;

      if (this.isBowing) {
        // Continuous excitation: add scaled white noise
        const excitation = (Math.random() * 2 - 1) * this.bowForce;
        newSampleValue += excitation;
      }
      
      // Basic clipping to prevent runaway amplitudes.
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, newSampleValue));
      
      // Advance to the next sample position in the circular buffer
      this.currentIndex = (this.currentIndex + 1) % this.delaySamples;
    }
    return true; // Keep the processor alive
  }
}

registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);