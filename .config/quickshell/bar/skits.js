.pragma library

// Reads the skit files in ../skits/ (format in skits/README.md) and turns
// a skit into frames { t, ms, color?, sparkle? } for Quote.qml to play.
// parse() runs once per load; expand() runs every time a skit plays, so
// random times and {?a|b} picks differ between plays.

// ---------------- frames made in code ----------------
const GEN = {
    // [■■■□□□□□] 37%
    progress: a => {
        const n = +a[0] || 8, f = []
        for (let i = 0; i <= n; i++)
            f.push({ t: "[" + "■".repeat(i) + "□".repeat(n - i) + "] " + Math.round(i / n * 100) + "%", ms: 160 + Math.random() * 160 })
        return f
    },

    // Pac-Man eats the dots with a ghost on his tail, gets the power
    // pellet, turns and eats the ghost
    pacman: () => {
        const W = 20, f = []
        const line = cells => cells.join("").replace(/\s+$/, "")
        for (let p = 0; p <= W; p++) {
            const c = []
            for (let i = 0; i <= W; i++)
                c.push(i === W ? "◉" : i > p && i % 2 === 0 ? "•" : " ")
            if (p - 4 >= 0) c[p - 4] = "ᗣ"
            c[Math.min(p, W)] = p % 2 === 0 ? "ᗧ" : "●"
            f.push({ t: line(c), ms: 120 })
        }
        let g = W - 4, p = W
        f.push({ t: line(Array(g).fill(" ").concat(["ᗣ", " ", " ", " ", "ᗤ"])), ms: 450, color: "accent2" })
        for (let k = 0; g > 0 && p - g > 1; k++) {
            if (k % 2 === 0) g--
            p--
            const c = Array(W + 1).fill(" ")
            c[g] = "ᗣ"
            c[p] = k % 2 === 0 ? "ᗤ" : "●"
            f.push({ t: line(c), ms: 110, color: "accent2" })
        }
        const c = Array(W + 1).fill(" ")
        c[g] = "2"; c[g + 1] = "0"; c[g + 2] = "0"
        f.push({ t: line(c), ms: 900, color: "accent2", sparkle: true })
        return f
    },

    // a conveyor belt carrying things along
    belt: a => {
        const W = 22, g = a[0] || "⚙", f = []
        for (let k = 0; k < 26; k++) {
            let t = ""
            for (let i = 0; i < W; i++)
                t += (i + k) % 5 === 0 ? g : (i - k % 2) % 2 === 0 ? "›" : " "
            f.push({ t: "[" + t + "]", ms: 120 })
        }
        return f
    },

    // falling katakana
    rain: () => {
        const chars = "ｱｲｳｴｵｶｷｸｹｺ01ﾊﾋﾌﾍﾎ", f = []
        for (let k = 0; k < 10; k++) {
            let t = ""
            for (let i = 0; i < 22; i++) t += Math.random() < 0.3 ? " " : chars[Math.floor(Math.random() * chars.length)]
            f.push({ t: t, ms: 110, color: "accent2" })
        }
        return f
    }
}

// ---------------- the skit files ----------------
// The skits/ files arrive concatenated, each one after a "#> name" line.
function parse(text) {
    const out = { skits: {}, events: {}, errors: [] }
    let file = "?", line = 0, name = "", stack = []
    const fail = why => out.errors.push(file + ":" + line + " " + why)
    const close = () => { if (stack.length > 1) fail("'" + name + "': repeat without end") }

    for (const raw of text.split("\n")) {
        line++
        const l = raw.replace(/\s+$/, "")
        if (l.startsWith("#> ")) { close(); file = l.slice(3); line = 0; stack = []; continue }
        if (l === "" || l[0] === "#") continue

        const head = l.match(/^([@!])(\S+)$/)
        if (head) {
            close()
            name = head[2]
            const pool = head[1] === "@" ? out.skits : out.events
            if (out.skits[name] || out.events[name]) fail("'" + name + "' is defined twice")
            pool[name] = []
            stack = [pool[name]]
            continue
        }
        if (!stack.length) { fail("frame before any @name"); continue }
        const ops = stack[stack.length - 1]

        let m
        if ((m = l.match(/^\s*repeat\s+(\d+)$/))) {
            const r = { op: "repeat", n: +m[1], body: [] }
            ops.push(r)
            stack.push(r.body)
        } else if (/^\s*end$/.test(l)) {
            if (stack.length > 1) stack.pop()
            else fail("end without repeat")
        } else if ((m = l.match(/^\s*gen\s+(\w+)\s*(.*)$/))) {
            if (!GEN[m[1]]) fail("unknown generator '" + m[1] + "'")
            else ops.push({ op: "gen", name: m[1], args: m[2].split(/\s+/).filter(a => a) })
        } else {
            const bar = l.indexOf("|")
            if (bar < 0) { fail("not a frame: " + l.trim()); continue }
            const words = l.slice(0, bar).trim().split(/\s+/)
            let t = l.slice(bar + 1)
            if (t[0] === " ") t = t.slice(1)
            const o = { op: "frame", text: t, color: "", sparkle: false }
            if (words[0] === "type" || words[0] === "erase") o.op = words.shift()
            const ms = (words.shift() || "").match(/^(\d+)(?:-(\d+))?$/)
            if (!ms) { fail("frame needs a time in ms"); continue }
            o.lo = +ms[1]
            o.hi = ms[2] ? +ms[2] : o.lo
            for (const w of words) {
                if (w === "sparkle") o.sparkle = true
                else if (w === "danger" || w === "accent2" || w === "dim") o.color = w
                else fail("unknown flag '" + w + "'")
            }
            if (o.op !== "frame") {
                const p = t.match(/^(.*?)«(.*?)»(.*)$/)
                if (!p) { fail(o.op + " needs a «part»"); continue }
                o.pre = p[1]; o.mid = Array.from(p[2]); o.post = p[3]
            }
            ops.push(o)
        }
    }
    close()
    for (const pool of [out.skits, out.events])
        for (const k in pool)
            if (pool[k].length === 0) { delete pool[k]; out.errors.push("'" + k + "' has no frames") }
    return out
}

function expand(ops, vars) {
    const f = []
    const run = (ops, step) => {
        for (const o of ops) {
            if (o.op === "repeat") for (let i = 0; i < o.n; i++) run(o.body, i)
            else if (o.op === "gen") for (const fr of GEN[o.name](o.args)) f.push(fr)
            else if (o.op === "frame") f.push(frame(o, o.text, step, vars))
            else {
                const n = o.mid.length
                for (let k = o.op === "type" ? 1 : n - 1; o.op === "type" ? k <= n : k >= 0; k += o.op === "type" ? 1 : -1)
                    f.push(frame(o, o.pre + o.mid.slice(0, k).join("") + o.post, k, vars))
            }
        }
    }
    run(ops || [], 0)
    return f
}

function frame(o, text, step, vars) {
    const fr = { t: fill(text, step, vars), ms: Math.round(o.lo + Math.random() * (o.hi - o.lo)) }
    if (o.color) fr.color = o.color
    if (o.sparkle) fr.sparkle = true
    return fr
}

function fill(t, step, vars) {
    return t.replace(/\\\{|\{([^{}]*)\}/g, (all, b) => {
        if (all === "\\{") return "{"
        if (b[0] === "?") { const c = b.slice(1).split("|"); return c[Math.floor(Math.random() * c.length)] }
        if (b.indexOf("|") >= 0) { const c = b.split("|"); return c[step % c.length] }
        if (/^[a-z]\w*$/.test(b) && vars && b in vars) return String(vars[b])
        return all
    })
}
