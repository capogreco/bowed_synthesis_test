// main.js
let audioContext;
let workletNode;
let isAudioInitialized = false;
let isBowingActive = false; // To track the state for the UI button

const audioToggleButton = document.getElementById('audioToggle');
const bowingToggleButton = document.getElementById('bowingToggle');
const frequencyInput = document.getElementById('frequency');
const dampingInput = document.getElementById('damping');
const bowForceInput = document.getElementById('bowForce');

// Default initial parameters - these will be overridden by input values on init
let currentFrequency = 220;
let currentDamping = 0.995;
let currentBowForce = 0.02;

function updateParametersInWorklet() {
    if (!workletNode || !audioContext || !isAudioInitialized) {
        // console.warn('[UpdateParams] Worklet not ready or audio not initialized.');
        return;
    }
    
    const newFrequency = parseFloat(frequencyInput.value);
    const newDamping = parseFloat(dampingInput.value);
    const newBowForce = parseFloat(bowForceInput.value);

    // Basic validation
    if (isNaN(newFrequency) || newFrequency <= 0 ||
        isNaN(newDamping) || newDamping < 0.8 || newDamping >= 1 || // Damping should be within reasonable bounds
        isNaN(newBowForce) || newBowForce < 0) {
        console.error(`[Main] Invalid parameter values detected. F:${newFrequency}, D:${newDamping}, BF:${newBowForce}`);
        return;
    }
    
    currentFrequency = newFrequency;
    currentDamping = newDamping;
    currentBowForce = newBowForce;

    // Only send if audio context is running, otherwise parameters are set at init or when bowing starts
    if (audioContext.state === 'running') {
        workletNode.port.postMessage({
            type: 'setParameter',
            frequency: currentFrequency,
            damping: currentDamping,
            bowForce: currentBowForce
        });
        // console.log(`[Main] Sent setParameter. Freq: ${currentFrequency.toFixed(2)}, Damp: ${currentDamping.toFixed(3)}, Force: ${currentBowForce.toFixed(3)}`);
    }
}


async function initializeAudio() {
    if (isAudioInitialized) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Main] AudioContext created.');

        // Get initial values from HTML inputs
        currentFrequency = parseFloat(frequencyInput.value);
        currentDamping = parseFloat(dampingInput.value);
        currentBowForce = parseFloat(bowForceInput.value);

        await audioContext.audioWorklet.addModule('basic-processor.js'); // File name
        console.log('[Main] AudioWorklet module loaded.');

        workletNode = new AudioWorkletNode(audioContext, 'continuous-excitation-processor', { // Registered processor name
            processorOptions: {
                frequency: currentFrequency,
                damping: currentDamping,
                bowForce: currentBowForce
            }
        });
        console.log(`[Main] AudioWorkletNode 'continuous-excitation-processor' created. Initial Freq: ${currentFrequency.toFixed(2)}, Damp: ${currentDamping.toFixed(3)}, Force: ${currentBowForce.toFixed(3)}`);

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
    }
}

audioToggleButton.addEventListener('click', async () => {
    if (!audioContext) { // First click: initialize audio
        await initializeAudio();
    }

    // After initialization (or if already initialized), toggle state
    if (audioContext && audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('[Main] AudioContext resumed.');
            audioToggleButton.textContent = 'Suspend Audio';
            // If bowing was active, ensure worklet knows parameters might need re-evaluation or bowing restarts
            if (isBowingActive) {
                updateParametersInWorklet(); // Send current params
                workletNode.port.postMessage({ type: 'setBowing', isBowing: true });
            }
        } catch (e) { console.error('[Main] Error resuming AudioContext:', e); }
    } else if (audioContext && audioContext.state === 'running') {
        try {
            await audioContext.suspend();
            console.log('[Main] AudioContext suspended.');
            audioToggleButton.textContent = 'Resume Audio';
            // If bowing, tell worklet to stop actual sound generation during suspend
            if (isBowingActive && workletNode) {
                 workletNode.port.postMessage({ type: 'setBowing', isBowing: false });
            }
        } catch (e) { console.error('[Main] Error suspending AudioContext:', e); }
    }
});

bowingToggleButton.addEventListener('click', () => {
    if (!workletNode || !audioContext) {
        console.warn('[Main - BowingToggle] Audio not initialized or workletNode not ready.');
        // Attempt to initialize and start audio if it hasn't been
        if (!isAudioInitialized) {
            audioToggleButton.click(); // Trigger initialization and resume
            console.log('[Main - BowingToggle] Attempted to initialize audio. Try toggling bowing again if no sound initially.');
        } else if (audioContext.state !== 'running') {
            console.warn('[Main - BowingToggle] AudioContext is not running. Attempting to resume.');
            audioToggleButton.click(); // Attempt to resume
        }
        return;
    }
    
    // Ensure audio context is running before sending a message
    if (audioContext.state !== 'running') {
        console.warn('[Main - BowingToggle] AudioContext is not in a running state. Please resume audio first.');
        // Optionally, try to resume it and inform the user
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[Main - BowingToggle] AudioContext resumed. You can now toggle bowing.');
                audioToggleButton.textContent = 'Suspend Audio';
            }).catch(e => console.error('[Main - BowingToggle] Failed to resume context automatically:', e));
        }
        return;
    }

    isBowingActive = !isBowingActive;
    updateParametersInWorklet(); // Ensure parameters are up-to-date before starting/stopping bow
    
    workletNode.port.postMessage({
        type: 'setBowing',
        isBowing: isBowingActive
    });

    bowingToggleButton.textContent = isBowingActive ? 'Stop Bowing' : 'Start Bowing';
    console.log(`[Main] Sent setBowing: ${isBowingActive}`);
});

// Event listeners for parameter changes
frequencyInput.addEventListener('change', updateParametersInWorklet);
dampingInput.addEventListener('change', updateParametersInWorklet);
bowForceInput.addEventListener('change', updateParametersInWorklet);

// Disable bowing button initially
bowingToggleButton.disabled = true;