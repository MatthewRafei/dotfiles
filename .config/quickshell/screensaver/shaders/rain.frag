#version 440
// Rain on Glass: the wallpaper seen through a fogged window. Drops slide down
// in two sizes, stalling and lurching, and leave a clear trail with a few
// beads in it; small condensation drops come and go. Through the fog the
// wallpaper is blurred and dim; through a drop or trail it is sharp, and each
// drop bends it like a lens. Drawn by ShaderScene.qml for the "rain" scene
// (with the wallpaper: `wall` sharp, `fog` downscaled).
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o rain.frag.qsb rain.frag

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

layout(binding = 2) uniform sampler2D wall;   // the wallpaper, as on screen
layout(binding = 3) uniform sampler2D fog;    // the same, a twelfth the size

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// sliding drops on a grid of tall cells (scale cells per screen height).
// Returns the lens offset in xy (y up) and how clear the glass is in z.
vec3 slide(vec2 uv, float t, float scale, float seed) {
    vec2 g = uv * vec2(scale, scale * 0.5);
    vec2 id = floor(g);
    vec2 st = fract(g) - 0.5;                       // cell: 1 wide, 2 tall in real units
    float n = hash(id + seed);
    if (n < 0.45) return vec3(0.0);                 // about half the cells carry a drop

    // down the cell once per loop, stalling and lurching
    float ti = fract(t * (0.05 + 0.06 * hash(id + seed + 3.1)) + n * 7.0);
    float y = 0.42 - 0.84 * (ti + 0.06 * sin(ti * 23.0) * (1.0 - ti));
    float x = (hash(id + seed + 5.7) - 0.5) * 0.6 + 0.04 * sin(ti * 11.0 + n * 6.0);
    // grows in at the top of the cell, shrinks out at the bottom: no popping
    float r = 0.16 * smoothstep(0.0, 0.08, ti) * (1.0 - smoothstep(0.9, 1.0, ti));

    vec2 dv = vec2(st.x - x, (st.y - y) * 2.0);
    dv.y += dv.x * dv.x * 1.2;                      // a little teardrop, heavier below
    float dist = length(dv);
    float drop = 1.0 - smoothstep(r * 0.75, r, dist);
    vec2 normal = dv / max(r, 1e-3) * drop;

    // the trail above it: a clear streak with beads, fading with height
    float above = smoothstep(y, y + 0.02, st.y) * (1.0 - smoothstep(y, 0.5, st.y));
    float streak = 1.0 - smoothstep(0.035, 0.07, abs(st.x - x));
    float bv = fract(st.y * 9.0 + n) - 0.5;
    float bead = 1.0 - smoothstep(0.025, 0.045, length(vec2(st.x - x, bv / 9.0 * 2.0)));
    bead *= step(0.5, hash(vec2(id.x, floor(st.y * 9.0 + n)) + seed)) * above;
    vec2 bn = vec2(st.x - x, bv / 9.0 * 2.0) / 0.045 * bead;

    float clear = max(drop, max(streak * above * 0.8, bead));
    return vec3((normal * r + bn * 0.04) / scale, clear);
}

// condensation: small round drops that appear and slowly evaporate
vec3 beads(vec2 uv, float t) {
    vec2 g = uv * 34.0;
    vec2 id = floor(g);
    vec2 st = fract(g) - 0.5;
    float n = hash(id + 11.0);
    if (n < 0.6) return vec3(0.0);
    float life = fract(t * 0.03 + n * 13.0);
    float r = (0.14 + 0.18 * hash(id + 4.4)) * smoothstep(0.0, 0.05, life) * (1.0 - life);
    vec2 dv = st - (vec2(hash(id + 1.3), hash(id + 2.9)) - 0.5) * 0.5;
    float drop = 1.0 - smoothstep(r * 0.7, r, length(dv));
    return vec3(dv / max(r, 1e-3) * drop * r / 34.0, drop);
}

void main() {
    vec2 tex = qt_TexCoord0;
    vec2 uv = vec2(tex.x * size.x / size.y, 1.0 - tex.y);      // y up, 1 = screen height

    vec3 a = slide(uv, time, 4.0, 0.0);
    vec3 b = slide(uv + vec2(0.37, 0.11), time * 1.15, 7.0, 17.0);
    vec3 c = beads(uv, time);
    vec2 lens = (a.xy + b.xy + c.xy) * -1.2;                   // a drop shows the scene flipped
    float clear = clamp(max(max(a.z, b.z), c.z), 0.0, 1.0);

    vec2 off = vec2(lens.x * size.y / size.x, -lens.y);        // to texture space (y down)
    vec3 sharp = texture(wall, clamp(tex + off, 0.0, 1.0)).rgb;
    // through fog: blurred (12 taps on the small copy smooth out its pixels) and dim
    vec2 fpx = 12.0 / size;                                    // one fog texel
    vec3 blur = texture(fog, tex).rgb;
    for (int i = 0; i < 12; i++) {
        float an = float(i) * 0.5236;
        float rr = mod(float(i), 2.0) < 0.5 ? 1.6 : 3.0;   // no integer % (GLSL 1.20 build)
        blur += texture(fog, tex + vec2(cos(an), sin(an)) * fpx * rr).rgb;
    }
    vec3 misty = blur / 13.0 * 0.6 + bg.rgb * 0.25;

    vec3 col = mix(misty, sharp, clear);
    // a glint on each drop's upper left
    vec2 nrm = normalize(a.xy + b.xy + c.xy + 1e-6);
    col += fg.rgb * 0.12 * clear * smoothstep(0.6, 0.95, dot(nrm, normalize(vec2(-0.6, 0.8))));
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
