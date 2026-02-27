/**
 * Pattern System for Lampshade Walls
 *
 * Each pattern function returns a wall thickness multiplier [0..1]
 * at a given (u, v) coordinate where:
 *   u = circumferential position [0..1]
 *   v = vertical position [0..1]
 *
 * 0 = fully cut through (no material)
 * 1 = full wall thickness
 * Values in between = partial thickness
 */
const Patterns = (() => {

    /**
     * Solid — no pattern.
     */
    function none() {
        return 1.0;
    }

    /**
     * Diamond lattice pattern.
     */
    function diamonds(u, v, scale, depth) {
        const su = u * scale;
        const sv = v * scale;
        const dx = Math.abs((su % 1) - 0.5) * 2; // 0..1 saw
        const dy = Math.abs((sv % 1) - 0.5) * 2;
        const diamond = dx + dy; // 0..2, diamond distance
        const threshold = 0.7;
        if (diamond < threshold) {
            return 1.0 - depth; // cutout region
        }
        return 1.0;
    }

    /**
     * Hexagonal pattern using hex grid distance.
     */
    function hexagons(u, v, scale, depth) {
        const su = u * scale;
        const sv = v * scale * 0.866; // hex aspect ratio

        // Offset every other row
        const row = Math.floor(sv);
        const col = su + (row % 2 === 0 ? 0 : 0.5);

        const cx = (col % 1) - 0.5;
        const cy = (sv % 1) - 0.5;

        const dist = Math.sqrt(cx * cx + cy * cy);
        const threshold = 0.35;
        if (dist < threshold) {
            return 1.0 - depth;
        }
        return 1.0;
    }

    /**
     * Spiral pattern.
     */
    function spirals(u, v, scale, depth) {
        const spiralCount = Math.max(1, Math.floor(scale / 3));
        const angle = u * Math.PI * 2 * spiralCount;
        const phase = v * scale * 0.5;
        const val = Math.sin(angle + phase);
        if (val > 0.3) {
            return 1.0;
        }
        return 1.0 - depth;
    }

    /**
     * Sine waves pattern — horizontal waves.
     */
    function waves(u, v, scale, depth) {
        const waveVal = Math.sin(u * Math.PI * 2 * scale) * 0.5 + 0.5;
        const stripe = Math.sin(v * Math.PI * 2 * scale * 2) * 0.5 + 0.5;
        const combined = waveVal * 0.5 + stripe * 0.5;
        if (combined > 0.55) {
            return 1.0;
        }
        return 1.0 - depth;
    }

    /**
     * Voronoi-like pattern using random cell centres.
     * Deterministic via seeded simple hash.
     */
    function voronoi(u, v, scale, depth) {
        const su = u * scale;
        const sv = v * scale;
        const cellX = Math.floor(su);
        const cellY = Math.floor(sv);

        let minDist = 999;
        let secondDist = 999;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = cellX + dx;
                const ny = cellY + dy;
                // Simple hash for deterministic pseudo-random
                const h = hash2d(nx, ny);
                const px = nx + h.x;
                const py = ny + h.y;
                const d = Math.sqrt((su - px) ** 2 + (sv - py) ** 2);
                if (d < minDist) {
                    secondDist = minDist;
                    minDist = d;
                } else if (d < secondDist) {
                    secondDist = d;
                }
            }
        }

        // Edge detection — thinner wall near cell edges
        const edge = secondDist - minDist;
        if (edge < 0.12) {
            return 1.0; // cell wall (full thickness)
        }
        return 1.0 - depth; // interior (thin/open)
    }

    function hash2d(x, y) {
        // Deterministic pseudo-random based on cell coordinates
        let h = x * 374761393 + y * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        h = h ^ (h >> 16);
        return {
            x: ((h & 0xFFFF) / 0xFFFF) * 0.8 + 0.1,
            y: (((h >> 16) & 0xFFFF) / 0xFFFF) * 0.8 + 0.1
        };
    }

    const patternMap = { none, diamonds, hexagons, spirals, waves, voronoi };

    /**
     * Get wall thickness multiplier at (u, v).
     * @param {string} type — pattern name
     * @param {number} u — circumferential 0..1
     * @param {number} v — vertical 0..1
     * @param {number} scale — pattern scale
     * @param {number} depthPct — depth percentage 0..100
     * @returns {number} multiplier 0..1
     */
    function sample(type, u, v, scale, depthPct) {
        const fn = patternMap[type] || none;
        if (type === 'none') return 1.0;
        const depth = Math.min(1, Math.max(0, depthPct / 100));
        return fn(u, v, scale, depth);
    }

    return { sample, patternMap };
})();
