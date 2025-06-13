# Bowed String Synthesis - Advanced Web Audio Experiment

This project is an experiment in creating a physically-inspired bowed string synthesizer using the Web Audio API, `AudioContext`, and `AudioWorkletProcessor`. It features a detailed modal synthesis engine, expressive performance controls, and an integrated FDN reverb.

## Current Status (May 2024)

The synthesizer now implements a comprehensive set of features for realistic and expressive bowed string performance:

**Core Synthesis Engine (`basic-processor.js` - an `AudioWorkletProcessor`):**

1.  **Modal String Model:**
    *   `NUM_STRING_MODES` (currently 32) biquad filter resonators simulating string modes.
    *   Harmonic series with adjustable inharmonicity based on "String Material".
    *   Frequency-dependent damping: Higher modes decay faster, also influenced by "String Damping" and "String Material".
    *   Mode amplitudes decrease with mode number, scaled by "String Material" brightness.
    *   Bow position (`bowPosition`) affects harmonic content by suppressing modes with nodes at the bowing point.

2.  **Continuous Bow Excitation Model:**
    *   Simulates bow-string interaction when "Start Bowing" is active.
    *   **Excitation Source:** A mix of a harmonically-rich sawtooth-like wave and filtered noise.
    *   **Physical Bow Parameters:**
        *   `bowForce`: Simulates bow pressure, affecting brightness and scratchiness.
        *   `bowPosition`: Simulates bowing point (sul ponticello to sul tasto), affecting timbre.
        *   `bowSpeed`: Simulates bow speed, affecting harmonic content and smoothness.
    *   **Dynamic Interaction:** These parameters interact to create a wide range of timbres, from soft and warm to aggressive and scratchy.
    *   Smooth attack/release envelope on bow start/stop.

3.  **String Material Simulation:**
    *   Dropdown for "String Material": Steel, Gut, Nylon, Wound.
    *   Affects inharmonicity, damping characteristics, and overall brightness/harmonic content of the string modes.

4.  **Master Low-Pass Filter (LPF):**
    *   A biquad resonant LPF shapes the overall tone.
    *   Controlled by a single "Brightness" slider.
    *   Internally, "Brightness" maps to LPF cutoff frequency.
    *   LPF Q is fixed at a musically useful value.
    *   Dynamically modulated by `bowForce` and `bowSpeed` for realistic tonal changes.

5.  **Modal Body Resonator:**
    *   Simulates the instrument body using 5 parallel biquad Band-Pass Filters.
    *   **"Body Type" Presets:** Violin, Viola, Cello, Guitar, None. Each preset loads distinct resonant frequencies, Q values, and gains for the 5 body modes.
    *   **"Body Resonance" Slider:** Controls the mix level of the body resonator signal with the direct string sound.

6.  **Expressivity Engine (Mutually Exclusive Modes):**
    *   Selected via a 4-way radio button: None, Vibrato, Trill, Tremolo.
    *   **Vibrato:**
        *   `vibratoRate`: Speed of vibrato (Hz).
        *   `vibratoDepth`: Intensity of vibrato.
        *   Modulates both pitch (±6%) and amplitude (±20%) with a fixed realistic blend.
    *   **Trill:**
        *   `trillInterval`: Interval above the base note (Minor 2nd to Octave).
        *   `trillSpeed`: Speed of alternation (Hz).
        *   `trillArticulation`: Duty cycle of the trill notes (staccato to legato).
        *   Simulates hammer-on/lift-off effects with amplitude and brightness changes.
        *   Gradual speed ramp-up/down when starting/stopping.
    *   **Tremolo:**
        *   `tremoloSpeed`: Speed of bow strokes (Hz).
        *   `tremoloDepth`: Intensity of the tremolo effect.
        *   `tremoloArticulation`: Duty cycle of strokes (staccato to legato).
        *   Models bow speed changes within each stroke (slows at turnarounds).
        *   Adds scratchiness and brightness variations at bow direction changes.
        *   Simulates increased bow pressure.

7.  **Master Output Stage:**
    *   "Master Volume" slider controlling overall output level (0x to 10x gain).
    *   Soft clipping (`tanh`) to prevent harsh digital distortion at high levels.

**Integrated FDN Reverb (`reverb-processor.js` - an `AudioWorkletProcessor`):**

1.  **12-Delay Line Feedback Delay Network (FDN):**
    *   Prime number based delay lengths for smooth diffusion.
    *   12x12 Hadamard-inspired orthogonal mixing matrix.
2.  **Input Diffusion:**
    *   4 cascaded allpass filters to smear transients.
3.  **Modulation:**
    *   LFO per delay line for subtle pitch variation, reducing metallic ringing.
4.  **Early Reflections Network:**
    *   10 discrete taps simulating early room reflections.
5.  **Per-Delay Damping:**
    *   Simple low-pass filters in each feedback loop.
6.  **DC Blocking:**
    *   High-pass filters at input and within feedback loops to prevent DC buildup.
7.  **Simplified UI Controls:**
    *   **"Space" Preset Selector:** Dry Studio, Chamber, Concert Hall, Cathedral, Custom.
    *   **"Mix" Slider:** Dry/Wet balance.
    *   **"Size" Slider:** Overall perceived room size (intelligently maps to `roomSize` and `earlyLevel`).
    *   **"Decay" Slider:** Reverb tail length (capped at 0.90 for stability).
    *   Advanced parameters (actual `roomSize`, `decay`, `damping`, `preDelay`, `diffusion`, `modulation`, `earlyLevel`) are set by presets or indirectly by simplified sliders, but are also present as hidden inputs for future "advanced" UI.

**User Interface (`index.html` & `main.js`):**

*   Clean, grouped layout with sliders and dropdowns for all key synthesis and reverb parameters.
*   Real-time numeric value display for sliders.
*   Expression mode selection via radio buttons.
*   "Start Audio" / "Suspend Audio" button.
*   "Start Bowing" / "Stop Bowing" button, which also visually changes state.
*   All parameters are managed via `AudioParam`s for smooth, sample-accurate changes.

**Development Server (`serve.ts`):**
*   A Deno script to serve the `app` directory.
*   Tasks defined in `deno.json`.

**Project Structure:**
*   Snapshots of previous iterations are stored in the `experiments/` directory.
*   Documentation on reverb and synthesis techniques in the `docs/` directory.

## Known Issues / Future Considerations:

*   **Main String Frequency Portamento:** The main string "Pitch (Hz)" slider still causes an abrupt sound change as it's not yet a smoothly ramped `AudioParam` (due to the complexity of dynamically resizing/interpolating the core modal resonators in real-time).
*   **Advanced Reverb Controls:** Currently, only simplified reverb controls are visible. An "Advanced" panel could expose all underlying FDN parameters.
*   **Visualization:** No real-time audio visualization yet (waveform, spectrum).
*   **Asymmetric Vibrato:** Flagged as a TODO for more nuanced vibrato waveshaping.

This project showcases a powerful and expressive bowed string synthesizer built entirely within the Web Audio API, demonstrating the capabilities of `AudioWorklet` for complex DSP.