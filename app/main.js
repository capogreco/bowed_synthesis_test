// main.js
let audioContext;
let workletNode;
let isAudioInitialized = false;
let isBowingActive = false;

const audioToggleButton = document.getElementById('audioToggle');
const bowingToggleButton = document.getElementById('bowingToggle');

// --- Parameter Configuration Store ---
const paramConfigs = {};

// --- Define UI elements by ID ---
// This approach is more robust if an element is missing, initialization won't break all.
const uiElementIds = [
    'frequency', 'loopGain', 'cutoffParam', 'resonanceParam',
    'bpfQParam', 'bpfBankMixLevelParam',
    'sawPulseMixParam', 'pulseWidthParam', 'toneNoiseMixParam', 'bowForce'
];

const uiElements = {};
uiElementIds.forEach(id => {
    const input = document.getElementById(id);
    const span = document.getElementById(id + 'Value');
    if (input && span) {
        uiElements[id] = { input, span };
    } else {
        console.warn(`UI elements for parameter '${id}' not found.`);
    }
});

const allParamInputs = Object.values(uiElements).map(el => el.input).filter(Boolean);


// --- Initialize Parameter Configurations from HTML Data Attributes ---
function initializeParamConfigs() {
    for (const key in uiElements) {
        const el = uiElements[key];
        if (el.input && el.input.dataset) { // Check if dataset exists
            const dspMin = el.input.dataset.dspMin;
            const dspMax = el.input.dataset.dspMax;
            const isMapped = dspMin !== undefined && dspMax !== undefined;

            paramConfigs[key] = {
                id: key,
                inputElement: el.input,
                spanElement: el.span,
                isMapped: isMapped,
                // Use slider's direct min/max if no DSP mapping attributes are found
                dspMin: isMapped ? parseFloat(dspMin) : parseFloat(el.input.min),
                dspMax: isMapped ? parseFloat(dspMax) : parseFloat(el.input.max),
                decimals: parseInt(el.input.dataset.dspDecimals || '2', 10),
                currentSliderValue: parseFloat(el.input.value) 
            };
        }
    }
}

// --- Update all display values based on stored configs and current slider values ---
function updateAllDisplayValues() {
    for (const key in paramConfigs) {
        const config = paramConfigs[key];
        if (config.inputElement && config.spanElement) {
            const sliderVal = parseFloat(config.inputElement.value);
            let displayVal = sliderVal;

            // If the slider itself is NOT 0-1 (e.g. frequency), then its value is the direct DSP value
            // If the slider IS 0-1 AND it's mapped, then calculate displayVal from dspMin/dspMax
            if (config.inputElement.min === "0" && config.inputElement.max === "1" && config.isMapped) {
                displayVal = config.dspMin + (sliderVal * (config.dspMax - config.dspMin));
            }
            config.spanElement.textContent = displayVal.toFixed(config.decimals);
        }
    }
}

// --- Update parameters in the worklet ---
function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) return;

    const paramsToSend = {};
    for (const key in paramConfigs) {
        const config = paramConfigs[key];
        if (config.inputElement) {
            const sliderVal = parseFloat(config.inputElement.value);
            // The processor will expect the raw 0-1 slider value for mapped params,
            // or the direct slider value if not mapped (e.g. frequency)
            paramsToSend[key] = sliderVal; 
            config.currentSliderValue = sliderVal;
        }
    }
    
    updateAllDisplayValues(); 

    // Basic validation (can be expanded using paramConfigs for dynamic min/max checks)
    // For now, relies on HTML input min/max for direct-value sliders
    if (isNaN(paramsToSend.frequency) || paramsToSend.frequency < parseFloat(uiElements.frequency.input.min) || paramsToSend.frequency > parseFloat(uiElements.frequency.input.max) ) {
         console.error(`[Main] Invalid frequency value: ${paramsToSend.frequency}`); return;
    }
    // Add more specific validations as needed here.

    if (audioContext.state === 'running') {
        workletNode.port.postMessage({
            type: 'setParameter',
            ...paramsToSend 
        });
    }
}

// --- Initialize Audio ---
async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        initializeParamConfigs(); // Initialize configs from HTML data attributes
        updateAllDisplayValues(); // Set initial display values based on these configs

        await audioContext.audioWorklet.addModule('basic-processor.js');
        
        const processorOpts = {};
        for (const key in paramConfigs) {
            const config = paramConfigs[key];
            processorOpts[key] = config.currentSliderValue; // Send initial raw slider value
            // If this param is mapped (slider is 0-1 but DSP range is different), send mapping info
            if (parseFloat(config.inputElement.min) === 0 && parseFloat(config.inputElement.max) === 1 && config.isMapped) {
                processorOpts[`${key}_dspMin`] = config.dspMin;
                processorOpts[`${key}_dspMax`] = config.dspMax;
            }
        }

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', { processorOptions: processorOpts });
        console.log(`[Main] AudioWorkletNode created with initial parameters from UI data attributes.`);
        
        workletNode.connect(audioContext.destination);
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

// --- Event Listeners ---
if (audioToggleButton) {
    audioToggleButton.addEventListener('click', async () => {
        if (!audioContext) {
            await initializeAudio();
            if (!audioContext) return;
        }
        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                audioToggleButton.textContent = 'Suspend Audio';
                if (isBowingActive && workletNode) {
                    updateParametersInWorklet(); 
                    workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
                }
            } catch (e) { console.error('[Main] Error resuming AudioContext:', e); }
        } else if (audioContext.state === 'running') {
            try {
                await audioContext.suspend();
                audioToggleButton.textContent = 'Resume Audio';
                if (isBowingActive && workletNode) {
                     workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
                }
            } catch (e) { console.error('[Main] Error suspending AudioContext:', e); }
        }
    });
}

if (bowingToggleButton) {
    bowingToggleButton.addEventListener('click', () => {
        if (!workletNode || !audioContext) {
            if (!isAudioInitialized && audioToggleButton) audioToggleButton.click(); 
            else if (audioContext && audioContext.state !== 'running' && audioToggleButton) audioToggleButton.click(); 
            return;
        }
        if (audioContext.state !== 'running') {
            if (audioContext.state === 'suspended' && audioToggleButton) {
                 audioToggleButton.click(); // Attempt to resume
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
}

allParamInputs.forEach(input => {
    if (input) {
        input.addEventListener('input', () => {
            // Update the specific config's currentSliderValue before calling general update
            const paramKey = input.id; // Assuming input id matches the key in uiElements/paramConfigs
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentSliderValue = parseFloat(input.value);
            }
            updateParametersInWorklet(); 
        });
    }
});

// --- Initial Page Setup ---
initializeParamConfigs(); // Read data-attributes on page load
updateAllDisplayValues(); // Set initial display values
if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });