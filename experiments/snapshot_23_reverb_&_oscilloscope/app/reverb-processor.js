// reverb-processor.js - FDN (Feedback Delay Network) Reverb for AudioWorklet

class FDNReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mix', defaultValue: 0.3, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'roomSize', defaultValue: 0.5, minValue: 0.1, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 0.5, minValue: 0.0, maxValue: 0.90, automationRate: 'k-rate' }, // Max decay capped
      { name: 'damping', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'preDelay', defaultValue: 10, minValue: 0, maxValue: 100, automationRate: 'k-rate' }, // ms
      { name: 'diffusion', defaultValue: 0.7, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'modulation', defaultValue: 0.2, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'earlyLevel', defaultValue: 0.5, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sampleRate = sampleRate; // Global in AudioWorkletGlobalScope
    
    // Enhanced 12-delay FDN with prime number lengths (in samples)
    // More delays = smoother, denser reverb
    this.baseDelayLengths = [
      1237, 1381, 1607, 1949,  // Original 4
      2237, 2671, 2903, 3271,  // Additional 4 for density
      3469, 3697, 3929, 4177   // Additional 4 for ultra-smooth decay
    ];
    
    // Initialize delay lines
    this.delayLines = this.baseDelayLengths.map(length => ({
      buffer: new Float32Array(Math.ceil(length * 3)), // Extra space for room size scaling and modulation
      writeIndex: 0,
      length: length,
      currentLength: length, // For smooth size changes
      targetLength: length   // For smooth size changes
    }));
    
    // 12x12 Hadamard-inspired orthogonal matrix for 12 delays
    // Using a combination of Hadamard patterns for good diffusion
    const s = 0.288675135; // 1/sqrt(12) for normalization
    this.mixMatrix = [
      [s, s, s, s, s, s, s, s, s, s, s, s],
      [s, -s, s, -s, s, -s, s, -s, s, -s, s, -s],
      [s, s, -s, -s, s, s, -s, -s, s, s, -s, -s],
      [s, -s, -s, s, s, -s, -s, s, s, -s, -s, s],
      [s, s, s, s, -s, -s, -s, -s, s, s, s, s],
      [s, -s, s, -s, -s, s, -s, s, s, -s, s, -s],
      [s, s, -s, -s, -s, -s, s, s, s, s, -s, -s],
      [s, -s, -s, s, -s, s, s, -s, s, -s, -s, s],
      [s, s, s, s, s, s, s, s, -s, -s, -s, -s],
      [s, -s, s, -s, s, -s, s, -s, -s, s, -s, s],
      [s, s, -s, -s, s, s, -s, -s, -s, -s, s, s],
      [s, -s, -s, s, s, -s, -s, s, -s, s, s, -s]
    ];
    
    // Simple one-pole lowpass filters for damping (one per delay line)
    this.dampingFilters = this.delayLines.map(() => ({
      state: 0
    }));
    
    // Input diffusion allpass filters
    this.inputAllpass = [
      { buffer: new Float32Array(142), index: 0, gain: 0.7 },
      { buffer: new Float32Array(107), index: 0, gain: 0.7 },
      { buffer: new Float32Array(379), index: 0, gain: 0.7 },
      { buffer: new Float32Array(277), index: 0, gain: 0.7 }
    ];
    
    // Modulation LFOs (one per delay line)
    this.modLFOs = this.delayLines.map((_, i) => ({
      phase: Math.random(),  // Random start phase
      rate: 0.5 + i * 0.13  // Slightly different rates
    }));
    
    // Early reflections tap delays (in ms, converted to samples)
    this.earlyReflections = [
      { delay: 7, gain: 0.9, pan: -0.5 },    // Left wall
      { delay: 11, gain: 0.85, pan: 0.5 },   // Right wall
      { delay: 19, gain: 0.8, pan: -0.3 },   // Left-center
      { delay: 23, gain: 0.75, pan: 0.3 },   // Right-center
      { delay: 31, gain: 0.7, pan: -0.7 },   // Far left
      { delay: 37, gain: 0.65, pan: 0.7 },   // Far right
      { delay: 43, gain: 0.6, pan: 0.0 },    // Back wall
      { delay: 53, gain: 0.55, pan: -0.2 },  // Left rear
      { delay: 61, gain: 0.5, pan: 0.2 },    // Right rear
      { delay: 71, gain: 0.45, pan: 0.0 }    // Ceiling
    ];
    
    // Convert delays to samples and create buffers
    this.earlyReflections = this.earlyReflections.map(tap => ({
      buffer: new Float32Array(Math.ceil(tap.delay * this.sampleRate / 1000)),
      writeIndex: 0,
      gain: tap.gain,
      pan: tap.pan
    }));
    
    // Pre-delay line
    this.preDelaySize = Math.ceil(0.1 * this.sampleRate); // Max 100ms
    this.preDelayBuffer = new Float32Array(this.preDelaySize);
    this.preDelayWriteIndex = 0;
    
    // Cached parameter values
    this._cachedRoomSize = 0.5;
    this._cachedDecay = 0.5; // Will be capped by descriptor
    this._cachedDamping = 0.5;
    this._cachedPreDelay = 10;
    this._cachedDiffusion = 0.7;
    this._cachedModulation = 0.2;
    this._cachedEarlyLevel = 0.5;

    // DC Blocking HPF states
    this.dcBlockInput = { x1: 0, y1: 0 };
    this.dcBlockFeedback = this.delayLines.map(() => ({ x1: 0, y1: 0 }));
    
    // Update delay lengths based on initial room size
    this._updateDelayLengths();
  }
  
  _updateDelayLengths() {
    const sizeMultiplier = 0.5 + this._cachedRoomSize * 1.5; // 0.5x to 2x
    
    for (let i = 0; i < this.delayLines.length; i++) {
      const newLength = Math.floor(this.baseDelayLengths[i] * sizeMultiplier);
      // Ensure we don't exceed buffer size minus modulation headroom
      const maxSafeLength = this.delayLines[i].buffer.length - 10;
      
      // Store target length for smooth interpolation
      this.delayLines[i].targetLength = Math.min(newLength, maxSafeLength);
      
      // Don't change actual length immediately - let it interpolate
      if (!this.delayLines[i].currentLength) {
        this.delayLines[i].currentLength = this.delayLines[i].length;
      }
    }
  }
  
  _processDampingFilter(input, filterIndex) {
    // Simple one-pole lowpass: y[n] = x[n] * (1-d) + y[n-1] * d
    const damping = this._cachedDamping;
    const filter = this.dampingFilters[filterIndex];
    
    filter.state = input * (1 - damping) + filter.state * damping;
    return filter.state;
  }

  _processDCBlock(input, hpf) {
    // Simple 1st order HPF: y[n] = x[n] - x[n-1] + R * y[n-1]
    // R is typically close to 1, e.g., 0.995
    const R = 0.995;
    const output = input - hpf.x1 + R * hpf.y1;
    hpf.x1 = input;
    hpf.y1 = output;
    return output;
  }
  
  _processAllpass(input, allpass) {
    // Allpass filter for diffusion
    const delayed = allpass.buffer[allpass.index];
    const output = -input + delayed;
    allpass.buffer[allpass.index] = input + (delayed * allpass.gain);
    allpass.index = (allpass.index + 1) % allpass.buffer.length;
    return output;
  }
  
  _processInputDiffusion(input) {
    // Process through cascade of allpass filters
    let signal = input;
    const diffusionAmount = this._cachedDiffusion;
    
    for (let i = 0; i < this.inputAllpass.length; i++) {
      const wet = this._processAllpass(signal, this.inputAllpass[i]);
      signal = signal * (1 - diffusionAmount) + wet * diffusionAmount;
    }
    
    return signal;
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    // Handle mono or stereo input
    const inputChannelCount = input.length;
    const outputChannelCount = output.length;
    
    if (inputChannelCount === 0 || outputChannelCount === 0) {
      return true;
    }
    
    // Get parameters
    const mix = parameters.mix[0];
    const roomSize = parameters.roomSize[0];
    const decay = parameters.decay[0];
    const damping = parameters.damping[0];
    const preDelayMs = parameters.preDelay[0];
    const diffusion = parameters.diffusion[0];
    const modulation = parameters.modulation[0];
    const earlyLevel = parameters.earlyLevel[0];
    
    // Update cached values if changed with safety limits
    if (Math.abs(roomSize - this._cachedRoomSize) > 0.001) {
      this._cachedRoomSize = Math.max(0.1, Math.min(0.95, roomSize)); // Limit room size for stability
      this._updateDelayLengths(); // This sets targetLength for delay lines
      // No separate sizeChangeSmoothing needed here, interpolation is in process()
    }
    // The 'decay' parameter is capped by its descriptor's maxValue: 0.90
    this._cachedDecay = decay;
    this._cachedDamping = damping;
    this._cachedDiffusion = diffusion;
    this._cachedModulation = Math.min(0.8, modulation); // Limit modulation depth
    this._cachedEarlyLevel = earlyLevel;
    
    // Convert pre-delay from ms to samples
    const preDelaySamples = Math.floor((preDelayMs / 1000) * this.sampleRate);
    this._cachedPreDelay = Math.min(preDelaySamples, this.preDelaySize - 1);
    
    const blockSize = output[0].length;
    
    for (let sample = 0; sample < blockSize; sample++) {
      // Sum input channels to mono
      let inputSample = 0;
      for (let ch = 0; ch < inputChannelCount; ch++) {
        inputSample += input[ch][sample] / inputChannelCount;
      }
      
      // Pre-delay
      const preDelayReadIndex = (this.preDelayWriteIndex - this._cachedPreDelay + this.preDelaySize) % this.preDelaySize;
      const delayedInput = this.preDelayBuffer[preDelayReadIndex];
      this.preDelayBuffer[this.preDelayWriteIndex] = inputSample;
      this.preDelayWriteIndex = (this.preDelayWriteIndex + 1) % this.preDelaySize;

      // Apply DC blocking to the input of the reverb network
      const dcBlockedInput = this._processDCBlock(delayedInput, this.dcBlockInput);
      
      // Process early reflections
      let earlySum = 0;
      for (let i = 0; i < this.earlyReflections.length; i++) {
        const tap = this.earlyReflections[i];
        const readIndex = (tap.writeIndex - tap.buffer.length + 1 + tap.buffer.length) % tap.buffer.length;
        earlySum += tap.buffer[readIndex] * tap.gain;
        tap.buffer[tap.writeIndex] = delayedInput;
        tap.writeIndex = (tap.writeIndex + 1) % tap.buffer.length;
      }
      
      // Apply input diffusion to the DC-blocked signal
      const diffusedInput = this._processInputDiffusion(dcBlockedInput);
      
      // Read from delay lines with modulation
      const delayOutputs = [];
      for (let i = 0; i < this.delayLines.length; i++) {
        const delay = this.delayLines[i];
        const lfo = this.modLFOs[i];
        
        // Smoothly interpolate delay length if needed
        if (delay.targetLength !== undefined && delay.currentLength !== undefined) {
          const diff = delay.targetLength - delay.currentLength;
          if (Math.abs(diff) > 0.1) {
            delay.currentLength += diff * (this.sizeChangeSmoothing || 0.001);
          } else {
            delay.currentLength = delay.targetLength;
          }
          delay.length = delay.currentLength;
        }
        
        // Update LFO
        lfo.phase += lfo.rate / this.sampleRate;
        if (lfo.phase >= 1.0) lfo.phase -= 1.0;
        
        // Calculate modulated delay length
        const modDepth = modulation * 3; // Reduced max modulation to prevent buffer overrun
        const modOffset = Math.sin(2 * Math.PI * lfo.phase) * modDepth;
        const modulatedLength = Math.max(1, delay.length + modOffset); // Ensure positive length
        
        // Linear interpolation for fractional delay with bounds checking
        const readPos = delay.writeIndex - modulatedLength;
        const safeReadPos = readPos < 0 ? readPos + delay.buffer.length : readPos;
        const readIndex = Math.floor(safeReadPos) % delay.buffer.length;
        const readIndexNext = (readIndex + 1) % delay.buffer.length;
        const frac = safeReadPos - Math.floor(safeReadPos);
        
        // Bounds checking to prevent array access errors
        if (readIndex >= 0 && readIndex < delay.buffer.length && 
            readIndexNext >= 0 && readIndexNext < delay.buffer.length) {
          delayOutputs[i] = delay.buffer[readIndex] * (1 - frac) + delay.buffer[readIndexNext] * frac;
        } else {
          delayOutputs[i] = 0; // Safety fallback
        }
      }
      
      // Apply mixing matrix
      const mixedOutputs = [];
      for (let i = 0; i < this.delayLines.length; i++) {
        let sum = 0;
        for (let j = 0; j < this.delayLines.length; j++) {
          sum += delayOutputs[j] * this.mixMatrix[i][j];
        }
        mixedOutputs[i] = sum;
      }
      
      // Write back to delay lines with feedback, damping, and new input
      for (let i = 0; i < this.delayLines.length; i++) {
        const delay = this.delayLines[i];
        
        // Apply damping and decay
        let processed = this._processDampingFilter(mixedOutputs[i] * decay, i);
        
        // Add diffused input to all delay lines (distributed evenly)
        processed += diffusedInput * (1.0 / this.delayLines.length);

        // Apply DC blocking within the feedback loop
        processed = this._processDCBlock(processed, this.dcBlockFeedback[i]);
        
        // Write to delay line
        delay.buffer[delay.writeIndex] = processed;
        delay.writeIndex = (delay.writeIndex + 1) % delay.buffer.length;
      }
      
      // Sum all delay outputs for late reverb signal
      let lateReverbSample = 0;
      for (let i = 0; i < delayOutputs.length; i++) {
        lateReverbSample += delayOutputs[i] * (1.0 / this.delayLines.length); // Equal mix of all delays
      }
      
      // Mix early and late reverb
      const reverbSample = earlySum * earlyLevel + lateReverbSample * (1 - earlyLevel * 0.3);
      
      // Apply mix between dry and wet signals
      const outputSample = inputSample * (1 - mix) + reverbSample * mix;
      
      // Apply soft limiting to prevent clipping
      const limitedOutput = Math.tanh(outputSample * 0.7) * 1.4285;
      
      // Write to all output channels
      for (let ch = 0; ch < outputChannelCount; ch++) {
        output[ch][sample] = limitedOutput;
      }
    }
    
    return true;
  }
}

registerProcessor('fdn-reverb-processor', FDNReverbProcessor);