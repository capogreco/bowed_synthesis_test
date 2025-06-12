# Bowed String Synthesis - Web Audio Experiment

This project is an experiment in creating a bowed string synthesizer using the Web Audio API, specifically `AudioContext` and `AudioWorkletProcessor`. We are incrementally building up a physical model to explore different synthesis techniques.

## Current Status (as of end of session 2024-05-04)
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
        *   Mode Parameters (Frequency, Q, Gain):
            *   Mode 1 (A0 "Air"): ~280 Hz, Q=10, Relative Gain=0.8
            *   Mode 2 (B1- "Wood"): ~460 Hz, Q=15, Relative Gain=1.0
            *   Mode 3 (B1+ "Wood"): ~550 Hz, Q=12, Relative Gain=0.9
        *   These modal parameters are currently fixed in `basic-processor.js`.
        *   Coefficient Type: BPFs are designed for a peak gain of 1 (0dB) at their center frequency, then scaled by the mode's specific "Relative Gain". Q controls bandwidth.
        *   Summing & Mixing: Outputs of the three modal BPFs are summed (not averaged). This sum is then mixed with the LPF output via the "Body Reso Mix" UI slider (`bpfBankMixLevelParam` 0-1).
    *   The combined LPF + Modal Body signal is then processed by `loopGain` and has excitation added.

4.  **Parameter Management Refactor:**
    *   HTML sliders (`index.html`) use `data-dsp-min`, `data-dsp-max`, and `data-dsp-decimals` attributes to define their mapping to DSP values and display precision.
    *   `main.js` reads these attributes to configure parameters, manage display, and pass mapping information and raw slider values to the worklet.
    *   `basic-processor.js` receives raw UI slider values and mapping info (if applicable), and uses a helper (`_getDspValue`) to get the final DSP values. Internal DSP parameter values are stored in `this.dspValues`.

**User Interface (`index.html` & `main.js`):**

*   Sliders for key synthesis parameters with real-time numeric value display. (Note: The "Body Resos Q" slider has been removed as modal Q values are currently fixed).
*   "Start Audio" / "Suspend Audio" button.
*   "Start Bowing" / "Stop Bowing" button.

**Development Server (`serve.ts`):**
*   A Deno script to serve the `app` directory.
*   Tasks defined in `deno.json` (`deno task start`, `deno task dev`).

**Project Structure:**
*   Snapshots of previous working iterations are stored in the `experiments/` directory.
*   Version controlled with Git, pushed to GitHub.

## Known Issues / Quirks:

*   **Modal Parameters Fixed:** The frequencies, Q values, and gains for the modal body resonator are currently hardcoded in `basic-processor.js`.
*   Interactions between `loopGain` and the new modal body resonator (especially with its fixed gains) can still lead to strong resonances, requiring careful adjustment of the "Body Reso Mix" and `loopGain`.

## Potential Next Steps for Tomorrow/Future:

1.  **Enhance Modal Body Resonator:**
    *   Expose UI controls for modal body parameters (e.g., global Q scale, individual mode tuning/gain, or a "body size" meta-parameter).
    *   Investigate adding more modes to the body resonator for increased realism.
    *   Explore dynamic modulation of modal parameters.
2.  **Dynamic "Gestural" Control:**
    *   Link "Excite Intensity" (`dspValues.exciteIntensity`) to modulate "LPF Cutoff" (`dspValues.lpfCutoff`) slightly (brighter with more intensity).
    *   Explore other simple parameter intermodulations.
4.  **Refine Excitation:**
    *   Consider if the current 2-stage mixing for Saw/Pulse then with Noise is optimal, or if a 3-way direct mix (or other scheme) would be more intuitive or sonically versatile.
5.  **Dynamics (Attack/Release):** Implement simple envelopes for the "bowing" action.
6.  **Stability/Gain Staging Review:** As complexity grows, ensure the signal path is well-behaved. Consider if a master volume control directly in the AudioWorklet is needed.

Looking forward to continuing!