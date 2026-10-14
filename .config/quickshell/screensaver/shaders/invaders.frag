#version 440
// Space Invaders, attract mode: an endless self-playing game. The 5 x 11
// formation marches and drops with its two-frame step, the cannon slides
// under a target and shoots the lowest invader left in that column, invaders
// burst, bombs zig-zag down, four bunkers stand over the green ground, and the
// score counts up in the shell's font. The mystery ship crosses the top once a
// wave - and about one wave in four, Clawd hops across instead.
// Arcade colours: a red band for the mystery ship, a green one at the bottom.
// Drawn by ShaderScene.qml for the "invaders" scene (glyphs "0123456789SCORE").
//
// Everything is a function of time. Who dies when is worked out once per frame
// in ShaderScene.qml's state pass (statePass = 1, a 128 x 1 strip): the wave
// has 64 shot slots, KILL seconds apart; at each the cannon takes the first
// column, from a shuffled start, whose lowest invader it can hit without a
// bunker in the way, and holds fire if there is none. The main pass reads the
// strip. `seed` (new each showing) picks the shuffle and the Clawd roll.
//
// No integer % or bit operations: Qt may run the GLSL 1.20 build.
// Sprites are packed by invaders_sprites.py, which rewrites the block between
// the @sprites markers (edit the bitmaps there, then run it): one float per
// row, bit x = pixel x from the left.
//
// Rebuild after editing:
//   /usr/lib64/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//       -o invaders.frag.qsb invaders.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// ShaderScene.qml's uniforms, with the glyph atlas members and the seed
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 size;          // item size in logical px
    float time;         // seconds
    vec4 accent;        // Theme colours (unused: the arcade keeps its own)
    vec4 accent2;
    vec4 bg;
    vec4 fg;
    vec2 cell;          // grid cell in logical px
    float glyphCount;   // glyphs in the atlas row: 0-9, S C O R E
    float seed;         // 0..1, new each time the scene starts
    float statePass;    // 1 in the state pass, 0 when drawing
};

layout(binding = 1) uniform sampler2D atlas;
layout(binding = 4) uniform sampler2D state;    // the state pass's strip (layout above computeState)

// @sprites begin
const vec4 SQUID_A0 = vec4(24.0, 60.0, 126.0, 219.0);
const vec4 SQUID_A1 = vec4(255.0, 36.0, 90.0, 165.0);
const vec4 SQUID_B0 = vec4(24.0, 60.0, 126.0, 219.0);
const vec4 SQUID_B1 = vec4(255.0, 90.0, 129.0, 66.0);
const vec4 CRAB_A0 = vec4(260.0, 136.0, 508.0, 886.0);
const vec4 CRAB_A1 = vec4(2047.0, 1533.0, 1285.0, 216.0);
const vec4 CRAB_B0 = vec4(260.0, 1161.0, 1533.0, 1911.0);
const vec4 CRAB_B1 = vec4(2047.0, 1022.0, 260.0, 514.0);
const vec4 OCTO_A0 = vec4(240.0, 2046.0, 4095.0, 3687.0);
const vec4 OCTO_A1 = vec4(4095.0, 408.0, 876.0, 3075.0);
const vec4 OCTO_B0 = vec4(240.0, 2046.0, 4095.0, 3687.0);
const vec4 OCTO_B1 = vec4(4095.0, 924.0, 1638.0, 780.0);
const vec4 BOOM0 = vec4(2322.0, 1188.0, 520.0, 6147.0);
const vec4 BOOM1 = vec4(520.0, 1188.0, 2322.0, 0.0);
const vec4 CANNON0 = vec4(64.0, 224.0, 224.0, 4094.0);
const vec4 CANNON1 = vec4(8191.0, 8191.0, 8191.0, 8191.0);
const vec4 UFO0 = vec4(2016.0, 8184.0, 16380.0, 28086.0);
const vec4 UFO1 = vec4(65535.0, 14748.0, 4104.0, 0.0);
const vec4 BOMB_A0 = vec4(2.0, 1.0, 2.0, 4.0);
const vec4 BOMB_A1 = vec4(2.0, 1.0, 2.0, 0.0);
const vec4 BOMB_B0 = vec4(2.0, 4.0, 2.0, 1.0);
const vec4 BOMB_B1 = vec4(2.0, 4.0, 2.0, 0.0);
const vec4 BUNKER0 = vec4(262128.0, 524280.0, 1048572.0, 2097150.0);
const vec4 BUNKER1 = vec4(4194303.0, 4194303.0, 4194303.0, 4194303.0);
const vec4 BUNKER2 = vec4(4194303.0, 4194303.0, 4194303.0, 4194303.0);
const vec4 BUNKER3 = vec4(4161663.0, 4128831.0, 4063263.0, 4063263.0);
const vec4 CLAWD0 = vec4(16380.0, 16380.0, 14316.0, 14316.0);
const vec4 CLAWD1 = vec4(65535.0, 65535.0, 16380.0, 16380.0);
const vec4 CLAWD2 = vec4(5160.0, 5160.0, 0.0, 0.0);
// @sprites end

