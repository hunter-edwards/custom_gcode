/**
 * G-code Toolpath Preview Renderer
 * Renders the generated toolpaths as colored 3D lines in Three.js.
 */
const GcodePreview = (() => {

    /**
     * Build a Three.js Object3D containing the toolpath visualisation.
     *
     * @param {Array} toolpaths — array of layers, each layer an array of {x, y, z, extrude}
     * @param {number} totalLayers
     * @returns {THREE.Object3D}
     */
    function build(toolpaths, totalLayers) {
        const group = new THREE.Group();

        // Colour gradient from bottom (blue) to top (red)
        const colorBottom = new THREE.Color(0x2196f3);
        const colorTop = new THREE.Color(0xe94560);

        const maxLayersToShow = Math.min(toolpaths.length, 2000);
        const step = Math.max(1, Math.floor(toolpaths.length / maxLayersToShow));

        for (let l = 0; l < toolpaths.length; l += step) {
            const layer = toolpaths[l];
            if (!layer || layer.length < 2) continue;

            const t = l / (toolpaths.length - 1 || 1);
            const color = colorBottom.clone().lerp(colorTop, t);

            const extrudeVerts = [];
            const travelVerts = [];

            for (let i = 1; i < layer.length; i++) {
                const prev = layer[i - 1];
                const curr = layer[i];

                if (curr.extrude) {
                    extrudeVerts.push(prev.x, prev.y, prev.z);
                    extrudeVerts.push(curr.x, curr.y, curr.z);
                } else {
                    travelVerts.push(prev.x, prev.y, prev.z);
                    travelVerts.push(curr.x, curr.y, curr.z);
                }
            }

            // Extrusion lines (colored)
            if (extrudeVerts.length > 0) {
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(extrudeVerts, 3));
                const mat = new THREE.LineBasicMaterial({ color, linewidth: 1 });
                group.add(new THREE.LineSegments(geo, mat));
            }

            // Travel moves (faint)
            if (travelVerts.length > 0) {
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(travelVerts, 3));
                const mat = new THREE.LineBasicMaterial({
                    color: 0x333333,
                    transparent: true,
                    opacity: 0.2,
                    linewidth: 1,
                });
                group.add(new THREE.LineSegments(geo, mat));
            }
        }

        // Offset to match shape preview (centred at origin)
        group.position.set(-90, 0, -90);

        return group;
    }

    return { build };
})();
