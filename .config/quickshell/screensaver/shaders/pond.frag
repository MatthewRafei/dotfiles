#version 440
// Pond: a still lake at night under the moon. Now and then a drop lands and
// its rings spread across the water in perspective, breaking up the moon's
// reflection into glitter. Sky and water are tinted by the wallpaper's
// colours. Drawn by ShaderScene.qml for the "pond" scene.
//
// Ripples are closed-form: each patch of water gets a drop at its own pace,
// a ring is a decaying wave at radius age * speed, and a pixel sums the rings
// from its patch and the eight around it so rings cross patch edges.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o pond.frag.qsb pond.frag

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

const float HORIZON = 0.58;     // screen height of the far shore, from the bottom

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// water height at plane point w: rings from this patch and its neighbours
float ripples(vec2 w) {
    float h = 0.0;
    vec2 cell = floor(w);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = cell + vec2(float(i), float(j));
            float n = hash(id);
            float period = 7.0 + 9.0 * hash(id + 3.7);           // seconds between drops here
            float k = time / period + n * 13.0;
            float age = fract(k) * period;                         // seconds since the last drop
            vec2 at = id + 0.25 + 0.5 * vec2(hash(id + floor(k) * 1.3), hash(id + floor(k) * 2.9 + 5.0));
            float d = length(w - at);
            float r = age * 0.28;                                  // ring radius, patches per second
            float band = d - r;
            float env = exp(-band * band * 40.0) * step(-0.25, -band + 0.25);
            float decay = exp(-age * 0.45) * step(0.3, hash(id + 9.1));   // some patches stay still
            // gone before it outgrows the 3x3 it is summed over: drop at most 0.75 into its
            // patch + radius 0.7 + the wave's own width stays inside the neighbouring patch
            decay *= 1.0 - smoothstep(0.45, 0.7, r);
            h += sin(band * 38.0) * env * decay;
        }
    }
    return h;
}

vec3 sky(float y, vec2 moon, vec2 p, float soft, out float moonLight) {
    float t = clamp((y - HORIZON) / (1.0 - HORIZON), 0.0, 1.0);
    vec3 col = mix(mix(bg.rgb, accent.rgb, 0.16) * 1.4, bg.rgb * 0.5, sqrt(t));
    float md = length(p - moon);
    moonLight = 1.0 - smoothstep(0.045 - soft, 0.048 + soft, md);
    col = mix(col, mix(fg.rgb, accent.rgb, 0.15), moonLight);
    col += mix(fg.rgb, accent.rgb, 0.4) * exp(-md * 9.0) * 0.12;    // halo
    return col;
}

void main() {
    float aspect = size.x / size.y;
    vec2 p = vec2(qt_TexCoord0.x * aspect, 1.0 - qt_TexCoord0.y);      // y up, 1 = screen height
    vec2 moon = vec2(aspect * 0.68, 0.84);
    float moonLight;
    vec3 col;

    if (p.y > HORIZON) {
        col = sky(p.y, moon, p, 0.0, moonLight);
        // a few stars
        vec2 cell = floor(qt_TexCoord0 * size / 4.0);
        float n = hash(cell);
        if (n > 0.997) col += fg.rgb * (0.4 + 0.3 * sin(time * (1.0 + n * 2.0) + n * 70.0)) * smoothstep(HORIZON + 0.05, 1.0, p.y);
        // the far shore: a low, distant skyline
        float shore = HORIZON + 0.012 + 0.02 * hash(vec2(floor(p.x * 90.0), 1.0)) * hash(vec2(floor(p.x * 23.0), 2.0)) * 2.0;
        if (p.y < shore) col = bg.rgb * 0.35;
    } else {
        // the water plane: depth grows toward the horizon
        float below = HORIZON - p.y;
        float z = 0.09 / below;                                    // distance across the water
        vec2 w = vec2((p.x - 0.5 * aspect) * z * 2.2, z * 1.6) * 4.0;
        w.x += 100.5;      // keep the plane positive: rings went missing across x = 0 on Mesa
        float e = 0.08 * z;                                        // sample spacing grows with distance
        float h0 = ripples(w);
        vec2 n = vec2(ripples(w + vec2(e, 0.0)) - h0, ripples(w + vec2(0.0, e)) - h0) / e * 0.012;
        // a gentle swell everywhere, so the moon's reflection shimmers
        n += (1.0 - smoothstep(0.6, 1.6, z)) * 0.035 * vec2(   // gone toward the horizon, where it would tilesin(w.x * 21.0 + w.y * 7.0 + time * 1.1) + 0.6 * sin(w.x * 37.0 - w.y * 12.0 - time * 0.9),
                          sin(w.y * 31.0 - time * 0.8 + w.x * 6.0) + 0.6 * sin(w.y * 53.0 + w.x * 15.0 + time * 1.3));
        n *= 1.0 - smoothstep(1.5, 5.0, z);                        // far ripples are too small to see

        // the mirror image of the sky, nudged by the ripples
        float ry = HORIZON + below * 1.1 + n.y * 0.25;
        col = sky(min(ry, 0.999), moon, vec2(p.x + n.x * 0.4, ry), 0.012, moonLight);   // a softer moon in the water
        col *= 0.55;                                               // water is darker than the sky
        // the moon's path: a column of light under it, broken by the ripples
        float path = exp(-pow((p.x - moon.x + n.x * 1.2) / (0.02 + below * 0.25), 2.0));
        float glint = smoothstep(0.15, 0.6, length(n));
        col += mix(fg.rgb, accent.rgb, 0.25) * path * (0.18 + 0.6 * glint) * smoothstep(0.0, 0.08, below);
        col += mix(fg.rgb, accent2.rgb, 0.5) * glint * 0.05;       // ring edges catch the sky
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
