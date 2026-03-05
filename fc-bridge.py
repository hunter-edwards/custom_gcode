"""
FullControl Bridge — Lampshade G-code Generator

This module runs inside Pyodide and uses the FullControl library
to generate non-planar lampshade geometry and G-code.

Called from JS via: generate_lampshade(params_json) → result_json
"""

import fullcontrol as fc
import json
import math

TAU = 2 * math.pi


# ── Profile functions ──────────────────────────────────────────────
# Map normalized height t ∈ [0,1] → radius

def profile_cylinder(t, bot_r, top_r):
    return bot_r + (top_r - bot_r) * t

def profile_cone(t, bot_r, top_r):
    return bot_r + (top_r - bot_r) * t

def profile_bulge(t, bot_r, top_r):
    base = bot_r + (top_r - bot_r) * t
    return base + math.sin(t * math.pi) * 0.3 * (bot_r + top_r) / 2

def profile_hourglass(t, bot_r, top_r):
    base = bot_r + (top_r - bot_r) * t
    pinch = -math.sin(t * math.pi) * 0.25 * (bot_r + top_r) / 2
    return max(base + pinch, 5)

def profile_trumpet(t, bot_r, top_r):
    return bot_r + (top_r - bot_r) * (t * t)

def profile_wave(t, bot_r, top_r):
    base = bot_r + (top_r - bot_r) * t
    return base + math.sin(t * math.pi * 3) * 0.1 * (bot_r + top_r) / 2

PROFILES = {
    'cylinder': profile_cylinder,
    'cone': profile_cone,
    'bulge': profile_bulge,
    'hourglass': profile_hourglass,
    'trumpet': profile_trumpet,
    'wave': profile_wave,
}


# ── Wave functions ─────────────────────────────────────────────────

def wave_sine(t, amp, freq, phase=0):
    return amp * math.sin(t * freq + phase)

def wave_triangle(t, amp, freq, phase=0):
    x = (t * freq + phase) / TAU
    frac = x - math.floor(x)
    tri = 4 * abs(frac - 0.5) - 1
    return amp * tri

def wave_square(t, amp, freq, phase=0):
    x = (t * freq + phase) / TAU
    frac = x - math.floor(x)
    return amp * (1 if frac < 0.5 else -1)

def wave_sawtooth(t, amp, freq, phase=0):
    x = (t * freq + phase) / TAU
    frac = x - math.floor(x)
    return amp * (2 * frac - 1)

def wave_star(t, amp, freq, phase=0, sharpness=2):
    raw = math.sin(t * freq + phase)
    sign = 1 if raw >= 0 else -1
    return amp * (abs(raw) ** (1 / sharpness)) * sign

def wave_petal(t, amp, freq, phase=0):
    return amp * abs(math.sin(t * freq * 0.5 + phase))

WAVE_FNS = {
    'sine': wave_sine,
    'triangle': wave_triangle,
    'square': wave_square,
    'sawtooth': wave_sawtooth,
    'star': wave_star,
    'petal': wave_petal,
}


# ── Envelope functions ─────────────────────────────────────────────

def env_constant(t):
    return 1.0

def env_bulge(t):
    return math.sin(t * math.pi)

def env_fade_in(t):
    return t

def env_fade_out(t):
    return 1 - t

def env_diamond(t):
    return 1 - abs(2 * t - 1)

def env_gaussian(t):
    x = (t - 0.5) * 4
    return math.exp(-x * x / 2)

ENVELOPES = {
    'constant': env_constant,
    'bulge': env_bulge,
    'fadeIn': env_fade_in,
    'fadeOut': env_fade_out,
    'diamond': env_diamond,
    'gaussian': env_gaussian,
}


# ── Pattern functions (matching JS patterns.js) ───────────────────

def pattern_none(u, v, scale, depth):
    return 1.0

def pattern_diamonds(u, v, scale, depth):
    su = u * scale
    sv = v * scale
    dx = abs((su % 1) - 0.5) * 2
    dy = abs((sv % 1) - 0.5) * 2
    diamond = dx + dy
    if diamond < 0.7:
        return 1.0 - depth
    return 1.0

def pattern_hexagons(u, v, scale, depth):
    su = u * scale
    sv = v * scale * 0.866
    row = int(math.floor(sv))
    col = su + (0 if row % 2 == 0 else 0.5)
    cx = (col % 1) - 0.5
    cy = (sv % 1) - 0.5
    dist = math.sqrt(cx * cx + cy * cy)
    if dist < 0.35:
        return 1.0 - depth
    return 1.0

def pattern_spirals(u, v, scale, depth):
    spiral_count = max(1, int(scale / 3))
    angle = u * math.pi * 2 * spiral_count
    phase = v * scale * 0.5
    val = math.sin(angle + phase)
    if val > 0.3:
        return 1.0
    return 1.0 - depth

def pattern_waves(u, v, scale, depth):
    wave_val = math.sin(u * math.pi * 2 * scale) * 0.5 + 0.5
    stripe = math.sin(v * math.pi * 2 * scale * 2) * 0.5 + 0.5
    combined = wave_val * 0.5 + stripe * 0.5
    if combined > 0.55:
        return 1.0
    return 1.0 - depth

def _hash2d(x, y):
    h = x * 374761393 + y * 668265263
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    hx = ((h & 0xFFFF) / 0xFFFF) * 0.8 + 0.1
    hy = (((h >> 16) & 0xFFFF) / 0xFFFF) * 0.8 + 0.1
    return hx, hy

def pattern_voronoi(u, v, scale, depth):
    su = u * scale
    sv = v * scale
    cell_x = int(math.floor(su))
    cell_y = int(math.floor(sv))
    min_dist = 999
    second_dist = 999
    for dx in range(-1, 2):
        for dy in range(-1, 2):
            nx, ny = cell_x + dx, cell_y + dy
            hx, hy = _hash2d(nx, ny)
            px, py = nx + hx, ny + hy
            d = math.sqrt((su - px) ** 2 + (sv - py) ** 2)
            if d < min_dist:
                second_dist = min_dist
                min_dist = d
            elif d < second_dist:
                second_dist = d
    edge = second_dist - min_dist
    if edge < 0.12:
        return 1.0
    return 1.0 - depth

PATTERNS = {
    'none': pattern_none,
    'diamonds': pattern_diamonds,
    'hexagons': pattern_hexagons,
    'spirals': pattern_spirals,
    'waves': pattern_waves,
    'voronoi': pattern_voronoi,
}


# ── Cross-section models ──────────────────────────────────────────

def cs_rectangle(w, h):
    return w * h

def cs_stadium(w, h):
    if w <= h:
        return math.pi * (w / 2) ** 2
    return (w - h) * h + math.pi * (h / 2) ** 2

def cs_circle(w, h):
    return math.pi * (w / 2) ** 2

CS_MODELS = {
    'rectangle': cs_rectangle,
    'stadium': cs_stadium,
    'circle': cs_circle,
}


# ── Main generation function ──────────────────────────────────────

