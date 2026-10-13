#version 440
// Starfield: the old screensaver, flying slowly forward through stars. Each
// star travels out along its own ray from the centre, growing and speeding up
// as it nears, with a perspective-correct streak behind it; the whole field
// rolls very slowly. Mostly white, a few tinted with the wallpaper's accents.
// Drawn by ShaderScene.qml for the "starfield" scene.
//
// Stars live in polar buckets: a star only ever moves outward along its ray,
// so it never leaves its bucket and every pixel checks one star per layer.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o starfield.frag.qsb starfield.frag

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

const float TAU = 6.2831853;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 c = qt_TexCoord0 * size - 0.5 * size;
    float rr = length(c) / size.y;                         // radius in screen heights
    float a = mod(atan(c.y, c.x) + time * 0.01, TAU);      // the slow roll

    vec3 col = bg.rgb * 0.5 + accent.rgb * 0.035 * exp(-rr * 5.0);   // faint glow at the vanishing point

    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float buckets = 140.0 + fi * 37.0;
        float b = floor(a / TAU * buckets);
        vec2 key = vec2(b, fi * 13.1);
        float n = hash(key);
        if (n < 0.45) continue;                              // not every ray has a star
        float a0 = (b + 0.15 + 0.7 * hash(key + 4.0)) / buckets * TAU;

        // depth: 0 far .. 1 passing the viewer; each star at its own pace
        float z = fract(n * 7.3 + time * (0.03 + 0.02 * hash(key + 7.0)));
        float d = mix(8.0, 0.25, z);
        float r0 = 0.04 + 0.55 * hash(key + 9.0);          // how far off the axis it flies
        float head = r0 / d * 1.6;
        float tail = r0 / (d + 0.045) * 1.6;                // where it was a moment ago

        float across = rr * abs(sin(a - a0)) * size.y;      // px from its ray
        float along = max(max(tail - rr, rr - head), 0.0) * size.y;   // px past either end
        float dist = length(vec2(across, along));
        float w = mix(0.6, 2.4, z * z);                     // px, nearer is bigger

        float on = (1.0 - smoothstep(w * 0.5, w * 1.2, dist)) + 0.3 * exp(-dist / w * 1.5);
        float k = clamp((rr - tail) / max(head - tail, 1e-4), 0.0, 1.0);   // tail 0 .. head 1
        float bright = smoothstep(0.0, 0.3, z) * mix(0.2, 1.0, z * z) * mix(0.4, 1.0, k);

        float m = hash(key + 2.0);
        vec3 tint = m > 0.9 ? accent.rgb : m > 0.82 ? accent2.rgb : fg.rgb;
        col += mix(fg.rgb, tint, 0.6) * on * bright;
    }
    col += (hash(qt_TexCoord0 * size) - 0.5) / 255.0;      // dither: the faint glow would band
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
