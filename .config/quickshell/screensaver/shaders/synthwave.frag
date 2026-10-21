#version 440
// Synthwave: the outrun horizon. A striped sun sinks behind a ridge of
// wireframe-lit mountains while a perspective grid scrolls toward the viewer,
// all in the wallpaper's two accents over a dusk sky. A few stars twinkle up
// top. Drawn by ShaderScene.qml for the "synthwave" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o synthwave.frag.qsb synthwave.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms
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

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(float x) {
    float i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
}

// ridge height at x (screen heights from the horizon)
float ridge(float x) {
    float h = 0.0, a = 0.09, f = 2.2;
    for (int i = 0; i < 4; i++) {
        h += a * abs(noise(x * f) * 2.0 - 1.0);
        f *= 2.1;
        a *= 0.45;
    }
    // a valley in the middle so the sun shows through
    return h * smoothstep(0.08, 0.45, abs(x));
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    // x centred, y up, horizon at 0.42 of the height from the bottom
    vec2 p = vec2(px.x - 0.5 * size.x, size.y * 0.58 - px.y) / size.y;
    float aa = 1.5 / size.y;

    vec3 dusk = mix(bg.rgb, accent.rgb, 0.18);
    vec3 col;

    if (p.y > 0.0) {
        // sky: deep at the top, warm toward the horizon
        col = mix(mix(bg.rgb, accent2.rgb, 0.38), bg.rgb * 0.7, smoothstep(0.0, 0.55, p.y));

        // stars
        vec2 sc = floor(px / 3.0);
        float st = step(0.9975, hash2(sc)) * smoothstep(0.15, 0.4, p.y);
        st *= 0.5 + 0.5 * sin(time * (1.0 + hash2(sc + 7.0) * 3.0) + hash2(sc) * 40.0);
        col += fg.rgb * st * 0.8;

        // sun: accent2 at the top fading to accent, with bands that thicken
        // toward the horizon and slide down
        vec2 sp = p - vec2(0.0, 0.17);
        float r = 0.24;
        float d = length(sp);
        float sun = 1.0 - smoothstep(r - aa, r + aa, d);
        float v = (sp.y + r) / (2.0 * r);                 // 0 at the bottom, 1 at the top
        float bands = fract(v * 9.0 + time * 0.12);
        float gap = mix(0.55, 0.0, smoothstep(0.0, 0.62, v));
        sun *= step(gap, bands);
        vec3 sunCol = mix(accent.rgb * 1.1, accent2.rgb * 1.15, v);
        col = mix(col, sunCol, sun);
        // glow
        col += accent2.rgb * 0.22 * exp(-max(d - r, 0.0) * 9.0);

        // mountains: a dark ridge with its edge lit
        float h = ridge(p.x + 0.13);
        float m = 1.0 - smoothstep(h - aa, h + aa, p.y);
        float rim = (1.0 - smoothstep(0.0, 2.0 * aa, abs(p.y - h))) * step(0.004, h);
        col = mix(col, dusk * 0.55, m);
        col = mix(col, accent.rgb, rim * 0.8);
    } else {
        // ground: a perspective grid scrolling toward the viewer
        float z = 0.16 / -p.y;                          // distance into the screen
        vec2 g = vec2(p.x * z * 2.2, z + time * 0.9);
        vec2 w = fwidth(g);
        vec2 l = abs(fract(g + 0.5) - 0.5) / max(w, 1e-4);
        float m = min(l.x, l.y);
        float line = 1.0 - min(m, 1.0) + 0.35 * exp(-m * 0.5);     // the line and a soft glow
        float fade = exp(-z * 0.18);
        col = mix(bg.rgb * 0.6, dusk * 0.5, smoothstep(0.0, -0.4, p.y));
        col = mix(col, mix(accent2.rgb, accent.rgb, smoothstep(0.0, -0.3, p.y)), clamp(line * fade, 0.0, 1.0));
        // haze at the horizon
        col += accent2.rgb * 0.25 * exp(p.y * 40.0);
    }

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
