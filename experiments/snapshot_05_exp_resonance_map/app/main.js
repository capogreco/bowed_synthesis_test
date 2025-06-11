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
const cutoffParamInput = document.getElementById('cutoffParam'); // Renamed from filterCoeffInput
const resonanceParamInput = document.getElementById('resonanceParam'); // New
const sawtoothLevelInput = document.getElementById('sawtoothLevel');
const bowForceInput = document.getElementById('bowForce');

// Value Display Spans
const frequencyValueSpan = document.getElementById('frequencyValue');
const loopGainValueSpan = document.getElementById('loopGainValue');
const cutoffParamValueSpan = document.getElementById('cutoffParamValue'); // Renamed
const resonanceParamValueSpan = document.getElementById('resonanceParamValue'); // New
const sawtoothLevelValueSpan = document.getElementById('sawtoothLevelValue');
const bowForceValueSpan = document.getElementById('bowForceValue');

// Global parameter state variables, updated from sliders
let currentFrequency, currentLoopGain, currentCutoffParam, currentResonanceParam, currentSawtoothLevel, currentBowForce;

function updateAllDisplayValues() {
    if (frequencyInput && frequencyValueSpan) frequencyValueSpan.textContent = parseFloat(frequencyInput.value).toFixed(0);
    if (loopGainInput && loopGainValueSpan) loopGainValueSpan.textContent = parseFloat(loopGainInput.value).toFixed(3);
    if (cutoffParamInput && cutoffParamValueSpan) cutoffParamValueSpan.textContent = parseFloat(cutoffParamInput.value).toFixed(2);
    if (resonanceParamInput && resonanceParamValueSpan) resonanceParamValueSpan.textContent = parseFloat(resonanceParamInput.value).toFixed(2);
    if (sawtoothLevelInput && sawtoothLevelValueSpan) sawtoothLevelValueSpan.textContent = parseFloat(sawtoothLevelInput.value).toFixed(2);
    if (bowForceInput && bowForceValueSpan) bowForceValueSpan.textContent = parseFloat(bowForceInput.value).toFixed(3);
}

function updateParametersInWorklet() {
    // Read current values from sliders
    currentFrequency = parseFloat(frequencyInput.value);
    currentLoopGain = parseFloat(loopGainInput.value);
    currentCutoffParam = parseFloat(cutoffParamInput.value);
    currentResonanceParam = parseFloat(resonanceParamInput.value);
    currentSawtoothLevel = parseFloat(sawtoothLevelInput.value);
    currentBowForce = parseFloat(bowForceInput.value);

    // Update the displayed values
    updateAllDisplayValues();

    // Basic validation
    if (isNaN(currentFrequency) || currentFrequency <= 0 ||
        isNaN(currentLoopGain) || currentLoopGain < 0.8 || currentLoopGain > 1.5 ||
        isNaN(currentCutoffParam) || currentCutoffParam < 0 || currentCutoffParam > 1 ||
        isNaN(currentResonanceParam) || currentResonanceParam < 0 || currentResonanceParam > 1 ||
        isNaN(currentSawtoothLevel) || currentSawtoothLevel < 0 || currentSawtoothLevel > 1 ||
        isNaN(currentBowForce) || currentBowForce < 0 || currentBowForce > 0.5) { // Max 0.5 for bowForce for safety
        console.error(`[Main] Invalid parameter values. F:${currentFrequency}, LG:${currentLoopGain}, Cut:${currentCutoffParam}, Res:${currentResonanceParam}, SL:${currentSawtoothLevel}, BF:${currentBowForce}`);
        return; // Don't send invalid parameters
    }
    
    // Send parameters to worklet only if it's ready and audio is running
    if (workletNode && audioContext && audioContext.state === 'running' && isAudioInitialized) {
        workletNode.port.postMessage({
            type: 'setParameter',
            frequency: currentFrequency,
            loopGain: currentLoopGain,
            cutoffParam: currentCutoffParam,
            resonanceParam: currentResonanceParam,
            sawtoothLevel: currentSawtoothLevel,
            bowForce: currentBowForce
        });
        // console.log(`[Main] Sent setParameter: F:${currentFrequency.toFixed(0)}, G:${currentLoopGain.toFixed(3)}, Cut:${currentCutoffParam.toFixed(2)}, Res:${currentResonanceParam.toFixed(2)}, SL:${currentSawtoothLevel.toFixed(2)}, BF:${currentBowForce.toFixed(3)}`);
    }
}

