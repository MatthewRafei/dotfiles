#version 440
// Word Clock: the time spelled out on an 11 x 10 grid of letters, to the five
// minutes ("IT IS TWENTY PAST TEN"), with AM or PM lit and a dot in a corner
// for each minute past. Unlit letters stay faint. Words that just lit fade in.
// Letters from the atlas in the shell's font at 64 px (glyphs A-Z, glyphPx 64).
// Drawn by ShaderScene.qml for the "wordclock" scene.
//
// The grid, packed four letters to a float in base 26 (A = 0, the row's
// columns 0-3, 4-7 and 8-10 per float, first letter lowest: "ACQU" is
// 0 + 2*26 + 16*676 + 20*17576). Floats hold these exactly (< 2^24).
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o wordclock.frag.qsb wordclock.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas members and the clock
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (follow the wallpaper)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    vec2 cell;          // an atlas glyph's cell in logical px
    float glyphCount;   // 26: A-Z
    vec4 clock;         // hour (1-12), minute, second, pm
};

layout(binding = 1) uniform sampler2D atlas;

vec3 rowCode(float row) {
    if (row < 0.5) return vec3(148546.0, 12186.0, 8514.0);    // ITLISASAMPM
    if (row < 1.5) return vec3(362388.0, 83590.0, 1447.0);    // ACQUARTERDC
    if (row < 2.5) return vec3(231783.0, 144631.0, 15673.0);  // TWENTYFIVEX
    if (row < 3.5) return vec3(95323.0, 231704.0, 9963.0);    // HALFSTENFTO
    if (row < 4.5) return vec3(346127.0, 242454.0, 3050.0);   // PASTERUNINE
    if (row < 5.5) return vec3(319424.0, 136482.0, 2825.0);   // ONESIXTHREE
    if (row < 6.5) return vec3(312681.0, 84713.0, 10055.0);   // FOURFIVETWO
    if (row < 7.5) return vec3(127300.0, 77863.0, 8913.0);    // EIGHTELEVEN
    if (row < 8.5) return vec3(84622.0, 85683.0, 3261.0);     // SEVENTWELVE
    return vec3(325279.0, 195056.0, 6826.0);                  // TENSEOCLOCK
}

float letterAt(float row, float col) {
    vec3 c = rowCode(row);
    float part = floor(col / 4.0);
    float v = part < 0.5 ? c.x : part < 1.5 ? c.y : c.z;
    float k = col - part * 4.0;
    // exact powers: pow() can land a hair under and drop a letter
    float p = k < 0.5 ? 1.0 : k < 1.5 ? 26.0 : k < 2.5 ? 676.0 : 17576.0;
    return mod(floor(v / p + 0.001), 26.0);
}

// a word: row, first column, length
bool inWord(float row, float col, vec3 w) {
    return abs(row - w.x) < 0.5 && col > w.y - 0.5 && col < w.y + w.z - 0.5;
}

vec3 hourWord(float h) {
    if (h < 1.5) return vec3(5.0, 0.0, 3.0);    // ONE
    if (h < 2.5) return vec3(6.0, 8.0, 3.0);    // TWO
    if (h < 3.5) return vec3(5.0, 6.0, 5.0);    // THREE
    if (h < 4.5) return vec3(6.0, 0.0, 4.0);    // FOUR
    if (h < 5.5) return vec3(6.0, 4.0, 4.0);    // FIVE
    if (h < 6.5) return vec3(5.0, 3.0, 3.0);    // SIX
    if (h < 7.5) return vec3(8.0, 0.0, 5.0);    // SEVEN
    if (h < 8.5) return vec3(7.0, 0.0, 5.0);    // EIGHT
    if (h < 9.5) return vec3(4.0, 7.0, 4.0);    // NINE
    if (h < 10.5) return vec3(9.0, 0.0, 3.0);   // TEN
    if (h < 11.5) return vec3(7.0, 5.0, 6.0);   // ELEVEN
    return vec3(8.0, 5.0, 6.0);                 // TWELVE
}

