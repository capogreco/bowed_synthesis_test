# Bowed String Synthesis - Web Audio Experiment

This project is an experiment in creating a bowed string synthesizer using the Web Audio API, specifically `AudioContext` and `AudioWorkletProcessor`. We are incrementally building up a physical model to explore different synthesis techniques.

## Current Status (as of end of session 2024-05-04 - AudioParam Refactor)
<!-- Please update date as needed -->

The synthesizer currently implements the following:

**Core Engine (`basic-processor.js` - an `AudioWorkletProcessor`):**

1.  **Feedback Loop (Karplus-Strong Inspired):**
    *   A delay line (`this.delayLine`) whose length is determined by a main "String Freq (Hz)" parameter.
    *   A "Loop Gain" parameter controlling the overall feedback gain.

2.  **Hybrid Excitation Source (mixed into the feedback loop when `isBowing` is true):**
    *   **Sawtooth Wave:** Locked to the main string frequency.
    *   **Pulse Wave:** Also locked to the main string frequency, with controllable "Pulse Width". The pulse wave is inverted before mixing.
    *   **Noise:** White noise `(Math.random() * 2 - 1)`.
    *   **Mixing Scheme for Excitation:**
        1.  "Pulse/Saw Mix" (`sawPulseMixParam`): Blends the (inverted) pulse and saw waves (0=Pulse, 1=Saw).
        2.  "Noise/Tone Mix" (`toneNoiseMixParam`): Blends the combined Pulse/Saw tone with noise (0=Noise, 1=Tone).
        3.  "Excite Intensity" (`bowForce`): Scales this final mixed excitation signal before it's added into the feedback loop.

3.  **Filtering Stage (within the feedback loop):**
    *   **Main Low-Pass Filter (LPF):**
        *   A biquad resonant LPF.
        *   "LPF Cutoff" (`cutoffParam`): UI slider (0-1) maps logarithmically to frequency.
        *   "LPF Reso" (`resonanceParam`): UI slider (0-1) maps via a power curve (cubed) to Q (actual Q max ~2.5).
    *   **Modal Body Resonator (3 modes):**
        *   Three biquad Band-Pass Filters operating in parallel, simulating prominent body modes.
        *   Default Mode Parameters (Base Frequencies before UI control, Q, Gain):
            *   Mode 1: Base C#4 (~277 Hz), Base Q=10, Relative Gain=0.8
            *   Mode 2: Base A#4 (~466 Hz), Base Q=15, Relative Gain=1.0
            *   Mode 3: Base C#5 (~554 Hz), Base Q=12, Relative Gain=0.9
        *   UI Controls for Modal Body:
            *   **Mode 1/2/3 Freq Select:** Three dropdown menus, each allowing selection of the center frequency for one mode from a 12-note (1-octave) 12-TET range. The ranges are centered around the base frequencies listed above.
            *   **Body Mode Q:** A slider that globally scales the Q values of all three modes (0.25x to 4.0x of their base Qs).
        *   Relative gains for each mode are currently fixed.
        *   Coefficient Type: BPFs are designed for a peak gain of 1 (0dB) at their center frequency, then scaled by the mode's specific "Relative Gain". Q controls bandwidth.
        *   Summing & Mixing: Outputs of the three modal BPFs are summed (not averaged). This sum is then mixed with the LPF output via the "Body Reso Mix" UI slider (`bpfBankMixLevelParam` 0-1).
    *   The combined LPF + Modal Body signal is then processed by `loopGain` and has excitation added.

4.  **Parameter Management via `AudioParam`:**
    *   Most UI-controlled synthesis parameters (e.g., LPF settings, modal body Q/frequencies, mix levels, excitation parameters) are now managed using `AudioParam`s defined in `basic-processor.js`.
    *   `main.js` updates these `AudioParam`s directly, primarily using `linearRampToValueAtTime()` for sliders to ensure smooth transitions and reduce audible glitches. Modal frequency dropdowns use `setValueAtTime()`.
    *   The main string `frequency` (affecting delay line length) and bowing state are still handled via `messagePort` due to the structural changes they incur.
    *   `basic-processor.js` reads the `AudioParam` values in its `process()` method, caches them, and recalculates filter coefficients when they change.

**User Interface (`index.html` & `main.js`):**

*   Sliders and dropdowns for key synthesis parameters with real-time numeric value display. Slider-based changes are now significantly smoother due to `AudioParam` ramping.
    *   Modal body frequencies are controlled by three independent dropdown selectors.
    *   A "Body Mode Q" slider globally scales the Q of the modal body resonators.
*   "Start Audio" / "Suspend Audio" button.
*   "Start Bowing" / "Stop Bowing" button.

**Development Server (`serve.ts`):**
*   A Deno script to serve the `app` directory.
*   Tasks defined in `deno.json` (`deno task start`, `deno task dev`).

**Project Structure:**
*   Snapshots of previous working iterations are stored in the `experiments/` directory.
*   Version controlled with Git, pushed to GitHub.

## Known Issues / Quirks:

*   **Parameter Change Glitches:** Audible glitches when changing parameters have been significantly reduced for sliders by migrating to `AudioParam`s with `linearRampToValueAtTime()`.
    *   Changes to modal frequencies via dropdowns (using `setValueAtTime()`) are still abrupt but generally acceptable for discrete note changes.
    *   The main string "Frequency" slider still causes an abrupt sound change and re-initialization, as it's not yet an `AudioParam` (due to delay line resizing requirements). True per-sample coefficient smoothing within the processor could further refine this for all parameters.
*   **Modal Gains Fixed:** The relative gains for each of the three body modes are currently hardcoded in `basic-processor.js`.
*   Interactions between `loopGain` and the modal body resonator (especially with its current gains and Q range) can still lead to strong resonances, requiring careful adjustment of the "Body Reso Mix" and `loopGain`.

## Potential Next Steps for Tomorrow/Future:

1.  **Main String Frequency Portamento:** Re-architect the delay line in `basic-processor.js` (e.g., using fractional delays) to allow the main string `frequency` to be controlled smoothly by an `AudioParam`, enabling portamento. This would address the remaining major source of abrupt sound change on parameter update.
2.  **Enhance Modal Body Resonator:**
    *   Consider UI controls for individual mode gains.
    *   Investigate adding more modes to the body resonator.
    *   Explore dynamic modulation of modal parameters based on performance gestures.
3.  **Dynamic \"Gestural\" Control:**
    *   Link "Excite Intensity" (`dspValues.exciteIntensity`) to modulate "LPF Cutoff" (`dspValues.lpfCutoff`) slightly (brighter with more intensity).
    *   Explore other simple parameter intermodulations.
4.  **Refine Excitation:**
    *   Consider if the current 2-stage mixing for Saw/Pulse then with Noise is optimal, or if a 3-way direct mix (or other scheme) would be more intuitive or sonically versatile.
5.  **Dynamics (Attack/Release):** Implement simple envelopes for the "bowing" action.
6.  **Stability/Gain Staging Review:** As complexity grows, ensure the signal path is well-behaved. Consider if a master volume control directly in the AudioWorklet is needed.

Looking forward to continuing!