async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Main] AudioContext created.');

        // Initialize current parameters from HTML defaults and update displays
        currentFrequency = parseFloat(frequencyInput.value);
        currentLoopGain = parseFloat(loopGainInput.value);
        currentCutoffParam = parseFloat(cutoffParamInput.value);
        currentResonanceParam = parseFloat(resonanceParamInput.value);
        currentSawtoothLevel = parseFloat(sawtoothLevelInput.value);
        currentBowForce = parseFloat(bowForceInput.value);
        updateAllDisplayValues();

        await audioContext.audioWorklet.addModule('basic-processor.js');
        console.log('[Main] AudioWorklet module loaded.');

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', {
            processorOptions: {
                frequency: currentFrequency,
                loopGain: currentLoopGain,
                cutoffParam: currentCutoffParam,
                resonanceParam: currentResonanceParam,
                sawtoothLevel: currentSawtoothLevel,
                bowForce: currentBowForce
            }
        });
        console.log(`[Main] AudioWorkletNode created. Initial Freq: ${currentFrequency.toFixed(0)}, Gain: ${currentLoopGain.toFixed(3)}, Cutoff: ${currentCutoffParam.toFixed(2)}, Reso: ${currentResonanceParam.toFixed(2)}, Saw: ${currentSawtoothLevel.toFixed(2)}, NoiseF: ${currentBowForce.toFixed(3)}`);

        workletNode.connect(audioContext.destination);
        console.log('[Main] AudioWorkletNode connected to destination.');
        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        bowingToggleButton.disabled = false;
        // Enable sliders after successful initialization
        [frequencyInput, loopGainInput, cutoffParamInput, resonanceParamInput, sawtoothLevelInput, bowForceInput].forEach(input => {
            if(input) input.disabled = false;
        });

    } catch (e) {
        console.error('[Main] Error initializing audio:', e);
        audioToggleButton.textContent = 'Audio Init Failed';
        audioToggleButton.disabled = true;
        bowingToggleButton.disabled = true;
        // Keep sliders disabled if init fails
        [frequencyInput, loopGainInput, cutoffParamInput, resonanceParamInput, sawtoothLevelInput, bowForceInput].forEach(input => {
            if(input) input.disabled = true;
        });
    }
}

audioToggleButton.addEventListener('click', async () => {
    if (!audioContext) {
        await initializeAudio();
        if (!audioContext) return; // Exit if initialization failed
    }

    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('[Main] AudioContext resumed.');
            audioToggleButton.textContent = 'Suspend Audio';
            if (isBowingActive && workletNode) {
                updateParametersInWorklet(); // Send current params to worklet
                workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
            }
        } catch (e) { console.error('[Main] Error resuming AudioContext:', e); }
    } else if (audioContext.state === 'running') {
        try {
            await audioContext.suspend();
            console.log('[Main] AudioContext suspended.');
            audioToggleButton.textContent = 'Resume Audio';
            if (isBowingActive && workletNode) { // Tell worklet to stop outputting sound, but keep isBowingActive true
                 workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
            }
        } catch (e) { console.error('[Main] Error suspending AudioContext:', e); }
    }
});

bowingToggleButton.addEventListener('click', () => {
    if (!workletNode || !audioContext) {
        console.warn('[Main - BowingToggle] Audio not ready.');
        if (!isAudioInitialized) audioToggleButton.click(); 
        else if (audioContext && audioContext.state !== 'running') audioToggleButton.click(); 
        return;
    }

    if (audioContext.state !== 'running') {
        console.warn('[Main - BowingToggle] AudioContext not running. Resume audio first.');
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[Main - BowingToggle] AudioContext resumed. You can now toggle bowing.');
                audioToggleButton.textContent = 'Suspend Audio';
                if (isBowingActive && workletNode) { // If it was supposed to be bowing, re-send params and state
                    updateParametersInWorklet();
                    workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
                }
            }).catch(e => console.error('[Main - BowingToggle] Failed to resume context for bowing:', e));
        }
        return;
    }

    isBowingActive = !isBowingActive;
    updateParametersInWorklet(); // Ensure latest parameters are sent before changing bowing state in worklet
    
    if (workletNode) {
        workletNode.port.postMessage({
            type: 'setBowing',
            isBowing: isBowingActive
        });
    }

    bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
    console.log(`[Main] Sent setBowing to worklet: ${isBowingActive}`);
});

// Event listeners for parameter sliders
frequencyInput.addEventListener('input', updateParametersInWorklet);
loopGainInput.addEventListener('input', updateParametersInWorklet);
cutoffParamInput.addEventListener('input', updateParametersInWorklet);
resonanceParamInput.addEventListener('input', updateParametersInWorklet);
sawtoothLevelInput.addEventListener('input', updateParametersInWorklet);
bowForceInput.addEventListener('input', updateParametersInWorklet);

// Initialize display values and button states on page load
updateAllDisplayValues(); 
bowingToggleButton.disabled = true;
// Sliders should also be disabled initially until audio context is ready
[frequencyInput, loopGainInput, cutoffParamInput, resonanceParamInput, sawtoothLevelInput, bowForceInput].forEach(input => {
    if(input) input.disabled = true;
});