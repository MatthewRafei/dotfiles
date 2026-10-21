#version 440
// Flying Toasters: After Dark's chrome toasters flapping across the screen,
// down and to the left, with slices of toast (light to well done) among them,
// in three layers of depth. Flat shapes, chrome tinted toward the accent.
// Each object sits inside its own cell of a lattice that slides with the
// flight, so a pixel only ever checks one object per layer.
// Drawn by ShaderScene.qml for the "toasters" scene.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o toasters.frag.qsb toasters.frag

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

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 37.0) * 43758.5453); }

// turns a point clockwise by a (column-major: rot(a) * p rotates p by -a)
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float box(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float ellipse(vec2 p, vec2 r) {     // approximate
    float k = length(p / r);
    return (k - 1.0) * min(r.x, r.y);
}

// a wing: three feathers fanned from the pivot, raised by `lift` (radians)
float wing(vec2 p, float lift) {
    p = rot(lift) * p;              // the feathers point up-back by lift
    float d = 1e9;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 q = rot(0.1 - 0.32 * fi) * p;
        float len = 0.62 - 0.12 * fi;
        d = min(d, ellipse(q - vec2(len * 0.5, 0.0), vec2(len * 0.5, 0.075)));
    }
    return d;
}

// toaster at p (units: its own size, facing left, y up). Returns colour in rgb,
// coverage in a.
vec4 toaster(vec2 p, float flap, float aa) {
    vec3 chrome = mix(fg.rgb, accent.rgb, 0.35);
    vec4 o = vec4(0.0);
    // the far wing, behind the body and darker
    float lift = 0.15 + 0.75 * (0.5 + 0.5 * sin(flap));
    float dw2 = wing(p - vec2(0.05, 0.22), lift + 0.25);
    o = mix(o, vec4(mix(bg.rgb, fg.rgb, 0.55), 1.0), 1.0 - smoothstep(-aa, aa, dw2));
    // body: rounded box with a top-lit chrome gradient and a highlight stripe
    float db = box(p, vec2(0.5, 0.36), 0.12);
    float shade = 0.55 + 0.45 * smoothstep(-0.36, 0.36, p.y);
    vec3 body = chrome * shade;
    body = mix(body, fg.rgb, 0.6 * (1.0 - smoothstep(0.0, 0.03, abs(p.y - 0.12))) * step(abs(p.x), 0.4));
    o = mix(o, vec4(body, 1.0), 1.0 - smoothstep(-aa, aa, db));
    // outline
    o.rgb = mix(o.rgb, chrome * 0.35, (1.0 - smoothstep(0.0, aa * 2.0, abs(db))) * 0.8);
    // slots on top, a lever on the back
    float ds = min(box(p - vec2(-0.17, 0.3), vec2(0.13, 0.025), 0.02), box(p - vec2(0.17, 0.3), vec2(0.13, 0.025), 0.02));
    o.rgb = mix(o.rgb, bg.rgb * 0.6, 1.0 - smoothstep(-aa, aa, ds));
    float dl = box(p - vec2(0.55, 0.02), vec2(0.06, 0.04), 0.02);
    o = mix(o, vec4(chrome * 0.6, 1.0), 1.0 - smoothstep(-aa, aa, dl));
    // the near wing, over the body
    float dw = wing(p - vec2(0.12, 0.2), lift);
    vec3 feather = mix(fg.rgb, accent2.rgb, 0.15);
    o = mix(o, vec4(feather, 1.0), 1.0 - smoothstep(-aa, aa, dw));
    o.rgb = mix(o.rgb, feather * 0.55, (1.0 - smoothstep(0.0, aa * 2.0, abs(dw))) * 0.7);
    return o;
}

// a slice of toast, doneness 0..1
vec4 toast(vec2 p, float done, float aa) {
    p = rot(0.25) * p;
    float d = min(box(p - vec2(0.0, -0.06), vec2(0.34, 0.28), 0.06),
                  min(length(p - vec2(-0.17, 0.2)) - 0.19, length(p - vec2(0.17, 0.2)) - 0.19));
    vec3 crust = mix(vec3(0.62, 0.38, 0.18), vec3(0.32, 0.17, 0.08), done);
    vec3 crumb = mix(vec3(0.93, 0.80, 0.55), vec3(0.62, 0.40, 0.20), done);
    crumb = mix(crumb, accent2.rgb, 0.12);
    vec3 c = mix(crust, crumb, smoothstep(-0.05, -0.08, d));
    return vec4(c, 1.0 - smoothstep(-aa, aa, d));
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec3 col = bg.rgb;

    // three layers, far to near: smaller, slower and dimmer at the back
    for (int L = 0; L < 3; L++) {
        float fl = float(L);
        float cs = size.y * (0.22 + 0.1 * fl);           // cell size
        float speed = size.y * (0.05 + 0.035 * fl);       // px per second
        vec2 vel = vec2(-1.0, -0.55) * speed;             // left and down (y is down in px)
        vec2 w = px - vel * time + fl * 1000.0;
        vec2 id = floor(w / cs);
        if (hash(id + fl * 7.0) > 0.55) continue;          // empty cell
        vec2 centre = (id + 0.5 + (vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5) * 0.12) * cs;
        float s = cs * 0.4;                               // object size
        vec2 p = (w - centre) / s;
        p.y = -p.y;                                       // y up
        float aa = 1.2 / s;
        vec4 o;
        if (hash(id + 5.1 + fl) < 0.68) o = toaster(p, time * (5.0 + hash(id) * 2.0) + hash(id + 9.0) * 6.28, aa);
        else o = toast(p, hash(id + 11.0), aa);
        float depth = 0.55 + 0.225 * fl;                  // 0.55, 0.775, 1.0
        o.rgb = mix(bg.rgb, o.rgb, depth);
        col = mix(col, o.rgb, o.a);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
