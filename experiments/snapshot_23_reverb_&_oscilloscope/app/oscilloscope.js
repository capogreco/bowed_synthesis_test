/**
 * Phase-locked oscilloscope for visualizing audio waveforms
 * Dynamically adjusts to show ~3 periods based on fundamental frequency
 */

export class Oscilloscope {
    constructor(canvas, analyserNode) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyser = analyserNode;
        
        // Set canvas resolution
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Waveform data
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        // Display settings
        this.targetPeriods = 3;
        this.fundamentalFreq = 220; // Default A3
        this.sampleRate = 48000; // Will be updated from audio context
        
        // Phase locking
        this.phaseOffset = 0;
        this.lastZeroCrossing = -1;
        this.jitterAmount = 0.01; // Reduced jitter for more stable display
        this.searchWindow = 0.3; // Search within 30% of expected period
        this.lockedPhase = false; // Track if we have a stable lock
        
        // Visual settings
        this.lineColor = '#00ff88';
        this.gridColor = '#1a3a1a';
        this.backgroundColor = '#000';
        this.lineWidth = 2;
        
        // Debug mode for zero crossing visualization
        this.debugMode = false;
        this.debugCrossingColor = '#ff0000';
        
        // Animation
        this.animationId = null;
        this.isRunning = false;
        
        // Phase locking toggle
        this.phaseLockEnabled = true;
    }
    
    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    
    /**
     * Update the fundamental frequency for period calculation
     */
    setFrequency(freq) {
        this.fundamentalFreq = Math.max(20, Math.min(2000, freq));
    }
    
    /**
     * Set the audio context sample rate
     */
    setSampleRate(rate) {
        this.sampleRate = rate;
    }
    
    /**
     * Toggle phase locking on/off
     */
    togglePhaseLock() {
        this.phaseLockEnabled = !this.phaseLockEnabled;
        if (!this.phaseLockEnabled) {
            this.phaseOffset = 0;
            this.lockedPhase = false;
        }
    }
    
    /**
     * Find the first significant peak in the waveform
     */
    findFirstPeak(data, minIndex = 0) {
        const threshold = 128; // Center value
        const minPeakHeight = 160; // Minimum value to consider a peak
        
        let maxValue = -1;
        let maxIndex = -1;
        
        // Look for the first significant peak after minIndex
        for (let i = minIndex + 1; i < data.length - 1; i++) {
            // Check if this is a local maximum
            if (data[i] > minPeakHeight && 
                data[i] > data[i - 1] && 
                data[i] >= data[i + 1]) {
                
                // Found a peak, return it
                return i;
            }
        }
        
        // If no peak found, just find the maximum in the search range
        for (let i = minIndex; i < Math.min(minIndex + 200, data.length); i++) {
            if (data[i] > maxValue) {
                maxValue = data[i];
                maxIndex = i;
            }
        }
        
        return maxIndex;
    }
    
    /**
     * Calculate how many samples to display based on frequency
     */
    calculateDisplaySamples() {
        const samplesPerPeriod = this.sampleRate / this.fundamentalFreq;
        return Math.floor(samplesPerPeriod * this.targetPeriods);
    }
    
    /**
     * Draw grid lines
     */
    drawGrid() {
        const width = this.canvas.width / window.devicePixelRatio;
        const height = this.canvas.height / window.devicePixelRatio;
        
        this.ctx.strokeStyle = this.gridColor;
        this.ctx.lineWidth = 0.5;
        
        // Horizontal center line
        this.ctx.beginPath();
        this.ctx.moveTo(0, height / 2);
        this.ctx.lineTo(width, height / 2);
        this.ctx.stroke();
        
        // Vertical lines for each period
        for (let i = 0; i <= this.targetPeriods; i++) {
            const x = (i / this.targetPeriods) * width;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }
        
        // Horizontal amplitude lines
        const ampLines = [0.25, 0.75];
        ampLines.forEach(amp => {
            this.ctx.beginPath();
            this.ctx.setLineDash([2, 4]);
            this.ctx.moveTo(0, height * amp);
            this.ctx.lineTo(width, height * amp);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        });
    }
    
    /**
     * Draw the waveform
     */
    draw() {
        const width = this.canvas.width / window.devicePixelRatio;
        const height = this.canvas.height / window.devicePixelRatio;
        
        // Clear canvas
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, width, height);
        
        // Draw grid
        this.drawGrid();
        
        // Get waveform data
        this.analyser.getByteTimeDomainData(this.dataArray);
        
        // Calculate expected samples per period
        const samplesPerPeriod = this.sampleRate / this.fundamentalFreq;
        const bufferSamplesPerPeriod = (samplesPerPeriod / this.sampleRate) * this.analyser.fftSize;
        
        // Only do phase locking if enabled
        if (this.phaseLockEnabled) {
            // Find first significant peak for phase locking
            const phasePoint = this.findFirstPeak(this.dataArray, 0);
            
            if (phasePoint >= 0) {
                // Add small jitter for analog feel
                const jitter = (Math.random() - 0.5) * this.jitterAmount * bufferSamplesPerPeriod;
                
                // Update phase offset
                this.phaseOffset = phasePoint + jitter;
                this.lockedPhase = true;
            } else {
                // No stable phase found
                this.phaseOffset = 0;
                this.lockedPhase = false;
            }
        } else {
            // Phase locking disabled
            this.phaseOffset = 0;
            this.lockedPhase = false;
        }
        
        // Calculate how many samples to display
        const samplesToShow = this.calculateDisplaySamples();
        const startIdx = Math.max(0, Math.floor(this.phaseOffset));
        
        // Draw waveform
        this.ctx.strokeStyle = this.lineColor;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.beginPath();
        
        let firstPoint = true;
        for (let i = 0; i < samplesToShow && (startIdx + i) < this.dataArray.length; i++) {
            const dataIdx = startIdx + i;
            const x = (i / samplesToShow) * width;
            const y = (this.dataArray[dataIdx] / 255) * height;
            
            if (firstPoint) {
                this.ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.stroke();
        
        // Add subtle glow effect
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = this.lineColor;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
        
        // Debug: mark the phase lock point
        if (this.debugMode && this.lockedPhase) {
            const phaseX = ((this.phaseOffset - startIdx) / samplesToShow) * width;
            this.ctx.strokeStyle = this.debugCrossingColor;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(phaseX, 0);
            this.ctx.lineTo(phaseX, height);
            this.ctx.stroke();
            
            // Show phase info
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '10px monospace';
            this.ctx.fillText(`Phase: ${this.phaseOffset.toFixed(1)}`, 5, 15);
            this.ctx.fillText(`Period: ${bufferSamplesPerPeriod.toFixed(1)}`, 5, 25);
            this.ctx.fillText(`Samples: ${samplesToShow}`, 5, 35);
            this.ctx.fillText(`Freq: ${this.fundamentalFreq.toFixed(0)}Hz`, 5, 45);
            this.ctx.fillText(`Lock: ${this.lockedPhase ? 'YES' : 'NO'}`, 5, 55);
        }
    }
    
    /**
     * Start the oscilloscope animation
     */
    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.animate();
        }
    }
    
    /**
     * Stop the oscilloscope animation
     */
    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    /**
     * Animation loop
     */
    animate() {
        if (!this.isRunning) return;
        
        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }
}