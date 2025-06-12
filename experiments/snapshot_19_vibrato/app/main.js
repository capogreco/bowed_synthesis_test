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

// --- Modal Configuration (for the 3-mode Body Resonator) ---
const modalModeConfigs = [
    { idPrefix: 'bodyMode1Freq', baseMidi: 61, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode1FreqSelectValue' }, // Base C#4
    { idPrefix: 'bodyMode2Freq', baseMidi: 70, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode2FreqSelectValue' }, // Base A#4
    { idPrefix: 'bodyMode3Freq', baseMidi: 73, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode3FreqSelectValue' }  // Base C#5
];

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
    'stringMaterial',   // String material type
    'cutoffParam',      // LPF Cutoff
    'resonanceParam',   // LPF Resonance
    'bodyModeQ',        // Body Q Scale
    'bodyMode1FreqSelect', // Body Mode 1 Freq
    'bodyMode2FreqSelect', // Body Mode 2 Freq
    'bodyMode3FreqSelect', // Body Mode 3 Freq
    'bpfBankMixLevelParam', // Body Mix Level
    'sawPulseMix',      // Bow excitation saw/pulse mix
    'bowPosition',      // Bow position (distance from bridge)
    'bowSpeed',         // Bow speed
    'toneNoiseMix',     // Bow excitation tone/noise mix
    'vibratoRate',      // Vibrato rate in Hz
    'vibratoDepth',     // Vibrato depth 0-1
    'vibratoPitchAmount', // Vibrato pitch/amp balance
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
        'stringMaterial': 'stringMaterial',  // String material type
        'cutoffParam': 'lpfCutoff',      // Added LPF mapping
        'resonanceParam': 'lpfQ',       // Added LPF mapping
        'bodyModeQ': 'bodyModeQScale',  // Body mode Q scaling factor
        'bpfBankMixLevelParam': 'bodyMixLevel',  // Body resonator mix
        'sawPulseMix': 'sawPulseMix',   // Bow excitation parameters
        'bowPosition': 'bowPosition',   // Bow position from bridge
        'bowSpeed': 'bowSpeed',         // Bow speed
        'toneNoiseMix': 'toneNoiseMix',
        'vibratoRate': 'vibratoRate',   // Vibrato parameters
        'vibratoDepth': 'vibratoDepth',
        'vibratoPitchAmount': 'vibratoPitchAmount',
        'bowForce': 'excitationLevel'
    };
    return mapping[htmlId] || htmlId; // Fallback, though all current IDs should be in mapping
}

function populateModeFreqDropdowns() {
    modalModeConfigs.forEach((modeConfig) => {
        const selectId = modeConfig.idPrefix + 'Select'; // e.g., bodyMode1FreqSelect
        const selectElement = uiElements[selectId]?.input;
        const valueSpanElement = document.getElementById(modeConfig.spanId);

        if (!selectElement) {
            // console.warn(`Select element ${selectId} not found for populating.`);
            return;
        }
        
        selectElement.innerHTML = ''; // Clear existing options

        const baseMidi = modeConfig.baseMidi;
        const minOffset = modeConfig.midiRange[0];
        const maxOffset = modeConfig.midiRange[1];
        let defaultSelectedFrequency = null;

        for (let offset = minOffset; offset <= maxOffset; offset++) {
            const midiNote = baseMidi + offset;
            const freq = midiToFreq(midiNote);
            const noteName = getNoteName(midiNote);

            const option = document.createElement('option');
            option.value = freq.toFixed(4); // Store frequency with more precision
            option.textContent = `${noteName} (${freq.toFixed(2)} Hz)`;
            selectElement.appendChild(option);

            if (offset === modeConfig.defaultMidiOffset) {
                option.selected = true;
                defaultSelectedFrequency = freq;
            }
        }

        // After populating, set the select element's value and update paramConfigs
        if (defaultSelectedFrequency !== null) {
            selectElement.value = defaultSelectedFrequency.toFixed(4);
        } else if (selectElement.options.length > 0) {
            // Fallback if defaultMidiOffset didn't match or wasn't found: select the first option
            selectElement.selectedIndex = 0;
        }

        // Update paramConfigs with the actual value from the select element
        if (paramConfigs[selectId]) {
            paramConfigs[selectId].currentValue = parseFloat(selectElement.value);
            if (valueSpanElement) {
                paramConfigs[selectId].spanElement = valueSpanElement;
            }
            // Ensure decimals for frequency display, defaulting to 2 if not set by data-dsp-decimals
            paramConfigs[selectId].decimals = parseInt(selectElement.dataset.dspDecimals || '2', 10);
        }
    });
}

// --- Update all display values based on stored configs and current slider values ---
function updateAllDisplayValues() {
    for (const key in paramConfigs) { 
        const config = paramConfigs[key];
        // Ensure spanElement exists for this config before trying to update it
        if (config.inputElement && config.spanElement) { 
            // Use the stored config.currentValue as the source of truth,
            // assuming it's correctly updated by event handlers and initialization.
            let displayVal = config.currentValue; 

            // The 'isMapped' logic for sliders would apply if we re-introduced 0-1 sliders
            // that map to different DSP ranges. Currently, all sliders are direct value.
            // If config.isMapped were true for a slider:
            // if (config.inputElement.tagName === 'INPUT' && config.inputElement.type === 'range' && config.isMapped) {
            //     // Assuming config.currentValue for a mapped slider is the 0-1 value from the input
            //     displayVal = config.dspMin + (config.currentValue * (config.dspMax - config.dspMin));
            // }
            // Since isMapped is always false, displayVal remains config.currentValue.

            // Special handling for string material
            if (key === 'stringMaterial') {
                const materialNames = ['Steel', 'Gut', 'Nylon', 'Wound'];
                const materialIndex = parseInt(config.currentValue || 0);
                config.spanElement.textContent = materialNames[materialIndex] || 'Steel';
            } else if (typeof displayVal === 'number' && !isNaN(displayVal)) {
                config.spanElement.textContent = displayVal.toFixed(config.decimals);
            } else {
                // If displayVal is not a valid number (e.g. NaN from a failed parse somewhere,
                // or if config.currentValue was not properly initialized for selects), display 'NaN' or similar.
                config.spanElement.textContent = 'NaN';
            }
        }
    }
}

function initializeParamConfigs() {
    for (const key in uiElements) { // key is the HTML element ID
        const el = uiElements[key];
        if (el.input) { // Check if input element exists
            const dspMinAttr = el.input.dataset ? el.input.dataset.dspMin : undefined;
            const dspMaxAttr = el.input.dataset ? el.input.dataset.dspMax : undefined;
            const isMappedSlider = false; 

            let initialValue;
            if (el.input.tagName === 'SELECT') {
                // Defer setting currentValue for SELECTs until they are populated.
                // It will be set in populateModeFreqDropdowns.
                // Assign a temporary valid number or null if preferred, but it will be overwritten.
                initialValue = 0; // Temporary, will be updated by populateModeFreqDropdowns
            } else {
                initialValue = parseFloat(el.input.value);
            }

            paramConfigs[key] = {
                id: key,
                processorParamName: getProcessorParamName(key),
                inputElement: el.input,
                spanElement: el.span, // el.span might be null initially for selects if spanId is custom
                isMapped: isMappedSlider,
                dspMin: parseFloat(el.input.min), // Note: <select> doesn't have min/max
                dspMax: parseFloat(el.input.max), // Note: <select> doesn't have min/max
                decimals: parseInt(el.input.dataset && el.input.dataset.dspDecimals ? el.input.dataset.dspDecimals : '2', 10),
                currentValue: initialValue
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
                } else if (config.inputElement.tagName === 'SELECT') { // Modal frequencies from dropdowns
                     audioParam.setValueAtTime(newValue, audioContext.currentTime); // No ramp for discrete choices
                } else { // Other k-rate sliders
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
        
        // Order is important:
        initializeParamConfigs();      // 1. Create paramConfigs for all UI elements.
        populateModeFreqDropdowns();   // 2. Populate select dropdowns, set their .value, and update paramConfigs[selectId].currentValue.
        updateAllDisplayValues();      // 3. Update all UI spans from the now-correct paramConfigs.

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
                // Ensure initialValue is not NaN before setting AudioParam
                if (isNaN(initialValue)) {
                    // console.warn(`[Main] Initial value for ${config.processorParamName} (HTML ID: ${htmlIdKey}) is NaN. Using default from descriptor or 0.`);
                    // Attempt to get default from descriptor if available, otherwise use a safe value like 0 or descriptor default.
                    // This case should ideally not be hit if populateModeFreqDropdowns correctly sets currentValue.
                    const descriptorDefault = workletNode.parameters.get(config.processorParamName)?.defaultValue;
                    initialValue = descriptorDefault !== undefined ? descriptorDefault : 0;
                }
                audioParam.setValueAtTime(initialValue, audioContext.currentTime);
            } else {
                 // console.warn(`[Main] Initial AudioParam not found for: ${config.processorParamName} (HTML ID: ${htmlIdKey})`);
            }
        }
        
        workletNode.connect(audioContext.destination);
        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        bowingToggleButton.disabled = false; // Enable Start Bowing button
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
    bowingToggleButton.addEventListener('click', () => {
        // console.log(`[Main] Bowing toggle clicked. AudioContext state: ${audioContext?.state}, isBowingActive: ${isBowingActive}`);
        
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
        
        // Toggle bowing state
        isBowingActive = !isBowingActive;
        
        // Update button text
        bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
        
        // Ensure current parameters are sent before changing bowing state
        updateParametersOnAudioThread(); 
        
        if (workletNode) {
            workletNode.port.postMessage({ type: 'setBowing', value: isBowingActive });
            // console.log(`[Main] Sent setBowing message to worklet: ${isBowingActive}`);
        }
    });
}

allParamInputs.forEach(inputElement => {
    if (inputElement) {
        // Handle both sliders and select dropdowns
        const eventType = inputElement.tagName === 'SELECT' ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            const paramKey = inputElement.id; 
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentValue = parseFloat(inputElement.value);
                
                // Special handling for string material display
                if (paramKey === 'stringMaterial' && paramConfigs[paramKey].spanElement) {
                    const materialNames = ['Steel', 'Gut', 'Nylon', 'Wound'];
                    const materialIndex = parseInt(inputElement.value);
                    paramConfigs[paramKey].spanElement.textContent = materialNames[materialIndex] || 'Steel';
                }
            }
            updateParametersOnAudioThread(); 
        });
    }
});

// --- Initial Page Setup ---
// Order is important for correct initialization before audio starts or UI is enabled.
initializeParamConfigs();      // 1. Create paramConfigs. currentValue for selects might be temporary.
populateModeFreqDropdowns();   // 2. Populate select dropdowns, set their .value, and crucially update paramConfigs[selectId].currentValue and .spanElement.
updateAllDisplayValues();      // 3. Update all UI display spans using the finalized paramConfigs.

if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });