#version 440
// Seven-Segment Clock: the time as the bar shows it (hh:mm, 12-hour, AM/PM)
// in big glowing segments, the unlit ones faintly visible, a blinking colon
// and a seconds track. The whole readout drifts slowly round the screen so
// nothing burns in. Segments in the wallpaper's accent; AM/PM is real text
// from the glyph atlas. Drawn by ShaderScene.qml for the "clock" scene
// (glyphs "AMP").
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o clock.frag.qsb clock.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas members and the clock
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    vec2 cell;          // grid cell in logical px
    float glyphCount;   // glyphs in the atlas row: A, M, P
    vec4 clock;         // hour (1-12), minute, second, pm
};

layout(binding = 1) uniform sampler2D atlas;

// which of the segments a b c d e f g (top, top right, bottom right, bottom,
// bottom left, top left, middle) each digit lights, as a 7-bit number
float mask(float n) {
    if (n < 0.5) return 63.0;
    if (n < 1.5) return 6.0;
    if (n < 2.5) return 91.0;
    if (n < 3.5) return 79.0;
    if (n < 4.5) return 102.0;
    if (n < 5.5) return 109.0;
    if (n < 6.5) return 125.0;
    if (n < 7.5) return 7.0;
    if (n < 8.5) return 127.0;
    return 111.0;
}

// one segment with pointed ends; digit units: a digit is about 1 wide, 2 tall
float segment(vec2 p, vec2 c, bool across) {
    vec2 d = p - c;
    if (!across) d = d.yx;
    d = abs(d);
    return max(d.y - 0.065, d.x + d.y - 0.33);
}

// distance to the nearest lit (x) and unlit (y) segment of digit n
vec2 digit(vec2 p, float n) {
    float m = mask(n);
    float lit = 1e3, off = 1e3;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = fi < 0.5 ? vec2(0.0, 0.7)   : fi < 1.5 ? vec2(0.36, 0.35)
               : fi < 2.5 ? vec2(0.36, -0.35) : fi < 3.5 ? vec2(0.0, -0.7)
               : fi < 4.5 ? vec2(-0.36, -0.35) : fi < 5.5 ? vec2(-0.36, 0.35) : vec2(0.0);
        bool across = fi < 0.5 || (fi > 2.5 && fi < 3.5) || fi > 5.5;
        float d = segment(p, c, across);
        if (mod(floor(m / exp2(fi)), 2.0) > 0.5) lit = min(lit, d); else off = min(off, d);
    }
    return vec2(lit, off);
}

void main() {
    vec2 px = qt_TexCoord0 * size;                                  // logical px, y down
    float unit = 0.14 * size.y;                                     // half a digit's height
    // drift: a slow loop of several minutes over the middle of the screen
    vec2 centre = 0.5 * size + vec2(sin(time * 0.013) * 0.17 * size.x, sin(time * 0.021 + 1.0) * 0.14 * size.y);
    vec2 p = (px - centre) / unit * vec2(1.0, -1.0);                // digit units, y up
    float aa = 1.2 / unit;

    float h = clock.x, m = clock.y;
    vec2 q = vec2(p.x - p.y * 0.08, p.y);                           // the slight lean of a real display
    vec2 d = min(min(digit(q - vec2(-2.35, 0.0), floor(h / 10.0)), digit(q - vec2(-1.25, 0.0), mod(h, 10.0))),
                 min(digit(q - vec2(1.25, 0.0), floor(m / 10.0)), digit(q - vec2(2.35, 0.0), mod(m, 10.0))));
    float colon = min(length(q - vec2(0.0, 0.35)), length(q - vec2(0.0, -0.35))) - 0.09;
    if (mod(clock.z, 2.0) < 1.0) d.x = min(d.x, colon); else d.y = min(d.y, colon);

    vec3 lit = mix(accent.rgb, fg.rgb, 0.25);
    vec3 col = bg.rgb;
    col = mix(col, mix(bg.rgb, fg.rgb, 0.06), 1.0 - smoothstep(0.0, aa, d.y));
    col += accent.rgb * exp(-max(d.x, 0.0) * 5.0) * 0.28;
    col = mix(col, lit, 1.0 - smoothstep(0.0, aa, d.x));

    // seconds: a thin track under the digits, filled to the current second
    float x = (p.x + 2.8) / 5.6;
    float track = (1.0 - smoothstep(0.02, 0.02 + aa, abs(p.y + 1.2))) * step(0.0, x) * step(x, 1.0);
    col = mix(col, mix(bg.rgb, fg.rgb, 0.12), track);
    col = mix(col, accent.rgb, track * step(x, (clock.z + 1.0) / 60.0));

    // AM / PM in the shell's font, twice the grid size, beside the minutes
    vec2 corner = floor(centre + vec2(2.95, -0.78) * unit);
    vec2 lp = (px - corner) / 2.0;
    if (lp.x >= 0.0 && lp.y >= 0.0 && lp.x < 2.0 * cell.x && lp.y < cell.y) {
        float g = lp.x < cell.x ? (clock.w > 0.5 ? 2.0 : 0.0) : 1.0;  // P or A, then M
        vec2 inCell = fract(lp / cell);
        float a = texture(atlas, vec2((g + inCell.x) / glyphCount, inCell.y)).a;
        col = mix(col, lit, a);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
