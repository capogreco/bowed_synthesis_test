// main.js

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
    if (htmlId === 'bodyMode1FreqSelect') return 'bodyMode1Freq';
    if (htmlId === 'bodyMode2FreqSelect') return 'bodyMode2Freq';
    if (htmlId === 'bodyMode3FreqSelect') return 'bodyMode3Freq';
    if (htmlId === 'bodyModeQ') return 'bodyModeQValue'; // Maps HTML id 'bodyModeQ' to processor's 'bodyModeQValue'
    // Add other special mappings if needed, otherwise HTML ID is used directly
    return htmlId;
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
    for (const key in paramConfigs) { // key is HTML element ID
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

// --- Update parameters in the worklet ---
function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) return;

    const paramsToSend = {};
    for (const key in paramConfigs) { // key is the HTML element ID
        const config = paramConfigs[key];
        if (config.inputElement) {
            const value = parseFloat(config.inputElement.value); // For selects, this is the chosen frequency
            paramsToSend[config.processorParamName] = value; 
            config.currentValue = value; // Update stored current value
        }
    }
    
    updateAllDisplayValues(); 

    // Basic validation (can be expanded using paramConfigs for dynamic min/max checks)
    // For now, relies on HTML input min/max for direct-value sliders
    if (paramsToSend.frequency !== undefined && (isNaN(paramsToSend.frequency) || paramsToSend.frequency < paramConfigs.frequency.dspMin || paramsToSend.frequency > paramConfigs.frequency.dspMax) ) {
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
        
        // Populate dropdowns first, so their default values are set before paramConfigs reads them
        populateModeFreqDropdowns();
        initializeParamConfigs(); // Initialize/re-initialize configs from HTML & populated dropdowns
        updateAllDisplayValues(); // Set initial display values based on these configs

        await audioContext.audioWorklet.addModule('basic-processor.js');
        
        const processorOpts = {};
        for (const key in paramConfigs) { // key is HTML element ID
            const config = paramConfigs[key];
            // Send the current value (which could be slider value or select's direct value)
            processorOpts[config.processorParamName] = config.currentValue;

            // If this param is a mapped slider (slider is 0-1 but DSP range is different), send mapping info
            if (config.isMapped) { // isMapped is true for 0-1 sliders with dspMin/Max
                 // The key for mapping info in processor uses the HTML ID base_dspMin/Max
                processorOpts[`${config.id}_dspMin`] = config.dspMin;
                processorOpts[`${config.id}_dspMax`] = config.dspMax;
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

allParamInputs.forEach(inputElement => {
    if (inputElement) {
        const eventType = inputElement.tagName === 'SELECT' ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            const paramKey = inputElement.id; // HTML element ID
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentValue = parseFloat(inputElement.value);
            }
            updateParametersInWorklet(); 
        });
    }
});

// --- Initial Page Setup ---
populateModeFreqDropdowns(); // Populate dropdowns first
initializeParamConfigs(); // Then read data-attributes and dropdown values
updateAllDisplayValues(); // Set initial display values
if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });