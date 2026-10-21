import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Widgets
import Quickshell.Services.Pipewire
import Quickshell.Services.Mpris
import Quickshell.Services.SystemTray
import Quickshell.Bluetooth
import QtQuick
import qs
import qs.widgets
import "skits.js" as Skits

// quote: types out a short fortune left of the clock, picked to fit the
// room there. One that still doesn't fit ticker-scrolls as it types, then
// eases back to the start and from there scrolls a few passes like a news
// ticker (pauses under the mouse). New quote every 5 minutes; click = next,
// hover = full quote in a popup.
// On battery nothing animates: quotes appear whole, no random skits, and an
// event skit (low battery, charger...) shows as one still frame.
// Now and then (1 in 3 changes, or `qs ipc call bar peek`) a little skit
// decodes in instead: a face peeking left and right, dozing off, flipping
// a table, praising the sun... then it dissolves and the next quote types
// in. Skits are text files in ~/.config/quickshell/skits/ (see the README
// there); `qs ipc call bar skit <name>` plays a given one.
// Uses `fortune` if installed, else ~/.local/bin/fortune
// (quotes live in ~/.config/quickshell/quotes/).
Item {
    id: quote

    // from the bar
    property var bar
    property var clock            // its SystemClock
    property Item clockItem
    property Item leftRow
    property var tray

    property string body: ""
    property string author: ""
    property int typed: 0
    property real restX: 0
    property bool ticker: false      // long quote, after the glide back: scrolling on repeat
    property real tickX: 0

    function stopTicker() {
        settle.stop()
        tickerLoop.stop()
        ticker = false
    }
    readonly property bool typing: typed < body.length
    readonly property real room: clockItem.x - (leftRow.x + leftRow.width) - 36
    height: bar.implicitHeight
    // while a skit plays, hold the width of its longest frame so the
    // characters move instead of the whole line shifting
    width: Math.max(0, Math.min(peeking ? Math.max(faceRow.implicitWidth, faceMetrics.advanceWidth + 20)
                                        : quoteRow.implicitWidth, room))
    visible: room > 100 && (body !== "" || peeking)
    clip: true

    // ---------------- peeking face ----------------
    property bool peeking: false
    property string face: ""
    property bool sparkle: false
    property var frames: []
    property int frameIdx: 0

    function scrambled(target, revealed) {
        const noise = "▓▒░#%&@*"
        const chars = Array.from(target)   // by code point, so emoji stay whole
        let out = ""
        for (let i = 0; i < chars.length; i++)
            out += i < revealed || chars[i] === " " ? chars[i] : noise[Math.floor(Math.random() * noise.length)]
        return out
    }

    function dissolve(from) {
        // each char goes to · then away, in random order
        const steps = []
        let cur = Array.from(from)
        const order = cur.map((c, i) => i).filter(i => cur[i] !== " ").sort(() => Math.random() - 0.5)
        for (const i of order) { cur[i] = "·"; steps.push({ t: cur.join(""), ms: 45 }) }
        for (const i of order) { cur[i] = " "; steps.push({ t: cur.join(""), ms: 40 }) }
        return steps
    }

    // a skit: frames { t: text, ms: how long, sparkle?, color? }. The
    // first frame decodes in, the last one dissolves away.
    function play(core, force) {
        if (!core || core.length === 0 || (peeking && !force)) return
        faceTimer.stop()
        quote.stopTicker()
        const longest = core.reduce((a, fr) => fr.t.length > a.t.length ? fr : a)
        if (Power.unplugged) {
            // on battery: the fullest frame, still, for as long as the skit runs
            const ms = core.reduce((a, fr) => a + fr.ms, 0)
            frames = [{ t: longest.t, ms: Math.max(3000, ms), color: longest.color }]
        } else {
            let f = []
            const first = core[0].t
            for (let k = 0; k <= Array.from(first).length; k++) f.push({ t: scrambled(first, k), ms: 45 })
            frames = f.concat(core).concat(dissolve(core[core.length - 1].t))
        }
        faceMetrics.text = longest.t
        frameIdx = 0
        face = frames[0].t
        faceColor = frames[0].color || ""
        sparkle = false
        peeking = true
        faceTimer.interval = frames[0].ms
        faceTimer.restart()
    }

    property string faceColor: ""   // "" = accent, or "danger" / "accent2" / "dim"

    // ---------------- the skit files ----------------
    // ../skits/*.skit, format in skits/README.md, parsed by skits.js:
    // @name skits play at random, !name ones on events (below).
    property var lib: ({ skits: {}, events: {} })

    function reload() { if (!skitLoader.running) skitLoader.running = true }

    Process {
        id: skitLoader
        command: ["sh", "-c", "for f in \"$1\"/*.skit; do printf '#> %s\\n' \"${f##*/}\"; cat \"$f\"; echo; done",
                  "sh", Quickshell.shellPath("skits")]
        running: true
        stdout: StdioCollector {
            onStreamFinished: {
                const r = Skits.parse(text)
                for (const e of r.errors) console.warn("skits: " + e)
                quote.lib = r
            }
        }
    }

    // frames for a skit by name (either kind), {values} filled in
    function skitFrames(name, vars) {
        const ops = lib.skits[name] || lib.events[name]
        return ops ? Skits.expand(ops, vars) : []
    }

    // a random skit, or one by name
    function peek(name) {
        const names = Object.keys(lib.skits)
        if (!name || !(lib.skits[name] || lib.events[name])) {
            if (names.length === 0) return next()
            name = names[Math.floor(Math.random() * names.length)]
        }
        play(skitFrames(name))
    }

    // ---------------- event skits ----------------
    // Things happening on the machine get a reaction in place of the
    // quote: battery, charger, power profile, sound, network, VPN,
    // bluetooth, load, music, notifications, night light, calendar,
    // the clock, coming back to the desk. Each event has a cooldown so a
    // flapping signal can't spam it, and nothing fires while the shell is
    // starting up (properties settle then).
    property bool armed: false
    property var lastFired: ({})

    // key: the cooldown slot, name: the !skit, vars: its {values}
    function react(key, cooldownSec, name, vars) {
        if (!armed) return
        const now = Date.now()
        if (now - (lastFired[key] || 0) < cooldownSec * 1000) return
        const core = skitFrames(name || key, vars)
        if (core.length === 0) return
        lastFired[key] = now
        stopTicker()
        play(core, true)
    }

    function short(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t }

    Timer {
        interval: 6000
        running: true
        onTriggered: {
            quote.armed = true
            const h = new Date().getHours()
            quote.react("hello", 1, "hello",
                        { greeting: h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening" })
        }
    }

    // unplugged mid-quote: finish typing and stop scrolling now
    Connections {
        target: Power
        function onUnpluggedChanged() {
            if (!Power.unplugged) return
            quote.stopTicker()
            quote.restX = 0
            quote.typed = quote.body.length
        }
    }

    // battery and charger
    property bool _lowWarned: false
    property bool _critWarned: false
    Connections {
        target: Power
        function onOnACChanged() {
            if (!Power.hasBattery) return
            if (Power.onAC) quote.react("plugged", 20)
            else quote.react("unplugged", 20, "", { battery: Power.battery })
        }
        function onBatteryChanged() {
            if (!Power.hasBattery) return
            const b = Power.battery
            if (Power.onAC || b > Power.lowThreshold + 2) { quote._lowWarned = false; quote._critWarned = false }
            if (Power.onAC) {
                if (b >= 100) quote.react("full", 3600)
                return
            }
            if (b <= 10 && !quote._critWarned) {
                quote._critWarned = true
                quote.react("critical", 60, "", { battery: b })
            } else if (b <= Power.lowThreshold && !quote._lowWarned) {
                quote._lowWarned = true
                quote.react("low", 60, "", { battery: b })
            }
        }
        function onCurrentChanged() {
            const c = Power.current
            if (c === "performance") quote.react("perf", 10)
            else if (c === "power-saver") quote.react("saver", 10)
            else if (c === "balanced") quote.react("balanced", 10)
        }
    }

    // sound
    Connections {
        target: bar
        function onMutedChanged() { quote.react(bar.muted ? "mute" : "unmute", 10) }
    }

    // internet: judged a few seconds after things change, so a quick
    // reconnect or a switch between networks doesn't count
    property bool _online: true
    readonly property bool online: Net.ssid !== "" || Net.ethIface !== ""
    onOnlineChanged: netSettle.restart()
    Timer {
        id: netSettle
        interval: 5000
        onTriggered: {
            if (quote.online === quote._online) return
            quote._online = quote.online
            if (quote.online) quote.react("online", 30, "", { where: Net.ssid !== "" ? " · " + quote.short(Net.ssid, 16) : "" })
            else quote.react("offline", 30)
        }
    }

    // the Tailscale module, when it's on
    Connections {
        id: vpnWatch
        readonly property var vpn: Modules.service("vpn")
        target: vpn
        ignoreUnknownSignals: true
        function onRunningChanged() {
            if (vpnWatch.vpn.installed) quote.react(vpnWatch.vpn.running ? "vpnup" : "vpndown", 20)
        }
    }

    // bluetooth: a device connecting
    readonly property var btNames: Bluetooth.defaultAdapter
        ? Bluetooth.defaultAdapter.devices.values.filter(d => d.connected).map(d => d.name || "device") : []
    property var _btSeen: []
    onBtNamesChanged: {
        const fresh = btNames.filter(n => _btSeen.indexOf(n) < 0)
        _btSeen = btNames.slice()
        if (fresh.length > 0) react("bt-" + fresh[0], 120, "bluetooth", { device: short(fresh[0], 18) })
    }

    // load: CPU pegged for ~15 s, memory over 90%
    property int _hot: 0
    property bool _memWarned: false
    Timer {
        interval: 5000
        repeat: true
        running: true
        onTriggered: {
            quote._hot = bar.cpu > 0.9 ? quote._hot + 1 : bar.cpu < 0.7 ? 0 : quote._hot
            if (quote._hot === 3) quote.react("cpu", 600, "", { cpu: Math.round(bar.cpu * 100) })
            if (bar.mem > 0.9 && !quote._memWarned) {
                quote._memWarned = true
                quote.react("mem", 600, "", { mem: Math.round(bar.mem * 100) })
            } else if (bar.mem < 0.8) quote._memWarned = false
        }
    }

    // music: a new track starts playing
    property string _track: ""
    Connections {
        target: bar.player
        function onTrackTitleChanged() { songCheck.restart() }
        function onIsPlayingChanged() { songCheck.restart() }
    }
    Timer {
        id: songCheck
        interval: 1500
        onTriggered: {
            const p = bar.player
            if (!p || !p.isPlaying || !p.trackTitle || p.trackTitle === quote._track) return
            quote._track = p.trackTitle
            quote.react("song", 45, "", { track: quote.short(p.trackTitle, 34) })
        }
    }

    // the screen recorder module, when it's on
    Connections {
        id: recWatch
        readonly property var rec: Modules.service("recorder")
        target: rec
        ignoreUnknownSignals: true
        function onStateChanged() { if (recWatch.rec.state === "recording") quote.react("rec", 5) }
        function onSaved(path) { quote.react("rec-saved", 5, "", { clock: recWatch.rec.clock }) }
        function onFailed(why) { quote.react("rec-failed", 5) }
    }

    Connections {
        target: Caffeine
        function onOnChanged() { quote.react(Caffeine.on ? "caffeine" : "decaf", 5) }
    }

    // do not disturb, screenshots
    Connections {
        target: Notifs
        function onDndChanged() { quote.react(Notifs.dnd ? "dnd" : "undnd", 5) }
        function onCountChanged() {
            const l = Notifs.list
            const n = l.length ? l[l.length - 1] : null
            if (n && /screenshot/i.test((n.summary || "") + " " + (n.body || ""))) quote.react("shot", 60)
        }
    }
    // the night light module, when it's on
    Connections {
        id: nlWatch
        readonly property var nl: Modules.service("nightlight")
        target: nl
        ignoreUnknownSignals: true
        function onActiveChanged() { quote.react(nlWatch.nl.active ? "night" : "day", 30) }
    }

    // fingerprints: enrolling / testing in Settings, and unlocking with a finger
    // the fingerprint module, when it's on
    Connections {
        id: fpWatch
        readonly property var fp: Modules.service("fingerprint")
        target: fp
        ignoreUnknownSignals: true
        function onEvent(kind, finger) {
            const f = finger && finger !== "all" ? fpWatch.fp.label(finger).toLowerCase() : ""
            if (kind === "unlock") {
                // beats the generic "welcome back", which would fire right after
                quote.lastFired["welcome"] = Date.now()
                fpUnlockLater.restart()
                return
            }
            const name = { "enrolled": "fp-enrolled", "duplicate": "fp-dupe", "enroll-failed": "fp-fail",
                           "match": "fp-match", "nomatch": "fp-nomatch", "deleted": "fp-deleted" }[kind]
            if (name) quote.react(name, 5, "", { finger: f || (kind === "deleted" ? "prints" : "finger") })
        }
    }
    Timer {
        id: fpUnlockLater
        interval: 700   // let the lock screen fade first
        onTriggered: quote.react("fp-unlock", 10)
    }

    // the clock and the calendar, checked once a minute
    property int _minute: -1
    Connections {
        target: clock
        function onDateChanged() {
            const d = quote.clock.date, m = d.getHours() * 60 + d.getMinutes()
            if (m === quote._minute) return
            quote._minute = m
            const h = d.getHours(), mi = d.getMinutes()
            if (mi === 0) {
                if (h === 0) quote.react("midnight", 3000)
                else if (h === 3) quote.react("3am", 3000)
                else if (h === 12) quote.react("noon", 3000)
                else if (h === 17 && d.getDay() === 5) quote.react("friday", 3000)
            }
            // calendar: five minutes before, and when it starts
            const cal = Modules.service("calendar")
            const n = cal ? cal.next(1) : []
            if (n.length) {
                const o = n[0], mins = Math.round((o.start.getTime() - d.getTime()) / 60000)
                const title = { title: quote.short(o.ev.title || "event", 28) }
                if (mins === 5) quote.react("cal5-" + o.start.getTime(), 600, "cal-soon", title)
                else if (mins === 0) quote.react("cal0-" + o.start.getTime(), 600, "cal-now", title)
            }
        }
    }

    // back at the desk after 5+ minutes away (screensaver, lock)
    IdleMonitor {
        id: away
        timeout: 300
        respectInhibitors: false
        onIsIdleChanged: if (!isIdle) welcomeLater.restart()
    }
    Timer {
        id: welcomeLater
        interval: 1500
        onTriggered: quote.react("welcome", 60)
    }

    Timer {
        id: faceTimer
        onTriggered: {
            quote.frameIdx++
            if (quote.frameIdx >= quote.frames.length) {
                quote.peeking = false
                quote.sparkle = false
                quote.next()          // back to quotes with a fresh one
                return
            }
            const fr = quote.frames[quote.frameIdx]
            quote.face = fr.t
            quote.sparkle = fr.sparkle === true
            quote.faceColor = fr.color || ""
            interval = fr.ms
            restart()
        }
    }

    TextMetrics {
        id: faceMetrics
        font.family: Theme.fontFamily
        font.pixelSize: 13
        font.bold: true
    }

    Row {
        id: faceRow
        visible: quote.peeking
        anchors.verticalCenter: parent.verticalCenter
        spacing: 4
        Text {
            text: quote.face
            color: quote.faceColor === "danger" ? Theme.danger
                 : quote.faceColor === "accent2" ? Theme.accent2
                 : quote.faceColor === "dim" ? Theme.textDim
                 : Theme.accent
            font.family: Theme.fontFamily
            font.pixelSize: 13
            font.bold: true
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            text: "✧"
            color: Theme.accent2
            font.pixelSize: 12
            anchors.verticalCenter: parent.verticalCenter
            opacity: quote.sparkle ? 1 : 0
            scale: quote.sparkle ? 1 : 0.4
            Behavior on opacity { NumberAnimation { duration: 180 } }
            Behavior on scale { NumberAnimation { duration: 260; easing.type: Easing.OutBack } }
        }
    }

    function next() {
        if (fortuneProc.running) return
        // as many characters as fit the room left of the clock (the author
        // goes on the same line, so it counts too); a narrow bar falls back
        // to any short one and scrolls it
        const n = room > 100 ? Math.floor((room - 20) / quoteChar.advanceWidth) : 110
        fortuneProc.limit = Math.max(30, Math.min(110, n))
        fortuneProc.running = true
    }

    TextMetrics {
        id: quoteChar
        font.family: Theme.fontFamily
        font.pixelSize: 11
        font.italic: true
        text: "x"
    }

    Process {
        id: fortuneProc
        property int limit: 110
        command: ["sh", "-c", "for n in \"$1\" 110; do fortune -s -n \"$n\" 2>/dev/null"
            + " || \"$HOME/.local/bin/fortune\" -s -n \"$n\" 2>/dev/null && break; done", "sh", String(limit)]
        stdout: StdioCollector {
            onStreamFinished: {
                var lines = text.replace(/\t/g, " ").trim().split("\n")
                var m = lines.length > 1 ? lines[lines.length - 1].match(/^\s*--\s*(.+)$/) : null
                if (m)
                    lines.pop()
                quote.stopTicker()
                quote.author = m ? m[1].trim() : ""
                quote.body = lines.join(" ").replace(/\s+/g, " ").trim()
                quote.typed = Power.unplugged ? quote.body.length : 0
            }
        }
    }

    // the first quote waits for the bar to settle (chips keep appearing at
    // startup), so it's picked to fit
    onRoomChanged: if (body === "" && room > 100) firstQuote.restart()
    Timer { id: firstQuote; interval: 1000; onTriggered: if (quote.body === "") quote.next() }

    Timer {
        interval: 5 * 60 * 1000
        repeat: true
        running: true
        onTriggered: !Power.unplugged && Math.random() < 0.33 ? quote.peek("") : quote.next()
    }

    IpcHandler {
        target: "bar"
        // one target per shell: answer from the first monitor's bar only
        enabled: bar.screen === Quickshell.screens[0]
        function peek(): void { quote.peek("") }
        // qs ipc call bar skit <name>   (names: qs ipc call bar list)
        function skit(name: string): void { quote.peek(name) }
        function list(): string { return Object.keys(quote.lib.skits).join(" ") }
        // re-read the skit files after editing them
        function reload(): void { quote.reload() }
        // tray icons, and opening one's menu without the mouse
        function tray(): string { return quote.tray.items.map((t, i) => i + ": " + (t.title || t.id)).join("\n") }
        function trayMenu(i: int): void {
            const it = quote.tray.items[i]
            const ti = trayRepeater.itemAt(i)
            if (trayMenu.visible) { trayMenu.close(); return }
            if (!it || !it.hasMenu || !ti) return
            const p = ti.mapToItem(null, 0, ti.height + 6)
            trayMenu.open(it, bar, p.x, p.y)
        }
    }

    // typewriter
    Timer {
        interval: 28
        repeat: true
        running: quote.typing
        onTriggered: quote.typed++
        onRunningChanged: {
            // measure on the next frame, once the author text is laid out
            if (!running && quote.body !== "")
                Qt.callLater(() => {
                    // on battery a quote too long for the room just stays at its start
                    quote.restX = Power.unplugged ? 0 : Math.min(0, quote.room - quoteRow.implicitWidth)
                    if (quote.restX < 0)
                        settle.restart()
                })
        }
    }

    // after typing, hold on the ending, then glide back to the start
    SequentialAnimation {
        id: settle
        PauseAnimation { duration: 4000 }
        NumberAnimation {
            target: quote
            property: "restX"
            to: 0
            duration: Math.max(800, -quote.restX * 18)
            easing.type: Easing.InOutSine
        }
        PauseAnimation { duration: 2500 }
        ScriptAction {
            script: {
                quote.tickX = 0
                quote.ticker = true
                tickerLoop.restart()
            }
        }
    }

    // then like a news ticker: scroll left at a reading pace with a second
    // copy following, so it repeats without a gap. Pauses under the mouse.
    NumberAnimation {
        id: tickerLoop
        target: quote
        property: "tickX"
        from: 0
        to: -tickerRow.width / 2
        duration: tickerRow.width / 2 / 45 * 1000
        // a few passes, then rest on the start: an endless scroll kept the
        // bar redrawing at 60 fps until the next quote. Hover still shows
        // the whole quote; moving off it scrolls a few more passes.
        loops: 3
        paused: running && quoteMouse.containsMouse
        onFinished: quote.tickX = 0
    }

    Row {
        id: tickerRow
        visible: quote.ticker && !quote.peeking
        anchors.verticalCenter: parent.verticalCenter
        x: quote.tickX

        Repeater {
            model: 2
            Row {
                spacing: 6
                Text {
                    text: "“"
                    color: Theme.accent
                    font.family: Theme.fontFamily
                    font.pixelSize: 14
                    font.bold: true
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    text: quote.body
                    color: Theme.textDim
                    font.family: Theme.fontFamily
                    font.pixelSize: 11
                    font.italic: true
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    visible: quote.author !== ""
                    text: "— " + quote.author
                    color: Theme.textFaint
                    font.family: Theme.fontFamily
                    font.pixelSize: 10
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    text: "    ✦    "
                    color: Theme.accent
                    font.family: Theme.fontFamily
                    font.pixelSize: 9
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
        }
    }

    Row {
        id: quoteRow
        visible: !quote.peeking && !quote.ticker
        anchors.verticalCenter: parent.verticalCenter
        x: quote.typing ? Math.min(0, quote.room - implicitWidth) : quote.restX
        spacing: 6

        Text {
            text: "“"
            color: Theme.accent
            font.family: Theme.fontFamily
            font.pixelSize: 14
            font.bold: true
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            id: quoteBody
            text: quote.body.slice(0, quote.typed)
            color: Theme.textDim
            font.family: Theme.fontFamily
            font.pixelSize: 11
            font.italic: true
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            visible: quote.typing
            text: "▌"
            color: Theme.accent
            font.family: Theme.fontFamily
            font.pixelSize: 11
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            visible: !quote.typing && quote.author !== ""
            text: "— " + quote.author
            color: Theme.textFaint
            font.family: Theme.fontFamily
            font.pixelSize: 10
            anchors.verticalCenter: parent.verticalCenter
        }
    }

    MouseArea {
        id: quoteMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: if (!quote.peeking) quote.next()
        onExited: if (quote.ticker && !tickerLoop.running) tickerLoop.restart()
    }

    // full quote on hover
    PopupWindow {
        anchor.window: bar
        anchor.rect.x: quote.mapToItem(null, quote.width / 2, 0).x - implicitWidth / 2
        anchor.rect.y: bar.implicitHeight + 6
        implicitWidth: Math.min(420, quoteMetrics.width + 40)
        implicitHeight: popupCol.implicitHeight + 28
        visible: quoteMouse.containsMouse && quote.visible && !quote.peeking
        color: "transparent"

        TextMetrics {
            id: quoteMetrics
            font.family: Theme.fontFamily
            font.pixelSize: 12
            text: quote.body
        }

        Rectangle {
            anchors.fill: parent
            color: Theme.bgPanel
            border.color: Theme.border
            radius: Theme.radius

            Rectangle {
                width: 2
                height: parent.height - 16
                x: 8
                anchors.verticalCenter: parent.verticalCenter
                color: Theme.accent
            }

            Column {
                id: popupCol
                x: 22
                y: 14
                width: parent.width - 36
                spacing: 8

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: quote.body
                    color: Theme.text
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                    font.italic: true
                }
                Text {
                    visible: quote.author !== ""
                    width: parent.width
                    horizontalAlignment: Text.AlignRight
                    text: "— " + quote.author
                    color: Theme.textDim
                    font.family: Theme.fontFamily
                    font.pixelSize: 10
                    font.letterSpacing: 1
                }
            }
        }
    }
}
