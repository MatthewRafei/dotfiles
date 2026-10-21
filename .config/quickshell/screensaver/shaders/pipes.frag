#version 440
// Pipes: the Windows 3D Pipes screensaver. Pipes grow through a 12 x 12 x 12
// grid, mostly straight, turning now and then with a ball joint at each bend,
// never through a cell already taken. A pipe ends when it's boxed in (or at
// random, to make room for others) and a new one starts somewhere free, in a
// new colour from the wallpaper's palette. After
// 128 segments the scene holds, fades and starts over.
// Drawn by ShaderScene.qml for the "pipes" scene (state: the walk is worked
// out once per frame in the state pass, one node per texel of the 128 x 1
// strip: rgb the cell (x + 0.5) / 16, a the pipe number / 16, plus 0.5 where
// a new pipe starts). The main pass intersects each ray with the segments
// directly (all axis-aligned cylinders) rather than marching.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o pipes.frag.qsb pipes.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the seed and the state pass
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px (the screen's, in both passes)
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    float seed;         // 0..1, new each time the scene starts
    float statePass;    // 1 in the state pass, 0 when drawing
};

layout(binding = 4) uniform sampler2D state;

const float N = 12.0;        // cells per side
const float NODES = 128.0;
const float RATE = 4.0;      // nodes per second
const float GROW = NODES / RATE;
const float HOLD = 4.0;
const float FADE = 2.0;
const float CYCLE = GROW + HOLD + FADE;
const float R = 0.17;        // pipe radius (cell = 1)
const float JOINT = 0.25;    // ball joint radius

float hash(float a, float b) { return fract(sin(a * 12.9898 + b * 78.233 + seed * 41.0) * 43758.5453); }

vec3 dirVec(float d) {
    if (d < 0.5) return vec3(1.0, 0.0, 0.0);
    if (d < 1.5) return vec3(-1.0, 0.0, 0.0);
    if (d < 2.5) return vec3(0.0, 1.0, 0.0);
    if (d < 3.5) return vec3(0.0, -1.0, 0.0);
    if (d < 4.5) return vec3(0.0, 0.0, 1.0);
    return vec3(0.0, 0.0, -1.0);
}

bool inside(vec3 p) { return all(greaterThanEqual(p, vec3(0.0))) && all(lessThan(p, vec3(N))); }

// ---------------------------------------------------------------- state pass
vec4 computeState(float I, float cyc) {
    vec3 pts[128];
    vec3 pos = floor(vec3(hash(cyc, 1.0), hash(cyc, 2.0), hash(cyc, 3.0)) * N);
    float dir = floor(hash(cyc, 4.0) * 6.0);
    float pipe = 0.0;
    float start = 1.0;
    float run = 0.0;            // segments in the current pipe
    pts[0] = pos;
    for (int k = 1; k < 128; k++) {
        float fk = float(k);
        if (fk > I + 0.5) break;
        // keep going straight most of the time, else turn somewhere random
        float pref = hash(cyc, fk * 3.1) < 0.72 ? dir : floor(hash(cyc, fk * 5.7) * 6.0);
        bool moved = false;
        for (int j = 0; j < 6; j++) {
            float d = mod(pref + float(j), 6.0);
            vec3 np = pos + dirVec(d);
            if (!inside(np)) continue;
            bool taken = false;
            for (int m = 0; m < 128; m++) {
                if (m >= k) break;
                if (all(equal(pts[m], np))) { taken = true; break; }
            }
            if (taken) continue;
            pos = np; dir = d; moved = true;
            break;
        }
        start = 0.0;
        // boxed in, or now and then anyway (about 3% a step, so a handful of
        // pipes a cycle): a new pipe from a free cell (a few random tries)
        run += 1.0;
        if (!moved || (run > 4.5 && hash(cyc, fk * 13.7) < 0.03)) {
            run = 0.0;
            pipe += 1.0;
            start = 1.0;
            for (int t = 0; t < 12; t++) {
                vec3 c = floor(vec3(hash(fk, float(t) + cyc), hash(fk + 0.3, float(t) + cyc), hash(fk + 0.7, float(t) + cyc)) * N);
                bool taken = false;
                for (int m = 0; m < 128; m++) {
                    if (m >= k) break;
                    if (all(equal(pts[m], c))) { taken = true; break; }
                }
                if (!taken) { pos = c; break; }
            }
            dir = floor(hash(cyc, fk * 9.3) * 6.0);
        }
        pts[k] = pos;
    }
    return vec4((pos + 0.5) / 16.0, (mod(pipe, 8.0) + 0.5) / 16.0 + 0.5 * start);
}

// ---------------------------------------------------------------- main pass
void node(float i, out vec3 p, out float pipe, out float start) {
    vec4 s = texture(state, vec2((i + 0.5) / NODES, 0.5));
    p = floor(s.rgb * 16.0) - (N - 1.0) * 0.5;     // centred on the origin
    start = s.a > 0.5 ? 1.0 : 0.0;
    pipe = floor((s.a - 0.5 * start) * 16.0);
}

vec3 pipeColour(float k) {
    float t = fract(k * 0.37 + seed);
    vec3 c = t < 0.33 ? mix(accent.rgb, accent2.rgb, t * 3.0)
           : t < 0.66 ? mix(accent2.rgb, mix(fg.rgb, accent.rgb, 0.5), (t - 0.33) * 3.0)
           : mix(mix(fg.rgb, accent.rgb, 0.5), accent.rgb, (t - 0.66) * 3.0);
    return c;
}

// ray vs sphere: nearest t > 0 or -1
float sphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd), q = dot(oc, oc) - r * r;
    float h = b * b - q;
    if (h < 0.0) return -1.0;
    float t = -b - sqrt(h);
    return t > 0.0 ? t : -1.0;
}

// ray vs the cylinder of radius R from a to b (axis-aligned, but any works)
float cylinder(vec3 ro, vec3 rd, vec3 a, vec3 b, out vec3 n) {
    vec3 e = b - a;
    float len = length(e);
    e /= len;
    vec3 oa = ro - a;
    vec3 o2 = oa - dot(oa, e) * e;
    vec3 d2 = rd - dot(rd, e) * e;
    float A = dot(d2, d2), B = dot(o2, d2), C = dot(o2, o2) - R * R;
    float h = B * B - A * C;
    if (h < 0.0 || A < 1e-6) return -1.0;
    float t = (-B - sqrt(h)) / A;
    if (t < 0.0) return -1.0;
    float s = dot(oa + rd * t, e);
    if (s < 0.0 || s > len) return -1.0;
    vec3 hit = oa + rd * t;
    n = normalize(hit - s * e);
    return t;
}

void main() {
    float cyc = floor(time / CYCLE);
    float tc = time - cyc * CYCLE;

    if (statePass > 0.5) {
        fragColor = computeState(floor(qt_TexCoord0.x * NODES), cyc);
        return;
    }

    vec2 px = qt_TexCoord0 * size;
    vec2 uv = (vec2(px.x, size.y - px.y) - 0.5 * size) / size.y;
    // camera: a slow drift around the grid
    float ang = 0.7 + 0.25 * sin(time * 0.03) + seed * 6.28;
    vec3 ro = vec3(sin(ang) * 25.0, 6.0, cos(ang) * 25.0);
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    vec3 rd = normalize(fw * 1.7 + uv.x * rt + uv.y * up);

    float grown = min(tc * RATE, NODES - 1.0);
    float best = 1e9;
    vec3 bn = vec3(0.0);
    float bpipe = 0.0;

    vec3 pPrev, pCur, pNext;
    float kPrev, kCur, kNext, sPrev, sCur, sNext;
    node(0.0, pCur, kCur, sCur);
    node(1.0, pNext, kNext, sNext);
    pPrev = pCur; kPrev = kCur; sPrev = 1.0;
    for (int i = 0; i < 128; i++) {
        float fi = float(i);
        if (fi > grown + 1.0) break;
        if (i > 0) {
            // the segment that ends at node i, growing while it's the newest
            if (sCur < 0.5) {
                vec3 a = pPrev;
                vec3 b = fi > grown ? mix(pPrev, pCur, fract(grown)) : pCur;
                vec3 c = 0.5 * (a + b);
                float rr = 0.5 * length(b - a) + R;
                vec3 oc = ro - c;
                float bb = dot(oc, rd);
                if (bb * bb - dot(oc, oc) + rr * rr > 0.0) {   // its bounding sphere is hit
                    vec3 n;
                    float t = cylinder(ro, rd, a, b, n);
                    if (t > 0.0 && t < best) { best = t; bn = n; bpipe = kCur; }
                }
            }
        }
        if (fi <= grown) {
            // ball joints at bends, caps where a pipe starts or ends
            bool endsHere = sNext > 0.5 || fi + 1.0 > grown;
            bool bend = sCur < 0.5 && !endsHere && dot(pCur - pPrev, pNext - pCur) < 0.5;
            if (sCur > 0.5 || endsHere || bend) {
                float r = bend ? JOINT : R;
                float t = sphere(ro, rd, pCur, r);
                if (t > 0.0 && t < best) { best = t; bn = normalize(ro + rd * t - pCur); bpipe = kCur; }
            }
        }
        pPrev = pCur; kPrev = kCur; sPrev = sCur;
        pCur = pNext; kCur = kNext; sCur = sNext;
        node(fi + 2.0, pNext, kNext, sNext);
    }

    vec3 col = mix(bg.rgb, bg.rgb * 0.7, length(uv) * 0.8);
    if (best < 1e8) {
        // lit from over the viewer's left shoulder, whichever side the camera is on
        vec3 L = normalize(-rt * 0.5 + up * 0.8 - fw * 0.5);
        vec3 base = pipeColour(bpipe);
        float diff = max(dot(bn, L), 0.0);
        float spec = pow(max(dot(reflect(rd, bn), L), 0.0), 40.0);
        float rim = pow(1.0 - max(dot(bn, -rd), 0.0), 3.0);
        col = base * (0.18 + 0.85 * diff) + fg.rgb * spec * 0.8 + base * rim * 0.25;
    }
    // fade between cycles
    col = mix(col, bg.rgb, smoothstep(GROW + HOLD, CYCLE, tc));
    col = mix(bg.rgb, col, smoothstep(0.0, 0.4, tc));
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
