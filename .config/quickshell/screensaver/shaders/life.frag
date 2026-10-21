#version 440
// Game of Life: Conway's rules on the ASCII scenes' grid, one cell per
// character, the board wrapping at the edges. About 7.5 generations a second.
// Newborn cells are "@" in the second accent, aging through "#" "*" "+" into
// the first; cells that just died leave a fading "." trail. Every few seconds
// a random patch is reseeded so the board never settles into still life.
// Drawn by ShaderScene.qml for the "life" scene (glyphs "@#*+.", feedback -1:
// one texel per cell; r alive, g age in generations / 64, b trail 1..0).
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o life.frag.qsb life.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas, seed and feedback members
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
    float glyphCount;   // 5: @ # * + .
    float seed;         // 0..1, new each time the scene starts
    float frame;        // feedback steps since the scene started
    vec2 simSize;       // the board in cells
    float feedbackPass; // 1 while stepping the board, 0 when drawing
};

layout(binding = 1) uniform sampler2D atlas;
layout(binding = 5) uniform sampler2D prev;    // the board

const float EVERY = 4.0;    // clock ticks per generation

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 57.3) * 43758.5453); }

vec4 at(vec2 id) {
    return texture(prev, (mod(id, simSize) + 0.5) / simSize);
}

void main() {
    if (feedbackPass > 0.5) {
        vec2 id = floor(qt_TexCoord0 * simSize);
        vec4 c = at(id);
        if (frame < 1.5) {                       // a fresh board: about a third alive
            float alive = step(0.68, hash(id));
            fragColor = vec4(alive, 0.0, 0.0, 1.0);
            return;
        }
        if (mod(frame, EVERY) > 0.5) { fragColor = c; return; }
        float gen = floor(frame / EVERY);

        float n = 0.0;
        for (int y = -1; y <= 1; y++)
            for (int x = -1; x <= 1; x++)
                if (x != 0 || y != 0) n += step(0.5, at(id + vec2(float(x), float(y))).r);
        bool alive = c.r > 0.5;
        bool next = alive ? (n > 1.5 && n < 3.5) : (n > 2.5 && n < 3.5);

        // every 40 generations, a random 7 x 7 patch is thrown back into play
        if (mod(gen, 40.0) < 0.5) {
            vec2 centre = floor(vec2(hash(vec2(gen, 1.0)), hash(vec2(gen, 2.0))) * simSize);
            vec2 d = abs(id - centre);
            if (max(d.x, d.y) < 3.5) next = hash(id + gen) > 0.55;
        }

        float age = next ? (alive ? min(c.g + 1.0 / 64.0, 1.0) : 0.0) : 0.0;
        float trail = next ? 0.0 : (alive ? 1.0 : max(c.b - 0.12, 0.0));
        fragColor = vec4(next ? 1.0 : 0.0, age, trail, 1.0);
        return;
    }

    vec2 px = qt_TexCoord0 * size;
    vec2 id = floor(px / cell);
    vec3 col = bg.rgb;
    if (id.x < simSize.x && id.y < simSize.y) {
        vec4 c = at(id);
        float g = -1.0;
        vec3 ink = fg.rgb;
        if (c.r > 0.5) {
            float age = c.g * 64.0;
            g = age < 1.5 ? 0.0 : age < 6.0 ? 1.0 : age < 20.0 ? 2.0 : 3.0;
            ink = mix(mix(accent2.rgb, fg.rgb, 0.3), accent.rgb, clamp(age / 20.0, 0.0, 1.0));
        } else if (c.b > 0.05) {
            g = 4.0;
            ink = mix(bg.rgb, accent.rgb, c.b * 0.7);
        }
        if (g > -0.5) {
            vec2 inCell = fract(px / cell);
            float a = texture(atlas, vec2((g + inCell.x) / glyphCount, inCell.y)).a;
            col = mix(col, ink, min(a * 1.3, 1.0));
        }
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