const float FIELD_H = 256.0;   // arcade pixels from top to bottom of the screen
const float T0 = 1.5;          // first shot slot, seconds into a wave
const float KILL = 0.48;       // seconds between shot slots
const float SLOTS = 64.0;      // shot slots per wave (55 kills, plus room to hold fire)
const float WAVE = 35.0;       // seconds per wave
const float STEP_T = 0.4;      // the formation steps this often
const float STEP_X = 4.0;      // by this many pixels
const float SHOT_V = 400.0;    // cannon shot, pixels per second
const float BOMB_V = 90.0;
const float CANNON_Y = 216.0;
const float BUNKER_Y = 188.0;
const vec3 WHITE = vec3(0.92);
const vec3 GREEN = vec3(0.22, 1.0, 0.28);
const vec3 RED = vec3(1.0, 0.28, 0.28);
const vec3 CLAWD = vec3(0.757, 0.373, 0.235);     // #C15F3C

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec4 pick4(float i) { return vec4(equal(vec4(i), vec4(0.0, 1.0, 2.0, 3.0))); }
float bitAt(float row, float x) { return mod(floor(row / exp2(x)), 2.0); }

// pixel l (local, y down) of a sprite w wide, rows packed in a0..a3 (up to 16 rows)
float spr(vec4 a0, vec4 a1, vec4 a2, vec4 a3, vec2 l, float w, float h) {
    if (l.x < 0.0 || l.y < 0.0 || l.x >= w || l.y >= h) return 0.0;
    float q = floor(l.y / 4.0);
    vec4 r = q < 0.5 ? a0 : q < 1.5 ? a1 : q < 2.5 ? a2 : a3;
    return bitAt(dot(r, pick4(l.y - q * 4.0)), l.x);
}
float spr8(vec4 a0, vec4 a1, vec2 l, float w) { return spr(a0, a1, vec4(0.0), vec4(0.0), l, w, 8.0); }

// ---------------------------------------------------------------- the wave
float W;               // field width in arcade pixels
float A, B;            // this wave's shuffle: slot k starts looking at column k * A + B (mod 11)

void shuffle(float wave) {
    float i = floor(hash(vec2(wave + 0.37, seed * 997.0 + 1.0)) * 8.0);
    A = i < 1.0 ? 2.0 : i < 2.0 ? 3.0 : i < 3.0 ? 4.0 : i < 4.0 ? 5.0 : i < 5.0 ? 6.0 : i < 6.0 ? 7.0 : i < 7.0 ? 8.0 : 9.0;
    B = floor(hash(vec2(wave + 5.1, seed * 313.0 + 2.0)) * 11.0);
}

float bunkerX(float i) { return floor(W * (i + 0.5) / 4.0) - 11.0; }
// a shot going up at x misses every bunker (with a pixel to spare)
bool clearShot(float x) {
    for (int i = 0; i < 4; i++) {
        float bx = bunkerX(float(i));
        if (x >= bx - 1.0 && x < bx + 23.0) return false;
    }
    return true;
}

// formation's top-left at time t: steps sideways, bounces, drops (at most 4 times)
vec2 formation(float t) {
    float n = floor(max(t, 0.0) / STEP_T);
    float range = max(W - 176.0 - 24.0, STEP_X);
    float travel = n * STEP_X;
    float leg = floor(travel / range);
    float pos = travel - leg * range;
    float x = mod(leg, 2.0) < 0.5 ? pos : range - pos;
    return vec2(12.0 + floor(x), 64.0 + min(leg, 4.0) * 8.0);
}

float slotTime(float k) { return T0 + k * KILL; }

// slot k shooting the j-th invader from the bottom of column c: (shot x, fire time)
vec2 aim(float k, float c, float j) {
    float t = slotTime(k);
    float targetY = formation(t).y + (4.0 - j) * 16.0 + 8.0;
    float fire = t - (CANNON_Y - targetY) / SHOT_V;
    return vec2(formation(fire).x + c * 16.0 + 8.0, fire);
}

// ---------------------------------------------------------------- state pass
// texel i < 55:  the slot that kills invader i (column i mod 11, i / 11 from
//                the bottom), 255 if it survives the wave
// texel 64 + k:  column and row slot k shoots at, 255 if it holds fire
// texel 60:      where the previous wave's last shot was fired from (x / 256, x mod 256)
vec4 simulate(float i, bool lastShotOnly) {
    float cnt[11];
    for (int c = 0; c < 11; c++) cnt[c] = 0.0;
    float ic = mod(i, 11.0), ij = floor(i / 11.0);
    vec4 res = vec4(1.0, 1.0, 0.0, 1.0);
    float lastX = floor(W * 0.5);
    for (int k = 0; k < 64; k++) {
        float fk = float(k);
        float start = mod(fk * A + B, 11.0);
        float chosen = -1.0, cj = 0.0, cx = 0.0;
        for (int t = 0; t < 11; t++) {
            float c = mod(start + float(t), 11.0);
            float n = cnt[int(c)];
            if (n < 4.5) {
                float x = aim(fk, c, n).x;
                if (clearShot(x)) { chosen = c; cj = n; cx = x; break; }
            }
        }
        if (chosen >= 0.0) {
            cnt[int(chosen)] = cj + 1.0;
            lastX = cx;
            if (i < 55.0 && abs(chosen - ic) < 0.5 && abs(cj - ij) < 0.5) res.r = fk / 255.0;
            if (abs(i - 64.0 - fk) < 0.5) res.rg = vec2(chosen, cj) / 255.0;
        }
    }
    if (lastShotOnly) res = vec4(floor(lastX / 256.0) / 255.0, mod(lastX, 256.0) / 255.0, 0.0, 1.0);
    return res;
}

// ---------------------------------------------------------------- reading the strip
vec4 st(float i) { return texture(state, vec2((i + 0.5) / 128.0, 0.5)); }
float byteOf(float v) { return floor(v * 255.0 + 0.5); }
float killTime(float c, float j) {
    float k = byteOf(st(j * 11.0 + c).r);
    return k > 254.5 ? 1e6 : slotTime(k);
}
// column and row slot k shoots at; x = 255 when it holds fire
vec2 slotHit(float k) { vec4 v = st(64.0 + k); return vec2(byteOf(v.r), byteOf(v.g)); }
// the first slot from k on (dir 1) or before k (dir -1) that fires, within 4; -1 if none
float findShot(float k, float dir) {
    float found = -1.0;
    for (int n = 0; n < 4; n++) {
        float fk = dir > 0.0 ? k + float(n) : k - 1.0 - float(n);
        if (found < 0.0 && fk >= 0.0 && fk < SLOTS && slotHit(fk).x < 254.5) found = fk;
    }
    return found;
}
vec2 shotOf(float k) { vec2 h = slotHit(k); return aim(k, h.x, h.y); }

// ---------------------------------------------------------------- drawing
vec3 band(float y) { return y < 32.0 ? WHITE : y < 56.0 ? RED : y > 184.0 ? GREEN : WHITE; }

float glyph(vec2 lp, vec2 at, float g, float scale) {
    vec2 c = cell * scale;
    vec2 q = (lp - at) / c;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= 1.0 || q.y >= 1.0) return 0.0;
    return texture(atlas, vec2((g + q.x) / glyphCount, q.y)).a;
}

