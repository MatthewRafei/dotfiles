#version 440
// Mystify: the other old screensaver. Two four-cornered polygons whose
// corners bounce off the screen's edges, each trailed by fading echoes of
// where it was. One in the wallpaper's accent, one in accent2. Every corner
// is a closed-form bounce (a triangle wave), so an echo is just the same
// shape a moment earlier. Drawn by ShaderScene.qml for the "mystify" scene.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o mystify.frag.qsb mystify.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms; every scene shader declares this same block
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
};

const float ECHOES = 9.0;
const float GAP = 0.2;          // seconds between echoes

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 0..1..0 back and forth: a bounce between two walls
float bounce(float x) { return abs(fract(x * 0.5) * 2.0 - 1.0); }

// corner k of polygon s at time t, in px, kept 4% inside the edges
vec2 corner(float s, float k, float t) {
    vec2 key = vec2(s * 7.0 + k, s * 3.0 + 1.0);
    vec2 start = vec2(hash(key), hash(key + 5.1)) * 2.0;
    // screens per second in each direction; never too slow on either axis
    vec2 vel = (0.05 + 0.06 * vec2(hash(key + 2.3), hash(key + 8.9))) * 2.0;
    vec2 u = vec2(bounce(start.x + vel.x * t * size.y / size.x), bounce(start.y + vel.y * t));
    return (0.04 + 0.92 * u) * size;
}

float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec3 col = bg.rgb * 0.6;

    for (int s = 0; s < 2; s++) {
        float fs = float(s);
        vec3 tint = s == 0 ? accent.rgb : accent2.rgb;
        for (int e = 0; e < 9; e++) {
            float fe = float(e);
            float t = time - fe * GAP;
            vec2 c0 = corner(fs, 0.0, t), c1 = corner(fs, 1.0, t);
            vec2 c2 = corner(fs, 2.0, t), c3 = corner(fs, 3.0, t);
            float d = min(min(segment(px, c0, c1), segment(px, c1, c2)),
                          min(segment(px, c2, c3), segment(px, c3, c0)));
            float fade = 1.0 - fe / ECHOES;                    // newest brightest
            float line = 1.0 - smoothstep(0.6, 1.6, d);
            float glow = exp(-d * 0.35) * 0.18;
            col += tint * (line + glow) * fade * fade;
        }
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
