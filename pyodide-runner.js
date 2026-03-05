/**
 * Pyodide Runner — manages the Python runtime in the browser.
 * Loads Pyodide, installs FullControl, and provides a bridge for
 * generating lampshade geometry and G-code from JS parameters.
 */
const PyodideRunner = (() => {
    let pyodide = null;
    let ready = false;
    let loading = false;
    let onReadyCallbacks = [];

    /**
     * Initialize Pyodide and install FullControl.
     * Shows progress via the provided status callback.
     * @param {function} onStatus — called with (message, progress 0-1)
     */
    async function init(onStatus = () => {}) {
        if (ready) return;
        if (loading) {
            return new Promise(resolve => onReadyCallbacks.push(resolve));
        }
        loading = true;

        try {
            onStatus('Loading Python runtime...', 0.1);
            pyodide = await loadPyodide();

            onStatus('Installing packages...', 0.3);
            await pyodide.loadPackage('micropip');
            const micropip = pyodide.pyimport('micropip');

            onStatus('Installing fullcontrol...', 0.5);
            await micropip.install('fullcontrol');

            onStatus('Installing numpy...', 0.7);
            // numpy is typically bundled, but ensure it's available
            await pyodide.loadPackage('numpy');

            onStatus('Loading bridge module...', 0.85);
            // Load the Python bridge code
            const bridgeResponse = await fetch('fc-bridge.py');
            const bridgeCode = await bridgeResponse.text();
            await pyodide.runPythonAsync(bridgeCode);

            ready = true;
            onStatus('Ready', 1.0);

            // Resolve any waiting callers
            onReadyCallbacks.forEach(cb => cb());
            onReadyCallbacks = [];
        } catch (err) {
            loading = false;
            onStatus(`Error: ${err.message}`, 0);
            throw err;
        }
    }

    /**
     * Generate lampshade geometry + G-code using FullControl.
     * @param {Object} params — UI parameters
     * @returns {Promise<{gcode: string, rings: Array, stats: Object, toolpaths: Array}>}
     */
    async function generate(params) {
        if (!ready) throw new Error('Pyodide not initialized');

        const paramsJson = JSON.stringify(params);
        pyodide.globals.set('_params_json', paramsJson);

        const resultJson = await pyodide.runPythonAsync(`
generate_lampshade(_params_json)
`);

        return JSON.parse(resultJson);
    }

    /**
     * Check if the runtime is ready.
     */
    function isReady() {
        return ready;
    }

    return { init, generate, isReady };
})();
