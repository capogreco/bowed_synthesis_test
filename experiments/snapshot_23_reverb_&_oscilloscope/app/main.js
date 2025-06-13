// main.js

import { Oscilloscope } from './oscilloscope.js';

const RAMP_TIME = 0.02; // 20ms for parameter smoothing

// --- Helper Functions ---




let audioContext;
let workletNode;
let isAudioInitialized = false;
let isBowingActive = false;
let oscilloscope;
let analyserNode;

const audioToggleButton = document.getElementById('audioToggle');
const bowingToggleButton = document.getElementById('bowingToggle');

// --- Parameter Configuration Store ---
const paramConfigs = {};

// --- Define UI elements by ID ---
const uiElementIds = [
    'frequency',        // Maps to fundamentalFrequency
    'stringDamping',    // String damping parameter
    'stringMaterial',   // String material type
    'bowPosition',      // Bow position (distance from bridge)
    'bowSpeed',         // Bow speed
    'bowForce',         // Bow pressure/force
    'brightness',       // Overall brightness control
    'vibratoRate',      // Vibrato rate in Hz
    'vibratoDepth',     // Vibrato depth 0-1
    'trillInterval',    // Trill interval (semitone/whole tone)
    'trillSpeed',       // Trill speed in Hz
    'trillArticulation', // Trill articulation (staccato/legato)
    'tremoloSpeed',     // Tremolo speed in Hz
    'tremoloDepth',     // Tremolo depth 0-1
    'tremoloArticulation', // Tremolo articulation (staccato/legato)
    'bodyType',         // Instrument body type
    'bodyResonance',    // Body resonance amount
    'masterGain'        // Master volume control
];

const uiElements = {};
uiElementIds.forEach(id => {
    const input = document.getElementById(id);
    const span = document.getElementById(id + 'Value');
    if (input) { // Accept input even without span (for checkbox)
        uiElements[id] = { input, span };
    } else {
        // console.warn(`UI element for parameter '${id}' not found.`);
    }
});

const allParamInputs = Object.values(uiElements).map(el => el.input).filter(Boolean);



