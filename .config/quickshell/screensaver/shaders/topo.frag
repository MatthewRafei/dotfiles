#version 440
// Topography: a slowly drifting contour map in the wallpaper's colours. Thin
// lines every step, an accent index line every fifth, as on a survey sheet.
// Drawn by ShaderScene.qml for the "topo" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o topo.frag.qsb topo.frag

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

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}

float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {   // a 5th octave scatters tiny closed contours
        s += a * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}

void main() {
    // 2.4 noise units per screen height, centred, y up
    vec2 px = qt_TexCoord0 * size;
    vec2 p = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y * 2.4;

    // height field: a detailed layer over a broad one, drifting in different directions
    float h = fbm(p + vec2(time * 0.02, -time * 0.013)) + 0.35 * fbm(p * 0.5 - vec2(time * 0.01));

    float f = h * 14.0;                  // contour index
    float w = fwidth(f);
    float d = abs(fract(f + 0.5) - 0.5); // distance to the nearest contour
    float minor = 1.0 - smoothstep(w * 0.5, w * 1.5, d);
    float major = mod(floor(f + 0.5), 5.0) == 0.0 ? 1.0 - smoothstep(w, w * 2.4, d) : 0.0;

    // high ground tinted a touch toward the accent
    vec3 col = mix(bg.rgb, mix(bg.rgb, accent.rgb, 0.12), smoothstep(0.4, 1.2, h));
    col = mix(col, mix(bg.rgb, fg.rgb, 0.26), minor);
    col = mix(col, accent.rgb, major);
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
