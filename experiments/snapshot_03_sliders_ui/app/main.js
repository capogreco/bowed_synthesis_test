// main.js
let audioContext;
let workletNode;
let isAudioInitialized = false;
let isBowingActive = false;

const audioToggleButton = document.getElementById('audioToggle');
const bowingToggleButton = document.getElementById('bowingToggle');

// Slider Inputs
const frequencyInput = document.getElementById('frequency');
const loopGainInput = document.getElementById('loopGain');
const filterCoeffInput = document.getElementById('filterCoeff');
const bowForceInput = document.getElementById('bowForce');

// Value Display Spans
const frequencyValueSpan = document.getElementById('frequencyValue');
const loopGainValueSpan = document.getElementById('loopGainValue');
const filterCoeffValueSpan = document.getElementById('filterCoeffValue');
const bowForceValueSpan = document.getElementById('bowForceValue');

// Function to update all parameter display values
function updateAllDisplayValues() {
    if (frequencyInput && frequencyValueSpan) {
        frequencyValueSpan.textContent = parseFloat(frequencyInput.value).toFixed(0);
    }
    if (loopGainInput && loopGainValueSpan) {
        loopGainValueSpan.textContent = parseFloat(loopGainInput.value).toFixed(3);
    }
    if (filterCoeffInput && filterCoeffValueSpan) {
        filterCoeffValueSpan.textContent = parseFloat(filterCoeffInput.value).toFixed(2);
    }
    if (bowForceInput && bowForceValueSpan) {
        bowForceValueSpan.textContent = parseFloat(bowForceInput.value).toFixed(3);
    }
}

// Initial parameters (will be set from HTML defaults)
let currentFrequency, currentLoopGain, currentFilterCoeff, currentBowForce;

function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) {
        // console.warn('[Main - UpdateParams] Worklet not ready or audio not initialized.');
        return;
    }
    
    currentFrequency = parseFloat(frequencyInput.value);
    currentLoopGain = parseFloat(loopGainInput.value);
    currentFilterCoeff = parseFloat(filterCoeffInput.value);
    currentBowForce = parseFloat(bowForceInput.value);

    // Update display values as they are changed
    updateAllDisplayValues();

    // Basic validation
    if (isNaN(currentFrequency) || currentFrequency <= 0 ||
        isNaN(currentLoopGain) || currentLoopGain < 0.8 || currentLoopGain > 1.5 ||
        isNaN(currentFilterCoeff) || currentFilterCoeff < 0 || currentFilterCoeff > 1 ||
        isNaN(currentBowForce) || currentBowForce < 0) {
        console.error(`[Main] Invalid parameter values during update. F:${currentFrequency}, LG:${currentLoopGain}, FC:${currentFilterCoeff}, BF:${currentBowForce}`);
        return;
    }
    
    if (audioContext.state === 'running') {
        workletNode.port.postMessage({
            type: 'setParameter',
            frequency: currentFrequency,
            loopGain: currentLoopGain,
            filterCoeff: currentFilterCoeff,
            bowForce: currentBowForce
        });
        // console.log(`[Main] Sent setParameter. Freq: ${currentFrequency.toFixed(0)}, Gain: ${currentLoopGain.toFixed(3)}, Filter: ${currentFilterCoeff.toFixed(2)}, Force: ${currentBowForce.toFixed(3)}`);
    }
}

