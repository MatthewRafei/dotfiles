#version 440
// Aurora: curtains of light over mountain ridges, under a field of twinkling
// stars. The curtains glow accent2 at their lower edge and
// fade to accent as they rise (green into pink, like a real aurora, on most
// wallpapers). Drawn by ShaderScene.qml for the "aurora" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o aurora.frag.qsb aurora.frag

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

const float GROUND = -0.5;     // foot of the ridges: the screen's bottom edge

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

// three curtains, each a folding lower edge with a bright hem and fine
// vertical rays fading upward
vec3 aurora(vec2 q) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float x = q.x;
        float edge = -0.16 + fi * 0.07
                   + 0.07 * sin(x * 1.7 + time * 0.06 + fi * 2.0)
                   + 0.22 * (fbm(vec2(x * 1.2 - time * 0.03, fi * 5.0)) - 0.5);
        float dy = q.y - edge;
        if (dy < -0.12) continue;
        float lower = exp(min(dy, 0.0) * 70.0);            // a soft glow below the hem, no hard edge
        float rise = exp(-max(dy, 0.0) * (3.2 + fi * 1.2));
        float hem = exp(-abs(dy) * 45.0);
        float rx = x * 70.0 + fbm(vec2(x * 4.0, time * 0.08 + fi)) * 9.0;
        float r = noise(vec2(rx, time * 0.3 + fi * 10.0));
        float rays = 0.45 + 0.55 * r;
        float pulse = 0.65 + 0.35 * sin(x * 2.3 - time * 0.35 + fi * 1.7);
        // each curtain thins out and breaks along its length, drifting slowly
        float along = smoothstep(0.35, 0.7, fbm(vec2(x * 0.7 + time * 0.02, fi * 9.0)));
        vec3 c = mix(accent2.rgb, accent.rgb, smoothstep(0.02, 0.3, dy));
        col += c * lower * (rise * rays + hem * 0.8) * pulse * along * (0.9 - fi * 0.15);
    }
    return col;
}

// sky, stars, aurora, two ridges
vec3 scene(vec2 q, vec2 px) {
    float t = clamp((q.y - GROUND) / (0.5 - GROUND), 0.0, 1.0);    // 0 horizon .. 1 top
    vec3 col = mix(bg.rgb * 1.7 + vec3(0.0, 0.01, 0.025), bg.rgb * 0.5, t);

    // stars: a few per 4 px cell grid, each a soft dot that twinkles
    vec2 cell = floor(px / 4.0);
    float n = hash(cell);
    if (n > 0.996) {
        vec2 at = vec2(hash(cell + 1.3), hash(cell + 2.7));
        float d = length(fract(px / 4.0) - at) * 4.0;
        float tw = 0.55 + 0.45 * sin(time * (1.0 + n * 3.0) + n * 80.0);
        col += fg.rgb * (1.0 - smoothstep(0.3, 1.3, d)) * tw * smoothstep(0.1, 0.45, t);
    }

    col += aurora(q);

    // a far ridge in the haze, then a near one, sharp-peaked and nearly black
    float aa = 1.5 / size.y;
    float farN = fbm(vec2(q.x * 1.3, 3.0));
    float far = GROUND + 0.10 + 0.15 * (1.0 - abs(2.0 * farN - 1.0));
    col = mix(col, bg.rgb * 0.8 + accent2.rgb * 0.015, 1.0 - smoothstep(far - aa, far, q.y));
    float nearN = fbm(vec2(q.x * 2.2 + 7.0, 5.0));
    float near = GROUND + 0.04 + 0.10 * (1.0 - abs(2.0 * nearN - 1.0)) * (0.6 + 0.4 * sin(q.x * 0.9));
    col = mix(col, bg.rgb * 0.35, 1.0 - smoothstep(near - aa, near, q.y));
    return col;
}

void main() {
    vec2 px = vec2(qt_TexCoord0.x * size.x, (1.0 - qt_TexCoord0.y) * size.y);   // y up, logical px
    vec2 p = (px - 0.5 * size) / size.y;

    vec3 col = scene(p, px);
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