// --- Initialize Parameter Configurations from HTML Data Attributes ---
function getProcessorParamName(htmlId) {
    // Maps HTML element IDs to AudioParam names used in basic-processor.js parameterDescriptors
    const mapping = {
        'frequency': 'fundamentalFrequency',
        'stringDamping': 'stringDamping',
        'stringMaterial': 'stringMaterial',
        'bowPosition': 'bowPosition',
        'bowSpeed': 'bowSpeed',
        'bowForce': 'bowForce',
        'brightness': 'brightness',
        'vibratoRate': 'vibratoRate',
        'vibratoDepth': 'vibratoDepth',
        'trillInterval': 'trillInterval',
        'trillSpeed': 'trillSpeed',
        'trillArticulation': 'trillArticulation',
        'tremoloSpeed': 'tremoloSpeed',
        'tremoloDepth': 'tremoloDepth',
        'tremoloArticulation': 'tremoloArticulation',
        'bodyType': 'bodyType',
        'bodyResonance': 'bodyResonance',
        'masterGain': 'masterGain'
    };
    return mapping[htmlId] || htmlId;
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

            // Special handling for dropdowns
            if (key === 'stringMaterial') {
                const materialNames = ['Steel', 'Gut', 'Nylon', 'Wound'];
                const materialIndex = parseInt(config.currentValue || 0);
                config.spanElement.textContent = materialNames[materialIndex] || 'Steel';
            } else if (key === 'bodyType') {
                const bodyNames = ['Violin', 'Viola', 'Cello', 'Guitar', 'None'];
                const bodyIndex = parseInt(config.currentValue || 0);
                config.spanElement.textContent = bodyNames[bodyIndex] || 'Violin';
            } else if (key === 'trillInterval') {
                const intervalNames = ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', '8ve'];
                const intervalIndex = parseInt(config.currentValue || 1) - 1;
                config.spanElement.textContent = intervalNames[intervalIndex] || 'm2';
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
            } else if (el.input.type === 'checkbox') {
                initialValue = el.input.checked ? 1 : 0;
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
            let newValue;
            if (config.inputElement.type === 'checkbox') {
                newValue = config.inputElement.checked ? 1 : 0;
            } else {
                newValue = parseFloat(config.inputElement.value);
            }
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
                } else if (config.inputElement.tagName === 'SELECT' || config.inputElement.type === 'checkbox') { // Dropdowns and checkboxes
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
        updateAllDisplayValues();      // 2. Update all UI spans from the now-correct paramConfigs.

        // console.log('[Main] Loading AudioWorklet module...');
        await audioContext.audioWorklet.addModule('basic-processor.js');
        await audioContext.audioWorklet.addModule('reverb-processor.js');
        // console.log('[Main] AudioWorklet modules loaded successfully');
        
        const processorOpts = {}; // No specific processorOptions needed for modal string MVP constructor

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', { 
            processorOptions: processorOpts,
        });
        // console.log(`[Main] AudioWorkletNode created.`);
        
        // Create reverb node
        const reverbNode = new AudioWorkletNode(audioContext, 'fdn-reverb-processor');
        // console.log('[Main] Reverb node created.');
        
        // Create analyser node for oscilloscope
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048; // Good resolution for waveform
        analyserNode.smoothingTimeConstant = 0; // No smoothing for accurate waveform

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
        
        // Connect: synth -> analyser -> reverb -> destination
        workletNode.connect(analyserNode);
        analyserNode.connect(reverbNode);
        reverbNode.connect(audioContext.destination);
        

        
        // Store reverb node globally for parameter access
        window.reverbNode = reverbNode;
        
        // Initialize oscilloscope
        const oscCanvas = document.getElementById('oscilloscope');
        if (oscCanvas && analyserNode) {
            oscilloscope = new Oscilloscope(oscCanvas, analyserNode);
            oscilloscope.setSampleRate(audioContext.sampleRate);
            oscilloscope.setFrequency(paramConfigs.frequency?.currentValue || 220);
            oscilloscope.start();
        }
        
        // Feedback detection messages are no longer sent from the reverb processor.
        // Visual feedback for protection state is removed.
        
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
                if (oscilloscope) oscilloscope.start();
                // No need to send setBowing for pluck model on resume
            } catch (e) { 
                // console.error('[Main] Error resuming AudioContext:', e);
                audioToggleButton.textContent = 'Resume Failed - Try Again';
            }
        } else if (audioContext.state === 'running') {
            try {
                // console.log('[Main] Attempting to suspend AudioContext...');
                await audioContext.suspend();
                // console.log(`[Main] AudioContext suspended. State: ${audioContext.state}`);
                audioToggleButton.textContent = 'Resume Audio';
                if (oscilloscope) oscilloscope.stop();
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
        bowingToggleButton.classList.toggle('active', isBowingActive);
        
        // Ensure current parameters are sent before changing bowing state
        updateParametersOnAudioThread(); 
        
        if (workletNode) {
            workletNode.port.postMessage({ type: 'setBowing', value: isBowingActive });
            // console.log(`[Main] Sent setBowing message to worklet: ${isBowingActive}`);
        }
    });
}

