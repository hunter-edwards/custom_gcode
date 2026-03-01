/**
 * Wave Function Library
 * Inspired by FullControl's wave generators.
 *
 * All wave functions follow the same signature:
 *   wave(t, amplitude, frequency, phase) → value in [-amplitude, +amplitude]
 *
 * t        — input position (angle in radians, or normalized 0-1 depending on use)
 * amplitude — peak deviation
 * frequency — how many cycles (multiplied against t)
 * phase    — offset in radians
 */
const Waves = (() => {

    const TAU = Math.PI * 2;

    /**
     * Sine wave — smooth sinusoidal oscillation.
     */
    function sine(t, amplitude = 1, frequency = 1, phase = 0) {
        return amplitude * Math.sin(t * frequency + phase);
    }

    /**
     * Cosine wave — sine shifted by π/2.
     */
    function cosine(t, amplitude = 1, frequency = 1, phase = 0) {
        return amplitude * Math.cos(t * frequency + phase);
    }

    /**
     * Triangle wave — linear ramps, symmetric.
     */
    function triangle(t, amplitude = 1, frequency = 1, phase = 0) {
        const x = (t * frequency + phase) / TAU;
        const frac = x - Math.floor(x); // 0..1
        const tri = 4 * Math.abs(frac - 0.5) - 1; // -1..1
        return amplitude * tri;
    }

    /**
     * Square wave — alternating +amplitude / -amplitude.
     * @param {number} dutyCycle — fraction of period that is "high" (0-1, default 0.5)
     */
    function square(t, amplitude = 1, frequency = 1, phase = 0, dutyCycle = 0.5) {
        const x = (t * frequency + phase) / TAU;
        const frac = x - Math.floor(x); // 0..1
        return amplitude * (frac < dutyCycle ? 1 : -1);
    }

    /**
     * Sawtooth wave — linear ramp from -amplitude to +amplitude.
     */
    function sawtooth(t, amplitude = 1, frequency = 1, phase = 0) {
        const x = (t * frequency + phase) / TAU;
        const frac = x - Math.floor(x); // 0..1
        return amplitude * (2 * frac - 1);
    }

    /**
     * Star wave — sharpened sine for star-tip profiles.
     * sharpness controls pointiness: 1 = sine, higher = sharper peaks.
     */
    function star(t, amplitude = 1, frequency = 1, phase = 0, sharpness = 2) {
        const raw = Math.sin(t * frequency + phase);
        // Apply power sharpening while preserving sign
        const sign = raw >= 0 ? 1 : -1;
        const shaped = Math.pow(Math.abs(raw), 1 / sharpness) * sign;
        return amplitude * shaped;
    }

    /**
     * Petal wave — absolute-value sine, creates rounded lobes (like flower petals).
     * Always non-negative: range is [0, amplitude].
     */
    function petal(t, amplitude = 1, frequency = 1, phase = 0) {
        return amplitude * Math.abs(Math.sin(t * frequency * 0.5 + phase));
    }

    /**
     * Compose multiple waves additively.
     * @param {number} t
     * @param {Array<{type: string, amplitude: number, frequency: number, phase: number}>} layers
     * @returns {number}
     */
    function compose(t, layers) {
        const waveFns = { sine, cosine, triangle, square, sawtooth, star, petal };
        let sum = 0;
        for (const layer of layers) {
            const fn = waveFns[layer.type] || sine;
            sum += fn(t, layer.amplitude || 1, layer.frequency || 1, layer.phase || 0, layer.extra);
        }
        return sum;
    }

    /**
     * Get a wave function by name.
     */
    function getWaveFn(name) {
        const map = { sine, cosine, triangle, square, sawtooth, star, petal };
        return map[name] || sine;
    }

    /**
     * Envelope functions — modulate amplitude based on normalized height t ∈ [0,1].
     */
    const envelopes = {
        /** Constant — no variation. */
        constant(t) { return 1; },

        /** Bulge — peaks at middle height. */
        bulge(t) { return Math.sin(t * Math.PI); },

        /** Fade in — ramps from 0 at bottom to 1 at top. */
        fadeIn(t) { return t; },

        /** Fade out — ramps from 1 at bottom to 0 at top. */
        fadeOut(t) { return 1 - t; },

        /** Diamond — peaks at middle, zero at top and bottom. */
        diamond(t) { return 1 - Math.abs(2 * t - 1); },

        /** Gaussian — bell curve centred at middle. */
        gaussian(t) {
            const x = (t - 0.5) * 4; // map to -2..2
            return Math.exp(-x * x / 2);
        },
    };

    function getEnvelope(name) {
        return envelopes[name] || envelopes.constant;
    }

    return {
        sine, cosine, triangle, square, sawtooth, star, petal,
        compose, getWaveFn, envelopes, getEnvelope, TAU,
    };
})();
