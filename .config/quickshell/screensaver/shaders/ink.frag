#version 440
// Ink: slow, smoky ink settling through water, in the wallpaper's colours.
// Noise warped by noise warped by noise (Inigo Quilez's domain warping):
// accent for the ink, accent2 for the eddies where the flow folds, the text
// colour for the thinnest bright wisps. Drawn by ShaderScene.qml for the
// "ink" scene.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o ink.frag.qsb ink.frag

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
    for (int i = 0; i < 5; i++) {
        s += a * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 p = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y * 2.0;
    p.x += 0.8;     // the scene restarts its clock each time: open on the busiest part of the flow
    float t = time * 0.03;

    // two rounds of warping: q bends the field, r bends it again along q
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 1.4),
                  fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 1.1));
    float f = fbm(p + 4.0 * r);

    vec3 col = bg.rgb;
    col = mix(col, accent.rgb * 0.85, smoothstep(0.3, 0.85, f * f * 1.8));      // the ink
    col = mix(col, accent2.rgb * 0.7, smoothstep(0.55, 0.95, length(q)) * 0.45); // eddies where it folds
    col = mix(col, fg.rgb, smoothstep(0.62, 0.9, r.x) * smoothstep(0.5, 0.8, f) * 0.35);  // bright wisps
    col *= 0.45 + 0.75 * f;                                                      // depth: thin ink is darker

    // a soft vignette keeps the edges in deep water
    vec2 v = qt_TexCoord0 - 0.5;
    col *= 1.0 - 0.55 * dot(v, v) * 2.0;
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