void main() {
    float S = size.y / FIELD_H;                    // logical px per arcade pixel
    W = floor(size.x / S);
    float wave = floor(time / WAVE);
    float tw = time - wave * WAVE;

    if (statePass > 0.5) {
        float i = floor(qt_TexCoord0.x * 128.0);
        bool last = abs(i - 60.0) < 0.5;
        shuffle(last ? wave - 1.0 : wave);
        fragColor = simulate(i, last);
        return;
    }
    shuffle(wave);

    vec2 lp = qt_TexCoord0 * size;                 // logical px, y down
    vec2 g = floor(lp / S);                        // arcade pixel, y down
    vec3 col = vec3(0.0);
    float on = 0.0;

    // bunkers
    for (int i = 0; i < 4; i++)
        on = max(on, spr(BUNKER0, BUNKER1, BUNKER2, BUNKER3, g - vec2(bunkerX(float(i)), BUNKER_Y), 22.0, 16.0));

    // the formation
    vec2 f = formation(tw);
    float frame = mod(floor(max(tw, 0.0) / STEP_T), 2.0);
    vec2 inF = g - f;
    float c = floor(inF.x / 16.0), r = floor(inF.y / 16.0);
    if (c >= 0.0 && c < 11.0 && r >= 0.0 && r < 5.0) {
        vec2 l = inF - vec2(c, r) * 16.0;
        float kt = killTime(c, 4.0 - r);
        if (tw < kt) {
            if (r < 0.5) on = max(on, frame < 0.5 ? spr8(SQUID_A0, SQUID_A1, l - vec2(4.0, 0.0), 8.0) : spr8(SQUID_B0, SQUID_B1, l - vec2(4.0, 0.0), 8.0));
            else if (r < 2.5) on = max(on, frame < 0.5 ? spr8(CRAB_A0, CRAB_A1, l - vec2(2.0, 0.0), 11.0) : spr8(CRAB_B0, CRAB_B1, l - vec2(2.0, 0.0), 11.0));
            else on = max(on, frame < 0.5 ? spr8(OCTO_A0, OCTO_A1, l - vec2(2.0, 0.0), 12.0) : spr8(OCTO_B0, OCTO_B1, l - vec2(2.0, 0.0), 12.0));
        } else if (tw < kt + 0.25) {
            on = max(on, spr8(BOOM0, BOOM1, l - vec2(1.0, 0.0), 13.0));
        }
    }

    // the cannon: slides under its next shot, fires, moves on
    vec4 prev = st(60.0);
    float startX = wave > 0.5 ? byteOf(prev.r) * 256.0 + byteOf(prev.g) - 6.0 : floor(W * 0.5) - 6.0;
    float kNext = clamp(ceil((tw - T0) / KILL + 1e-4), 0.0, SLOTS);   // first slot still to come
    float kf = findShot(kNext, 1.0);
    float cannonX = startX;
    if (kf >= 0.0) {
        vec2 s = shotOf(kf);
        float target = kf;
        if (s.y <= tw) {
            // that shot is in the air: draw it, head for the one after
            float sy = CANNON_Y - (tw - s.y) * SHOT_V;
            if (abs(g.x - s.x) < 0.5 && g.y >= sy - 4.0 && g.y < sy) on = 1.0;
            float after = findShot(kf + 1.0, 1.0);
            if (after >= 0.0) target = after;
        }
        vec2 to = shotOf(target);
        float kp = findShot(target, -1.0);
        vec2 from = kp >= 0.0 ? shotOf(kp) : vec2(startX + 6.0, 0.0);
        cannonX = floor(mix(from.x, to.x, smoothstep(from.y, to.y - 0.06, tw))) - 6.0;
    } else {
        float kl = findShot(kNext, -1.0);
        if (kl >= 0.0) cannonX = shotOf(kl).x - 6.0;
    }
    on = max(on, spr8(CANNON0, CANNON1, g - vec2(cannonX, CANNON_Y), 13.0));

    // bombs: two streams, each from the lowest invader left in a random column;
    // a bomb stops at a bunker or at the ground
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float n = floor((tw - 2.0 - fi * 0.8) / 1.6);
        if (n < 0.0) continue;
        float dropT = 2.0 + fi * 0.8 + n * 1.6;
        float bc = floor(hash(vec2(n + fi * 37.0, wave + seed * 51.0)) * 11.0);
        float src = -1.0;
        for (int j = 0; j < 5; j++) {
            if (src < 0.0 && killTime(bc, float(j)) > dropT) src = float(j);
        }
        if (src < 0.0) continue;
        vec2 fd = formation(dropT);
        vec2 b = vec2(fd.x + bc * 16.0 + 7.0, fd.y + (4.0 - src) * 16.0 + 8.0 + (tw - dropT) * BOMB_V);
        float floorY = 232.0;
        for (int k = 0; k < 4; k++) {
            float bx = bunkerX(float(k));
            if (b.x + 2.0 >= bx && b.x < bx + 22.0) floorY = BUNKER_Y;
        }
        if (b.y + 7.0 > floorY) continue;
        vec2 l = g - floor(b);
        on = max(on, mod(floor(tw * 8.0), 2.0) < 0.5 ? spr8(BOMB_A0, BOMB_A1, l, 3.0) : spr8(BOMB_B0, BOMB_B1, l, 3.0));
    }

    col = band(g.y) * on;

    // the mystery ship crosses once a wave; about one wave in four it's Clawd
    float ufoT = tw - 9.0;
    float crossing = (W + 40.0) / 45.0;
    if (ufoT > 0.0 && ufoT < crossing) {
        bool right = hash(vec2(wave + 9.3, seed * 71.0)) < 0.5;
        float ux = floor(right ? -20.0 + ufoT * 45.0 : W + 4.0 - ufoT * 45.0);
        bool clawd = hash(vec2(wave + 2.7, seed * 433.0 + 3.0)) < 0.25;
        if (clawd) {
            float hop = mod(floor(ufoT * 4.0), 2.0);             // a little hop as it goes
            float px = spr(CLAWD0, CLAWD1, CLAWD2, vec4(0.0), g - vec2(ux, 34.0 - hop), 16.0, 10.0);
            col = mix(col, CLAWD, px);
        } else {
            col = mix(col, RED, spr8(UFO0, UFO1, g - vec2(ux, 38.0), 16.0));
        }
    }

    // ground, and the reserve cannons under it
    if (abs(g.y - 239.0) < 0.5) col = GREEN;
    for (int i = 0; i < 2; i++)
        col = max(col, GREEN * spr8(CANNON0, CANNON1, g - vec2(26.0 + float(i) * 16.0, 243.0), 13.0));
    col = max(col, GREEN * glyph(lp, vec2(8.0, 242.0) * S, 3.0, 2.0 * S / 3.75));

    // SCORE 0000, counting this showing's kills (every invader row by its points)
    vec2 at = vec2(8.0, 8.0) * S;
    float sc = 2.0 * S / 3.75;
    if (lp.y >= at.y && lp.y < at.y + cell.y * sc && lp.x >= at.x && lp.x < at.x + cell.x * sc * 10.0) {
        float i = floor((lp.x - at.x) / (cell.x * sc));
        vec2 gat = at + vec2(i * cell.x * sc, 0.0);
        float ch = -1.0;
        if (i < 4.5) ch = 10.0 + i;                              // S C O R E
        else if (i > 5.5) {
            float score = wave * 990.0;                          // full waves: 11 x (10 + 10 + 20 + 20 + 30)
            for (int k = 0; k < 64; k++) {
                float fk = float(k);
                if (slotTime(fk) > tw) break;
                vec2 h = slotHit(fk);
                if (h.x > 254.5) continue;
                score += h.y < 1.5 ? 10.0 : h.y < 3.5 ? 20.0 : 30.0;
            }
            float div = i < 6.5 ? 1000.0 : i < 7.5 ? 100.0 : i < 8.5 ? 10.0 : 1.0;
            ch = mod(floor(mod(score, 10000.0) / div), 10.0);
        }
        if (ch >= 0.0) col = max(col, WHITE * glyph(lp, gat, ch, sc));
    }

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
