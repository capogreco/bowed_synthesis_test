// main.js

const RAMP_TIME = 0.02; // 20ms for parameter smoothing

// --- Helper Functions ---
function midiToFreq(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12.0);
}

function getNoteName(midiNote) {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const octave = Math.floor(midiNote / 12) - 1;
    return noteNames[midiNote % 12] + octave;
}

// --- Modal Configuration (for the 3-mode Body Resonator - Not used in current simplified MVP) ---
// const modalModeConfigs = [
//     { idPrefix: 'bodyMode1Freq', baseMidi: 61, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode1FreqSelectValue' },
//     { idPrefix: 'bodyMode2Freq', baseMidi: 70, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode2FreqSelectValue' },
//     { idPrefix: 'bodyMode3Freq', baseMidi: 73, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode3FreqSelectValue' }
// ];

let audioContext;
let workletNode;
let isAudioInitialized = false;
let isBowingActive = false;

const audioToggleButton = document.getElementById('audioToggle');
const bowingToggleButton = document.getElementById('bowingToggle');

// --- Parameter Configuration Store ---
const paramConfigs = {};

// --- Define UI elements by ID ---
const uiElementIds = [
    'frequency',        // Maps to fundamentalFrequency
    'stringDamping',    // New modal string parameter
    'cutoffParam',      // LPF Cutoff
    'resonanceParam',   // LPF Resonance
    'bowForce'          // Maps to excitationLevel
];

const uiElements = {};
uiElementIds.forEach(id => {
    const input = document.getElementById(id);
    const span = document.getElementById(id + 'Value');
    if (input && span) { // Expect both input and span for these simple sliders
        uiElements[id] = { input, span };
    } else {
        // console.warn(`UI elements for parameter '${id}' (and/or its value span) not found.`);
    }
});

const allParamInputs = Object.values(uiElements).map(el => el.input).filter(Boolean);

// --- Initialize Parameter Configurations from HTML Data Attributes ---
function getProcessorParamName(htmlId) {
    // Maps HTML element IDs to AudioParam names used in basic-processor.js parameterDescriptors
    const mapping = {
        'frequency': 'fundamentalFrequency',
        'stringDamping': 'stringDamping',
        'cutoffParam': 'lpfCutoff',      // Added LPF mapping
        'resonanceParam': 'lpfQ',       // Added LPF mapping
        'bowForce': 'excitationLevel'
    };
    return mapping[htmlId] || htmlId; // Fallback, though all current IDs should be in mapping
}

function populateModeFreqDropdowns() {
    // This function is not needed for the simplified modal string MVP
    // as there are no select dropdowns.
}

// --- Update all display values based on stored configs and current slider values ---
function updateAllDisplayValues() {
    for (const key in paramConfigs) { 
        const config = paramConfigs[key];
        // Ensure spanElement exists for this config before trying to update it
        if (config.inputElement && config.spanElement) { 
            const currentVal = parseFloat(config.inputElement.value);
            let displayVal = currentVal;

            // If it's a slider that is explicitly mapped (e.g. 0-1 UI to different DSP range)
            if (config.inputElement.tagName === 'INPUT' && config.inputElement.type === 'range' &&
                config.isMapped) { // 'isMapped' should be true if dspMin/dspMax were provided and differ from slider's actual min/max
                displayVal = config.dspMin + (currentVal * (config.dspMax - config.dspMin));
            }
            // For selects, currentVal is the frequency. For direct sliders, it's the value.
            config.spanElement.textContent = displayVal.toFixed(config.decimals);
        }
    }
}

function initializeParamConfigs() {
    for (const key in uiElements) { // key is the HTML element ID
        const el = uiElements[key];
        if (el.input) { // Check if input element exists
            const dspMinAttr = el.input.dataset ? el.input.dataset.dspMin : undefined;
            const dspMaxAttr = el.input.dataset ? el.input.dataset.dspMax : undefined;
            // For modal string MVP, sliders are direct value, not 0-1 mapped for dspMin/dspMax in the same way.
            // We'll rely on HTML min/max for sliders and their direct values.
            const isMappedSlider = false; // TODO: Revisit if 0-1 sliders with dsp-mapping are re-introduced

            paramConfigs[key] = {
                id: key,
                processorParamName: getProcessorParamName(key),
                inputElement: el.input,
                spanElement: el.span,
                isMapped: isMappedSlider, // Set based on current MVP (all sliders are direct value)
                // For MVP, dspMin/Max are the same as slider min/max
                dspMin: parseFloat(el.input.min), 
                dspMax: parseFloat(el.input.max),
                decimals: parseInt(el.input.dataset && el.input.dataset.dspDecimals ? el.input.dataset.dspDecimals : '2', 10),
                currentValue: parseFloat(el.input.value)
            };
        }
    }
}

// --- Update parameters on the Audio Thread (using AudioParams) ---
function updateParametersOnAudioThread() {
    if (!workletNode || !audioContext || !isAudioInitialized || audioContext.state !== 'running') return;

    for (const htmlIdKey in paramConfigs) {
        const config = paramConfigs[htmlIdKey];
        if (config.inputElement) {
            const newValue = parseFloat(config.inputElement.value);
            config.currentValue = newValue; // Update stored current value

            const audioParam = workletNode.parameters.get(config.processorParamName);
            if (audioParam) {
                // All params are currently k-rate for MVP, fundamentalFrequency is a-rate but handled by its ramp
                if (config.processorParamName === 'fundamentalFrequency') {
                    if (!isNaN(newValue) && newValue > 0 && newValue >= config.dspMin && newValue <= config.dspMax) {
                        audioParam.exponentialRampToValueAtTime(newValue, audioContext.currentTime + RAMP_TIME);
                    } else {
                        const clampedValue = Math.max(config.dspMin, config.currentValue);
                        audioParam.setValueAtTime(clampedValue, audioContext.currentTime);
                        // console.warn(`[Main] Invalid target fundamentalFrequency ${newValue}. Clamping or using previous.`);
                    }
                } else { // Other k-rate sliders (stringDamping, excitationLevel for simplified MVP)
                    audioParam.linearRampToValueAtTime(newValue, audioContext.currentTime + RAMP_TIME);
                }
            } else {
                // console.warn(`[Main] AudioParam not found for: ${config.processorParamName} (HTML ID: ${htmlIdKey})`);
            }
        }
    }
    
    updateAllDisplayValues(); // Update UI text displays
}

// --- Initialize Audio ---
async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        // console.log('[Main] Creating AudioContext...');
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // console.log(`[Main] AudioContext created. State: ${audioContext.state}, Sample Rate: ${audioContext.sampleRate}`);
        
        audioContext.addEventListener('statechange', () => {
            // console.log(`[Main] AudioContext state changed to: ${audioContext.state}`);
            if (audioContext.state === 'suspended') {
                // console.warn('[Main] AudioContext was suspended - this might indicate an error or browser policy');
            }
        });
        
        // populateModeFreqDropdowns(); // Not used for simplified MVP
        initializeParamConfigs(); 
        updateAllDisplayValues(); 

        // console.log('[Main] Loading AudioWorklet module...');
        await audioContext.audioWorklet.addModule('basic-processor.js');
        // console.log('[Main] AudioWorklet module loaded successfully');
        
        const processorOpts = {}; // No specific processorOptions needed for modal string MVP constructor

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', { 
            processorOptions: processorOpts,
        });
        // console.log(`[Main] AudioWorkletNode created.`);

        // Set initial values for all AudioParams based on current UI values
        for (const htmlIdKey in paramConfigs) {
            const config = paramConfigs[htmlIdKey];
            const audioParam = workletNode.parameters.get(config.processorParamName);
            if (audioParam) {
                let initialValue = config.currentValue;
                if (config.processorParamName === 'fundamentalFrequency' && initialValue <= 0) {
                    initialValue = config.dspMin; 
                    // console.warn(`[Main] Initial fundamentalFrequency for AudioParam was <=0, setting to ${initialValue}`);
                }
                audioParam.setValueAtTime(initialValue, audioContext.currentTime);
            } else {
                 // console.warn(`[Main] Initial AudioParam not found for: ${config.processorParamName} (HTML ID: ${htmlIdKey})`);
            }
        }
        
        workletNode.connect(audioContext.destination);
        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        bowingToggleButton.disabled = false; // Enable Pluck String button
        allParamInputs.forEach(input => { if(input) input.disabled = false; });

    } catch (e) {
        // console.error('[Main] Error initializing audio:', e);
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
                // console.log('[Main] Attempting to resume AudioContext...');
                await audioContext.resume();
                // console.log(`[Main] AudioContext resumed successfully. State: ${audioContext.state}`);
                audioToggleButton.textContent = 'Suspend Audio';
                // No need to send setBowing for pluck model on resume
            } catch (e) { 
                // console.error('[Main] Error resuming AudioContext:', e);
                audioToggleButton.textContent = 'Resume Failed - Try Again';
            }
        } else if (audioContext.state === 'running') {
            try {
                // console.log('[Main] Attempting to suspend AudioContext...');
                await audioContext.suspend();
                // console.log(`[Main] AudioContext suspended successfully. State: ${audioContext.state}`);
                audioToggleButton.textContent = 'Resume Audio';
                 // No need to send setBowing for pluck model on suspend
            } catch (e) { 
                // console.error('[Main] Error suspending AudioContext:', e);
                audioToggleButton.textContent = 'Suspend Failed - Try Again';
            }
        }
    });
}

if (bowingToggleButton) {
    bowingToggleButton.addEventListener('click', () => { // This is now the "Pluck String" button
        // console.log(`[Main] Pluck String button clicked. AudioContext state: ${audioContext?.state}`);
        
        if (!workletNode || !audioContext) {
            // console.log('[Main] WorkletNode or AudioContext not ready, attempting to initialize/resume...');
            if (!isAudioInitialized && audioToggleButton) audioToggleButton.click(); 
            else if (audioContext && audioContext.state !== 'running' && audioToggleButton) audioToggleButton.click(); 
            return;
        }
        if (audioContext.state !== 'running') {
            // console.log(`[Main] AudioContext not running (state: ${audioContext.state}), attempting to resume...`);
            if (audioContext.state === 'suspended' && audioToggleButton) {
                 audioToggleButton.click(); // Attempt to resume
            }
            return;
        }
        // isBowingActive is not relevant for a pluck model
        
        // Ensure current parameters (especially excitationLevel) are sent before plucking
        updateParametersOnAudioThread(); 
        
        // updateParametersOnAudioThread(); // Parameters are continuously updated by UI events.
        // Only send bowing state.
        if (workletNode) {
            workletNode.port.postMessage({ type: 'pluckString' });
            // console.log('[Main] Sent pluckString message to worklet.');
        }
        // Button text doesn't need to change for a one-shot pluck
        // bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
    });
}

allParamInputs.forEach(inputElement => {
    if (inputElement) {
        // All current controls are sliders, so 'input' event is fine
        inputElement.addEventListener('input', () => {
            const paramKey = inputElement.id; 
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentValue = parseFloat(inputElement.value);
            }
            updateParametersOnAudioThread(); 
        });
    }
});

// --- Initial Page Setup ---
// populateModeFreqDropdowns(); // Not used for simplified MVP
initializeParamConfigs(); 
updateAllDisplayValues(); 
if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });