#version 440
// CRT: an old monitor over the ASCII scenes (Settings > Screensaver > CRT).
// Screensaver.qml renders the whole screensaver screen into a layer and runs
// it through this: curved glass with a dark bezel past the edges, a little
// colour fringing, phosphor glow around bright text, scanlines and an aperture
// grille, a slow faint rolling bar, and a vignette. The scene's own colours
// are kept; only the glass is added.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o crt.frag.qsb crt.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
};

layout(binding = 1) uniform sampler2D source;   // the screensaver screen

void main() {
    // curved glass: push the picture outward toward the corners
    vec2 q = qt_TexCoord0 * 2.0 - 1.0;
    q *= 1.0 + 0.045 * dot(q, q);
    vec2 uv = q * 0.5 + 0.5;

    // past the glass: the dark bezel, with soft rounded corners
    vec2 edge = abs(q) - vec2(1.0);
    float outside = max(edge.x, edge.y);
    if (outside > 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0) * qt_Opacity; return; }

    vec2 texel = 1.0 / size;
    // colour fringing: red and blue land a fraction of a pixel apart
    vec3 col;
    col.r = texture(source, uv + vec2(texel.x * 0.7, 0.0)).r;
    col.g = texture(source, uv).g;
    col.b = texture(source, uv - vec2(texel.x * 0.7, 0.0)).b;

    // phosphor glow: bright text bleeds a little light around itself
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        glow += texture(source, uv + vec2(cos(a), sin(a)) * texel * 2.5).rgb;
    }
    col += glow / 8.0 * 0.45;

    vec2 px = uv * size;
    // scanlines every 3 px, and a faint aperture grille of RGB stripes
    float scan = 0.74 + 0.26 * sin(px.y * 2.0944);
    float stripe = mod(floor(px.x), 3.0);
    vec3 grille = stripe < 1.0 ? vec3(1.0, 0.9, 0.9) : stripe < 2.0 ? vec3(0.9, 1.0, 0.9) : vec3(0.9, 0.9, 1.0);
    col *= scan * grille * 1.18;

    // a slow, faint bar rolling down the screen
    float roll = exp(-pow((fract(uv.y - time * 0.07) - 0.5) * 9.0, 2.0));
    col += vec3(0.025) * roll;

    // vignette and a soft fade into the bezel at the corners
    float vig = pow(clamp(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.0, 1.0), 0.22);
    col *= vig * (1.0 - smoothstep(-0.02, 0.0, outside));
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
