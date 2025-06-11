// main.js
let audioContext;
let workletNode;
let isAudioInitialized = false;

const audioToggleButton = document.getElementById('audioToggle');
const pluckButton = document.getElementById('pluckButton');
const frequencyInput = document.getElementById('frequency');
const dampingInput = document.getElementById('damping');

// Default initial parameters
let currentFrequency = 220; 
let currentDamping = 0.996;

async function initializeAudio() {
    if (isAudioInitialized) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('AudioContext created.');

        // Update with values from input fields before initializing
        currentFrequency = parseFloat(frequencyInput.value);
        currentDamping = parseFloat(dampingInput.value);

        // The file is still named basic-processor.js, but it contains KarplusStrongProcessor
        await audioContext.audioWorklet.addModule('basic-processor.js'); 
        console.log('AudioWorklet module loaded.');

        workletNode = new AudioWorkletNode(audioContext, 'karplus-strong-processor', {
            processorOptions: {
                frequency: currentFrequency,
                damping: currentDamping
            }
        });
        console.log(`[Main] AudioWorkletNode 'karplus-strong-processor' created with Freq: ${currentFrequency.toFixed(2)}, Damp: ${currentDamping.toFixed(3)}`);

        workletNode.connect(audioContext.destination);
        console.log('AudioWorkletNode connected to destination.');
        
        isAudioInitialized = true;
        audioToggleButton.textContent = 'Audio Initialized (Suspended)';
        pluckButton.disabled = false; // Enable pluck button after init

    } catch (e) {
        console.error('Error initializing audio:', e);
        audioToggleButton.textContent = 'Audio Init Failed';
        audioToggleButton.disabled = true;
        pluckButton.disabled = true;
    }
}

audioToggleButton.addEventListener('click', async () => {
    if (!audioContext) { // First click: initialize audio
        await initializeAudio();
        // If initialization was successful and context is suspended, try to resume
        if (audioContext && audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log('AudioContext resumed.');
                audioToggleButton.textContent = 'Suspend Audio';
            } catch (e) {
                console.error('Error resuming AudioContext:', e);
            }
        }
    } else { // Subsequent clicks: toggle suspend/resume
        if (audioContext.state === 'running') {
            try {
                await audioContext.suspend();
                console.log('AudioContext suspended.');
                audioToggleButton.textContent = 'Resume Audio';
            } catch (e) {
                console.error('Error suspending AudioContext:', e);
            }
        } else if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log('AudioContext resumed.');
                audioToggleButton.textContent = 'Suspend Audio';
            } catch (e) {
                console.error('Error resuming AudioContext:', e);
            }
        }
    }
});

pluckButton.addEventListener('click', () => {
    if (!workletNode || !audioContext) {
        console.warn('[PluckButton] Audio not initialized or workletNode not ready.');
        if (!isAudioInitialized) {
            // Attempt to initialize and start audio if it hasn't been
            audioToggleButton.click(); 
            console.log('[PluckButton] Attempted to initialize audio. Try plucking again if no sound initially.');
        } else if (audioContext.state !== 'running') {
             // If initialized but not running (e.g. suspended)
            console.warn('[PluckButton] AudioContext is not running. Attempting to resume.');
            audioToggleButton.click(); 
        }
        return; 
    }

    // Ensure audio context is running before sending a message
    if (audioContext.state !== 'running') {
        console.warn('[PluckButton] AudioContext is not in a running state. Please resume audio.');
        // Attempt to resume if suspended
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[PluckButton] AudioContext resumed. Please click pluck again.');
                audioToggleButton.textContent = 'Suspend Audio';
            }).catch(e => console.error('[PluckButton] Failed to resume context for pluck:', e));
        }
        return; 
    }

    currentFrequency = parseFloat(frequencyInput.value);
    currentDamping = parseFloat(dampingInput.value);

    if (isNaN(currentFrequency) || currentFrequency <=0 || isNaN(currentDamping) || currentDamping <= 0 || currentDamping >=1) {
        console.error(`[PluckButton] Invalid frequency (${currentFrequency}) or damping (${currentDamping}) value. Damping must be > 0 and < 1.`);
        return;
    }

    workletNode.port.postMessage({
        type: 'pluck',
        frequency: currentFrequency,
        damping: currentDamping
    });
    console.log(`[Main] Sent pluck message. Freq: ${currentFrequency.toFixed(2)}, Damp: ${currentDamping.toFixed(3)}`);
});

// Disable pluck button initially until audio is initialized and running
pluckButton.disabled = true;

// Optional: Add event listeners to input fields if you want to update
// parameters in real-time without plucking, though Karplus-Strong
// usually requires a re-pluck to change fundamental frequency effectively.
// Damping could potentially be adjusted live for a different effect.

// frequencyInput.addEventListener('input', () => {
// if (workletNode && audioContext && audioContext.state === 'running') {
// // Example: send a different type of message for live update if your worklet supports it
// // workletNode.port.postMessage({ type: 'setFrequency', value: parseFloat(frequencyInput.value) });
// }
// });

// dampingInput.addEventListener('input', () => {
// if (workletNode && audioContext && audioContext.state === 'running') {
// // workletNode.port.postMessage({ type: 'setDamping', value: parseFloat(dampingInput.value) });
// }
// });