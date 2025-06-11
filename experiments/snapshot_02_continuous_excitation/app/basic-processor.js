// basic-processor.js
class ContinuousExcitationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate; // sampleRate is globally available in AudioWorkletGlobalScope
    this.frequency = 220; // Default A3
    this.damping = 0.995;   // Damping factor (0 to <1) - high damping for continuous excitation
    this.bowForce = 0.02;  // Amplitude of the continuous noise excitation

    // Check for processorOptions and override defaults
    if (options && options.processorOptions) {
        if (options.processorOptions.frequency !== undefined) {
            this.frequency = options.processorOptions.frequency;
        }
        if (options.processorOptions.damping !== undefined) {
            this.damping = options.processorOptions.damping;
        }
        if (options.processorOptions.bowForce !== undefined) {
            this.bowForce = options.processorOptions.bowForce;
        }
    }

    this.delayLine = null;
    this.currentIndex = 0;
    this.delaySamples = 0;
    
    this.isBowing = false; // Initialize as not bowing

    this._initializeDelayLine();

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'setBowing') {
        if (typeof data.isBowing === 'boolean') {
            this.isBowing = data.isBowing;
            if (this.isBowing) {
                console.log(`[Processor] Bowing started. Freq: ${this.frequency.toFixed(2)}, Damp: ${this.damping.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}`);
                // Optional: one could also re-initialize or clear the delay line here if desired when bowing starts
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
        if (data.damping !== undefined && data.damping > 0 && data.damping < 1) { // Basic validation
          this.damping = data.damping;
        }
        if (data.bowForce !== undefined && data.bowForce >= 0) { // Basic validation
          this.bowForce = data.bowForce;
        }

        if (reinitializeDelayLine) {
          this._initializeDelayLine();
        }
        console.log(`[Processor] Parameters updated. Freq: ${this.frequency.toFixed(2)}, Damp: ${this.damping.toFixed(3)}, Force: ${this.bowForce.toFixed(3)}, Bowing: ${this.isBowing}`);
      }
    };
  }

  _initializeDelayLine() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    
    if (this.delaySamples < 2) { // Need at least 2 samples for the simplest filter
        console.error(`[Processor] Invalid delay samples: ${this.delaySamples} for frequency ${this.frequency}Hz at ${this.sampleRate}Hz. Delay line not (re)initialized.`);
        this.delayLine = null; // Mark as not ready
        return;
    }

    this.delayLine = new Float32Array(this.delaySamples); // Initialize with zeros
    this.currentIndex = 0;
    console.log(`[Processor] Delay line initialized. Size: ${this.delaySamples} for ${this.frequency.toFixed(2)}Hz.`);
  }

  process(inputs, outputs, parameters) {
    if (!this.delayLine || this.delaySamples === 0) {
      const silentOutput = outputs[0];
      for (let channel = 0; channel < silentOutput.length; channel++) {
        silentOutput[channel].fill(0);
      }
      return true; // Keep processor alive
    }

    const output = outputs[0];
    const outputChannel = output[0]; // Assuming mono output for now

    for (let i = 0; i < outputChannel.length; i++) {
      const currentSample = this.delayLine[this.currentIndex];
      outputChannel[i] = currentSample; // Output the current sample from delay line

      // Simple Karplus-Strong style filter: average current and next sample
      const nextSampleIndex = (this.currentIndex + 1) % this.delaySamples;
      let feedbackSample = (this.delayLine[this.currentIndex] + this.delayLine[nextSampleIndex]) * 0.5;
      
      let newSampleValue = feedbackSample * this.damping;

      if (this.isBowing) {
        // Continuous excitation: add scaled white noise
        const excitation = (Math.random() * 2 - 1) * this.bowForce;
        newSampleValue += excitation;
      }
      
      // Basic clipping to prevent runaway amplitudes. Better gain staging/limiting would be more robust.
      this.delayLine[this.currentIndex] = Math.max(-1.0, Math.min(1.0, newSampleValue));
      
      this.currentIndex = nextSampleIndex; // Advance to the next sample position in the circular buffer
    }
    return true; // Keep the processor alive
  }
}

// Register the new processor name
registerProcessor('continuous-excitation-processor', ContinuousExcitationProcessor);
