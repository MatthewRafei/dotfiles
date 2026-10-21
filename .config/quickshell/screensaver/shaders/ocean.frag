#version 440
// ASCII Ocean: a night sea in characters on the ASCII scenes' grid. Swells
// roll in under perspective, each cell picking a glyph by the height of the
// water there (troughs ".", slopes "-" "~", crests "=", breaking foam "*"),
// a moon of "@" hangs over the horizon and its light lies on the water as a
// shimmering path. A few stars blink. Drawn by ShaderScene.qml for the
// "ocean" scene (glyphs ".-~=*@").
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o ocean.frag.qsb ocean.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas members and the seed
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    vec2 cell;          // grid cell in logical px
    float glyphCount;   // 6: . - ~ = * @
    float seed;
};

layout(binding = 1) uniform sampler2D atlas;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 13.0) * 43758.5453); }

// water height at (x, z) in world units: a few travelling swells
float swell(vec2 p, float t) {
    float h = 0.0;
    h += 0.50 * sin(p.y * 0.9 - t * 1.1 + p.x * 0.15);
    h += 0.30 * sin(p.y * 1.7 + p.x * 0.6 - t * 1.7);
    h += 0.18 * sin(p.y * 2.9 - p.x * 1.1 - t * 2.3);
    h += 0.10 * sin(p.x * 3.7 + p.y * 3.1 + t * 2.9);
    return h;                                   // about -1..1
}

// a glyph (0-based index, -1 for none) drawn in colour c into col
vec3 glyph(vec3 col, float g, vec3 c, vec2 px) {
    if (g < -0.5) return col;
    vec2 inCell = fract(px / cell);
    float a = texture(atlas, vec2((g + inCell.x) / glyphCount, inCell.y)).a;
    return mix(col, c, min(a * 1.3, 1.0));
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 id = floor(px / cell);
    vec2 cc = (id + 0.5) * cell;                     // the cell's centre
    float horizon = floor(size.y * 0.42 / cell.y) * cell.y;
    float moonX = size.x * (0.68 + 0.08 * sin(seed * 6.28));
    float moonY = horizon - size.y * 0.2;

    vec3 col = bg.rgb;
    vec3 water = mix(bg.rgb, accent.rgb, 0.55);
    vec3 crest = mix(accent.rgb, fg.rgb, 0.55);
    vec3 moonCol = mix(accent2.rgb, fg.rgb, 0.6);

    if (cc.y < horizon) {
        // sky: the moon as a shaded disc of glyphs, stars
        float r = size.y * 0.075;
        float md = length(vec2((cc.x - moonX), (cc.y - moonY)));
        if (md < r) {
            float shade = 0.55 + 0.45 * sqrt(1.0 - md / r);
            float g = shade > 0.72 ? 5.0 : 3.0;                       // @, = at the rim
            col = glyph(col, g, moonCol * shade, px);
        } else {
            float mp = length(px - vec2(moonX, moonY));
            col += accent2.rgb * 0.08 * exp(-max(mp - r, 0.0) / (size.y * 0.06));
            float s = hash(id);
            if (s > 0.985) {
                float tw = 0.5 + 0.5 * sin(time * (0.6 + s * 2.0) + s * 50.0);
                col = glyph(col, s > 0.997 ? 4.0 : 0.0, mix(bg.rgb, fg.rgb, 0.3 + 0.6 * tw), px);
            }
        }
    } else {
        // sea: rows below the horizon map to distance with perspective
        float below = (cc.y - horizon) / size.y;          // 0 at the horizon
        float z = 0.6 / max(below, 0.004);                 // distance: ~1 at the bottom row
        float x = (cc.x - size.x * 0.5) / size.y * z;
        vec2 w = vec2(x, z) * 6.0;                         // a few swells across the nearest rows
        float h = swell(w, time);
        // slope along the view direction picks between - and ~
        float hn = swell(w + vec2(0.0, 0.5), time);
        float steep = h - hn;
        float g;
        if (h > 0.8) g = 4.0;                              // * foam on top
        else if (h > 0.3) g = 3.0;                         // = crest
        else if (abs(steep) > 0.12) g = 2.0;               // ~ slope
        else if (h > -0.35) g = 1.0;                       // - flat
        else g = 0.0;                                      // . trough
        // sparse far water: drop some glyphs near the horizon
        if (hash(id + floor(time * 2.0)) > 0.35 + 0.65 * smoothstep(0.0, 0.25, below)) g = -1.0;

        float fade = smoothstep(0.0, 0.2, below);
        vec3 c = mix(water, crest, clamp(h * 0.6 + 0.4, 0.0, 1.0));
        // the moon's path: brighter, shimmering, right under it
        float path = exp(-pow((cc.x - moonX) / (size.x * (0.02 + below * 0.12)), 2.0));
        float shimmer = step(0.45, hash(id + floor(time * 4.0) * 3.1));
        c = mix(c, moonCol * 1.25, path * (0.5 + 0.5 * shimmer) * clamp(h + 0.9, 0.0, 1.0));
        col = glyph(col, g, mix(bg.rgb, c, 0.35 + 0.65 * fade), px);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
