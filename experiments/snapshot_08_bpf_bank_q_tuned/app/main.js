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
const bpfQParamInput = document.getElementById('bpfQParam'); 
const bpfBankMixLevelParamInput = document.getElementById('bpfBankMixLevelParam');
const sawPulseMixParamInput = document.getElementById('sawPulseMixParam');
const pulseWidthParamInput = document.getElementById('pulseWidthParam');
const toneNoiseMixParamInput = document.getElementById('toneNoiseMixParam');
const bowForceInput = document.getElementById('bowForce');

// Value Display Spans
const frequencyValueSpan = document.getElementById('frequencyValue');
const loopGainValueSpan = document.getElementById('loopGainValue');
const cutoffParamValueSpan = document.getElementById('cutoffParamValue');
const resonanceParamValueSpan = document.getElementById('resonanceParamValue');
const bpfQParamValueSpan = document.getElementById('bpfQParamValue'); 
const bpfBankMixLevelParamValueSpan = document.getElementById('bpfBankMixLevelParamValue');
const sawPulseMixParamValueSpan = document.getElementById('sawPulseMixParamValue');
const pulseWidthParamValueSpan = document.getElementById('pulseWidthParamValue');
const toneNoiseMixParamValueSpan = document.getElementById('toneNoiseMixParamValue');
const bowForceValueSpan = document.getElementById('bowForceValue');

const allParamInputs = [
    frequencyInput, loopGainInput, cutoffParamInput, resonanceParamInput,
    bpfQParamInput, bpfBankMixLevelParamInput, 
    sawPulseMixParamInput, pulseWidthParamInput, toneNoiseMixParamInput, bowForceInput
];

function updateAllDisplayValues() {
    if (frequencyInput && frequencyValueSpan) frequencyValueSpan.textContent = parseFloat(frequencyInput.value).toFixed(0);
    if (loopGainInput && loopGainValueSpan) loopGainValueSpan.textContent = parseFloat(loopGainInput.value).toFixed(3);
    if (cutoffParamInput && cutoffParamValueSpan) cutoffParamValueSpan.textContent = parseFloat(cutoffParamInput.value).toFixed(2);
    if (resonanceParamInput && resonanceParamValueSpan) resonanceParamValueSpan.textContent = parseFloat(resonanceParamInput.value).toFixed(2);
    
    if (bpfQParamInput && bpfQParamValueSpan) {
        const sliderVal = parseFloat(bpfQParamInput.value); 
        const minDisplayQ = 0.707;
        const maxDisplayQ = 7.0; // Corrected upper limit for BPF Q display
        const actualQ = minDisplayQ + (sliderVal * (maxDisplayQ - minDisplayQ)); 
        bpfQParamValueSpan.textContent = actualQ.toFixed(3); 
    }
    if (bpfBankMixLevelParamInput && bpfBankMixLevelParamValueSpan) { 
        bpfBankMixLevelParamValueSpan.textContent = parseFloat(bpfBankMixLevelParamInput.value).toFixed(2);
    }

    if (sawPulseMixParamInput && sawPulseMixParamValueSpan) sawPulseMixParamValueSpan.textContent = parseFloat(sawPulseMixParamInput.value).toFixed(2);
    if (pulseWidthParamInput && pulseWidthParamValueSpan) pulseWidthParamValueSpan.textContent = parseFloat(pulseWidthParamInput.value).toFixed(2);
    if (toneNoiseMixParamInput && toneNoiseMixParamValueSpan) toneNoiseMixParamValueSpan.textContent = parseFloat(toneNoiseMixParamInput.value).toFixed(2);
    if (bowForceInput && bowForceValueSpan) bowForceValueSpan.textContent = parseFloat(bowForceInput.value).toFixed(3);
}

let currentFrequency, currentLoopGain, currentCutoffParam, currentResonanceParam, 
    currentBpfQParam, currentBpfBankMixLevelParam, 
    currentSawPulseMixParam, currentPulseWidthParam, currentToneNoiseMixParam, currentBowForce;

function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) return;
    
    currentFrequency = parseFloat(frequencyInput.value);
    currentLoopGain = parseFloat(loopGainInput.value);
    currentCutoffParam = parseFloat(cutoffParamInput.value);
    currentResonanceParam = parseFloat(resonanceParamInput.value);
    currentBpfQParam = parseFloat(bpfQParamInput.value);
    currentBpfBankMixLevelParam = parseFloat(bpfBankMixLevelParamInput.value); 
    currentSawPulseMixParam = parseFloat(sawPulseMixParamInput.value);
    currentPulseWidthParam = parseFloat(pulseWidthParamInput.value);
    currentToneNoiseMixParam = parseFloat(toneNoiseMixParamInput.value);
    currentBowForce = parseFloat(bowForceInput.value);

    updateAllDisplayValues();

    if (isNaN(currentFrequency) || currentFrequency <= 0 ||
        isNaN(currentLoopGain) || currentLoopGain < 0.8 || currentLoopGain > 1.5 ||
        isNaN(currentCutoffParam) || currentCutoffParam < 0 || currentCutoffParam > 1 ||
        isNaN(currentResonanceParam) || currentResonanceParam < 0 || currentResonanceParam > 1 ||
        isNaN(currentBpfQParam) || currentBpfQParam < 0 || currentBpfQParam > 1 ||
        isNaN(currentBpfBankMixLevelParam) || currentBpfBankMixLevelParam < 0 || currentBpfBankMixLevelParam > 1 || 
        isNaN(currentSawPulseMixParam) || currentSawPulseMixParam < 0 || currentSawPulseMixParam > 1 ||
        isNaN(currentPulseWidthParam) || currentPulseWidthParam < 0.01 || currentPulseWidthParam > 0.99 ||
        isNaN(currentToneNoiseMixParam) || currentToneNoiseMixParam < 0 || currentToneNoiseMixParam > 1 ||
        isNaN(currentBowForce) || currentBowForce < 0 || currentBowForce > 0.5) {
        console.error(`[Main] Invalid parameter values.`);
        return;
    }
    
    if (audioContext.state === 'running') {
        workletNode.port.postMessage({
            type: 'setParameter',
            frequency: currentFrequency,
            loopGain: currentLoopGain,
            cutoffParam: currentCutoffParam,
            resonanceParam: currentResonanceParam,
            bpfQParam: currentBpfQParam,
            bpfBankMixLevelParam: currentBpfBankMixLevelParam, 
            sawPulseMixParam: currentSawPulseMixParam,
            pulseWidthParam: currentPulseWidthParam,
            toneNoiseMixParam: currentToneNoiseMixParam,
            bowForce: currentBowForce
        });
    }
}

async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        currentFrequency = parseFloat(frequencyInput.value);
        currentLoopGain = parseFloat(loopGainInput.value);
        currentCutoffParam = parseFloat(cutoffParamInput.value);
        currentResonanceParam = parseFloat(resonanceParamInput.value);
        currentBpfQParam = parseFloat(bpfQParamInput.value);
        currentBpfBankMixLevelParam = parseFloat(bpfBankMixLevelParamInput.value); 
        currentSawPulseMixParam = parseFloat(sawPulseMixParamInput.value);
        currentPulseWidthParam = parseFloat(pulseWidthParamInput.value);
        currentToneNoiseMixParam = parseFloat(toneNoiseMixParamInput.value);
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
                bpfQParam: currentBpfQParam,
                bpfBankMixLevelParam: currentBpfBankMixLevelParam, 
                sawPulseMixParam: currentSawPulseMixParam,
                pulseWidthParam: currentPulseWidthParam,
                toneNoiseMixParam: currentToneNoiseMixParam,
                bowForce: currentBowForce
            }
        });
        console.log(`[Main] AudioWorkletNode created with BPF Bank controls. Initial Bank Mix: ${currentBpfBankMixLevelParam.toFixed(2)}`);
        
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

allParamInputs.forEach(input => {
    if (input) input.addEventListener('input', updateParametersInWorklet);
});

updateAllDisplayValues(); 
bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });