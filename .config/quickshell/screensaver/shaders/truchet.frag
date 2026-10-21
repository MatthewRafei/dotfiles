#version 440
// Truchet: a grid of quarter-circle tiles whose arcs join into long winding
// paths. Every few seconds a scattering of tiles turns a quarter, re-routing
// the paths, and slow bands of the accents sweep across the grid. Drawn by ShaderScene.qml for the "truchet" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o truchet.frag.qsb truchet.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the seed
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    float seed;         // 0..1, new each time the scene starts
};

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 91.7) * 43758.5453); }

const float TILE = 64.0;     // px
const float PI = 3.14159265;

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 id = floor(px / TILE);
    vec2 uv = fract(px / TILE) - 0.5;       // -0.5..0.5 in the tile

    // each tile turns at its own moments: a turn every ~6 s for one tile in 8
    float period = 6.0;
    float k = floor(time / period);
    float turns = 0.0;
    for (int i = 0; i < 12; i++) {           // the last 12 rounds decide the orientation
        float r = k - float(i);
        if (hash(id + r * 17.31) < 0.125) turns += 1.0;
    }
    // the current round's turn animates in over the first second
    float now = hash(id + k * 17.31) < 0.125 ? 1.0 : 0.0;
    float ph = clamp(fract(time / period) * period - hash(id + 3.0) * 2.0, 0.0, 1.0);
    float ease = ph * ph * (3.0 - 2.0 * ph);
    float base = step(0.5, hash(id + 0.5));
    float ang = (base + turns - now * (1.0 - ease)) * PI * 0.5;
    float c = cos(ang), s = sin(ang);
    vec2 q = mat2(c, -s, s, c) * uv;

    // two arcs: around the (-,-) and (+,+) corners, radius 0.5
    float d1 = abs(length(q - vec2(-0.5)) - 0.5);
    float d2 = abs(length(q - vec2(0.5)) - 0.5);
    float d = min(d1, d2);
    float w = 0.085;
    float aa = 1.0 / TILE;
    float arc = 1.0 - smoothstep(w - aa, w + aa, d);
    float edge = 1.0 - smoothstep(w * 0.45 - aa, w * 0.45 + aa, d);

    // two slow bands of light sweeping across, in different directions
    float b1 = pow(0.5 + 0.5 * sin(dot(px, vec2(0.8, 0.6)) / 260.0 - time * 0.5), 6.0);
    float b2 = pow(0.5 + 0.5 * sin(dot(px, vec2(-0.5, 0.87)) / 340.0 - time * 0.37 + 2.0), 6.0);

    vec3 col = bg.rgb;
    // faint tile grid
    vec2 g = abs(uv);
    col = mix(col, mix(bg.rgb, fg.rgb, 0.05), step(0.495, max(g.x, g.y)));
    vec3 ink = mix(bg.rgb, fg.rgb, 0.3);
    ink = mix(ink, accent.rgb, b1 * 0.9);
    ink = mix(ink, accent2.rgb, b2 * 0.9);
    col = mix(col, ink, arc);
    col = mix(col, mix(ink, fg.rgb, 0.35), edge * 0.4);

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
