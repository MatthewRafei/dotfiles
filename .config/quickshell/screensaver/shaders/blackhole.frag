#version 440
// Black Hole: a Schwarzschild black hole with a thin accretion disk, seen
// from just above the disk's plane. Each ray is bent by gravity as it's
// stepped through (the light-bending trick: acceleration -1.5 h^2 r / |r|^5,
// h the ray's angular momentum), so the far side of the disk shows arched over
// the shadow and a thin lensed image wraps under it, and the starfield
// behind smears into an Einstein ring. The disk turns faster toward the
// middle, and the side coming toward us is brighter (Doppler beaming).
// Colours from the wallpaper: accent2 hot inside, accent outside.
// Drawn by ShaderScene.qml for the "blackhole" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o blackhole.frag.qsb blackhole.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the seed
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    float seed;
};

const float RIN = 2.6;       // disk inner edge (horizon radius 1)
const float ROUT = 9.0;      // and outer

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + seed * 17.0) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + 1.0), f.x), f.y);
}

// stars and a faint nebula in the direction d
vec3 sky(vec3 d) {
    vec3 col = bg.rgb * 0.6;
    // stars on a direction lattice
    vec3 q = d * 140.0;
    vec3 id = floor(q);
    float h = hash(id);
    float s = step(0.992, h) * smoothstep(0.45, 0.0, length(fract(q) - 0.5));
    col += mix(fg.rgb, accent2.rgb, hash(id + 3.0) * 0.5) * s * (0.6 + 0.8 * hash(id + 7.0));
    // nebula
    float n = noise(d.xy * 3.0 + d.z * 2.0) * noise(d.yz * 5.0 + 3.0);
    col += mix(accent.rgb, accent2.rgb, noise(d.xz * 2.0)) * n * 0.12;
    return col;
}

// the disk's colour and opacity where a ray crosses it at p (y = 0), going rd
vec4 disk(vec3 p, vec3 rd) {
    float r = length(p.xz);
    if (r < RIN || r > ROUT) return vec4(0.0);
    float phi = atan(p.z, p.x);
    float omega = 9.6 * pow(r, -1.5);                       // Keplerian
    // streaks along the orbit. Turning each ring at its own speed winds the
    // pattern tighter forever (and it soon aliases), so two copies each
    // wound for at most 6 s cross-fade into each other (a flow-map blend)
    float p0 = fract(time / 6.0), p1 = fract(time / 6.0 + 0.5);
    float a0 = phi + omega * p0 * 6.0 + 1.7, a1 = phi + omega * p1 * 6.0;
    float n0 = noise(vec2(a0 * 6.0, r * 2.2)) * 0.6 + noise(vec2(a0 * 9.0, r * 3.5)) * 0.4;
    float n1 = noise(vec2(a1 * 6.0, r * 2.2)) * 0.6 + noise(vec2(a1 * 9.0, r * 3.5)) * 0.4;
    float n = mix(n0, n1, abs(p0 - 0.5) * 2.0);
    float x = (r - RIN) / (ROUT - RIN);                     // 0 inside .. 1 outside
    float heat = pow(1.0 - x, 1.6);
    vec3 c = mix(accent.rgb, accent2.rgb, smoothstep(0.1, 0.7, heat));
    c = mix(c, fg.rgb, smoothstep(0.8, 1.0, heat) * 0.5);   // white-hot only at the inner edge
    // Doppler: the side moving toward the viewer is brighter
    vec3 vel = normalize(vec3(-p.z, 0.0, p.x));
    float beam = 1.0 + 0.75 * dot(vel, -rd);
    float alpha = smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.55, x) * (0.45 + 0.55 * n);
    return vec4(c * (0.45 + 1.1 * heat) * beam * (0.55 + 0.7 * n), clamp(alpha, 0.0, 1.0));
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 uv = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;

    // camera a little above the disk's plane, drifting slowly around it
    float ang = seed * 6.28 + time * 0.01;
    vec3 ro = vec3(sin(ang) * 26.0, 2.4 + 0.4 * sin(time * 0.05), cos(ang) * 26.0);
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    vec3 rd = normalize(fw * 1.5 + uv.x * rt + uv.y * up);

    vec3 pos = ro, vel = rd;
    vec3 h = cross(pos, vel);
    float h2 = dot(h, h);
    vec3 col = vec3(0.0);
    float trans = 1.0;              // how much light from behind still gets through
    bool captured = false;
    for (int i = 0; i < 110; i++) {
        float r = length(pos);
        if (r < 1.0) { captured = true; break; }
        if (r > 30.0 && dot(pos, vel) > 0.0) break;
        float dt = clamp(0.08 * r, 0.04, 1.2);              // finer near the hole
        vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
        vec3 next = pos + vel * dt;
        vel = normalize(vel + acc * dt);
        // crossing the disk's plane: add the disk there, front to back
        if (pos.y * next.y < 0.0) {
            vec3 hit = mix(pos, next, pos.y / (pos.y - next.y));
            vec4 d = disk(hit, vel);
            col += trans * d.rgb * d.a;
            trans *= 1.0 - d.a;
            if (trans < 0.02) break;
        }
        pos = next;
    }
    if (!captured) col += trans * sky(vel);
    col = col / (1.0 + col * 0.6);                          // gentle tone map
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
