// basic-processor.js
class KarplusStrongProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.sampleRate = sampleRate; // sampleRate is globally available in AudioWorkletGlobalScope
    this.frequency = 220; // Default A3
    this.damping = 0.995;   // Feedback damping factor (0 to <1)

    // Check for processorOptions and override defaults
    if (options && options.processorOptions) {
        if (options.processorOptions.frequency !== undefined) {
            this.frequency = options.processorOptions.frequency;
        }
        if (options.processorOptions.damping !== undefined) {
            this.damping = options.processorOptions.damping;
        }
    }

    this.delayLine = null;
    this.currentIndex = 0;
    this.delaySamples = 0;
    
    this._excite(); // Initial pluck when the processor is created

    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'pluck') {
        if (event.data.frequency !== undefined) {
            this.frequency = event.data.frequency;
        }
        if (event.data.damping !== undefined) {
            this.damping = event.data.damping;
        }
        this._excite(); // Re-initialize and pluck the string
      }
      // Future: messages to change frequency/damping without a full re-pluck (more complex)
    };
  }

  _excite() {
    this.delaySamples = Math.floor(this.sampleRate / this.frequency);
    
    // Ensure delaySamples is a positive number to avoid errors
    // A delay line of at least 2 samples is practically needed for most KS filters
    if (this.delaySamples < 2) {
        console.error(`[KarplusStrongProcessor] Invalid delay samples: ${this.delaySamples} for frequency ${this.frequency}Hz at ${this.sampleRate}Hz. String not excited.`);
        this.delayLine = null; // Mark as not ready
        return;
    }

    this.delayLine = new Float32Array(this.delaySamples);
    this.currentIndex = 0;

    // Fill the delay line with white noise
    for (let i = 0; i < this.delaySamples; i++) {
      this.delayLine[i] = Math.random() * 2 - 1; // Values between -1.0 and 1.0
    }
    console.log(`[KarplusStrongProcessor] Plucked string at ${this.frequency.toFixed(2)}Hz. Delay line size: ${this.delaySamples}, Damping: ${this.damping}`);
  }

  process(inputs, outputs, parameters) {
    // If the delay line isn't initialized (e.g., due to invalid frequency), output silence
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
      outputChannel[i] = currentSample;

      // Simple Karplus-Strong low-pass filter: average the current sample 
      // with the next sample in the circular buffer, then apply damping.
      // This helps simulate string decay and high-frequency loss.
      const nextSampleIndex = (this.currentIndex + 1) % this.delaySamples;
      const filteredSample = (this.delayLine[this.currentIndex] + this.delayLine[nextSampleIndex]) * 0.5 * this.damping;
      
      this.delayLine[this.currentIndex] = filteredSample;
      
      this.currentIndex = nextSampleIndex; // Advance to the next sample position
    }
    return true; // Keep the processor alive
  }
}

// Important: Register with the new name
registerProcessor('karplus-strong-processor', KarplusStrongProcessor);