def generate_lampshade(params_json):
    """
    Generate lampshade G-code using FullControl.

    Takes a JSON string of parameters from JS, returns a JSON string with:
      - gcode: the complete G-code string
      - rings: array of rings for Three.js preview
      - stats: print statistics
    """
    p = json.loads(params_json)

    # Extract parameters with defaults
    profile_name = p.get('profile', 'wave')
    bottom_r = p.get('bottomDiameter', 100) / 2
    top_r = p.get('topDiameter', 120) / 2
    height = p.get('height', 100)
    sides = p.get('sides', 64)
    layer_height = p.get('layerHeight', 0.16)
    wall_thickness = p.get('wallThickness', 0.8)
    nozzle_temp = p.get('nozzleTemp', 215)
    bed_temp = p.get('bedTemp', 60)
    print_speed = p.get('printSpeed', 40)
    filament_diameter = p.get('filamentDiameter', 1.75)
    nozzle_diameter = p.get('nozzleDiameter', 0.4)
    retraction_dist = p.get('retractionDist', 0.8)
    pattern_type = p.get('patternType', 'none')
    pattern_scale = p.get('patternScale', 10)
    pattern_depth = p.get('patternDepth', 50)
    base_rings = p.get('baseRings', 3)
    lip_rings = p.get('lipRings', 2)
    spiral_mode = p.get('spiralMode', False)
    cross_section = p.get('crossSection', 'stadium')

    # Non-planar waves
    wave_amp = p.get('waveAmplitude', 1.5)
    wave_freq = p.get('waveFrequency', 6)
    vertical_waves = p.get('verticalWaves', 3)

    # Ripple texture
    ripple_enabled = p.get('rippleEnabled', False)
    ripple_wave_type = p.get('rippleWaveType', 'sine')
    ripple_amp = p.get('rippleAmplitude', 5)
    ripple_freq = p.get('rippleFrequency', 6)
    ripple_twist = p.get('rippleTwist', 0)
    ripple_envelope = p.get('rippleEnvelope', 'constant')
    ripple_sec_amp = p.get('rippleSecondaryAmp', 0)
    ripple_sec_freq = p.get('rippleSecondaryFreq', 3)

    # Resolve functions
    profile_fn = PROFILES.get(profile_name, profile_cylinder)
    ripple_wave_fn = WAVE_FNS.get(ripple_wave_type, wave_sine)
    envelope_fn = ENVELOPES.get(ripple_envelope, env_constant)
    pattern_fn = PATTERNS.get(pattern_type, pattern_none)
    depth_frac = min(1, max(0, pattern_depth / 100))

    # Geometry
    layer_count = math.ceil(height / layer_height)
    twist_rad = (ripple_twist / 360) * TAU
    wall_passes = max(1, round(wall_thickness / nozzle_diameter))
    base_layer_limit = base_rings * math.ceil(1 / layer_height)
    lip_layer_start = layer_count - lip_rings * math.ceil(1 / layer_height)

    # Centre offset for A1 Mini (180x180 bed)
    cx, cy = 90.0, 90.0

    # Extrusion setup
    extrusion_width = nozzle_diameter * 1.05
    cs_fn = CS_MODELS.get(cross_section, cs_stadium)
    bead_area = cs_fn(extrusion_width, layer_height)

    # ── Build FullControl steps ───────────────────────────────────
    steps = []

    # Set initial printer state
    steps.append(fc.Printer(print_speed=print_speed, travel_speed=150))
    steps.append(fc.ExtrusionGeometry(
        width=extrusion_width,
        height=layer_height,
        area_model='rectangle',  # we handle area ourselves via E calc
    ))

    # Build ring data for Three.js preview (separate from FC steps)
    rings_data = []

    for layer in range(layer_count + 1):
        t = layer / layer_count
        z = t * height
        base_radius = profile_fn(t, bottom_r, top_r)
        is_base = layer < base_layer_limit
        is_lip = layer > lip_layer_start
        env_amp = envelope_fn(t)
        twist_offset = t * twist_rad

        ring_points = []
        passes = (wall_passes + 1) if (is_base or is_lip) else wall_passes

        for pass_idx in range(passes):
            offset_frac = pass_idx * nozzle_diameter

            for s in range(sides + (0 if spiral_mode and pass_idx == 0 and not is_base and not is_lip else 1)):
                idx = s % sides
                u = idx / sides
                angle = u * TAU

                # Non-planar Z offset
                z_off = 0
                if wave_amp > 0:
                    z_off = wave_amp * math.sin(angle * wave_freq + t * vertical_waves * TAU)

                # Radius variation from vertical waves
                r_off = 0
                if vertical_waves > 0 and wave_amp > 0:
                    r_off = (wave_amp * 0.3) * math.cos(
                        angle * wave_freq * 0.5 + t * vertical_waves * math.pi
                    )

                # Ripple texture
                ripple_off = 0
                if ripple_enabled and ripple_amp > 0:
                    ra = angle + twist_offset
                    if ripple_wave_type == 'star':
                        ripple_off = wave_star(ra, ripple_amp, ripple_freq, 0, 2) * env_amp
                    else:
                        ripple_off = ripple_wave_fn(ra, ripple_amp, ripple_freq, 0) * env_amp
                    if ripple_sec_amp > 0:
                        ripple_off += wave_sine(ra, ripple_sec_amp, ripple_sec_freq, math.pi / 4) * env_amp

                r = base_radius + r_off + ripple_off - offset_frac
                if r <= 0:
                    continue

                x = cx + r * math.cos(angle)
                y = cy + r * math.sin(angle)
                final_z = z + z_off

                # Pattern sampling
                wall_mult = pattern_fn(u, t, pattern_scale, depth_frac)

                if wall_mult < 0.1 and not is_base and not is_lip:
                    # Pattern cutout — travel move
                    steps.append(fc.Extruder(on=False))
                    steps.append(fc.Point(x=x, y=y, z=final_z))
                    steps.append(fc.Extruder(on=True))
                else:
                    steps.append(fc.Point(x=x, y=y, z=final_z))

                # Store ring data for preview (only first pass)
                if pass_idx == 0 and s < sides:
                    ring_points.append({
                        'x': r * math.cos(angle),
                        'y': r * math.sin(angle),
                        'z': final_z,
                        'radius': r,
                        'angle': angle,
                        'layer': layer,
                        't': t,
                    })

        rings_data.append(ring_points)

    # ── Generate G-code via FullControl ───────────────────────────
    #
    # FullControl's built-in printer profiles don't include A1 Mini,
    # so we use initialization_data to inject our own start/end gcode.

    start_gcode = f"""; Generated by Lampshade Generator — FullControl Engine
; Target: Bambu Lab A1 Mini
; Layer height: {layer_height}mm
; Wall thickness: {wall_thickness}mm
; Non-planar amplitude: {wave_amp}mm
; Cross-section model: {cross_section}
; Bead area: {bead_area:.4f}mm²
; Pattern: {pattern_type}

; ====== START GCODE ======
G90 ; Absolute positioning
M82 ; Absolute extrusion
M104 S{nozzle_temp} ; Set nozzle temp
M140 S{bed_temp} ; Set bed temp
M190 S{bed_temp} ; Wait for bed temp
M109 S{nozzle_temp} ; Wait for nozzle temp
G28 ; Home all axes
G29 ; Auto bed leveling
G92 E0 ; Reset extruder

; Prime line
G1 Z2.0 F3000
G1 X5 Y5 F3000
G1 Z0.3 F1000
G1 X60 Y5 E10 F1500
G1 X60 Y5.4 E10.2 F1500
G1 X5 Y5.4 E20 F1500
G92 E0 ; Reset extruder after prime
"""

    end_gcode = """
; ====== END GCODE ======
G91 ; Relative positioning
G1 E-2 F1800 ; Retract
G1 Z10 F3000 ; Lift nozzle
G90 ; Absolute positioning
G1 X5 Y170 F9000 ; Move to back corner
M104 S0 ; Turn off nozzle heater
M140 S0 ; Turn off bed heater
M107 ; Fan off
M84 ; Disable motors
; Done!"""

    gcode_controls = fc.GcodeControls(
        printer_name='generic',
        initialization_data={
            'primer': 'no_primer',
            'print_speed': print_speed * 60,
            'nozzle_temp': nozzle_temp,
            'bed_temp': bed_temp,
            'material_flow_ratio': 1.0,
            'e_units': 'mm',
        },
    )

    try:
        fc_gcode = fc.transform(steps, 'gcode', gcode_controls, show_tips=False)
    except Exception as e:
        # Fallback: manually build G-code from steps if FC transform fails
        fc_gcode = _manual_gcode(steps, bead_area, filament_diameter, print_speed, retraction_dist)

    # Wrap with our start/end gcode
    full_gcode = start_gcode + '\n' + fc_gcode + '\n' + end_gcode

    # Count lines and estimate stats
    gcode_lines = full_gcode.split('\n')
    move_count = sum(1 for line in gcode_lines if line.startswith('G1 '))

    # Rough filament estimate from E values
    filament_mm = 0
    for line in reversed(gcode_lines):
        if ' E' in line:
            try:
                e_part = line.split(' E')[1].split(' ')[0]
                filament_mm = float(e_part)
                break
            except (ValueError, IndexError):
                pass

    est_minutes = (move_count / (print_speed * 60)) * 60 + layer_count * 0.5

    # Build toolpaths for G-code preview (simplified)
    toolpaths = []
    for ring in rings_data:
        layer_path = []
        for pt in ring:
            layer_path.append({
                'x': pt['x'] + cx,
                'y': pt['z'],  # swap for Three.js
                'z': pt['y'] + cy,
                'extrude': True,
            })
        toolpaths.append(layer_path)

    stats = {
        'layers': layer_count,
        'lines': len(gcode_lines),
        'filamentMm': round(filament_mm, 1),
        'filamentM': round(filament_mm / 1000, 2),
        'estimatedMinutes': math.ceil(est_minutes),
        'estimatedTime': _format_time(est_minutes),
    }

    return json.dumps({
        'gcode': full_gcode,
        'rings': rings_data,
        'stats': stats,
        'toolpaths': toolpaths,
    })