// is the letter lit at hour h (1-12), minute m, pm?
bool lit(float row, float col, float h, float m, float pm) {
    float m5 = floor(m / 5.0);
    if (inWord(row, col, vec3(0.0, 0.0, 2.0)) || inWord(row, col, vec3(0.0, 3.0, 2.0))) return true;   // IT IS
    if (inWord(row, col, pm > 0.5 ? vec3(0.0, 9.0, 2.0) : vec3(0.0, 7.0, 2.0))) return true;         // PM / AM
    float hh = m5 > 6.5 ? (h > 11.5 ? 1.0 : h + 1.0) : h;
    if (inWord(row, col, hourWord(hh))) return true;
    if (m5 < 0.5) return inWord(row, col, vec3(9.0, 5.0, 6.0));                                      // O'CLOCK
    bool past = m5 < 6.5;
    if (m5 > 5.5 && m5 < 6.5) return inWord(row, col, vec3(3.0, 0.0, 4.0))                            // HALF
                                  || inWord(row, col, vec3(4.0, 0.0, 4.0));                           // PAST
    if (inWord(row, col, past ? vec3(4.0, 0.0, 4.0) : vec3(3.0, 9.0, 2.0))) return true;             // PAST / TO
    float k = past ? m5 : 12.0 - m5;    // 1 five, 2 ten, 3 quarter, 4 twenty, 5 twenty-five
    if (k > 0.5 && k < 1.5) return inWord(row, col, vec3(2.0, 6.0, 4.0));
    if (k > 1.5 && k < 2.5) return inWord(row, col, vec3(3.0, 5.0, 3.0));
    if (k > 2.5 && k < 3.5) return inWord(row, col, vec3(1.0, 0.0, 1.0)) || inWord(row, col, vec3(1.0, 2.0, 7.0));
    if (k > 3.5 && k < 4.5) return inWord(row, col, vec3(2.0, 0.0, 6.0));
    return inWord(row, col, vec3(2.0, 0.0, 10.0));                                                    // TWENTYFIVE
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    // the grid: 11 x 10 square cells, filling most of the height, centred
    float cs = min(size.x * 0.8 / 11.0, size.y * 0.78 / 10.0);
    vec2 origin = 0.5 * size - vec2(5.5, 5.0) * cs;
    vec2 g = (px - origin) / cs;
    vec2 id = floor(g);
    vec3 col = bg.rgb;

    if (id.x >= 0.0 && id.x < 11.0 && id.y >= 0.0 && id.y < 10.0) {
        float L = letterAt(id.y, id.x);
        // the glyph keeps its aspect: as tall as 0.8 of the cell
        vec2 inCell = fract(g) - 0.5;
        float gh = 0.8, gw = gh * cell.x / cell.y;
        vec2 uv = inCell / vec2(gw, gh) + 0.5;
        float a = 0.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0)
            a = texture(atlas, vec2((L + uv.x) / glyphCount, uv.y)).a;

        bool on = lit(id.y, id.x, clock.x, clock.y, clock.w);
        // fade in during the first two seconds of a new five minutes
        float m5start = mod(clock.y, 5.0) < 0.5 ? clamp(clock.z / 2.0, 0.0, 1.0) : 1.0;
        bool was = lit(id.y, id.x, clock.x, clock.y - 1.0 < 0.0 ? 59.0 : clock.y - 1.0, clock.w);
        float k = on ? (was ? 1.0 : m5start) : (was && mod(clock.y, 5.0) < 0.5 ? 1.0 - m5start : 0.0);
        vec3 dim = mix(bg.rgb, fg.rgb, 0.1);
        vec3 bright = mix(accent.rgb, fg.rgb, 0.35 + 0.1 * sin(time * 0.8 + id.x * 0.4 + id.y * 0.3));
        col = mix(col, mix(dim, bright, k), a);
        // a soft glow behind lit letters
        col += accent.rgb * 0.06 * k * (1.0 - smoothstep(0.0, 0.6, length(inCell)));
    }

    // the minutes past the five: one dot per minute in the corners, clockwise from top left
    float extra = mod(clock.y, 5.0);
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 corner = vec2(fi > 0.5 && fi < 2.5 ? 11.6 : -0.6, fi > 1.5 ? 10.6 : -0.6);
        float d = length((px - origin) / cs - corner);
        float on = fi < extra - 0.5 ? 1.0 : 0.0;
        float dot = 1.0 - smoothstep(0.1, 0.13, d);
        col = mix(col, mix(mix(bg.rgb, fg.rgb, 0.1), accent2.rgb, on), dot);
    }

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