// Handle expression radio buttons
const expressionRadios = document.querySelectorAll('input[name="expression"]');
expressionRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        if (radio.checked) {
            const workletReady = workletNode && audioContext && isAudioInitialized && audioContext.state === 'running';
            if (!workletReady) return;
            
            // Set all expression enables to 0
            const vibratoParam = workletNode.parameters.get('vibratoEnabled');
            const trillParam = workletNode.parameters.get('trillEnabled');
            const tremoloParam = workletNode.parameters.get('tremoloEnabled');
            
            if (vibratoParam) vibratoParam.setValueAtTime(0, audioContext.currentTime);
            if (trillParam) trillParam.setValueAtTime(0, audioContext.currentTime);
            if (tremoloParam) tremoloParam.setValueAtTime(0, audioContext.currentTime);
            
            // Enable the selected expression
            switch(radio.value) {
                case 'vibrato':
                    if (vibratoParam) vibratoParam.setValueAtTime(1, audioContext.currentTime);
                    break;
                case 'trill':
                    if (trillParam) trillParam.setValueAtTime(1, audioContext.currentTime);
                    break;
                case 'tremolo':
                    if (tremoloParam) tremoloParam.setValueAtTime(1, audioContext.currentTime);
                    break;
            }
        }
    });
});

allParamInputs.forEach(inputElement => {
    if (inputElement) {
        // Handle both sliders and select dropdowns
        const eventType = inputElement.tagName === 'SELECT' ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            const paramKey = inputElement.id; 
            if (paramKey && paramConfigs[paramKey]) {
                paramConfigs[paramKey].currentValue = parseFloat(inputElement.value);
                
                // Special handling for dropdown displays
                if (paramKey === 'stringMaterial' && paramConfigs[paramKey].spanElement) {
                    const materialNames = ['Steel', 'Gut', 'Nylon', 'Wound'];
                    const materialIndex = parseInt(inputElement.value);
                    paramConfigs[paramKey].spanElement.textContent = materialNames[materialIndex] || 'Steel';
                } else if (paramKey === 'bodyType' && paramConfigs[paramKey].spanElement) {
                    const bodyNames = ['Violin', 'Viola', 'Cello', 'Guitar', 'None'];
                    const bodyIndex = parseInt(inputElement.value);
                    paramConfigs[paramKey].spanElement.textContent = bodyNames[bodyIndex] || 'Violin';
                } else if (paramKey === 'trillInterval' && paramConfigs[paramKey].spanElement) {
                    const intervalNames = ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', '8ve'];
                    const intervalIndex = parseInt(inputElement.value) - 1;
                    paramConfigs[paramKey].spanElement.textContent = intervalNames[intervalIndex] || 'm2';
                }
            }
            updateParametersOnAudioThread();
            
            // Update oscilloscope frequency when pitch changes
            if (paramKey === 'frequency' && oscilloscope) {
                oscilloscope.setFrequency(parseFloat(inputElement.value));
            }
        });
    }
});

// --- Initial Page Setup ---
// Order is important for correct initialization before audio starts or UI is enabled.
initializeParamConfigs();      // 1. Create paramConfigs.
updateAllDisplayValues();      // 2. Update all UI display spans using the finalized paramConfigs.

// Reverb presets
const reverbPresets = {
    'dry': { mix: 0.1, size: 0.15, decay: 0.2, damping: 0.7, preDelay: 5, diffusion: 0.5, modulation: 0.1, earlyLevel: 0.8 },
    'chamber': { mix: 0.25, size: 0.4, decay: 0.4, damping: 0.5, preDelay: 10, diffusion: 0.7, modulation: 0.2, earlyLevel: 0.5 },
    'hall': { mix: 0.35, size: 0.7, decay: 0.6, damping: 0.4, preDelay: 25, diffusion: 0.8, modulation: 0.2, earlyLevel: 0.4 },
    'cathedral': { mix: 0.45, size: 0.9, decay: 0.8, damping: 0.3, preDelay: 40, diffusion: 0.9, modulation: 0.3, earlyLevel: 0.3 }
};

