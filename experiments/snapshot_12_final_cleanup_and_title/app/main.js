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

// --- Modal Configuration ---
const modalModeConfigs = [
    { idPrefix: 'bodyMode1Freq', baseMidi: 61, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode1FreqValue' }, // Base C#4, Range G3 to F#4
    { idPrefix: 'bodyMode2Freq', baseMidi: 70, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode2FreqValue' }, // Base A#4, Range E4 to D#5
    { idPrefix: 'bodyMode3Freq', baseMidi: 73, midiRange: [-6, 5], defaultMidiOffset: 0, spanId: 'bodyMode3FreqValue' }  // Base C#5, Range G#4 to F#5
];
// Note: defaultMidiOffset = 0 means the baseMidi is the default selected note.
// The range e.g. [-6, 5] means baseMidi-6 to baseMidi+5, giving 12 notes.

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
    'bodyModeQ', 
    'bodyMode1FreqSelect', 'bodyMode2FreqSelect', 'bodyMode3FreqSelect',
    'bpfBankMixLevelParam',
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
function getProcessorParamName(htmlId) {
    // Maps HTML element IDs to AudioParam names used in basic-processor.js parameterDescriptors
    const mapping = {
        'frequency': 'frequency', // Special case: main string freq, sent via postMessage
        'loopGain': 'loopGain',
        'cutoffParam': 'lpfCutoff',
        'resonanceParam': 'lpfQ',
        'bodyModeQ': 'bodyModeQScale',
        'bodyMode1FreqSelect': 'bodyMode1Freq',
        'bodyMode2FreqSelect': 'bodyMode2Freq',
        'bodyMode3FreqSelect': 'bodyMode3Freq',
        'bpfBankMixLevelParam': 'bodyMixLevel',
        'sawPulseMixParam': 'sawPulseMix',
        'pulseWidthParam': 'pulseWidth',
        'toneNoiseMixParam': 'toneNoiseMix',
        'bowForce': 'exciteIntensity'
    };
    return mapping[htmlId] || htmlId; // Fallback to htmlId if not in mapping
}

function initializeParamConfigs() {
    for (const key in uiElements) { // key is the HTML element ID
        const el = uiElements[key];
        if (el.input) { // Check if input element exists
            const dspMinAttr = el.input.dataset ? el.input.dataset.dspMin : undefined;
            const dspMaxAttr = el.input.dataset ? el.input.dataset.dspMax : undefined;
            const isMappedSlider = dspMinAttr !== undefined && dspMaxAttr !== undefined && el.input.tagName === 'INPUT' && el.input.type === 'range';

            paramConfigs[key] = {
                id: key,
                processorParamName: getProcessorParamName(key),
                inputElement: el.input,
                spanElement: el.span,
                isMapped: isMappedSlider,
                dspMin: isMappedSlider ? parseFloat(dspMinAttr) : (el.input.tagName === 'INPUT' ? parseFloat(el.input.min) : null),
                dspMax: isMappedSlider ? parseFloat(dspMaxAttr) : (el.input.tagName === 'INPUT' ? parseFloat(el.input.max) : null),
                decimals: parseInt(el.input.dataset && el.input.dataset.dspDecimals ? el.input.dataset.dspDecimals : (el.input.tagName === 'SELECT' ? '2' : '2'), 10),
                currentValue: parseFloat(el.input.value) // For selects, this will be the frequency string
            };
        }
    }
}


function populateModeFreqDropdowns() {
    modalModeConfigs.forEach((modeConfig, index) => {
        const selectId = modeConfig.idPrefix + 'Select'; // e.g., bodyMode1FreqSelect
        const selectElement = uiElements[selectId]?.input;
        
        if (!selectElement) {
            console.warn(`Select element ${selectId} not found for populating.`);
            return;
        }

        selectElement.innerHTML = ''; // Clear existing options

        const baseMidi = modeConfig.baseMidi;
        const minOffset = modeConfig.midiRange[0]; // e.g., -6
        const maxOffset = modeConfig.midiRange[1]; // e.g., +5
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
        // Ensure the select's value reflects the default selected option's value
        if (defaultSelectedFrequency !== null) {
            selectElement.value = defaultSelectedFrequency.toFixed(4);
        }
    });
}


// --- Update all display values based on stored configs and current slider values ---
function updateAllDisplayValues() {
    for (const key in paramConfigs) { // key is HTML element ID (e.g., 'lpfCutoff', 'bodyMode1FreqSelect')
        const config = paramConfigs[key];
        if (config.inputElement && config.spanElement) {
            const currentVal = parseFloat(config.inputElement.value);
            let displayVal = currentVal;

            // If it's a slider, it's mapped 0-1, and its dspMin/dspMax are defined for mapping actual display
            if (config.inputElement.tagName === 'INPUT' && config.inputElement.type === 'range' &&
                parseFloat(config.inputElement.min) === 0 && parseFloat(config.inputElement.max) === 1 && config.isMapped) {
                displayVal = config.dspMin + (currentVal * (config.dspMax - config.dspMin));
            }
            // For selects (like body mode frequencies), currentVal is already the frequency.
            // The `decimals` for frequency displays (like bodyMode1FreqValue) will be used.
            // HTML for select value spans (e.g. bodyMode1FreqValue) should have default values.
            // The populate function sets the select's value, which this function reads.
            config.spanElement.textContent = displayVal.toFixed(config.decimals);
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
                if (config.processorParamName === 'frequency') { // Main string frequency
                    // Ensure target value is positive for exponentialRamp
                    if (!isNaN(newValue) && newValue > 0 && newValue >= paramConfigs.frequency.dspMin && newValue <= paramConfigs.frequency.dspMax) {
                        audioParam.exponentialRampToValueAtTime(newValue, audioContext.currentTime + RAMP_TIME);
                    } else {
                        // If invalid, set to a safe value or log error. For now, clamp to min for safety.
                        // AudioParam's own minValue will also clamp, but good to be defensive.
                        const clampedValue = Math.max(paramConfigs.frequency.dspMin, paramConfigs.frequency.currentValue); // fallback to current if new is bad
                        audioParam.setValueAtTime(clampedValue, audioContext.currentTime);
                        console.warn(`[Main] Invalid target frequency ${newValue} for exponentialRamp. Clamping or using previous.`);
                    }
                } else if (config.inputElement.tagName === 'SELECT') { // Modal frequencies from dropdowns
                    audioParam.setValueAtTime(newValue, audioContext.currentTime);
                } else { // Other sliders
                    audioParam.linearRampToValueAtTime(newValue, audioContext.currentTime + RAMP_TIME);
                }
            } else {
                // This might happen if 'frequency' from paramConfigs is processed here but not found (should not if mapping is correct)
                // or if a param is in paramConfigs but not in parameterDescriptors
                console.warn(`[Main] AudioParam not found for: ${config.processorParamName} (HTML ID: ${htmlIdKey})`);
            }
        }
    }
    
    updateAllDisplayValues(); // Update UI text displays
    // Main frequency is now an AudioParam, so no postMessage needed here for it.
}

// --- Initialize Audio ---
async function initializeAudio() {
    if (isAudioInitialized) return;
    try {
        console.log('[Main] Creating AudioContext...');
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log(`[Main] AudioContext created. State: ${audioContext.state}, Sample Rate: ${audioContext.sampleRate}`);
        
        // Add state change monitoring
        audioContext.addEventListener('statechange', () => {
            console.log(`[Main] AudioContext state changed to: ${audioContext.state}`);
            if (audioContext.state === 'suspended') {
                console.warn('[Main] AudioContext was suspended - this might indicate an error or browser policy');
            }
        });
        
        // Populate dropdowns first, so their default values are set before paramConfigs reads them
        populateModeFreqDropdowns();
        initializeParamConfigs(); // Initialize/re-initialize configs from HTML & populated dropdowns
        updateAllDisplayValues(); // Set initial display values based on these configs

        console.log('[Main] Loading AudioWorklet module...');
        await audioContext.audioWorklet.addModule('basic-processor.js');
        console.log('[Main] AudioWorklet module loaded successfully');
        
        // processorOptions are no longer strictly needed for initial AudioParam values if set manually after node creation.
        // The main string frequency is also an AudioParam now.
        const processorOpts = {}; // Empty for now, unless processor constructor needs specific non-AudioParam options.

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', { 
            processorOptions: processorOpts,
        });
        console.log(`[Main] AudioWorkletNode created.`);

        // Set initial values for all AudioParams
        for (const htmlIdKey in paramConfigs) {
            const config = paramConfigs[htmlIdKey];
            const audioParam = workletNode.parameters.get(config.processorParamName);
            if (audioParam) {
                let initialValue = config.currentValue;
                // Ensure frequency is positive for exponentialRamp safety, even for initial setValueAtTime
                if (config.processorParamName === 'frequency' && initialValue <= 0) {
                    initialValue = paramConfigs.frequency.dspMin; // Fallback to min slider value
                    console.warn(`[Main] Initial frequency for AudioParam was <=0, setting to ${initialValue}`);
                }
                audioParam.setValueAtTime(initialValue, audioContext.currentTime);
            } else {
                 console.warn(`[Main] Initial AudioParam not found for: ${config.processorParamName} (HTML ID: ${htmlIdKey})`);
            }
        }
        
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
                console.log('[Main] Attempting to resume AudioContext...');
                await audioContext.resume();
                console.log(`[Main] AudioContext resumed successfully. State: ${audioContext.state}`);
                audioToggleButton.textContent = 'Suspend Audio';
                if (isBowingActive && workletNode) {
                    // updateParametersOnAudioThread(); // Parameters are continuously updated by UI events.
                    workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
                }
            } catch (e) { 
                console.error('[Main] Error resuming AudioContext:', e);
                audioToggleButton.textContent = 'Resume Failed - Try Again';
            }
        } else if (audioContext.state === 'running') {
            try {
                console.log('[Main] Attempting to suspend AudioContext...');
                await audioContext.suspend();
                console.log(`[Main] AudioContext suspended successfully. State: ${audioContext.state}`);
                audioToggleButton.textContent = 'Resume Audio';
                if (isBowingActive && workletNode) {
                     workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
                }
            } catch (e) { 
                console.error('[Main] Error suspending AudioContext:', e);
                audioToggleButton.textContent = 'Suspend Failed - Try Again';
            }
        }
    });
}

