#version 440
// Donut: the spinning torus of Andy Sloane's donut.c, ray-marched on the GPU
// and printed in glyphs on the ASCII scenes' own grid: each character cell
// marches one ray from its centre, takes the lit brightness and picks a glyph
// from donut.c's ramp .,-~:;=!*#$@ out of the atlas ShaderScene.qml builds.
// Faces turned away from the light get "." as in the original. Glyphs in the
// wallpaper's accent, brightening toward the text colour.
// Drawn by ShaderScene.qml for the "donut" scene (glyphs ".,-~:;=!*#$@").
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o donut.frag.qsb donut.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas members
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
    float glyphCount;   // glyphs in the atlas row
};

layout(binding = 1) uniform sampler2D atlas;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// donut.c's torus: tube radius 1, ring radius 2 (scaled down by 3)
float torus(vec3 p) {
    p.yz *= rot(time * 0.5);     // donut.c's A
    p.xy *= rot(time * 0.25);    // and B
    vec2 q = vec2(length(p.xz) - 0.667, p.y);
    return length(q) - 0.333;
}

vec3 normalAt(vec3 p) {
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.002;
    return normalize(k.xyy * torus(p + k.xyy * e) + k.yyx * torus(p + k.yyx * e)
                   + k.yxy * torus(p + k.yxy * e) + k.xxx * torus(p + k.xxx * e));
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    vec2 id = floor(px / cell);
    vec2 centre = (id + 0.5) * cell;
    // the torus fills about two thirds of the screen's height; y up
    vec2 uv = vec2(centre.x - 0.5 * size.x, 0.5 * size.y - centre.y) / size.y;

    vec3 ro = vec3(0.0, 0.0, -2.6);
    vec3 rd = normalize(vec3(uv, 1.0));

    // skip rays that miss the torus's bounding sphere
    float b = dot(ro, rd), c = dot(ro, ro) - 1.05 * 1.05;
    float disc = b * b - c;
    vec3 col = bg.rgb;
    if (disc > 0.0) {
        float t = max(-b - sqrt(disc), 0.0);
        bool hit = false;
        for (int i = 0; i < 40; i++) {
            float d = torus(ro + rd * t);
            if (d < 0.001) { hit = true; break; }
            t += d;
            if (t > 4.0) break;
        }
        if (hit) {
            vec3 n = normalAt(ro + rd * t);
            float lum = dot(n, normalize(vec3(0.0, 0.7, -0.7)));   // donut.c's light: up and toward the viewer
            float g = lum > 0.0 ? floor(lum * (glyphCount - 0.01)) : 0.0;
            vec2 inCell = fract(px / cell);
            float a = texture(atlas, vec2((g + inCell.x) / glyphCount, inCell.y)).a;
            vec3 ink = mix(accent.rgb * 0.75, mix(accent.rgb, fg.rgb, 0.6), clamp(lum, 0.0, 1.0));
            col = mix(col, ink, min(a * 1.3, 1.0));   // thin glyph strokes read brighter
        }
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