// Handle reverb preset changes
const reverbPresetSelect = document.getElementById('reverbPreset');
if (reverbPresetSelect) {
    reverbPresetSelect.addEventListener('change', () => {
        const presetName = reverbPresetSelect.value;
        if (presetName !== 'custom' && reverbPresets[presetName]) {
            const preset = reverbPresets[presetName];
            
            // Store the intended decay value
            if (window.reverbNode) {
                window.reverbNode.intendedDecay = preset.decay;
            }
            // Update all the hidden controls
            document.getElementById('roomSize').value = preset.size;
            document.getElementById('decay').value = Math.min(preset.decay, 0.90);
            document.getElementById('damping').value = preset.damping;
            document.getElementById('preDelay').value = preset.preDelay;
            document.getElementById('diffusion').value = preset.diffusion;
            document.getElementById('modulation').value = preset.modulation;
            document.getElementById('earlyLevel').value = preset.earlyLevel;
            
            // Update visible controls
            document.getElementById('reverbMix').value = preset.mix;
            document.getElementById('reverbSize').value = preset.size;
            document.getElementById('reverbDecay').value = preset.decay;
            
            // Update displays
            document.getElementById('reverbMixValue').textContent = preset.mix.toFixed(2);
            document.getElementById('reverbSizeValue').textContent = preset.size.toFixed(2);
            document.getElementById('reverbDecayValue').textContent = Math.min(preset.decay, 0.90).toFixed(2);
            
            // Apply to reverb node
            updateReverbParameters();
        }
    });
}

// Function to update all reverb parameters
function updateReverbParameters() {
    if (!window.reverbNode || !audioContext || audioContext.state !== 'running') return;
    
    const params = {
        'mix': document.getElementById('reverbMix').value,
        'roomSize': document.getElementById('roomSize').value,
        'decay': document.getElementById('decay').value,
        'damping': document.getElementById('damping').value,
        'preDelay': document.getElementById('preDelay').value,
        'diffusion': document.getElementById('diffusion').value,
        'modulation': document.getElementById('modulation').value,
        'earlyLevel': document.getElementById('earlyLevel').value
    };
    
    for (const [paramName, value] of Object.entries(params)) {
        const param = window.reverbNode.parameters.get(paramName);
        if (param) {
            // Use longer ramp time for roomSize to prevent glitches
            const rampTime = paramName === 'roomSize' ? 0.2 : 0.02;
            param.linearRampToValueAtTime(parseFloat(value), audioContext.currentTime + rampTime);
        }
    }
}

// Simplified reverb controls - Mix, Size, Decay
const simpleReverbControls = [
    { id: 'reverbMix', param: 'mix' },
    { id: 'reverbSize', param: 'roomSize' },
    { id: 'reverbDecay', param: 'decay' }
];

simpleReverbControls.forEach(({ id, param }) => {
    const control = document.getElementById(id);
    const display = document.getElementById(id + 'Value');
    
    if (control && display) {
        control.addEventListener('input', () => {
            // Update display
            const decimals = control.step.includes('.') ? control.step.split('.')[1].length : 0;
            display.textContent = parseFloat(control.value).toFixed(decimals);
            
            // Update the corresponding hidden control
            if (param === 'roomSize') {
                document.getElementById('roomSize').value = control.value;
            } else if (param === 'decay') {
                // The visible 'reverbDecay' slider is now capped at 0.90 in HTML.
                // The hidden 'decay' slider (which maps to the AudioParam)
                // should reflect this, scaled by our 0.98 factor for internal safety.
                // The AudioParam itself will also be capped at 0.90 by its descriptor.
                const cappedDecay = Math.min(parseFloat(control.value), 0.90);
                document.getElementById('decay').value = cappedDecay * 0.98; 

                // Store user's intended decay value (capped at 0.90)
                if (window.reverbNode) {
                    window.reverbNode.intendedDecay = cappedDecay;
                }
            }
            
            // Set preset to custom
            if (reverbPresetSelect) {
                reverbPresetSelect.value = 'custom';
            }
            
            // Update reverb parameters
            updateReverbParameters();
        });
    }
});



if (bowingToggleButton) bowingToggleButton.disabled = true;
allParamInputs.forEach(input => { if(input) input.disabled = true; });