if (bowingToggleButton) {
    bowingToggleButton.addEventListener('click', () => {
        console.log(`[Main] Bowing toggle clicked. AudioContext state: ${audioContext?.state}, isBowingActive: ${isBowingActive}`);
        
        if (!workletNode || !audioContext) {
            console.log('[Main] WorkletNode or AudioContext not ready, attempting to initialize...');
            if (!isAudioInitialized && audioToggleButton) audioToggleButton.click(); 
            else if (audioContext && audioContext.state !== 'running' && audioToggleButton) audioToggleButton.click(); 
            return;
        }
        if (audioContext.state !== 'running') {
            console.log(`[Main] AudioContext not running (state: ${audioContext.state}), attempting to resume...`);
            if (audioContext.state === 'suspended' && audioToggleButton) {
                 audioToggleButton.click(); // Attempt to resume
            }
            return;
        }
        isBowingActive = !isBowingActive;
        console.log(`[Main] Setting bowing state to: ${isBowingActive}`);
        
        // updateParametersOnAudioThread(); // Parameters are continuously updated by UI events.
        // Only send bowing state.
        if (workletNode) {
            workletNode.port.postMessage({ type: 'setBowing', isBowing: isBowingActive });
        }
        bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
    });
}

allParamInputs.forEach(inputElement => {
    if (inputElement) {
        const eventType = inputElement.tagName === 'SELECT' ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            const paramKey = inputElement.id; // HTML element ID
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentValue = parseFloat(inputElement.value);
            }
            updateParametersOnAudioThread(); 
        });
    }
});

// --- Initial Page Setup ---
populateModeFreqDropdowns(); // Populate dropdowns first
initializeParamConfigs(); // Then read data-attributes and dropdown values
updateAllDisplayValues(); // Set initial display values
if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });