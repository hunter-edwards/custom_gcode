/**
 * Lampshade Geometry Generator
 * Generates 3D point data for parametric lampshade shapes.
 */
const LampshadeGeometry = (() => {

    /**
     * Profile functions: map normalized height t ∈ [0,1] to a radius multiplier.
     * bottomR and topR are the bottom/top radii.
     */
    const profiles = {
        cylinder(t, bottomR, topR) {
            return bottomR + (topR - bottomR) * t;
        },
        cone(t, bottomR, topR) {
            return bottomR + (topR - bottomR) * t;
        },
        bulge(t, bottomR, topR) {
            const base = bottomR + (topR - bottomR) * t;
            const bulge = Math.sin(t * Math.PI) * 0.3 * (bottomR + topR) / 2;
            return base + bulge;
        },
        hourglass(t, bottomR, topR) {
            const base = bottomR + (topR - bottomR) * t;
            const pinch = -Math.sin(t * Math.PI) * 0.25 * (bottomR + topR) / 2;
            return Math.max(base + pinch, 5);
        },
        trumpet(t, bottomR, topR) {
            const curved = t * t;
            return bottomR + (topR - bottomR) * curved;
        },
        wave(t, bottomR, topR) {
            const base = bottomR + (topR - bottomR) * t;
            const wave = Math.sin(t * Math.PI * 3) * 0.1 * (bottomR + topR) / 2;
            return base + wave;
        }
    };

    /**
     * Generate the ring data for the lampshade.
     * Returns an array of rings, each ring is an array of {x, y, z} points.
     *
     * @param {Object} params
     * @returns {{ rings: Array, layerCount: number, totalHeight: number }}
     */
    function generate(params) {
        const {
            profile = 'wave',
            bottomDiameter = 100,
            topDiameter = 120,
            height = 100,
            sides = 64,
            layerHeight = 0.16,
            // Non-planar Z waves
            waveAmplitude = 1.5,
            waveFrequency = 6,
            verticalWaves = 3,
            // Ripple texture — radial surface modulation
            rippleEnabled = false,
            rippleWaveType = 'sine',
            rippleAmplitude = 5,
            rippleFrequency = 6,
            rippleTwist = 0,
            rippleEnvelope = 'constant',
            rippleSecondaryAmp = 0,
            rippleSecondaryFreq = 3,
        } = params;

        const bottomR = bottomDiameter / 2;
        const topR = topDiameter / 2;
        const profileFn = profiles[profile] || profiles.cylinder;
        const layerCount = Math.ceil(height / layerHeight);
        const rings = [];

        // Resolve wave and envelope functions from the Waves library
        const rippleWaveFn = (typeof Waves !== 'undefined') ? Waves.getWaveFn(rippleWaveType) : Math.sin;
        const envelopeFn = (typeof Waves !== 'undefined') ? Waves.getEnvelope(rippleEnvelope) : () => 1;
        const TAU = Math.PI * 2;

        // Twist: total angular rotation (degrees → radians) over full height
        const twistRad = (rippleTwist / 360) * TAU;

        for (let layer = 0; layer <= layerCount; layer++) {
            const t = layer / layerCount;
            const z = t * height;
            const baseRadius = profileFn(t, bottomR, topR);
            const ring = [];

            // Ripple envelope at this height
            const envAmp = envelopeFn(t);
            // Progressive twist offset at this height
            const twistOffset = t * twistRad;

            for (let s = 0; s < sides; s++) {
                const angle = (s / sides) * TAU;

                // === Non-planar Z offset ===
                let zOffset = 0;
                if (waveAmplitude > 0) {
                    zOffset = waveAmplitude * Math.sin(angle * waveFrequency + t * verticalWaves * TAU);
                }

                // === Radius variation from existing vertical waves ===
                let rOffset = 0;
                if (verticalWaves > 0 && waveAmplitude > 0) {
                    rOffset = (waveAmplitude * 0.3) * Math.cos(angle * waveFrequency * 0.5 + t * verticalWaves * Math.PI);
                }

                // === Ripple texture — radial modulation ===
                let rippleOffset = 0;
                if (rippleEnabled && rippleAmplitude > 0) {
                    // Primary ripple: wave function around circumference with twist
                    const rippleAngle = angle + twistOffset;
                    rippleOffset = rippleWaveFn(
                        rippleAngle, rippleAmplitude, rippleFrequency, 0,
                        rippleWaveType === 'star' ? 2 : 0.5
                    ) * envAmp;

                    // Secondary harmonic: adds complexity / "scalloped" details
                    if (rippleSecondaryAmp > 0) {
                        const secWave = Waves.sine(
                            rippleAngle, rippleSecondaryAmp, rippleSecondaryFreq, Math.PI / 4
                        );
                        rippleOffset += secWave * envAmp;
                    }
                }

                const r = baseRadius + rOffset + rippleOffset;
                ring.push({
                    x: r * Math.cos(angle),
                    y: r * Math.sin(angle),
                    z: z + zOffset,
                    radius: r,
                    angle: angle,
                    layer: layer,
                    t: t
                });
            }

            rings.push(ring);
        }

        return { rings, layerCount, totalHeight: height };
    }

    /**
     * Build a Three.js mesh from the ring data.
     */
    function buildMesh(rings, params) {
        const { patternType = 'none', patternScale = 10, patternDepth = 50 } = params;

        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        const sides = rings[0].length;
        const layers = rings.length;

        // Build vertex data
        for (let l = 0; l < layers; l++) {
            for (let s = 0; s < sides; s++) {
                const p = rings[l][s];
                vertices.push(p.x, p.z, p.y); // swap Y/Z for Three.js

                // Compute normal (pointing outward)
                const len = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
                normals.push(p.x / len, 0, p.y / len);

                // UVs
                uvs.push(s / sides, l / (layers - 1));
            }
        }

        // Build index data (quads as two triangles)
        for (let l = 0; l < layers - 1; l++) {
            for (let s = 0; s < sides; s++) {
                const s2 = (s + 1) % sides;
                const a = l * sides + s;
                const b = l * sides + s2;
                const c = (l + 1) * sides + s2;
                const d = (l + 1) * sides + s;

                indices.push(a, b, c);
                indices.push(a, c, d);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Create material — translucent to simulate lampshade
        const material = new THREE.MeshPhysicalMaterial({
            color: 0xffeedd,
            transparent: true,
            opacity: 0.7,
            roughness: 0.4,
            metalness: 0.0,
            transmission: 0.3,
            thickness: 1.0,
            side: THREE.DoubleSide,
            wireframe: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }

    /**
     * Build a wireframe overlay mesh.
     */
    function buildWireframe(rings) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const sides = rings[0].length;
        const layers = rings.length;

        // Circumferential lines (every 5th layer for performance)
        const layerStep = Math.max(1, Math.floor(layers / 40));
        for (let l = 0; l < layers; l += layerStep) {
            for (let s = 0; s < sides; s++) {
                const s2 = (s + 1) % sides;
                const p1 = rings[l][s];
                const p2 = rings[l][s2];
                vertices.push(p1.x, p1.z, p1.y);
                vertices.push(p2.x, p2.z, p2.y);
            }
        }

        // Vertical lines (every 8th segment)
        const segStep = Math.max(1, Math.floor(sides / 16));
        for (let s = 0; s < sides; s += segStep) {
            for (let l = 0; l < layers - 1; l++) {
                const p1 = rings[l][s];
                const p2 = rings[l + 1][s];
                vertices.push(p1.x, p1.z, p1.y);
                vertices.push(p2.x, p2.z, p2.y);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0xe94560,
            transparent: true,
            opacity: 0.15,
        });

        return new THREE.LineSegments(geometry, material);
    }

    return { generate, buildMesh, buildWireframe, profiles };
})();
