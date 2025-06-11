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
const cutoffParamInput = document.getElementById('cutoffParam');
const resonanceParamInput = document.getElementById('resonanceParam');
const sawPulseMixParamInput = document.getElementById('sawPulseMixParam'); // Renamed from sawtoothLevelInput
const pulseWidthParamInput = document.getElementById('pulseWidthParam');
const toneNoiseMixParamInput = document.getElementById('toneNoiseMixParam'); // Renamed from pulseMixParamInput
const bowForceInput = document.getElementById('bowForce');

// Value Display Spans
const frequencyValueSpan = document.getElementById('frequencyValue');
const loopGainValueSpan = document.getElementById('loopGainValue');
const cutoffParamValueSpan = document.getElementById('cutoffParamValue');
const resonanceParamValueSpan = document.getElementById('resonanceParamValue');
const sawPulseMixParamValueSpan = document.getElementById('sawPulseMixParamValue'); // Renamed
const pulseWidthParamValueSpan = document.getElementById('pulseWidthParamValue');
const toneNoiseMixParamValueSpan = document.getElementById('toneNoiseMixParamValue'); // Renamed
const bowForceValueSpan = document.getElementById('bowForceValue');

// Centralized array of all parameter input elements
const allParamInputs = [
    frequencyInput, loopGainInput, cutoffParamInput, resonanceParamInput,
    sawPulseMixParamInput, pulseWidthParamInput, toneNoiseMixParamInput, bowForceInput
];

function updateAllDisplayValues() {
    if (frequencyInput && frequencyValueSpan) frequencyValueSpan.textContent = parseFloat(frequencyInput.value).toFixed(0);
    if (loopGainInput && loopGainValueSpan) loopGainValueSpan.textContent = parseFloat(loopGainInput.value).toFixed(3);
    if (cutoffParamInput && cutoffParamValueSpan) cutoffParamValueSpan.textContent = parseFloat(cutoffParamInput.value).toFixed(2);
    if (resonanceParamInput && resonanceParamValueSpan) resonanceParamValueSpan.textContent = parseFloat(resonanceParamInput.value).toFixed(2);
    if (sawPulseMixParamInput && sawPulseMixParamValueSpan) sawPulseMixParamValueSpan.textContent = parseFloat(sawPulseMixParamInput.value).toFixed(2);
    if (pulseWidthParamInput && pulseWidthParamValueSpan) pulseWidthParamValueSpan.textContent = parseFloat(pulseWidthParamInput.value).toFixed(2);
    if (toneNoiseMixParamInput && toneNoiseMixParamValueSpan) toneNoiseMixParamValueSpan.textContent = parseFloat(toneNoiseMixParamInput.value).toFixed(2);
    if (bowForceInput && bowForceValueSpan) bowForceValueSpan.textContent = parseFloat(bowForceInput.value).toFixed(3);
}

// Global parameter state variables
let currentFrequency, currentLoopGain, currentCutoffParam, currentResonanceParam, 
    currentSawPulseMixParam, currentPulseWidthParam, currentToneNoiseMixParam, currentBowForce;

function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) {
        return;
    }
    
    currentFrequency = parseFloat(frequencyInput.value);
    currentLoopGain = parseFloat(loopGainInput.value);
    currentCutoffParam = parseFloat(cutoffParamInput.value);
    currentResonanceParam = parseFloat(resonanceParamInput.value);
    currentSawPulseMixParam = parseFloat(sawPulseMixParamInput.value); // Renamed
    currentPulseWidthParam = parseFloat(pulseWidthParamInput.value);
    currentToneNoiseMixParam = parseFloat(toneNoiseMixParamInput.value);   // Renamed
    currentBowForce = parseFloat(bowForceInput.value);

    updateAllDisplayValues();

    // Validation
    if (isNaN(currentFrequency) || currentFrequency <= 0 ||
        isNaN(currentLoopGain) || currentLoopGain < 0.8 || currentLoopGain > 1.5 ||
        isNaN(currentCutoffParam) || currentCutoffParam < 0 || currentCutoffParam > 1 ||
        isNaN(currentResonanceParam) || currentResonanceParam < 0 || currentResonanceParam > 1 ||
        isNaN(currentSawPulseMixParam) || currentSawPulseMixParam < 0 || currentSawPulseMixParam > 1 || // Renamed
        isNaN(currentPulseWidthParam) || currentPulseWidthParam < 0.01 || currentPulseWidthParam > 0.99 ||
        isNaN(currentToneNoiseMixParam) || currentToneNoiseMixParam < 0 || currentToneNoiseMixParam > 1 || // Renamed
        isNaN(currentBowForce) || currentBowForce < 0 || currentBowForce > 0.5) {
        console.error(`[Main] Invalid parameter values detected.`);
        return;
    }
    
    if (audioContext.state === 'running') {
        workletNode.port.postMessage({
            type: 'setParameter',
            frequency: currentFrequency,
            loopGain: currentLoopGain,
            cutoffParam: currentCutoffParam,
            resonanceParam: currentResonanceParam,
            sawPulseMixParam: currentSawPulseMixParam,     // Renamed
            pulseWidthParam: currentPulseWidthParam,
            toneNoiseMixParam: currentToneNoiseMixParam,   // Renamed
            bowForce: currentBowForce
        });
        // console.log(`[Main] Sent params: SP Mix: ${currentSawPulseMixParam.toFixed(2)}, TN Mix: ${currentToneNoiseMixParam.toFixed(2)}`);
    }
}

async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Main] AudioContext created.');

        currentFrequency = parseFloat(frequencyInput.value);
        currentLoopGain = parseFloat(loopGainInput.value);
        currentCutoffParam = parseFloat(cutoffParamInput.value);
        currentResonanceParam = parseFloat(resonanceParamInput.value);
        currentSawPulseMixParam = parseFloat(sawPulseMixParamInput.value); // Renamed
        currentPulseWidthParam = parseFloat(pulseWidthParamInput.value);
        currentToneNoiseMixParam = parseFloat(toneNoiseMixParamInput.value);   // Renamed
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
                sawPulseMixParam: currentSawPulseMixParam,   // Renamed
                pulseWidthParam: currentPulseWidthParam,
                toneNoiseMixParam: currentToneNoiseMixParam, // Renamed
                bowForce: currentBowForce
            }
        });
        console.log(`[Main] AudioWorkletNode created with refactored mix params.`);

        workletNode.connect(audioContext.destination);
        console.log('[Main] AudioWorkletNode connected to destination.');
        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        bowingToggleButton.disabled = false;
        allParamInputs.forEach(input => { if(input) input.disabled = false; });

    } catch (e) {
        console.error('[Main] Error initializing audio:', e);
        audioToggleButton.textContent = 'Audio Init Failed';
        audioToggleButton.disabled = true;
        bowingToggleButton.disabled = true;
        allParamInputs.forEach(input => { if(input) input.disabled = true; });
    }
}

audioToggleButton.addEventListener('click', async () => {
    if (!audioContext) {
        await initializeAudio();
        if (!audioContext) return; 
    }
    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('[Main] AudioContext resumed.');
            audioToggleButton.textContent = 'Suspend Audio';
            if (isBowingActive && workletNode) {
                updateParametersInWorklet(); 
                workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
            }
        } catch (e) { console.error('[Main] Error resuming AudioContext:', e); }
    } else if (audioContext.state === 'running') {
        try {
            await audioContext.suspend();
            console.log('[Main] AudioContext suspended.');
            audioToggleButton.textContent = 'Resume Audio';
            if (isBowingActive && workletNode) {
                 workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
            }
        } catch (e) { console.error('[Main] Error suspending AudioContext:', e); }
    }
});

bowingToggleButton.addEventListener('click', () => {
    if (!workletNode || !audioContext) {
        if (!isAudioInitialized) audioToggleButton.click(); 
        else if (audioContext.state !== 'running') audioToggleButton.click(); 
        return;
    }
    if (audioContext.state !== 'running') {
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                audioToggleButton.textContent = 'Suspend Audio';
                if (isBowingActive && workletNode) {
                    updateParametersInWorklet();
                    workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
                }
            }).catch(e => console.error('[Main - BowingToggle] Failed to resume context automatically:', e));
        }
        return;
    }
    isBowingActive = !isBowingActive;
    updateParametersInWorklet(); 
    if (workletNode) {
        workletNode.port.postMessage({ type: 'setBowing', isBowing: isBowingActive });
    }
    bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
});

// Add event listeners for all sliders
allParamInputs.forEach(input => {
    if (input) {
        input.addEventListener('input', updateParametersInWorklet);
    }
});

// Initialize display values and button/slider states on page load
updateAllDisplayValues(); 
bowingToggleButton.disabled = true;
allParamInputs.forEach(input => {
    if(input) input.disabled = true;
});