#version 440
// Planet: a world turning slowly in the dark, its seas and continents made
// of 3D noise in the wallpaper's palette, a cloud layer drifting a little
// faster, a soft terminator with city lights scattered over the night side,
// an atmosphere glowing at the limb, and a small grey moon passing in front
// and behind. One exact sphere intersection per pixel (no marching).
// `seed` picks the world: sea level, axial tilt, where the sun is.
// Drawn by ShaderScene.qml for the "planet" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o planet.frag.qsb planet.frag

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

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + seed * 23.0) * 43758.5453); }

float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                   mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                   mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        s += a * noise3(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return s;
}

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

// ray vs sphere: (near, far) or (-1, -1)
vec2 sphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd), q = dot(oc, oc) - r * r;
    float h = b * b - q;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 uv = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;
    vec3 ro = vec3(0.0, 0.0, -4.2);
    vec3 rd = normalize(vec3(uv, 1.6));

    vec3 sun = normalize(vec3(-0.8 + 0.6 * seed, 0.35, -0.45));
    mat3 spin = rotX(0.25 + 0.3 * seed) * rotY(time * 0.035);
    float sea = 0.47 + 0.08 * fract(seed * 7.0);
    vec3 pc = vec3(0.35, -0.05, 0.0);                         // the planet, a bit right of centre

    // stars
    vec3 col = bg.rgb * 0.5;
    vec3 sq = rd * 300.0;
    vec3 sd = floor(sq);
    float st = step(0.996, hash3(sd)) * smoothstep(0.45, 0.0, length(fract(sq) - 0.5));
    col += fg.rgb * st * (0.4 + 0.6 * hash3(sd + 1.0));

    // the moon: orbiting in a tilted circle, drawn behind or in front
    float ma = time * 0.06 + seed * 6.28;
    vec3 mc = pc + rotX(0.35) * vec3(cos(ma) * 1.9, 0.0, sin(ma) * 1.9);
    vec2 mt = sphere(ro, rd, mc, 0.16);

    vec2 t = sphere(ro, rd, pc, 1.0);
    float tPlanet = t.x > 0.0 ? t.x : 1e9;
    float tMoon = mt.x > 0.0 ? mt.x : 1e9;

    if (tMoon < tPlanet) {
        vec3 n = normalize(ro + rd * tMoon - mc);
        float cr = fbm(n * 6.0, 4);
        vec3 c = mix(bg.rgb, fg.rgb, 0.45 + 0.3 * cr);
        col = c * (0.04 + 0.96 * max(dot(n, sun), 0.0));
    } else if (tPlanet < 1e8) {
        vec3 n = normalize(ro + rd * tPlanet - pc);
        vec3 q = spin * n;                                     // body-fixed point
        float h = fbm(q * 2.2, 6);
        float land = smoothstep(sea, sea + 0.015, h);
        float hl = clamp((h - sea) / 0.25, 0.0, 1.0);
        vec3 ocean = mix(bg.rgb, accent.rgb, 0.45 + 0.35 * smoothstep(sea - 0.15, sea, h));
        vec3 ground = mix(mix(accent2.rgb, accent.rgb, 0.35), mix(accent2.rgb, fg.rgb, 0.5), hl);
        float lat = abs(q.y);
        ground = mix(ground, fg.rgb, smoothstep(0.82, 0.9, lat + h * 0.15));   // ice caps
        vec3 surf = mix(ocean, ground, land);

        float diff = dot(n, sun);
        float day = smoothstep(-0.08, 0.2, diff);
        // a sun glint on the sea
        float glint = pow(max(dot(reflect(rd, n), sun), 0.0), 60.0) * (1.0 - land);
        vec3 lit = surf * (0.08 + 0.95 * max(diff, 0.0)) + fg.rgb * glint * 0.5;

        // city lights on land in the night
        float city = step(0.78, noise3(q * 40.0)) * step(0.55, fbm(q * 6.0, 3)) * land;
        lit += accent2.rgb * city * (1.0 - day) * 0.9;

        // clouds, turning a little faster, casting a faint shade
        vec3 cq = rotY(time * 0.012) * q;
        float cl = smoothstep(0.52, 0.72, fbm(cq * 3.0 + vec3(0.0, time * 0.004, 0.0), 5));
        lit = mix(lit, fg.rgb * (0.06 + 0.9 * max(diff, 0.0)), cl * 0.85);

        // atmosphere toward the limb
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        lit += mix(accent.rgb, accent2.rgb, 0.3) * rim * (0.15 + 0.85 * day) * 0.8;
        col = lit;
    }
    // the glow just off the limb
    vec3 oc = ro - pc;
    float b = dot(oc, rd);
    float dmin = sqrt(max(dot(oc, oc) - b * b, 0.0));         // closest approach to the centre
    if (tPlanet > 1e8 && tMoon > 1e8 - 1.0) {
        vec3 closest = ro + rd * (-b) - pc;
        float lit = smoothstep(-0.3, 0.6, dot(normalize(closest), sun));
        col += mix(accent.rgb, accent2.rgb, 0.3) * exp(-(dmin - 1.0) * 14.0) * step(1.0, dmin) * (0.15 + 0.85 * lit) * 0.7;
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
