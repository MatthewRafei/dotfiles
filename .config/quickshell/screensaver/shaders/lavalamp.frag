#version 440
// Lava Lamp: flat cartoon wax blobs that rise, merge and split over a pool at
// the bottom, with a darker outline like a sticker and a dab of shine on each blob.
// Wax in the wallpaper's accent. Drawn by ShaderScene.qml for the "lavalamp"
// scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o lavalamp.frag.qsb lavalamp.frag

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

vec2 blobAt(float i, float halfW) {
    return vec2(sin(time * (0.05 + i * 0.011) + i * 2.1) * (halfW - 0.15),
                sin(time * (0.04 + i * 0.009) + i * 1.3) * 0.42);
}
float blobSize(float i) { return 0.085 + 0.05 * hash(vec2(i, 1.0)); }

// cartoon highlights: a small tilted oval on each blob's upper left
float shine(vec2 p, float halfW) {
    const mat2 tilt = mat2(0.707, 0.707, -0.707, 0.707);
    float s = 0.0;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float r = blobSize(fi);
        vec2 q = tilt * (p - blobAt(fi, halfW) - vec2(-0.42, 0.42) * r) / (r * vec2(0.34, 0.15));
        s = max(s, 1.0 - smoothstep(0.85, 1.0, length(q)));
    }
    return s;
}

// metaball field (1.0 is the wax's edge): seven blobs on slow Lissajous paths,
// a minute or more per loop, over a gently rolling pool at the bottom
float field(vec2 p, float halfW) {
    float f = 0.0;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = blobAt(fi, halfW);
        float r = blobSize(fi);
        vec2 d = p - c;
        f += r * r / max(dot(d, d), 1e-4);
    }
    float top = -0.43 + 0.02 * sin(p.x * 3.0 + time * 0.2) + 0.012 * sin(p.x * 7.0 - time * 0.13);
    return f + (1.0 - smoothstep(top - 0.12, top + 0.06, p.y)) * 1.6;
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 p = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;   // y up, 1 = screen height
    float halfW = 0.5 * size.x / size.y;

    // distance to the wax's edge in px, from the field and its gradient, so the
    // outline keeps one width even in the necks where blobs join
    float h = 1.0 / size.y;
    float f = field(p, halfW);
    vec2 g = vec2(field(p + vec2(h, 0.0), halfW) - field(p - vec2(h, 0.0), halfW),
                  field(p + vec2(0.0, h), halfW) - field(p - vec2(0.0, h), halfW)) / (2.0 * h);
    float gl = max(length(g), 1e-4);
    float d = (f - 1.0) / gl * size.y;          // px inside the wax (negative outside)

    float line = max(2.0, size.y * 0.004);      // outline width, ~5 px at 1200 px tall
    float fill = smoothstep(-0.75, 0.75, d);
    float rim = fill * (1.0 - smoothstep(line - 0.75, line + 0.75, d));

    float y = 1.0 - qt_TexCoord0.y;
    vec3 wax = accent.rgb;
    vec3 back = mix(bg.rgb, mix(bg.rgb, accent.rgb, 0.10), y);   // faint glow toward the top
    vec3 col = mix(back, wax, fill);
    col = mix(col, wax * 0.42, rim);
    // highlights only well inside the wax (not across the outline when blobs touch)
    col = mix(col, mix(wax, fg.rgb, 0.6), shine(p, halfW) * smoothstep(line, line + 1.5, d) * 0.9);
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
