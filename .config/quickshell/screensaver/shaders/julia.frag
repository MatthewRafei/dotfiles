#version 440
// Julia: the Julia set of z -> z^2 + c, with c travelling slowly along the
// edge of the Mandelbrot set's main cardioid and breathing a little in and
// out across it, so the picture keeps morphing between connected spirals and
// lacy dendrites; the whole picture turns gently. Smooth escape-time colouring in the
// wallpaper's colours: bg far out, accent along the filaments, the text
// colour at their brightest, faint accent2 banding between. Drawn by
// ShaderScene.qml for the "julia" scene.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o julia.frag.qsb julia.frag

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

const float MAX_ITER = 96.0;

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 p = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;

    float spin = time * 0.012;
    vec2 z = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * p * 3.0;
    // c on the main cardioid, e^ia/2 - e^2ia/4, once round every ~9 minutes,
    // scaled 3% inside to 3% outside of it over a ~2 minute breath
    float a = 2.2 + time * 0.012;
    vec2 e1 = vec2(cos(a), sin(a)), e2 = vec2(cos(2.0 * a), sin(2.0 * a));
    vec2 c = (0.5 * e1 - 0.25 * e2) * (1.0 + 0.03 * sin(time * 0.05));

    float n = 0.0;
    float r2 = 0.0;
    for (int i = 0; i < 96; i++) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        r2 = dot(z, z);
        if (r2 > 256.0) break;
        n += 1.0;
    }

    vec3 col;
    if (n >= MAX_ITER) {
        col = bg.rgb * 0.6;                                        // inside the set
    } else {
        float mu = n + 1.0 - log2(log2(r2) * 0.5);                 // smooth iteration count
        float t = pow(clamp(mu / 64.0, 0.0, 1.0), 0.65);
        col = mix(bg.rgb * 0.5, accent.rgb, smoothstep(0.15, 0.7, t));
        col = mix(col, accent2.rgb, (0.5 + 0.5 * cos(mu * 0.45)) * 0.18 * smoothstep(0.2, 0.6, t));
        col = mix(col, fg.rgb, smoothstep(0.75, 1.0, t) * 0.7);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
