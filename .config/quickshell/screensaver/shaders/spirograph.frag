#version 440
// Spirograph: a pen on a gear rolling inside a ring draws a hypotrochoid,
// line by line, its colour drifting from one accent to the other along the
// way. When the figure closes it holds for a moment, fades, and a new gear
// starts. Drawn by ShaderScene.qml for the "spirograph" scene, on its
// feedback canvas (feedback 1: the canvas is the screen, ink kept between
// steps): the feedback pass adds the pen's latest stretch to the canvas, the
// main pass shows it with a soft glow and the pen.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o spirograph.frag.qsb spirograph.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the seed and the feedback members
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
    float frame;        // feedback steps since the scene started
    vec2 simSize;       // the canvas in texels
    float feedbackPass; // 1 while updating the canvas, 0 when drawing
};

layout(binding = 5) uniform sampler2D prev;    // the canvas: ink rgb, coverage a

const float PI = 3.14159265;
const float DRAW = 36.0;    // seconds to draw a figure
const float HOLD = 7.0;     // then shown whole
const float FADE = 3.0;     // then fading out
const float CYCLE = DRAW + HOLD + FADE;

float hash(float n) { return fract(sin(n * 12.9898 + seed * 78.233) * 43758.5453); }

// the figure for cycle n, as the toy's parts: a ring of R teeth (96 or 105),
// a gear of r (24..81) and the pen hole d. x R, y r, z d, w gcd(R, r): the
// curve closes after r / gcd turns with R / gcd petals.
vec4 figure(float n) {
    float R = hash(n) < 0.5 ? 96.0 : 105.0;
    float r = 24.0 + floor(hash(n + 0.3) * 20.0) * 3.0;
    float a = R, b = r;
    for (int j = 0; j < 16; j++) { if (b > 0.5) { float t = mod(a, b); a = b; b = t; } }
    float d = r * (0.45 + 0.45 * hash(n + 0.7));
    return vec4(R, r, d, a);
}

// pen position (px) for figure f at progress u (0..1 of the closed curve)
vec2 pen(vec4 f, float u) {
    float th = u * 2.0 * PI * f.y / f.w;
    float k = (f.x - f.y) / f.y;
    vec2 p = (f.x - f.y) * vec2(cos(th), sin(th)) + f.z * vec2(cos(k * th), -sin(k * th));
    float scale = 0.44 * min(size.x, size.y) / (f.x - f.y + f.z);
    return 0.5 * size + p * scale;
}

float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

vec3 inkAt(float u) {
    float w = 0.5 + 0.5 * sin(u * 2.0 * PI * 2.0);
    return mix(accent.rgb, accent2.rgb, w);
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    float n = floor(time / CYCLE);
    float tc = time - n * CYCLE;
    vec4 f = figure(n);

    if (feedbackPass > 0.5) {
        vec4 c = texture(prev, qt_TexCoord0);
        // a fresh canvas at the start and for every new figure
        if (frame < 1.5 || tc < 0.15) { fragColor = vec4(0.0); return; }
        if (tc > DRAW + HOLD) {                   // fading
            fragColor = c * 0.93;
            return;
        }
        if (tc > DRAW + 0.2) { fragColor = c; return; }
        // the stretch drawn since the last step (overlapping a little, in
        // case a tick ran long), as 12 short segments
        float u1 = clamp(tc / DRAW, 0.0, 1.0);
        float u0 = clamp((tc - 0.12) / DRAW, 0.0, 1.0);
        float d = 1e9;
        vec2 a = pen(f, u0);
        for (int i = 1; i <= 12; i++) {
            vec2 b = pen(f, mix(u0, u1, float(i) / 12.0));
            d = min(d, segDist(px, a, b));
            a = b;
        }
        float cov = 1.0 - smoothstep(0.6, 1.6, d);
        vec3 ink = inkAt(u1);
        fragColor = vec4(mix(c.rgb, ink, cov), max(c.a, cov));
        return;
    }

    // drawing: canvas over the background with a little glow, and the pen
    vec4 c = texture(prev, qt_TexCoord0);
    vec2 texel = 1.0 / simSize;
    vec4 glow = vec4(0.0);
    for (int i = 0; i < 8; i++) {
        float ang = float(i) * PI * 0.25;
        glow += texture(prev, qt_TexCoord0 + vec2(cos(ang), sin(ang)) * texel * 3.0);
    }
    glow /= 8.0;
    vec3 col = bg.rgb;
    col += glow.rgb * 0.35;
    col = mix(col, c.rgb, c.a);

    if (tc < DRAW) {
        vec2 pp = pen(f, tc / DRAW);
        float dp = length(px - pp);
        col = mix(col, fg.rgb, 1.0 - smoothstep(2.0, 3.5, dp));
        col += fg.rgb * 0.25 * exp(-dp * 0.15);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
