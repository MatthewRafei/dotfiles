#version 440
// Embers: sparks rising from an unseen fire below the screen, in five depth
// layers (near ones bigger, softer and faster), swaying on the draught. Each
// one leaves a short trail, flickers, and cools from yellow through orange to
// red until it dies out. A warm glow wobbles in the heat haze at the bottom
// and faint smoke drifts up. Fixed fire colours. Drawn by ShaderScene.qml for
// the "embers" scene.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o embers.frag.qsb embers.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms; every scene shader declares this same block
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (unused: fire keeps its own)
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
    for (int i = 0; i < 4; i++) {
        s += a * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}

// one layer of embers; scale = cells per screen height, depth 0 near .. 1 far
vec3 layer(vec2 p, float scale, float depth, float seed) {
    float speed = mix(0.2, 0.07, depth);                    // screen heights per second
    vec2 q = p * scale;
    q.y -= time * speed * scale;
    // the draught: the whole layer sways, so embers never cross a cell edge
    q.x += sin(q.y * 0.35 + seed + time * 0.2) * 0.5 + sin(q.y * 0.9 + seed * 2.0) * 0.15;

    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float n = hash(id + seed);
    if (n < 0.74) return vec3(0.0);                          // sparse

    vec2 c = (vec2(hash(id + seed + 3.1), hash(id + seed + 7.7)) - 0.5) * 0.5;
    vec2 d = f - c;
    float r = mix(0.1, 0.045, depth) * (0.6 + 0.6 * hash(id + seed + 1.9));
    float dist = length(d);
    // a thin streak below it (it rises), fading with length
    float below = clamp(-d.y / (r * 5.0), 0.0, 1.0);
    float streak = (1.0 - smoothstep(r * 0.15, r * 0.4, abs(d.x))) * smoothstep(r * 0.2, r * 0.7, -d.y) * (1.0 - below) * (1.0 - below);

    // age by height on screen; each ember dies at its own height
    float height = p.y + 0.5;                                // 0 bottom .. 1 top
    float dies = 0.35 + 0.65 * hash(id + seed + 5.3);
    float life = 1.0 - smoothstep(dies - 0.2, dies, height);
    float age = clamp(height / dies, 0.0, 1.0);

    float flicker = 0.65 + 0.35 * sin(time * (4.0 + n * 9.0) + n * 50.0);
    vec3 hot = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.42, 0.08), smoothstep(0.0, 0.5, age));
    hot = mix(hot, vec3(0.7, 0.1, 0.03), smoothstep(0.5, 1.0, age));

    // near embers are out of focus: softer core, wider halo
    float soft = mix(0.6, 0.15, depth);
    float core = 1.0 - smoothstep(r * (1.0 - soft) * 0.6, r * 0.6, dist);
    float halo = exp(-dist / r * 2.2) * 0.35;
    return hot * (core + halo + streak * 0.35) * flicker * life * mix(0.9, 0.6, depth);
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 p = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;   // y up, 1 = screen height

    // heat haze near the bottom bends everything a little
    float hazeAmt = 1.0 - smoothstep(-0.5, 0.0, p.y);
    vec2 hz = vec2(fbm(p * 6.0 + vec2(0.0, -time * 1.2)) - 0.5, 0.0) * 0.03 * hazeAmt;
    vec2 ph = p + hz;

    // the fire's glow from below, breathing slowly
    float breathe = 0.85 + 0.15 * fbm(vec2(time * 0.6, 1.0)) * 2.0;
    float glow = exp(-length((ph - vec2(0.0, -0.8)) * vec2(0.8, 1.2)) * 2.4) * breathe;
    vec3 col = vec3(0.018, 0.010, 0.008) + vec3(1.0, 0.36, 0.08) * glow * 0.75;

    // faint smoke rising through the glow
    float smoke = fbm(ph * vec2(2.0, 1.2) + vec2(0.0, -time * 0.08));
    col += vec3(0.05, 0.03, 0.025) * smoothstep(0.45, 0.8, smoke) * (0.3 + glow);

    col += layer(ph, 4.0, 0.0, 0.0);
    col += layer(ph, 7.0, 0.25, 11.0);
    col += layer(ph, 10.0, 0.5, 23.0);
    col += layer(ph, 14.0, 0.75, 37.0);
    col += layer(ph, 20.0, 1.0, 51.0);

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