def _manual_gcode(steps, bead_area, filament_diameter, print_speed, retraction_dist):
    """Fallback: build G-code manually from FC step objects."""
    filament_area = math.pi * (filament_diameter / 2) ** 2
    ext_mult = bead_area / filament_area
    lines = []
    e = 0.0
    last_x, last_y, last_z = 0.0, 0.0, 0.0
    extruding = True
    feed = print_speed * 60
    travel_feed = 150 * 60

    for step in steps:
        if hasattr(step, 'x') and step.x is not None:
            x = step.x if step.x is not None else last_x
            y = step.y if step.y is not None else last_y
            z = step.z if step.z is not None else last_z
            dx = x - last_x
            dy = y - last_y
            dz = z - last_z
            dist = math.sqrt(dx*dx + dy*dy + dz*dz)
            if extruding:
                e += dist * ext_mult
                lines.append(f'G1 X{x:.3f} Y{y:.3f} Z{z:.3f} E{e:.5f} F{feed}')
            else:
                lines.append(f'G0 X{x:.3f} Y{y:.3f} Z{z:.3f} F{travel_feed}')
            last_x, last_y, last_z = x, y, z
        elif hasattr(step, 'on'):
            if not step.on and extruding:
                e -= retraction_dist
                lines.append(f'G1 E{e:.5f} F{40 * 60}')
            elif step.on and not extruding:
                e += retraction_dist
                lines.append(f'G1 E{e:.5f} F{40 * 60}')
            extruding = step.on

    return '\n'.join(lines)


def _format_time(minutes):
    hrs = int(minutes // 60)
    mins = math.ceil(minutes % 60)
    if hrs > 0:
        return f'{hrs}h {mins}m'
    return f'{mins}m'