async function initializeAudio() {
    if (isAudioInitialized) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Main] AudioContext created.');

        // Set current parameters from initial slider values and update displays
        currentFrequency = parseFloat(frequencyInput.value);
        currentLoopGain = parseFloat(loopGainInput.value);
        currentFilterCoeff = parseFloat(filterCoeffInput.value);
        currentBowForce = parseFloat(bowForceInput.value);
        updateAllDisplayValues(); // Set initial display values from HTML defaults

        await audioContext.audioWorklet.addModule('basic-processor.js');
        console.log('[Main] AudioWorklet module loaded.');

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', {
            processorOptions: {
                frequency: currentFrequency,
                loopGain: currentLoopGain,
                filterCoeff: currentFilterCoeff,
                bowForce: currentBowForce
            }
        });
        console.log(`[Main] AudioWorkletNode 'continuous-excitation-processor' created. Initial Freq: ${currentFrequency.toFixed(0)}, Gain: ${currentLoopGain.toFixed(3)}, Filter: ${currentFilterCoeff.toFixed(2)}, Force: ${currentBowForce.toFixed(3)}`);

        workletNode.connect(audioContext.destination);
        console.log('[Main] AudioWorkletNode connected to destination.');

        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        bowingToggleButton.disabled = false;

    } catch (e) {
        console.error('[Main] Error initializing audio:', e);
        audioToggleButton.textContent = 'Audio Init Failed';
        audioToggleButton.disabled = true;
        bowingToggleButton.disabled = true;
        // Disable sliders too if init fails
        frequencyInput.disabled = true;
        loopGainInput.disabled = true;
        filterCoeffInput.disabled = true;
        bowForceInput.disabled = true;
    }
}

audioToggleButton.addEventListener('click', async () => {
    if (!audioContext) {
        await initializeAudio();
        // If initialization failed, audioContext might still be null, so exit.
        if (!audioContext) return;
    }

    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('[Main] AudioContext resumed.');
            audioToggleButton.textContent = 'Suspend Audio';
            if (isBowingActive && workletNode) { // Ensure workletNode exists
                updateParametersInWorklet(); 
                workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
            }
        } catch (e) { console.error('[Main] Error resuming AudioContext:', e); }
    } else if (audioContext.state === 'running') {
        try {
            await audioContext.suspend();
            console.log('[Main] AudioContext suspended.');
            audioToggleButton.textContent = 'Resume Audio';
            if (isBowingActive && workletNode) { // Ensure workletNode exists
                 workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
            }
        } catch (e) { console.error('[Main] Error suspending AudioContext:', e); }
    }
});

bowingToggleButton.addEventListener('click', () => {
    if (!workletNode || !audioContext) {
        console.warn('[Main - BowingToggle] Audio not initialized or workletNode not ready.');
        if (!isAudioInitialized) {
            audioToggleButton.click(); // Attempt to initialize
        } else if (audioContext.state !== 'running') {
            audioToggleButton.click(); // Attempt to resume
        }
        return;
    }
    
    if (audioContext.state !== 'running') {
        console.warn('[Main - BowingToggle] AudioContext is not in a running state. Please resume audio first.');
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[Main - BowingToggle] AudioContext resumed. You can now toggle bowing.');
                audioToggleButton.textContent = 'Suspend Audio';
                if (isBowingActive && workletNode) { // Ensure workletNode exists
                    updateParametersInWorklet();
                    workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
                }
            }).catch(e => console.error('[Main - BowingToggle] Failed to resume context automatically:', e));
        }
        return;
    }

    isBowingActive = !isBowingActive;
    updateParametersInWorklet(); // Send current parameters before changing bowing state
    
    if (workletNode) { // Ensure workletNode exists
        workletNode.port.postMessage({
            type: 'setBowing',
            isBowing: isBowingActive
        });
    }

    bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
    console.log(`[Main] Sent setBowing: ${isBowingActive}`);
});

// Event listeners for parameter SLIDERS - use 'input' for continuous update
frequencyInput.addEventListener('input', updateParametersInWorklet);
loopGainInput.addEventListener('input', updateParametersInWorklet);
filterCoeffInput.addEventListener('input', updateParametersInWorklet);
bowForceInput.addEventListener('input', updateParametersInWorklet);

// Set initial display values from HTML defaults on page load
// This ensures that the span values match the initial slider positions
// before any interaction or audio initialization.
updateAllDisplayValues(); 

// Disable bowing button initially until audio is initialized and running
bowingToggleButton.disabled = true;