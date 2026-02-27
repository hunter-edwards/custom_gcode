/**
 * Main Application Controller
 * Ties together the UI, 3D preview, geometry, and G-code generation.
 */
(function () {
    'use strict';

    // ===== Three.js Scene Setup =====
    const canvas = document.getElementById('viewport');
    const container = document.getElementById('viewport-container');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x111111);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(120, 120, 180);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 50, 0);
    controls.update();

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(100, 200, 150);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-100, 50, -100);
    scene.add(fill);

    // Point light inside the lampshade to show translucency
    const innerLight = new THREE.PointLight(0xffcc88, 1.5, 300);
    innerLight.position.set(0, 50, 0);
    scene.add(innerLight);

    // Build plate grid
    const gridHelper = new THREE.GridHelper(180, 18, 0x333333, 0x222222);
    scene.add(gridHelper);

    // Build volume wireframe (A1 Mini: 180x180x180)
    const boxGeo = new THREE.BoxGeometry(180, 180, 180);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({
        color: 0x333344,
        transparent: true,
        opacity: 0.3,
    }));
    boxLine.position.y = 90;
    scene.add(boxLine);

    // ===== Scene Object Containers =====
    let shapeMesh = null;
    let shapeWireframe = null;
    let gcodePreviewObj = null;
    let currentView = 'shape';
    let generatedGcode = null;

    // ===== UI Bindings =====
    const paramIds = [
        'profile', 'bottomDiameter', 'topDiameter', 'height', 'sides',
        'wallThickness', 'layerHeight',
        'waveAmplitude', 'waveFrequency', 'verticalWaves',
        'patternType', 'patternScale', 'patternDepth',
        'baseRings', 'lipRings',
        'printSpeed', 'nozzleTemp', 'bedTemp', 'filamentDiameter',
        'nozzleDiameter', 'retractionDist', 'spiralMode'
    ];

    function getParams() {
        const p = {};
        paramIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === 'checkbox') {
                p[id] = el.checked;
            } else if (el.type === 'range') {
                p[id] = parseFloat(el.value);
            } else if (el.tagName === 'SELECT') {
                // Try parse as number if possible
                const v = el.value;
                p[id] = isNaN(v) ? v : parseFloat(v);
            }
        });
        return p;
    }

    // Value display next to sliders
    document.querySelectorAll('.val[data-for]').forEach(span => {
        const input = document.getElementById(span.dataset.for);
        if (!input) return;
        input.addEventListener('input', () => {
            span.textContent = input.value;
        });
    });

    // Live preview update on parameter change
    let previewTimeout = null;
    paramIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(updatePreview, 100);
        });
        el.addEventListener('change', () => {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(updatePreview, 50);
        });
    });

    // ===== Preview Update =====
    function updatePreview() {
        const params = getParams();
        const { rings } = LampshadeGeometry.generate(params);

        // Remove old shape
        if (shapeMesh) { scene.remove(shapeMesh); shapeMesh.geometry.dispose(); }
        if (shapeWireframe) { scene.remove(shapeWireframe); shapeWireframe.geometry.dispose(); }

        // Build new mesh
        shapeMesh = LampshadeGeometry.buildMesh(rings, params);
        shapeWireframe = LampshadeGeometry.buildWireframe(rings);
        scene.add(shapeMesh);
        scene.add(shapeWireframe);

        // Update inner light position
        innerLight.position.y = params.height / 2;

        // Show/hide based on view
        shapeMesh.visible = (currentView === 'shape');
        shapeWireframe.visible = (currentView === 'shape');
        if (gcodePreviewObj) gcodePreviewObj.visible = (currentView === 'gcode');

        // Invalidate gcode
        generatedGcode = null;
        document.getElementById('btnDownload').disabled = true;
        document.getElementById('stats').style.display = 'none';
    }

    // ===== G-code Generation =====
    document.getElementById('btnGenerate').addEventListener('click', () => {
        const params = getParams();

        // Validate
        const warnings = GcodeGenerator.validate(params);
        if (warnings.length > 0) {
            alert('Warnings:\n' + warnings.join('\n') + '\n\nGeneration will proceed anyway.');
        }

        const btn = document.getElementById('btnGenerate');
        btn.textContent = 'Generating...';
        btn.disabled = true;

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            try {
                const { rings } = LampshadeGeometry.generate(params);
                const result = GcodeGenerator.generate(rings, params);

                generatedGcode = result.gcode;

                // Update stats
                document.getElementById('statLayers').textContent = result.stats.layers;
                document.getElementById('statTime').textContent = result.stats.estimatedTime;
                document.getElementById('statFilament').textContent = result.stats.filamentM + ' m';
                document.getElementById('statLines').textContent = result.stats.lines.toLocaleString();
                document.getElementById('stats').style.display = 'grid';

                // Build gcode preview
                if (gcodePreviewObj) {
                    scene.remove(gcodePreviewObj);
                    gcodePreviewObj.traverse(child => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    });
                }
                gcodePreviewObj = GcodePreview.build(result.toolpaths, result.stats.layers);
                scene.add(gcodePreviewObj);
                gcodePreviewObj.visible = (currentView === 'gcode');

                // Enable download
                document.getElementById('btnDownload').disabled = false;

                btn.textContent = 'Generate G-code';
                btn.disabled = false;
            } catch (err) {
                console.error('G-code generation failed:', err);
                alert('Error generating G-code: ' + err.message);
                btn.textContent = 'Generate G-code';
                btn.disabled = false;
            }
        }, 50);
    });

    // ===== Download =====
    document.getElementById('btnDownload').addEventListener('click', () => {
        if (!generatedGcode) return;
        const blob = new Blob([generatedGcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lampshade.gcode';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // ===== View Toggles =====
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;

            if (shapeMesh) shapeMesh.visible = (currentView === 'shape');
            if (shapeWireframe) shapeWireframe.visible = (currentView === 'shape');
            if (gcodePreviewObj) gcodePreviewObj.visible = (currentView === 'gcode');
        });
    });

    // ===== Resize =====
    function onResize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    // ===== Animation Loop =====
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    // ===== Init =====
    onResize();
    updatePreview();
    animate();

})();
