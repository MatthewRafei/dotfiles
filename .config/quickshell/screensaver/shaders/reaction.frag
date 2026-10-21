#version 440
// Reaction-Diffusion: the Gray-Scott model growing Turing patterns from a
// scatter of seeds: coral, dividing cells or worms (one family per showing,
// with the feed rate drifting a little across the screen so neighbouring
// regions differ). Drawn as lit relief in the wallpaper's colours.
// Drawn by ShaderScene.qml for the "reaction" scene (feedback 0.33: the
// simulation runs on a third-size grid; r u, g v, one step per clock tick, so
// it is seeded densely enough to fill the screen within a minute).
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o reaction.frag.qsb reaction.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the seed and feedback members
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
    vec2 simSize;       // the grid in texels
    float feedbackPass; // 1 while stepping, 0 when drawing
};

layout(binding = 5) uniform sampler2D prev;    // r: u, g: v

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 91.3) * 43758.5453); }

// closed edges: a cell past the border reads as the border cell
vec2 at(vec2 id) { return texture(prev, (clamp(id, vec2(0.0), simSize - 1.0) + 0.5) / simSize).rg; }

// feed and kill for this showing's family, the feed drifting across x
vec2 params(vec2 uv) {
    vec2 fk = seed < 0.34 ? vec2(0.0545, 0.062)     // coral
            : seed < 0.67 ? vec2(0.0367, 0.0649)    // mitosis
            : vec2(0.078, 0.061);                   // worms
    fk.x += 0.0015 * sin(uv.x * 4.0 + seed * 20.0) * sin(uv.y * 3.0);
    return fk;
}

void main() {
    if (feedbackPass > 0.5) {
        vec2 id = floor(qt_TexCoord0 * simSize);
        if (frame < 1.5) {
            // u = 1 everywhere, v seeded in small blobs, one in most 12 x 12 blocks
            vec2 cellId = floor(id / 12.0);
            vec2 centre = (cellId + 0.25 + 0.5 * vec2(hash(cellId), hash(cellId + 7.0))) * 12.0;
            float on = step(0.3, hash(cellId + 3.0)) * step(length(id - centre), 2.5 + 2.0 * hash(cellId + 5.0));
            // coral and worms need full-strength seeds; mitosis dies on them
            float v0 = seed >= 0.34 && seed < 0.67 ? 0.25 : 1.0;
            fragColor = vec4(1.0 - 0.5 * on, v0 * on, 0.0, 1.0);
            return;
        }
        vec2 c = at(id);
        // 9-point Laplacian
        vec2 lap = -c
            + 0.2 * (at(id + vec2(1.0, 0.0)) + at(id - vec2(1.0, 0.0)) + at(id + vec2(0.0, 1.0)) + at(id - vec2(0.0, 1.0)))
            + 0.05 * (at(id + vec2(1.0, 1.0)) + at(id + vec2(-1.0, 1.0)) + at(id + vec2(1.0, -1.0)) + at(id - vec2(1.0, 1.0)));
        vec2 fk = params(qt_TexCoord0);
        float uvv = c.x * c.y * c.y;
        float u = c.x + (1.0 * lap.x - uvv + fk.x * (1.0 - c.x));
        float v = c.y + (0.5 * lap.y + uvv - (fk.x + fk.y) * c.y);
        fragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
        return;
    }

    // relief: v as height, lit from the top left
    vec2 uv = qt_TexCoord0;
    vec2 t = 1.0 / simSize;
    float h = texture(prev, uv).g;
    float hx = texture(prev, uv + vec2(t.x, 0.0)).g - texture(prev, uv - vec2(t.x, 0.0)).g;
    float hy = texture(prev, uv + vec2(0.0, t.y)).g - texture(prev, uv - vec2(0.0, t.y)).g;
    vec3 n = normalize(vec3(-hx * 6.0, -hy * 6.0, 1.0));
    float light = clamp(dot(n, normalize(vec3(-0.5, -0.6, 0.8))), 0.0, 1.0);
    float k = smoothstep(0.08, 0.35, h);
    vec3 base = mix(bg.rgb, mix(accent.rgb, accent2.rgb, smoothstep(0.2, 0.45, h)), k);
    vec3 col = base * (0.55 + 0.6 * light);
    col += fg.rgb * pow(light, 18.0) * 0.35 * k;          // a little shine on the ridges
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
