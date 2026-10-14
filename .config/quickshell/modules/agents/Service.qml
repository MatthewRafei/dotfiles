import Quickshell
import Quickshell.Io
import QtQuick
import Qt.labs.folderlistmodel
import qs

// Claude Code sessions, for the bar's agents chip and its dropdown
// (QuickPanel.qml, "agents"). Sessions started from here run in a private
// tmux server (tmux.conf), so closing their terminal only detaches
// them: Claude keeps working, and the dropdown opens it again. `claude`
// typed in a terminal does the same through claude.bash (sourced from
// ~/.bashrc); sessions run some other way are listed too but end with
// their terminal.
//
// State comes from agents.py, which reads Claude Code's own session
// files: no hooks, nothing to set up.
//
//   qs ipc call agents panel      open the dropdown
//   qs ipc call agents next       open the session that needs you (or the newest)
//   qs ipc call agents start DIR  start a kept session in DIR
//   qs ipc call agents sync       sync sessions with your other machines now
//
// Sync (claude-sync.py) runs from Claude Code's SessionStart / SessionEnd
// hooks and every 10 minutes from here, only once its staging folder
// (~/Sync/claude, shared with Syncthing) exists.
Scope {
    id: root

    property bool available: false        // claude is installed
    property string claudeBin: ""
    property var sessions: []             // agents.py scan
    property var convos: []               // agents.py list: every saved conversation
    property var known: []                // folders Claude knows (~/.claude.json)
    property bool fast: false             // the dropdown is open: poll faster
    property var sync: ({})               // claude-sync.py status
    property bool syncing: false
    readonly property bool syncEnabled: sync.enabled === true

    readonly property var waiting: sessions.filter(s => s.status === "waiting")
    readonly property var busy: sessions.filter(s => s.status === "busy")
    readonly property var idle: sessions.filter(s => s.status !== "waiting" && s.status !== "busy")
    readonly property var resumable: idle.filter(s => s.status !== "view")

    // the dropdown's one list: idle sessions that still run, then every saved
    // conversation that doesn't, newest first. Nothing leaves it unless deleted.
    readonly property var library: {
        const live = new Set(sessions.map(s => s.sid).filter(x => x))
        const running = idle.map(s => ({ kind: "live", s: s, sid: s.sid, cwd: s.cwd || "", title: s.title,
                                         prompt: "", when: s.since }))
        const saved = convos.filter(c => !live.has(c.sid))
            .map(c => ({ kind: "saved", c: c, sid: c.sid, cwd: c.cwd, title: c.title,
                         prompt: c.prompt, when: c.mtime, found: c.found }))
        return running.concat(saved)
    }

    // a project is a folder: Claude Code keys every conversation by the folder it
    // ran in (a copied or moved folder starts a new history). Home, the folders
    // Claude knows, and any folder with a conversation; busiest recently first.
    readonly property var projects: {
        const by = {}
        const add = (dir, when, n) => {
            if (!dir) return
            const p = by[dir] || (by[dir] = { dir: dir, count: 0, when: 0 })
            p.count += n
            p.when = Math.max(p.when, when || 0)
        }
        add(home, 0, 0)
        for (const d of known) add(d, 0, 0)
        for (const s of sessions) add(s.cwd, s.since, 0)
        for (const c of convos) add(c.cwd, c.mtime, 1)
        const found = new Set(convos.filter(c => c.found).map(c => c.cwd).concat(sessions.map(s => s.cwd), [home]))
        return Object.values(by)
            .filter(p => p.count > 0 || found.has(p.dir) || knownFound.has(p.dir))
            .sort((a, b) => b.when - a.when || a.dir.localeCompare(b.dir))
    }
    property var knownFound: new Set()    // folders from ~/.claude.json that still exist

    readonly property string script: Quickshell.shellPath("modules/agents/agents.py")
    readonly property string syncScript: Quickshell.shellPath("modules/agents/claude-sync.py")
    readonly property string conf: Quickshell.shellPath("modules/agents/tmux.conf")
    readonly property string terminal: Quickshell.env("TERMINAL") || "alacritty"
    readonly property string home: Quickshell.env("HOME")

    function tmux(args) { return ["tmux", "-L", "claude", "-f", conf].concat(args) }

    // "~/Development/x"
    function pretty(dir) { return dir.indexOf(home) === 0 ? "~" + dir.slice(home.length) : dir }

    // "3m", "2h", "4d"
    function ago(ms) {
        const s = Math.max(0, (Date.now() - ms) / 1000)
        return s < 60 ? Math.floor(s) + "s" : s < 3600 ? Math.floor(s / 60) + "m"
             : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"
    }

    // start a kept session in `dir` (resuming conversation `sid` when given) and open it
    function newSession(dir, sid) {
        if (!available) return
        const base = (dir.split("/").filter(x => x).pop() || "home").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "claude"
        const name = "cc-" + base + "-" + (Date.now() % 46656).toString(36)
        const cmd = "exec " + JSON.stringify(claudeBin) + (sid && /^[0-9a-f-]{36}$/.test(sid) ? " --resume " + sid : "")
        // started detached, then a terminal attaches; closing it leaves claude running
        Quickshell.execDetached(["sh", "-c", 't=$1; n=$2; shift 2; "$@" && exec "$t" -e tmux -L claude attach -t "$n"',
            "sh", terminal, name].concat(tmux(["new-session", "-d", "-s", name, "-c", dir, cmd])))
        scanSoon.restart()
    }

    // bring a session up: its terminal if it has one, else a new terminal on the kept session
    function open(s) {
        if (s.job && s.host) s = { tmux: s.host, pid: 0 }
        if (s.tmux !== "") {
            // detached, so a shell restart never takes the terminal with it
            Quickshell.execDetached(["sh", "-c",
                'python3 -I "$1" attached "$2" || exec "$3" -e tmux -L claude attach -t "$2"',
                "sh", script, s.tmux, terminal])
        } else if (s.pid > 0) {
            Quickshell.execDetached(["python3", "-I", script, "focus", String(s.pid)])
        }
    }

    // end a kept session (claude and all)
    function stop(s) {
        if (s.tmux === "") return
        Quickshell.execDetached(tmux(["kill-session", "-t", s.tmux]))
        scanSoon.restart()
    }

    // move a saved conversation to the Trash (never one that's running)
    function remove(c) {
        if (sessions.some(s => s.sid === c.sid)) return
        convos = convos.filter(x => x.sid !== c.sid)
        Quickshell.execDetached(["python3", "-I", script, "delete", c.sid])
        listSoon.restart()
    }

    // the one that needs you: waiting longest, else the latest to finish
    function next() {
        const pick = waiting.slice().sort((a, b) => a.since - b.since)[0]
            || resumable.slice().sort((a, b) => b.since - a.since)[0]
        if (pick) open(pick)
    }

    // agents.py stays up (`serve`) and answers a "scan" line, instead of a
    // python start every few seconds
    function refresh() {
        if (scan.running) scan.write("scan\n")
        else if (root.available) scan.running = true
    }
    function listConvos() {
        if (scan.running) scan.write("list\n")
        else if (root.available) scan.running = true
    }
    function refreshMore() {
        refresh()
        listConvos()
        projectsFile.reload()
        if (!syncStatus.running) syncStatus.running = true
    }

    // pull the other machines' sessions in, push ours out
    function syncNow() {
        if (root.available && root.syncEnabled && !syncProc.running) syncProc.running = true
    }

    IpcHandler {
        target: "agents"
        function panel(): void { Quickshell.execDetached(["qs", "ipc", "call", "quick", "agents"]) }
        function next(): void { root.next() }
        function start(dir: string): void { root.newSession(dir || root.home, "") }
        function sync(): void { root.syncNow() }
    }

    Process {
        running: true
        command: ["sh", "-c", "PATH=\"$PATH:$HOME/.local/bin\"; command -v claude"]
        stdout: StdioCollector {
            onStreamFinished: {
                root.claudeBin = text.trim()
                root.available = root.claudeBin !== ""
                if (root.available) { root.refresh(); syncStatus.running = true }
            }
        }
    }

    Timer {
        property int ticks: 0
        interval: root.fast ? 1500 : 4000
        repeat: true
        running: root.available
        onTriggered: {
            root.refresh()
            // the conversations too while they're on screen (new ones, titles,
            // another machine's through sync)
            if (root.fast && ++ticks % 4 === 0) root.listConvos()
        }
    }
    // a session registered or gone: rescan now rather than on the next tick
    FolderListModel {
        folder: "file://" + root.home + "/.claude/sessions"
        nameFilters: ["*.json"]
        showDirs: false
        onCountChanged: if (root.available) scanSoon.restart()
    }
    Timer { id: scanSoon; interval: 800; onTriggered: root.refresh() }
    Timer { id: listSoon; interval: 800; onTriggered: root.listConvos() }

    Process {
        id: scan
        command: ["python3", "-I", root.script, "serve"]
        stdinEnabled: true
        onStarted: { write("scan\n"); if (root.fast) write("list\n") }
        stdout: SplitParser {
            onRead: line => {
                try {
                    const v = JSON.parse(line)
                    if (Array.isArray(v)) root.sessions = v
                    else if (v && Array.isArray(v.convos)) root.convos = v.convos
                } catch (e) {}
            }
        }
    }

    Timer {
        interval: 600000
        repeat: true
        running: root.syncEnabled
        onTriggered: root.syncNow()
    }

    Process {
        id: syncProc
        command: ["python3", "-I", root.syncScript, "sync", "-q"]
        onRunningChanged: root.syncing = running
        onExited: { syncStatus.running = true; if (root.fast) root.listConvos() }
    }

    Process {
        id: syncStatus
        command: ["python3", "-I", root.syncScript, "status"]
        stdout: StdioCollector {
            onStreamFinished: {
                try { root.sync = JSON.parse(text) } catch (e) {}
            }
        }
    }

    // folders Claude has been used in, newest config first
    FileView {
        id: projectsFile
        path: root.home + "/.claude.json"
        onLoaded: {
            try {
                root.known = Object.keys(JSON.parse(text()).projects || {})
                knownCheck.running = true
            } catch (e) {}
        }
    }

    // which of those folders still exist (a deleted folder with no conversations
    // isn't a project any more)
    Process {
        id: knownCheck
        command: ["sh", "-c", 'for d; do [ -d "$d" ] && printf "%s\\n" "$d"; done', "sh"].concat(root.known)
        stdout: StdioCollector {
            onStreamFinished: root.knownFound = new Set(text.split("\n").filter(x => x))
        }
    }
}
