/**
 * Realistic Preview Renderer
 *
 * Simulates how a 3D-printed lampshade looks with:
 *  - Material presets (PLA, PETG, Silk PLA, TPU)
 *  - Pattern-aware light transmission via a generated texture
 *  - Interior bulb light with adjustable position, intensity, and color temp
 *  - Room ambient dimming
 *  - Layer-line effect baked into the texture
 */
const RealisticPreview = (() => {

    /**
     * Material presets — tuned to approximate real filament appearance.
     *
     * transmission: how much light passes through solid wall (0 = opaque, 1 = clear)
     * roughness: surface finish (higher = matte)
     * metalness: for silk/metallic PLA
     * ior: index of refraction
     * clearcoat: surface gloss layer
     * subsurfaceTint: color tint for light passing through (multiplied with filament color)
     */
    const MATERIALS = {
        pla: {
            label: 'PLA',
            transmission: 0.12,
            roughness: 0.65,
            metalness: 0.0,
            ior: 1.46,
            clearcoat: 0.05,
            clearcoatRoughness: 0.7,
            subsurfaceTint: [1.0, 0.92, 0.85],  // warm glow
            layerLineStrength: 0.35,
        },
        petg: {
            label: 'PETG',
            transmission: 0.40,
            roughness: 0.25,
            metalness: 0.0,
            ior: 1.57,
            clearcoat: 0.3,
            clearcoatRoughness: 0.3,
            subsurfaceTint: [1.0, 0.97, 0.95],  // more neutral
            layerLineStrength: 0.15,
        },
        silkPla: {
            label: 'Silk PLA',
            transmission: 0.08,
            roughness: 0.15,
            metalness: 0.45,
            ior: 1.46,
            clearcoat: 0.6,
            clearcoatRoughness: 0.1,
            subsurfaceTint: [1.0, 0.95, 0.9],
            layerLineStrength: 0.10,
        },
        tpu: {
            label: 'TPU',
            transmission: 0.22,
            roughness: 0.55,
            metalness: 0.0,
            ior: 1.5,
            clearcoat: 0.0,
            clearcoatRoughness: 0.9,
            subsurfaceTint: [1.0, 0.95, 0.92],
            layerLineStrength: 0.20,
        },
    };

    /**
     * Convert color temperature (K) to approximate RGB (sRGB).
     * Uses Tanner Helland's algorithm.
     */
    function colorTempToRGB(kelvin) {
        const temp = kelvin / 100;
        let r, g, b;

        if (temp <= 66) {
            r = 255;
            g = 99.4708025861 * Math.log(temp) - 161.1195681661;
            b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
        } else {
            r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
            g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
            b = 255;
        }

        return new THREE.Color(
            Math.min(1, Math.max(0, r / 255)),
            Math.min(1, Math.max(0, g / 255)),
            Math.min(1, Math.max(0, b / 255))
        );
    }

    /**
     * Generate a 2D texture encoding the wall pattern + layer lines.
     *
     * Texture layout:
     *   U axis (horizontal) = circumference
     *   V axis (vertical) = height
     *
     * The RGB channels encode the base color tinted by wall thickness.
     * The alpha channel encodes the transmission multiplier:
     *   alpha = 1.0 → fully solid wall (blocks light)
     *   alpha = 0.0 → fully open (pattern cutout, light passes through)
     *
     * @param {Object} params — shape/pattern params
     * @param {string} filamentColorHex — hex color from picker
     * @param {Object} matPreset — material preset object
     * @returns {THREE.CanvasTexture}
     */
    function generatePatternTexture(params, filamentColorHex, matPreset) {
        const texW = 512;
        const texH = 512;
        const canvas = document.createElement('canvas');
        canvas.width = texW;
        canvas.height = texH;
        const ctx = canvas.getContext('2d');

        // Parse filament color
        const fc = new THREE.Color(filamentColorHex);

        const {
            patternType = 'none',
            patternScale = 10,
            patternDepth = 50,
            layerHeight = 0.16,
            height = 100,
        } = params;

        const layerCount = Math.ceil(height / layerHeight);
        const layerLineStrength = matPreset.layerLineStrength;

        const imageData = ctx.createImageData(texW, texH);
        const data = imageData.data;

        for (let py = 0; py < texH; py++) {
            const v = py / texH;   // 0 at top, 1 at bottom → invert for height mapping
            const vHeight = 1 - v; // 0=bottom, 1=top of lampshade

            // Layer line modulation: subtle darkening at layer boundaries
            const layerFrac = (vHeight * layerCount) % 1;
            // Create a smooth ridge at each layer boundary
            const layerLine = 1.0 - layerLineStrength * (1.0 - Math.abs(layerFrac - 0.5) * 2);

            for (let px = 0; px < texW; px++) {
                const u = px / texW;

                // Sample pattern: returns 1.0 for solid, lower for cutout
                const wallMult = Patterns.sample(patternType, u, vHeight, patternScale, patternDepth);

                // Base color with layer line modulation
                const r = fc.r * layerLine;
                const g = fc.g * layerLine;
                const b = fc.b * layerLine;

                // Alpha: 1 = fully solid, lower = more transparent / cut through
                // wallMult < ~0.1 means essentially an open hole
                const alpha = wallMult;

                const idx = (py * texW + px) * 4;
                data[idx    ] = Math.round(r * 255);
                data[idx + 1] = Math.round(g * 255);
                data[idx + 2] = Math.round(b * 255);
                data[idx + 3] = Math.round(alpha * 255);
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    /**
     * Generate a separate emissive texture showing the "inner glow" through
     * thin/open pattern areas. This simulates subsurface scattering / light
     * bleeding through the filament.
     */
    function generateEmissiveTexture(params, filamentColorHex, matPreset, bulbColor) {
        const texW = 512;
        const texH = 512;
        const canvas = document.createElement('canvas');
        canvas.width = texW;
        canvas.height = texH;
        const ctx = canvas.getContext('2d');

        const fc = new THREE.Color(filamentColorHex);
        const tint = matPreset.subsurfaceTint;

        const {
            patternType = 'none',
            patternScale = 10,
            patternDepth = 50,
        } = params;

        const baseTransmission = matPreset.transmission;

        const imageData = ctx.createImageData(texW, texH);
        const data = imageData.data;

        for (let py = 0; py < texH; py++) {
            const v = 1 - py / texH;
            for (let px = 0; px < texW; px++) {
                const u = px / texW;

                const wallMult = Patterns.sample(patternType, u, v, patternScale, patternDepth);

                // Transmission: open areas let full light through,
                // solid wall lets baseTransmission through
                const transmission = wallMult < 0.1
                    ? 1.0   // open hole → full light
                    : baseTransmission * (1.0 - wallMult * 0.5); // solid → partial

                // Emissive color = bulb color tinted by filament + subsurface
                const r = bulbColor.r * fc.r * tint[0] * transmission;
                const g = bulbColor.g * fc.g * tint[1] * transmission;
                const b = bulbColor.b * fc.b * tint[2] * transmission;

                const idx = (py * texW + px) * 4;
                data[idx    ] = Math.min(255, Math.round(r * 255));
                data[idx + 1] = Math.min(255, Math.round(g * 255));
                data[idx + 2] = Math.min(255, Math.round(b * 255));
                data[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    /**
     * Build the complete realistic preview scene group.
     *
     * @param {Array} rings — geometry rings
     * @param {Object} params — all shape/print params
     * @param {Object} realisticParams — { materialType, filamentColor, roomBrightness, bulbIntensity, bulbColorTemp, bulbHeight }
     * @returns {{ group: THREE.Group, bulbLight: THREE.PointLight, roomAmbient: THREE.AmbientLight, dispose: Function }}
     */
    function build(rings, params, realisticParams) {
        const {
            materialType = 'pla',
            filamentColor = '#f5e6d0',
            roomBrightness = 20,
            bulbIntensity = 80,
            bulbColorTemp = 2700,
            bulbHeight = 40,
        } = realisticParams;

        const matPreset = MATERIALS[materialType] || MATERIALS.pla;
        const bulbColor = colorTempToRGB(bulbColorTemp);

        const group = new THREE.Group();

        // === Build the lampshade mesh ===
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        const sides = rings[0].length;
        const layers = rings.length;

        for (let l = 0; l < layers; l++) {
            for (let s = 0; s < sides; s++) {
                const p = rings[l][s];
                vertices.push(p.x, p.z, p.y); // swap Y/Z for Three.js
                const len = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
                normals.push(p.x / len, 0, p.y / len);
                uvs.push(s / sides, l / (layers - 1));
            }
        }

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

        // Generate textures
        const patternTex = generatePatternTexture(params, filamentColor, matPreset);
        const emissiveTex = generateEmissiveTexture(params, filamentColor, matPreset, bulbColor);

        // Build material
        const material = new THREE.MeshPhysicalMaterial({
            map: patternTex,
            emissiveMap: emissiveTex,
            emissive: new THREE.Color(1, 1, 1),
            emissiveIntensity: bulbIntensity / 100 * 1.5,
            transparent: true,
            alphaTest: 0.01,
            roughness: matPreset.roughness,
            metalness: matPreset.metalness,
            clearcoat: matPreset.clearcoat || 0,
            clearcoatRoughness: matPreset.clearcoatRoughness || 0,
            side: THREE.DoubleSide,
            depthWrite: true,
        });

        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);

        // === Interior bulb glow sphere ===
        const bulbY = params.height * (bulbHeight / 100);
        const bulbGeo = new THREE.SphereGeometry(3, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({
            color: bulbColor,
            transparent: true,
            opacity: bulbIntensity / 100,
        });
        const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
        bulbMesh.position.set(0, bulbY, 0);
        group.add(bulbMesh);

        // === Interior point light ===
        const bulbLight = new THREE.PointLight(
            bulbColor,
            bulbIntensity / 100 * 3.0,
            params.height * 4
        );
        bulbLight.position.set(0, bulbY, 0);
        group.add(bulbLight);

        // === A secondary fill light inside to fake subsurface scattering ===
        const sssLight = new THREE.PointLight(
            bulbColor,
            bulbIntensity / 100 * 1.0,
            params.height * 2
        );
        sssLight.position.set(0, bulbY * 0.6, 0);
        group.add(sssLight);

        // === Floor/table surface to catch light spill ===
        const floorGeo = new THREE.CircleGeometry(params.height * 1.2, 64);
        const floorMat = new THREE.MeshPhysicalMaterial({
            color: 0x888888,
            roughness: 0.8,
            metalness: 0.0,
            side: THREE.DoubleSide,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.5;
        group.add(floor);

        // Dispose helper
        function dispose() {
            geometry.dispose();
            material.dispose();
            patternTex.dispose();
            emissiveTex.dispose();
            bulbGeo.dispose();
            bulbMat.dispose();
            floorGeo.dispose();
            floorMat.dispose();
        }

        return { group, bulbLight, dispose };
    }

    return { build, MATERIALS, colorTempToRGB };
})();
